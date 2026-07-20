// Dismissed Artists — reached at /settings/dismissed via the Settings hub
// (see pages/Settings.jsx). Lists every artist hidden from the Leads feed via
// the "Not interested" (eye) toggle, newest first, each with an Undo action
// that restores it — see lib/dismissedArtists.js for the store.

import { Link } from 'react-router-dom';
import { useDismissedArtists, undoDismiss } from '../lib/dismissedArtists';

// dismissedAt is a full ISO timestamp (not a date-only string), so this
// formats it directly rather than reusing lib/format.js's longDate().
function dismissedDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DismissedArtists() {
  const dismissed = useDismissedArtists();

  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/settings">
          <span aria-hidden="true">←</span> Back to Settings
        </Link>
      </div>

      <div className="settings-article">
        <h1>Dismissed Artists</h1>

        <section className="settings-section">
          <p className="settings-instructions">
            Artists you&rsquo;ve marked not interested in. They&rsquo;re hidden from the Leads
            feed, including future scans, until you undo it here.
          </p>

          {dismissed.length === 0 ? (
            <p className="profile-empty">
              Nothing dismissed yet. Tap the eye icon on any lead to hide it from your feed.
            </p>
          ) : (
            <ul className="dismissed-list" role="list">
              {dismissed.map((item) => (
                <li className="dismissed-row" key={item.id}>
                  <span className="dismissed-row-info">
                    <span className="dismissed-row-name">{item.lead.artist}</span>
                    <span className="dismissed-row-meta">
                      {item.lead.genre || 'Unknown genre'} · Dismissed {dismissedDate(item.dismissedAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="pf-btn-ghost"
                    onClick={() => undoDismiss(item.id)}
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
