// Wikidata scraper — PRIMARY social/YouTube link source. Wikidata stores
// structured, per-property identifiers (Instagram username, YouTube channel
// ID, etc.) rather than free-text links buried in prose, so it's more
// reliable than scraping Wikipedia's infobox/External Links or TheAudioDB.
//
// Two calls per artist:
//   1. GET .../w/api.php?action=wbsearchentities  -> resolve the artist's
//      Wikidata entity id (Q-number)
//   2. GET .../wiki/Special:EntityData/{id}.json   -> fetch the entity and
//      read known social-platform properties off it
//
// Properties read (username/ID -> canonical profile URL):
//   P2003 Instagram username   -> https://instagram.com/{value}
//   P2002 Twitter/X username   -> https://twitter.com/{value}
//   P2397 YouTube channel ID   -> https://youtube.com/channel/{value}
//   P2013 Facebook ID          -> https://facebook.com/{value}
//   P7085 TikTok username      -> https://tiktok.com/@{value}
//
// CAVEAT: wbsearchentities is a text-match search, not a disambiguation
// engine — for a common/ambiguous name it can return the wrong entity (e.g. a
// footballer instead of the musician). We take the top hit; there is no
// per-artist ground truth to validate against here, so this is a known,
// accepted gap rather than a claimed guarantee.
//
// Not found / no matching properties -> all nulls. Never throws.

require('dotenv').config({ quiet: true });
const axios = require('axios');
const logger = require('../utils/logger');

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData';
const CONTACT = process.env.WIKIPEDIA_CONTACT || 'https://github.com/tour-manager-search';
const USER_AGENT = `tour-manager-search/1.0 ( ${CONTACT} )`;
const MIN_INTERVAL_MS = 500;
const TIMEOUT_MS = 15_000;

const wikidata = axios.create({ timeout: TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT } });

let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

const EMPTY_SOCIALS = { instagram: null, twitter: null, youtube: null, facebook: null, tiktok: null };

// Property -> [field name, URL builder].
const PROPERTY_MAP = {
  P2003: ['instagram', (v) => `https://instagram.com/${v}`],
  P2002: ['twitter', (v) => `https://twitter.com/${v}`],
  P2397: ['youtube', (v) => `https://youtube.com/channel/${v}`],
  P2013: ['facebook', (v) => `https://facebook.com/${v}`],
  P7085: ['tiktok', (v) => `https://tiktok.com/@${v}`],
};

async function findEntityId(artistName) {
  const res = await wikidata.get(WIKIDATA_API, {
    params: {
      action: 'wbsearchentities',
      search: artistName,
      type: 'item',
      language: 'en',
      format: 'json',
      limit: 1,
    },
  });
  return res.data?.search?.[0]?.id || null;
}

async function fetchEntity(id) {
  const res = await wikidata.get(`${WIKIDATA_ENTITY}/${id}.json`);
  return res.data?.entities?.[id] || null;
}

function firstClaimValue(claims, prop) {
  const claim = claims?.[prop]?.[0];
  const value = claim?.mainsnak?.datavalue?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Look up an artist's social links via Wikidata. Always resolves (never
// throws); returns EMPTY_SOCIALS on a miss, missing properties, or any error.
async function getWikidataSocialLinks(artistName) {
  if (!artistName) return { ...EMPTY_SOCIALS };

  return schedule(async () => {
    let id;
    try {
      id = await findEntityId(artistName);
    } catch (err) {
      logger.warn(`Wikidata: search failed for "${artistName}" (${err.response?.status ?? err.message}); returning nulls.`);
      return { ...EMPTY_SOCIALS };
    }
    if (!id) {
      logger.info(`Wikidata: no entity found for "${artistName}".`);
      return { ...EMPTY_SOCIALS };
    }

    let entity;
    try {
      entity = await fetchEntity(id);
    } catch (err) {
      logger.warn(`Wikidata: entity fetch failed for "${artistName}" (${id}) (${err.response?.status ?? err.message}); returning nulls.`);
      return { ...EMPTY_SOCIALS };
    }
    if (!entity?.claims) return { ...EMPTY_SOCIALS };

    const socials = { ...EMPTY_SOCIALS };
    for (const [prop, [field, toUrl]] of Object.entries(PROPERTY_MAP)) {
      const value = firstClaimValue(entity.claims, prop);
      if (value) socials[field] = toUrl(value);
    }

    const hits = Object.entries(socials).filter(([, v]) => v).map(([k]) => k);
    logger.info(`Wikidata: "${artistName}" (${id}) — found [${hits.join(', ') || 'none'}].`);
    return socials;
  });
}

module.exports = { getWikidataSocialLinks };
