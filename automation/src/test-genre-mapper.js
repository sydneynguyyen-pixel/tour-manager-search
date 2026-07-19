// Unit checks for the genre normalization layer.
// Run with:  node src/test-genre-mapper.js   (from the automation/ directory)

const logger = require('./utils/logger');
const { mapGenreToTier, blendGenresToTier } = require('./genre-mapper');

let failures = 0;

function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    logger.success(`PASS ${label} -> ${JSON.stringify(actual)}`);
  } else {
    failures += 1;
    logger.error(`FAIL ${label} -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// --- mapGenreToTier: single-genre mapping, incl. the tricky ordering cases ---
logger.info('--- mapGenreToTier ---');
check('indie pop', mapGenreToTier('indie pop'), 1); // *pop
check('neo soul', mapGenreToTier('neo soul'), 1); // beats tier-3 "soul"
check('alternative r&b', mapGenreToTier('alternative r&b'), 1);
check('bedroom pop', mapGenreToTier('bedroom pop'), 2); // beats *pop
check('deep house', mapGenreToTier('deep house'), 2);
check('conscious hip hop', mapGenreToTier('conscious hip hop'), 2);
check('alternative rock', mapGenreToTier('alternative rock'), 3);
check('indie rock', mapGenreToTier('indie rock'), 3);
check('post-punk', mapGenreToTier('post-punk'), 3);
check('k-pop', mapGenreToTier('k-pop'), 4); // beats *pop
check('reggaeton', mapGenreToTier('reggaeton'), 4);
check('death metal', mapGenreToTier('death metal'), 4);
check('classical', mapGenreToTier('classical'), 4);
check('quijribo (unknown)', mapGenreToTier('quijribo'), null); // no match

// --- blendGenresToTier: full artist genre lists ---
logger.info('--- blendGenresToTier ---');

// Radiohead's real MusicBrainz genres (vote-weighted). Rock-dominant -> tier 3.
const radiohead = [
  { name: 'alternative rock', count: 41 },
  { name: 'art rock', count: 29 },
  { name: 'rock', count: 18 },
  { name: 'experimental rock', count: 14 },
  { name: 'electronic', count: 13 },
  { name: 'indie rock', count: 4 },
  { name: 'art pop', count: 3 },
  { name: 'electronica', count: 2 },
  { name: 'experimental', count: 2 },
  { name: 'ambient pop', count: 1 },
  { name: 'britpop', count: 1 },
  { name: 'chamber pop', count: 1 },
  { name: 'crossover prog', count: 1 },
  { name: 'electronic rock', count: 1 },
  { name: 'idm', count: 1 },
  { name: 'indietronica', count: 1 },
  { name: 'post-britpop', count: 1 },
  { name: 'post-grunge', count: 1 },
];
const rh = blendGenresToTier(radiohead);
logger.info(`Radiohead -> tier ${rh.tier} (decimal ${rh.decimalTier}, x${rh.multiplier})`);
check('Radiohead blended tier', rh.tier, 3);

// A pop-leaning artist -> tier 1.
const popArtist = [
  { name: 'pop', count: 50 },
  { name: 'indie pop', count: 30 },
  { name: 'dance pop', count: 10 },
];
const pa = blendGenresToTier(popArtist);
logger.info(`Pop artist -> tier ${pa.tier} (decimal ${pa.decimalTier}, x${pa.multiplier})`);
check('Pop artist blended tier', pa.tier, 1);

// A mixed EDM / hip-hop artist -> tier 2. ("edm" itself matches no rule and
// falls back to the neutral tier 2, which is correct here.)
const edmHipHop = [
  { name: 'house', count: 20 },
  { name: 'edm', count: 15 },
  { name: 'hip hop', count: 18 },
  { name: 'trap', count: 10 },
];
const eh = blendGenresToTier(edmHipHop);
logger.info(`EDM/hip-hop artist -> tier ${eh.tier} (decimal ${eh.decimalTier}, x${eh.multiplier})`);
check('EDM/hip-hop blended tier', eh.tier, 2);

// Edge: empty input -> null.
check('empty list', blendGenresToTier([]), null);

if (failures === 0) {
  logger.success('All genre-mapper checks passed.');
} else {
  logger.error(`${failures} genre-mapper check(s) failed.`);
  process.exit(1);
}
