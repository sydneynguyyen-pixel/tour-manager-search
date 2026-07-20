// Configuration for where the dashboard loads leads data from.
//
// Dev (npm run dev): defaults to the REAL pipeline output. The Vite dev server
// serves automation/data/leads.json at /leads.json (see vite.config.js), read
// fresh each request, so re-running the pipeline shows up on the next refresh.
// Set VITE_USE_MOCK=true in a .env.local to fall back to the bundled mock.
//
// Prod (npm run build): fetches the live leads.json from the GitHub raw URL.
// Update GITHUB_RAW_URL with the real repo owner/name before deploying.

export const GITHUB_RAW_URL =
  'https://raw.githubusercontent.com/sydneynguyyen-pixel/tour-manager-search/main/automation/data/leads.json';

// Served in dev by the serve-real-leads plugin in vite.config.js.
export const LOCAL_LEADS_URL = '/leads.json';

// Same pattern, for the backend's enriched My Artists roster (see
// automation/enrich-my-artists.js + serve-my-artists in vite.config.js). Used
// by lib/myArtists.js's one-time seed to carry real image/genre/bio/tourHistory
// instead of bare names.
export const GITHUB_RAW_MY_ARTISTS_URL =
  'https://raw.githubusercontent.com/sydneynguyyen-pixel/tour-manager-search/main/automation/data/my-artists.json';
export const LOCAL_MY_ARTISTS_URL = '/my-artists.json';

const isDev = import.meta.env.DEV;

// Dev points at real pipeline data by default; opt back into the bundled mock
// with VITE_USE_MOCK=true (e.g. to work on the UI without a pipeline run).
const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export const config = {
  isDev,
  // When null, App.jsx falls back to the imported mock JSON (no fetch).
  leadsUrl: isDev ? (useMock ? null : LOCAL_LEADS_URL) : GITHUB_RAW_URL,
  // When null, the My Artists seed falls back to bare names (no enrichment).
  myArtistsUrl: isDev ? (useMock ? null : LOCAL_MY_ARTISTS_URL) : GITHUB_RAW_MY_ARTISTS_URL,
  // Auto-refetch interval (ms). Per earlier decision: no manual refresh button.
  refreshIntervalMs: 30_000,
};
