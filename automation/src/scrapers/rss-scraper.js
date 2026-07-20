// Music-news RSS scraper — checks whether a candidate artist has recent
// coverage on Pitchfork/Stereogum, as a "someone's actually writing about
// this artist right now" signal, distinct from the release/touring data the
// rest of the pipeline already collects.
//
// Both feeds were verified live and directly fetchable (plain HTTP GET, no
// bot-challenge, unlike Bandsintown — see that scraper's rejected build for
// why this matters) as of 2026-07-20:
//   - Pitchfork: https://pitchfork.com/feed/feed-news/rss
//   - Stereogum: https://stereogum.com/feed/ (www redirects here; using the
//     canonical URL directly skips that hop)
// If either starts 404ing or returns unparseable content, that feed is almost
// certainly a broken URL from a site redesign, not a bug in this file —
// check the site for its current feed link before assuming the parser broke.
//
// Parsed with cheerio in XML mode rather than adding an RSS-parsing
// dependency — cheerio (already used by venue-scraper.js/contact-research.js)
// handles RSS's flat <item><title>/<link>/<pubDate> structure fine, and one
// less dependency to track.
//
// IMPORTANT: each feed only ever contains its publisher's most recent items
// (empirically ~4-6 days' worth for these two, not a rolling 30-day window) —
// a feed simply has no items older than that to search, regardless of the
// RECENT_DAYS cutoff below. Coverage should be understood as "did they post
// about this artist in roughly the last few days", not a true 30-day window.
//
// Fetched ONCE per process (not once per artist) and cached in memory — every
// checkArtistInRecentNews() call in the same run searches the same cached
// items, since re-fetching identical feeds per candidate would be pointless
// and impolite. A small delay is still added between the two feed fetches
// themselves, in the spirit of not hammering either site even for two
// requests.

const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

const FEEDS = [
  { name: 'Pitchfork', url: 'https://pitchfork.com/feed/feed-news/rss' },
  { name: 'Stereogum', url: 'https://stereogum.com/feed/' },
];

const RECENT_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BETWEEN_FEEDS_DELAY_MS = 750;
const REQUEST_TIMEOUT_MS = 15_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary match rather than a bare substring — a plain `.includes()`
// would false-positive on any artist whose name is (or contains) a common
// word, e.g. an artist named "Air" matching every article that uses the
// word "air". Still not perfect (won't catch stylized names with unusual
// punctuation, and can't tell apart two real artists who share a name), but
// meaningfully cuts down the obvious false-positive class.
function nameAppearsIn(text, artistName) {
  if (!text || !artistName) return false;
  const escaped = escapeRegExp(artistName.trim());
  if (!escaped) return false;
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(text);
}

async function fetchFeedItems(feed) {
  try {
    const res = await axios.get(feed.url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'tour-manager-search/1.0 (+https://github.com/tour-manager-search)' },
    });
    const $ = cheerio.load(res.data, { xmlMode: true });
    const items = [];
    $('item').each((_, el) => {
      const title = $(el).find('title').first().text().trim();
      const link = $(el).find('link').first().text().trim();
      const pubDateRaw = $(el).find('pubDate').first().text().trim();
      const description = $(el).find('description').first().text().trim();
      const publishedDate = pubDateRaw ? new Date(pubDateRaw) : null;
      if (!title || !link || !publishedDate || Number.isNaN(publishedDate.getTime())) return;
      items.push({ source: feed.name, title, url: link, description, publishedDate });
    });
    logger.info(`RSS: "${feed.name}" — ${items.length} item(s) parsed.`);
    return items;
  } catch (err) {
    logger.warn(`RSS: "${feed.name}" feed unreachable/unparseable — ${err.response?.status ?? err.message}. Skipping.`);
    return [];
  }
}

let cachedItemsPromise = null;

// Fetches + parses every configured feed exactly once per process, however
// many times checkArtistInRecentNews() is called afterward.
function loadAllFeedItems() {
  if (!cachedItemsPromise) {
    cachedItemsPromise = (async () => {
      const all = [];
      for (let i = 0; i < FEEDS.length; i += 1) {
        all.push(...(await fetchFeedItems(FEEDS[i])));
        if (i < FEEDS.length - 1) await sleep(BETWEEN_FEEDS_DELAY_MS);
      }
      return all;
    })();
  }
  return cachedItemsPromise;
}

// Checks the cached feed items for a mention of `artistName` in the title or
// description, within the last RECENT_DAYS. Never throws — a fetch failure
// upstream just means an empty item list, which resolves to no mentions.
async function checkArtistInRecentNews(artistName) {
  if (!artistName) return { mentioned: false, articles: [] };

  let items;
  try {
    items = await loadAllFeedItems();
  } catch {
    return { mentioned: false, articles: [] };
  }

  const cutoffMs = Date.now() - RECENT_DAYS * MS_PER_DAY;
  const articles = items
    .filter((it) => it.publishedDate.getTime() >= cutoffMs)
    .filter((it) => nameAppearsIn(it.title, artistName) || nameAppearsIn(it.description, artistName))
    .map((it) => ({ title: it.title, url: it.url, publishedDate: it.publishedDate.toISOString() }));

  return { mentioned: articles.length > 0, articles };
}

module.exports = { checkArtistInRecentNews, FEEDS };
