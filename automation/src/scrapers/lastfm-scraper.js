// Last.fm scraper — supplementary listener/scrobble signal + genre tag
// cross-check. Requires LASTFM_API_KEY. These fields are additive
// (lastfmListeners, lastfmTags) and do NOT yet feed scoring.
//
// Without a key the scraper degrades gracefully: it warns once and returns a
// null-filled profile for every artist (the pipeline continues).
//
// Tag cross-check: Last.fm's crowd tags are compared against the MusicBrainz
// genres for the same artist and the agreement/discrepancy is LOGGED only —
// MusicBrainz remains the source of truth for scoring.

require('dotenv').config({ quiet: true });
const axios = require('axios');
const logger = require('../utils/logger');

const LASTFM_BASE = 'http://ws.audioscrobbler.com/2.0/';
const MIN_INTERVAL_MS = 350; // ~2–3 req/sec
const MAX_TAGS = 8;

const lastfm = axios.create({ baseURL: LASTFM_BASE, timeout: 15_000 });

let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

const EMPTY_PROFILE = {
  found: false,
  lastfmListeners: null,
  lastfmPlaycount: null,
  lastfmTags: [],
  bio: null,
};

let warnedNoKey = false;

function toInt(x) {
  const n = Number.parseInt(x, 10);
  return Number.isFinite(n) ? n : null;
}

// Look up an artist's Last.fm profile. Always resolves (never throws); returns
// EMPTY_PROFILE on a missing key, a miss, or any error.
async function getLastFmProfile(artistName) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    if (!warnedNoKey) {
      logger.warn('Last.fm: LASTFM_API_KEY not set — skipping listener/tag enrichment (returning nulls).');
      warnedNoKey = true;
    }
    return { ...EMPTY_PROFILE };
  }
  if (!artistName) return { ...EMPTY_PROFILE };

  return schedule(async () => {
    let data;
    try {
      const res = await lastfm.get('', {
        params: { method: 'artist.getinfo', artist: artistName, api_key: apiKey, format: 'json', autocorrect: 1 },
      });
      data = res.data;
    } catch (err) {
      logger.warn(`Last.fm: lookup failed for "${artistName}" (${err.response?.status ?? err.message}); returning nulls.`);
      return { ...EMPTY_PROFILE };
    }

    if (!data || data.error || !data.artist) {
      logger.info(`Last.fm: no profile for "${artistName}"${data?.message ? ` (${data.message})` : ''}.`);
      return { ...EMPTY_PROFILE };
    }

    const a = data.artist;
    const tags = Array.isArray(a.tags?.tag) ? a.tags.tag : a.tags?.tag ? [a.tags.tag] : [];
    const profile = {
      found: true,
      lastfmListeners: toInt(a.stats?.listeners),
      lastfmPlaycount: toInt(a.stats?.playcount),
      lastfmTags: tags.map((t) => String(t.name).toLowerCase()).filter(Boolean).slice(0, MAX_TAGS),
      bio: a.bio?.summary ? String(a.bio.summary).replace(/<[^>]*>/g, '').trim() || null : null,
    };
    logger.info(
      `Last.fm: "${a.name}" — listeners=${profile.lastfmListeners ?? '—'}, ` +
        `plays=${profile.lastfmPlaycount ?? '—'}, tags=[${profile.lastfmTags.slice(0, 4).join(', ')}]`
    );
    return profile;
  });
}

// Compare Last.fm tags against MusicBrainz genre names for the same artist and
// LOG agreement/discrepancy. Does not return or override anything — MusicBrainz
// stays authoritative for scoring. `mbGenres` is [{ name }] (lowercased).
function logTagCrossCheck(artistName, lastfmTags, mbGenres) {
  const tags = (lastfmTags || []).map((t) => t.toLowerCase());
  const genres = (mbGenres || []).map((g) => g.name.toLowerCase());
  if (tags.length === 0 || genres.length === 0) return;
  const overlap = tags.filter((t) => genres.includes(t));
  if (overlap.length > 0) {
    logger.info(`Genre cross-check "${artistName}": agree on [${overlap.join(', ')}] (Last.fm ∩ MusicBrainz).`);
  } else {
    logger.info(
      `Genre cross-check "${artistName}": discrepancy — Last.fm [${tags.slice(0, 3).join(', ')}] ` +
        `vs MusicBrainz [${genres.slice(0, 3).join(', ')}] (not overriding).`
    );
  }
}

module.exports = { getLastFmProfile, logTagCrossCheck };
