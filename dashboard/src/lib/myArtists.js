// Persistence for the My Artists log — the artists/tours Matthew has personally
// worked. This is his own history; it no longer feeds any discovery/seed
// pipeline. Entries are saved to localStorage under "myArtists" and stay on the
// device — this is the single source of truth.
//
// GitHub sync deferred — see chat history for Netlify function spec if needed
// later. (Intended target: a Netlify function committing the list to
// automation/data/my-artists.json via the GitHub API, payload { updatedAt,
// artists }.) Deliberately not half-wired here; localStorage-only for now.

const STORAGE_KEY = 'myArtists';

export function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable — keep the in-memory list so the UI still works.
  }
}
