// Discovery scraper — turns the My Artists roster from "scored directly" into
// discovery seeds. Uses Last.fm's artist.getsimilar endpoint to surface NEW
// candidate artists related to artists Matthew already knows, instead of
// hand-typing another batch of seed names into config.json.
//
// Requires LASTFM_API_KEY (same key the lastfm-scraper enrichment stage uses).
// Without a key, resolves to an empty candidate list (pipeline continues on
// the static seedArtists as a fallback — see run.js).

require('dotenv').config({ quiet: true });
const axios = require('axios');
const logger = require('../utils/logger');
const { normalizeName } = require('../aggregate');
const { loadExcludeSet } = require('../my-artists');

const LASTFM_BASE = 'http://ws.audioscrobbler.com/2.0/';
const MIN_INTERVAL_MS = 350; // ~2–3 req/sec, matches lastfm-scraper's throttle

const lastfm = axios.create({ baseURL: LASTFM_BASE, timeout: 15_000 });

let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

// GET artist.getsimilar for one seed. Always resolves (never throws); returns
// [] on a missing key, a miss, or any error, so one bad seed doesn't kill the
// batch.
async function getSimilarArtists(seedArtist, limit, apiKey) {
  return schedule(async () => {
    let data;
    try {
      const res = await lastfm.get('', {
        params: {
          method: 'artist.getsimilar',
          artist: seedArtist,
          api_key: apiKey,
          limit,
          format: 'json',
          autocorrect: 1,
        },
      });
      data = res.data;
    } catch (err) {
      logger.warn(
        `Last.fm getsimilar: lookup failed for "${seedArtist}" (${err.response?.status ?? err.message}); skipping.`
      );
      return [];
    }

    if (!data || data.error || !data.similarartists) {
      logger.info(`Last.fm getsimilar: no results for "${seedArtist}"${data?.message ? ` (${data.message})` : ''}.`);
      return [];
    }

    const raw = data.similarartists.artist;
    const artists = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return artists.map((a) => String(a.name).trim()).filter(Boolean);
  });
}

// Discover new candidate artists related to `seedArtists` (the My Artists
// roster) via Last.fm's related-artist graph. Dedupes across all seeds' results
// and filters out anyone already in My Artists. Returns a plain string array of
// NEW candidate names.
async function discoverRelatedArtists(seedArtists, limitPerSeed = 5) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    logger.warn('Last.fm: LASTFM_API_KEY not set — skipping discovery (no candidates).');
    return [];
  }
  if (!Array.isArray(seedArtists) || seedArtists.length === 0) return [];

  const seen = new Map(); // normalized name -> original-cased name (first hit wins)
  for (const seed of seedArtists) {
    const similar = await getSimilarArtists(seed, limitPerSeed, apiKey);
    for (const name of similar) {
      const key = normalizeName(name);
      if (key && !seen.has(key)) seen.set(key, name);
    }
  }

  const discovered = [...seen.values()];

  // Can't discover someone Matthew already knows — reuse the same exclude set
  // the main pipeline filters leads against.
  const exclude = loadExcludeSet();
  const candidates = discovered.filter((name) => !exclude.has(normalizeName(name)));

  logger.count('Discovery: candidates found via Last.fm getsimilar', discovered.length);
  logger.count('Discovery: candidates filtered out (already in My Artists)', discovered.length - candidates.length);
  logger.count('Discovery: new candidates remaining', candidates.length);

  return candidates;
}

module.exports = { discoverRelatedArtists, getSimilarArtists };
