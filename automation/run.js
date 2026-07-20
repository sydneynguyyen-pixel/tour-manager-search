require('dotenv').config({ quiet: true });

const logger = require('./src/utils/logger');
const { scrapeDeezerNewReleases } = require('./src/scrapers/deezer-scraper');
const { scrapeSetlistFMTourHistory } = require('./src/scrapers/setlistfm-scraper');
const { discoverRelatedArtists } = require('./src/scrapers/discovery-scraper');
const { aggregateArtistData, normalizeName } = require('./src/aggregate');
const { filterOutMyArtists, loadMyArtistNames } = require('./src/my-artists');
const { scoreArtists } = require('./src/score');
const { formatLeadsOutput, writeLeadsJSON, loadLeadArtistNames } = require('./src/output');
const { selectBatch } = require('./src/batch');
const { loadConfig, saveConfigAtomic } = require('./src/cli/seed-store');

const LOOKBACK_DAYS = 60;
const TOUR_MONTHS_BACK = 18;
const DISCOVERY_LIMIT_PER_SEED = 5;
// New candidates actually processed per run, after dedup against My Artists
// and leads.json. Real measured conversion (discovery candidate -> scored
// lead) is ~10-16% release-hit-rate at the Deezer gate, times a further
// ~50-65% score-pass-rate on the survivors — roughly 10% end-to-end, not the
// originally-assumed 23%. 80 is sized off that real rate to reliably yield
// 7-10 new leads/week. Deezer has no auth/quota, so this costs only ~1-2 extra
// minutes of runtime; Setlist.fm (the rate-limited stage) only ever sees the
// small subset that clears the Deezer gate, so raising this doesn't increase
// 429 risk there. A run naturally processes fewer than this if the deduped
// pool itself is smaller (see "capped at N (M available)" in the logs).
// Overridable for one-off larger runs (e.g. the initial backfill) via env var.
const MAX_NEW_CANDIDATES_PER_RUN = Number(process.env.MAX_NEW_CANDIDATES_PER_RUN) || 80;

async function main() {
  logger.info('Starting tour manager search automation...');
  const config = loadConfig(); // fresh, mutable copy from disk (so we can persist the batch index)

  // Stage 0 — discovery: My Artists are now discovery seeds, not scored
  // candidates. Use Last.fm's related-artist graph to surface NEW candidates
  // adjacent to Matthew's world, instead of hand-typing another seed batch.
  // Re-read live each run, so as Matthew adds artists over time (via
  // import-my-artists.js) discovery naturally expands/shifts with him.
  const myArtistNames = loadMyArtistNames();
  const discovered = myArtistNames.length ? await discoverRelatedArtists(myArtistNames, DISCOVERY_LIMIT_PER_SEED) : [];

  let seedArtists;
  if (discovered.length) {
    // discoverRelatedArtists() already excludes My Artists. Also drop anyone
    // already scored/showing in leads.json — don't reprocess a candidate the
    // feed already has, only genuinely new ones.
    const alreadyLead = new Set(loadLeadArtistNames().map(normalizeName));
    const newCandidates = discovered.filter((name) => !alreadyLead.has(normalizeName(name)));
    const dedupedOut = discovered.length - newCandidates.length;
    seedArtists = newCandidates.slice(0, MAX_NEW_CANDIDATES_PER_RUN);

    logger.count('Discovery: candidates found', discovered.length);
    logger.count('Discovery: already known (in leads.json, deduped out)', dedupedOut);
    logger.count('Discovery: new candidates processed this run', seedArtists.length);
    if (newCandidates.length > seedArtists.length) {
      logger.info(
        `Discovery: capped at ${MAX_NEW_CANDIDATES_PER_RUN} new candidates ` +
          `(${newCandidates.length} available after dedup).`
      );
    }
  } else {
    // Fall back to config.json's static seedArtists (kept for reference/manual
    // re-triggering) only if discovery produced nothing — e.g. no Last.fm key.
    // This fixed list doesn't shrink as leads accumulate, so it still needs
    // the old rotation to avoid reprocessing the same names every run.
    logger.warn('Discovery produced no candidates — falling back to config.json seedArtists (rotated batch).');
    const fallbackSeeds = config.seedArtists || [];
    const batchSize = config.seedBatchSize || fallbackSeeds.length;
    const startIndex = config.lastBatchIndex || 0;
    const { batch, start, nextIndex } = selectBatch(fallbackSeeds, batchSize, startIndex);
    seedArtists = batch;

    logger.info(
      `Fallback batch: seeds[${start}..${start + Math.max(batch.length - 1, 0)}] ` +
        `(${batch.length} of ${fallbackSeeds.length}) — ${batch.join(', ') || '(none)'}`
    );

    // Advance + persist the rotation index now so each run takes the next
    // batch, even if this run's data collection fails.
    config.lastBatchIndex = nextIndex;
    saveConfigAtomic(config);
    logger.info(`Next fallback run will start at seed index ${nextIndex}.`);
  }

  // Stage 1 — Deezer: recent releases for this run's candidates (no auth,
  // no quota; replaces the former Spotify stage).
  const releasesRaw = await scrapeDeezerNewReleases(seedArtists, LOOKBACK_DAYS);

  // Re-check against leads.json using Deezer's own resolved artist name, not
  // just the pre-Deezer discovery name deduped above. Deezer's search can
  // canonicalize a candidate to a spelling/punctuation that differs from the
  // discovery-stage name (e.g. Last.fm's "Griff" resolving to Deezer's
  // "GRiFF!") — when that resolved name matches an existing lead, the earlier
  // dedup silently misses it, and the same already-known artist gets
  // reprocessed (and pointlessly re-queried against Setlist.fm/enrichment)
  // every run. Catching it here also saves those wasted downstream calls.
  const alreadyLeadResolved = new Set(loadLeadArtistNames().map(normalizeName));
  const releases = [];
  const resolvedDupeNames = [];
  for (const r of releasesRaw) {
    if (alreadyLeadResolved.has(normalizeName(r.artist))) resolvedDupeNames.push(r.artist);
    else releases.push(r);
  }
  if (resolvedDupeNames.length > 0) {
    logger.info(
      `Deezer: dropped ${resolvedDupeNames.length} candidate(s) already a known lead under ` +
        `Deezer's resolved name — ${resolvedDupeNames.join(', ')}`
    );
  }

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

  // Drop artists Matthew has already worked (My Artists roster) before scoring —
  // they should never surface as new leads.
  const { kept } = filterOutMyArtists(aggregated);

  const scored = scoreArtists(kept, config);
  // formatLeadsOutput ranks/stats these against just THIS run's new leads —
  // writeLeadsJSON merges them into the accumulated feed and re-ranks there,
  // so the numbers below are relative to this run's batch, not the final feed.
  const formatted = formatLeadsOutput(scored, config);
  const written = writeLeadsJSON(formatted);

  logger.info(formatted.leads.length ? 'New leads this run:' : 'No new leads this run.');
  for (const lead of formatted.leads) {
    logger.info(
      `  ${lead.artist} — ${lead.finalScore} (${lead.priority}) | ` +
        `${lead.genre ?? 'genre n/a'} t${lead.genreTier} | shows ${lead.scoring ? lead.tourCount : '?'} | avgVenue ${lead.avgVenueSize}`
    );
  }
  if (written) logger.success(`✓ ${formatted.leads.length} new lead(s) merged into leads.json`);
  else logger.info('leads.json preserved from a prior run (nothing new to add).');
  return formatted;
}

main().catch((err) => {
  logger.error('Automation failed:', err.response?.status ?? '', err.response?.data ?? err.message);
  process.exit(1);
});
