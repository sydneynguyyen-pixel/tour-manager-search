// One-off backfill: populate lastfmBio + audiodbBio on the EXISTING leads.json
// without re-running the full pipeline (which would re-scrape Deezer/Setlist.fm
// and could change the lead set). Fetches only the two bio fields per artist.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { getLastFmProfile } = require('./src/scrapers/lastfm-scraper');
const { getArtistProfile } = require('./src/scrapers/audiodb-scraper');

const LEADS_PATH = path.join(__dirname, 'data', 'leads.json');

async function main() {
  const payload = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  for (const lead of payload.leads) {
    const [lf, adb] = await Promise.all([
      getLastFmProfile(lead.artist),
      getArtistProfile(lead.artist),
    ]);
    lead.lastfmBio = lf.bio ?? null;
    lead.audiodbBio = adb.bio ?? null;
    console.log(
      `${lead.artist}: lastfmBio=${lead.lastfmBio ? lead.lastfmBio.length + 'c' : '—'}, ` +
        `audiodbBio=${lead.audiodbBio ? lead.audiodbBio.length + 'c' : '—'}`
    );
  }
  fs.writeFileSync(LEADS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote ${payload.leads.length} leads to ${path.relative(process.cwd(), LEADS_PATH)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
