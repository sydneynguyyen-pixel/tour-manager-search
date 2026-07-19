// Plain-English scoring explanations. Centralizes all the wording so it's easy
// to adjust later, and derives sentences from the SAME raw fields the backend
// scoring uses (automation/src/score.js) — never fabricated.
//
// Maxes reflect the actual scoring rules in score.js: touring 25, venue-scale 25,
// accessibility 20, likelihood 25, growth 13. (The spec headers say 20/10 for the
// last two, but the rules reach 25/13 — see the note in score.js. Using the real
// maxes keeps the progress bars honest and never overflowing.)

// ---- Priority tiers (drives badge labels + the legend) ----------------------
export const SCORE_TIERS = [
  { key: 'immediate', min: 85, label: 'Immediate outreach', tone: 'green', dot: '🟢', range: '85+', blurb: 'strong fit, act soon' },
  { key: 'high', min: 70, label: 'High priority', tone: 'amber', dot: '🟡', range: '70–84', blurb: 'good fit, worth researching this week' },
  { key: 'look', min: 0, label: 'Worth a look', tone: 'red', dot: '🔴', range: 'Below 70', blurb: 'lower confidence, but may still be a real opportunity' },
];

export function getPriorityTier(score) {
  const s = score ?? 0;
  return SCORE_TIERS.find((t) => s >= t.min) || SCORE_TIERS[SCORE_TIERS.length - 1];
}

// ---- Dimensions -------------------------------------------------------------
export const DIMENSIONS = [
  { key: 'touring', label: 'Touring track record', max: 25, points: (s) => s.touring },
  { key: 'venue', label: 'Venue scale fit', max: 25, points: (s) => s.listeners },
  { key: 'management', label: 'How reachable is management', max: 20, points: (s) => s.accessibility },
  { key: 'timing', label: 'Tour timing', max: 25, points: (s) => s.likelihood },
  { key: 'momentum', label: 'Momentum', max: 13, points: (s) => s.growth },
];

function tours(n) {
  return `${n} ${n === 1 ? 'tour' : 'tours'}`;
}
function countries(n) {
  return `${n} ${n === 1 ? 'country' : 'countries'}`;
}

// Returns a one-line plain-English reason for a dimension, given the points it
// earned and the raw context. `value` (the points) encodes which scoring branch
// fired, so we can explain WHY without re-deriving the rule.
export function generateScoreExplanation(dimension, value, ctx = {}) {
  const tc = ctx.tourCount ?? 0;
  const venue = ctx.avgVenueSize ?? 0;
  const c = ctx.countriesToured ?? 0;

  switch (dimension) {
    case 'touring':
      if (tc <= 0) return 'First tour — just starting to build a track record';
      if (tc <= 2) return `${tours(tc)} in the past 18 months — an early but real touring history`;
      return `${tc} tours in the past 18 months — strong, consistent touring history`;

    case 'venue': {
      if (!venue) return 'Venue size unknown — no capacity data yet';
      const cap = venue.toLocaleString();
      if (venue >= 300 && venue <= 5000) return `Average venue ${cap} cap — right in your typical touring range`;
      if (venue < 300) return `Average venue ${cap} cap — smaller rooms, still an emerging act`;
      if (venue <= 10000) return `Average venue ${cap} cap — a bit bigger than your sweet spot, but workable`;
      return `Average venue ${cap} cap — large venues, likely past the ideal window`;
    }

    case 'management':
      switch (ctx.managementType) {
        case 'self-managed': return 'Self-managed — you can likely reach them directly';
        case 'indie-label': return 'Independent label — reachable through the label';
        case 'indie-booking':
        case 'booking-agency': return 'Booking agency listed — a clear contact path';
        case 'major-agency': return 'Major agency (WME/CAA-tier) — cold outreach is unlikely to land';
        case 'major-label': return 'Major label — likely represented, harder to reach directly';
        default: return 'Management info not found — worth a quick search before reaching out';
      }

    case 'timing':
      // `value` is the likelihood score, which encodes the branch that fired.
      if (value >= 25) {
        const rel = ctx.releaseName ? `"${ctx.releaseName}"` : 'New release';
        return `${rel} out with no tour announced yet — this is the window to reach out`;
      }
      if (value >= 8) return 'Fresh release, but already on the road — still a good moment to connect';
      if (value >= 6) return 'Last release was a while ago — no imminent tour push right now';
      return 'No recent release detected — no clear timing signal yet';

    case 'momentum':
      if (tc <= 0) return 'No recent touring — momentum still to build';
      if (c >= 5) return `${tours(tc)} across ${countries(c)} — active and growing`;
      return `${tours(tc)} in ${countries(c)} — building momentum`;

    default:
      return '';
  }
}

// Bar color for a single dimension, based on how full THAT bar is (not the
// artist's overall tier) — so strengths and weak spots stand out per-row.
export function barTone(fraction) {
  if (fraction >= 0.7) return 'green';
  if (fraction >= 0.4) return 'amber';
  return 'red';
}

// Build the full breakdown array for a lead: label, points/max, bar %, per-bar
// tone, and the plain-English reason for each dimension.
export function getScoreBreakdown(lead) {
  const s = lead.scoring || {};
  const ctx = {
    tourCount: lead.tourCount,
    avgVenueSize: lead.avgVenueSize,
    managementType: lead.managementType,
    releaseName: lead.releaseName,
    releaseDate: lead.releaseDate,
    countriesToured: lead.countriesToured,
  };
  return DIMENSIONS.map((d) => {
    const points = d.points(s) ?? 0;
    const fraction = Math.max(0, Math.min(1, points / d.max));
    return {
      key: d.key,
      label: d.label,
      max: d.max,
      points,
      pct: fraction * 100,
      tone: barTone(fraction),
      explanation: generateScoreExplanation(d.key, points, ctx),
    };
  });
}
