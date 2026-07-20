// Persistence for the My Artists log — the artists/tours Matthew has personally
// worked. This is his own history; it no longer feeds any discovery/seed
// pipeline. Entries save to localStorage under "myArtists" first (the
// source of truth for the UI — every read goes through loadEntries) and are
// then synced to automation/data/my-artists.json in the repo via the
// save-data Netlify function, so the backend file doesn't silently drift
// from what Matthew sees. Sync is fire-and-forget and best-effort: a failed
// sync never blocks or rolls back the local save (see saveEntries below).

import { config } from '../config';
import { roleLabel } from '../utils/myArtistFields';

const STORAGE_KEY = 'myArtists';
const SEEDED_FLAG_KEY = 'myArtists:seeded';

// relationshipType values — shared so MyArtists.jsx (the form) and
// CalibrationPanel.jsx (which buckets stats by type) never drift apart.
export const TOURING_TYPE = 'Touring';
export const BOOKED_TYPE = 'Booked for event/lineup';

// Backfills relationshipType onto entries saved before that field existed.
// Imported entries are historical touring credits, so they default to
// "Touring" (matches their original context); manually-added entries are left
// unset ('') rather than guessed, so Matthew corrects them deliberately.
function normalizeEntry(entry) {
  if (entry.relationshipType) return entry;
  return { ...entry, relationshipType: entry.imported ? TOURING_TYPE : '' };
}

export function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
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
  // Best-effort background sync — never awaited, never surfaced to the
  // caller. The local save above is already durable (localStorage) by the
  // time this fires, so Matthew's edit is safe even if the network request
  // below fails, is offline, or the function/token isn't configured yet.
  syncEntries(entries);
}

// One local entry -> one automation/data/my-artists.json record. The two
// shapes differ (see toLocalEntry's comment below for why) — this is the
// inverse direction, local -> backend, used only when syncing.
//
// `role` uses the shared roleLabel() helper so "Other" free-text resolves
// the same way here as it does everywhere else the role is displayed.
// `genre` deliberately sends pipelineGenre (the enrichment-sourced string),
// never entry.genre (Matthew's tiered calibration selection) — same
// reasoning as toLeadShape: different vocabularies, don't conflate them.
// deezerId/enrichedAt are carried through unchanged from whatever
// toLocalEntry attached, so a resync never drops enrichment metadata this
// app doesn't otherwise use.
function toBackendEntry(entry) {
  return {
    name: entry.artistName,
    role: roleLabel(entry),
    relationshipType: entry.relationshipType || '',
    note: entry.notes || '',
    addedAt: entry.addedAt,
    imageUrl: entry.imageUrl || null,
    genre: entry.pipelineGenre || '',
    bio: entry.bio ?? null,
    mbid: entry.mbid ?? null,
    ...(entry.deezerId != null ? { deezerId: entry.deezerId } : {}),
    ...(entry.enrichedAt ? { enrichedAt: entry.enrichedAt } : {}),
    tourCount: entry.tourCount ?? null,
    avgVenueSize: entry.avgVenueSize ?? null,
    countriesToured: entry.countriesToured ?? null,
    lastTourDate: entry.lastTourDate ?? null,
    topVenues: entry.topVenues ?? null,
    tourHistory: entry.tourHistory ?? null,
  };
}

// POSTs the full current roster to the save-data function, which commits it
// to automation/data/my-artists.json on GitHub. Swallows all errors —
// offline, a missing GITHUB_TOKEN, a GitHub API hiccup, whatever — so a sync
// failure is invisible to Matthew and never blocks the (already-saved) UI.
async function syncEntries(entries) {
  try {
    await fetch('/.netlify/functions/save-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'automation/data/my-artists.json',
        content: {
          updatedAt: new Date().toISOString(),
          artists: entries.map(toBackendEntry),
        },
      }),
    });
  } catch {
    // Best-effort — see function comment.
  }
}

// --- one-time silent seed of the backend's initial 27-artist roster --------
//
// automation/data/my-artists.json (the backend-owned file the leads pipeline
// filters against) was bulk-imported with these same 27 names, and is
// enriched (image/genre/bio/tourHistory) by automation/enrich-my-artists.js,
// a script run separately, not by this app. This pulls a ONE-TIME snapshot
// of that file on first visit so Matthew sees a real feed immediately,
// carrying that enrichment into localStorage. After this point saveEntries'
// sync (see module comment above) keeps the backend file caught up with
// whatever Matthew does in the UI — but enrichment itself is still only
// ever produced by that separate script, never by the dashboard, so a
// manually-added artist stays unenriched until that script next runs.
//
// Dev serves the backend file fresh at /my-artists.json (see vite.config.js);
// prod fetches it from GitHub raw (see src/config.js) — same pattern the leads
// feed already uses.

export const IMPORT_NOTE = 'Imported from initial seed list';

// Last-resort fallback if the backend fetch fails/is unavailable (e.g. before
// the first push, or a network hiccup) — bare names with no enrichment, so
// Matthew still sees the roster instead of an empty list.
const FALLBACK_SEED_ARTIST_NAMES = [
  'd4vd', 'Seven Lions', 'Hannah Bahng', 'Jason Ross', 'Trivecta', 'Mitis', 'HALIENE',
  'ARMNHMR', 'Wallows', '070 Shake', 'Pierre Bourne', 'Wooli', 'William Black', 'Swae Lee',
  'Rachel Chinouriri', 'Zacari', 'Blxst', 'Kai Wachi', 'RINI', 'Isabella Lovestory',
  'Cheyenne Giles', 'Julianne By', 'Juelz', 'Frosttop', 'OsamaSon', 'Ski Mask the Slump God',
  'Jordan Ward',
];

async function fetchBackendMyArtists() {
  if (!config.myArtistsUrl) return null;
  try {
    const res = await fetch(config.myArtistsUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.artists) ? json.artists : null;
  } catch {
    return null;
  }
}

// Map one backend my-artists.json record (name + optional enrichment) to the
// localStorage entry shape. `role`/`genre`/etc. stay blank — those are owned
// by the My Artists form and mean something different (a tiered genre key,
// not the raw MusicBrainz/AudioDB string enrichment produces). Enrichment
// lands in separate, display-only fields the feed-style card reads directly.
function toLocalEntry(name, backendEntry) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    artistName: name,
    relationshipType: TOURING_TYPE,
    role: '',
    roleOther: '',
    genre: '',
    genreOther: '',
    scope: '',
    startMonth: '',
    startYear: '',
    isPresent: false,
    endMonth: '',
    endYear: '',
    minCap: '',
    maxCap: '',
    contactName: '',
    contactEmail: '',
    notes: IMPORT_NOTE,
    imported: true,
    addedAt: backendEntry?.addedAt || now,
    // Enrichment from automation/enrich-my-artists.js — null until that script
    // has run, or if the backend fetch failed. deezerId/enrichedAt aren't
    // used for display anywhere in this app; they're carried through purely
    // so syncEntries (see saveEntries below) can send them back unchanged
    // instead of silently dropping them on the next sync.
    imageUrl: backendEntry?.imageUrl ?? null,
    bio: backendEntry?.bio ?? null,
    pipelineGenre: backendEntry?.genre ?? null,
    mbid: backendEntry?.mbid ?? null,
    deezerId: backendEntry?.deezerId ?? null,
    enrichedAt: backendEntry?.enrichedAt ?? null,
    tourCount: backendEntry?.tourCount ?? null,
    avgVenueSize: backendEntry?.avgVenueSize ?? null,
    countriesToured: backendEntry?.countriesToured ?? null,
    lastTourDate: backendEntry?.lastTourDate ?? null,
    topVenues: backendEntry?.topVenues ?? null,
    tourHistory: backendEntry?.tourHistory ?? null,
  };
}

// Build the 27 seed entries, pulling real enrichment from the backend
// my-artists.json when it's reachable; falls back to bare names otherwise.
export async function buildSeedEntries() {
  const backendArtists = await fetchBackendMyArtists();
  if (backendArtists && backendArtists.length > 0) {
    return backendArtists.map((a) => toLocalEntry(a.name, a));
  }
  return FALLBACK_SEED_ARTIST_NAMES.map((name) => toLocalEntry(name, null));
}

export function hasSeeded() {
  try {
    return localStorage.getItem(SEEDED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSeeded() {
  try {
    localStorage.setItem(SEEDED_FLAG_KEY, '1');
  } catch {
    // Storage unavailable — worst case the seed button reappears next visit.
  }
}

// --- adapting a My Artists entry for the shared lead-shaped components -----
//
// ArtistCard.jsx and ArtistDetail.jsx were both built for `lead` records (from
// leads.json) and read fields like `.artist`, `.genre`, `.lastfmBio`/
// `.audiodbBio`. A My Artists entry uses different names for the same idea
// (`.artistName`, `.pipelineGenre`, `.bio`) plus some fields leads.json always
// has that My Artists entries don't (recentReleases, socialLinks, scoring —
// enrich-my-artists.js deliberately skips Deezer's release list and all
// contact-research/scoring, see automation/enrich-my-artists.js). This maps
// one to the other WITHOUT mutating the stored entry, so the card/detail page
// can render a My Artists entry with zero changes to their own logic.
export function toLeadShape(entry) {
  return {
    ...entry,
    artist: entry.artistName,
    genre: entry.pipelineGenre || '',
    audiodbBio: entry.bio || null,
    lastfmBio: null,
    recentReleases: [],
    socialLinks: {},
    websiteUrl: null,
    managementType: null,
    contactEmail: null,
    fitReasoning: [],
  };
}

// URL for a My Artists entry's detail page (/my-artists/:id). Uses the
// entry's own localStorage id (a UUID) rather than leadId()'s mbid/spotifyId
// scheme — a My Artists entry can carry an mbid too (from enrichment), and
// reusing leadId's fallback chain here risks colliding with an unrelated
// lead that happens to resolve to the same key.
export function myArtistRoute(entry) {
  return `/my-artists/${encodeURIComponent(entry.id)}`;
}
