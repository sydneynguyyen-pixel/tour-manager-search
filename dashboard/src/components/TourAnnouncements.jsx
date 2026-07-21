// "New Tour Detected" — a neutral feed of artists whose confirmed tour dates
// are on sale but haven't started yet (see automation/build-tour-
// announcements.js — every entry here is already tourStage === 'NEW_TOUR').
// Deliberately separate from the scored Leads experience: no score badge, no
// priority label, no genre-tier language, no fit reasoning — just artist,
// image, genre, announced dates/venues, and when it was first spotted.
// Read-only; there's no local edit/add/delete story here.
//
// A single category — no stage filter, no per-card stage badge. The only
// per-card marker is "Not in your roster", for artists surfaced by
// nationwide Ticketmaster discovery rather than pulled from Matthew's
// tracked leads/My Artists list. The explainer panel below the intro spells
// out the criteria for both buckets.

import { useEffect, useState } from 'react';
import { fetchTourAnnouncements, toLeadShape, announcementRoute } from '../lib/tourAnnouncements';
import { shortDate, longDate } from '../lib/format';
import ArtistCard from './ArtistCard';

// Same date+venue key ArtistDetail's mergeConfirmedEvents uses — two sources
// (Ticketmaster, JamBase) listing the same show is one date, not two.
function dedupeEvents(events) {
  const seen = new Map();
  for (const e of events) {
    const key = `${e.date}|${(e.venue || '').trim().toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export default function TourAnnouncements() {
  const [entries, setEntries] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTourAnnouncements();
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="tour-announcements">
      <div className="profile-intro">
        <h2>New Tour Detected</h2>
        <p>Confirmed tours that are on sale but haven&rsquo;t started yet. Newest first.</p>
      </div>

      {entries && entries.length > 0 && (
        <div className="stage-explainer">
          <h3>What counts as a new tour</h3>
          <p>
            New tours are surfaced from ticketing platforms (Ticketmaster / JamBase) the moment confirmed dates
            appear &mdash; a tour that&rsquo;s on sale but hasn&rsquo;t started yet. Artists you track show up
            as soon as any confirmed upcoming dates are listed. Artists beyond your roster (marked{' '}
            <span className="pill roster-badge inline-legend">Not in your roster</span>) are held to a higher
            bar: a real touring run of 6+ dates at least 4 weeks out, across 3+ cities, excluding festivals and
            single-city residencies, and only if they&rsquo;re not already on the road. Because it relies on
            ticketing data, it can lag an artist&rsquo;s first announcement by a few days.
          </p>
        </div>
      )}

      {entries === null && !error && (
        <div className="cards-grid" aria-busy="true" aria-label="Loading tour announcements">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      )}

      {error && (
        <div className="state">
          <div className="emoji">⚠️</div>
          <h2>Couldn&apos;t load tour announcements</h2>
          <p>{error}</p>
        </div>
      )}

      {entries && entries.length === 0 && (
        <div className="state">
          <div className="emoji">🎫</div>
          <h2>No new tours detected yet</h2>
          <p>Confirmed dates will appear here as they&rsquo;re detected.</p>
        </div>
      )}

      {entries && entries.length > 0 && (
        <>
          <div className="result-count">
            Showing {entries.length} artist{entries.length === 1 ? '' : 's'}
          </div>
          <div className="cards-grid">
            {entries.map((entry) => (
              <AnnouncementCard key={entry.artist} entry={entry} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Reuses ArtistCard.jsx directly (hideScore — this is a neutral, unscored
// feed) for visual parity with the rest of the app, then appends the
// announcement-specific info below it, same continuous-card pattern
// MyArtists.jsx uses for its own footer (see .myartist-item/.myartist-extra).
function AnnouncementCard({ entry }) {
  const events = dedupeEvents(entry.events || []);
  const next = events[0];
  const remaining = events.length - 1;

  return (
    <div className="myartist-item">
      <ArtistCard lead={toLeadShape(entry)} hideScore route={announcementRoute(entry)} />
      <div className="myartist-extra">
        {entry.discovered && (
          <span className="roster-badge-row">
            <span className="pill roster-badge">Not in your roster</span>
          </span>
        )}
        {next && (
          <div className="pc-meta">
            <span>{longDate(next.date)}</span>
            <span>{next.venue || 'Venue TBA'}</span>
            {next.city && <span>{next.city}</span>}
          </div>
        )}
        {remaining > 0 && (
          <p className="pc-notes">
            +{remaining} more announced date{remaining === 1 ? '' : 's'}
          </p>
        )}
        <p className="pc-added">First spotted {shortDate(entry.announcedDate)}</p>
      </div>
    </div>
  );
}
