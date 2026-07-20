# Tour Lead Finder — Dashboard

A small React (Vite) dashboard that displays ranked tour-management leads produced
by the `automation/` pipeline (`automation/data/leads.json`).

## Run locally

```bash
cd dashboard
npm install
npm run dev
```

Then open the printed local URL (usually http://localhost:5173).

By default, dev uses bundled sample data (`src/mock-leads.json`) so the UI has rich
content without waiting on a live pipeline run. To point dev at the **real** local
pipeline output instead, create `dashboard/.env.local`:

```
VITE_USE_LOCAL_LEADS=true
```

…and copy the latest `automation/data/leads.json` to `dashboard/public/leads.json`
(Vite serves `public/` at the site root, so it's reachable at `/leads.json`).

## Build for deployment

```bash
npm run build
```

Produces a static `dist/` folder.

```bash
npm run preview   # serve the production build locally to sanity-check
```

## Deploy

- **Netlify (quick):** drag the `dist/` folder onto https://app.netlify.com/drop.
- **Netlify (auto-deploy):** connect this GitHub repo, set the base directory to
  `dashboard`, build command `npm run build`, publish directory `dashboard/dist`.

## Sync (My Artists writes back to GitHub)

The dashboard is a static site with no database — Matthew's My Artists edits save
to localStorage first (instant, always works), then sync in the background to
`automation/data/my-artists.json` in this repo via a Netlify serverless function
([`netlify/functions/save-data.js`](netlify/functions/save-data.js)), so the
pipeline's backend copy doesn't drift from what he actually sees. The genre
preferences feature will use the same function once it lands.

**One-time setup:** sync requires a `GITHUB_TOKEN` environment variable in Netlify
(Site settings → Environment variables), scoped to a GitHub personal access token
with read+write access to `sydneynguyyen-pixel/tour-manager-search`. Without it,
the function returns a 500 and saves silently stay local-only — nothing breaks,
Matthew just doesn't see it sync.

The function only writes to an allowlisted set of paths
(`automation/data/my-artists.json`, `automation/config.json`) — any other
`filePath` is rejected with 403.

**Testing locally:**

```bash
npx netlify-cli dev
```

run from the repo root (`netlify.toml` declares `base = "dashboard"`, so this
serves the dashboard and exposes the function at
`/.netlify/functions/save-data`). Since this hits the *real* GitHub API, you'll
need `GITHUB_TOKEN` available locally too — either `netlify link` this repo to
the live site (pulls the real env vars) or drop a personal token into
`dashboard/.env` for the CLI to pick up. A local save will produce a real commit
on GitHub, same as prod.

## Data source

Where the dashboard reads leads from is controlled in [`src/config.js`](src/config.js):

- **Dev** — bundled `mock-leads.json` (default), or the local pipeline output when
  `VITE_USE_LOCAL_LEADS=true`.
- **Prod** — the GitHub raw URL in `GITHUB_RAW_URL`. **Update the `USERNAME`
  placeholder** to the real repo owner before deploying, e.g.
  `https://raw.githubusercontent.com/<owner>/tour-manager-search/main/automation/data/leads.json`.

The dashboard auto-refetches every 30 seconds (no manual refresh button by design).

## Structure

```
src/
  App.jsx                  app shell: tabs, fetch + 30s auto-refresh, "last updated"
  config.js                data-source config (dev mock vs. prod GitHub raw)
  mock-leads.json          sample leads for local dev / visual verification
  components/
    LeadsList.jsx          ranked lead cards + expandable scoring breakdown
    Filters.jsx            score / priority / genre-tier / management filters + sort
    EmptyState.jsx         loading, empty, no-matches, and error states
  index.css                all styling (dark-mode-friendly, responsive)
```
