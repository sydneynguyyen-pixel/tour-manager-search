// Genre normalization layer.
//
// MusicBrainz genres are granular and free-form ("alternative rock", "art pop",
// "neo soul"), while config.json scores by four broad preference tiers. This
// module maps each MusicBrainz genre onto a tier, then blends an artist's full
// (vote-weighted) genre list into a single tier + multiplier for scoring.
//
// Multipliers are read from config.json so the two stay in sync.

const config = require('../config.json');

const FALLBACK_TIER = 2; // neutral tier for genres that match no rule

const TIER_MULTIPLIERS = {
  1: config.genrePreferenceTiers.tier1.multiplier,
  2: config.genrePreferenceTiers.tier2.multiplier,
  3: config.genrePreferenceTiers.tier3.multiplier,
  4: config.genrePreferenceTiers.tier4.multiplier,
};

// Ordered rules — FIRST MATCH WINS. Ordering is SPECIFIC -> GENERIC on purpose:
// a broad wildcard must never steal a genre a narrower rule should own. E.g.
// "k-pop"/"j-pop" (tier4) and "bedroom pop" (tier2) both end in "pop" but must
// be caught before the generic "*pop -> tier1" rule; "neo soul" (tier1) must be
// caught before the "soul -> tier3" rule.
const RULES = [
  // Tier 4 — must precede the generic "*pop" rule
  { tier: 4, match: (g) => g.includes('k-pop') || g.includes('j-pop') },
  { tier: 4, match: (g) => g.includes('bollywood') },

  // Tier 2 — "bedroom pop" must precede the generic "*pop" rule
  { tier: 2, match: (g) => g.includes('bedroom pop') },

  // Tier 1 — "neo soul" must precede the tier-3 "soul" rule
  { tier: 1, match: (g) => g.includes('neo soul') },

  // Tier 1
  { tier: 1, match: (g) => g.includes('r&b') }, // also covers "alternative r&b"

  // Tier 2
  { tier: 2, match: (g) => g.includes('hip hop') || g.includes('hip-hop') || g.includes('rap') },
  {
    tier: 2,
    match: (g) =>
      g.startsWith('electronic') ||
      g.includes('house') ||
      g.includes('dubstep') ||
      g.includes('techno') ||
      g.includes('drum and bass'),
  },

  // Tier 4 — metal / classical / latin. Placed before the "*rock"/"soul" rules;
  // "electronic rock" is intentionally already tier 2 via the rule above.
  { tier: 4, match: (g) => g.endsWith('metal') },
  { tier: 4, match: (g) => g.includes('classical') || g.includes('reggaeton') || g.includes('latin') },

  // Tier 3 — all rock (incl. "indie rock"), plus folk/country/emo/punk/soul/etc.
  { tier: 3, match: (g) => g.endsWith('rock') },
  {
    tier: 3,
    match: (g) =>
      g.includes('folk') ||
      g.includes('country') ||
      g.includes('emo') ||
      g.includes('punk') ||
      g.includes('soul') ||
      g.includes('singer-songwriter') ||
      g.includes('americana'),
  },

  // Tier 1 — generic "*pop" LAST, after every specific pop/soul exclusion above.
  { tier: 1, match: (g) => g.endsWith('pop') },
];

// Map a single genre name to a tier (1-4), or null if nothing matches.
function mapGenreToTier(genreName) {
  if (!genreName) return null;
  const g = String(genreName).toLowerCase().trim();
  for (const rule of RULES) {
    if (rule.match(g)) return rule.tier;
  }
  return null;
}

// Blend a MusicBrainz genre list into a single weighted tier.
// Input: [{ name, count }]  (count = MusicBrainz vote weight)
// Returns: { tier, decimalTier, multiplier, breakdown } or null for no input.
//   - tier         rounded 1-4 (use for a clean tier bucket)
//   - decimalTier  precise weighted average (use for fine-grained scoring)
//   - multiplier   config multiplier for the rounded tier
// Unmatched genres are counted as the neutral FALLBACK_TIER.
function blendGenresToTier(genresList) {
  if (!Array.isArray(genresList) || genresList.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  const breakdown = [];

  for (const { name, count } of genresList) {
    const mapped = mapGenreToTier(name);
    const tier = mapped ?? FALLBACK_TIER;
    const weight = Number(count) > 0 ? Number(count) : 1; // guard 0/missing counts
    weightedSum += tier * weight;
    totalWeight += weight;
    breakdown.push({ name, tier, weight, matched: mapped !== null });
  }

  if (totalWeight === 0) return null;

  const decimalTier = weightedSum / totalWeight;
  const tier = Math.min(4, Math.max(1, Math.round(decimalTier)));

  return {
    tier,
    decimalTier: Number(decimalTier.toFixed(2)),
    multiplier: TIER_MULTIPLIERS[tier],
    breakdown,
  };
}

module.exports = { mapGenreToTier, blendGenresToTier, TIER_MULTIPLIERS, FALLBACK_TIER };
