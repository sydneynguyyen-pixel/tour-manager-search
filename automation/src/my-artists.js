// My Artists exclusion filter for the leads pipeline.
//
// automation/data/my-artists.json is the backend-owned list of artists Matthew
// has already worked (seeded from the initial roster; see import-my-artists.js).
// Anyone on it should never surface as a lead, so we drop them from the
// aggregated candidates before scoring.
//
// Matching is by normalized artist name (the same case/whitespace-insensitive
// key aggregate.js uses to join sources), because these records carry no shared
// id with the My Artists entries.
//
// CAVEAT: the dashboard's My Artists tab writes to localStorage, not to this
// file. Entries Matthew adds in the UI will NOT appear here until a sync path
// exists, so the filter only reflects what has been written to my-artists.json.

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const { normalizeName } = require('./aggregate');

const MY_ARTISTS_PATH = path.join(__dirname, '..', 'data', 'my-artists.json');

// Set of normalized names to exclude. Missing/malformed file -> empty set (fail
// soft: never let a bad file silently drop every candidate).
function loadExcludeSet(filePath = MY_ARTISTS_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const artists = Array.isArray(parsed.artists) ? parsed.artists : [];
    return new Set(artists.map((a) => normalizeName(a.name)).filter(Boolean));
  } catch {
    return new Set();
  }
}

// Original-cased My Artists names (for use as discovery seeds / API calls,
// where normalized casing would look odd in logs or Last.fm lookups).
function loadMyArtistNames(filePath = MY_ARTISTS_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const artists = Array.isArray(parsed.artists) ? parsed.artists : [];
    return artists.map((a) => a.name).filter(Boolean);
  } catch {
    return [];
  }
}

// Split aggregated candidate records into { kept, excluded } by the My Artists
// list. Logs how many were dropped (and who) so an empty leads run is explainable.
function filterOutMyArtists(records, filePath = MY_ARTISTS_PATH) {
  const exclude = loadExcludeSet(filePath);
  if (exclude.size === 0) return { kept: records || [], excluded: [] };

  const kept = [];
  const excluded = [];
  for (const r of records || []) {
    if (exclude.has(normalizeName(r.artist))) excluded.push(r);
    else kept.push(r);
  }

  if (excluded.length) {
    logger.info(
      `My Artists filter: excluded ${excluded.length} already-worked artist(s) — ` +
        `${excluded.map((r) => r.artist).join(', ')}`
    );
  }
  return { kept, excluded };
}

module.exports = { filterOutMyArtists, loadExcludeSet, loadMyArtistNames, MY_ARTISTS_PATH };
