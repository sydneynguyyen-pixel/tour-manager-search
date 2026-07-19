// Unit tests for seed-store operations. Runs against a throwaway temp config so
// it never touches the real config.json. No TTY / inquirer needed.
// Run with:  node src/cli/seed-store.test.js   (from automation/)

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../utils/logger');
const store = require('./seed-store');
const { seedGroups } = require('./seed-templates');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedtest-'));
const configPath = path.join(dir, 'config.json');
const logPath = path.join(dir, 'logs', 'seed-changes.log');
const opts = { configPath, logPath };

// Seed config with an unrelated key we expect to survive writes.
fs.writeFileSync(
  configPath,
  JSON.stringify({ seedArtists: ['d4vd', 'Seven Lions'], scoringThresholds: { minScore: 60 }, keep: 'me' }, null, 2)
);

let failures = 0;
function assert(cond, msg) {
  if (cond) logger.success(`PASS ${msg}`);
  else { failures += 1; logger.error(`FAIL ${msg}`); }
}

// --- add / normalize / dedupe ------------------------------------------------
let r = store.addSeed('  Tinashe  ', opts);
assert(r.ok && r.seeds.includes('Tinashe'), 'add trims whitespace and appends');

assert(store.addSeed('d4vd', opts).reason === 'duplicate', 'duplicate blocked (exact)');
assert(store.addSeed('D4VD', opts).reason === 'duplicate', 'duplicate blocked (case-insensitive)');
assert(store.addSeed('   ', opts).reason === 'empty', 'empty/whitespace name blocked');

store.addSeed('SZA', opts);
assert(store.listSeeds(opts).includes('SZA'), 'preserves stylized casing (SZA, not "Sza")');

// --- other config keys preserved --------------------------------------------
const cfg = store.loadConfig(configPath);
assert(cfg.keep === 'me' && cfg.scoringThresholds.minScore === 60, 'unrelated config keys preserved on write');

// --- remove ------------------------------------------------------------------
r = store.removeSeed('seven lions', opts);
assert(r.ok && !store.listSeeds(opts).some((s) => s.toLowerCase() === 'seven lions'), 'remove is case-insensitive');
assert(store.removeSeed('nobody', opts).reason === 'not-found', 'remove not-found reported');

// --- last-seed guard ---------------------------------------------------------
store.clearSeeds(opts);
store.addSeed('OnlyOne', opts);
assert(store.removeSeed('OnlyOne', opts).reason === 'last-seed', 'cannot remove the last remaining seed');

// --- import group + reimport skips dups --------------------------------------
store.clearSeeds(opts);
r = store.importGroup(seedGroups.matthewManaged, opts);
assert(r.added.length === seedGroups.matthewManaged.length && r.skipped.length === 0, 'importGroup adds all new');
r = store.importGroup(seedGroups.matthewManaged, opts);
assert(r.added.length === 0 && r.skipped.length === seedGroups.matthewManaged.length, 'reimport skips all duplicates');

// --- export ------------------------------------------------------------------
const exportPath = path.join(dir, 'backup.txt');
const ex = store.exportSeeds(exportPath, opts);
const lines = fs.readFileSync(exportPath, 'utf8').trim().split('\n');
assert(ex.count === store.listSeeds(opts).length && lines.length === ex.count, 'export writes one line per seed');

// --- atomicity / backup / logging -------------------------------------------
assert(!fs.existsSync(`${configPath}.tmp`), 'no leftover .tmp file after writes');
assert(fs.existsSync(`${configPath}.bak`), 'config backup (.bak) created');
assert(fs.existsSync(logPath) && /ADD|REMOVE|CLEAR|IMPORT/.test(fs.readFileSync(logPath, 'utf8')), 'changes logged to seed-changes.log');

// cleanup
fs.rmSync(dir, { recursive: true, force: true });

if (failures > 0) { logger.error(`${failures} check(s) failed.`); process.exit(1); }
logger.success('seed-store checks passed.');
