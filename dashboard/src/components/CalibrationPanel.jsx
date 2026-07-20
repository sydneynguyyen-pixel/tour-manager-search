// "Suggested adjustments" — reads Matthew's logged My Artists entries and, once
// there are 2+, surfaces how his real experience compares to the current scoring
// settings. Nothing here is auto-applied: every suggestion has an explicit Apply
// (which mutates the scoringSettings store) and a Dismiss (which hides just that
// suggestion until the numbers change).
//
// Suggestion signatures encode their values, so if the underlying entries change
// the suggestion re-appears even after a dismiss — i.e. it recalculates whenever
// entries change.

import { useMemo, useState } from 'react';
import {
  useScoringSettings,
  applyVenueRange,
  promoteGenresToTier1,
  genreTierOf,
  genreLabel,
} from '../lib/scoringSettings';
import { TOURING_TYPE, BOOKED_TYPE } from '../lib/myArtists';

const num = (n) => n.toLocaleString();

// Effective genre for an entry: the free-text value when "Other", else the pick.
function entryGenre(entry) {
  const g = entry.genre === 'Other' ? entry.genreOther : entry.genre;
  return g?.trim().toLowerCase() || '';
}

function computeCalibration(entries, settings) {
  // Venue range across every entry that filled in at least one cap.
  const caps = [];
  for (const e of entries) {
    if (e.minCap !== '' && e.minCap != null && !Number.isNaN(Number(e.minCap))) caps.push(Number(e.minCap));
    if (e.maxCap !== '' && e.maxCap != null && !Number.isNaN(Number(e.maxCap))) caps.push(Number(e.maxCap));
  }
  const venue = caps.length ? { min: Math.min(...caps), max: Math.max(...caps) } : null;

  // Genre distribution.
  const genreCounts = new Map();
  for (const e of entries) {
    const g = entryGenre(e);
    if (g) genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
  }
  const genres = [...genreCounts.entries()]
    .map(([genre, count]) => ({ genre, count, tier: genreTierOf(settings, genre) }))
    .sort((a, b) => b.count - a.count);

  // Scope distribution, split by relationship type — a Touring entry's scope
  // (Regional/National/International) and a Booked entry's event type
  // (Festival/Campus event/...) share the same `.scope` field but mean
  // different things, so blending them into one stat would be meaningless.
  // 'Other'/unset relationshipType entries don't have enough signal to sort
  // into either bucket, so they're excluded from both.
  const tourScopeCounts = new Map();
  const eventTypeCounts = new Map();
  for (const e of entries) {
    if (!e.scope) continue;
    if (e.relationshipType === TOURING_TYPE) {
      tourScopeCounts.set(e.scope, (tourScopeCounts.get(e.scope) || 0) + 1);
    } else if (e.relationshipType === BOOKED_TYPE) {
      eventTypeCounts.set(e.scope, (eventTypeCounts.get(e.scope) || 0) + 1);
    }
  }
  const tourScopes = [...tourScopeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const eventTypes = [...eventTypeCounts.entries()].sort((a, b) => b[1] - a[1]);

  return { venue, genres, tourScopes, eventTypes };
}

export default function CalibrationPanel({ entries }) {
  const settings = useScoringSettings();
  const [dismissed, setDismissed] = useState(() => new Set());

  const { venue, genres, tourScopes, eventTypes } = useMemo(
    () => computeCalibration(entries, settings),
    [entries, settings],
  );

  const dismiss = (id) => setDismissed((prev) => new Set(prev).add(id));

  // --- Build actionable suggestions ---
  const suggestions = [];

  const { venueMin, venueMax } = settings.thresholds;
  if (venue && (venue.min !== venueMin || venue.max !== venueMax)) {
    suggestions.push({
      id: `venue:${venue.min}-${venue.max}`,
      body: (
        <>
          Your venue range is <strong>{num(venue.min)}–{num(venue.max)} cap</strong> — current
          scoring range is {num(venueMin)}–{num(venueMax)}. Update?
        </>
      ),
      apply: () => applyVenueRange(venue.min, venue.max),
    });
  }

  // Genres worked 2+ times that aren't already top-tier.
  const bumpGenres = genres.filter((g) => g.count >= 2 && g.tier !== 1);
  if (bumpGenres.length) {
    const list = bumpGenres.map((g) => `${genreLabel(g.genre)} (${g.count})`).join(' and ');
    suggestions.push({
      id: `genre:${bumpGenres.map((g) => `${g.genre}x${g.count}`).join(',')}`,
      body: (
        <>
          You&rsquo;ve worked mostly <strong>{list}</strong> — want these bumped up in your genre
          tiers?
        </>
      ),
      apply: () => promoteGenresToTier1(bumpGenres.map((g) => g.genre)),
    });
  }

  const visible = suggestions.filter((s) => !dismissed.has(s.id));

  return (
    <div className="calibration">
      <div className="calibration-head">
        <h3>Suggested adjustments</h3>
        <p>Based on your logged experience:</p>
      </div>

      {visible.length === 0 ? (
        <p className="calibration-empty">
          Your scoring settings already match your logged experience. Log more artists to refine
          them further.
        </p>
      ) : (
        <ul className="calibration-list">
          {visible.map((s) => (
            <li key={s.id} className="calibration-item">
              <div className="calibration-text">{s.body}</div>
              <div className="calibration-actions">
                <button
                  type="button"
                  className="pf-btn"
                  onClick={() => {
                    s.apply();
                    // Applying satisfies the suggestion; it drops out on recompute.
                  }}
                >
                  Apply
                </button>
                <button type="button" className="pc-link" onClick={() => dismiss(s.id)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(genres.length > 0 || tourScopes.length > 0 || eventTypes.length > 0) && (
        <div className="calibration-stats">
          {genres.length > 0 && (
            <div className="calibration-stat">
              <span className="calibration-stat-k">Genres</span>
              <span className="calibration-stat-v">
                {genres.map((g) => `${genreLabel(g.genre)} ×${g.count}`).join(' · ')}
              </span>
            </div>
          )}
          {tourScopes.length > 0 && (
            <div className="calibration-stat">
              <span className="calibration-stat-k">Tour scope</span>
              <span className="calibration-stat-v">
                {tourScopes.map(([scope, count]) => `${scope} ×${count}`).join(' · ')}
              </span>
            </div>
          )}
          {eventTypes.length > 0 && (
            <div className="calibration-stat">
              <span className="calibration-stat-k">Event types booked</span>
              <span className="calibration-stat-v">
                {eventTypes.map(([type, count]) => `${type} ×${count}`).join(' · ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
