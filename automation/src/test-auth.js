// Connectivity smoke test for both API clients.
// Run with:  node src/test-auth.js   (from the automation/ directory)
//
// Confirms that Spotify auth works and Setlist.fm accepts the API key,
// before any real scraping is built on top of them.

require('dotenv').config({ quiet: true });
const logger = require('./utils/logger');
const { spotify, setlistfm, assertEnv } = require('./auth');
const { getArtistGenres } = require('./musicbrainz');
const { blendGenresToTier } = require('./genre-mapper');

// Radiohead — a stable, well-known artist present in both catalogs.
const SPOTIFY_TEST_ARTIST_ID = '4Z8W4fKeB5YxbusRsdQVPb';
const TEST_ARTIST_NAME = 'Radiohead';

async function testSpotify() {
  logger.info('Spotify: requesting client-credentials token...');
  await spotify.getToken();
  logger.success('Spotify: token acquired.');

  const artist = await spotify.getArtist(SPOTIFY_TEST_ARTIST_ID);
  if (!artist || !artist.name) {
    throw new Error('Spotify returned an unexpected artist payload.');
  }
  // followers/genres/popularity are optional here — this app's client-credentials
  // token currently returns only the simplified artist object (no genres). We
  // confirm connectivity on the guaranteed fields and report the rest if present.
  const followers = artist.followers?.total;
  logger.success(
    `Spotify: fetched "${artist.name}" (id ${artist.id}) — ` +
      `followers: ${followers != null ? followers.toLocaleString() : 'n/a (restricted token)'}`
  );
  // Note: this app's client-credentials token returns only the simplified
  // artist object (no genres). Genre data comes from MusicBrainz instead.
}

async function testSetlistfm() {
  logger.info(`Setlist.fm: searching for "${TEST_ARTIST_NAME}"...`);
  const res = await setlistfm.get('/search/artists', {
    params: { artistName: TEST_ARTIST_NAME, sort: 'relevance' },
  });
  const artists = res.data.artist || [];
  logger.count('Setlist.fm artists matched', res.data.total ?? artists.length);
  if (!artists[0]) {
    throw new Error('Setlist.fm returned no artists for the test query.');
  }
  logger.success(`Setlist.fm: top match "${artists[0].name}" (mbid: ${artists[0].mbid})`);
  return artists[0].mbid; // feeds the MusicBrainz genre lookup
}

async function testGenres(mbid) {
  logger.info(`MusicBrainz: fetching genres for mbid ${mbid}...`);
  const genres = await getArtistGenres(mbid);
  logger.count('MusicBrainz genres', genres.length);
  if (genres.length === 0) {
    throw new Error('MusicBrainz returned no genres for the test artist.');
  }
  const top = genres.slice(0, 5).map((g) => `${g.name}(${g.count})`).join(', ');
  logger.success(`MusicBrainz: top genres — ${top}`);

  // Normalize the raw genres into a scoring tier via the genre-mapper.
  const blend = blendGenresToTier(genres);
  logger.success(
    `Genre tier: ${blend.tier} (weighted ${blend.decimalTier}) → multiplier ×${blend.multiplier}`
  );
}

(async () => {
  try {
    assertEnv();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  let ok = true;

  try {
    await testSpotify();
  } catch (err) {
    ok = false;
    logger.error('Spotify check failed:', err.response?.status ?? '', err.response?.data?.error ?? err.message);
  }

  let mbid = null;
  try {
    mbid = await testSetlistfm();
  } catch (err) {
    ok = false;
    logger.error('Setlist.fm check failed:', err.response?.status ?? '', err.response?.data ?? err.message);
  }

  if (mbid) {
    try {
      await testGenres(mbid);
    } catch (err) {
      ok = false;
      logger.error('MusicBrainz check failed:', err.response?.status ?? '', err.response?.data ?? err.message);
    }
  }

  if (ok) {
    logger.success('All connectivity checks passed.');
  } else {
    logger.error('One or more connectivity checks failed.');
    process.exit(1);
  }
})();
