// Output layer: shape scored artists into the final leads payload and persist it
// to data/leads.json (with run metadata + summary stats).

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const LEADS_PATH = path.join(__dirname, '..', 'data', 'leads.json');

function primaryGenre(a) {
  return a.genres?.[0]?.name ?? null;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Human-readable justification bullets for a lead.
function buildReasoning(a, config) {
  const reasons = [];

  if (a.releaseDate) {
    const noTour = (a.tourCount || 0) === 0;
    reasons.push(
      `Recent ${a.releaseType || 'release'} (${a.releaseDate})${noTour ? ' with no announced tour' : ', already touring'}`
    );
  } else {
    reasons.push('No recent release detected');
  }

  if ((a.setlistCount || 0) > 0) {
    const countries = a.countriesToured || 0;
    reasons.push(
      `${a.setlistCount} shows in past 18 months across ${countries} countr${countries === 1 ? 'y' : 'ies'}`
    );
  } else {
    reasons.push('No tour history in the last 18 months');
  }

  if ((a.avgVenueSize || 0) > 0) {
    const min = config?.scoringThresholds?.venueMin ?? 300;
    const max = config?.scoringThresholds?.venueMax ?? 5000;
    const inScale = a.avgVenueSize >= min && a.avgVenueSize <= max;
    reasons.push(
      `Average venue size ${a.avgVenueSize.toLocaleString()} cap${inScale ? " (Matthew's touring scale)" : ''}`
    );
  } else {
    reasons.push('Venue size unknown (no capacity data)');
  }

  // Genre fit is expressed by its preference multiplier (the internal tier
  // number is intentionally not surfaced in the UI).
  const g = primaryGenre(a);
  if (g) {
    const m = a.genreMultiplier ?? 1;
    const fit = m > 1 ? 'a preferred genre' : m < 1 ? 'a lower-preference genre' : 'a neutral-fit genre';
    reasons.push(`${g} — ${fit}`);
  }

  // Management accessibility.
  switch (a.managementType) {
    case 'self-managed':
      reasons.push('Self-managed — direct outreach possible');
      break;
    case 'indie-label':
      reasons.push(`Independent label${a.label ? ` (${a.label})` : ''} — reachable via label`);
      break;
    case 'indie-booking':
    case 'booking-agency':
      reasons.push('Booking-agency contact available');
      break;
    case 'major-agency':
      reasons.push(`Major agency${a.contactName ? ` (${a.contactName})` : ''} — cold email unlikely to land`);
      break;
    case 'major-label':
      reasons.push(`Major label${a.label ? ` (${a.label})` : ''} — likely represented, harder to reach`);
      break;
    default:
      reasons.push('Management contact not found — accessibility unverified');
  }

  return reasons;
}

// Map of artist name (lowercased) -> firstSeen ISO timestamp, read from the
// existing leads.json so an artist's original firstSeen is preserved across runs
// (it's only stamped the first time an artist appears). Missing file/field ->
// empty map, so everyone in this run is treated as newly seen.
function loadPriorFirstSeen(filePath = LEADS_PATH) {
  try {
    const prev = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const map = new Map();
    for (const l of prev.leads || []) {
      if (l.artist && l.firstSeen) map.set(l.artist.toLowerCase(), l.firstSeen);
    }
    return map;
  } catch {
    return new Map();
  }
}

// Build the full leads payload (metadata + stats + ranked leads) from scored,
// filtered, sorted artists.
function formatLeadsOutput(scoredArtists, config) {
  const generatedAt = new Date().toISOString();
  // Preserve each existing artist's original firstSeen; stamp new ones with now.
  const priorFirstSeen = loadPriorFirstSeen();

  const leads = (scoredArtists || []).map((a, i) => ({
    rank: i + 1,
    artist: a.artist,
    firstSeen: priorFirstSeen.get((a.artist || '').toLowerCase()) ?? generatedAt,
    spotifyId: a.spotifyId,
    deezerId: a.deezerId ?? null,
    mbid: a.mbid,
    listeners: a.listeners,
    lastfmListeners: a.lastfmListeners ?? null,
    lastfmTags: Array.isArray(a.lastfmTags) ? a.lastfmTags : [],
    discogsVerified: a.discogsVerified ?? false,
    releaseDate: a.releaseDate,
    releaseName: a.releaseName,
    genre: primaryGenre(a),
    genreTier: a.genreTier,
    imageUrl: a.imageUrl ?? null,
    recentReleases: Array.isArray(a.recentReleases) ? a.recentReleases.slice(0, 5) : [],
    finalScore: a.finalScore,
    priority: a.priority,
    baseScore: a.baseScore,
    genreMultiplier: a.genreMultiplier,
    scoring: a.scoring,
    tourCount: a.tourCount,
    avgVenueSize: a.avgVenueSize,
    topVenues: Array.isArray(a.topVenues) ? a.topVenues.slice(0, 3) : [],
    tourHistory: Array.isArray(a.tourHistory) ? a.tourHistory : [],
    countriesToured: a.countriesToured,
    lastTourDate: a.lastTourDate,
    managementType: a.managementType ?? 'unknown',
    contactName: a.contactName ?? null,
    contactEmail: a.contactEmail ?? null,
    contactSource: a.contactSource ?? 'none',
    websiteUrl: a.websiteUrl ?? null,
    socialLinks: a.socialLinks ?? { instagram: null, twitter: null, tiktok: null },
    contactConfidence: a.contactConfidence ?? 'low',
    fitReasoning: buildReasoning(a, config),
  }));

  const scores = leads.map((l) => l.finalScore);
  const stats = {
    avgScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : 0,
    medianScore: median(scores),
    priorityBreakdown: {
      immediate: leads.filter((l) => l.priority === 'immediate').length,
      high: leads.filter((l) => l.priority === 'high').length,
      qualified: leads.filter((l) => l.priority === 'qualified').length,
    },
  };

  return {
    generatedAt,
    genreTiers: config?.genrePreferenceTiers ?? null,
    totalLeads: leads.length,
    stats,
    leads,
  };
}

// Persist a formatted payload to data/leads.json. If the run produced 0 leads,
// the existing leads.json is preserved (not clobbered) and the empty run's
// metadata is saved to data/history/ for debugging instead.
function writeLeadsJSON(formatted, filePath = LEADS_PATH) {
  const count = formatted?.leads?.length ?? 0;

  if (count === 0) {
    logger.warn('0 leads generated this run — preserving previous leads.json');
    try {
      const histDir = path.join(path.dirname(filePath), 'history');
      fs.mkdirSync(histDir, { recursive: true });
      const stamp = (formatted?.generatedAt || new Date().toISOString()).replace(/[:.]/g, '-');
      const histPath = path.join(histDir, `run-${stamp}-empty.json`);
      fs.writeFileSync(histPath, `${JSON.stringify(formatted ?? { leads: [] }, null, 2)}\n`);
      logger.info(`Empty-run metadata saved to ${path.relative(process.cwd(), histPath)}`);
    } catch (err) {
      logger.warn(`Could not write empty-run history: ${err.message}`);
    }
    return null; // leads.json left untouched
  }

  fs.writeFileSync(filePath, `${JSON.stringify(formatted, null, 2)}\n`);
  logger.info(`Leads written to ${path.relative(process.cwd(), filePath)}`);
  return filePath;
}

module.exports = { formatLeadsOutput, writeLeadsJSON, buildReasoning, LEADS_PATH };
