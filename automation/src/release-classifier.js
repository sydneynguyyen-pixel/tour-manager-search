// Classifies a Deezer release title into a release-quality tier, so scoring
// can tell a genuine new-music comeback apart from lower-substance activity
// (alt versions of an existing song, remix/collab work) that signals the
// artist is active but isn't necessarily starting a new touring era.
//
// Heuristic, not exact: title-pattern matching on whole words only (so "edit"
// doesn't match "editorial", "vip" doesn't match inside another word). Some
// legitimate titles could rarely trip a pattern; acceptable given this is a
// soft scoring signal, not a hard filter. Ambiguous titles default to
// FULL_ORIGINAL rather than being penalized on a guess.

const TIERS = {
  FULL_ORIGINAL: 'FULL_ORIGINAL', // a genuinely new song
  SELF_REMIX: 'SELF_REMIX', // alt version of their own earlier work (acoustic, slowed, vip, flip, ...)
  OTHER_REMIX: 'OTHER_REMIX', // remix/collab work — weakest signal, often promotional
};

// Weight each tier contributes toward "this is real new original momentum".
const TIER_WEIGHT = {
  [TIERS.FULL_ORIGINAL]: 1.0,
  [TIERS.SELF_REMIX]: 0.5,
  [TIERS.OTHER_REMIX]: 0.15,
};

// Alt-version-of-own-work indicators — still the artist's own creative output,
// just not a brand new song.
const SELF_VERSION_PATTERN = /\b(acoustic|slowed|reverb(?:ed)?|sped[\s-]?up|stripped|live version|vip|flips?)\b/i;

// Remix/rmx indicators — checked after SELF_VERSION_PATTERN so "VIP"/"Flip"
// titles land in the alt-version tier even though they're remix-adjacent.
const OTHER_REMIX_PATTERN = /\b(remix(?:es)?|rmx)\b/i;

function classifyReleaseTier(title) {
  const t = title || '';
  if (SELF_VERSION_PATTERN.test(t)) return TIERS.SELF_REMIX;
  if (OTHER_REMIX_PATTERN.test(t)) return TIERS.OTHER_REMIX;
  return TIERS.FULL_ORIGINAL; // default when uncertain — don't over-classify as weak
}

// Summarize a list of { name, releaseDate, ... } releases (already filtered to
// the lookback window) into tier counts + a 0-1 releaseQualityScore:
//   (fullOriginal*1.0 + selfRemix*0.5 + otherRemix*0.15) / total
// null (not 0) when there are no releases to classify, so callers can tell
// "no data" apart from "confirmed all-weak activity".
function summarizeReleases(recentReleases) {
  const items = Array.isArray(recentReleases) ? recentReleases : [];
  const counts = { fullOriginal: 0, selfRemix: 0, otherRemix: 0 };
  const byRelease = [];

  for (const r of items) {
    const tier = classifyReleaseTier(r.name);
    if (tier === TIERS.FULL_ORIGINAL) counts.fullOriginal += 1;
    else if (tier === TIERS.SELF_REMIX) counts.selfRemix += 1;
    else counts.otherRemix += 1;
    byRelease.push({ name: r.name, tier });
  }

  const total = items.length;
  const weightedSum =
    counts.fullOriginal * TIER_WEIGHT[TIERS.FULL_ORIGINAL] +
    counts.selfRemix * TIER_WEIGHT[TIERS.SELF_REMIX] +
    counts.otherRemix * TIER_WEIGHT[TIERS.OTHER_REMIX];

  return {
    total,
    fullOriginalCount: counts.fullOriginal,
    selfRemixCount: counts.selfRemix,
    otherRemixCount: counts.otherRemix,
    releaseQualityScore: total > 0 ? weightedSum / total : null,
    byRelease,
  };
}

module.exports = { TIERS, TIER_WEIGHT, classifyReleaseTier, summarizeReleases };
