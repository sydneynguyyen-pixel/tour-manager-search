// Ticketmaster Discovery API — confirmed on-sale/announced tour dates. This
// is the STRONGEST possible touring signal available to the pipeline: every
// other tour-timing signal (fresh release, comeback gap) is an INFERENCE
// about whether a tour is likely; a Ticketmaster listing is a verified,
// on-sale, real-world confirmation. See score.js's scoreTicketmasterBonus for
// how this gets layered into the tour-timing dimension alongside (not
// instead of) that inferred logic.
//
// Auth: TICKETMASTER_API_KEY is optional — a free, self-serve key from
// https://developer.ticketmaster.com. Without it, this scraper is skipped
// entirely (hasUpcomingEvents stays false for everyone, same as any other
// optional source going dark).
//
// Rate limits: 5000 requests/day, 2 requests/sec — a serial throttle keeps us
// under the per-second cap regardless of how many artists are queued.

require('dotenv').config({ quiet: true });
const axios = require('axios');
const logger = require('../utils/logger');
const { nameSimilarity, NAME_MATCH_MIN } = require('./setlistfm-scraper');

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';
const API_KEY = process.env.TICKETMASTER_API_KEY || null;
const MIN_INTERVAL_MS = 500; // 2 req/sec, right at the documented cap
const MAX_EVENTS_RETURNED = 10;

const ticketmaster = axios.create({ baseURL: TM_BASE, timeout: 15_000 });

let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

const EMPTY = { hasUpcomingEvents: false, events: [], eventCount: 0, earliestOnSaleDate: null };

// A single throttled GET, keyed to the shared queue so every Ticketmaster
// call across all artists this run respects the same spacing.
async function tmGet(path, params, label) {
  return schedule(async () => {
    const res = await ticketmaster.get(path, { params: { ...params, apikey: API_KEY } });
    return res.data;
  }).catch((err) => {
    const status = err.response?.status;
    if (status === 429) logger.warn(`Ticketmaster 429 on ${label}; skipping this artist.`);
    throw err;
  });
}

// keyword search surfaces events by title/venue/attraction text, so it can
// return a support-act billing or an unrelated same-title event alongside
// the artist we actually asked about. Only count events where a headlining
// attraction's name is a confident match for the query, the same
// name-verification discipline setlistfm-scraper.js uses for its search hits.
function eventMatchesArtist(event, artistName) {
  const attractions = event?._embedded?.attractions || [];
  return attractions.some((a) => nameSimilarity(artistName, a?.name) >= NAME_MATCH_MIN);
}

// Ticketmaster uses "1900-01-01" as a sentinel for "on-sale date not tracked"
// (seen on presale-only or long-running general-admission listings), and
// "9999-12-31" as the same sentinel in the other direction (seen on TBD
// on-sale listings) — rather than omitting the field. A literal ticket sale
// in 1900 (or 9999) isn't possible, so treat anything outside a plausible
// real-world range as "unknown", not as an ancient/far-future real date
// (which would otherwise miscategorize these in score.js's recency check).
const EARLIEST_PLAUSIBLE_ON_SALE_YEAR = 2000;
const LATEST_PLAUSIBLE_ON_SALE_YEAR = 2100;
function plausibleOnSaleDate(iso) {
  if (!iso) return null;
  const year = Number(iso.slice(0, 4));
  return Number.isFinite(year) && year >= EARLIEST_PLAUSIBLE_ON_SALE_YEAR && year <= LATEST_PLAUSIBLE_ON_SALE_YEAR
    ? iso
    : null;
}

function extractEvent(event) {
  const venue = event?._embedded?.venues?.[0] || null;
  return {
    date: event?.dates?.start?.localDate ?? null,
    venue: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    // Rarely populated on the public Discovery API, but read it when present
    // rather than assuming it never is.
    venueCapacity: Number.isFinite(venue?.capacity) ? venue.capacity : null,
    onSaleDate: plausibleOnSaleDate(event?.sales?.public?.startDateTime),
  };
}

// Confirmed upcoming events for one artist. Always resolves (never throws) —
// no key, no matches, not-found, or an API error all resolve to the same
// empty shape so a flaky/missing source never drops an artist from the
// pipeline.
async function getTicketmasterEvents(artistName) {
  if (!artistName) return { ...EMPTY };
  if (!API_KEY) return { ...EMPTY }; // optional source, not configured — fail quiet

  let data;
  try {
    data = await tmGet(
      '/events.json',
      { keyword: artistName, classificationName: 'music', size: 50, sort: 'date,asc' },
      `events "${artistName}"`
    );
  } catch (err) {
    const status = err.response?.status;
    // 404 is Ticketmaster's "no results" response for this endpoint, not an
    // error condition — anything else is a real API/network failure.
    if (status !== 404) {
      logger.warn(`Ticketmaster: request failed for "${artistName}" (${status ?? err.message}); skipping.`);
    }
    return { ...EMPTY };
  }

  const rawEvents = data?._embedded?.events || [];
  if (rawEvents.length === 0) {
    logger.info(`Ticketmaster: no events found for "${artistName}".`);
    return { ...EMPTY };
  }

  const matched = rawEvents.filter((e) => eventMatchesArtist(e, artistName)).map(extractEvent);
  if (matched.length === 0) {
    logger.info(
      `Ticketmaster: ${rawEvents.length} event(s) matched keyword "${artistName}" but none name-verified ` +
        `as the artist (likely a support-act billing or unrelated same-title event); treating as no results.`
    );
    return { ...EMPTY };
  }

  const onSaleDates = matched.map((e) => e.onSaleDate).filter(Boolean).sort();
  const earliestOnSaleDate = onSaleDates[0] ?? null;

  logger.info(`Ticketmaster: "${artistName}" — ${matched.length} confirmed event(s), earliest on-sale ${earliestOnSaleDate ?? 'unknown'}.`);

  return {
    hasUpcomingEvents: true,
    events: matched.slice(0, MAX_EVENTS_RETURNED).map(({ date, venue, city, venueCapacity }) => ({
      date,
      venue,
      city,
      venueCapacity,
    })),
    eventCount: matched.length,
    earliestOnSaleDate,
  };
}

module.exports = { getTicketmasterEvents };
