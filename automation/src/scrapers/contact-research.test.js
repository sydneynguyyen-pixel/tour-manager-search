// Integration test for the contact-research scraper (Wikipedia + site scraping).
// Does NOT touch Spotify. Run with:  node src/scrapers/contact-research.test.js
// (from automation/)

const logger = require('../utils/logger');
const { researchArtistContact, getCacheStats, resetStats, saveCache } = require('./contact-research');

const VALID_TYPES = ['self-managed', 'indie-label', 'booking-agency', 'indie-booking', 'major-agency', 'major-label', 'unknown'];
const REQUIRED_KEYS = ['artist', 'managementType', 'contactName', 'contactEmail', 'contactSource', 'websiteUrl', 'confidence'];

let failures = 0;
function assert(cond, msg) {
  if (cond) logger.success(`PASS ${msg}`);
  else { failures += 1; logger.error(`FAIL ${msg}`); }
}

(async () => {
  resetStats();
  const artists = ['Wallows', 'Seven Lions', 'Swae Lee'];
  const results = [];

  for (const name of artists) {
    const r = await researchArtistContact(name, `fake-spotify-${name}`);
    results.push(r);
    assert(REQUIRED_KEYS.every((k) => k in r), `${name}: result has all required keys`);
    assert(VALID_TYPES.includes(r.managementType), `${name}: managementType is valid ("${r.managementType}")`);
    assert(['high', 'medium', 'low'].includes(r.confidence), `${name}: confidence is valid`);
  }

  // Classification signal: these established artists should resolve at least a
  // website or a label tier (i.e. not all "unknown").
  const classified = results.filter((r) => r.managementType !== 'unknown' || r.websiteUrl);
  assert(classified.length >= 1, 'at least one known artist classified beyond bare "unknown"');

  // Graceful failure on an unfindable artist.
  const fake = await researchArtistContact('Zzqx Nonexistent Artist 99187', null);
  assert(fake.managementType === 'unknown' && fake.confidence === 'low', 'unfindable artist -> unknown/low (no crash)');

  // Cache: a repeat lookup should be served from cache (no fresh fetch).
  const before = getCacheStats().fresh;
  await researchArtistContact('Wallows', 'fake-spotify-Wallows');
  const after = getCacheStats();
  assert(after.fresh === before, 'repeat lookup served from cache (no new fresh fetch)');
  assert(after.cached >= 1, 'cache hit counted');

  saveCache();

  logger.info('Sample output:');
  for (const r of results) {
    logger.info(
      `  ${r.artist}: ${r.managementType} (${r.confidence})` +
        `${r.label ? ` | label=${r.label}` : ''}${r.contactEmail ? ` | email=${r.contactEmail}` : ''}` +
        `${r.websiteUrl ? ` | site=${r.websiteUrl}` : ''} | src=${r.contactSource}`
    );
  }
  logger.info(`Cache: ${JSON.stringify(getCacheStats())}`);

  if (failures > 0) { logger.error(`${failures} check(s) failed.`); process.exit(1); }
  logger.success('contact-research checks passed.');
})().catch((err) => {
  logger.error('Test crashed:', err.response?.status ?? '', err.message);
  process.exit(1);
});
