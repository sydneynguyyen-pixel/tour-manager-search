// Header button linking to the FAQ page (/faq) — how the tool works day to
// day, separate from scoring mechanics (see ScoreLegend.jsx for that).

import { Link } from 'react-router-dom';

export default function FaqLink() {
  return (
    <Link className="legend-btn" to="/faq" aria-label="FAQ">
      <span aria-hidden="true">?</span>
      FAQ
    </Link>
  );
}
