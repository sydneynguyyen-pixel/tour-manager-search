// Builds automation/data/tour-announcements.json — a neutral, tour-lifecycle-
// classified feed across every artist the pipeline has ever encountered (all
// of leads.json, regardless of score, plus all of my-artists.json), for
// broader use beyond the scored Leads experience (e.g. travel agency
// colleagues). Deliberately carries no scoring fields.
//
// Reuses the same Ticketmaster/JamBase scrapers as enrich-my-artists.js and
// aggregate.js, as-is. My Artists entries that already have enrichment
// (enrichedAt set) reuse their cached ticketmasterEvents/jambaseEvents rather
// than re-querying — no reason to spend JamBase's metered quota re-asking a
// question already answered this run cycle. Leads currently carry no cached
// Ticketmaster/JamBase data at all (that funnel gate lives in aggregate.js),
// so every lead gets a fresh lookup here; the `alreadyFetched` check is
// generic so this self-corrects if that ever changes.
//
// Every pooled artist becomes an output entry (not just ones with confirmed
// events) — tourStage classifies where each one sits in the lifecycle, and
// the dashboard filters/prioritizes from there. See classifyTourStage below.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { getTicketmasterEvents } = require('./src/scrapers/ticketmaster-scraper');
const { getJamBaseEvents } = require('./src/scrapers/jambase-scraper');

const LEADS_PATH = path.join(__dirname, 'data', 'leads.json');
const MY_ARTISTS_PATH = path.join(__dirname, 'data', 'my-artists.json');
const OUT_PATH = path.join(__dirname, 'data', 'tour-announcements.json');

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

function normName(name) {
  return (name || '').trim().toLowerCase();
}

// True when this record already carries a Ticketmaster/JamBase lookup result
// (even an empty one) from an earlier enrichment pass.
function alreadyFetched(entry) {
  return Array.isArray(entry.ticketmasterEvents) || Array.isArray(entry.jambaseEvents);
}

// Pools every unique artist across both files, keyed by normalized name.
// My Artists is read first so a name appearing in both sources keeps the My
// Artists copy (richer, already-cached enrichment) rather than the lead.
// Carries through recentReleases/releaseDate/lastTourDate too — raw signal
// classifyTourStage needs but the final output schema doesn't otherwise use.
function loadPool() {
  const leadsData = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  const myArtistsData = JSON.parse(fs.readFileSync(MY_ARTISTS_PATH, 'utf8'));
  const pool = new Map();

  for (const a of myArtistsData.artists || []) {
    if (!a.name) continue;
    const key = normName(a.name);
    if (pool.has(key)) continue;
    pool.set(key, {
      artist: a.name,
      imageUrl: a.imageUrl ?? null,
      genre: a.genre ?? null,
      announcedDate: a.addedAt ?? null,
      recentReleases: Array.isArray(a.recentReleases) ? a.recentReleases : [],
      releaseDate: null,
      tourHistory: Array.isArray(a.tourHistory) ? a.tourHistory : [],
      ticketmasterEvents: alreadyFetched(a) ? a.ticketmasterEvents ?? [] : null,
      jambaseEvents: alreadyFetched(a) ? a.jambaseEvents ?? [] : null,
    });
  }

  for (const l of leadsData.leads || []) {
    if (!l.artist) continue;
    const key = normName(l.artist);
    if (pool.has(key)) continue; // dedupe — My Artists copy wins when both exist
    pool.set(key, {
      artist: l.artist,
      imageUrl: l.imageUrl ?? null,
      genre: l.genre ?? null,
      announcedDate: l.firstSeen ?? null,
      recentReleases: Array.isArray(l.recentReleases) ? l.recentReleases : [],
      releaseDate: l.releaseDate ?? null,
      tourHistory: Array.isArray(l.tourHistory) ? l.tourHistory : [],
      ticketmasterEvents: alreadyFetched(l) ? l.ticketmasterEvents ?? [] : null,
      jambaseEvents: alreadyFetched(l) ? l.jambaseEvents ?? [] : null,
    });
  }

  return [...pool.values()];
}

// Same date+venue key ArtistDetail's mergeConfirmedEvents uses — Ticketmaster
// and JamBase both listing the same show is one confirmed date, not two.
// Classification counts real confirmed dates, so this dedupe matters: an
// artist with 2 real shows both cross-listed on both platforms would
// otherwise raw-count as 4 events and misclassify as ONGOING/NEW_TOUR
// (3+ threshold) instead of NEW_SHOWS.
function countConfirmedDates(events) {
  const seen = new Set();
  for (const e of events) seen.add(`${e.date}|${(e.venue || '').trim().toLowerCase()}`);
  return seen.size;
}

function daysAgo(dateStr) {
  if (!dateStr) return Infinity;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

// Checks every date in the artist's Setlist.fm tour history, not just the
// single most-recent one — a record's "most recent" show can occasionally
// carry a same-day/near-future date (Setlist.fm setlists sometimes get
// logged the day of, ahead of this script's own run), which would otherwise
// read as "not in the past" and mask genuinely-recent shows a few days
// earlier in the same list. Only dates that are actually in the past count.
function hasRecentSetlistShow(entry) {
  return entry.tourHistory.some((show) => {
    const d = daysAgo(show.date);
    return d >= 0 && d <= 60;
  });
}

function hasRecentRelease(entry) {
  const dates = [entry.releaseDate, ...entry.recentReleases.map((r) => r.releaseDate)].filter(Boolean);
  return dates.some((d) => {
    const age = daysAgo(d);
    return age >= 0 && age <= 60;
  });
}

// Tour-lifecycle classification — see the feature spec for the five stages.
// Exhaustive/deterministic by construction (every artist gets exactly one),
// evaluated in this precedence order:
//   1. 3+ confirmed dates + played within 60 days -> ONGOING (actively touring)
//   2. 3+ confirmed dates, nothing played within 60 days -> NEW_TOUR (the
//      primary target signal: confirmed dates exist, tour hasn't started)
//   3. 1-2 confirmed dates -> NEW_SHOWS (single show / short run)
//   4. 0 confirmed dates, a release within 60 days -> POSSIBLE (early signal)
//   5. everything else -> NO_TOUR
// Note: an artist with 0 confirmed dates, no recent release, but a recent
// past show (rare — played recently, nothing new confirmed since) falls into
// NO_TOUR too. The spec's NO_TOUR wording ("no events AND no recent shows")
// doesn't explicitly cover that combination; NO_TOUR is the closest fit since
// neither POSSIBLE nor NEW_SHOWS applies and there's no forward-looking
// signal to report.
function classifyTourStage(entry, confirmedDateCount) {
  const recentShow = hasRecentSetlistShow(entry);
  if (confirmedDateCount >= 3) return recentShow ? 'ONGOING' : 'NEW_TOUR';
  if (confirmedDateCount >= 1) return 'NEW_SHOWS';
  if (hasRecentRelease(entry)) return 'POSSIBLE';
  return 'NO_TOUR';
}

async function main() {
  const pool = loadPool();
  logger.info(`Tour Announcements: pooled ${pool.length} unique artist(s) from leads.json + my-artists.json.`);

  const results = [];
  let fetchedCount = 0;
  const tierCounts = { NEW_TOUR: 0, ONGOING: 0, NEW_SHOWS: 0, POSSIBLE: 0, NO_TOUR: 0 };

  for (const entry of pool) {
    let tmEvents = entry.ticketmasterEvents;
    let jbEvents = entry.jambaseEvents;

    if (tmEvents === null || jbEvents === null) {
      fetchedCount += 1;
      try {
        tmEvents = (await getTicketmasterEvents(entry.artist)).events ?? [];
      } catch (err) {
        logger.warn(`Tour Announcements: Ticketmaster lookup failed for "${entry.artist}" (${err.message}).`);
        tmEvents = [];
      }
      try {
        jbEvents = (await getJamBaseEvents(entry.artist)).events ?? [];
      } catch (err) {
        logger.warn(`Tour Announcements: JamBase lookup failed for "${entry.artist}" (${err.message}).`);
        jbEvents = [];
      }
    }

    const events = [
      ...tmEvents.map((e) => ({ date: e.date, venue: e.venue, city: e.city, ticketUrl: null, source: 'ticketmaster' })),
      ...jbEvents.map((e) => ({ date: e.date, venue: e.venue, city: e.city, ticketUrl: e.ticketUrl ?? null, source: 'jambase' })),
    ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const confirmedDateCount = countConfirmedDates(events);
    const tourStage = classifyTourStage(entry, confirmedDateCount);
    tierCounts[tourStage] += 1;

    results.push({
      artist: entry.artist,
      imageUrl: entry.imageUrl,
      genre: entry.genre,
      announcedDate: entry.announcedDate || new Date().toISOString(),
      tourStage,
      events,
    });
  }

  results.sort((a, b) => (b.announcedDate || '').localeCompare(a.announcedDate || ''));

  const output = {
    generatedAt: new Date().toISOString(),
    totalArtists: results.length,
    tierCounts,
    artists: results,
  };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  logger.success(
    `✓ Tour Announcements written to ${path.relative(__dirname, OUT_PATH)} — ${results.length} artist(s) ` +
      `(${fetchedCount} freshly looked up, ${pool.length - fetchedCount} reused from cache).`
  );
  logger.info(
    `Tour stages — NEW_TOUR: ${tierCounts.NEW_TOUR}, ONGOING: ${tierCounts.ONGOING}, ` +
      `NEW_SHOWS: ${tierCounts.NEW_SHOWS}, POSSIBLE: ${tierCounts.POSSIBLE}, NO_TOUR: ${tierCounts.NO_TOUR}.`
  );
}

main().catch((err) => {
  logger.error('build-tour-announcements failed:', err.response?.status ?? '', err.response?.data ?? err.message);
  process.exit(1);
});
