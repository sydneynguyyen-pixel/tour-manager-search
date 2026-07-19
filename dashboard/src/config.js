// Configuration for where the dashboard loads leads data from.
//
// Dev (npm run dev): uses the bundled mock file so the UI can be built and
// verified without a live pipeline run. Set VITE_USE_LOCAL_LEADS=false in a
// .env.local to point dev at the real automation/data/leads.json instead.
//
// Prod (npm run build): fetches the live leads.json from the GitHub raw URL.
// Update GITHUB_RAW_URL with the real repo owner/name before deploying.

// TODO: replace USERNAME with the real GitHub account before deploying.
export const GITHUB_RAW_URL =
  'https://raw.githubusercontent.com/USERNAME/tour-manager-search/main/automation/data/leads.json';

// During dev, Vite serves the repo root; this relative path reaches the real
// pipeline output. Requires running `vite` from the dashboard/ folder with the
// default fs.allow, so we expose it via a symlink-free public route below.
export const LOCAL_LEADS_URL = '/leads.json';

const isDev = import.meta.env.DEV;

// In dev we default to the bundled mock so the UI always has rich sample data.
// Flip VITE_USE_LOCAL_LEADS=true to hit the real local pipeline output instead.
const useLocalReal = import.meta.env.VITE_USE_LOCAL_LEADS === 'true';

export const config = {
  isDev,
  // When null, App.jsx falls back to the imported mock JSON (no fetch).
  leadsUrl: isDev ? (useLocalReal ? LOCAL_LEADS_URL : null) : GITHUB_RAW_URL,
  // Auto-refetch interval (ms). Per earlier decision: no manual refresh button.
  refreshIntervalMs: 30_000,
};
