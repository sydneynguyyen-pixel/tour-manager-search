// One-time bulk import: seed automation/data/my-artists.json from the initial
// seed roster in config.json. Each seed becomes a My Artists entry with a blank
// role and an "Imported from initial seed list" note, per the import spec.
//
// This is the BACKEND-owned copy of the list. It is what the pipeline's leads
// filter reads (see src/my-artists.js) so already-worked artists never surface
// as leads. NOTE: the dashboard's My Artists tab is still localStorage-only and
// does NOT read this file yet — the two can diverge until a sync path is built.
//
// Re-running is safe: it merges by normalized name, preserving any existing
// entries (including ones a future dashboard sync might add) and only appending
// seeds that aren't already present.

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./src/cli/seed-store');
const { normalizeName } = require('./src/aggregate');

const MY_ARTISTS_PATH = path.join(__dirname, 'data', 'my-artists.json');
const IMPORT_NOTE = 'Imported from initial seed list';

function loadExisting() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MY_ARTISTS_PATH, 'utf8'));
    return Array.isArray(parsed.artists) ? parsed.artists : [];
  } catch {
    return [];
  }
}

function main() {
  const config = loadConfig();
  const seeds = config.seedArtists || [];

  const existing = loadExisting();
  const have = new Set(existing.map((a) => normalizeName(a.name)));

  const now = new Date().toISOString();
  const added = [];
  for (const name of seeds) {
    const key = normalizeName(name);
    if (have.has(key)) continue;
    have.add(key);
    added.push({ name, relationshipType: 'Touring', role: '', note: IMPORT_NOTE, addedAt: now });
  }

  const artists = [...existing, ...added];
  const payload = { updatedAt: now, artists };
  fs.writeFileSync(MY_ARTISTS_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(
    `my-artists.json: ${existing.length} existing + ${added.length} imported = ${artists.length} total`
  );
  if (added.length) console.log(`Imported: ${added.map((a) => a.name).join(', ')}`);
}

main();
