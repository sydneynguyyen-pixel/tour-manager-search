// Dismissed ("Not interested") store, backed by localStorage under
// "dismissedArtists". Dismissing a lead hides it from the Leads feed —
// including future scans, since the filter is keyed by the same stable id
// leadId() computes from spotifyId/mbid, not by array position.
//
// Uses useSyncExternalStore so every dismiss control (cards, the detail page,
// the Settings > Dismissed Artists list) reads and reacts to the same source
// of truth. A single `storage` listener keeps other tabs/windows in sync too.
//
// Each dismissed entry: { id, lead: <full snapshot>, dismissedAt: <iso> }.

import { useSyncExternalStore } from 'react';
import { leadId } from './savedArtists';

const KEY = 'dismissedArtists';

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
  // Reflect dismissals made in another tab.
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

export function toggleDismissed(lead) {
  const id = leadId(lead);
  if (cache.some((d) => d.id === id)) {
    write(cache.filter((d) => d.id !== id));
  } else {
    // Newest first.
    write([{ id, lead, dismissedAt: new Date().toISOString() }, ...cache]);
  }
}

export function undoDismiss(id) {
  write(cache.filter((d) => d.id !== id));
}

// --- Hooks ---

// The full dismissed list (newest first).
export function useDismissedArtists() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Whether a given lead is currently dismissed.
export function useIsDismissed(lead) {
  const dismissed = useDismissedArtists();
  const id = leadId(lead);
  return dismissed.some((d) => d.id === id);
}

// Non-hook membership check for filtering plain arrays (e.g. the Leads feed).
export function isDismissedId(id) {
  return cache.some((d) => d.id === id);
}
