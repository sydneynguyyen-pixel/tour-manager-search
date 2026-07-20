// One-time (re-runnable) enrichment pass for automation/data/my-artists.json —
// gives Matthew's own artist log real images/genre/bio/tour history/releases/
// links instead of bare names. Reuses the existing scraper functions as-is,
// including contact-research (management/website/label discovery — but see
// below for why contactName/contactEmail specifically are excluded). Does
// NOT run score.js — My Artists entries are never scored or treated as
// leads, so that stage would be wasted work.
//
// Sources (all fail-soft — a miss on one never blocks the others):
//   - Deezer artist search -> primary image
//   - Deezer release history -> recentReleases (wide 120-day window, not the
//     Leads pipeline's 60-day funnel — see DEEZER_RELEASE_WINDOW_DAYS)
//   - Setlist.fm -> resolves the mbid (also feeds MusicBrainz below) + recent
//     tour history (18mo, same window the leads pipeline uses)
//   - MusicBrainz -> primary genre, keyed by the Setlist.fm mbid
//   - TheAudioDB -> bio, plus an image/genre/website/social fallback when the
//     above miss
//   - Wikidata -> primary social-link source (same priority as aggregate.js:
//     Wikidata -> Wikipedia -> TheAudioDB, first non-null wins per platform)
//   - Wikipedia/web (via contact-research) -> management type, website,
//     record label, confidence — NOT contactName/contactEmail, which stay
//     exclusively owned by Matthew's own "My Notes" form fields of the same
//     name (see the merge below for why)
//   - Music-news RSS (Pitchfork/Stereogum) -> recent coverage mentions
//   - Ticketmaster Discovery API -> confirmed on-sale tour dates
//   - JamBase Data API -> a second, independent confirmed-tour source
//
// All of the above (except the Deezer release window) mirror aggregate.js's
// Leads enrichment exactly (same scrapers, same field names, same social/
// website merge priority) so a My Artists entry and a Lead render
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
const { findArtist: findDeezerArtist, scrapeDeezerNewReleases } = require('./src/scrapers/deezer-scraper');
const { scrapeSetlistFMTourHistory } = require('./src/scrapers/setlistfm-scraper');
const { getArtistProfile } = require('./src/scrapers/audiodb-scraper');
const { getPrimaryGenre } = require('./src/musicbrainz');
const { checkArtistInRecentNews } = require('./src/scrapers/rss-scraper');
const { getTicketmasterEvents } = require('./src/scrapers/ticketmaster-scraper');
const { getJamBaseEvents } = require('./src/scrapers/jambase-scraper');
const { getWikidataSocialLinks } = require('./src/scrapers/wikidata-scraper');
const { researchArtistContact, saveCache: saveContactCache } = require('./src/scrapers/contact-research');
const { computeIsCurrentlyTouring } = require('./src/aggregate');

const MY_ARTISTS_PATH = path.join(__dirname, 'data', 'my-artists.json');
const TOUR_MONTHS_BACK = 18;
// Wider than aggregate.js's 60-day funnel window — Leads uses 60 days
// because it's filtering a firehose of raw discovered candidates down to
// "did something happen recently enough to matter"; My Artists is already a
// small, hand-curated roster with no funnel, so there's no reason to miss a
// release just because it's 61-120 days old.
const DEEZER_RELEASE_WINDOW_DAYS = 120;
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

  // A SEPARATE Deezer call from the one above, deliberately — findArtist's
  // response has no release data in it at all (it's an artist-lookup
  // endpoint, not a release endpoint), so getting recentReleases requires
  // scrapeDeezerNewReleases specifically, which internally re-resolves the
  // artist and then fetches /artist/{id}/albums. That's one redundant Deezer
  // search call per artist, but it means an artist who simply has no release
  // in the window still gets their image/id from the call above rather than
  // silently losing it — scrapeDeezerNewReleases returns nothing at all for
  // an artist with zero releases in DEEZER_RELEASE_WINDOW_DAYS, so it can't
  // be relied on for image/id the way findArtist can.
  let recentReleases = [];
  try {
    const [releaseRecord] = await scrapeDeezerNewReleases([name], DEEZER_RELEASE_WINDOW_DAYS);
    recentReleases = releaseRecord?.recentReleases ?? [];
  } catch (err) {
    logger.warn(`Enrich: Deezer release lookup failed for "${name}" (${err.message}).`);
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
    audiodb = { bio: null, genre: null, imageUrl: null, websiteUrl: null, socialLinks: {} };
  }

  // Wikidata — primary social-link source, same as aggregate.js.
  let wikidata;
  try {
    wikidata = await getWikidataSocialLinks(name);
  } catch (err) {
    logger.warn(`Enrich: Wikidata lookup failed for "${name}" (${err.message}).`);
    wikidata = { instagram: null, twitter: null, youtube: null, facebook: null, tiktok: null };
  }

  // Wikipedia/web research — management type, website, record label,
  // confidence. Deliberately NOT contactName/contactEmail: those field names
  // are already owned by Matthew's own "My Notes" form fields on a My
  // Artists entry (his personal note on who to contact), a completely
  // different concept from this pipeline's automated guess at management
  // contact info. Writing this call's contactName/contactEmail onto the
  // entry would silently overwrite Matthew's own notes with a bot's guess
  // (or null) on every re-run — the exact class of bug the sync fix earlier
  // today exists to prevent, just self-inflicted instead of sync-inflicted.
  let contact;
  try {
    contact = await researchArtistContact(name, deezerId);
  } catch (err) {
    logger.warn(`Enrich: contact research failed for "${name}" (${err.message}).`);
    contact = {
      managementType: 'unknown',
      contactSource: 'none',
      websiteUrl: null,
      socialLinks: { instagram: null, twitter: null, tiktok: null, youtube: null, facebook: null },
      confidence: 'low',
      label: null,
    };
  }

  // Merge priority matches aggregate.js exactly: Wikidata -> Wikipedia
  // (contact-research) -> TheAudioDB, first non-null wins per platform.
  const cSocials = contact.socialLinks || {};
  const aSocials = audiodb.socialLinks || {};
  const socialLinks = {
    instagram: wikidata.instagram ?? cSocials.instagram ?? aSocials.instagram ?? null,
    twitter: wikidata.twitter ?? cSocials.twitter ?? aSocials.twitter ?? null,
    tiktok: wikidata.tiktok ?? cSocials.tiktok ?? null,
    youtube: wikidata.youtube ?? cSocials.youtube ?? null,
    facebook: wikidata.facebook ?? cSocials.facebook ?? aSocials.facebook ?? null,
  };
  const websiteUrl = contact.websiteUrl ?? audiodb.websiteUrl ?? null;

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
    recentReleases, // {name, imageUrl, releaseDate, releaseType}[], newest-first; display-only
    socialLinks, // Wikidata -> Wikipedia -> TheAudioDB, first non-null wins per platform
    websiteUrl, // contact-research first, TheAudioDB gap-fill
    managementType: contact.managementType,
    contactConfidence: contact.confidence ?? 'low',
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
      `releases=${recentReleases.length}, links=${websiteUrl || Object.values(socialLinks).some(Boolean) ? 'Y' : 'N'}, ` +
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
  let releaseHits = 0;
  let linksHits = 0;
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
    if (enriched.recentReleases.length > 0) releaseHits += 1;
    if (enriched.websiteUrl || Object.values(enriched.socialLinks).some(Boolean)) linksHits += 1;
    if (enriched.newsArticles.length > 0) newsHits += 1;
    if (enriched.hasUpcomingEvents) ticketmasterHits += 1;
    if (enriched.hasJamBaseEvents) jambaseHits += 1;
    if (enriched.isCurrentlyTouring) touringHits += 1;
  }

  const nextArtists = data.artists.map((a) => byName.get(a.name) || a);
  saveMyArtists({ updatedAt: new Date().toISOString(), artists: nextArtists });
  saveContactCache(); // persist any newly-researched contacts, same as aggregate.js

  logger.count('Enriched with image', imageHits);
  logger.count('Enriched with genre', genreHits);
  logger.count('Enriched with bio', bioHits);
  logger.count('Enriched with tour history', tourHits);
  logger.count('Enriched with recent releases', releaseHits);
  logger.count('Enriched with website/social links', linksHits);
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
