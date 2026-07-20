// Aggregation layer: merge Deezer releases + Setlist.fm tour history by artist,
// enrich each with MusicBrainz genres/tier plus supplementary metadata from
// TheAudioDB (image + social gaps), Last.fm (listener/tag signal), Discogs
// (discography cross-check), music-news RSS coverage, and two independent
// confirmed-tour sources (Ticketmaster, JamBase), and emit one unified record
// per unique artist for the scoring stage.
//
// Per-artist enrichment order (mirrors the source priority): release data is
// already resolved (Deezer, upstream) -> MusicBrainz genres -> TheAudioDB image
// + social gap-fill -> Last.fm listener/tags (+ genre cross-check vs MB) ->
// Discogs cross-check -> RSS news mentions -> Ticketmaster confirmed events ->
// JamBase confirmed events (funnel-gated — see call site) -> contact
// research. All enrichment sources fail soft (null-filled) so one flaky
// source never drops an artist.

const logger = require('./utils/logger');
const { getArtistGenres } = require('./musicbrainz');
const { blendGenresToTier } = require('./genre-mapper');
const { researchArtistContact, saveCache: saveContactCache } = require('./scrapers/contact-research');
const { getArtistProfile } = require('./scrapers/audiodb-scraper');
const { getLastFmProfile, logTagCrossCheck } = require('./scrapers/lastfm-scraper');
const { getDiscogsReleases } = require('./scrapers/discogs-scraper');
const { getWikidataSocialLinks } = require('./scrapers/wikidata-scraper');
const { checkArtistInRecentNews } = require('./scrapers/rss-scraper');
const { getTicketmasterEvents } = require('./scrapers/ticketmaster-scraper');
const { getJamBaseEvents } = require('./scrapers/jambase-scraper');
const { summarizeReleases } = require('./release-classifier');

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

    // Music-news RSS — supplementary "is anyone writing about this artist
    // right now" signal, display-only for now (not fed into scoring; see
    // rss-scraper.js and score.js's comments on why new signals start
    // observational before being weighted).
    let news;
    try {
      news = await checkArtistInRecentNews(displayName);
    } catch (err) {
      logger.warn(`Aggregate: RSS news check failed for "${displayName}" (${err.message}).`);
      news = { mentioned: false, articles: [] };
    }

    // Ticketmaster — confirmed on-sale tour dates. The strongest possible
    // touring-timing signal (verified vs. every other signal here, which is
    // inferred); see score.js's scoreTicketmasterBonus for how it layers in.
    let ticketmaster;
    try {
      ticketmaster = await getTicketmasterEvents(displayName);
    } catch (err) {
      logger.warn(`Aggregate: Ticketmaster lookup failed for "${displayName}" (${err.message}).`);
      ticketmaster = { hasUpcomingEvents: false, events: [], eventCount: 0, earliestOnSaleDate: null };
    }

    // JamBase — a second, independent confirmed-tour source alongside
    // Ticketmaster (same treatment in score.js: an additive bonus, not a
    // replacement). Unlike Ticketmaster this tier is metered and billed past
    // 1,000 calls/month, so it's ONLY queried for candidates that already
    // cleared the release + Setlist.fm funnel (both `rel` and `tour` present)
    // — not every raw discovered candidate. See jambase-usage.js for the
    // budget tracker jambase-scraper.js itself checks before calling.
    let jambase;
    if (rel && tour) {
      try {
        jambase = await getJamBaseEvents(displayName);
      } catch (err) {
        logger.warn(`Aggregate: JamBase lookup failed for "${displayName}" (${err.message}).`);
        jambase = { hasUpcomingEvents: false, events: [], eventCount: 0, earliestListedDate: null };
      }
    } else {
      jambase = { hasUpcomingEvents: false, events: [], eventCount: 0, earliestListedDate: null };
    }

    // Management/booking accessibility (web + Wikipedia; no music-API calls).
    let contact;
    try {
      contact = await researchArtistContact(displayName, rel?.deezerId ?? null);
    } catch (err) {
      logger.warn(`Aggregate: contact research failed for "${displayName}" (${err.message}).`);
      contact = { managementType: 'unknown', contactName: null, contactEmail: null, contactSource: 'none', websiteUrl: null, socialLinks: { instagram: null, twitter: null, tiktok: null, youtube: null, facebook: null }, confidence: 'low', label: null };
    }

    // Wikidata — PRIMARY social/YouTube link source: structured per-platform
    // identifiers, more reliable than scraping prose/infoboxes.
    let wikidata;
    try {
      wikidata = await getWikidataSocialLinks(displayName);
    } catch (err) {
      logger.warn(`Aggregate: Wikidata lookup failed for "${displayName}" (${err.message}).`);
      wikidata = { instagram: null, twitter: null, youtube: null, facebook: null, tiktok: null };
    }

    // Merge socials with fallback priority: Wikidata -> Wikipedia (infobox +
    // External Links, already merged in contact-research) -> TheAudioDB.
    // First non-null wins per platform; nothing overwrites a better result.
    const cSocials = contact.socialLinks || {};
    const aSocials = audiodb.socialLinks || {};
    const socialLinks = {
      instagram: wikidata.instagram ?? cSocials.instagram ?? aSocials.instagram ?? null,
      twitter: wikidata.twitter ?? cSocials.twitter ?? aSocials.twitter ?? null,
      tiktok: wikidata.tiktok ?? cSocials.tiktok ?? null,
      youtube: wikidata.youtube ?? cSocials.youtube ?? null,
      facebook: wikidata.facebook ?? cSocials.facebook ?? aSocials.facebook ?? null,
    };
    const websiteUrl = contact.websiteUrl ?? audiodb.websiteUrl ?? null;

    // Release-quality classification of this window's releases (full
    // original / self-remix-alt-version / other-remix) — feeds the
    // tour-timing dimension's release-quality-weighted comeback scoring in
    // score.js.
    const releaseSummary = summarizeReleases(rel?.recentReleases);

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
      lastfmBio: lastfm.bio ?? null, // HTML already stripped in the scraper; display-only
      audiodbBio: audiodb.bio ?? null, // raw strBiographyEN; display-only
      discogsVerified: discogs.discogsVerified ?? false,
      discogsReleaseCount: discogs.releaseCount ?? 0,
      releaseDate: rel?.releaseDate ?? null,
      releaseName: rel?.releaseName ?? null,
      releaseType: rel?.releaseType ?? null,
      imageUrl: rel?.imageUrl ?? audiodb.imageUrl ?? null, // Deezer artist photo; AudioDB fallback
      recentReleases: rel?.recentReleases ?? [], // additive display data; no effect on scoring
      fullOriginalReleaseCount: releaseSummary.fullOriginalCount,
      selfRemixReleaseCount: releaseSummary.selfRemixCount,
      otherRemixReleaseCount: releaseSummary.otherRemixCount,
      releaseQualityScore: releaseSummary.releaseQualityScore, // 0-1 weighted ratio, null if no releases
      tourCount: tour?.tourCount ?? 0,
      setlistCount: tour?.setlistCount ?? 0,
      avgVenueSize: tour?.avgVenueSize ?? 0,
      minVenueSize: tour?.minVenueSize ?? 0,
      maxVenueSize: tour?.maxVenueSize ?? 0,
      topVenues: tour?.topVenues ?? [], // biggest venues played (top 3), display-only
      tourHistory: tour?.tourHistory ?? [], // per-show list within scoring window (newest first), display-only
      fullTourHistory: tour?.fullTourHistory ?? [], // all-time per-show list (newest first), display-only, never scored

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
      newsArticles: news.articles ?? [], // Pitchfork/Stereogum mentions; display-only, not scored
      hasUpcomingEvents: ticketmaster.hasUpcomingEvents ?? false,
      ticketmasterEvents: ticketmaster.events ?? [], // {date, venue, city, venueCapacity}, newest-first
      ticketmasterEventCount: ticketmaster.eventCount ?? 0,
      ticketmasterEarliestOnSaleDate: ticketmaster.earliestOnSaleDate ?? null,
      hasJamBaseEvents: jambase.hasUpcomingEvents ?? false,
      jambaseEvents: jambase.events ?? [], // {date, venue, city, ticketUrl}
      jambaseEventCount: jambase.eventCount ?? 0,
      jambaseEarliestListedDate: jambase.earliestListedDate ?? null,
    });
  }

  saveContactCache(); // persist any newly-researched contacts
  logger.count('Aggregated artists', results.length);
  return results;
}

module.exports = { aggregateArtistData, normalizeName };
