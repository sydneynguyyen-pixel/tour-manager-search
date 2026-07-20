import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Dev-only: serve the real pipeline output (automation/data/leads.json) at
// /leads.json, read fresh on every request so re-running the pipeline shows up
// on the next dashboard refresh. Keeps the dashboard pointed at real data in dev
// without copying the file into the app. In prod the dashboard fetches the live
// leads.json from GitHub raw (see src/config.js).
function serveRealLeads() {
  const leadsPath = path.resolve(__dirname, '../automation/data/leads.json')
  return {
    name: 'serve-real-leads',
    configureServer(server) {
      server.middlewares.use('/leads.json', (_req, res) => {
        try {
          const body = fs.readFileSync(leadsPath, 'utf8')
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `leads.json not found at ${leadsPath}: ${err.message}` }))
        }
      })
    },
  }
}

// Dev-only: same pattern as serveRealLeads, but for the backend's My Artists
// roster (automation/data/my-artists.json) — now enriched with image/genre/bio/
// tourHistory by automation/enrich-my-artists.js. Served fresh on every request
// so re-running that script shows up on the next dashboard refresh, without
// copying the file into the app. See src/lib/myArtists.js buildSeedEntries().
function serveMyArtists() {
  const myArtistsPath = path.resolve(__dirname, '../automation/data/my-artists.json')
  return {
    name: 'serve-my-artists',
    configureServer(server) {
      server.middlewares.use('/my-artists.json', (_req, res) => {
        try {
          const body = fs.readFileSync(myArtistsPath, 'utf8')
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `my-artists.json not found at ${myArtistsPath}: ${err.message}` }))
        }
      })
    },
  }
}

// Dev-only: same pattern as serveRealLeads, for the per-run scan summary
// (automation/src/scan-result.js writes this every run, including 0-new-lead
// ones). Missing file (e.g. before any local `node run.js`) 404s, which the
// dashboard's scan-result consumers treat as "no scan data yet", not an error.
function serveScanResult() {
  const scanResultPath = path.resolve(__dirname, '../automation/data/last-scan-result.json')
  return {
    name: 'serve-scan-result',
    configureServer(server) {
      server.middlewares.use('/last-scan-result.json', (_req, res) => {
        try {
          const body = fs.readFileSync(scanResultPath, 'utf8')
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `last-scan-result.json not found at ${scanResultPath}: ${err.message}` }))
        }
      })
    },
  }
}

// Dev-only: same pattern, for the rolling scan-history log (Scan History page).
function serveScanHistory() {
  const scanHistoryPath = path.resolve(__dirname, '../automation/data/scan-history.json')
  return {
    name: 'serve-scan-history',
    configureServer(server) {
      server.middlewares.use('/scan-history.json', (_req, res) => {
        try {
          const body = fs.readFileSync(scanHistoryPath, 'utf8')
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `scan-history.json not found at ${scanHistoryPath}: ${err.message}` }))
        }
      })
    },
  }
}

// Dev-only: same pattern, for the neutral cross-artist Tour Announcements feed
// (automation/build-tour-announcements.js) — a chronological feed of confirmed
// tour announcements pooled from both leads.json and my-artists.json, separate
// from the scored Leads experience. See src/lib/tourAnnouncements.js.
function serveTourAnnouncements() {
  const tourAnnouncementsPath = path.resolve(__dirname, '../automation/data/tour-announcements.json')
  return {
    name: 'serve-tour-announcements',
    configureServer(server) {
      server.middlewares.use('/tour-announcements.json', (_req, res) => {
        try {
          const body = fs.readFileSync(tourAnnouncementsPath, 'utf8')
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `tour-announcements.json not found at ${tourAnnouncementsPath}: ${err.message}` }))
        }
      })
    },
  }
}

// See netlify.toml at the repo root for the Netlify build-ignore rule that
// skips rebuilds when a push only touches automation/data/*.json.
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    serveRealLeads(),
    serveMyArtists(),
    serveScanResult(),
    serveScanHistory(),
    serveTourAnnouncements(),
  ],
})
