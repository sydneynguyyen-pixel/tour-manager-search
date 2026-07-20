// JamBase Data API — a second, independent confirmed-tour-announcement
// source alongside Ticketmaster (ticketmaster-scraper.js). Same idea (a real
// listing beats an inference about whether a tour is coming), different
// vendor's data — so when both agree, that's two independent confirmations,
// not just one; see score.js's scoreJamBaseBonus / confirmationRecencyBonus.
//
// Auth: JAMBASE_API_KEY is optional — a free "Developer" tier key from
// https://data.jambase.com (no card required). Base URL and auth header
// confirmed directly from JamBase's own API reference sandbox
// (https://data.jambase.com/api/reference/search-events, "Try It" tab, which
// generates `curl https://api.data.jambase.com/v3/events -H "Authorization:
// Bearer ..."` — note this differs from the plain-prose "api.jambase.com"
// base URL mentioned on the getting-started page; the sandbox-generated
// request is the more trustworthy source since it's generated straight off
// their live OpenAPI spec).
//
// CRITICAL COST NOTE: unlike Ticketmaster (free, just rate-limited), this
// tier is hard-capped at 1,000 calls/month and overage is billed per call —
// see jambase-usage.js for the local budget tracker this checks before every
// request, and aggregate.js's call site for why this is only queried for
// candidates that already passed the release + tour-history funnel (NOT
// every raw discovered candidate).
//
// Date window: the Developer tier hard-caps eventDateTo at 180 days out
// (confirmed live — see WINDOW_DAYS below; a request even a few days past
// that gets rejected with a 403 date-window-exceeded, which is how the exact
// cap was found in practice rather than guessed at).

require('dotenv').config({ quiet: true });
const axios = require('axios');
const logger = require('../utils/logger');
const { nameSimilarity, NAME_MATCH_MIN } = require('./setlistfm-scraper');
const { canMakeCall, recordCall } = require('../jambase-usage');

const JAMBASE_BASE = 'https://api.data.jambase.com/v3';
const API_KEY = process.env.JAMBASE_API_KEY || null;
// The Developer tier hard-caps eventDateTo at 180 days out (confirmed live —
// a request for +6 CALENDAR months overshoots this by a few days on
// long-month starts and gets rejected with a 403 date-window-exceeded).
const WINDOW_DAYS = 180;
const MAX_EVENTS_RETURNED = 10;

const jambase = axios.create({
  baseURL: JAMBASE_BASE,
  timeout: 15_000,
  headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
});

const EMPTY = { hasUpcomingEvents: false, events: [], eventCount: 0, earliestListedDate: null };

function eventDateWindow(now = new Date()) {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { eventDateFrom: from, eventDateTo: to.toISOString().slice(0, 10) };
}

// Same false-positive concern as Ticketmaster's keyword search: artistName is
// documented as "a keyword-based search," so it can surface an unrelated
// same-name-ish act. Only count events where a listed performer's name is a
// confident match for the query.
function eventMatchesArtist(event, artistName) {
  const performers = event?.performer || [];
  return performers.some((p) => nameSimilarity(artistName, p?.name) >= NAME_MATCH_MIN);
}

function extractEvent(event) {
  const venue = event?.location || null;
  const offerUrl = event?.offers?.[0]?.url;
  return {
    date: (event?.startDate || '').slice(0, 10) || null,
    venue: venue?.name ?? null,
    city: venue?.address?.addressLocality ?? null,
    // Fall back to the JamBase event page itself if no direct ticket-offer
    // URL is present — still a working link to find tickets from.
    ticketUrl: offerUrl ?? event?.url ?? null,
    datePublished: event?.datePublished ?? null,
  };
}

// Confirmed upcoming events (6-month window) for one artist. Always resolves
// (never throws) — no key, quota exhausted, no matches, or an API error all
// resolve to the same empty shape so this never drops an artist from the
// pipeline or interrupts a run.
async function getJamBaseEvents(artistName) {
  if (!artistName) return { ...EMPTY };
  if (!API_KEY) return { ...EMPTY }; // optional source, not configured — fail quiet

  if (!canMakeCall()) return { ...EMPTY }; // over budget for this month — logged in canMakeCall()

  const { eventDateFrom, eventDateTo } = eventDateWindow();
  let data;
  try {
    const res = await jambase.get('/events', {
      params: { artistName, eventDateFrom, eventDateTo, perPage: 25, sort: 'eventDate' },
    });
    data = res.data;
  } catch (err) {
    recordCall(); // the request was sent and (per JamBase's metering) still counts against quota
    const status = err.response?.status;
    logger.warn(`JamBase: request failed for "${artistName}" (${status ?? err.message}); skipping.`);
    return { ...EMPTY };
  }
  recordCall();

  const rawEvents = data?.events || [];
  if (rawEvents.length === 0) {
    logger.info(`JamBase: no events found for "${artistName}".`);
    return { ...EMPTY };
  }

  const matched = rawEvents.filter((e) => eventMatchesArtist(e, artistName)).map(extractEvent);
  if (matched.length === 0) {
    logger.info(
      `JamBase: ${rawEvents.length} event(s) matched keyword "${artistName}" but none name-verified as ` +
        `the artist; treating as no results.`
    );
    return { ...EMPTY };
  }

  const publishedDates = matched.map((e) => e.datePublished).filter(Boolean).sort();
  const earliestListedDate = publishedDates[0] ?? null;

  logger.info(
    `JamBase: "${artistName}" — ${matched.length} confirmed event(s), earliest listed ${earliestListedDate ?? 'unknown'}.`
  );

  return {
    hasUpcomingEvents: true,
    events: matched.slice(0, MAX_EVENTS_RETURNED).map(({ date, venue, city, ticketUrl }) => ({
      date,
      venue,
      city,
      ticketUrl,
    })),
    eventCount: data?.pagination?.totalItems ?? matched.length,
    earliestListedDate,
  };
}

module.exports = { getJamBaseEvents };
