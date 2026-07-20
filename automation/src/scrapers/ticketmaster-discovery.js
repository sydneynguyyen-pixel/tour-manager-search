// Ticketmaster tour DISCOVERY — the counterpart to ticketmaster-scraper.js.
//
// ticketmaster-scraper.js answers "does THIS named artist have confirmed
// dates?" (a targeted, name-keyed lookup, one artist at a time). That's all the
// pipeline needed as long as Tour Announcements only ever covered artists the
// scoring funnel had already discovered.
//
// This module answers the opposite question: "which artists — ANY artist, not
// just ones already in the pool — just went on sale with a real touring run?"
// It BROWSES Ticketmaster's Discovery catalog (no keyword), groups the raw
// events by their headlining attraction, and returns every act with a genuine
// multi-date tour. That's how a Justin-Bieber-tier artist who would never pass
// Matthew's lead-scoring criteria (built for smaller/mid-tier acts) can still
// surface as a travel-booking opportunity in Tour Announcements. See
// build-tour-announcements.js for how these get merged in (tagged as
// "discovered", i.e. outside Matthew's roster) and dashboard filtering.
//
// Auth: reuses TICKETMASTER_API_KEY (same free key ticketmaster-scraper.js
// uses). Without it, resolves to an empty list — the whole discovery step goes
// dark, exactly like any other optional source.
//
// Rate limits: same documented Ticketmaster caps (5000 req/day, 2 req/sec). A
// serial throttle (its own queue, distinct from ticketmaster-scraper's, but the
// two never run concurrently — build-tour-announcements finishes the per-artist
// roster pass before starting discovery) keeps this under the per-second cap.
//
// The 1000-item deep-paging cap: Ticketmaster's /events search refuses to page
// past item 1000 (size * page must stay < 1000). A single nationwide music
// query sorted by date would therefore only ever reach the soonest ~1000 US
// shows — i.e. roughly the next couple of weeks — and miss every tour whose
// dates sit further out. The fix is to SEGMENT by state: each state has far
// fewer upcoming music events, so a handful of pages per state reaches months
// out, and because a real tour plays many cities we reassemble its full
// national date count by aggregating across states (an event lives in exactly
// one state, so there's no cross-state double-counting).

require('dotenv').config({ quiet: true });
const axios = require('axios');
const logger = require('../utils/logger');

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';
const API_KEY = process.env.TICKETMASTER_API_KEY || null;
const MIN_INTERVAL_MS = 500; // 2 req/sec, matches ticketmaster-scraper's throttle

// 50 states + DC. Territories (PR, etc.) are intentionally omitted — US
// touring for travel-booking purposes is the scope here.
const STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
];

const PAGE_SIZE = 100; // Ticketmaster max is 200; 100 keeps each response small.
const MAX_PAGES_PER_STATE = 5; // up to 500 upcoming events/state — months of reach.
// Strictly MORE THAN 5 confirmed dates. Per the feature decision: any scale of
// tour qualifies, but single shows and short runs (<= 5 dates) are excluded —
// those aren't the multi-market tours a travel booker cares about.
const MIN_TOUR_DATES = 6;
// Events listing more attractions than this are treated as festivals / package
// bills and skipped — attributing a 12-act festival's date to its first-listed
// name would invent tours that don't exist.
const MAX_FESTIVAL_ATTRACTIONS = 3;
const MAX_EVENTS_PER_TOUR = 40; // display cap in the stored payload; keeps JSON bounded.

const ticketmaster = axios.create({ baseURL: TM_BASE, timeout: 15_000 });

// --- serial throttle: one request at a time, spaced by MIN_INTERVAL_MS --------
let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

// Ticketmaster uses "1900-01-01" as a sentinel for "on-sale date not tracked",
// and "9999-12-31" as the same sentinel in the other direction (seen on some
// TBD on-sale listings) — rather than omitting the field. Treat anything
// implausibly old OR implausibly far out as unknown. (Same lower-bound rule as
// ticketmaster-scraper.js's plausibleOnSaleDate; the upper bound is specific
// to this module since it takes the min() across many more listings.)
const EARLIEST_PLAUSIBLE_ON_SALE_YEAR = 2000;
const LATEST_PLAUSIBLE_ON_SALE_YEAR = 2100;
function plausibleOnSaleDate(iso) {
  if (!iso) return null;
  const year = Number(String(iso).slice(0, 4));
  return Number.isFinite(year) && year >= EARLIEST_PLAUSIBLE_ON_SALE_YEAR && year <= LATEST_PLAUSIBLE_ON_SALE_YEAR
    ? iso
    : null;
}

// Best display image for an attraction: prefer a wide 16:9 of reasonable size,
// else the widest available, else none. Ticketmaster attaches several crops.
function pickAttractionImage(attraction) {
  const images = Array.isArray(attraction?.images) ? attraction.images.filter((i) => i && i.url) : [];
  if (images.length === 0) return null;
  const wide = images
    .filter((i) => i.ratio === '16_9' && (i.width || 0) >= 500)
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  if (wide) return wide.url;
  return images.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
}

// A plain genre string from the attraction's classification, skipping
// Ticketmaster's "Undefined" placeholders. Falls back to the segment name
// (e.g. "Music") and finally null.
function attractionGenre(attraction) {
  const c = attraction?.classifications?.[0] || null;
  const genre = c?.genre?.name;
  if (genre && genre !== 'Undefined') return genre;
  const segment = c?.segment?.name;
  return segment && segment !== 'Undefined' ? segment : null;
}

// Reduce one raw Ticketmaster event to the compact record discovery needs, or
// null if it isn't attributable to a single headliner (no attractions, or a
// festival-sized bill) or has no date. PURE — no network, unit-tested.
//
// Attribution is to the FIRST-listed attraction only. Ticketmaster lists the
// headliner first, so this credits the act whose tour it actually is and avoids
// crediting an opener with the headliner's whole run (which attributing to
// every attraction would do). A co-headline's second name may fall short of the
// date threshold as a result — an accepted precision-over-recall trade.
function extractBrowseEvent(event) {
  const attractions = event?._embedded?.attractions || [];
  if (attractions.length === 0 || attractions.length > MAX_FESTIVAL_ATTRACTIONS) return null;
  const headliner = attractions[0];
  const name = headliner?.name ? String(headliner.name).trim() : '';
  if (!name) return null;
  const date = event?.dates?.start?.localDate;
  if (!date) return null;
  const venue = event?._embedded?.venues?.[0] || null;
  return {
    artistKey: String(headliner.id || name).trim().toLowerCase(),
    artist: name,
    ticketmasterId: headliner.id ?? null,
    imageUrl: pickAttractionImage(headliner),
    genre: attractionGenre(headliner),
    date,
    venue: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    // A working ticketing link for the show — used by the detail page's
    // "On sale now" list so Matthew can click straight through to the tour.
    url: event?.url ?? null,
    onSaleDate: plausibleOnSaleDate(event?.sales?.public?.startDateTime),
  };
}

// Group compact browse records into per-artist tours, keeping only acts with
// MORE THAN 5 distinct confirmed dates. Dedupes by date+venue (the same key
// ArtistDetail's mergeConfirmedEvents / the roster build use), so a show that
// somehow appears twice counts once. PURE — no network, unit-tested.
function groupToursFromBrowseEvents(records, { minDates = MIN_TOUR_DATES } = {}) {
  const byArtist = new Map();
  for (const r of records) {
    if (!r || !r.artistKey) continue;
    let rec = byArtist.get(r.artistKey);
    if (!rec) {
      rec = { artist: r.artist, ticketmasterId: r.ticketmasterId, imageUrl: r.imageUrl, genre: r.genre, events: new Map(), onsales: [] };
      byArtist.set(r.artistKey, rec);
    }
    // A later record may carry image/genre the first one lacked.
    if (!rec.imageUrl && r.imageUrl) rec.imageUrl = r.imageUrl;
    if (!rec.genre && r.genre) rec.genre = r.genre;
    const dvKey = `${r.date}|${(r.venue || '').trim().toLowerCase()}`;
    if (!rec.events.has(dvKey)) rec.events.set(dvKey, { date: r.date, venue: r.venue, city: r.city, url: r.url });
    if (r.onSaleDate) rec.onsales.push(r.onSaleDate);
  }

  const tours = [];
  for (const rec of byArtist.values()) {
    if (rec.events.size < minDates) continue; // > 5 dates only
    const events = [...rec.events.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    tours.push({
      artist: rec.artist,
      ticketmasterId: rec.ticketmasterId,
      imageUrl: rec.imageUrl,
      genre: rec.genre,
      dateCount: events.length, // true national count, before the display cap below
      earliestOnSaleDate: rec.onsales.slice().sort()[0] ?? null,
      events: events.slice(0, MAX_EVENTS_PER_TOUR),
    });
  }
  // Biggest tours first, name as a stable tiebreak.
  return tours.sort((a, b) => b.dateCount - a.dateCount || (a.artist || '').localeCompare(b.artist || ''));
}

// One throttled page of upcoming music events for a state. Resolves with the
// raw Ticketmaster payload; the caller handles pagination and errors.
function fetchStatePage(stateCode, page, startIso) {
  return schedule(async () => {
    const res = await ticketmaster.get('/events.json', {
      params: {
        apikey: API_KEY,
        classificationName: 'music',
        countryCode: 'US',
        stateCode,
        startDateTime: startIso, // upcoming only
        sort: 'date,asc',
        size: PAGE_SIZE,
        page,
      },
    });
    return res.data;
  });
}

// Browse Ticketmaster nationwide (state by state) and return every act with a
// > 5-date upcoming tour. Never throws — a failed state is logged and skipped
// so one bad segment can't abort the whole discovery pass. Roster exclusion and
// the final cap live in build-tour-announcements.js (which owns the roster).
async function getNewlyAnnouncedTours() {
  if (!API_KEY) {
    logger.warn('Ticketmaster discovery: TICKETMASTER_API_KEY not set — skipping (no discovered tours).');
    return [];
  }

  const startIso = `${new Date().toISOString().slice(0, 19)}Z`;
  const records = [];
  let statesScanned = 0;
  let pagesFetched = 0;

  for (const stateCode of STATE_CODES) {
    statesScanned += 1;
    for (let page = 0; page < MAX_PAGES_PER_STATE; page += 1) {
      let data;
      try {
        data = await fetchStatePage(stateCode, page, startIso);
      } catch (err) {
        const status = err.response?.status;
        // 404 is Ticketmaster's "no results" for this endpoint — not an error.
        if (status !== 404) {
          logger.warn(`Ticketmaster discovery: ${stateCode} page ${page} failed (${status ?? err.message}); skipping rest of state.`);
        }
        break;
      }
      pagesFetched += 1;
      const events = data?._embedded?.events || [];
      for (const event of events) {
        const rec = extractBrowseEvent(event);
        if (rec) records.push(rec);
      }
      const totalPages = data?.page?.totalPages ?? 1;
      if (events.length < PAGE_SIZE || page + 1 >= totalPages) break;
    }
  }

  const tours = groupToursFromBrowseEvents(records);
  logger.info(
    `Ticketmaster discovery: scanned ${records.length} attributable event(s) across ${statesScanned} state(s) ` +
      `(${pagesFetched} page(s)); ${tours.length} act(s) with more than ${MIN_TOUR_DATES - 1} confirmed dates.`
  );
  return tours;
}

module.exports = {
  getNewlyAnnouncedTours,
  // exported for unit tests (pure, no network)
  extractBrowseEvent,
  groupToursFromBrowseEvents,
  pickAttractionImage,
  attractionGenre,
  plausibleOnSaleDate,
  MIN_TOUR_DATES,
  STATE_CODES,
};
