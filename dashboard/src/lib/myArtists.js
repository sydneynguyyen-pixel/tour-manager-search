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

// Single source of truth for every field automation/enrich-my-artists.js may
// write onto a backend record, local-entry-name -> backend-record-name
// (identical for all but `pipelineGenre`, which is renamed locally because
// the My Artists form already owns a plain `genre` field meaning something
// else — Matthew's tiered calibration selection, not the enrichment-sourced
// string; see toLeadShape's comment on why they can't be conflated).
// `imageUrl` is deliberately NOT here: unlike every other field below, it's
// also a user-editable input on the manual "+ Add artist" form, so it can't
// use the same "omit means no data" convention (an empty imageUrl on a
// manual entry is real data — "no photo" — not "never synced").
//
// toLocalEntry, toBackendEntry, and reconcileWithBackend all drive off this
// one list. Previously each of those hand-wrote its own field-by-field copy,
// which is exactly how deezerId/enrichedAt went missing on every existing
// entry: a field got added to the backend script but a hand-maintained list
// elsewhere in this file didn't get updated in lockstep, and browsers that
// had already seeded before the fix never got the field. A single shared
// list makes that class of drift structurally impossible going forward —
// every field the backend can produce is copied through and preserved
// automatically, with no field-specific code to remember to add.
const ENRICHMENT_FIELDS = [
  { local: 'bio', backend: 'bio', default: null },
  { local: 'pipelineGenre', backend: 'genre', default: null },
  { local: 'mbid', backend: 'mbid', default: null },
  { local: 'deezerId', backend: 'deezerId', default: null },
  { local: 'tourCount', backend: 'tourCount', default: null },
  { local: 'avgVenueSize', backend: 'avgVenueSize', default: null },
  { local: 'countriesToured', backend: 'countriesToured', default: null },
  { local: 'lastTourDate', backend: 'lastTourDate', default: null },
  { local: 'topVenues', backend: 'topVenues', default: null },
  { local: 'tourHistory', backend: 'tourHistory', default: null },
  { local: 'newsArticles', backend: 'newsArticles', default: [] },
  { local: 'hasUpcomingEvents', backend: 'hasUpcomingEvents', default: false },
  { local: 'ticketmasterEvents', backend: 'ticketmasterEvents', default: [] },
  { local: 'ticketmasterEventCount', backend: 'ticketmasterEventCount', default: 0 },
  { local: 'ticketmasterEarliestOnSaleDate', backend: 'ticketmasterEarliestOnSaleDate', default: null },
  { local: 'hasJamBaseEvents', backend: 'hasJamBaseEvents', default: false },
  { local: 'jambaseEvents', backend: 'jambaseEvents', default: [] },
  { local: 'jambaseEventCount', backend: 'jambaseEventCount', default: 0 },
  { local: 'jambaseEarliestListedDate', backend: 'jambaseEarliestListedDate', default: null },
  { local: 'isCurrentlyTouring', backend: 'isCurrentlyTouring', default: false },
  { local: 'enrichedAt', backend: 'enrichedAt', default: null },
];

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
//
// Every ENRICHMENT_FIELDS field is sent ONLY when present locally (`!= null`
// — false/0/[]/'' all count as "present," only null/undefined are treated as
// "this browser doesn't have it"), never coerced to a hard default. This
// matters even with the backend-side keyed merge in syncEntries below: this
// function's output becomes the "incoming" side of that per-artist merge,
// and any key it omits here is a key the merge won't touch — the backend's
// existing value survives untouched. Sending an explicit default instead
// (the old behavior, before this fix) would still clobber real backend data
// with "no data," merge or no merge; omission is what actually protects it.
// See ENRICHMENT_FIELDS' comment for the incident this replaced.
function toBackendEntry(entry) {
  const enrichment = {};
  for (const { local, backend } of ENRICHMENT_FIELDS) {
    if (entry[local] != null) enrichment[backend] = entry[local];
  }
  return {
    name: entry.artistName,
    role: roleLabel(entry),
    relationshipType: entry.relationshipType || '',
    note: entry.notes || '',
    addedAt: entry.addedAt,
    imageUrl: entry.imageUrl || null, // not in ENRICHMENT_FIELDS — see its comment
    ...enrichment,
  };
}

// POSTs the current roster to the save-data function, which commits it to
// automation/data/my-artists.json on GitHub. Swallows all errors — offline,
// a missing GITHUB_TOKEN, a GitHub API hiccup, whatever — so a sync failure
// is invisible to Matthew and never blocks the (already-saved) UI.
//
// Uses save-data's mergeArrayKey mode rather than a full-array replace: the
// backend keys the incoming `artists` array against the existing file by
// `name` and shallow-merges each matching pair (incoming keys win, but a key
// this browser's copy never had — see toBackendEntry's omission above —
// leaves the backend's existing value alone). This is the second, redundant
// layer of protection against the deezerId/enrichedAt-style data loss: even
// if a browser's localStorage is stale and reconcileWithBackend hasn't
// caught up yet (e.g. offline, or an edit fired in the reconciliation fetch's
// race window), the backend itself won't let an omitted field wipe out real
// data. Belt-and-suspenders with the local reconciliation in
// reconcileWithBackend, not a replacement for it — reconciliation is what
// keeps localStorage (the actual source of truth Matthew sees) fresh; this
// is what stops a stale copy from doing damage if it syncs anyway.
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
        mergeArrayKey: 'artists',
        mergeArrayIdField: 'name',
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

// Every ENRICHMENT_FIELDS field, read off a backend record with its default.
// Shared by toLocalEntry (building a brand-new local entry) and
// reconcileWithBackend (refreshing an existing one), so there's exactly one
// place that knows how to pull enrichment off a backend record.
function readEnrichmentFields(backendEntry) {
  const out = {};
  for (const { local, backend, default: def } of ENRICHMENT_FIELDS) {
    out[local] = backendEntry?.[backend] ?? def;
  }
  return out;
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
    imageUrl: backendEntry?.imageUrl ?? null, // not in ENRICHMENT_FIELDS — see its comment
    ...readEnrichmentFields(backendEntry),
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

// Refreshes enrichment fields on entries whose local copy has fallen behind
// the backend — the actual fix for the deezerId/enrichedAt-style data loss.
// buildSeedEntries only ever runs once per browser (gated by hasSeeded), so
// a browser that seeded before a field existed — or before a later
// enrich-my-artists.js run improved a value — would otherwise carry that gap
// forever, silently re-dropping it on every subsequent sync (see
// ENRICHMENT_FIELDS' and toBackendEntry's comments). This runs on every
// mount instead (see the effect in MyArtists.jsx) and compares each matched
// pair's `enrichedAt`: if the backend's is newer than (or the local entry
// has none at all), every ENRICHMENT_FIELDS value is refreshed from the
// backend, overwriting whatever — including a wrong or missing — value is
// currently local. Fields NOT in ENRICHMENT_FIELDS (role, notes, contact
// info, imageUrl, ...) are Matthew's own and are never touched here.
//
// Only fills gaps/staleness — never used to seed brand-new entries (that's
// still buildSeedEntries' job) — so entries with no backend match, or whose
// backend match has never been enriched at all, pass through unchanged.
export async function reconcileWithBackend(localEntries) {
  const backendArtists = await fetchBackendMyArtists();
  if (!backendArtists) return { entries: localEntries, changed: false };

  const backendByName = new Map(backendArtists.map((a) => [a.name, a]));
  let changed = false;
  const entries = localEntries.map((entry) => {
    const backendEntry = backendByName.get(entry.artistName);
    if (!backendEntry?.enrichedAt) return entry;
    const localTime = entry.enrichedAt ? new Date(entry.enrichedAt).getTime() : 0;
    const backendTime = new Date(backendEntry.enrichedAt).getTime();
    if (!(backendTime > localTime)) return entry;
    changed = true;
    return { ...entry, ...readEnrichmentFields(backendEntry) };
  });
  return { entries, changed };
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
