// A single artist lead card, matching the Figma card design (Frame_3).
// Clicking (or Enter/Space) opens the detail modal via onSelect.

import { compactNumber, shortDate, venueCap, scoreColor, longDate } from '../lib/format';
import { getGenreColor } from '../utils/genreColors';
import { getPriorityTier } from '../utils/scoreExplanations';
import BookmarkButton from './BookmarkButton';

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

export default function ArtistCard({ lead, onSelect }) {
  const desc = lead.fitReasoning?.[0] || 'No summary available.';
  // Listener count now comes from Last.fm (lead.listeners is null post-Spotify);
  // fall back to lead.listeners so the bundled mock still renders.
  const listenerCount = lead.lastfmListeners ?? lead.listeners;
  const listeners = listenerCount != null ? `${compactNumber(listenerCount)} monthly listeners` : '—';
  const releases = Array.isArray(lead.recentReleases) ? lead.recentReleases.slice(0, 5) : [];
  const genreColor = getGenreColor(lead.genre);
  const tier = getPriorityTier(lead.finalScore);

  return (
    <div className="artist-card-wrap">
      <BookmarkButton lead={lead} />
      <button className="artist-card" onClick={() => onSelect(lead)} type="button">
        <div className="card-body">
          <h3 className="card-name">{lead.artist}</h3>
          <p className="card-desc">{desc}</p>

          <hr className="card-divider" />

          <div className="card-badges">
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
            {lead.imageUrl ? (
              <img className="card-image" src={lead.imageUrl} alt={lead.artist} />
            ) : (
              <div className="card-image" aria-hidden="true" />
            )}
            <span className={`score-badge ${scoreColor(lead.finalScore)}`}>{lead.finalScore}</span>
          </div>
          <div className={`card-tier ${tier.tone}`}>{tier.label}</div>
        </div>
      </button>
    </div>
  );
}
