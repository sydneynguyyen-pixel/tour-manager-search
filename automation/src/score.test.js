// Unit tests for the scoring layer. Pure/synchronous — no network.
// Run with:  node src/score.test.js   (from automation/)

const logger = require('./utils/logger');
const config = require('../config.json');
const { scoreArtists, scoreArtist } = require('./score');

let failures = 0;
function assert(cond, msg) {
  if (cond) logger.success(`PASS ${msg}`);
  else { failures += 1; logger.error(`FAIL ${msg}`); }
}

// Today is 2026-07-18 in this environment; use dates relative to that.
const RECENT = '2026-06-15'; // ~33 days ago (within 60)
const OLD = '2024-01-10'; // well over 60 days

// Base template; override per case.
function artist(overrides) {
  return {
    artist: 'Test',
    tourCount: 0,
    setlistCount: 0,
    avgVenueSize: 0,
    countriesToured: 0,
    releaseDate: null,
    releaseType: 'album',
    genres: [],
    genreTier: 2,
    genreMultiplier: 1.0,
    managementType: 'booking-agency', // accessibility 15 (keeps base-score expectations stable)
    ...overrides,
  };
}

// --- Case 1: strong artist -> high score (>= 85) -----------------------------
const strong = scoreArtist(
  artist({ artist: 'Strong', tourCount: 15, avgVenueSize: 1200, countriesToured: 8, releaseDate: RECENT, genreMultiplier: 1.0 }),
  config
);
logger.info(`Strong: base=${strong.baseScore}, final=${strong.finalScore}, breakdown=${JSON.stringify(strong.scoring)}`);
// touring25 + listeners25 + access15 + likelihood8 (touring>0) + growth13 = 86
assert(strong.baseScore === 86, 'strong base score = 86');
assert(strong.finalScore >= 85, 'strong artist scores >= 85');

// --- Case 2: weak artist -> low score (< 65) ---------------------------------
// Toured before (fullTourHistory has old shows) but none recently — a
// confirmed pause/decline, distinct from a brand-new artist with no track
// record at all (see Case 2b).
const weak = scoreArtist(
  artist({
    artist: 'Weak',
    tourCount: 0,
    avgVenueSize: 0,
    countriesToured: 0,
    releaseDate: OLD,
    genreMultiplier: 1.0,
    fullTourHistory: [{ date: '2019-03-01' }, { date: '2019-09-01' }],
  }),
  config
);
logger.info(`Weak: base=${weak.baseScore}, final=${weak.finalScore}, breakdown=${JSON.stringify(weak.scoring)}`);
// touring2 (toured before, stopped) + listeners15 + access15 + likelihood6 (old) + growth2 = 40
assert(weak.baseScore === 40, 'weak base score = 40');
assert(weak.finalScore < 65, 'weak artist scores < 65');

// --- Case 2b: brand-new artist, no track record at all -> touring neutral ----
const brandNew = scoreArtist(
  artist({ artist: 'BrandNew', tourCount: 0, releaseDate: OLD, genreMultiplier: 1.0, fullTourHistory: [] }),
  config
);
assert(brandNew.scoring.touring === 13, 'no shows ever -> touring 13 (neutral, not a bad signal)');
assert(brandNew.scoring.touring > weak.scoring.touring, 'brand-new scores higher than confirmed-paused on touring');

// --- Case 3: genre multiplier direction --------------------------------------
const common = { artist: 'Genre', tourCount: 15, avgVenueSize: 1200, countriesToured: 8, releaseDate: RECENT };
const tier1 = scoreArtist(artist({ ...common, genreTier: 1, genreMultiplier: config.genrePreferenceTiers.tier1.multiplier }), config);
const tier2 = scoreArtist(artist({ ...common, genreTier: 2, genreMultiplier: config.genrePreferenceTiers.tier2.multiplier }), config);
const tier4 = scoreArtist(artist({ ...common, genreTier: 4, genreMultiplier: config.genrePreferenceTiers.tier4.multiplier }), config);
logger.info(`Genre multiplier: tier1=${tier1.finalScore} (x${tier1.genreMultiplier}), tier2=${tier2.finalScore}, tier4=${tier4.finalScore} (x${tier4.genreMultiplier})`);
assert(tier1.finalScore > tier2.finalScore, 'tier 1 multiplier boosts vs tier 2');
assert(tier4.finalScore < tier2.finalScore, 'tier 4 multiplier depresses vs tier 2');

// --- Case 3b: management accessibility maps by managementType -----------------
const accBase = { artist: 'Acc', tourCount: 15, avgVenueSize: 1200, countriesToured: 8, releaseDate: RECENT, genreMultiplier: 1.0 };
const selfMgd = scoreArtist(artist({ ...accBase, managementType: 'self-managed' }), config);
const majorAg = scoreArtist(artist({ ...accBase, managementType: 'major-agency' }), config);
const unknownMgmt = scoreArtist(artist({ ...accBase, managementType: 'unknown' }), config);
assert(selfMgd.scoring.accessibility === 20, 'self-managed -> accessibility 20');
assert(majorAg.scoring.accessibility === 8, 'major-agency -> accessibility 8');
assert(unknownMgmt.scoring.accessibility === 14, 'unknown -> accessibility 14 (neutral: no evidence, not confirmed-inaccessible)');
assert(selfMgd.finalScore > unknownMgmt.finalScore && unknownMgmt.finalScore > majorAg.finalScore, 'accessibility ordering: self-managed > unknown > major-agency');

// --- Case 4: fresh release with NO tour -> likelihood 25 ----------------------
const opening = scoreArtist(
  artist({ artist: 'Window', tourCount: 0, releaseDate: RECENT, avgVenueSize: 800, genreMultiplier: 1.0 }),
  config
);
assert(opening.scoring.likelihood === 25, 'fresh release + no tours -> likelihood 25 (TM window)');

// --- Case 5: scoreArtists filters, ranks, and tiers priorities ----------------
const set = [
  artist({ artist: 'A-immediate', tourCount: 15, avgVenueSize: 1200, countriesToured: 8, releaseDate: RECENT, genreMultiplier: config.genrePreferenceTiers.tier1.multiplier }),
  artist({ artist: 'B-qualified', tourCount: 3, avgVenueSize: 400, countriesToured: 2, releaseDate: OLD, genreMultiplier: 1.0 }),
  artist({ artist: 'C-dropped', tourCount: 0, avgVenueSize: 0, countriesToured: 0, releaseDate: OLD, genreMultiplier: 1.0 }),
];
const ranked = scoreArtists(set, config);
logger.info(`Ranked: ${ranked.map((r) => `${r.artist}=${r.finalScore}/${r.priority}`).join(', ')}`);
assert(ranked.every((r, i) => i === 0 || ranked[i - 1].finalScore >= r.finalScore), 'results sorted by finalScore desc');
assert(!ranked.some((r) => r.artist === 'C-dropped'), 'below-minScore artist filtered out');
assert(ranked[0].priority === 'immediate' || ranked[0].priority === 'high', 'top artist has an elevated priority');
assert(ranked.every((r) => r.finalScore >= (config.scoringThresholds.minScore ?? 60)), 'all leads meet minScore');

// --- Case 6: Ticketmaster confirmation is additive, not a likelihood override -
// Same "fresh release, no tour yet" artist as Case 4 (likelihood already 25)
// plus a just-listed Ticketmaster date should score HIGHER than Case 4 alone
// — confirming the bonus stacks on top instead of being absorbed by
// likelihood's existing ceiling.
const confirmedRecent = scoreArtist(
  artist({
    artist: 'ConfirmedRecent',
    tourCount: 0,
    releaseDate: RECENT,
    avgVenueSize: 800,
    genreMultiplier: 1.0,
    hasUpcomingEvents: true,
    ticketmasterEarliestOnSaleDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
  }),
  config
);
assert(confirmedRecent.scoring.likelihood === 25, 'confirmed-tour case keeps likelihood at its own inferred value (25)');
assert(confirmedRecent.scoring.ticketmasterBonus === 15, 'on-sale within 30 days -> ticketmasterBonus 15 (prime window)');
assert(confirmedRecent.finalScore > opening.finalScore, 'a confirmed recent listing scores higher than the inferred-only case');

const confirmedLong = scoreArtist(
  artist({
    artist: 'ConfirmedLong',
    tourCount: 0,
    releaseDate: RECENT,
    avgVenueSize: 800,
    genreMultiplier: 1.0,
    hasUpcomingEvents: true,
    ticketmasterEarliestOnSaleDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(), // ~6.5mo ago
  }),
  config
);
assert(confirmedLong.scoring.ticketmasterBonus === 6, 'on-sale 90+ days ago -> ticketmasterBonus 6 (long-listed, lower opportunity)');
assert(confirmedRecent.finalScore > confirmedLong.finalScore, 'recently-listed scores higher than long-listed');

const confirmedUnknownRecency = scoreArtist(
  artist({ artist: 'ConfirmedUnknown', releaseDate: OLD, genreMultiplier: 1.0, hasUpcomingEvents: true }),
  config
);
assert(confirmedUnknownRecency.scoring.ticketmasterBonus === 10, 'confirmed but no on-sale date -> ticketmasterBonus 10 (unknown recency, still real)');

assert(weak.scoring.ticketmasterBonus === 0, 'no Ticketmaster data -> ticketmasterBonus 0 (existing cases unaffected)');

// --- Case 7: JamBase gets the same treatment as Ticketmaster, independently -
const jambaseRecent = scoreArtist(
  artist({
    artist: 'JamBaseRecent',
    tourCount: 0,
    releaseDate: RECENT,
    avgVenueSize: 800,
    genreMultiplier: 1.0,
    hasJamBaseEvents: true,
    jambaseEarliestListedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
  }),
  config
);
assert(jambaseRecent.scoring.jambaseBonus === 15, 'JamBase listed within 30 days -> jambaseBonus 15 (prime window)');
assert(jambaseRecent.scoring.ticketmasterBonus === 0, 'JamBase-only confirmation does not also credit a Ticketmaster bonus');
assert(jambaseRecent.finalScore > opening.finalScore, 'a JamBase-confirmed listing scores higher than the inferred-only case');

const jambaseLong = scoreArtist(
  artist({
    artist: 'JamBaseLong',
    tourCount: 0,
    releaseDate: RECENT,
    avgVenueSize: 800,
    genreMultiplier: 1.0,
    hasJamBaseEvents: true,
    jambaseEarliestListedDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
  }),
  config
);
assert(jambaseLong.scoring.jambaseBonus === 6, 'JamBase listed 90+ days ago -> jambaseBonus 6 (long-listed)');

assert(weak.scoring.jambaseBonus === 0, 'no JamBase data -> jambaseBonus 0 (existing cases unaffected)');

// --- Case 8: both sources confirming stacks higher than either alone --------
// Two independent vendors agreeing is stronger evidence than one, so the
// bonuses should simply add rather than one crowding out the other.
const bothConfirmed = scoreArtist(
  artist({
    artist: 'BothConfirmed',
    tourCount: 0,
    releaseDate: RECENT,
    avgVenueSize: 800,
    genreMultiplier: 1.0,
    hasUpcomingEvents: true,
    ticketmasterEarliestOnSaleDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    hasJamBaseEvents: true,
    jambaseEarliestListedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  }),
  config
);
assert(bothConfirmed.scoring.ticketmasterBonus === 15, 'both-confirmed case still scores its own Ticketmaster bonus');
assert(bothConfirmed.scoring.jambaseBonus === 15, 'both-confirmed case still scores its own JamBase bonus');
assert(
  bothConfirmed.finalScore > confirmedRecent.finalScore,
  'confirmation from both sources scores higher than Ticketmaster alone'
);
assert(
  bothConfirmed.finalScore > jambaseRecent.finalScore,
  'confirmation from both sources scores higher than JamBase alone'
);

if (failures > 0) { logger.error(`${failures} check(s) failed.`); process.exit(1); }
logger.success('Scoring checks passed.');
