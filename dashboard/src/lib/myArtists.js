// Persistence for the My Artists log — the artists/tours Matthew has personally
// worked. This is his own history; it no longer feeds any discovery/seed
// pipeline. Entries are saved to localStorage under "myArtists" and stay on the
// device — this is the single source of truth.
//
// GitHub sync deferred — see chat history for Netlify function spec if needed
// later. (Intended target: a Netlify function committing the list to
// automation/data/my-artists.json via the GitHub API, payload { updatedAt,
// artists }.) Deliberately not half-wired here; localStorage-only for now.

import { config } from '../config';

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
}

// --- one-time silent seed of the backend's initial 27-artist roster --------
//
// automation/data/my-artists.json (the backend-owned file the leads pipeline
// filters against) was bulk-imported with these same 27 names, and is now
// enriched (image/genre/bio/tourHistory — see automation/enrich-my-artists.js)
// by a script run separately, not by this app. There is no LIVE sync path
// between that file and this localStorage store (see the module comment
// above) — this pulls a ONE-TIME snapshot of it on first visit so Matthew
// actually sees a real feed today. It WILL drift from the backend file the
// moment either side changes; do not treat this as a substitute for real sync.
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
    // has run, or if the backend fetch failed.
    imageUrl: backendEntry?.imageUrl ?? null,
    bio: backendEntry?.bio ?? null,
    pipelineGenre: backendEntry?.genre ?? null,
    mbid: backendEntry?.mbid ?? null,
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
