// Bookmark store for saved leads, backed by localStorage under "savedArtists".
//
// Uses useSyncExternalStore so every bookmark control (cards, the detail modal,
// the Saved tab) reads and reacts to the same source of truth — toggling a
// bookmark anywhere updates every icon at once. A single `storage` listener
// keeps other tabs/windows in sync too.
//
// Each saved entry: { id, lead: <full snapshot>, note: '', savedAt: <iso> }.

import { useSyncExternalStore } from 'react';

const KEY = 'savedArtists';

// A stable id for a lead, mirroring the key LeadsList uses for its React keys.
export function leadId(lead) {
  return lead.spotifyId || lead.mbid || `${lead.artist}-${lead.rank ?? ''}`;
}

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

export function toggleSaved(lead) {
  const id = leadId(lead);
  if (cache.some((s) => s.id === id)) {
    write(cache.filter((s) => s.id !== id));
  } else {
    // Newest first.
    write([{ id, lead, note: '', savedAt: new Date().toISOString() }, ...cache]);
  }
}

export function removeSaved(id) {
  write(cache.filter((s) => s.id !== id));
}

export function setNote(id, note) {
  write(cache.map((s) => (s.id === id ? { ...s, note } : s)));
}

// --- Hooks ---

// The full saved list (newest first).
export function useSavedArtists() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Whether a given lead is currently saved.
export function useIsSaved(lead) {
  const saved = useSavedArtists();
  const id = leadId(lead);
  return saved.some((s) => s.id === id);
}
