// Scoring layer: turn aggregated artist records into ranked, filtered leads.
//
// Base score is the sum of five dimensions (see rules below), then multiplied by
// the genre-tier multiplier and capped at 100. Note: the dimension header labels
// in the spec ("20 pts" for likelihood, "10 pts" for growth) disagree with the
// per-case rules (which reach 25 and 13); the RULES are implemented here, matching
// the spec's own example breakdown (likelihood 25, growth 10).

const logger = require('./utils/logger');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MONTH = MS_PER_DAY * 30.44; // avg month length, close enough for gap detection
const RECENT_RELEASE_DAYS = 60;
const COMEBACK_GAP_MONTHS = 12;
// releaseQualityScore thresholds (release-classifier.js) — how much of a
// window's releases are genuinely new original material vs. alt versions /
// remix-collab work. Exported so output.js's reasoning text stays in sync
// with the actual scoring cutoffs instead of drifting out of step.
const RELEASE_QUALITY_STRONG = 0.6;
const RELEASE_QUALITY_PARTIAL = 0.3;

// Find the most recent 12+ month gap between consecutive shows in an artist's
// all-time history (fullTourHistory — unbounded by the 18mo scoring window),
// i.e. the gap right before their current touring resumption, if any. Returns
// the gap size in months, or null if no such gap exists (steady touring, or
// too little history to have one).
function detectComebackGap(fullTourHistory) {
  if (!Array.isArray(fullTourHistory) || fullTourHistory.length < 2) return null;
  const dates = fullTourHistory
    .map((s) => (s.date ? new Date(`${s.date}T00:00:00Z`) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b); // oldest first

  // Walk backward from the most recent show so we find the gap closest to
  // "now" (the one that precedes the resumption), not just any old gap.
  for (let i = dates.length - 1; i > 0; i -= 1) {
    const gapMonths = (dates[i].getTime() - dates[i - 1].getTime()) / MS_PER_MONTH;
    if (gapMonths >= COMEBACK_GAP_MONTHS) return gapMonths;
  }
  return null;
}

// a. Touring track record (max 25).
// Zero shows in the scoring window reads two different ways depending on
// full (unbounded) history: an artist with NO shows ever is simply too new
// to have a track record yet (neutral, not a bad signal); an artist with
// past shows but none recently has actually stopped touring (real negative
// signal — the comeback case is handled separately via likelihood's
// comebackGapMonths, which rewards a fresh release breaking that gap).
function scoreTouring(a) {
  const t = a.tourCount || 0;
  if (t >= 3) return 25;
  if (t >= 1) return 15; // 1-2
  if (!(a.fullTourHistory || []).length) return 13; // no track record yet — neutral
  return 2; // toured before, none recently — a real pause/decline
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
// 'unknown' means contact-research.js found nothing at all (no Wikipedia
// infobox, no site) — that's an absence of evidence, not evidence of a big
// inaccessible machine, so it's scored neutral rather than penalized toward
// the confirmed-major-label/agency low end.
function scoreAccessibility(a) {
  switch (a?.managementType) {
    case 'self-managed': return 20;
    case 'indie-label': return 18;
    case 'indie-booking':
    case 'booking-agency': return 15;
    case 'major-agency':
    case 'major-label': return 8; // big machine — cold outreach unlikely to land
    case 'unknown': return 14; // couldn't find anything — neutral, not confirmed-inaccessible
    default: return 14;
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
//
// comebackGapMonths is set when fullTourHistory shows a 12+ month dead
// stretch right before the artist's most recent show — paired with a fresh
// release, that's a comeback: high opportunity (renewed momentum) and low
// competition (unlikely a tour manager is locked in yet). How confidently we
// call it a comeback depends on releaseQualityScore (release-classifier.js —
// the weighted ratio of full-original vs. alt-version vs. remix/collab
// releases in the window): strong original material scores the full top
// tier; a low ratio (mostly remix/collab work) is real activity but not
// evidence of a genuine new era, so it's held well below the top tier even
// though a real touring gap exists.
function scoreLikelihood(a, nowMs, comebackGapMonths) {
  const d = parseReleaseDateLoose(a.releaseDate);
  if (!d) return 0; // no release data
  const ageDays = (nowMs - d.getTime()) / MS_PER_DAY;
  if (ageDays > RECENT_RELEASE_DAYS) return 6; // older release

  // No release-quality data (older cached records, or an empty release list)
  // — default to full weight rather than penalizing on a guess.
  const q = a.releaseQualityScore ?? 1;

  if (comebackGapMonths != null) {
    if (q >= RELEASE_QUALITY_STRONG) return 25; // strong original material — comeback confirmed
    if (q >= RELEASE_QUALITY_PARTIAL) return 15; // genuine gap, but release mix is uncertain
    return 8; // mostly remix/collab work — real gap, but not a comeback claim
  }

  // No comeback gap — same release-quality gate applies to the "fresh
  // release" claim so the two branches don't diverge on what "recent
  // release" means.
  if (q < RELEASE_QUALITY_PARTIAL) return 6; // mostly remix/collab work, no gap either
  return (a.tourCount || 0) === 0 ? 25 : 8; // fresh (enough) original material
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
  const comebackGapMonths = detectComebackGap(a.fullTourHistory);
  const likelihood = scoreLikelihood(a, nowMs, comebackGapMonths);
  const growth = scoreGrowth(a);
  const baseScore = touring + listeners + accessibility + likelihood + growth;

  const genreMultiplier = a.genreMultiplier ?? 1.0;
  const finalScore = Math.round(Math.min(100, baseScore * genreMultiplier));

  return {
    ...a,
    baseScore,
    finalScore,
    scoring: {
      touring,
      listeners,
      accessibility,
      likelihood,
      growth,
      baseScore,
      genreMultiplier,
      finalScore,
      comebackGapMonths,
    },
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

module.exports = {
  scoreArtists,
  scoreArtist,
  priorityFor,
  detectComebackGap,
  RELEASE_QUALITY_STRONG,
  RELEASE_QUALITY_PARTIAL,
};
