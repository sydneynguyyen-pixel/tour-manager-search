// Aggregation layer: merge Deezer releases + Setlist.fm tour history by artist,
// enrich each with MusicBrainz genres/tier plus supplementary metadata from
// TheAudioDB (image + social gaps), Last.fm (listener/tag signal), and Discogs
// (discography cross-check), and emit one unified record per unique artist for
// the scoring stage.
//
// Per-artist enrichment order (mirrors the source priority): release data is
// already resolved (Deezer, upstream) -> MusicBrainz genres -> TheAudioDB image
// + social gap-fill -> Last.fm listener/tags (+ genre cross-check vs MB) ->
// Discogs cross-check -> contact research. All enrichment sources fail soft
// (null-filled) so one flaky source never drops an artist.

const logger = require('./utils/logger');
const { getArtistGenres } = require('./musicbrainz');
const { blendGenresToTier } = require('./genre-mapper');
const { researchArtistContact, saveCache: saveContactCache } = require('./scrapers/contact-research');
const { getArtistProfile } = require('./scrapers/audiodb-scraper');
const { getLastFmProfile, logTagCrossCheck } = require('./scrapers/lastfm-scraper');
const { getDiscogsReleases } = require('./scrapers/discogs-scraper');

// Case-insensitive, whitespace-normalized key for joining across sources.
function normalizeName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

async function aggregateArtistData(releases, setlistfmTourData, config) {
  // Index Setlist.fm tour history by normalized artist name.
  const tourByName = new Map();
  for (const t of setlistfmTourData || []) {
    tourByName.set(normalizeName(t.artist), t);
  }

  // Group release records (Deezer) by artist, keeping the most recent release as
  // the representative (dedupe by artist).
  const releasesByName = new Map();
  for (const r of releases || []) {
    const key = normalizeName(r.artist);
    const existing = releasesByName.get(key);
    if (!existing || (r.releaseDate || '') > (existing.releaseDate || '')) {
      releasesByName.set(key, r);
    }
  }

  const allKeys = new Set([...releasesByName.keys(), ...tourByName.keys()]);
  const neutralMultiplier = config?.genrePreferenceTiers?.tier2?.multiplier ?? 1.0;
  const results = [];

  for (const key of allKeys) {
    const rel = releasesByName.get(key) || null;
    const tour = tourByName.get(key) || null;
    if (!rel && !tour) continue; // nothing to build from

    const displayName = rel?.artist || tour?.artist || key;
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

    // TheAudioDB — image fallback + additional social links (gap-fill only).
    const audiodb = await getArtistProfile(displayName);

    // Last.fm — supplementary listener/scrobble signal + genre tags. Cross-check
    // its tags against the MusicBrainz genres (logged only; MB stays canonical).
    const lastfm = await getLastFmProfile(displayName);
    logTagCrossCheck(displayName, lastfm.lastfmTags, genres);

    // Discogs — non-blocking discography cross-check / confidence booster.
    const discogs = await getDiscogsReleases(displayName);

    // Management/booking accessibility (web + Wikipedia; no music-API calls).
    let contact;
    try {
      contact = await researchArtistContact(displayName, rel?.deezerId ?? null);
    } catch (err) {
      logger.warn(`Aggregate: contact research failed for "${displayName}" (${err.message}).`);
      contact = { managementType: 'unknown', contactName: null, contactEmail: null, contactSource: 'none', websiteUrl: null, socialLinks: { instagram: null, twitter: null, tiktok: null }, confidence: 'low', label: null };
    }

    // Gap-fill website + socials from TheAudioDB WITHOUT overwriting the
    // contact-research findings (contact-research wins; AudioDB only fills nulls).
    const cSocials = contact.socialLinks || {};
    const aSocials = audiodb.socialLinks || {};
    const socialLinks = {
      instagram: cSocials.instagram ?? aSocials.instagram ?? null,
      twitter: cSocials.twitter ?? aSocials.twitter ?? null,
      tiktok: cSocials.tiktok ?? null,
    };
    const websiteUrl = contact.websiteUrl ?? audiodb.websiteUrl ?? null;

    results.push({
      artist: displayName,
      spotifyId: null, // Spotify removed; retained as null for downstream shape compatibility
      deezerId: rel?.deezerId ?? null,
      mbid,
      followers: null,
      listeners: null, // no listener count feeds scoring yet; see lastfmListeners
      lastfmListeners: lastfm.lastfmListeners ?? null,
      lastfmPlaycount: lastfm.lastfmPlaycount ?? null,
      lastfmTags: lastfm.lastfmTags ?? [],
      discogsVerified: discogs.discogsVerified ?? false,
      discogsReleaseCount: discogs.releaseCount ?? 0,
      releaseDate: rel?.releaseDate ?? null,
      releaseName: rel?.releaseName ?? null,
      releaseType: rel?.releaseType ?? null,
      imageUrl: rel?.imageUrl ?? audiodb.imageUrl ?? null, // Deezer artist photo; AudioDB fallback
      recentReleases: rel?.recentReleases ?? [], // additive display data; no effect on scoring
      tourCount: tour?.tourCount ?? 0,
      setlistCount: tour?.setlistCount ?? 0,
      avgVenueSize: tour?.avgVenueSize ?? 0,
      minVenueSize: tour?.minVenueSize ?? 0,
      maxVenueSize: tour?.maxVenueSize ?? 0,
      topVenues: tour?.topVenues ?? [], // biggest venues played (top 3), display-only
      tourHistory: tour?.tourHistory ?? [], // full per-show list (newest first), display-only

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
      websiteUrl, // contact-research first, TheAudioDB gap-fill
      socialLinks, // contact-research first, TheAudioDB gap-fill
      label: contact.label ?? null,
      contactConfidence: contact.confidence ?? 'low',
    });
  }

  saveContactCache(); // persist any newly-researched contacts
  logger.count('Aggregated artists', results.length);
  return results;
}

module.exports = { aggregateArtistData, normalizeName };
