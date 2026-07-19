// Spotify scraper: for each seed artist, find the artist and collect their
// recent releases (albums + singles) within a lookback window.
//
// Notes on this app's Spotify token (client-credentials):
//   - It returns only the SIMPLIFIED artist object, so `followers` (and genres)
//     are NOT available and come back null here. Popularity/genres are filled
//     in later from other sources (MusicBrainz for genres, etc.).
//   - The /artists/{id}/albums endpoint DOES work and returns release metadata.
//   - Albums are NOT guaranteed newest-first, so we paginate and filter by date.

const { spotify } = require('../auth');
const logger = require('../utils/logger');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// This restricted app token rejects limit > 10 on /artists/{id}/albums with
// "Invalid limit" (the documented max is 50). So page size is capped at 10.
const ALBUM_PAGE_LIMIT = 10;
const MAX_ALBUM_PAGES = 5; // safety cap per group; early-stop usually ends sooner
const ALBUM_GROUPS = ['album', 'single']; // queried separately (each is newest-first)
const MARKET = 'US';
// Cap the 429 backoff. A Retry-After above this indicates quota exhaustion
// (Spotify returns multi-hour values), not a normal transient rate limit — we
// abort the stage rather than sleep for hours (previously it hung ~23h).
const MAX_BACKOFF_MS = 60_000;
// Per-artist cap on how many albums we examine, to bound API call volume for
// prolific artists (e.g. one artist had 15 releases and paginated heavily).
const MAX_ALBUMS_CHECKED = 20;

// Rough per-run counter of Spotify API calls (for quota awareness in logs).
let apiCallCount = 0;

// Thrown when a 429's Retry-After exceeds MAX_BACKOFF_MS (quota exhaustion).
class SpotifyQuotaError extends Error {
  constructor(retryAfterSec) {
    super(`Spotify quota exhausted (Retry-After ${retryAfterSec}s)`);
    this.name = 'SpotifyQuotaError';
    this.quotaExhausted = true;
    this.retryAfterSec = retryAfterSec;
  }
}

// Parse a Spotify release_date honoring its precision ("year" | "month" | "day")
// into a Date (UTC). Returns null for missing/invalid dates.
function parseReleaseDate(dateStr, precision) {
  if (!dateStr) return null;
  let iso;
  if (precision === 'year') iso = `${dateStr}-01-01`;
  else if (precision === 'month') iso = `${dateStr}-01`;
  else iso = dateStr;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Run `fn`; on failure retry exactly once. A 429 within MAX_BACKOFF_MS is slept
// off then retried; a 429 with a larger Retry-After throws SpotifyQuotaError so
// the caller can abort the stage instead of hanging.
async function retryOnce(fn, label) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    apiCallCount += 1;
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        const raw = Number(err.response.headers?.['retry-after']);
        const retryAfterMs = Number.isFinite(raw) && raw > 0 ? raw * 1000 : 1000;
        if (retryAfterMs > MAX_BACKOFF_MS) {
          throw new SpotifyQuotaError(Math.round(retryAfterMs / 1000));
        }
        if (attempt === 0) {
          logger.warn(`Spotify 429 on ${label}; waiting ${retryAfterMs}ms then retrying once...`);
          await new Promise((r) => setTimeout(r, retryAfterMs));
          continue;
        }
      } else if (attempt === 0) {
        logger.warn(`Spotify error on ${label} (${status ?? err.message}); retrying once...`);
        continue;
      }
      throw err; // out of retries (or non-retryable on the second attempt)
    }
  }
  return undefined; // unreachable
}

async function findArtist(name) {
  const res = await retryOnce(() => spotify.searchArtists(`"${name}"`, 1), `search "${name}"`);
  return res.artists?.items?.[0] ?? null;
}

// Fetch an artist's albums + singles, deduped by id, filtered to releases whose
// date is on/after `cutoffMs`. Each group is returned newest-first, so we stop
// paging a group as soon as we see a release older than the cutoff.
async function fetchRecentAlbums(artistId, cutoffMs) {
  const seen = new Set();
  const recent = [];
  let checked = 0; // albums examined across both groups (bounded by MAX_ALBUMS_CHECKED)

  for (const group of ALBUM_GROUPS) {
    if (checked >= MAX_ALBUMS_CHECKED) break;
    for (let page = 0; page < MAX_ALBUM_PAGES; page += 1) {
      const res = await retryOnce(
        () =>
          spotify.get(`/artists/${artistId}/albums`, {
            include_groups: group,
            limit: ALBUM_PAGE_LIMIT,
            offset: page * ALBUM_PAGE_LIMIT,
            market: MARKET,
          }),
        `albums ${artistId} ${group} page ${page}`
      );
      const items = res.items || [];
      let reachedOld = false;
      let hitCap = false;
      for (const alb of items) {
        if (checked >= MAX_ALBUMS_CHECKED) {
          hitCap = true;
          break;
        }
        checked += 1;
        const d = parseReleaseDate(alb.release_date, alb.release_date_precision);
        if (!d) continue;
        if (d.getTime() >= cutoffMs) {
          if (!seen.has(alb.id)) {
            seen.add(alb.id);
            recent.push(alb);
          }
        } else {
          reachedOld = true; // newest-first: everything after this is older too
        }
      }
      if (reachedOld || hitCap || items.length < ALBUM_PAGE_LIMIT) break;
    }
  }
  return recent;
}

// Fetch recent releases for each seed artist and return normalized records
// (one per release). `days` sets the lookback window (default 60).
async function scrapeSpotifyNewReleases(seedArtists, days = 60) {
  if (!Array.isArray(seedArtists) || seedArtists.length === 0) {
    logger.warn('scrapeSpotifyNewReleases: no seed artists provided.');
    return [];
  }

  const cutoffMs = Date.now() - days * MS_PER_DAY;
  const results = [];
  apiCallCount = 0;
  let quotaHit = false;
  let processed = 0;

  for (const seed of seedArtists) {
    let artist;
    try {
      artist = await findArtist(seed);
    } catch (err) {
      if (err.quotaExhausted) {
        quotaHit = err;
        break;
      }
      logger.error(`Spotify search failed for "${seed}" after retry; skipping. (${err.response?.status ?? err.message})`);
      continue;
    }
    if (!artist) {
      logger.warn(`Spotify: artist not found for "${seed}"; skipping.`);
      continue;
    }

    let albums;
    try {
      albums = await fetchRecentAlbums(artist.id, cutoffMs);
    } catch (err) {
      if (err.quotaExhausted) {
        quotaHit = err;
        break;
      }
      logger.error(`Spotify albums failed for "${artist.name}" after retry; skipping. (${err.response?.status ?? err.message})`);
      continue;
    }
    processed += 1;

    // followers is null on this restricted token; a later source can fill it.
    const followers = artist.followers?.total ?? null;
    // The artist's own photo (used as the card portrait), distinct from the
    // per-release album artwork captured in recentReleases below.
    const artistImageUrl = artist.images?.[0]?.url ?? null;
    logger.info(`Spotify: "${artist.name}" — ${albums.length} release(s) in last ${days}d`);

    // Up to 5 most-recent releases (newest first) for the dashboard's album-art
    // row. Each carries its OWN album artwork, separate from the artist photo.
    const recentReleases = [...albums]
      .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
      .slice(0, 5)
      .map((alb) => ({
        name: alb.name,
        imageUrl: alb.images?.[0]?.url ?? null,
        releaseDate: alb.release_date,
        releaseType: alb.album_type,
      }));

    for (const alb of albums) {
      results.push({
        artist: artist.name,
        spotifyId: artist.id,
        followers,
        releaseDate: alb.release_date,
        releaseName: alb.name,
        releaseType: alb.album_type, // "album" | "single" | "compilation"
        imageUrl: artistImageUrl, // artist photo (album art lives in recentReleases)
        recentReleases, // same artist-level array on every release row
        genres: [], // Spotify returns none on this token; MusicBrainz fills later
      });
    }
  }

  if (quotaHit) {
    const hrs = (quotaHit.retryAfterSec / 3600).toFixed(1);
    logger.warn(
      `Spotify quota exhausted (Retry-After ~${quotaHit.retryAfterSec}s / ${hrs}h) after ${processed} artist(s) — ` +
        'skipping remaining artists in this run. Pipeline continues with partial data.'
    );
  }
  logger.count('Spotify API calls (approx)', apiCallCount);
  logger.count('Spotify releases (normalized)', results.length);
  return results;
}

module.exports = { scrapeSpotifyNewReleases, parseReleaseDate, SpotifyQuotaError };
