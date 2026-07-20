// Header button linking to the Settings page (/settings) — currently just
// Genre Preferences. Mirrors ScoreLegend.jsx's button so the two header
// links look consistent.

import { Link } from 'react-router-dom';

export default function SettingsLink() {
  return (
    <Link className="legend-btn" to="/settings" aria-label="Settings">
      <span aria-hidden="true">⚙</span>
      Settings
    </Link>
  );
}
