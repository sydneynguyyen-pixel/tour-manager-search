// Deezer scraper — primary new-release detection (replaces Spotify's core role).
//
// Deezer's public API needs no auth. Two calls per seed artist:
//   1. GET /search/artist?q={name}    -> resolve the artist id (name-verified)
//   2. GET /artist/{id}/albums        -> release list (newest-first in practice;
//                                        we sort + filter to the lookback window)
//
// Returns one record per artist that has a release inside the window, in the
// shape the pipeline expects:
//   { artist, deezerId, releaseDate, releaseName, releaseType, imageUrl,
//     recentReleases: [{ name, imageUrl, releaseDate, releaseType }] }
//
// Artists with no recent release are skipped (the pipeline funnels on recent
// releases, same as before). Not found -> warn + skip; a network error is
// retried once, then the artist is skipped.

const axios = require('axios');
const logger = require('../utils/logger');
// Reuse the same name-verification the Setlist.fm scraper uses so a wrong
// relevance hit (e.g. a tribute/cover act) doesn't poison the pipeline.
const { nameSimilarity, NAME_MATCH_MIN } = require('./setlistfm-scraper');

const DEEZER_BASE = 'https://api.deezer.com';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 250; // 200–300ms between requests, per spec
const ALBUMS_LIMIT = 100; // one page of albums is plenty for a 60-day window
const TOP_N = 5; // relevance hits to scan when name-matching

const deezer = axios.create({ baseURL: DEEZER_BASE, timeout: 15_000 });

// Serial throttle: one request at a time, spaced by MIN_INTERVAL_MS, so even
// concurrent callers stay under Deezer's limits.
let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

// GET a Deezer path (throttled). Retries exactly once on a network/5xx error,
// then rethrows. Deezer returns 200 with an `error` body for some failures, so
// surface that as a thrown error too.
function deezerGet(path, params, label) {
  return schedule(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await deezer.get(path, { params });
        if (res.data && res.data.error) {
          throw new Error(`Deezer API error: ${res.data.error.message || JSON.stringify(res.data.error)}`);
        }
        return res.data;
      } catch (err) {
        if (attempt === 0) {
          logger.warn(`Deezer error on ${label} (${err.response?.status ?? err.message}); retrying once...`);
          continue;
        }
        throw err;
      }
    }
    return undefined; // unreachable
  });
}

// Parse Deezer's YYYY-MM-DD release_date to epoch ms, or null.
function releaseMs(dateStr) {
  if (!dateStr || dateStr === '0000-00-00') return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// Find an artist on Deezer by name, verifying the returned name against the
// query. Returns { id, name, picture } or null.
async function findArtist(name) {
  const data = await deezerGet('/search/artist', { q: name }, `search "${name}"`);
  const candidates = Array.isArray(data.data) ? data.data : [];
  if (candidates.length === 0) return null;

  let best = null;
  for (const cand of candidates.slice(0, TOP_N)) {
    const sim = nameSimilarity(name, cand.name);
    if (!best || sim > best.sim) best = { cand, sim };
    if (sim >= NAME_MATCH_MIN) return cand;
  }
  logger.warn(
    `Deezer: best match for "${name}" was "${best?.cand?.name ?? '(none)'}" ` +
      `(name similarity ${best ? best.sim.toFixed(2) : '0.00'} < ${NAME_MATCH_MIN}); skipping.`
  );
  return null;
}

// Normalize Deezer's record_type ("album" | "single" | "ep" | "compilation").
function normalizeType(recordType) {
  return recordType || 'album';
}

// Fetch + shape recent releases for one artist id, filtered to `cutoffMs`.
// Returns { representative, recentReleases } or null if nothing in the window.
async function fetchRecentReleases(artistId, cutoffMs, name) {
  const data = await deezerGet(`/artist/${artistId}/albums`, { limit: ALBUMS_LIMIT }, `albums "${name}"`);
  const albums = Array.isArray(data.data) ? data.data : [];

  const inWindow = albums
    .map((al) => ({
      name: al.title,
      imageUrl: al.cover_xl || al.cover_medium || al.cover || null,
      releaseDate: al.release_date || null,
      releaseType: normalizeType(al.record_type),
      ms: releaseMs(al.release_date),
    }))
    .filter((r) => r.ms != null && r.ms >= cutoffMs)
    .sort((a, b) => b.ms - a.ms); // newest first

  if (inWindow.length === 0) return null;

  const recentReleases = inWindow.slice(0, 5).map(({ ms, ...rest }) => rest);
  return { representative: inWindow[0], recentReleases };
}

// For each seed artist, return one record per artist with a release in the last
// `days` days. `seedArtists` may be strings or objects with `.artist`.
async function scrapeDeezerNewReleases(seedArtists, days = 60) {
  if (!Array.isArray(seedArtists) || seedArtists.length === 0) {
    logger.warn('scrapeDeezerNewReleases: no seed artists provided.');
    return [];
  }

  const cutoffMs = Date.now() - days * MS_PER_DAY;
  const results = [];
  let found = 0;

  for (const item of seedArtists) {
    const name = typeof item === 'string' ? item : item?.artist;
    if (!name) continue;

    let artist;
    try {
      artist = await findArtist(name);
    } catch (err) {
      logger.error(`Deezer search failed for "${name}" after retry; skipping. (${err.message})`);
      continue;
    }
    if (!artist) {
      logger.warn(`Deezer: artist not found for "${name}"; skipping.`);
      continue;
    }
    found += 1;

    let recent;
    try {
      recent = await fetchRecentReleases(artist.id, cutoffMs, artist.name);
    } catch (err) {
      logger.error(`Deezer albums failed for "${artist.name}" after retry; skipping. (${err.message})`);
      continue;
    }
    if (!recent) {
      logger.info(`Deezer: "${artist.name}" — no releases in last ${days}d; skipping.`);
      continue;
    }

    const rep = recent.representative;
    logger.info(
      `Deezer: "${artist.name}" — ${recent.recentReleases.length} release(s) in last ${days}d ` +
        `(latest "${rep.releaseName ?? rep.name}" ${rep.releaseDate}).`
    );

    results.push({
      artist: artist.name,
      deezerId: artist.id,
      releaseDate: rep.releaseDate,
      releaseName: rep.name,
      releaseType: rep.releaseType,
      imageUrl: artist.picture_xl || artist.picture_medium || artist.picture || null,
      recentReleases: recent.recentReleases,
    });
  }

  logger.info(`Deezer: ${found}/${seedArtists.length} seed(s) resolved; ${results.length} with a recent release.`);
  logger.count('Deezer artists with recent releases', results.length);
  return results;
}

// findArtist is also exported for callers that just need an artist's Deezer
// id/image without the recent-release filter (e.g. enrich-my-artists.js —
// Matthew's own roster isn't funneled on release recency).
module.exports = { scrapeDeezerNewReleases, findArtist };
