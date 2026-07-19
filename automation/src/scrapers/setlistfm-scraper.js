// Setlist.fm scraper: for each artist, resolve their MusicBrainz id and
// aggregate recent tour history (show count, geographic spread, dates).
//
// IMPORTANT — venue capacity is NOT available from Setlist.fm. The venue object
// is only { id, name, city, url }; there is no capacity field. So avg/min/max
// venue size come back as 0 here (the code still reads venue.capacity defensively
// in case that ever changes). A separate venue-capacity source is needed before
// the venueMin/venueMax scoring in config.json can work.
//
// Other Setlist.fm specifics handled below:
//   - eventDate is formatted dd-MM-yyyy (not ISO).
//   - The API rate-limits hard (~1 req/sec) and 429s readily -> serial throttle.
//   - An artist with no setlists returns HTTP 404 (not an empty 200).
//   - Results are paginated (20/page) newest-first -> early-stop past the cutoff.

const { setlistfm } = require('../auth');
const logger = require('../utils/logger');
const { getVenueCapacity, saveCache, getCacheStats } = require('./venue-scraper');

const SETLISTFM_MIN_INTERVAL_MS = 1200; // stay under ~1 req/sec
const MAX_PAGES = 15; // safety cap; early-stop usually ends much sooner
const MAX_429_RETRIES = 3;

// --- serial throttle: one request at a time, spaced by MIN_INTERVAL_MS --------
let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, SETLISTFM_MIN_INTERVAL_MS));
  queue = result.then(gap, gap); // advance queue on success or failure
  return result;
}

// GET a Setlist.fm path (throttled). Retries on 429 within the same slot so we
// never re-enter the queue (which would deadlock). Rethrows other errors.
function slfmGet(path, params, label) {
  return schedule(async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await setlistfm.get(path, { params });
        return res.data;
      } catch (err) {
        const status = err.response?.status;
        if (status === 429 && attempt < MAX_429_RETRIES) {
          const waitMs = (Number(err.response.headers?.['retry-after']) || 2) * 1000;
          logger.warn(`Setlist.fm 429 on ${label}; waiting ${waitMs}ms (retry ${attempt + 1}/${MAX_429_RETRIES})...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
  });
}

// Parse Setlist.fm's dd-MM-yyyy eventDate into a UTC Date, or null.
function parseEventDate(str) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(str || '');
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthsAgoMs(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

// Find an artist on Setlist.fm by name. Returns the top match ({mbid,name,...})
// or null if none / 404.
async function findArtist(name) {
  try {
    const data = await slfmGet('/search/artists', { artistName: name, sort: 'relevance' }, `search "${name}"`);
    return data.artist?.[0] ?? null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// Fetch setlists for an mbid whose eventDate is on/after cutoffMs. Paginated,
// newest-first, early-stops once a page reaches shows older than the cutoff.
async function fetchSetlistsInWindow(mbid, cutoffMs, name) {
  const shows = [];
  for (let p = 1; p <= MAX_PAGES; p += 1) {
    let data;
    try {
      data = await slfmGet(`/artist/${mbid}/setlists`, { p }, `setlists "${name}" p${p}`);
    } catch (err) {
      if (err.response?.status === 404) break; // no (more) setlists
      throw err;
    }
    const items = data.setlist || [];
    let reachedOld = false;
    for (const sl of items) {
      const d = parseEventDate(sl.eventDate);
      if (!d) continue;
      if (d.getTime() >= cutoffMs) shows.push(sl);
      else reachedOld = true; // newest-first: the rest are older too
    }
    const totalPages = Math.ceil((data.total || 0) / (data.itemsPerPage || 20));
    if (reachedOld || items.length === 0 || p >= totalPages) break;
  }
  return shows;
}

// Aggregate a set of setlists into the normalized tour-history record. Async
// because venue capacities are looked up from Wikipedia (via venue-scraper).
async function aggregate(name, mbid, shows) {
  const countries = new Set();
  const tourNames = new Set();
  let lastTs = null;

  for (const sl of shows) {
    const country = sl.venue?.city?.country?.name;
    if (country) countries.add(country);
    if (sl.tour?.name) tourNames.add(sl.tour.name);
    const d = parseEventDate(sl.eventDate);
    if (d && (lastTs === null || d.getTime() > lastTs)) lastTs = d.getTime();
  }

  // Capture each distinct venue's city/country (first occurrence) so the top
  // venues can be labeled in the dashboard.
  const venueMeta = new Map();
  for (const sl of shows) {
    const vn = sl.venue?.name;
    if (vn && !venueMeta.has(vn)) {
      venueMeta.set(vn, {
        city: sl.venue?.city?.name ?? null,
        country: sl.venue?.city?.country?.name ?? null,
      });
    }
  }

  // Look up capacity once per unique venue (Setlist.fm has none). avg/min/max
  // are computed across distinct venues that resolved a capacity.
  const venueNames = [...venueMeta.keys()];
  const sizedVenues = []; // { name, capacity, city, country }
  for (const vn of venueNames) {
    const cap = await getVenueCapacity(vn);
    if (Number.isFinite(cap) && cap > 0) sizedVenues.push({ name: vn, capacity: cap, ...venueMeta.get(vn) });
    else logger.warn(`No Wikipedia capacity for venue "${vn}" — excluded from venue-size stats.`);
  }

  const capacities = sizedVenues.map((v) => v.capacity);
  const avg = capacities.length
    ? Math.round(capacities.reduce((a, b) => a + b, 0) / capacities.length)
    : 0;
  // The 3 biggest venues played (by capacity), newest data wins ties by order.
  const topVenues = [...sizedVenues].sort((a, b) => b.capacity - a.capacity).slice(0, 3);

  return {
    artist: name,
    mbid,
    // Distinct named tours if Setlist.fm has tour tags; otherwise falls back to
    // the show count (tour tagging is sparse, so setlistCount is more reliable).
    tourCount: tourNames.size > 0 ? tourNames.size : shows.length,
    avgVenueSize: avg,
    minVenueSize: capacities.length ? Math.min(...capacities) : 0,
    maxVenueSize: capacities.length ? Math.max(...capacities) : 0,
    topVenues,
    venuesTotal: venueNames.length,
    venuesWithCapacity: capacities.length,
    countriesToured: countries.size,
    lastTourDate: lastTs ? new Date(lastTs).toISOString().slice(0, 10) : null,
    countryList: [...countries].sort(),
    setlistCount: shows.length,
  };
}

// For each input artist (name string or object with `.artist`), fetch and
// aggregate tour history over the last `monthsBack` months. De-dupes by name.
// Skips (omits) artists not found on Setlist.fm; artists found with no shows
// get a zero-count record.
async function scrapeSetlistFMTourHistory(artists, monthsBack = 18) {
  if (!Array.isArray(artists) || artists.length === 0) {
    logger.warn('scrapeSetlistFMTourHistory: no artists provided.');
    return [];
  }

  // Unique artist names, preserving first-seen order.
  const names = [];
  const seen = new Set();
  for (const item of artists) {
    const name = typeof item === 'string' ? item : item?.artist;
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
  }

  const cutoffMs = monthsAgoMs(monthsBack);
  const results = [];

  for (const name of names) {
    let match;
    try {
      match = await findArtist(name);
    } catch (err) {
      logger.error(`Setlist.fm search failed for "${name}"; skipping. (${err.response?.status ?? err.message})`);
      continue;
    }
    if (!match?.mbid) {
      logger.warn(`Setlist.fm: artist not found for "${name}"; skipping.`);
      continue;
    }

    let shows;
    try {
      shows = await fetchSetlistsInWindow(match.mbid, cutoffMs, match.name);
    } catch (err) {
      logger.error(`Setlist.fm setlists failed for "${match.name}"; skipping. (${err.response?.status ?? err.message})`);
      continue;
    }

    const record = await aggregate(match.name, match.mbid, shows);
    logger.info(
      `Setlist.fm: "${record.artist}" — ${record.setlistCount} show(s), ` +
        `${record.countriesToured} countr${record.countriesToured === 1 ? 'y' : 'ies'} in last ${monthsBack}mo` +
        (record.lastTourDate ? `, last ${record.lastTourDate}` : '') +
        `, avgVenue ${record.avgVenueSize} (${record.venuesWithCapacity}/${record.venuesTotal} venues sized)`
    );
    results.push(record);
  }

  // Persist any newly-looked-up venue capacities and report cache activity.
  saveCache();
  const cs = getCacheStats();
  logger.info(`Venue cache: ${cs.cached} cached, ${cs.fresh} fresh (${cs.found} found, ${cs.missed} missing, ${cs.errored} errored); ${cs.size} total entries.`);
  logger.count('Setlist.fm tour-history records', results.length);
  return results;
}

module.exports = { scrapeSetlistFMTourHistory, parseEventDate };
