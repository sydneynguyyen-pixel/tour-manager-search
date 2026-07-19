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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serveRealLeads()],
})
