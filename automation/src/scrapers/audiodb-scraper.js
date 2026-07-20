// TheAudioDB scraper — supplementary artist metadata: bio, genre/style, a rough
// popularity signal, an image (FALLBACK for the artist portrait), and social
// links (ADDITIONAL source — used only to fill gaps left by contact-research.js,
// never to overwrite it).
//
// No auth: the public test key "2" is used. It is rate-limited, so requests are
// serialized and spaced out. Not found -> a null-filled profile (found:false).

const axios = require('axios');
const logger = require('../utils/logger');

const AUDIODB_BASE = 'https://www.theaudiodb.com/api/v1/json/2';
const MIN_INTERVAL_MS = 500; // stay under the public key's ~2 req/sec limit

const audiodb = axios.create({ baseURL: AUDIODB_BASE, timeout: 15_000 });

let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

const EMPTY_PROFILE = {
  found: false,
  bio: null,
  genre: null,
  style: null,
  popularity: null,
  imageUrl: null,
  websiteUrl: null,
  socialLinks: { twitter: null, facebook: null, instagram: null },
};

// TheAudioDB stores some URLs without a scheme (e.g. "twitter.com/x") and also
// carries junk in these fields (e.g. "1"). Normalize to an absolute https URL,
// or null when empty/not domain-like (must contain a dotted host with a letter).
function normalizeUrl(u) {
  const s = (u || '').trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let host;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  if (!host.includes('.') || !/[a-z]/i.test(host)) return null; // reject "1", bare numbers, etc.
  return withScheme;
}

// Look up an artist's metadata by name. Always resolves (never throws) to a
// profile object; on any failure or miss it returns EMPTY_PROFILE.
async function getArtistProfile(artistName) {
  if (!artistName) return { ...EMPTY_PROFILE };

  return schedule(async () => {
    let data;
    try {
      const res = await audiodb.get('/search.php', { params: { s: artistName } });
      data = res.data;
    } catch (err) {
      logger.warn(`TheAudioDB: lookup failed for "${artistName}" (${err.response?.status ?? err.message}); returning nulls.`);
      return { ...EMPTY_PROFILE };
    }

    const a = Array.isArray(data?.artists) ? data.artists[0] : null;
    if (!a) {
      logger.info(`TheAudioDB: no profile for "${artistName}".`);
      return { ...EMPTY_PROFILE };
    }

    const chartedNum = Number.parseInt(a.intCharted, 10);
    const profile = {
      found: true,
      // strBiographyEN was the documented per-language field; the API now
      // appears to only populate the generic strBiography for the free v1 key
      // (strBiographyEN was silently null for every artist, incl. Coldplay —
      // verified directly against the API response). Prefer EN if it's ever
      // present, fall back to the generic field rather than losing the bio.
      bio: a.strBiographyEN || a.strBiography || null,
      genre: a.strGenre || null,
      style: a.strStyle || null,
      popularity: Number.isFinite(chartedNum) ? chartedNum : null, // best-effort; AudioDB has no true popularity metric
      imageUrl: a.strArtistThumb || a.strArtistLogo || null,
      websiteUrl: normalizeUrl(a.strWebsite),
      socialLinks: {
        twitter: normalizeUrl(a.strTwitter),
        facebook: normalizeUrl(a.strFacebook),
        instagram: normalizeUrl(a.strInstagram), // absent from v1 for most artists
      },
    };
    logger.info(
      `TheAudioDB: "${a.strArtist}" — genre=${profile.genre ?? '—'}, image=${profile.imageUrl ? 'Y' : 'N'}, ` +
        `socials=${Object.values(profile.socialLinks).filter(Boolean).length}`
    );
    return profile;
  });
}

module.exports = { getArtistProfile };
