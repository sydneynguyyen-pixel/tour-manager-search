// Dismissed ("Not interested") store, backed by localStorage under
// "dismissedArtists". Dismissing a lead hides it from the Leads feed locally,
// and syncs the artist name to automation/data/dismissed-artists.json via the
// save-data Netlify function (same fire-and-forget pattern as
// lib/myArtists.js), so future automated scans exclude it too — see
// automation/src/dismissed-artists.js on the backend side.
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
  // Best-effort background sync — never awaited, never surfaced to the
  // caller. The local write above is already durable (localStorage) by the
  // time this fires, so the dismissal is safe even if the network request
  // below fails, is offline, or the function/token isn't configured yet.
  syncDismissed(next);
}

// POSTs the full current dismissed list to the save-data function, which
// commits it to automation/data/dismissed-artists.json on GitHub. Sends only
// the artist name + when it was dismissed — that's all the backend exclusion
// filter (automation/src/dismissed-artists.js) needs; the full `lead`
// snapshot stays local-only (it's just for rendering the Dismissed Artists
// list). Swallows all errors, same as lib/myArtists.js's syncEntries.
async function syncDismissed(entries) {
  try {
    await fetch('/.netlify/functions/save-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'automation/data/dismissed-artists.json',
        content: {
          updatedAt: new Date().toISOString(),
          artists: entries.map((d) => ({ name: d.lead?.artist, dismissedAt: d.dismissedAt })),
        },
      }),
    });
  } catch {
    // Best-effort — see write() comment.
  }
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
