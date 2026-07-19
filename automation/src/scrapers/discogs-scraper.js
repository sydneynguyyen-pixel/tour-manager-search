// Discogs scraper — lowest-priority, non-blocking discography cross-check. It
// confirms an artist is a real recording act with a release history (a
// confidence booster / cross-check), and reports discography depth. It never
// blocks the pipeline: any failure resolves to a null-filled result.
//
// Auth: DISCOGS_TOKEN is optional. Authenticated raises the rate limit to
// 60 req/min; unauthenticated is 25 req/min. Either way a serial throttle keeps
// us under the limit, and we back off further if the ratelimit-remaining header
// runs low. A descriptive User-Agent is REQUIRED by Discogs (else 403).

require('dotenv').config({ quiet: true });
const axios = require('axios');
const logger = require('../utils/logger');
const { nameSimilarity, NAME_MATCH_MIN } = require('./setlistfm-scraper');

const DISCOGS_BASE = 'https://api.discogs.com';
const USER_AGENT = 'tour-manager-search/1.0 (+https://github.com/tour-manager-search)';
const HAS_TOKEN = !!process.env.DISCOGS_TOKEN;
// 60/min authed -> ~1s spacing; 25/min unauthed -> ~2.5s spacing.
const MIN_INTERVAL_MS = HAS_TOKEN ? 1100 : 2500;
const TOP_N = 5;

const discogs = axios.create({
  baseURL: DISCOGS_BASE,
  timeout: 15_000,
  headers: {
    'User-Agent': USER_AGENT,
    ...(HAS_TOKEN ? { Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}` } : {}),
  },
});

let queue = Promise.resolve();
let extraBackoffMs = 0; // grows when the ratelimit-remaining header runs low
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS + extraBackoffMs));
  queue = result.then(gap, gap);
  return result;
}

const EMPTY = { found: false, discogsId: null, releaseCount: 0, discogsVerified: false };

// A single throttled GET. Reads the rate-limit headers to self-pace: if the
// remaining budget runs low, add temporary backoff before the next request.
async function discogsGet(path, params, label) {
  return schedule(async () => {
    const res = await discogs.get(path, { params });
    const remaining = Number(res.headers?.['x-discogs-ratelimit-remaining']);
    extraBackoffMs = Number.isFinite(remaining) && remaining <= 2 ? 5000 : 0;
    return res.data;
  }).catch((err) => {
    // 429: honor Retry-After if present; surface as a thrown error for the caller.
    const status = err.response?.status;
    if (status === 429) logger.warn(`Discogs 429 on ${label}; will skip this artist.`);
    throw err;
  });
}

// Cross-check one artist's discography on Discogs. Always resolves (never
// throws). `mbGenres` unused here; kept for a symmetric scraper signature.
async function getDiscogsReleases(artistName) {
  if (!artistName) return { ...EMPTY };

  // 1) Resolve the artist id (name-verified).
  let artist = null;
  try {
    const data = await discogsGet('/database/search', { q: artistName, type: 'artist' }, `search "${artistName}"`);
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const cand of results.slice(0, TOP_N)) {
      if (nameSimilarity(artistName, cand.title) >= NAME_MATCH_MIN) {
        artist = cand;
        break;
      }
    }
  } catch (err) {
    logger.warn(`Discogs: search failed for "${artistName}" (${err.response?.status ?? err.message}); skipping cross-check.`);
    return { ...EMPTY };
  }
  if (!artist) {
    logger.info(`Discogs: no confident artist match for "${artistName}".`);
    return { ...EMPTY };
  }

  // 2) Release-history depth (pagination.items gives the total without pulling
  //    every page).
  let releaseCount = 0;
  try {
    const rel = await discogsGet(`/artists/${artist.id}/releases`, { per_page: 1 }, `releases ${artist.id}`);
    releaseCount = Number(rel?.pagination?.items) || 0;
  } catch (err) {
    logger.warn(`Discogs: releases failed for "${artistName}" (${err.response?.status ?? err.message}); id found but depth unknown.`);
  }

  const verified = releaseCount > 0;
  logger.info(`Discogs: "${artistName}" — id=${artist.id}, releases=${releaseCount}, verified=${verified}.`);
  return { found: true, discogsId: artist.id, releaseCount, discogsVerified: verified };
}

module.exports = { getDiscogsReleases };
