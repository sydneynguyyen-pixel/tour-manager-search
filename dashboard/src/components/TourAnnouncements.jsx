// "New Tour Detected" — a neutral feed of artists whose confirmed tour dates
// are on sale but haven't started yet (see automation/build-tour-
// announcements.js — every entry here is already tourStage === 'NEW_TOUR').
// Deliberately separate from the scored Leads experience: no score badge, no
// priority label, no genre-tier language, no fit reasoning — just artist,
// image, genre, announced dates/venues, and when it was first spotted.
// Read-only (no edit/add/delete), aside from the save-for-later bookmark
// below, which is local to this feed (lib/savedAnnouncements.js) — see its
// header comment for why it isn't the same store the Leads "Saved" tab uses.
//
// A single category — no stage filter, no per-card stage badge (see the
// commit that simplified this from five lifecycle stages down to one). The
// only per-card marker is "Not in your roster", for artists surfaced by
// nationwide Ticketmaster discovery rather than pulled from Matthew's
// tracked leads/My Artists list. The Q&A explainer below the intro spells
// out the criteria for both buckets.

import { useEffect, useMemo, useState } from 'react';
import { fetchTourAnnouncements, toLeadShape, announcementRoute } from '../lib/tourAnnouncements';
import { toggleSavedAnnouncement, useIsAnnouncementSaved, useSavedAnnouncements } from '../lib/savedAnnouncements';
import { longDate } from '../lib/format';
import ArtistCard from './ArtistCard';
import { BookmarkGlyph } from './BookmarkButton';

const PAGE_SIZE = 20;

const DEFAULT_FILTERS = { search: '', genre: 'all', roster: 'all' };

// Q&A layout instead of one dense paragraph — each question stands alone so
// the criteria (and the data-source disclaimer) are scannable rather than
// requiring a full read-through. Criteria wording mirrors classifyTourStage
// / ticketmaster-discovery.js's thresholds; keep in sync if those change.
const NEW_TOUR_FAQ = [
  {
    q: 'What counts as a "new tour"?',
    a: 'Confirmed dates that are already on sale, but the tour hasn’t started yet — not just any upcoming show.',
  },
  {
    q: 'What’s the difference between my tracked artists and "Not in your roster"?',
    a: (
      <>
        Artists you already track (your leads and My Artists list) show up as soon as they have any confirmed
        upcoming dates. Artists tagged{' '}
        <span className="pill roster-badge inline-legend">Not in your roster</span> were found by scanning
        Ticketmaster nationwide, outside your tracked list, and are held to a higher bar: a real touring run of
        6+ dates at least 4 weeks out, across 3+ cities, excluding festivals and single-city residencies, and
        only if they’re not already on the road.
      </>
    ),
  },
  {
    q: 'Why might this be a few days behind an artist’s announcement?',
    a: 'This relies on ticketing platforms (Ticketmaster / JamBase) rather than social media, so it can lag an artist’s first public announcement by a few days.',
  },
  {
    q: 'Why is there less detail here than in Leads or My Artists?',
    a: 'This section only pulls from ticketing platforms — there’s no Spotify, Last.fm, or news data behind it, so bios, listener counts, contact info, and full tour history won’t be as fleshed out as elsewhere on the site.',
  },
  {
    q: 'What order are artists listed in?',
    a: 'Order: artists are listed by their earliest upcoming show — soonest tours first, furthest-out last — so the most time-sensitive travel-booking opportunities are at the top.',
  },
];

// Same sort key as automation/build-tour-announcements.js's earliestEventDate
// — soonest tour first, furthest-out last — applied here too so display
// order is correct regardless of the fetched JSON's own order. Dates are ISO
// "YYYY-MM-DD", so string comparison is already chronological.
function earliestEventDate(entry) {
  const dates = (entry.events || []).map((e) => e.date).filter(Boolean).sort();
  return dates[0] || '9999-12-31';
}

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

// Pure helper: apply search + genre + roster filters to an entries array.
function applyFilters(entries, filters) {
  const q = filters.search.trim().toLowerCase();
  return (entries || []).filter((e) => {
    if (q) {
      const hay = `${e.artist || ''} ${e.genre || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.genre !== 'all' && e.genre !== filters.genre) return false;
    if (filters.roster === 'tracked' && e.discovered) return false;
    if (filters.roster === 'discovered' && !e.discovered) return false;
    return true;
  });
}

export default function TourAnnouncements() {
  const [entries, setEntries] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [savedOnly, setSavedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const savedAnnouncements = useSavedAnnouncements();

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

  // savedOnly swaps the whole source list to the local bookmark store — a
  // personal list that survives an artist aging out of the live feed —
  // rather than just hiding unsaved cards from the live list.
  const baseList = savedOnly ? savedAnnouncements : entries || [];

  const genreOptions = useMemo(() => {
    const set = new Set();
    baseList.forEach((e) => {
      if (e.genre) set.add(e.genre);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [baseList]);

  const filtered = applyFilters(baseList, filters).sort(
    (a, b) => earliestEventDate(a).localeCompare(earliestEventDate(b)) || (a.artist || '').localeCompare(b.artist || '')
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const startIdx = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(currentPage * PAGE_SIZE, filtered.length);

  const isDefaultFilters =
    filters.search === DEFAULT_FILTERS.search && filters.genre === DEFAULT_FILTERS.genre && filters.roster === DEFAULT_FILTERS.roster;

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  return (
    <div className="tour-announcements">
      <div className="profile-intro">
        <h2>New Tour Detected</h2>
        <p>Confirmed tours that are on sale but haven&rsquo;t started yet. Soonest shows first.</p>
      </div>

      {entries && entries.length > 0 && (
        <div className="stage-explainer">
          <h3>FAQ</h3>
          <dl className="stage-explainer-faq">
            {NEW_TOUR_FAQ.map((item) => (
              <div className="stage-explainer-qa" key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="controls-row">
          <div className="search-field">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search by artist or genre"
              value={filters.search}
              onChange={(e) => setFilter({ search: e.target.value })}
              aria-label="Search by artist or genre"
            />
          </div>

          <select
            className="control-select"
            value={filters.genre}
            onChange={(e) => setFilter({ genre: e.target.value })}
            aria-label="Filter by genre"
          >
            <option value="all">All genres</option>
            {genreOptions.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select
            className="control-select"
            value={filters.roster}
            onChange={(e) => setFilter({ roster: e.target.value })}
            aria-label="Filter by roster"
          >
            <option value="all">All artists</option>
            <option value="tracked">Your roster</option>
            <option value="discovered">Not in your roster</option>
          </select>

          <button
            type="button"
            className={`saved-filter-toggle ${savedOnly ? 'active' : ''}`}
            onClick={() => {
              setSavedOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={savedOnly}
          >
            {savedOnly ? 'Showing saved' : `Saved${savedAnnouncements.length > 0 ? ` (${savedAnnouncements.length})` : ''}`}
          </button>

          {!isDefaultFilters && (
            <button
              className="controls-reset"
              type="button"
              onClick={() => {
                setFilters({ ...DEFAULT_FILTERS });
                setPage(1);
              }}
            >
              Reset
            </button>
          )}
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

      {entries && entries.length > 0 && filtered.length === 0 && (
        <div className="state">
          <div className="emoji">🔍</div>
          <h2>{savedOnly ? 'No saved artists yet' : 'No artists match your filters'}</h2>
          <p>
            {savedOnly
              ? 'Tap the bookmark on any artist to save them here.'
              : 'Try a different search or filter, or reset them to see everyone.'}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <div className="result-count">
            Showing {startIdx}&ndash;{endIdx} of {filtered.length} artist{filtered.length === 1 ? '' : 's'}
          </div>
          <div className="cards-grid">
            {pageItems.map((entry) => (
              <AnnouncementCard key={entry.artist} entry={entry} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination-row">
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="Previous page"
              >
                ‹
              </button>
              <span className="pagination-status">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

// Save-for-later toggle, rendered in ArtistCard's top-right overlay slot
// (same position/style as the Leads bookmark, via the shared .bookmark-btn
// class) but backed by lib/savedAnnouncements.js instead of the Leads store.
function SavedAnnouncementToggle({ entry }) {
  const saved = useIsAnnouncementSaved(entry.artist);
  return (
    <button
      type="button"
      className={`bookmark-btn ${saved ? 'saved' : ''}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${entry.artist} from saved` : `Save ${entry.artist} to come back to later`}
      title={saved ? 'Saved' : 'Save for later'}
      onClick={(e) => {
        e.stopPropagation();
        toggleSavedAnnouncement(entry);
      }}
    >
      <BookmarkGlyph filled={saved} />
    </button>
  );
}

// Reuses ArtistCard.jsx directly (hideScore — this is a neutral, unscored
// feed) for visual parity with the rest of the app, then appends the
// announcement-specific info below it, same continuous-card pattern
// MyArtists.jsx uses for its own footer (see .myartist-item/.myartist-extra).
// The roster badge lives in ArtistCard's own card-badges row now (next to
// genre — see ArtistCard.jsx's `lead.discovered` handling); dates/cities
// counts replace the old default stats row via the `stats` override prop.
function AnnouncementCard({ entry }) {
  const events = dedupeEvents(entry.events || []);
  const next = events[0];
  const dateCount = events.length;
  const cityCount = new Set(events.map((e) => (e.city || '').trim().toLowerCase()).filter(Boolean)).size;

  return (
    <div className="myartist-item">
      <ArtistCard
        lead={toLeadShape(entry)}
        hideScore
        hideStats
        stats={[
          { k: 'Dates', v: dateCount },
          { k: 'Cities', v: cityCount },
        ]}
        route={announcementRoute(entry)}
        saveButton={<SavedAnnouncementToggle entry={entry} />}
      />
      {next && (
        <div className="myartist-extra">
          <p className="pc-first-show">
            <strong>First Show:</strong> {longDate(next.date)}, {next.venue || 'Venue TBA'}
            {next.city && ` · ${next.city}`}
          </p>
        </div>
      )}
    </div>
  );
}
