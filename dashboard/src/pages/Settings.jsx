// Settings hub — reached at /settings via the header's info menu (see
// components/InfoMenu.jsx). This page itself is just a list
// of links to dedicated sub-pages; add new sections here as new cards rather
// than growing this file into a single-feature page again.

import { Link } from 'react-router-dom';

const SETTINGS_SECTIONS = [
  {
    to: '/settings/genres',
    title: 'Genre Preferences',
    description: 'Reorder genres to nudge which leads score higher.',
  },
  {
    to: '/settings/dismissed',
    title: 'Dismissed Artists',
    description: 'See artists you’ve marked not interested in, and undo any of them.',
  },
];

export default function Settings() {
  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/">
          <span aria-hidden="true">←</span> Back
        </Link>
      </div>

      <div className="settings-article">
        <h1>Settings</h1>

        <nav className="settings-hub" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <Link className="settings-hub-card" key={section.to} to={section.to}>
              <span className="settings-hub-card-body">
                <span className="settings-hub-card-title">{section.title}</span>
                <span className="settings-hub-card-desc">{section.description}</span>
              </span>
              <span className="settings-hub-card-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
