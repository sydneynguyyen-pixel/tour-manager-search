// Builds automation/data/tour-announcements.json — a neutral, chronological
// feed of confirmed tour announcements across every artist the pipeline has
// ever encountered (all of leads.json, regardless of score, plus all of
// my-artists.json), for broader use beyond the scored Leads experience (e.g.
// travel agency colleagues). Deliberately carries no scoring fields.
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
// An artist only becomes a feed entry when it has at least one confirmed
// event — this is an announcements feed, not a roster listing.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { getTicketmasterEvents } = require('./src/scrapers/ticketmaster-scraper');
const { getJamBaseEvents } = require('./src/scrapers/jambase-scraper');

const LEADS_PATH = path.join(__dirname, 'data', 'leads.json');
const MY_ARTISTS_PATH = path.join(__dirname, 'data', 'my-artists.json');
const OUT_PATH = path.join(__dirname, 'data', 'tour-announcements.json');

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
      ticketmasterEvents: alreadyFetched(l) ? l.ticketmasterEvents ?? [] : null,
      jambaseEvents: alreadyFetched(l) ? l.jambaseEvents ?? [] : null,
    });
  }

  return [...pool.values()];
}

async function main() {
  const pool = loadPool();
  logger.info(`Tour Announcements: pooled ${pool.length} unique artist(s) from leads.json + my-artists.json.`);

  const results = [];
  let fetchedCount = 0;

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

    if (events.length === 0) continue; // no confirmed announcement — not part of this feed

    results.push({
      artist: entry.artist,
      imageUrl: entry.imageUrl,
      genre: entry.genre,
      announcedDate: entry.announcedDate || new Date().toISOString(),
      events,
    });
  }

  results.sort((a, b) => (b.announcedDate || '').localeCompare(a.announcedDate || ''));

  const output = {
    generatedAt: new Date().toISOString(),
    totalArtists: results.length,
    artists: results,
  };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  logger.success(
    `✓ Tour Announcements written to ${path.relative(__dirname, OUT_PATH)} — ${results.length} artist(s) with ` +
      `confirmed events (${fetchedCount} freshly looked up, ${pool.length - fetchedCount} reused from cache).`
  );
}

main().catch((err) => {
  logger.error('build-tour-announcements failed:', err.response?.status ?? '', err.response?.data ?? err.message);
  process.exit(1);
});
