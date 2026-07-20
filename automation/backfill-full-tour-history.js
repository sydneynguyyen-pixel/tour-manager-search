// One-off backfill: populate fullTourHistory on the EXISTING leads.json
// without re-running the full pipeline (which would re-scrape Deezer/discovery
// and could change the lead set). Re-fetches Setlist.fm data (via mbid, not
// name search) so it can't drift to a different artist, and writes only the
// fullTourHistory field — tourHistory / scoring / everything else untouched.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { setlistfm } = require('./src/auth');
const { parseEventDate } = require('./src/scrapers/setlistfm-scraper');

const LEADS_PATH = path.join(__dirname, 'data', 'leads.json');
const MAX_PAGES = 15;

async function fetchAllSetlists(mbid) {
  const shows = [];
  for (let p = 1; p <= MAX_PAGES; p += 1) {
    let data;
    try {
      const res = await setlistfm.get(`/artist/${mbid}/setlists`, { params: { p } });
      data = res.data;
    } catch (err) {
      if (err.response?.status === 404) break;
      throw err;
    }
    const items = data.setlist || [];
    shows.push(...items);
    const totalPages = Math.ceil((data.total || 0) / (data.itemsPerPage || 20));
    if (items.length === 0 || p >= totalPages) break;
    await new Promise((r) => setTimeout(r, 1200)); // stay under ~1 req/sec
  }
  return shows;
}

function toTourHistory(shows) {
  return shows
    .map((sl) => {
      const d = parseEventDate(sl.eventDate);
      return {
        date: d ? d.toISOString().slice(0, 10) : null,
        venueName: sl.venue?.name ?? null,
        city: sl.venue?.city?.name ?? null,
        country: sl.venue?.city?.country?.name ?? null,
        venueCapacity: null, // backfill skips Wikipedia lookups; existing tourHistory already has them for in-window shows
      };
    })
    .filter((s) => s.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  for (const lead of payload.leads) {
    if (!lead.mbid) {
      console.log(`${lead.artist}: no mbid — skipping`);
      continue;
    }
    const allShows = await fetchAllSetlists(lead.mbid);
    const fullTourHistory = toTourHistory(allShows);
    // Reuse capacities already resolved for in-window shows so we don't re-hit
    // Wikipedia; shows outside the window keep venueCapacity: null.
    const capByVenue = new Map(
      (lead.tourHistory || []).map((s) => [s.venueName, s.venueCapacity])
    );
    for (const s of fullTourHistory) {
      if (s.venueName && capByVenue.has(s.venueName)) s.venueCapacity = capByVenue.get(s.venueName);
    }
    lead.fullTourHistory = fullTourHistory;
    console.log(`${lead.artist}: ${fullTourHistory.length} show(s) all-time (vs ${lead.tourHistory?.length ?? 0} in window)`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  fs.writeFileSync(LEADS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote ${payload.leads.length} leads to ${path.relative(process.cwd(), LEADS_PATH)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
