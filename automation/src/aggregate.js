// Aggregation layer: merge Spotify releases + Setlist.fm tour history by artist,
// enrich each with MusicBrainz genres and a blended genre tier, and emit one
// unified record per unique artist for the scoring stage.

const logger = require('./utils/logger');
const { getArtistGenres } = require('./musicbrainz');
const { blendGenresToTier } = require('./genre-mapper');
const { researchArtistContact, saveCache: saveContactCache } = require('./scrapers/contact-research');

// Case-insensitive, whitespace-normalized key for joining across sources.
function normalizeName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

async function aggregateArtistData(spotifyReleases, setlistfmTourData, config) {
  // Index Setlist.fm tour history by normalized artist name.
  const tourByName = new Map();
  for (const t of setlistfmTourData || []) {
    tourByName.set(normalizeName(t.artist), t);
  }

  // Group Spotify releases by artist, keeping the most recent release as the
  // representative (dedupe by artist).
  const spotifyByName = new Map();
  for (const r of spotifyReleases || []) {
    const key = normalizeName(r.artist);
    const existing = spotifyByName.get(key);
    if (!existing || (r.releaseDate || '') > (existing.releaseDate || '')) {
      spotifyByName.set(key, r);
    }
  }

  const allKeys = new Set([...spotifyByName.keys(), ...tourByName.keys()]);
  const neutralMultiplier = config?.genrePreferenceTiers?.tier2?.multiplier ?? 1.0;
  const results = [];

  for (const key of allKeys) {
    const sp = spotifyByName.get(key) || null;
    const tour = tourByName.get(key) || null;
    if (!sp && !tour) continue; // nothing to build from

    const displayName = sp?.artist || tour?.artist || key;
    const mbid = tour?.mbid || null;

    // Genres require an mbid (from Setlist.fm). Without one, fall back to neutral.
    let genres = [];
    if (mbid) {
      try {
        genres = await getArtistGenres(mbid);
      } catch (err) {
        logger.warn(`Aggregate: genre lookup failed for "${displayName}" (${err.response?.status ?? err.message}).`);
      }
    } else {
      logger.warn(`Aggregate: no mbid for "${displayName}" — genres unavailable, using neutral tier.`);
    }

    const blend = blendGenresToTier(genres); // null when no genres
    const genreTier = blend?.tier ?? 2;
    const genreDecimalTier = blend?.decimalTier ?? 2;
    const genreMultiplier = blend?.multiplier ?? neutralMultiplier;

    // Management/booking accessibility (web + Wikipedia; does not touch Spotify).
    let contact;
    try {
      contact = await researchArtistContact(displayName, sp?.spotifyId ?? null);
    } catch (err) {
      logger.warn(`Aggregate: contact research failed for "${displayName}" (${err.message}).`);
      contact = { managementType: 'unknown', contactName: null, contactEmail: null, contactSource: 'none', websiteUrl: null, socialLinks: { instagram: null, twitter: null, tiktok: null }, confidence: 'low', label: null };
    }

    results.push({
      artist: displayName,
      spotifyId: sp?.spotifyId ?? null,
      mbid,
      followers: sp?.followers ?? null,
      listeners: sp?.followers ?? null, // proxy; null under the restricted token
      releaseDate: sp?.releaseDate ?? null,
      releaseName: sp?.releaseName ?? null,
      releaseType: sp?.releaseType ?? null,
      imageUrl: sp?.imageUrl ?? null,
      recentReleases: sp?.recentReleases ?? [], // additive display data; no effect on scoring
      tourCount: tour?.tourCount ?? 0,
      setlistCount: tour?.setlistCount ?? 0,
      avgVenueSize: tour?.avgVenueSize ?? 0,
      minVenueSize: tour?.minVenueSize ?? 0,
      maxVenueSize: tour?.maxVenueSize ?? 0,
      topVenues: tour?.topVenues ?? [], // biggest venues played (top 3), display-only

      countriesToured: tour?.countriesToured ?? 0,
      lastTourDate: tour?.lastTourDate ?? null,
      genres,
      genreTier,
      genreDecimalTier,
      genreMultiplier,
      managementType: contact.managementType,
      contactName: contact.contactName ?? null,
      contactEmail: contact.contactEmail ?? null,
      contactSource: contact.contactSource ?? 'none',
      websiteUrl: contact.websiteUrl ?? null,
      socialLinks: contact.socialLinks ?? { instagram: null, twitter: null, tiktok: null },
      label: contact.label ?? null,
      contactConfidence: contact.confidence ?? 'low',
    });
  }

  saveContactCache(); // persist any newly-researched contacts
  logger.count('Aggregated artists', results.length);
  return results;
}

module.exports = { aggregateArtistData, normalizeName };
