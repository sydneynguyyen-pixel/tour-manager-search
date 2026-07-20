// Scan-pending state, backed by localStorage under "scanPending" so the
// "Scan in progress" indicator survives navigation and page refreshes.
//
// There's no push notification from the GitHub Action back to the dashboard,
// so completion is inferred rather than known: ScanPendingBanner.jsx clears
// this once a leads.json fetch comes back with a generatedAt newer than
// startedAt, or — if that never arrives — once SCAN_TIMEOUT_MS elapses, at
// which point the UI downgrades to a "should be done, check now" prompt
// instead of claiming "in progress" forever.
//
// Same useSyncExternalStore pattern as lib/savedArtists.js /
// lib/dismissedArtists.js, so every consumer (header CTA, the global banner)
// reads and reacts to the same source of truth.

import { useSyncExternalStore } from 'react';

const KEY = 'scanPending';

// Real weekly-scrape runs have historically finished well inside this — tune
// if observed run times drift.
export const SCAN_TIMEOUT_MS = 8 * 60 * 1000;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.startedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

let cache = read();
const listeners = new Set();

function emit() {
  listeners.forEach((l) => l());
}

function write(next) {
  cache = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage full / unavailable — in-memory state still drives the UI this session.
  }
  emit();
}

if (typeof window !== 'undefined') {
  // Reflect a scan started/cleared in another tab.
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

export function startScanPending() {
  write({ startedAt: new Date().toISOString() });
}

export function clearScanPending() {
  write(null);
}

// { startedAt: <iso> } while a scan is pending, else null.
export function useScanPending() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
