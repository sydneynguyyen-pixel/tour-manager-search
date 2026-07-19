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
