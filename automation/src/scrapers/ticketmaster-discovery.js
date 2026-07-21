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
// A separate, smaller page budget for the recent-past browse (see
// RECENT_PAST_DAYS below) — 60 days of history is far shorter than the
// multi-month forward reach MAX_PAGES_PER_STATE targets, so this doesn't need
// nearly as many pages, and keeping it a separate budget means the past
// browse can never eat into future-date coverage the way a single widened
// window would.
const MAX_PAST_PAGES_PER_STATE = 3;
// How far back to look for dates an act has already played, to tell an
// ongoing tour (already playing shows) from a genuinely new one (nothing
// played yet) — same 60-day window build-tour-announcements.js's
// classifyTourStage uses for roster artists (hasRecentSetlistShow), so a
// discovered act and a roster act land in ONGOING under the same rule.
const RECENT_PAST_DAYS = 60;
// Strictly MORE THAN 5 confirmed UPCOMING dates. Per the feature decision:
// any scale of tour qualifies, but single shows and short runs (<= 5 dates)
// are excluded — those aren't the multi-market tours a travel booker cares
// about. Recent-past dates (see above) don't count toward this threshold —
// they only ever demote NEW_TOUR to ONGOING, never independently qualify a
// tour that has no upcoming dates left.
const MIN_TOUR_DATES = 6;
// Travel booking only makes sense for an act moving city to city — a
// residency (e.g. a Las Vegas/Sphere run) can clear MIN_TOUR_DATES on date
// count alone while never leaving one location. Require the UPCOMING dates
// to span at least this many distinct locations (see locationKey below).
const MIN_DISTINCT_CITIES = 3;
// A date only counts toward MIN_TOUR_DATES/MIN_DISTINCT_CITIES if it's at
// least this many days out from asOf — travel booking needs enough lead time
// to actually arrange, so an entirely-imminent run (every date inside the
// next 4 weeks) shouldn't qualify even if it clears the raw counts. A tour
// that merely STARTS soon still qualifies as long as it has enough dates/
// cities further out — see the "bookable" subset in groupToursFromBrowseEvents.
const MIN_LEAD_DAYS = 28;
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

// Festival/package-bill detection, confirmed against the live Discovery API
// for Breakaway Music Festival, Lollapalooza, Riot Fest, Eastern Festival of
// Music, and Buffalo Traffic Jam (see the commit that added this — payloads
// captured during investigation). Ticketmaster marks a true festival two
// different ways depending on the listing:
//   1. Attraction-level: classifications[0].type.name === 'Event Style' and
//      subType.name === 'Festival' (Breakaway, Lollapalooza).
//   2. Event-level: classifications[0].segment.name === 'Miscellaneous' and
//      genre.name === 'Fairs & Festivals' (Riot Fest — its OWN attraction
//      record carries no distinguishing classification at all, so only the
//      event-level field catches it).
// Neither signal fires for "Eastern Festival of Music" (attraction tagged as
// an Orchestra) or "Buffalo Traffic Jam" (attraction tagged as a plain
// Concert) — both are real touring institutions Ticketmaster simply doesn't
// classify as festivals in either field. A conservative name fallback,
// checked against the attraction name only (never venue/city, to avoid
// over-matching), catches what the metadata misses. Metadata is checked
// first and wins precedence — a real artist should never be dropped just
// because their name happens to contain one of these words.
const FESTIVAL_NAME_RE = /\bfest(ival)?\b|\bfair\b|traffic jam|jingle ball|block party/i;

function isFestivalAttraction(attraction, event, name) {
  const attractionClass = attraction?.classifications?.[0];
  if (attractionClass?.subType?.name === 'Festival') return true;
  const eventClass = event?.classifications?.[0];
  if (eventClass?.genre?.name === 'Fairs & Festivals') return true;
  return FESTIVAL_NAME_RE.test(name || '');
}

// Reduce one raw Ticketmaster event to the compact record discovery needs, or
// null if it isn't attributable to a single headliner (no attractions, a
// festival-sized bill, or a festival/non-artist attraction) or has no date.
// PURE — no network, unit-tested.
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
  if (isFestivalAttraction(headliner, event, name)) return null;
  const date = event?.dates?.start?.localDate;
  if (!date) return null;
  const venue = event?._embedded?.venues?.[0] || null;
  // Attraction classification fields, carried through raw (not just the
  // display-genre reduction attractionGenre() does) so a festival false-
  // negative or false-positive can be diagnosed from stored/logged data
  // without re-querying Ticketmaster.
  const attractionClass = headliner?.classifications?.[0] || null;
  return {
    artistKey: String(headliner.id || name).trim().toLowerCase(),
    artist: name,
    ticketmasterId: headliner.id ?? null,
    imageUrl: pickAttractionImage(headliner),
    genre: attractionGenre(headliner),
    classification: attractionClass
      ? {
          segment: attractionClass.segment?.name ?? null,
          genre: attractionClass.genre?.name ?? null,
          subGenre: attractionClass.subGenre?.name ?? null,
          type: attractionClass.type?.name ?? null,
          subType: attractionClass.subType?.name ?? null,
        }
      : null,
    date,
    venue: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    // A working ticketing link for the show — used by the detail page's
    // "On sale now" list so Matthew can click straight through to the tour.
    url: event?.url ?? null,
    onSaleDate: plausibleOnSaleDate(event?.sales?.public?.startDateTime),
  };
}

// Location bucket for the "must travel between markets" gate below — the
// city Ticketmaster gave, normalized (trimmed, lowercased, so "Austin" and
// "austin" aren't counted as two locations); falls back to the venue name
// when city is missing, so a null-city tour that's genuinely playing
// different venues doesn't wrongly collapse to a single location.
function locationKey(event) {
  const city = (event.city || '').trim().toLowerCase();
  if (city) return city;
  return (event.venue || '').trim().toLowerCase();
}

// Group compact browse records (spanning both the upcoming and recent-past
// browses — see getNewlyAnnouncedTours) into per-artist tours, keeping only
// acts with MORE THAN 5 distinct confirmed BOOKABLE dates that ALSO span at
// least minDistinctCities locations among those bookable dates — travel
// booking only makes sense for an act moving city to city with enough lead
// time to actually arrange the trip. "Bookable" is the subset of upcoming
// dates at least minLeadDays out from asOf (see bookableCutoffIso below); an
// entirely-imminent run (every date inside the lead window) doesn't qualify
// even with a high raw date count, but a tour that merely STARTS soon still
// qualifies as long as its later dates alone clear both thresholds. The
// single-location gate (residencies like a Las Vegas/Sphere run) applies to
// this same bookable subset. Dedupes by date+venue (the same key
// ArtistDetail's mergeConfirmedEvents / the roster build use) across the
// full past+future set, so a show that somehow appears twice (or in both
// browses) counts once. PURE — no network, unit-tested.
//
// todayIso (a "YYYY-MM-DD" string, comparable directly against the
// Ticketmaster localDate records already carry) is the upcoming/past cutoff:
// dates >= todayIso are upcoming (kept in the returned events list — the
// lead-time gate only affects qualification, never what's displayed); dates
// < todayIso are recent-past (dropped from the output, but their presence
// sets recentlyPlayed — the discovered-act equivalent of build-tour-
// announcements.js's hasRecentSetlistShow, which is what promotes a
// discovered act from NEW_TOUR to ONGOING). asOf is the Date used for the
// bookable-cutoff arithmetic; defaults to midnight UTC of todayIso so the
// two never drift apart when only todayIso is pinned (as tests do) — pass
// asOf explicitly only when a sub-day distinction actually matters.
//
// stats, if passed, is mutated in place with drop counts broken out by
// reason (date threshold vs. single-location) — getNewlyAnnouncedTours uses
// this to log the location filter's effect separately from the date filter's.
function groupToursFromBrowseEvents(
  records,
  {
    minDates = MIN_TOUR_DATES,
    minDistinctCities = MIN_DISTINCT_CITIES,
    minLeadDays = MIN_LEAD_DAYS,
    todayIso = new Date().toISOString().slice(0, 10),
    asOf = new Date(`${todayIso}T00:00:00Z`),
    stats,
  } = {}
) {
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
    // On-sale dates only matter for the remaining upcoming leg — a past
    // show's sale window is over and irrelevant to "when did this get
    // announced" for what's left to book.
    if (r.onSaleDate && r.date >= todayIso) rec.onsales.push(r.onSaleDate);
  }

  const bookableCutoffIso = new Date(asOf.getTime() + minLeadDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const tours = [];
  for (const rec of byArtist.values()) {
    const allEvents = [...rec.events.values()];
    const upcoming = allEvents
      .filter((e) => e.date >= todayIso)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const bookable = upcoming.filter((e) => e.date >= bookableCutoffIso);
    if (bookable.length < minDates) {
      // > 5 BOOKABLE dates only
      if (stats) stats.droppedForDateThreshold = (stats.droppedForDateThreshold || 0) + 1;
      continue;
    }
    const distinctCities = new Set(bookable.map(locationKey)).size;
    if (distinctCities < minDistinctCities) {
      if (stats) stats.droppedForSingleLocation = (stats.droppedForSingleLocation || 0) + 1;
      continue;
    }
    const recentlyPlayed = allEvents.some((e) => e.date < todayIso);
    tours.push({
      artist: rec.artist,
      ticketmasterId: rec.ticketmasterId,
      imageUrl: rec.imageUrl,
      genre: rec.genre,
      dateCount: upcoming.length, // full upcoming count, for display — the lead-time gate only affects qualification
      bookableDateCount: bookable.length,
      distinctCities,
      recentlyPlayed,
      earliestOnSaleDate: rec.onsales.slice().sort()[0] ?? null,
      events: upcoming.slice(0, MAX_EVENTS_PER_TOUR), // full upcoming run, not bookable-only — see header comment
    });
  }
  // Biggest tours first, name as a stable tiebreak.
  return tours.sort((a, b) => b.dateCount - a.dateCount || (a.artist || '').localeCompare(b.artist || ''));
}

// One throttled page of music events for a state, over [startIso, endIso).
// endIso is optional — omitted for the upcoming browse (open-ended into the
// future), supplied for the recent-past browse (bounded to before "now").
// Resolves with the raw Ticketmaster payload; the caller handles pagination
// and errors.
function fetchStatePage(stateCode, page, startIso, endIso) {
  return schedule(async () => {
    const params = {
      apikey: API_KEY,
      classificationName: 'music',
      countryCode: 'US',
      stateCode,
      startDateTime: startIso,
      sort: 'date,asc',
      size: PAGE_SIZE,
      page,
    };
    if (endIso) params.endDateTime = endIso;
    const res = await ticketmaster.get('/events.json', { params });
    return res.data;
  });
}

// Browses every state for one date range, up to maxPages per state. Shared by
// both the upcoming and recent-past passes in getNewlyAnnouncedTours — same
// pagination/error handling, different range and page budget. Never throws —
// a failed state/page is logged and skipped so one bad segment can't abort
// the whole pass.
async function scanStatesForRange(startIso, endIso, maxPages, label) {
  const records = [];
  let pagesFetched = 0;
  for (const stateCode of STATE_CODES) {
    for (let page = 0; page < maxPages; page += 1) {
      let data;
      try {
        data = await fetchStatePage(stateCode, page, startIso, endIso);
      } catch (err) {
        const status = err.response?.status;
        // 404 is Ticketmaster's "no results" for this endpoint — not an error.
        if (status !== 404) {
          logger.warn(`Ticketmaster discovery (${label}): ${stateCode} page ${page} failed (${status ?? err.message}); skipping rest of state.`);
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
  return { records, pagesFetched };
}

// Browse Ticketmaster nationwide (state by state) and return every act with a
// > 5-date upcoming tour, each flagged recentlyPlayed if it already played a
// date in the last RECENT_PAST_DAYS (build-tour-announcements.js uses that to
// classify the act ONGOING instead of NEW_TOUR — see the discovery merge
// there). Two separate browses, not one widened window: an upcoming pass
// (unbounded into the future, the original per-state page budget) and a
// recent-past pass (bounded to the last RECENT_PAST_DAYS, its own smaller
// budget) — kept separate so 60 days of history can never crowd out the
// months-out future coverage the upcoming pass was already tuned for. Roster
// exclusion and the final cap live in build-tour-announcements.js (which owns
// the roster).
async function getNewlyAnnouncedTours() {
  if (!API_KEY) {
    logger.warn('Ticketmaster discovery: TICKETMASTER_API_KEY not set — skipping (no discovered tours).');
    return [];
  }

  const now = new Date();
  const nowIso = `${now.toISOString().slice(0, 19)}Z`;
  const todayIso = now.toISOString().slice(0, 10);
  const pastStartIso = `${new Date(now.getTime() - RECENT_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 19)}Z`;

  const upcoming = await scanStatesForRange(nowIso, null, MAX_PAGES_PER_STATE, 'upcoming');
  const recentPast = await scanStatesForRange(pastStartIso, nowIso, MAX_PAST_PAGES_PER_STATE, 'recent-past');

  const stats = {};
  const tours = groupToursFromBrowseEvents([...upcoming.records, ...recentPast.records], { todayIso, stats });
  const alreadyTouringCount = tours.filter((t) => t.recentlyPlayed).length;
  logger.info(
    `Ticketmaster discovery: scanned ${upcoming.records.length} upcoming + ${recentPast.records.length} recent-past ` +
      `attributable event(s) across ${STATE_CODES.length} state(s) (${upcoming.pagesFetched + recentPast.pagesFetched} page(s)); ` +
      `${tours.length} act(s) with more than ${MIN_TOUR_DATES - 1} confirmed dates at least ${MIN_LEAD_DAYS} days out ` +
      `spanning ${MIN_DISTINCT_CITIES}+ locations (${alreadyTouringCount} already touring). Dropped ` +
      `${stats.droppedForDateThreshold || 0} for too few bookable dates, ` +
      `${stats.droppedForSingleLocation || 0} for touring a single location (residency-style runs).`
  );
  return tours;
}

module.exports = {
  getNewlyAnnouncedTours,
  // exported for unit tests (pure, no network)
  extractBrowseEvent,
  groupToursFromBrowseEvents,
  isFestivalAttraction,
  locationKey,
  pickAttractionImage,
  attractionGenre,
  plausibleOnSaleDate,
  MIN_TOUR_DATES,
  MIN_DISTINCT_CITIES,
  MIN_LEAD_DAYS,
  RECENT_PAST_DAYS,
  STATE_CODES,
};
