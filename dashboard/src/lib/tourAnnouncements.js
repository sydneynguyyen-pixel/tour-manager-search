// Data access for the Tour Announcements tab — a neutral, chronological feed
// of confirmed tour announcements across every artist the pipeline has ever
// encountered (see automation/build-tour-announcements.js), independent of
// scoring. Read-only: there's no local edit/add/delete story here, so this is
// much simpler than lib/myArtists.js — just fetch + adapt for the shared
// ArtistCard/ArtistDetail components.

import { config } from '../config';

// Tour-lifecycle stage metadata — see automation/build-tour-announcements.js's
// classifyTourStage for how each artist gets one of these. Labels are plain
// noun phrases (no scoring/priority language); className hooks into the
// .pill.stage-* rules in index.css, a palette deliberately distinct from both
// the score-tier green/amber/red and the existing purple "On Tour Now" pill —
// this is a third, unrelated kind of signal and shouldn't visually read as
// either of the other two.
export const TOUR_STAGE_META = {
  NEW_TOUR: { label: 'New Tour Confirmed', className: 'stage-new-tour' },
  ONGOING: { label: 'Already Touring', className: 'stage-ongoing' },
  NEW_SHOWS: { label: 'New Shows', className: 'stage-new-shows' },
  POSSIBLE: { label: 'Early Signal', className: 'stage-possible' },
  NO_TOUR: { label: 'No Tour Detected', className: 'stage-no-tour' },
};

// Filter dropdown options — NEW_TOUR first since the tab defaults to it (the
// primary signal this feed exists to surface).
export const TOUR_STAGE_FILTERS = [
  { value: 'NEW_TOUR', label: TOUR_STAGE_META.NEW_TOUR.label },
  { value: 'all', label: 'All stages' },
  { value: 'ONGOING', label: TOUR_STAGE_META.ONGOING.label },
  { value: 'NEW_SHOWS', label: TOUR_STAGE_META.NEW_SHOWS.label },
  { value: 'POSSIBLE', label: TOUR_STAGE_META.POSSIBLE.label },
  { value: 'NO_TOUR', label: TOUR_STAGE_META.NO_TOUR.label },
];

export const DEFAULT_TOUR_STAGE_FILTER = 'NEW_TOUR';

// Plain-language explanations for the "?" help modal — same order as
// TOUR_STAGE_FILTERS so the modal reads top-to-bottom exactly like the
// dropdown. Criteria wording mirrors classifyTourStage in
// automation/build-tour-announcements.js; keep the two in sync if that
// function's thresholds ever change.
export const TOUR_STAGE_HELP = [
  {
    value: 'NEW_TOUR',
    label: TOUR_STAGE_META.NEW_TOUR.label,
    description:
      "Confirmed, on-sale dates exist, but the artist hasn't started playing them yet — the strongest signal a new travel-booking opportunity just opened up. This is the default view. Criteria: 3+ confirmed dates with none played in the last 60 days, or (for artists outside your roster) 6+ dates found via a nationwide Ticketmaster search.",
  },
  {
    value: 'all',
    label: 'All stages',
    description: 'Shows every artist in the feed regardless of stage, for the full picture at once.',
  },
  {
    value: 'ONGOING',
    label: TOUR_STAGE_META.ONGOING.label,
    description: 'The artist is actively on tour right now. Criteria: 3+ confirmed dates, with at least one played in the last 60 days.',
  },
  {
    value: 'NEW_SHOWS',
    label: TOUR_STAGE_META.NEW_SHOWS.label,
    description: "A single show or a short run has been confirmed — not yet a full tour. Criteria: 1–2 confirmed dates.",
  },
  {
    value: 'POSSIBLE',
    label: TOUR_STAGE_META.POSSIBLE.label,
    description: 'No confirmed dates yet, but a recent release hints a tour announcement could be coming. Criteria: 0 confirmed dates, with a release in the last 60 days.',
  },
  {
    value: 'NO_TOUR',
    label: TOUR_STAGE_META.NO_TOUR.label,
    description: 'Nothing to report right now — no confirmed dates, no recent release, and no recent past show.',
  },
];

export async function fetchTourAnnouncements() {
  if (!config.tourAnnouncementsUrl) return [];
  try {
    const res = await fetch(`${config.tourAnnouncementsUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.artists) ? json.artists : [];
  } catch {
    return [];
  }
}

// Route for a Tour Announcements entry's detail page. There's no stable id
// beyond the artist name — this is a read-only feed, not a scored lead or a
// localStorage-backed My Artists entry — so the (URL-encoded) name is the key.
export function announcementRoute(entry) {
  return `/tour-announcements/${encodeURIComponent(entry.artist)}`;
}

// Adapts a tour-announcements.json entry to the lead shape ArtistCard.jsx and
// ArtistDetail.jsx already render in hideScore mode (same idea as
// lib/myArtists.js's toLeadShape). Events get split back out by source so
// ArtistDetail's existing mergeConfirmedEvents() can recombine them into one
// "On sale now" list exactly as it already does for Leads/My Artists.
//
// genre defaults to 'Unknown' rather than passing through null: with no
// genre and no bio, ArtistCard/ArtistDetail's shared subtitle fallback
// (utils/artistSubtitle.js) reaches its last-resort "New tour lead" string —
// job-search phrasing this neutral feed must never surface. 'Unknown' is
// truthy, so it short-circuits that fallback into "Unknown artist" instead,
// and matches the genre pill's own '|| Unknown' default, so nothing looks
// inconsistent.
export function toLeadShape(entry) {
  const events = Array.isArray(entry.events) ? entry.events : [];
  const ticketmasterEvents = events.filter((e) => e.source === 'ticketmaster');
  const jambaseEvents = events.filter((e) => e.source === 'jambase');
  return {
    artist: entry.artist,
    imageUrl: entry.imageUrl,
    genre: entry.genre || 'Unknown',
    announcedDate: entry.announcedDate,
    tourStage: entry.tourStage,
    // Whether this artist was surfaced by nationwide Ticketmaster discovery
    // (outside Matthew's tracked roster) vs. pooled from leads/My Artists — the
    // dashboard badges the two apart. See automation/build-tour-announcements.js.
    discovered: entry.discovered === true,
    hasUpcomingEvents: ticketmasterEvents.length > 0,
    ticketmasterEvents,
    hasJamBaseEvents: jambaseEvents.length > 0,
    jambaseEvents,
    fitReasoning: [],
  };
}
