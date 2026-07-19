// Venue capacity lookup via Wikipedia.
//
// Setlist.fm provides no venue capacity (see setlistfm-scraper.js), so we look
// it up from Wikipedia: search for the venue, fetch the article's lead section,
// and read the "Capacity" row out of the infobox.
//
// Real Wikipedia infoboxes render capacity as `<th>Capacity</th><td>9,525</td>`
// (NOT the `data-value="Capacity"` the task guessed), so we match the row by its
// header text and parse the first number out of the value cell.
//
// Results are cached to data/venue-cache.json (misses cached as null) so repeat
// runs don't re-hit Wikipedia. Requests are throttled to be respectful.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'venue-cache.json');
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
// Wikimedia's UA policy wants a descriptive agent with a contact; a generic one
// gets throttled/blocked. Override the contact via WIKIPEDIA_CONTACT.
const CONTACT = process.env.WIKIPEDIA_CONTACT || 'https://github.com/tour-manager-search';
const USER_AGENT = `tour-manager-search/1.0 ( ${CONTACT} )`;
// Wikipedia 429'd at 0.5s spacing, so we space requests further apart and add
// 429 backoff below. Second runs are served from cache, so this only affects
// the initial warm-up.
const MIN_INTERVAL_MS = 1000;
const MAX_429_RETRIES = 4;

// --- cache -------------------------------------------------------------------
let cache = null; // { [venueName]: number | null }
let dirty = false;
const stats = { cached: 0, fresh: 0, found: 0, missed: 0, errored: 0 };

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache() {
  if (!cache || !dirty) return;
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  dirty = false;
}

function getCacheStats() {
  return { ...stats, size: cache ? Object.keys(cache).length : 0 };
}

function resetStats() {
  stats.cached = 0;
  stats.fresh = 0;
  stats.found = 0;
  stats.missed = 0;
  stats.errored = 0;
}

// --- throttle: serial, spaced by MIN_INTERVAL_MS, with 429 backoff -----------
let queue = Promise.resolve();

async function attempt(params, label, tries) {
  try {
    const res = await axios.get(WIKI_API, {
      params,
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15_000,
    });
    return res.data;
  } catch (err) {
    if (err.response?.status === 429 && tries < MAX_429_RETRIES) {
      const retryAfter = Number(err.response.headers?.['retry-after']);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 1000 * 2 ** tries); // exponential backoff, capped
      logger.warn(`Wikipedia 429 on ${label}; backing off ${waitMs}ms (retry ${tries + 1}/${MAX_429_RETRIES})...`);
      await new Promise((r) => setTimeout(r, waitMs));
      return attempt(params, label, tries + 1); // recurse in-slot; no re-queue
    }
    throw err;
  }
}

function wikiGet(params, label) {
  const result = queue.then(() => attempt(params, label, 0));
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

// Extract the first plausible integer (e.g. "9,525" or "5000") from infobox text.
function parseCapacity(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/ /g, ' ');
  const m = cleaned.match(/\d{1,3}(?:,\d{3})+|\d{2,7}/); // comma-grouped first, else 2-7 digits
  if (!m) return null;
  const n = parseInt(m[0].replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchCapacityFromWikipedia(venueName) {
  const search = await wikiGet(
    { action: 'query', list: 'search', srsearch: venueName, format: 'json', srlimit: 1 },
    `search "${venueName}"`
  );
  const hit = search.query?.search?.[0];
  if (!hit) return null;

  const parsed = await wikiGet(
    { action: 'parse', page: hit.title, format: 'json', prop: 'text', section: 0, redirects: 1 },
    `parse "${hit.title}"`
  );
  const html = parsed.parse?.text?.['*'];
  if (!html) return null;

  const $ = cheerio.load(html);
  let capacity = null;
  $('.infobox tr').each((_, tr) => {
    if (capacity != null) return;
    const th = $(tr).find('th').first().text().trim();
    if (/^capacit/i.test(th)) {
      capacity = parseCapacity($(tr).find('td').first().text());
    }
  });
  return capacity;
}

// Look up a venue's capacity. Returns a number, or null if not found. Cached
// (including misses) in data/venue-cache.json. Call saveCache() to persist.
async function getVenueCapacity(venueName) {
  if (!venueName) return null;
  const c = loadCache();
  const key = String(venueName).trim();

  if (Object.prototype.hasOwnProperty.call(c, key)) {
    stats.cached += 1;
    return c[key];
  }

  stats.fresh += 1;
  let capacity;
  try {
    capacity = await fetchCapacityFromWikipedia(key);
  } catch (err) {
    // Transient failure (429/network/timeout): do NOT cache — otherwise a
    // temporary error becomes a permanent "miss". Leave it for the next run.
    logger.warn(`Venue lookup errored for "${key}": ${err.response?.status ?? err.message} (not cached; will retry)`);
    stats.errored += 1;
    return null;
  }

  // Lookup completed: cache the real outcome (a number, or a genuine miss).
  c[key] = capacity;
  dirty = true;
  if (capacity != null) stats.found += 1;
  else stats.missed += 1;
  return capacity;
}

module.exports = {
  getVenueCapacity,
  saveCache,
  loadCache,
  getCacheStats,
  resetStats,
  parseCapacity,
  CACHE_PATH,
};
