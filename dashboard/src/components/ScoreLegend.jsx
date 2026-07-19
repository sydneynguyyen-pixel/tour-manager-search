// Always-available scoring legend. An info button in the header toggles a small
// popover explaining what the three score tiers mean. Closes on outside click
// or Escape.

import { useEffect, useRef, useState } from 'react';
import { SCORE_TIERS } from '../utils/scoreExplanations';

export default function ScoreLegend() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="legend-wrap" ref={wrapRef}>
      <button
        className="legend-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="What do the scores mean?"
      >
        <span className="legend-info" aria-hidden="true">i</span>
        Scoring guide
      </button>
      {open && (
        <div className="legend-pop" role="dialog" aria-label="Scoring guide">
          <div className="legend-title">What the scores mean</div>
          {SCORE_TIERS.map((t) => (
            <div className="legend-row" key={t.key}>
              <span className={`legend-dot ${t.tone}`} aria-hidden="true" />
              <div>
                <div className="legend-head">
                  <strong>{t.range}</strong> — {t.label}
                </div>
                <div className="legend-blurb">{t.blurb}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
