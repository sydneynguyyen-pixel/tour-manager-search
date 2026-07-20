// One-time (re-runnable) enrichment pass for automation/data/my-artists.json —
// gives Matthew's own artist log real images/genre/bio/tour history instead of
// bare names. Reuses the existing scraper functions as-is; does NOT run
// contact-research or score.js — My Artists entries are never scored or
// treated as leads, so that stage would be wasted work.
//
// Sources (all fail-soft — a miss on one never blocks the others):
//   - Deezer artist search -> primary image
//   - Setlist.fm -> resolves the mbid (also feeds MusicBrainz below) + recent
//     tour history (18mo, same window the leads pipeline uses)
//   - MusicBrainz -> primary genre, keyed by the Setlist.fm mbid
//   - TheAudioDB -> bio, plus an image/genre fallback when the above miss
//   - Music-news RSS (Pitchfork/Stereogum) -> recent coverage mentions
//   - Ticketmaster Discovery API -> confirmed on-sale tour dates
//   - JamBase Data API -> a second, independent confirmed-tour source
//
// The last three mirror aggregate.js's Leads enrichment exactly (same
// scrapers, same field names) so a My Artists entry and a Lead render
// identically in the dashboard's shared ArtistCard/ArtistDetail components.
// Unlike aggregate.js, JamBase is queried unconditionally here rather than
// funnel-gated on `rel && tour` — that gate exists to avoid metering cost on
// every raw discovered candidate, but My Artists is already a small (~26),
// hand-curated roster of real artists Matthew cares about, so there's no
// funnel to gate against.
//
// Idempotent: entries that already carry `enrichedAt` are skipped on a re-run.
// Pass --force to re-enrich everyone (e.g. after a scraper improves).
//
// NOTE on a past `enrichedAt`-goes-missing incident: this script has always
// set `enrichedAt` unconditionally (see enrichOne below) — there's no bug
// here. What actually happened: dashboard/src/lib/myArtists.js's one-time
// browser seed (toLocalEntry) predates `deezerId`/`enrichedAt` existing on
// the backend record for any browser that had already seeded before those
// fields were added, so those two fields were never copied into that
// browser's localStorage. Every subsequent dashboard edit re-syncs ALL
// entries from localStorage back to this file (toBackendEntry), silently
// omitting whatever that browser's copy never had — which re-clobbers a
// freshly-run enrichment's `enrichedAt`/`deezerId` back to missing. Re-running
// this script does NOT self-correct that: it fixes the file, but the next
// dashboard-triggered sync from an affected browser will drop it again. See
// toLocalEntry/toBackendEntry in dashboard/src/lib/myArtists.js.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const { findArtist: findDeezerArtist } = require('./src/scrapers/deezer-scraper');
const { scrapeSetlistFMTourHistory } = require('./src/scrapers/setlistfm-scraper');
const { getArtistProfile } = require('./src/scrapers/audiodb-scraper');
const { getPrimaryGenre } = require('./src/musicbrainz');
const { checkArtistInRecentNews } = require('./src/scrapers/rss-scraper');
const { getTicketmasterEvents } = require('./src/scrapers/ticketmaster-scraper');
const { getJamBaseEvents } = require('./src/scrapers/jambase-scraper');
const { computeIsCurrentlyTouring } = require('./src/aggregate');

const MY_ARTISTS_PATH = path.join(__dirname, 'data', 'my-artists.json');
const TOUR_MONTHS_BACK = 18;
const FORCE = process.argv.includes('--force');

function loadMyArtists() {
  const parsed = JSON.parse(fs.readFileSync(MY_ARTISTS_PATH, 'utf8'));
  return { updatedAt: parsed.updatedAt || null, artists: Array.isArray(parsed.artists) ? parsed.artists : [] };
}

function saveMyArtists(data) {
  fs.writeFileSync(MY_ARTISTS_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

// Enrich a single entry. Never throws — each source is already fail-soft, and
// a source-level error here just leaves that field null rather than aborting
// the whole entry (one bad lookup shouldn't cost the other 26 artists).
async function enrichOne(entry) {
  const name = entry.name;

  let deezerImage = null;
  let deezerId = null;
  try {
    const d = await findDeezerArtist(name);
    if (d) {
      deezerId = d.id;
      deezerImage = d.picture_xl || d.picture_medium || d.picture || null;
    }
  } catch (err) {
    logger.warn(`Enrich: Deezer lookup failed for "${name}" (${err.message}).`);
  }

  // Setlist.fm resolves mbid + (optionally) tour history in one call. Run
  // per-artist (rather than batching all 27) so the result maps back to this
  // exact entry unambiguously — scrapeSetlistFMTourHistory returns the
  // Setlist.fm-canonical name, which can differ in case/spacing from ours.
  let tourRecord = null;
  try {
    const [rec] = await scrapeSetlistFMTourHistory([name], TOUR_MONTHS_BACK);
    tourRecord = rec || null;
  } catch (err) {
    logger.warn(`Enrich: Setlist.fm lookup failed for "${name}" (${err.message}).`);
  }

  let mbGenre = null;
  if (tourRecord?.mbid) {
    try {
      mbGenre = await getPrimaryGenre(tourRecord.mbid);
    } catch (err) {
      logger.warn(`Enrich: MusicBrainz genre lookup failed for "${name}" (${err.message}).`);
    }
  }

  let audiodb;
  try {
    audiodb = await getArtistProfile(name);
  } catch (err) {
    logger.warn(`Enrich: TheAudioDB lookup failed for "${name}" (${err.message}).`);
    audiodb = { bio: null, genre: null, imageUrl: null };
  }

  let news;
  try {
    news = await checkArtistInRecentNews(name);
  } catch (err) {
    logger.warn(`Enrich: RSS news check failed for "${name}" (${err.message}).`);
    news = { mentioned: false, articles: [] };
  }

  let ticketmaster;
  try {
    ticketmaster = await getTicketmasterEvents(name);
  } catch (err) {
    logger.warn(`Enrich: Ticketmaster lookup failed for "${name}" (${err.message}).`);
    ticketmaster = { hasUpcomingEvents: false, events: [], eventCount: 0, earliestOnSaleDate: null };
  }

  let jambase;
  try {
    jambase = await getJamBaseEvents(name);
  } catch (err) {
    logger.warn(`Enrich: JamBase lookup failed for "${name}" (${err.message}).`);
    jambase = { hasUpcomingEvents: false, events: [], eventCount: 0, earliestListedDate: null };
  }

  const isCurrentlyTouring = computeIsCurrentlyTouring(tourRecord?.lastTourDate ?? null, [
    ...(ticketmaster.events || []),
    ...(jambase.events || []),
  ]);

  const enriched = {
    ...entry,
    imageUrl: deezerImage ?? audiodb.imageUrl ?? null,
    genre: mbGenre ?? audiodb.genre ?? null,
    bio: audiodb.bio ?? null,
    mbid: tourRecord?.mbid ?? null,
    deezerId,
    newsArticles: news.articles ?? [], // Pitchfork/Stereogum mentions; display-only, not scored
    hasUpcomingEvents: ticketmaster.hasUpcomingEvents ?? false,
    ticketmasterEvents: ticketmaster.events ?? [], // {date, venue, city, venueCapacity}, newest-first
    ticketmasterEventCount: ticketmaster.eventCount ?? 0,
    ticketmasterEarliestOnSaleDate: ticketmaster.earliestOnSaleDate ?? null,
    hasJamBaseEvents: jambase.hasUpcomingEvents ?? false,
    jambaseEvents: jambase.events ?? [], // {date, venue, city, ticketUrl}
    jambaseEventCount: jambase.eventCount ?? 0,
    jambaseEarliestListedDate: jambase.earliestListedDate ?? null,
    isCurrentlyTouring, // display-only "on tour now" badge; not a scoring input
    enrichedAt: new Date().toISOString(),
  };

  // Tour history is a bonus, not a requirement — only attach it when
  // Setlist.fm actually found the artist (avoid a zero-count record read as
  // "confirmed no tours").
  if (tourRecord) {
    enriched.tourCount = tourRecord.tourCount;
    enriched.avgVenueSize = tourRecord.avgVenueSize;
    enriched.countriesToured = tourRecord.countriesToured;
    enriched.lastTourDate = tourRecord.lastTourDate;
    enriched.topVenues = tourRecord.topVenues;
    enriched.tourHistory = tourRecord.tourHistory;
  }

  logger.info(
    `Enrich: "${name}" — image=${enriched.imageUrl ? 'Y' : 'N'}, genre=${enriched.genre ?? '—'}, ` +
      `bio=${enriched.bio ? 'Y' : 'N'}, tourHistory=${tourRecord ? `${tourRecord.setlistCount} show(s)` : 'N'}, ` +
      `news=${news.articles.length}, ticketmaster=${ticketmaster.eventCount}, jambase=${jambase.eventCount}, ` +
      `touring=${isCurrentlyTouring ? 'Y' : 'N'}.`
  );

  return enriched;
}

async function main() {
  const data = loadMyArtists();
  const targets = FORCE ? data.artists : data.artists.filter((a) => !a.enrichedAt);

  logger.info(
    `Enriching ${targets.length}/${data.artists.length} My Artists entr${targets.length === 1 ? 'y' : 'ies'}` +
      `${FORCE ? ' (--force: redoing everyone)' : ' missing enrichment'}...`
  );
  if (targets.length === 0) {
    logger.info('Nothing to enrich — all entries already carry enrichment data. Pass --force to redo.');
    return;
  }

  const byName = new Map(data.artists.map((a) => [a.name, a]));
  let imageHits = 0;
  let genreHits = 0;
  let bioHits = 0;
  let tourHits = 0;
  let newsHits = 0;
  let ticketmasterHits = 0;
  let jambaseHits = 0;
  let touringHits = 0;

  for (const entry of targets) {
    const enriched = await enrichOne(entry);
    byName.set(entry.name, enriched);
    if (enriched.imageUrl) imageHits += 1;
    if (enriched.genre) genreHits += 1;
    if (enriched.bio) bioHits += 1;
    if (enriched.tourHistory) tourHits += 1;
    if (enriched.newsArticles.length > 0) newsHits += 1;
    if (enriched.hasUpcomingEvents) ticketmasterHits += 1;
    if (enriched.hasJamBaseEvents) jambaseHits += 1;
    if (enriched.isCurrentlyTouring) touringHits += 1;
  }

  const nextArtists = data.artists.map((a) => byName.get(a.name) || a);
  saveMyArtists({ updatedAt: new Date().toISOString(), artists: nextArtists });

  logger.count('Enriched with image', imageHits);
  logger.count('Enriched with genre', genreHits);
  logger.count('Enriched with bio', bioHits);
  logger.count('Enriched with tour history', tourHits);
  logger.count('Enriched with news mentions', newsHits);
  logger.count('Enriched with Ticketmaster events', ticketmasterHits);
  logger.count('Enriched with JamBase events', jambaseHits);
  logger.count('Currently touring', touringHits);
  logger.success(`✓ Enrichment written to ${path.relative(__dirname, MY_ARTISTS_PATH)}`);
}

main().catch((err) => {
  logger.error('enrich-my-artists failed:', err.response?.status ?? '', err.response?.data ?? err.message);
  process.exit(1);
});
