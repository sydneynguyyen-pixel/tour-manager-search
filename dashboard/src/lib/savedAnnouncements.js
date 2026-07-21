// Bookmark store for saved "New Tour Detected" artists, backed by
// localStorage under "savedAnnouncements" — kept separate from the Leads
// bookmark store (lib/savedArtists.js) since announcement entries carry no
// score/spotifyId to key that store on, and the two "saved" lists serve
// different intents (a lead to follow up on vs. a tour to keep an eye on).
// Stores the full entry snapshot (the same shape AnnouncementCard already
// renders — see components/TourAnnouncements.jsx), not just an id, so a
// saved artist stays visible here even after they age out of the live feed
// (tour started, dates sold out, etc.) — the same "persist beyond the live
// feed" idea My Artists' own localStorage entries rely on. Matched by artist
// name, the same stable-enough key components/TourAnnouncements.jsx and
// lib/tourAnnouncements.js already use for this read-only feed.

import { useSyncExternalStore } from 'react';

const KEY = 'savedAnnouncements';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// getSnapshot must return a stable reference between writes, so we cache it and
// only swap the reference inside write().
let cache = read();
const listeners = new Set();

function emit() {
  listeners.forEach((l) => l());
}

function write(next) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full / unavailable — keep the in-memory state so the UI still works.
  }
  emit();
}

if (typeof window !== 'undefined') {
  // Reflect saves made in another tab.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      cache = read();
      emit();
    }
  });
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return cache;
}

// --- Mutators ---

export function toggleSavedAnnouncement(entry) {
  if (cache.some((s) => s.artist === entry.artist)) {
    write(cache.filter((s) => s.artist !== entry.artist));
  } else {
    // Newest first.
    write([{ ...entry, savedAt: new Date().toISOString() }, ...cache]);
  }
}

// --- Hooks ---

// The full saved list (newest first).
export function useSavedAnnouncements() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Whether a given artist is currently saved.
export function useIsAnnouncementSaved(artist) {
  const saved = useSavedAnnouncements();
  return saved.some((s) => s.artist === artist);
}
