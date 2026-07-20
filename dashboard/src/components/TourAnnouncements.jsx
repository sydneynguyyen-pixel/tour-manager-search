// "Tour Announcements" — a neutral, chronological feed of confirmed tour
// announcements across every artist the pipeline has ever encountered (all
// leads, regardless of score, plus every My Artists entry — see
// automation/build-tour-announcements.js). Deliberately separate from the
// scored Leads experience: no score badge, no priority label, no genre-tier
// language, no fit reasoning — just artist, image, genre, announced dates/
// venues, and when the announcement was first spotted. Read-only; there's no
// local edit/add/delete story here.

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
        <h2>Tour Announcements</h2>
        <p>Confirmed tour dates as they&rsquo;re announced, across every artist tracked so far — newest first.</p>
      </div>

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
          <h2>No tour announcements yet</h2>
          <p>Confirmed dates will appear here as they&rsquo;re detected.</p>
        </div>
      )}

      {entries && entries.length > 0 && (
        <>
          <div className="result-count">
            Showing {entries.length} artist{entries.length === 1 ? '' : 's'} with confirmed dates
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
