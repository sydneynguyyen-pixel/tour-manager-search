// THROWAWAY test harness — exercises the whole pipeline EXCEPT Spotify.
//
// Goal: validate Setlist.fm (tour history + venue capacity via Wikipedia),
// MusicBrainz genres, genre-mapper tiering, and contact-research end-to-end
// against the real seed list, without touching Spotify's quota-limited endpoints.
//
// It fabricates a minimal "release" object per seed artist (no real Spotify data)
// and feeds it through scrapeSetlistFMTourHistory -> aggregateArtistData -> scoreArtist.
// Results are written to data/test-non-spotify-results.json (does NOT touch leads.json).
//
// Run: node src/test-non-spotify-pipeline.js   (takes several minutes; throttled)

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const logger = require('./utils/logger');
const config = require('../config.json');
const { scrapeSetlistFMTourHistory } = require('./scrapers/setlistfm-scraper');
const { aggregateArtistData } = require('./aggregate');
const { scoreArtist } = require('./score');
const venueScraper = require('./scrapers/venue-scraper');
const contactResearch = require('./scrapers/contact-research');

const OUT_PATH = path.join(__dirname, '..', 'data', 'test-non-spotify-results.json');
const TOUR_MONTHS_BACK = 18;

// --- capture rate-limit warnings by wrapping the shared logger -----------------
// All modules share this one logger object, so wrapping its methods here counts
// 429/backoff/rate-limit warnings across every source.
const rateLimitHits = { wikipedia: 0, setlistfm: 0, musicbrainz: 0, other: 0 };
for (const level of ['warn', 'error']) {
  const orig = logger[level];
  logger[level] = (...args) => {
    const msg = args.map(String).join(' ');
    if (/429|rate.?limit|backing off|retry-after/i.test(msg)) {
      if (/wikipedia/i.test(msg)) rateLimitHits.wikipedia += 1;
      else if (/setlist/i.test(msg)) rateLimitHits.setlistfm += 1;
      else if (/musicbrainz/i.test(msg)) rateLimitHits.musicbrainz += 1;
      else rateLimitHits.other += 1;
    }
    return orig(...args);
  };
}

// Snapshot cache-stat counters so we can compute per-artist deltas.
function venueSnap() {
  const s = venueScraper.getCacheStats();
  return { cached: s.cached, fresh: s.fresh, found: s.found, missed: s.missed, errored: s.errored };
}
function contactSnap() {
  const s = contactResearch.getCacheStats();
  return { cached: s.cached, fresh: s.fresh, errored: s.errored };
}
function delta(after, before) {
  const d = {};
  for (const k of Object.keys(after)) d[k] = after[k] - before[k];
  return d;
}

async function main() {
  const seeds = config.seedArtists || [];
  logger.info(`Non-Spotify pipeline test: ${seeds.length} seed artists (Spotify skipped).`);

  const rows = [];

  for (let i = 0; i < seeds.length; i += 1) {
    const name = seeds[i];
    logger.info(`\n=== [${i + 1}/${seeds.length}] ${name} ===`);

    // Minimal fabricated "release" — no real Spotify data, just the input shape
    // aggregate.js expects (it keys off .artist; the rest is intentionally null).
    const release = { artist: name, releaseDate: null, releaseName: null, imageUrl: null };

    const errors = [];
    const vBefore = venueSnap();
    const cBefore = contactSnap();

    // Stage — Setlist.fm tour history (+ venue capacity via Wikipedia).
    let tourRecs = [];
    try {
      tourRecs = await scrapeSetlistFMTourHistory([release], TOUR_MONTHS_BACK);
    } catch (err) {
      errors.push(`setlistfm: ${err.response?.status ?? err.message}`);
    }
    const tour = tourRecs[0] || null;
    const foundInSetlistfm = !!(tour && tour.mbid);

    // Stage — aggregate: MusicBrainz genres -> genre-mapper -> contact-research.
    // Always produces exactly one record (the fabricated release is always present),
    // even when the artist wasn't found on Setlist.fm (genres fall back to neutral).
    let agg = null;
    try {
      const aggregated = await aggregateArtistData([release], tourRecs, config);
      agg = aggregated[0] || null;
    } catch (err) {
      errors.push(`aggregate: ${err.response?.status ?? err.message}`);
    }

    // Stage — scoring. releaseDate is null (Spotify skipped) so the likelihood
    // dimension degrades to 0 ("no release data") gracefully; the rest compute.
    let scored = null;
    if (agg) {
      try {
        scored = scoreArtist(agg, config);
      } catch (err) {
        errors.push(`score: ${err.response?.status ?? err.message}`);
      }
    }

    const vAfter = venueSnap();
    const cAfter = contactSnap();

    rows.push({
      seed: name,
      foundInSetlistfm,
      setlistfmName: tour?.artist ?? null,
      mbid: tour?.mbid ?? null,
      tour: tour
        ? {
            tourCount: tour.tourCount,
            setlistCount: tour.setlistCount,
            venuesTotal: tour.venuesTotal,
            venuesWithCapacity: tour.venuesWithCapacity,
            avgVenueSize: tour.avgVenueSize,
            minVenueSize: tour.minVenueSize,
            maxVenueSize: tour.maxVenueSize,
            countriesToured: tour.countriesToured,
            lastTourDate: tour.lastTourDate,
            topVenues: tour.topVenues,
          }
        : null,
      venueCacheDelta: delta(vAfter, vBefore),
      genres: agg?.genres ?? [],
      genreTier: agg?.genreTier ?? null,
      genreDecimalTier: agg?.genreDecimalTier ?? null,
      genreMultiplier: agg?.genreMultiplier ?? null,
      contact: agg
        ? {
            managementType: agg.managementType,
            contactEmail: agg.contactEmail,
            contactSource: agg.contactSource,
            websiteUrl: agg.websiteUrl,
            label: agg.label,
            socialLinks: agg.socialLinks,
            confidence: agg.contactConfidence,
          }
        : null,
      contactCacheDelta: delta(cAfter, cBefore),
      imageUrl: agg?.imageUrl ?? null, // expected null this run (Spotify skipped)
      score: scored
        ? { baseScore: scored.baseScore, finalScore: scored.finalScore, breakdown: scored.scoring }
        : null,
      errors,
    });
  }

  // --- summary stats -----------------------------------------------------------
  const total = rows.length;
  const socialCount = (r) =>
    r.contact && r.contact.socialLinks
      ? Object.values(r.contact.socialLinks).filter(Boolean).length
      : 0;

  const foundSetlist = rows.filter((r) => r.foundInSetlistfm).length;
  const withGenres = rows.filter((r) => (r.genres || []).length > 0).length;
  const withVenueCap = rows.filter((r) => r.tour && r.tour.venuesWithCapacity > 0).length;
  const withEmail = rows.filter((r) => r.contact && r.contact.contactEmail).length;
  const withSocial = rows.filter((r) => socialCount(r) > 0).length;
  const withImage = rows.filter((r) => r.imageUrl).length;
  const withErrors = rows.filter((r) => r.errors.length > 0);

  const vStats = venueScraper.getCacheStats();
  const cStats = contactResearch.getCacheStats();
  const venueLookups = vStats.cached + vStats.fresh;
  const venueCacheHitRate = venueLookups ? (vStats.cached / venueLookups) : 0;

  const summary = {
    generatedAt: new Date().toISOString(),
    totalSeeds: total,
    foundInSetlistfm: `${foundSetlist}/${total}`,
    withGenreData: `${withGenres}/${total}`,
    withVenueCapacityData: `${withVenueCap}/${total}`,
    withContactEmail: `${withEmail}/${total}`,
    withAtLeastOneSocialLink: `${withSocial}/${total}`,
    withImageUrl: `${withImage}/${total} (expected 0 — Spotify skipped)`,
    venueCache: {
      totalLookups: venueLookups,
      cacheHits: vStats.cached,
      freshFetches: vStats.fresh,
      cacheHitRate: `${(venueCacheHitRate * 100).toFixed(1)}%`,
      found: vStats.found,
      missed: vStats.missed,
      errored: vStats.errored,
    },
    contactCache: {
      cacheHits: cStats.cached,
      freshFetches: cStats.fresh,
      errored: cStats.errored,
    },
    rateLimitHits,
    artistsWithErrors: withErrors.map((r) => ({ seed: r.seed, errors: r.errors })),
  };

  fs.writeFileSync(OUT_PATH, `${JSON.stringify({ summary, artists: rows }, null, 2)}\n`);

  // --- console report ----------------------------------------------------------
  logger.info('\n\n========== PER-ARTIST RESULTS ==========');
  for (const r of rows) {
    const g = (r.genres || []).map((x) => x.name).slice(0, 3).join(', ') || 'none';
    const social = r.contact ? Object.entries(r.contact.socialLinks || {}).filter(([, v]) => v).map(([k]) => k).join('/') || 'none' : 'none';
    logger.info(
      `${r.seed}${r.setlistfmName && r.setlistfmName !== r.seed ? ` (→ ${r.setlistfmName})` : ''}: ` +
        `slfm=${r.foundInSetlistfm ? 'Y' : 'N'} mbid=${r.mbid ? 'Y' : 'N'} | ` +
        (r.tour
          ? `tours=${r.tour.tourCount} shows=${r.tour.setlistCount} venues=${r.tour.venuesWithCapacity}/${r.tour.venuesTotal} avg=${r.tour.avgVenueSize} | `
          : `no tour data | `) +
        `genre=[${g}] t${r.genreTier ?? '?'}(x${r.genreMultiplier ?? '?'}) | ` +
        `mgmt=${r.contact?.managementType ?? '?'} email=${r.contact?.contactEmail ?? '—'} social=${social} conf=${r.contact?.confidence ?? '?'} | ` +
        `score=${r.score ? r.score.finalScore : '—'}` +
        (r.errors.length ? ` | ERRORS: ${r.errors.join('; ')}` : '')
    );
  }

  logger.info('\n========== SUMMARY ==========');
  logger.info(JSON.stringify(summary, null, 2));
  logger.success(`\n✓ Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  logger.error('Test harness failed:', err.response?.status ?? '', err.stack ?? err.message);
  process.exit(1);
});
