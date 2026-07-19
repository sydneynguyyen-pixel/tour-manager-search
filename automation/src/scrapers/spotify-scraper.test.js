// Integration test for the Spotify scraper. Hits the live Spotify API using the
// seed artists in config.json.
// Run with:  node src/scrapers/spotify-scraper.test.js   (from automation/)

require('dotenv').config({ quiet: true });
const logger = require('../utils/logger');
const config = require('../../config.json');
const { scrapeSpotifyNewReleases, parseReleaseDate } = require('./spotify-scraper');

const DAYS = 60;
const EXPECTED_KEYS = [
  'artist', 'spotifyId', 'followers', 'releaseDate',
  'releaseName', 'releaseType', 'imageUrl', 'genres',
];

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    logger.success(`PASS ${msg}`);
  } else {
    failures += 1;
    logger.error(`FAIL ${msg}`);
  }
}

(async () => {
  const seeds = config.seedArtists || [];
  logger.info(`Spotify scraper test — seeds (${seeds.length}): ${seeds.join(', ')}`);
  assert(seeds.length > 0, 'config.json has seedArtists');

  const releases = await scrapeSpotifyNewReleases(seeds, DAYS);

  assert(Array.isArray(releases), 'scraper returns an array');
  assert(releases.length > 0, 'at least one release returned across all seeds');

  // Shape check.
  if (releases[0]) {
    const r = releases[0];
    assert(EXPECTED_KEYS.every((k) => k in r), 'release objects have all expected keys');
    assert(Array.isArray(r.genres), 'genres is an array (empty here; MusicBrainz fills later)');
    assert(typeof r.spotifyId === 'string' && r.spotifyId.length > 0, 'spotifyId is a non-empty string');
  }

  // Date filtering: every returned release must fall within the lookback window
  // (allow 2 days slack for year/month-precision dates and timezones).
  const cutoffMs = Date.now() - (DAYS + 2) * 24 * 60 * 60 * 1000;
  const allRecent = releases.every((r) => {
    const d = parseReleaseDate(
      r.releaseDate,
      r.releaseDate.length === 4 ? 'year' : r.releaseDate.length === 7 ? 'month' : 'day'
    );
    return d && d.getTime() >= cutoffMs;
  });
  assert(allRecent, `all returned releases fall within the last ${DAYS} days`);

  // Per-artist coverage — SOFT: real artists may legitimately have no release in
  // the window, so this is reported, not asserted per-artist.
  const perArtist = {};
  for (const r of releases) perArtist[r.artist] = (perArtist[r.artist] || 0) + 1;
  logger.info(`Releases per artist: ${JSON.stringify(perArtist)}`);
  const artistsWithRecent = Object.keys(perArtist).length;
  assert(artistsWithRecent >= 1, 'at least one seed artist has a release in the window');
  for (const seed of seeds) {
    const found = Object.keys(perArtist).some((a) => a.toLowerCase() === seed.toLowerCase());
    if (!found) logger.warn(`No release in last ${DAYS}d for seed "${seed}" (found but stale, or not matched).`);
  }

  // Sample output for manual review.
  logger.info('Sample output (up to 5):');
  releases.slice(0, 5).forEach((r, i) => {
    logger.info(
      `  [${i}] ${r.artist} | ${r.releaseDate} | ${r.releaseType} | "${r.releaseName}" | ` +
        `followers=${r.followers} | img=${r.imageUrl ? 'yes' : 'no'}`
    );
  });

  if (failures > 0) {
    logger.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  logger.success('Spotify scraper checks passed.');
})().catch((err) => {
  logger.error('Test crashed:', err.response?.status ?? '', err.response?.data ?? err.message);
  process.exit(1);
});
