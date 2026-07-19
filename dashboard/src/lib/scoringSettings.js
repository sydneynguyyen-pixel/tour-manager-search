// Local, editable copy of the pipeline's scoring knobs (venue range + genre
// tiers), seeded from automation/config.json so the dashboard starts from the
// exact numbers the backend scores with.
//
// The "Suggested adjustments" panel in My Artists reads these values to show
// what the search currently prioritizes, and only ever mutates them through an
// explicit Apply click — nothing here is auto-applied.
//
// Backed by localStorage under "scoringSettings" and exposed via
// useSyncExternalStore so the calibration panel re-renders the moment a
// suggestion is applied.

import { useSyncExternalStore } from 'react';

const KEY = 'scoringSettings';

// Mirrors automation/config.json (scoringThresholds + genrePreferenceTiers) as
// of this build. If the backend config changes, update these defaults to match.
export const DEFAULT_SETTINGS = {
  thresholds: { minScore: 60, immediateOutreach: 85, venueMin: 300, venueMax: 5000 },
  genreTiers: {
    tier1: { multiplier: 1.15, genres: ['pop', 'indie pop', 'r&b', 'neo soul'] },
    tier2: { multiplier: 1, genres: ['hip-hop', 'bedroom pop', 'electronic', 'house', 'techno'] },
    tier3: { multiplier: 0.95, genres: ['rock', 'indie rock', 'folk', 'country', 'emo', 'soul', 'punk'] },
    tier4: { multiplier: 0.92, genres: ['k-pop', 'j-pop', 'bollywood', 'metal', 'classical', 'latin'] },
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    // Shallow-merge onto defaults so a partial/old blob never loses keys.
    return {
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(parsed.thresholds || {}) },
      genreTiers: { ...clone(DEFAULT_SETTINGS.genreTiers), ...(parsed.genreTiers || {}) },
    };
  } catch {
    return clone(DEFAULT_SETTINGS);
  }
}

let cache = read();
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

function write(next) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — keep in-memory state so the UI still works.
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      cache = read();
      emit();
    }
  });
}

// --- Helpers ---

const LABEL_OVERRIDES = { 'r&b': 'R&B', 'k-pop': 'K-Pop', 'j-pop': 'J-Pop', 'hip-hop': 'Hip-Hop' };

// 'indie pop' -> 'Indie Pop', 'r&b' -> 'R&B'. Used for display only.
export function genreLabel(g) {
  if (!g) return '';
  const key = g.trim().toLowerCase();
  return LABEL_OVERRIDES[key] || key.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Canonical genre options for the My Artists dropdown: the union of every tiered
// genre in the defaults, sorted, so a logged genre always maps to a tier.
export const GENRE_OPTIONS = Object.values(DEFAULT_SETTINGS.genreTiers)
  .flatMap((t) => t.genres)
  .sort((a, b) => genreLabel(a).localeCompare(genreLabel(b)));

// Which tier (1-4) a genre currently sits in, or null if untiered.
export function genreTierOf(settings, genre) {
  const key = genre?.trim().toLowerCase();
  if (!key) return null;
  for (const [name, tier] of Object.entries(settings.genreTiers)) {
    if (tier.genres.some((g) => g.toLowerCase() === key)) {
      return Number(name.replace('tier', ''));
    }
  }
  return null;
}

// --- Mutators (only called from an explicit Apply click) ---

export function applyVenueRange(min, max) {
  const next = clone(cache);
  next.thresholds.venueMin = min;
  next.thresholds.venueMax = max;
  write(next);
}

// Promote the given genres into tier 1, removing them from any lower tier first.
export function promoteGenresToTier1(genres) {
  const keys = genres.map((g) => g.trim().toLowerCase()).filter(Boolean);
  if (keys.length === 0) return;
  const next = clone(cache);
  for (const [name, tier] of Object.entries(next.genreTiers)) {
    if (name === 'tier1') continue;
    tier.genres = tier.genres.filter((g) => !keys.includes(g.toLowerCase()));
  }
  const t1 = next.genreTiers.tier1.genres;
  for (const key of keys) {
    if (!t1.some((g) => g.toLowerCase() === key)) t1.push(key);
  }
  write(next);
}

// --- Hook ---

export function useScoringSettings() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cache,
  );
}
