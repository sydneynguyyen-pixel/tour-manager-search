// Dismissed-artist exclusion filter for the leads pipeline.
//
// automation/data/dismissed-artists.json is the backend copy of what Matthew
// has tapped "Not interested" on in the dashboard (see
// dashboard/src/lib/dismissedArtists.js, which syncs here via the save-data
// Netlify function). Anyone on it should never resurface as a lead, so we
// drop them at the same points My Artists exclusion happens (see my-artists.js)
// — before Deezer/Setlist.fm calls are wasted on them, and again after
// aggregation as a defense-in-depth pass.
//
// Matching is by normalized artist name, same as my-artists.js, since a
// dismissed candidate carries no other shared id with a later re-discovery
// of the same artist.

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const { normalizeName } = require('./aggregate');

const DISMISSED_ARTISTS_PATH = path.join(__dirname, '..', 'data', 'dismissed-artists.json');

// Set of normalized names to exclude. Missing/malformed file -> empty set
// (fail soft: never let a bad file silently drop every candidate).
function loadDismissedExcludeSet(filePath = DISMISSED_ARTISTS_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const artists = Array.isArray(parsed.artists) ? parsed.artists : [];
    return new Set(artists.map((a) => normalizeName(a.name)).filter(Boolean));
  } catch {
    return new Set();
  }
}

// Split aggregated candidate records into { kept, excluded } by the dismissed
// list. Logs how many were dropped (and who), same as filterOutMyArtists.
function filterOutDismissed(records, filePath = DISMISSED_ARTISTS_PATH) {
  const exclude = loadDismissedExcludeSet(filePath);
  if (exclude.size === 0) return { kept: records || [], excluded: [] };

  const kept = [];
  const excluded = [];
  for (const r of records || []) {
    if (exclude.has(normalizeName(r.artist))) excluded.push(r);
    else kept.push(r);
  }

  if (excluded.length) {
    logger.info(
      `Dismissed-artist filter: excluded ${excluded.length} previously-dismissed artist(s) — ` +
        `${excluded.map((r) => r.artist).join(', ')}`
    );
  }
  return { kept, excluded };
}

module.exports = { filterOutDismissed, loadDismissedExcludeSet, DISMISSED_ARTISTS_PATH };
