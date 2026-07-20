// Compact nav cluster for the header's info links (Scoring guide / Scan
// history / Updates / FAQ / Settings) — one grouped component instead of a
// separate header button per link. Renders as a tightly-spaced row of
// buttons on wide screens; collapses into a single "Info" dropdown below the
// breakpoint (see .info-cluster / .info-menu in index.css) so five items
// don't crowd out the Scan now CTA.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const LINKS = [
  { to: '/scoring-guide', label: 'Scoring guide', icon: 'i' },
  { to: '/scan-history', label: 'Scan history', icon: '↻' },
  { to: '/updates', label: 'Updates', icon: '★' },
  { to: '/faq', label: 'FAQ', icon: '?' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function InfoMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {/* Wide screens: tight row of buttons. */}
      <div className="info-cluster" aria-label="Help & settings">
        {LINKS.map((l) => (
          <Link key={l.to} className="legend-btn" to={l.to} aria-label={l.label}>
            <span className="legend-info" aria-hidden="true">
              {l.icon}
            </span>
            {l.label}
          </Link>
        ))}
      </div>

      {/* Narrow screens: single toggle + dropdown. */}
      <div className="info-menu" ref={wrapRef}>
        <button
          type="button"
          className="legend-btn info-menu-toggle"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">☰</span>
          Info
        </button>
        {open && (
          <div className="info-menu-dropdown" role="menu">
            {LINKS.map((l) => (
              <Link
                key={l.to}
                className="info-menu-item"
                role="menuitem"
                to={l.to}
                onClick={() => setOpen(false)}
              >
                <span aria-hidden="true">{l.icon}</span>
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
