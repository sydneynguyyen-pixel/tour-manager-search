// The "Saved" tab — bookmarked leads, newest first. Reuses ArtistCard for the
// card itself; each card gains a private note (autosaved per-artist) and a
// "Remove from saved" action. Clicking a card opens the same detail page as
// the Leads tab.

import { useState } from 'react';
import ArtistCard from './ArtistCard';
import { useSavedArtists, removeSaved, setNote } from '../lib/savedArtists';

export default function SavedArtists() {
  const saved = useSavedArtists();

  return (
    <div className="saved">
      <div className="profile-intro">
        <h2>Saved artists</h2>
        <p>
          Leads you&rsquo;ve bookmarked. Jot a private note on each and remove them once
          you&rsquo;ve followed up.
        </p>
      </div>

      {saved.length === 0 ? (
        <p className="profile-empty">
          No saved artists yet. Tap the bookmark on any lead to keep it here.
        </p>
      ) : (
        <div className="saved-grid">
          {saved.map((item) => (
            <SavedItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function SavedItem({ item }) {
  // Local state drives the textarea; we write through to the store on change so
  // the note persists per-artist without the input ever losing its cursor.
  const [note, setLocalNote] = useState(item.note || '');

  const onNoteChange = (e) => {
    setLocalNote(e.target.value);
    setNote(item.id, e.target.value);
  };

  return (
    <div className="saved-item">
      <ArtistCard lead={item.lead} />
      <div className="saved-controls">
        <label className="saved-note">
          <span className="pf-label">Private note</span>
          <textarea
            className="saved-note-input"
            value={note}
            onChange={onNoteChange}
            placeholder="e.g. emailed manager 7/15 — waiting to hear back"
            rows={3}
          />
        </label>
        <button
          type="button"
          className="saved-remove"
          onClick={() => removeSaved(item.id)}
        >
          Remove from saved
        </button>
      </div>
    </div>
  );
}
