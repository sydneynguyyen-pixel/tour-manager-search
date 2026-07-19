// MusicBrainz genre source.
//
// Spotify's restricted client-credentials token does not return genres, so
// genre data comes from MusicBrainz instead — keyed by the `mbid` that
// Setlist.fm returns for each artist. MusicBrainz genres are community
// vote-weighted (each has a `count`), which we expose so scoring can favor
// the dominant genres.
//
// Constraints honored here:
//   - Anonymous rate limit is ~1 request/second -> serial throttle below.
//   - A descriptive User-Agent with contact info is REQUIRED (else HTTP 403).
//     Override the contact via the MUSICBRAINZ_CONTACT env var.

require('dotenv').config({ quiet: true });
const axios = require('axios');

const MB_BASE = 'https://musicbrainz.org/ws/2';
const CONTACT = process.env.MUSICBRAINZ_CONTACT || 'https://github.com/tour-manager-search';
const USER_AGENT = `tour-manager-search/1.0 ( ${CONTACT} )`;
const MIN_INTERVAL_MS = 1100; // stay just under 1 req/sec

const mb = axios.create({
  baseURL: MB_BASE,
  headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  timeout: 15_000,
});

// Serialize + space out requests so we never trip the MusicBrainz rate limit,
// even when callers fire off many lookups concurrently. Each scheduled task
// runs after the previous one settles, then the queue idles MIN_INTERVAL_MS
// before the next task starts.
let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap); // advance the queue on success or failure
  return result;
}

// Fetch genre tags for an artist by MusicBrainz id.
// Returns [{ name, count }] lowercased and sorted by count (desc). Empty array
// if mbid is falsy or the artist has no genres.
async function getArtistGenres(mbid) {
  if (!mbid) return [];
  return schedule(async () => {
    const res = await mb.get(`/artist/${mbid}`, { params: { inc: 'genres', fmt: 'json' } });
    return (res.data.genres || [])
      .map((g) => ({ name: String(g.name).toLowerCase(), count: g.count || 0 }))
      .sort((a, b) => b.count - a.count);
  });
}

// Convenience: the single highest-voted genre name, or null.
async function getPrimaryGenre(mbid) {
  const genres = await getArtistGenres(mbid);
  return genres[0]?.name ?? null;
}

module.exports = { getArtistGenres, getPrimaryGenre, USER_AGENT };
