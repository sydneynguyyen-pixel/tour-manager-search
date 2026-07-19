// Bookmark toggle used on lead cards and in the detail modal. Renders a
// filled/unfilled bookmark based on whether the lead is currently saved.
//
// It stops click propagation so tapping it inside a clickable card doesn't also
// open the detail modal.

import { toggleSaved, useIsSaved } from '../lib/savedArtists';

function BookmarkGlyph({ filled }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export default function BookmarkButton({ lead, className = '' }) {
  const isSaved = useIsSaved(lead);
  return (
    <button
      type="button"
      className={`bookmark-btn ${isSaved ? 'saved' : ''} ${className}`.trim()}
      aria-pressed={isSaved}
      aria-label={isSaved ? `Remove ${lead.artist} from saved` : `Save ${lead.artist}`}
      title={isSaved ? 'Saved' : 'Save'}
      onClick={(e) => {
        e.stopPropagation();
        toggleSaved(lead);
      }}
    >
      <BookmarkGlyph filled={isSaved} />
    </button>
  );
}
