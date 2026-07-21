// A single artist lead card, matching the Figma card design (Frame_3).
// Clicking (or Enter/Space) navigates to the full artist detail page.
//
// Also reused (unmodified layout) by My Artists and New Tour Detected — see
// MyArtists.jsx / TourAnnouncements.jsx — for entries that aren't scored
// leads. Pass `hideScore` to omit the score badge/priority label and the
// default (Leads-store) bookmark toggle, and `route` to send the click
// somewhere other than the default /artist/:id (My Artists uses
// /my-artists/:id, New Tour Detected /tour-announcements/:id). `saveButton`
// is an optional node rendered in the same top-right slot when hideScore is
// set — New Tour Detected uses this for its own save-for-later toggle
// (lib/savedAnnouncements.js), since its entries carry no score/spotifyId to
// key the Leads bookmark store on. My Artists passes neither (saving doesn't
// apply to an artist Matthew already knows).

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { compactNumber, shortDate, venueCap, scoreColor, longDate } from '../lib/format';
import { getGenreColor } from '../utils/genreColors';
import { getPriorityTier } from '../utils/scoreExplanations';
import { getArtistSubtitle } from '../utils/artistSubtitle';
import { leadRoute } from '../lib/savedArtists';
import BookmarkButton from './BookmarkButton';
import DismissButton from './DismissButton';

// Small square album-art thumbnail with a hover/focus tooltip (name + date).
// Falls back to a gray square when a release has no artwork.
function ReleaseThumb({ release }) {
  const tip = [release.name, longDate(release.releaseDate)].filter(Boolean).join(' · ');
  return (
    <span className="release-thumb" aria-label={tip}>
      {release.imageUrl ? (
        <img src={release.imageUrl} alt="" loading="lazy" />
      ) : (
        <span className="release-thumb-fallback" aria-hidden="true" />
      )}
      <span className="release-tip">{tip}</span>
    </span>
  );
}

export default function ArtistCard({ lead, hideScore = false, route = null, saveButton = null }) {
  const navigate = useNavigate();
  // A manually-pasted or stale enrichment URL can 404 — fall back to the gray
  // placeholder rather than a broken-image icon. Reset whenever the artist's
  // imageUrl changes (e.g. Matthew fixes a broken link) so it gets a fresh try.
  const [imgError, setImgError] = useState(false);
  useEffect(() => setImgError(false), [lead.imageUrl]);
  // One-line artist description (bio-first; release/touring facts live in the
  // score breakdown, not the subtitle).
  const desc = getArtistSubtitle(lead);
  // Listener count now comes from Last.fm (lead.listeners is null post-Spotify);
  // fall back to lead.listeners so the bundled mock still renders.
  const listenerCount = lead.lastfmListeners ?? lead.listeners;
  const listeners = listenerCount != null ? `${compactNumber(listenerCount)} monthly listeners` : '—';
  const releases = Array.isArray(lead.recentReleases) ? lead.recentReleases.slice(0, 5) : [];
  const genreColor = getGenreColor(lead.genre);
  const tier = hideScore ? null : getPriorityTier(lead.finalScore);
  const dest = route ?? leadRoute(lead);

  return (
    <div className="artist-card-wrap">
      {!hideScore && <DismissButton lead={lead} />}
      {!hideScore && <BookmarkButton lead={lead} />}
      {hideScore && saveButton}
      <button className="artist-card" onClick={() => navigate(dest)} type="button">
        <div className="card-body">
          <h3 className="card-name">{lead.artist}</h3>
          <p className="card-desc">{desc}</p>

          <hr className="card-divider" />

          <div className="card-badges">
            {lead.isCurrentlyTouring && <span className="pill touring">🎤 On Tour Now</span>}
            <span className="pill genre" style={{ background: genreColor.background, color: genreColor.text }}>
              {lead.genre || 'Unknown'}
            </span>
            <span className="pill listeners">{listeners}</span>
          </div>

          <div className="card-stats">
            <div className="stat">
              <div className="v">{shortDate(lead.lastTourDate)}</div>
              <div className="k">Last Tour Date</div>
            </div>
            <div className="stat">
              <div className="v">{lead.tourCount ?? 0}</div>
              <div className="k">Number of tours</div>
            </div>
            <div className="stat">
              <div className="v">{venueCap(lead.avgVenueSize)}</div>
              <div className="k">Avg. Venue Cap</div>
            </div>
          </div>

          {releases.length > 0 && (
            <div className="card-releases" aria-label="Recent releases">
              {releases.map((r, i) => (
                <ReleaseThumb key={`${r.name}-${i}`} release={r} />
              ))}
            </div>
          )}
        </div>

        <div className="card-media">
          <div className="card-media-img">
            {lead.imageUrl && !imgError ? (
              <img
                className="card-image"
                src={lead.imageUrl}
                alt={lead.artist}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="card-image" aria-hidden="true" />
            )}
            {!hideScore && (
              <span className={`score-badge ${scoreColor(lead.finalScore)}`}>{lead.finalScore}</span>
            )}
          </div>
          {!hideScore && <div className={`card-tier ${tier.tone}`}>{tier.label}</div>}
        </div>
      </button>
    </div>
  );
}
