// "Not interested" toggle used on lead cards and the detail page. Hides the
// lead from the Leads feed going forward (see lib/dismissedArtists.js) — the
// eye-with-strikethrough is the standard hide/don't-show glyph.
//
// It stops click propagation so tapping it inside a clickable card doesn't also
// open the detail modal.

import { toggleDismissed, useIsDismissed } from '../lib/dismissedArtists';

function EyeOffGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export default function DismissButton({ lead, className = '' }) {
  const isDismissed = useIsDismissed(lead);
  return (
    <button
      type="button"
      className={`dismiss-btn ${isDismissed ? 'dismissed' : ''} ${className}`.trim()}
      aria-pressed={isDismissed}
      aria-label={isDismissed ? `Restore ${lead.artist} to leads` : `Not interested in ${lead.artist}`}
      title={isDismissed ? 'Restored' : 'Not interested'}
      onClick={(e) => {
        e.stopPropagation();
        toggleDismissed(lead);
      }}
    >
      <EyeOffGlyph />
    </button>
  );
}
