// Genre Preferences (Settings page) — Matthew ranks every tiered genre from
// most to least preferred; the ranked order is split into quartiles that map
// onto the same 4 scoring multipliers automation/config.json already uses
// (see scoringSettings.js's DEFAULT_SETTINGS). Order within a quartile
// doesn't affect scoring, but the full order is still persisted so reopening
// Settings shows Matthew's exact ranking, not just which tier each genre
// landed in.
//
// Local-first, same pattern as lib/myArtists.js: the localStorage save below
// is synchronous and is what the UI reads from. Syncing the derived tiers to
// automation/config.json (via the save-data Netlify function, in merge mode
// so only the genrePreferenceTiers key is touched) is best-effort and fails
// silently in the background — see syncGenreTiers.

import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, setGenreTiers } from './scoringSettings';

const KEY = 'genrePreferenceOrder';

// Starting order: today's config.json ranking (tier1 genres first, then
// tier2, tier3, tier4), alphabetical within each tier — the sensible "most
// preferred right now" default for a Matthew who hasn't ranked anything yet.
const DEFAULT_ORDER = ['tier1', 'tier2', 'tier3', 'tier4'].flatMap((t) =>
  [...DEFAULT_SETTINGS.genreTiers[t].genres].sort(),
);

// Multipliers reused exactly from scoringSettings' defaults — this module
// never invents its own tier numbers.
const MULTIPLIERS = {
  tier1: DEFAULT_SETTINGS.genreTiers.tier1.multiplier,
  tier2: DEFAULT_SETTINGS.genreTiers.tier2.multiplier,
  tier3: DEFAULT_SETTINGS.genreTiers.tier3.multiplier,
  tier4: DEFAULT_SETTINGS.genreTiers.tier4.multiplier,
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_ORDER];
    // Reconcile against the canonical genre set so a genre added/removed
    // upstream (in config.json) doesn't leave a stale or incomplete saved
    // order: known genres keep Matthew's saved position, anything new is
    // appended, anything no longer tiered is dropped.
    const known = new Set(DEFAULT_ORDER);
    const kept = parsed.filter((g) => known.has(g));
    const missing = DEFAULT_ORDER.filter((g) => !kept.includes(g));
    return [...kept, ...missing];
  } catch {
    return [...DEFAULT_ORDER];
  }
}

let cache = read();
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

// Cumulative (not independently-rounded) quartile boundaries so the 4 parts
// always sum to the full length instead of drifting off by one.
function quartileBoundaries(n) {
  return [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n];
}

// Ranked order -> the same { tier1..tier4: { multiplier, genres } } shape
// automation/config.json's genrePreferenceTiers uses.
export function tiersFromOrder(order) {
  const b = quartileBoundaries(order.length);
  return {
    tier1: { multiplier: MULTIPLIERS.tier1, genres: order.slice(b[0], b[1]) },
    tier2: { multiplier: MULTIPLIERS.tier2, genres: order.slice(b[1], b[2]) },
    tier3: { multiplier: MULTIPLIERS.tier3, genres: order.slice(b[2], b[3]) },
    tier4: { multiplier: MULTIPLIERS.tier4, genres: order.slice(b[3], b[4]) },
  };
}

// Which tier number (1-4) a given position in the ranked order falls into —
// lets the UI badge each row without re-deriving the full tiersFromOrder
// genre arrays just to look up one genre.
export function tierIndexOf(order, index) {
  const [, q1, q2, q3] = quartileBoundaries(order.length);
  if (index < q1) return 1;
  if (index < q2) return 2;
  if (index < q3) return 3;
  return 4;
}

function persist(order) {
  cache = order;
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Storage unavailable — keep in-memory state so the UI still works.
  }
  emit();
  const tiers = tiersFromOrder(order);
  // Keep scoringSettings.genreTiers (read by CalibrationPanel and the
  // GENRE_OPTIONS tier lookups) in sync with the new ranking immediately...
  setGenreTiers(tiers);
  // ...then sync the same derived tiers to the backend in the background.
  syncGenreTiers(tiers);
}

// POSTs the derived tiers to save-data in merge mode, so only config.json's
// genrePreferenceTiers key is touched — mirrors lib/myArtists.js's
// syncEntries(): fire-and-forget, swallows every error, never awaited by
// the caller.
async function syncGenreTiers(genreTiers) {
  try {
    await fetch('/.netlify/functions/save-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'automation/config.json',
        merge: true,
        content: { genrePreferenceTiers: genreTiers },
      }),
    });
  } catch {
    // Best-effort — see module comment.
  }
}

// Moves the genre at fromIndex to toIndex and persists+syncs the result.
// Called once per completed reorder (a drag's drop, or one arrow-button
// click) — never mid-drag, so a drag gesture produces exactly one sync call.
export function moveGenre(order, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex == null || toIndex == null) return;
  if (toIndex < 0 || toIndex >= order.length) return;
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  persist(next);
}

export function useGenrePreferenceOrder() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cache,
  );
}
