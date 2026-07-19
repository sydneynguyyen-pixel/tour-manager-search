// Seed-list operations (pure logic, no interactive UI) for config.json's
// `seedArtists`. Separated from the CLI menu so it can be unit-tested without a
// TTY. All writes are atomic (tmp + rename), back up config.json.bak first, and
// append to logs/seed-changes.log.
//
// Names are normalized by trimming + collapsing whitespace ONLY — casing is
// preserved. Artist names are stylized proper nouns ("d4vd", "SZA") and are used
// as API search keys, so title-casing them would corrupt the data.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_LOG_PATH = path.join(ROOT, 'logs', 'seed-changes.log');

function normalizeName(name) {
  return String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function getSeeds(config) {
  return Array.isArray(config.seedArtists) ? config.seedArtists : [];
}

function listSeeds(opts = {}) {
  return getSeeds(loadConfig(opts.configPath || DEFAULT_CONFIG_PATH));
}

function logChange(message, logPath = DEFAULT_LOG_PATH) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* logging must never break the operation */
  }
}

// Write config back atomically: back up the current file, write to a temp file,
// then rename over the original (atomic on the same filesystem).
function saveConfigAtomic(config, configPath = DEFAULT_CONFIG_PATH) {
  try {
    if (fs.existsSync(configPath)) fs.copyFileSync(configPath, `${configPath}.bak`);
  } catch {
    /* backup is best-effort; don't abort the write */
  }
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tmp, configPath);
}

function hasSeed(seeds, name) {
  const lower = name.toLowerCase();
  return seeds.some((s) => s.toLowerCase() === lower);
}

// Add one seed. Returns { ok, reason?, name, seeds }.
function addSeed(name, opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  const clean = normalizeName(name);
  const config = loadConfig(configPath);
  const seeds = getSeeds(config);

  if (!clean) return { ok: false, reason: 'empty', name: clean, seeds };
  if (hasSeed(seeds, clean)) return { ok: false, reason: 'duplicate', name: clean, seeds };

  const updated = [...seeds, clean];
  config.seedArtists = updated;
  saveConfigAtomic(config, configPath);
  logChange(`ADD "${clean}" (count ${updated.length})`, opts.logPath || DEFAULT_LOG_PATH);
  return { ok: true, name: clean, seeds: updated };
}

// Remove one seed by name (case-insensitive). Refuses to remove the LAST seed
// (use clearSeeds to intentionally empty the list). Returns { ok, reason?, ... }.
function removeSeed(name, opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  const clean = normalizeName(name);
  const config = loadConfig(configPath);
  const seeds = getSeeds(config);

  const idx = seeds.findIndex((s) => s.toLowerCase() === clean.toLowerCase());
  if (idx === -1) return { ok: false, reason: 'not-found', name: clean, seeds };
  if (seeds.length <= 1) return { ok: false, reason: 'last-seed', name: seeds[idx], seeds };

  const removed = seeds[idx];
  const updated = seeds.filter((_, i) => i !== idx);
  config.seedArtists = updated;
  saveConfigAtomic(config, configPath);
  logChange(`REMOVE "${removed}" (count ${updated.length})`, opts.logPath || DEFAULT_LOG_PATH);
  return { ok: true, name: removed, seeds: updated };
}

// Clear every seed (deliberate empty). Returns { ok, seeds: [] }.
function clearSeeds(opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  const config = loadConfig(configPath);
  const prev = getSeeds(config).length;
  config.seedArtists = [];
  saveConfigAtomic(config, configPath);
  logChange(`CLEAR (was ${prev})`, opts.logPath || DEFAULT_LOG_PATH);
  return { ok: true, seeds: [] };
}

// Bulk-add a list of names, skipping duplicates. Returns { ok, added, skipped, seeds }.
function importGroup(names, opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  const config = loadConfig(configPath);
  let seeds = getSeeds(config);
  const added = [];
  const skipped = [];

  for (const raw of names || []) {
    const clean = normalizeName(raw);
    if (!clean) continue;
    if (hasSeed(seeds, clean)) {
      skipped.push(clean);
      continue;
    }
    seeds = [...seeds, clean];
    added.push(clean);
  }

  config.seedArtists = seeds;
  saveConfigAtomic(config, configPath);
  logChange(`IMPORT +[${added.join(', ')}] skip[${skipped.join(', ')}] (count ${seeds.length})`, opts.logPath || DEFAULT_LOG_PATH);
  return { ok: true, added, skipped, seeds };
}

// Write the current seed list to a text file (one per line). Returns { ok, count, filePath }.
function exportSeeds(filePath, opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  const seeds = getSeeds(loadConfig(configPath));
  fs.writeFileSync(filePath, seeds.length ? `${seeds.join('\n')}\n` : '');
  return { ok: true, count: seeds.length, filePath };
}

module.exports = {
  normalizeName,
  loadConfig,
  getSeeds,
  listSeeds,
  saveConfigAtomic,
  logChange,
  addSeed,
  removeSeed,
  clearSeeds,
  importGroup,
  exportSeeds,
  DEFAULT_CONFIG_PATH,
  DEFAULT_LOG_PATH,
};
