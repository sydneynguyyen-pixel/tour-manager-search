require('dotenv').config({ quiet: true });

const logger = require('./src/utils/logger');
const { scrapeDeezerNewReleases } = require('./src/scrapers/deezer-scraper');
const { scrapeSetlistFMTourHistory } = require('./src/scrapers/setlistfm-scraper');
const { aggregateArtistData } = require('./src/aggregate');
const { scoreArtists } = require('./src/score');
const { formatLeadsOutput, writeLeadsJSON } = require('./src/output');
const { selectBatch } = require('./src/batch');
const { loadConfig, saveConfigAtomic } = require('./src/cli/seed-store');

const LOOKBACK_DAYS = 60;
const TOUR_MONTHS_BACK = 18;

async function main() {
  logger.info('Starting tour manager search automation...');
  const config = loadConfig(); // fresh, mutable copy from disk (so we can persist the batch index)

  const seedArtists = config.seedArtists || [];
  const batchSize = config.seedBatchSize || seedArtists.length;
  const startIndex = config.lastBatchIndex || 0;
  const { batch, start, nextIndex } = selectBatch(seedArtists, batchSize, startIndex);

  logger.count('Seed artists (total)', seedArtists.length);
  logger.info(
    `Batch this run: seeds[${start}..${start + Math.max(batch.length - 1, 0)}] ` +
      `(${batch.length} of ${seedArtists.length}) — ${batch.join(', ') || '(none)'}`
  );

  // Advance + persist the rotation index now so each run takes the next batch,
  // even if this run's data collection fails.
  config.lastBatchIndex = nextIndex;
  saveConfigAtomic(config);
  logger.info(`Next run will start at seed index ${nextIndex}.`);

  // Stage 1 — Deezer: recent releases for THIS BATCH of seed artists (no auth,
  // no quota; replaces the former Spotify stage).
  const releases = await scrapeDeezerNewReleases(batch, LOOKBACK_DAYS);
  const uniqueArtists = new Set(releases.map((r) => r.deezerId)).size;
  logger.count('Artists with recent releases', uniqueArtists);
  logger.count('Total releases', releases.length);

  // Stage 2 — Setlist.fm: tour history for the artists surfaced by Stage 1.
  // NOTE: this funnels on recent releases — artists without a release in the
  // last LOOKBACK_DAYS are dropped before this stage.
  const tourHistory = await scrapeSetlistFMTourHistory(releases, TOUR_MONTHS_BACK);

  // Stage 3 — aggregate (merge + genres/tier + AudioDB/Last.fm/Discogs enrich),
  // score, and output ranked leads.
  const aggregated = await aggregateArtistData(releases, tourHistory, config);
  const scored = scoreArtists(aggregated, config);
  const formatted = formatLeadsOutput(scored, config);
  const written = writeLeadsJSON(formatted);

  for (const lead of formatted.leads) {
    logger.info(
      `  #${lead.rank} ${lead.artist} — ${lead.finalScore} (${lead.priority}) | ` +
        `${lead.genre ?? 'genre n/a'} t${lead.genreTier} | shows ${lead.scoring ? lead.tourCount : '?'} | avgVenue ${lead.avgVenueSize}`
    );
  }
  if (written) logger.success(`✓ ${formatted.leads.length} leads output to leads.json`);
  else logger.info('No leads this run — leads.json preserved from a prior run.');
  return formatted;
}

main().catch((err) => {
  logger.error('Automation failed:', err.response?.status ?? '', err.response?.data ?? err.message);
  process.exit(1);
});
