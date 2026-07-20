// Contact-research scraper: estimate how accessible an artist's management /
// booking is, to feed the "management accessibility" scoring dimension.
//
// HONEST SCOPE (verified empirically 2026-07-19):
//   - There is no general web-search API in this runtime, so we find the artist's
//     OFFICIAL SITE via Wikipedia's infobox "Website" field (not a search engine).
//   - Wikipedia also yields the artist's LABEL(s) — the most reliable signal here.
//   - Modern artist sites are JS-rendered stores/EPKs, so static axios+cheerio
//     scraping rarely finds a booking email. We try anyway (some older sites do
//     expose them), but classification usually falls back to LABEL TIER.
//   - We intentionally do NOT call Spotify: the task note says don't touch the
//     quota-limited endpoints, and the restricted token exposes no useful links.
//
// Result degrades gracefully to { managementType: 'unknown', confidence: 'low' }.
// This finds only PUBLICLY-PUBLISHED business/booking contacts for manual B2B
// outreach; it sends nothing.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'contact-cache.json');
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const CONTACT = process.env.WIKIPEDIA_CONTACT || 'https://github.com/tour-manager-search';
const USER_AGENT = `tour-manager-search/1.0 ( ${CONTACT} )`;
const MIN_INTERVAL_MS = 1000;
const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SITE_TIMEOUT_MS = 12_000;

// Recognizable major booking agencies (name + email domain).
const MAJOR_AGENCIES = [
  { name: 'CAA', aka: ['creative artists agency'], domains: ['caa.com'] },
  { name: 'WME', aka: ['william morris endeavor', 'wme agency'], domains: ['wmeagency.com', 'wma.com'] },
  { name: 'UTA', aka: ['united talent agency'], domains: ['unitedtalent.com', 'utamusic.com'] },
  { name: 'Wasserman', aka: ['wasserman music', 'team wass'], domains: ['teamwass.com', 'wassermanmusic.com'] },
  { name: 'Paradigm', aka: ['paradigm talent', 'paradigm agency'], domains: ['paradigmagency.com'] },
];

// Rough major-label list (substring match against Wikipedia's label text).
const MAJOR_LABELS = [
  'interscope', 'atlantic', 'capitol', 'columbia', 'republic', 'def jam', 'universal',
  'sony', 'warner', 'rca', 'epic', 'island', 'geffen', 'polydor', 'parlophone', 'emi',
  'motown', 'roc nation', '300 entertainment', 'aftermath',
];

const FREE_MAIL = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com'];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CONTACT_KW = /booking|management|mgmt|contact|press|agent/i;

// --- cache -------------------------------------------------------------------
let cache = null;
let dirty = false;
const stats = { cached: 0, fresh: 0, errored: 0 };

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache() {
  if (!cache || !dirty) return;
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  dirty = false;
}

function getCacheStats() {
  return { ...stats, size: cache ? Object.keys(cache).length : 0 };
}

function resetStats() {
  stats.cached = 0;
  stats.fresh = 0;
  stats.errored = 0;
}

// --- throttle: serial, spaced by MIN_INTERVAL_MS -----------------------------
let queue = Promise.resolve();
function schedule(task) {
  const result = queue.then(() => task());
  const gap = () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  queue = result.then(gap, gap);
  return result;
}

function wikiGet(params) {
  return schedule(async () => {
    const res = await axios.get(WIKI_API, { params, headers: { 'User-Agent': USER_AGENT }, timeout: SITE_TIMEOUT_MS });
    return res.data;
  });
}

const EMPTY_SOCIALS = { instagram: null, twitter: null, tiktok: null, youtube: null, facebook: null };

// Scan a collection of <a> elements for the first Instagram / Twitter(X) /
// TikTok / YouTube / Facebook profile link. Only recognizes the canonical
// hosts to avoid false positives. Missing platforms stay null.
function extractSocialLinksFromAnchors($, anchors) {
  const socials = { ...EMPTY_SOCIALS };
  anchors.each((_, a) => {
    const href = $(a).attr('href');
    if (!href || !/^https?:/i.test(href)) return;
    let host;
    try {
      host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return;
    }
    if (!socials.instagram && host === 'instagram.com') socials.instagram = href;
    else if (!socials.twitter && (host === 'twitter.com' || host === 'x.com')) socials.twitter = href;
    else if (!socials.tiktok && host === 'tiktok.com') socials.tiktok = href;
    else if (!socials.youtube && (host === 'youtube.com' || host === 'youtu.be')) socials.youtube = href;
    else if (!socials.facebook && (host === 'facebook.com' || host === 'fb.com')) socials.facebook = href;
  });
  return socials;
}

// Merge two social-link objects, `a` wins per platform, `b` only fills nulls.
// Used to prefer the infobox over the External Links section.
function mergeSocials(a, b) {
  const out = { ...EMPTY_SOCIALS };
  for (const key of Object.keys(EMPTY_SOCIALS)) out[key] = a?.[key] ?? b?.[key] ?? null;
  return out;
}

// Find the "External links" heading in a fully-parsed Wikipedia article and
// return the <a> elements inside the <li> list that follows it. MediaWiki
// always renders External Links as a single <ul> immediately after the
// heading; sisterlinks boxes, navboxes, and reflist cruft come after that and
// must NOT be scanned — a navbox nested a few siblings down can otherwise pull
// in dozens of unrelated links (e.g. an "Awards" template happens to sit right
// after the sisterbox on some pages). No heading / no list -> empty collection.
function findExternalLinksAnchors($) {
  const heading = $('h2, h3')
    .filter((_, el) => /^external links$/i.test($(el).text().trim()))
    .first();
  if (!heading.length) return $();

  // Newer MediaWiki output wraps the heading in a div.mw-heading whose
  // *siblings* are the section content; older output has the content as the
  // heading's own siblings. `.closest()` would match the <h2> itself before
  // climbing to that wrapper (self-match wins), so check the parent explicitly.
  const wrapper = heading.parent('div.mw-heading');
  const container = wrapper.length ? wrapper : heading;
  const ul = container.nextUntil('div.mw-heading, h2, h3').filter('ul').first();
  return ul.find('a');
}

// Pull the official website URL, label list, and social links from an artist's
// Wikipedia infobox.
async function fetchWikipediaInfo(artistName) {
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: artistName, format: 'json', srlimit: 1 });
  const hit = search.query?.search?.[0];
  if (!hit) return { websiteUrl: null, labels: [], socialLinks: { ...EMPTY_SOCIALS } };

  const parsed = await wikiGet({ action: 'parse', page: hit.title, format: 'json', prop: 'text', section: 0, redirects: 1 });
  const html = parsed.parse?.text?.['*'];
  if (!html) return { websiteUrl: null, labels: [], socialLinks: { ...EMPTY_SOCIALS } };

  const $ = cheerio.load(html);
  let websiteUrl = null;
  const labels = [];

  $('.infobox tr').each((_, tr) => {
    const th = $(tr).find('th').first().text().trim();
    const td = $(tr).find('td').first();
    if (/^website/i.test(th)) {
      const href = td.find('a').first().attr('href');
      if (href && href.startsWith('http')) websiteUrl = href;
    } else if (/^labels?/i.test(th)) {
      td.text()
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((l) => labels.push(l));
    }
  });

  // Social links can appear anywhere in the infobox (Website row or an
  // "External links"-style row of icons), so scan the whole infobox.
  const infobox = $('.infobox').first();
  const infoboxSocials = infobox.length ? extractSocialLinksFromAnchors($, infobox.find('a')) : { ...EMPTY_SOCIALS };

  // The infobox structurally doesn't carry most social links — those live in
  // the article's "External links" section instead. Fetch the full article
  // (a second call; section:0 above only gets the lead/infobox) and use it as
  // a secondary source, filling only what the infobox didn't have.
  let extLinksSocials = { ...EMPTY_SOCIALS };
  try {
    const full = await wikiGet({ action: 'parse', page: hit.title, format: 'json', prop: 'text', redirects: 1 });
    const fullHtml = full.parse?.text?.['*'];
    if (fullHtml) {
      const $$ = cheerio.load(fullHtml);
      extLinksSocials = extractSocialLinksFromAnchors($$, findExternalLinksAnchors($$));
    }
  } catch (err) {
    logger.warn(`Wikipedia: External Links fetch failed for "${artistName}" (${err.response?.status ?? err.message}); skipping.`);
  }

  const socialLinks = mergeSocials(infoboxSocials, extLinksSocials);

  return { websiteUrl, labels, socialLinks };
}

// Best-effort static fetch of a page; returns { text, emails } (emails may be []).
async function fetchPage(url) {
  return schedule(async () => {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      timeout: SITE_TIMEOUT_MS,
      maxRedirects: 5,
    });
    const html = typeof res.data === 'string' ? res.data : '';
    const $ = cheerio.load(html);
    const mailtos = $('a[href^="mailto:"]').map((_, a) => $(a).attr('href').replace(/^mailto:/i, '').split('?')[0]).get();
    const inline = html.match(EMAIL_RE) || [];
    const emails = [...new Set([...mailtos, ...inline].map((e) => e.toLowerCase()))]
      .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e));
    // Candidate contact/booking sub-page links (same origin).
    const contactLinks = $('a')
      .map((_, a) => ({ text: $(a).text().trim(), href: $(a).attr('href') }))
      .get()
      .filter((l) => l.href && CONTACT_KW.test(`${l.text} ${l.href}`))
      .map((l) => l.href);
    return { text: $('body').text(), emails, contactLinks };
  });
}

const BOOKING_LOCAL = /booking|bookings|management|mgmt|agent|press/i;

// Choose an accessibility-relevant email, or null. A booking/management-looking
// local part wins; otherwise a direct email on the artist's OWN domain (or a
// free-mail) counts. Generic third-party addresses (e.g. merch "support@") are
// rejected rather than misreported as booking contacts.
function pickContactEmail(emails, siteDomain) {
  const booking = emails.find((e) => BOOKING_LOCAL.test(e.split('@')[0]));
  if (booking) return { email: booking, kind: 'booking' };
  const own = emails.find((e) => {
    const d = e.split('@')[1];
    return d === siteDomain || FREE_MAIL.includes(d);
  });
  if (own) return { email: own, kind: 'direct' };
  return null;
}

// Detect a major agency only from reliable evidence: an agency email domain, or
// a full agency NAME appearing within ~100 chars of a contact keyword. We do NOT
// scan prose for bare acronyms (CAA/WME/UTA) — too many false positives.
function agencyFor(rawText, emails) {
  for (const ag of MAJOR_AGENCIES) {
    if (emails.some((e) => ag.domains.some((d) => e.endsWith(`@${d}`)))) return { ag, evidence: 'email' };
  }
  const lower = (rawText || '').toLowerCase();
  for (const ag of MAJOR_AGENCIES) {
    for (const name of ag.aka) {
      const idx = lower.indexOf(name);
      if (idx !== -1 && CONTACT_KW.test(lower.slice(Math.max(0, idx - 100), idx + 100))) {
        return { ag, evidence: 'text' };
      }
    }
  }
  return null;
}

function siteDomainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// Decide managementType / contact from the collected signals.
function classify({ websiteUrl, labels, siteText, siteEmails }) {
  const emails = siteEmails || [];
  const siteDomain = siteDomainOf(websiteUrl);

  // 1) Major agency — reliable evidence only (agency email domain, or agency
  //    name near a contact keyword).
  const agency = agencyFor(siteText, emails);
  if (agency) {
    const email = emails.find((e) => agency.ag.domains.some((d) => e.endsWith(`@${d}`))) || null;
    return {
      managementType: 'major-agency', contactName: agency.ag.name, contactEmail: email,
      contactSource: 'artist-website', websiteUrl, label: null,
      confidence: agency.evidence === 'email' ? 'high' : 'low',
    };
  }

  // 2) A booking/management or direct email on the official site.
  const pick = pickContactEmail(emails, siteDomain);
  if (pick) {
    const domain = pick.email.split('@')[1];
    const isOwn = domain === siteDomain || FREE_MAIL.includes(domain);
    return {
      managementType: isOwn ? 'self-managed' : 'booking-agency', contactName: null, contactEmail: pick.email,
      contactSource: 'artist-website', websiteUrl, label: null,
      confidence: pick.kind === 'booking' ? 'medium' : 'low',
    };
  }

  // 3) Fall back to label tier from Wikipedia.
  if (labels.length) {
    const major = labels.find((l) => MAJOR_LABELS.some((m) => l.toLowerCase().includes(m)));
    if (major) {
      return {
        managementType: 'major-label', contactName: null, contactEmail: null,
        contactSource: 'wikipedia', websiteUrl, label: major, confidence: 'medium',
      };
    }
    return {
      managementType: 'indie-label', contactName: null, contactEmail: null,
      contactSource: 'wikipedia', websiteUrl, label: labels[0], confidence: 'low',
    };
  }

  // 4) Nothing usable.
  return {
    managementType: 'unknown', contactName: null, contactEmail: null,
    contactSource: websiteUrl ? 'wikipedia' : 'none', websiteUrl: websiteUrl || null, label: null, confidence: 'low',
  };
}

// Research one artist. `spotifyId` is accepted for the cache key / future use but
// intentionally NOT used to call Spotify (quota-limited endpoint).
async function researchArtistContact(artistName, spotifyId = null) {
  const key = String(artistName || '').toLowerCase().trim();
  const base = { artist: artistName, spotifyId };
  if (!key) {
    return { ...base, managementType: 'unknown', contactName: null, contactEmail: null, contactSource: 'none', websiteUrl: null, socialLinks: { ...EMPTY_SOCIALS }, label: null, confidence: 'low' };
  }

  const c = loadCache();
  const entry = c[key];
  if (entry && Date.now() - new Date(entry.fetchedAt).getTime() < FRESHNESS_MS) {
    stats.cached += 1;
    // Older cache entries predate socialLinks; default them so callers always
    // see the field.
    return { socialLinks: { ...EMPTY_SOCIALS }, ...base, ...entry.result };
  }

  stats.fresh += 1;
  let result;
  try {
    const { websiteUrl, labels, socialLinks } = await fetchWikipediaInfo(artistName);

    let siteText = '';
    let siteEmails = [];
    if (websiteUrl) {
      try {
        const home = await fetchPage(websiteUrl);
        siteText = home.text;
        siteEmails = home.emails;
        // Follow at most one contact/booking sub-page if the homepage had no email.
        if (siteEmails.length === 0 && home.contactLinks.length) {
          try {
            const sub = new URL(home.contactLinks[0], websiteUrl).href;
            const page = await fetchPage(sub);
            siteText += ` ${page.text}`;
            siteEmails = page.emails;
          } catch {
            /* sub-page fetch failed — ignore */
          }
        }
      } catch (err) {
        logger.warn(`Contact: could not fetch site for "${artistName}" (${err.response?.status ?? err.code ?? err.message}).`);
      }
    }

    result = { ...classify({ websiteUrl, labels, siteText, siteEmails }), socialLinks };
  } catch (err) {
    // Transient failure (e.g. Wikipedia error): do NOT cache; return unknown.
    logger.warn(`Contact: research errored for "${artistName}" (${err.response?.status ?? err.message}); not cached.`);
    stats.errored += 1;
    return { ...base, managementType: 'unknown', contactName: null, contactEmail: null, contactSource: 'none', websiteUrl: null, socialLinks: { ...EMPTY_SOCIALS }, label: null, confidence: 'low' };
  }

  c[key] = { fetchedAt: new Date().toISOString(), result };
  dirty = true;
  return { ...base, ...result };
}

module.exports = { researchArtistContact, saveCache, loadCache, getCacheStats, resetStats, classify, CACHE_PATH };
