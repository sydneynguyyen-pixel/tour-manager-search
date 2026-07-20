// Human-readable changelog for Matthew (and any future users) — plain
// language, reverse-chronological, no commit-message jargon. Content lives in
// data/updates.js, maintained by hand; see that file's header comment for why
// this isn't auto-generated from git history. Reached at /updates via the
// header's info menu (see components/InfoMenu.jsx).

import { Link } from 'react-router-dom';
import UPDATES from '../data/updates';

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export default function Updates() {
  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/">
          <span aria-hidden="true">←</span> Back
        </Link>
      </div>

      <article className="guide-article">
        <h1>Updates</h1>
        <p className="scan-history-intro">
          What's changed in Tour Finder, in plain language — newest first.
        </p>

        <ul className="updates-list">
          {UPDATES.map((u) => (
            <li key={`${u.date}-${u.title}`} className="updates-row">
              <div className="updates-date">{formatDate(u.date)}</div>
              <div className="updates-body">
                <h2 className="updates-title">{u.title}</h2>
                <p className="updates-description">{u.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
