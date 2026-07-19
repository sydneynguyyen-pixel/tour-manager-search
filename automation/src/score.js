// Scoring layer: turn aggregated artist records into ranked, filtered leads.
//
// Base score is the sum of five dimensions (see rules below), then multiplied by
// the genre-tier multiplier and capped at 100. Note: the dimension header labels
// in the spec ("20 pts" for likelihood, "10 pts" for growth) disagree with the
// per-case rules (which reach 25 and 13); the RULES are implemented here, matching
// the spec's own example breakdown (likelihood 25, growth 10).

const logger = require('./utils/logger');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECENT_RELEASE_DAYS = 60;

// a. Touring track record (max 25).
function scoreTouring(a) {
  const t = a.tourCount || 0;
  if (t >= 3) return 25;
  if (t >= 1) return 15; // 1-2
  return 2; // 0
}

// b. Listener scale fit — avgVenueSize as a proxy for artist scale (max 25).
function scoreListeners(a) {
  const v = a.avgVenueSize || 0;
  if (v === 0) return 15; // no venue data -> neutral
  if (v >= 300 && v <= 5000) return 25; // sweet spot
  if (v >= 100 && v <= 299) return 15; // emerging
  if (v >= 5001 && v <= 10000) return 20; // mid-tier
  if (v >= 10001) return 10; // large venues
  return 15; // 1-99: treat as emerging/neutral
}

// c. Management accessibility — from the researched managementType (contact-research.js).
// More accessible management scores higher (easier for Matthew to reach directly).
function scoreAccessibility(a) {
  switch (a?.managementType) {
    case 'self-managed': return 20;
    case 'indie-label': return 18;
    case 'indie-booking':
    case 'booking-agency': return 15;
    case 'major-agency':
    case 'major-label': return 8; // big machine — cold outreach unlikely to land
    case 'unknown': return 10; // couldn't verify accessibility
    default: return 10;
  }
}

// Parse a possibly year/month-precision release date into a Date, or null.
function parseReleaseDateLoose(s) {
  if (!s) return null;
  const iso = s.length === 4 ? `${s}-01-01` : s.length === 7 ? `${s}-01` : s;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// d. Tour likelihood — keyed on release recency vs tour activity (max 25).
function scoreLikelihood(a, nowMs) {
  const d = parseReleaseDateLoose(a.releaseDate);
  if (!d) return 0; // no release data
  const ageDays = (nowMs - d.getTime()) / MS_PER_DAY;
  if (ageDays <= RECENT_RELEASE_DAYS) {
    return (a.tourCount || 0) === 0 ? 25 : 8; // fresh release, TM window opening vs already touring
  }
  return 6; // older release
}

// e. Growth trajectory — tour frequency proxy + international bonus (max 13).
function scoreGrowth(a) {
  const t = a.tourCount || 0;
  let g = t >= 5 ? 10 : t >= 1 ? 6 : 2;
  if ((a.countriesToured || 0) >= 5) g += 3;
  return g;
}

// Compute the full scored record for a single artist (no filtering/priority).
function scoreArtist(a, config, nowMs = Date.now()) {
  const touring = scoreTouring(a);
  const listeners = scoreListeners(a);
  const accessibility = scoreAccessibility(a);
  const likelihood = scoreLikelihood(a, nowMs);
  const growth = scoreGrowth(a);
  const baseScore = touring + listeners + accessibility + likelihood + growth;

  const genreMultiplier = a.genreMultiplier ?? 1.0;
  const finalScore = Math.round(Math.min(100, baseScore * genreMultiplier));

  return {
    ...a,
    baseScore,
    finalScore,
    scoring: { touring, listeners, accessibility, likelihood, growth, baseScore, genreMultiplier, finalScore },
  };
}

function priorityFor(finalScore, config) {
  const immediate = config?.scoringThresholds?.immediateOutreach ?? 85;
  if (finalScore >= immediate) return 'immediate';
  if (finalScore >= 70) return 'high';
  return 'qualified'; // 60-69 (already >= minScore)
}

// Score all artists, filter to >= minScore, assign a priority tier, and sort by
// finalScore descending.
function scoreArtists(aggregatedData, config) {
  const nowMs = Date.now();
  const minScore = config?.scoringThresholds?.minScore ?? 60;

  const scored = (aggregatedData || []).map((a) => scoreArtist(a, config, nowMs));
  const qualified = scored
    .filter((a) => a.finalScore >= minScore)
    .map((a) => ({ ...a, priority: priorityFor(a.finalScore, config) }))
    .sort((x, y) => y.finalScore - x.finalScore);

  logger.info(`Scored ${scored.length} artist(s); ${qualified.length} met minScore ${minScore}.`);
  return qualified;
}

module.exports = { scoreArtists, scoreArtist, priorityFor };
