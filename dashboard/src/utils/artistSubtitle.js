// Resolve a one-line, artist-specific subtitle for a lead.
//
// Priority:
//   1. lastfmBio  — Last.fm artist.getinfo bio.summary (HTML already stripped
//      upstream; we still defensively re-strip + drop the trailing
//      "Read more on Last.fm" link text).
//   2. audiodbBio — TheAudioDB strBiographyEN.
//   3. "{Genre} artist · {avgVenueSize}-cap venues" (venue clause dropped when
//      capacity is unknown).
//   4. "{n} shows in the past 18 months" — generic but non-repetitive.
//   5. "New tour lead" — last-resort when nothing above is available.
//
// Bios are collapsed to a single line, preferring the first sentence, and
// truncated to ~120 chars at a word boundary.

const MAX_LEN = 120;

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, ' ');
}

// Normalize a raw bio string, or return null when there's nothing usable.
function cleanBio(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = stripHtml(raw)
    // Last.fm appends '<a>Read more on Last.fm</a>'; the anchor text survives
    // tag-stripping, so remove it (and anything after) explicitly.
    .replace(/\s*Read more on Last\.fm.*$/is, '')
    // Drop bracketed reference/citation artifacts occasionally present.
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length ? t : null;
}

// First sentence of `text`, if it ends on a sentence terminator not immediately
// preceded by a single capital letter (guards against initials like "J." and
// abbreviations like "St."). Returns null when no clean boundary is found.
function firstSentence(text) {
  const re = /[.!?](?=\s|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const idx = m.index;
    const prevChar = text[idx - 1];
    const prev2 = text[idx - 2];
    const afterInitial = /[A-Z]/.test(prevChar) && (idx < 2 || /\s/.test(prev2 ?? ' '));
    if (!afterInitial) return text.slice(0, idx + 1);
  }
  return null;
}

// Collapse to one line: prefer a first sentence that fits, else word-truncate.
function truncate(text) {
  const clean = text.trim();
  const sentence = firstSentence(clean);
  if (sentence && sentence.length >= 20 && sentence.length <= MAX_LEN) {
    return sentence;
  }
  if (clean.length <= MAX_LEN) return clean;
  let cut = clean.slice(0, MAX_LEN);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 40) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[\s.,;:!?-]+$/, '')}…`;
}

function sentenceCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Fuller cleaned bio for the detail hero — no character truncation (the layout
// clamps it to a few lines with CSS). Falls back to the compact subtitle when
// no real bio exists (genre/tour/generic line).
export function getArtistBio(lead) {
  if (!lead) return 'New tour lead';
  const bio = cleanBio(lead.lastfmBio) || cleanBio(lead.audiodbBio);
  return bio || getArtistSubtitle(lead);
}

export function getArtistSubtitle(lead) {
  if (!lead) return 'New tour lead';

  const bio = cleanBio(lead.lastfmBio) || cleanBio(lead.audiodbBio);
  if (bio) return truncate(bio);

  const genre = lead.genre ? String(lead.genre).trim() : '';
  const venue = Number(lead.avgVenueSize) || 0;
  if (genre) {
    const base = `${sentenceCase(genre)} artist`;
    return venue > 0 ? `${base} · ${venue.toLocaleString()}-cap venues` : base;
  }

  const tours = Number(lead.tourCount) || 0;
  if (tours > 0) return `${tours} show${tours === 1 ? '' : 's'} in the past 18 months`;

  return 'New tour lead';
}

export default getArtistSubtitle;
