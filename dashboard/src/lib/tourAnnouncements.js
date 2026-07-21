// Data access for the "New Tour Detected" tab — a neutral, chronological feed
// of artists whose confirmed tour dates are on sale but haven't started yet
// (every entry in tour-announcements.json is already filtered to
// tourStage === 'NEW_TOUR' by automation/build-tour-announcements.js).
// Read-only: there's no local edit/add/delete story here, so this is much
// simpler than lib/myArtists.js — just fetch + adapt for the shared
// ArtistCard/ArtistDetail components.

import { config } from '../config';

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

// Route for a New Tour Detected entry's detail page. There's no stable id
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
