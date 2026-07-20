// Header button linking to the full "How Scoring Works" page (/scoring-guide).

import { Link } from 'react-router-dom';

export default function ScoreLegend() {
  return (
    <Link className="legend-btn" to="/scoring-guide" aria-label="How scoring works">
      <span className="legend-info" aria-hidden="true">i</span>
      Scoring guide
    </Link>
  );
}
