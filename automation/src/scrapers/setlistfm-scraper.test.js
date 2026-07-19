// Integration test for the Setlist.fm scraper + Wikipedia venue-capacity lookup.
// Hits the live Setlist.fm and Wikipedia APIs.
// Run with:  node src/scrapers/setlistfm-scraper.test.js   (from automation/)

require('dotenv').config({ quiet: true });
const fs = require('fs');
const logger = require('../utils/logger');
const { scrapeSetlistFMTourHistory, parseEventDate } = require('./setlistfm-scraper');
const { getCacheStats, resetStats, loadCache, CACHE_PATH } = require('./venue-scraper');

const MONTHS = 18;
const TEST_ARTIST = 'Seven Lions';
const EXPECTED_KEYS = [
  'artist', 'mbid', 'tourCount', 'avgVenueSize', 'minVenueSize', 'maxVenueSize',
  'venuesTotal', 'venuesWithCapacity', 'countriesToured', 'lastTourDate',
  'countryList', 'setlistCount',
];

let failures = 0;
function assert(cond, msg) {
  if (cond) logger.success(`PASS ${msg}`);
  else { failures += 1; logger.error(`FAIL ${msg}`); }
}

(async () => {
  logger.info(`Setlist.fm + venue scraper test — artist: ${TEST_ARTIST}`);

  // --- Run 1: fresh lookups -------------------------------------------------
  resetStats();
  const records = await scrapeSetlistFMTourHistory([{ artist: TEST_ARTIST }], MONTHS);
  const run1 = getCacheStats();

  assert(Array.isArray(records) && records.length === 1, 'one record returned');
  const r = records[0];
  assert(EXPECTED_KEYS.every((k) => k in r), 'record has all expected keys (incl. venue fields)');
  assert(r.setlistCount > 0, 'venues/shows scraped from Setlist.fm');
  assert(r.venuesTotal > 0, 'unique venues collected');

  // Date filtering within window.
  const cutoffMs = (() => { const d = new Date(); d.setMonth(d.getMonth() - MONTHS); return d.getTime(); })();
  const last = r.lastTourDate
    ? parseEventDate(`${r.lastTourDate.slice(8, 10)}-${r.lastTourDate.slice(5, 7)}-${r.lastTourDate.slice(0, 4)}`)
    : null;
  assert(!!last && last.getTime() >= cutoffMs, `lastTourDate within last ${MONTHS}mo`);
  assert(r.countriesToured === r.countryList.length && r.countriesToured >= 1, 'country diversity captured');

  // Wikipedia lookups: at least some major venues should resolve a capacity.
  assert(run1.fresh > 0, 'run 1 performed fresh Wikipedia lookups');
  assert(r.venuesWithCapacity > 0, 'at least one venue resolved a capacity from Wikipedia');

  // avgVenueSize consistency: within [min, max] and > 0 when any capacity found.
  if (r.venuesWithCapacity > 0) {
    assert(r.avgVenueSize > 0, 'avgVenueSize computed (> 0)');
    assert(r.avgVenueSize >= r.minVenueSize && r.avgVenueSize <= r.maxVenueSize, 'avgVenueSize within [min, max]');
  }

  // Cache file persisted.
  assert(fs.existsSync(CACHE_PATH), 'venue-cache.json exists');
  const cacheContent = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  assert(Object.keys(cacheContent).length > 0, 'venue cache written with entries');

  // --- Run 2: should hit cache, not Wikipedia -------------------------------
  resetStats();
  await scrapeSetlistFMTourHistory([{ artist: TEST_ARTIST }], MONTHS);
  const run2 = getCacheStats();
  assert(run2.fresh === 0, 'run 2 made zero fresh Wikipedia lookups (served from cache)');
  assert(run2.cached > 0, 'run 2 served venues from cache');

  // --- Sample output --------------------------------------------------------
  logger.info(
    `Record: shows=${r.setlistCount}, tours=${r.tourCount}, countries=${r.countriesToured}, ` +
      `venues sized=${r.venuesWithCapacity}/${r.venuesTotal}, avg=${r.avgVenueSize}, ` +
      `min=${r.minVenueSize}, max=${r.maxVenueSize}, last=${r.lastTourDate}`
  );
  logger.info('Sample venue capacities from cache:');
  Object.entries(loadCache())
    .filter(([, cap]) => cap != null)
    .slice(0, 8)
    .forEach(([name, cap]) => logger.info(`  ${name} → ${cap}`));

  if (failures > 0) { logger.error(`${failures} check(s) failed.`); process.exit(1); }
  logger.success('Setlist.fm + venue scraper checks passed.');
})().catch((err) => {
  logger.error('Test crashed:', err.response?.status ?? '', err.response?.data ?? err.message);
  process.exit(1);
});
