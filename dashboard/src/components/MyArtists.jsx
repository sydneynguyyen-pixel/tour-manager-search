// "My Artists" — Matthew's own history of the artists/tours he's worked. This is
// the single consolidated log (it absorbed the old Profile experience form): a
// rich structured entry form plus editable/deletable cards, newest first.
//
// It no longer feeds any discovery/seed pipeline — it's personal history that
// also drives the "Suggested adjustments" calibration panel below the list.
// Entries save to localStorage first, then sync to GitHub in the background
// (see lib/myArtists).

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROLES, BOOKING_ROLES } from '../lib/roles';
import { GENRE_OPTIONS, genreLabel } from '../lib/scoringSettings';
import {
  loadEntries,
  saveEntries,
  buildSeedEntries,
  hasSeeded,
  markSeeded,
  toLeadShape,
  myArtistRoute,
  TOURING_TYPE,
  BOOKED_TYPE,
} from '../lib/myArtists';
import { roleLabel, genreDisplay, dateRange, venueRange } from '../utils/myArtistFields';
import ArtistCard from './ArtistCard';
import CalibrationPanel from './CalibrationPanel';

// "Booked for event/lineup" (festival slot, one-off show, showcase) is not a
// touring role, so it swaps in its own role/scope option sets below.
const RELATIONSHIP_TYPES = [TOURING_TYPE, BOOKED_TYPE, 'Other'];

const SCOPES = ['Regional', 'National', 'International'];
const EVENT_TYPES = ['Campus event', 'Festival', 'Club show', 'Other'];

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Year dropdown runs from this year back ~40 years — plenty for a touring career.
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 41 }, (_, i) => CURRENT_YEAR - i);

// Soft check only — used for an inline hint, never blocks saving. A pasted
// URL that fails to load is caught by the live preview's onError instead.
function looksLikeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const EMPTY_FORM = {
  artistName: '',
  imageUrl: '',
  relationshipType: RELATIONSHIP_TYPES[0], // Touring — the common default
  role: ROLES[0],
  roleOther: '',
  genre: '',
  genreOther: '',
  scope: SCOPES[1], // National — the common default
  startMonth: '',
  startYear: '',
  isPresent: false,
  endMonth: '',
  endYear: '',
  minCap: '',
  maxCap: '',
  contactName: '',
  contactEmail: '',
  notes: '',
};

export default function MyArtists() {
  const [entries, setEntries] = useState(loadEntries);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const canSave = form.artistName.trim().length > 0;
  const trimmedImageUrl = form.imageUrl.trim();

  const isBooking = form.relationshipType === BOOKED_TYPE;
  const roleOptions = isBooking ? BOOKING_ROLES : ROLES;
  const scopeOptions = isBooking ? EVENT_TYPES : SCOPES;

  // Switching type changes which role/scope option sets apply, so reset both
  // to a valid default rather than leaving a stale value from the other set.
  // Booking is a single date, not a range, so it also clears End/Present.
  const handleRelationshipTypeChange = (value) => {
    const nowBooking = value === BOOKED_TYPE;
    set({
      relationshipType: value,
      role: (nowBooking ? BOOKING_ROLES : ROLES)[0],
      roleOther: '',
      scope: nowBooking ? EVENT_TYPES[0] : SCOPES[1],
      ...(nowBooking ? { endMonth: '', endYear: '', isPresent: false } : {}),
    });
  };

  // One-time, silent copy of the backend's 27-artist seed roster into this
  // localStorage store (see lib/myArtists) — not a sync mechanism, just gets
  // Matthew seeing them (now with real images/genre/bio/tour history) on first
  // visit with zero clicks. Guarded by hasSeeded()/markSeeded() so it never
  // re-runs or duplicates entries. buildSeedEntries() fetches the backend's
  // enriched my-artists.json, so this effect is async.
  useEffect(() => {
    if (hasSeeded()) return;
    let cancelled = false;
    (async () => {
      const seedEntries = await buildSeedEntries();
      if (cancelled) return;
      setEntries((current) => {
        const next = [...current, ...seedEntries];
        saveEntries(next);
        return next;
      });
      markSeeded();
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — intentionally not re-checking `entries`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The detail page's "Edit" action (My Notes tab) can't open this modal
  // itself — it navigates here and asks for a specific entry via router
  // state, since the modal/form only exists in this component. Clear the
  // state after consuming it so a subsequent back/forward doesn't reopen it.
  useEffect(() => {
    const wantId = location.state?.editArtistId;
    if (!wantId) return;
    const entry = entries.find((en) => en.id === wantId);
    if (entry) handleEdit(entry);
    navigate(location.pathname, { replace: true, state: null });
    // Only reacts to a fresh navigation carrying editArtistId; entries/
    // handleEdit intentionally excluded to avoid re-triggering on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  // Single source of truth for a mutation: update state, save locally, and
  // kick off a best-effort background sync to GitHub (see saveEntries in
  // lib/myArtists — localStorage is written first and is what the UI reads
  // from, so a sync failure never blocks or is visible here).
  const persist = (next) => {
    setEntries(next);
    saveEntries(next);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setImagePreviewError(false);
  };

  const closeModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSave) return;

    const cleaned = {
      ...form,
      artistName: form.artistName.trim(),
      imageUrl: form.imageUrl.trim(),
      roleOther: form.roleOther.trim(),
      genreOther: form.genreOther.trim(),
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      notes: form.notes.trim(),
    };

    if (editingId) {
      // Saving an edit means Matthew has curated this entry, whether it started
      // out imported or not — it no longer counts as an untouched import.
      persist(entries.map((en) => (en.id === editingId ? { ...en, ...cleaned, imported: false } : en)));
    } else {
      // Newest first, auto-timestamped.
      persist([{ ...cleaned, id: crypto.randomUUID(), addedAt: new Date().toISOString() }, ...entries]);
    }
    setModalOpen(false);
    resetForm();
  };

  const handleEdit = (entry) => {
    // Strip fields the form doesn't own (id, timestamp) before populating it.
    const { id: _id, addedAt: _addedAt, ...rest } = entry;
    setForm({ ...EMPTY_FORM, ...rest });
    setEditingId(entry.id);
    setModalOpen(true);
    setImagePreviewError(false);
  };

  const handleDelete = (id) => {
    persist(entries.filter((en) => en.id !== id));
    if (editingId === id) closeModal();
  };

  const importedCount = entries.filter((en) => en.imported).length;
  const manualCount = entries.length - importedCount;

  // Manually-added/edited entries first (most relevant), imported-but-untouched
  // ones after — imported entries sort alphabetically since there are 27+ of
  // them and no natural recency to lean on; manual entries keep their existing
  // newest-first order (stable sort preserves it within an equal group).
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? entries.filter((en) => en.artistName.toLowerCase().includes(q)) : entries;
    return [...filtered].sort((a, b) => {
      const aImported = !!a.imported;
      const bImported = !!b.imported;
      if (aImported !== bImported) return aImported ? 1 : -1;
      return aImported ? a.artistName.localeCompare(b.artistName) : 0;
    });
  }, [entries, search]);

  return (
    <div className="myartists">
      <div className="profile-intro">
        <h2>My Artists</h2>
        <p>
          Artists you&rsquo;ve worked with. This is your own history — it also helps calibrate what
          the search prioritizes for you.
        </p>
      </div>

      <div className="profile-add-row">
        <button type="button" className="pf-btn-add" onClick={() => setModalOpen(true)}>
          + Add artist
        </button>
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal} role="presentation">
          <div
            className="modal modal-form-shell"
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit artist' : 'Add artist'}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={closeModal} aria-label="Close">
              ✕
            </button>

            <form className="profile-form" onSubmit={handleSubmit}>
              <h3 className="profile-form-title">{editingId ? 'Edit artist' : 'Add artist'}</h3>

              <div className="pf-grid">
          <label className="pf-field pf-col-2">
            <span className="pf-label">
              Artist / Tour name <span className="pf-req">*</span>
            </span>
            <input
              type="text"
              className="pf-input"
              value={form.artistName}
              onChange={(e) => set({ artistName: e.target.value })}
              placeholder="e.g. Phoebe Bridgers — Reunion Tour"
              required
            />
          </label>

          <label className="pf-field pf-col-2">
            <span className="pf-label">
              Photo URL <span className="pf-optional">(optional)</span>
            </span>
            <input
              type="text"
              className="pf-input"
              value={form.imageUrl}
              onChange={(e) => {
                set({ imageUrl: e.target.value });
                setImagePreviewError(false);
              }}
              placeholder="https://…"
            />
            {trimmedImageUrl && !looksLikeUrl(trimmedImageUrl) && (
              <span className="pf-hint pf-hint-warn">Doesn&rsquo;t look like a valid URL.</span>
            )}
            {trimmedImageUrl && (
              <div className="pf-image-preview">
                {imagePreviewError ? (
                  <span className="pf-image-preview-error">Couldn&rsquo;t load an image from this URL.</span>
                ) : (
                  <img
                    key={trimmedImageUrl}
                    src={trimmedImageUrl}
                    alt=""
                    className="pf-image-preview-thumb"
                    onError={() => setImagePreviewError(true)}
                  />
                )}
              </div>
            )}
          </label>

          <label className="pf-field">
            <span className="pf-label">Relationship type</span>
            <select
              className="pf-input pf-select"
              value={form.relationshipType}
              onChange={(e) => handleRelationshipTypeChange(e.target.value)}
            >
              <option value="">Select type</option>
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="pf-field">
            <span className="pf-label">Role</span>
            <select
              className="pf-input pf-select"
              value={form.role}
              onChange={(e) => set({ role: e.target.value })}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          {form.role === 'Other' && (
            <label className="pf-field">
              <span className="pf-label">Role (specify)</span>
              <input
                type="text"
                className="pf-input"
                value={form.roleOther}
                onChange={(e) => set({ roleOther: e.target.value })}
                placeholder="e.g. Merch Lead"
              />
            </label>
          )}

          <label className="pf-field">
            <span className="pf-label">Genre</span>
            <select
              className="pf-input pf-select"
              value={form.genre}
              onChange={(e) => set({ genre: e.target.value })}
            >
              <option value="">Select genre</option>
              {GENRE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {genreLabel(g)}
                </option>
              ))}
              <option value="Other">Other</option>
            </select>
          </label>

          {form.genre === 'Other' && (
            <label className="pf-field">
              <span className="pf-label">Genre (specify)</span>
              <input
                type="text"
                className="pf-input"
                value={form.genreOther}
                onChange={(e) => set({ genreOther: e.target.value })}
                placeholder="e.g. Afrobeats"
              />
            </label>
          )}

          <label className="pf-field">
            <span className="pf-label">{isBooking ? 'Event type' : 'Tour scope'}</span>
            <select
              className="pf-input pf-select"
              value={form.scope}
              onChange={(e) => set({ scope: e.target.value })}
            >
              {scopeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div className="pf-field">
            <span className="pf-label">{isBooking ? 'Date' : 'Start'}</span>
            <div className="pf-date">
              <select
                className="pf-input pf-select"
                value={form.startMonth}
                onChange={(e) => set({ startMonth: e.target.value })}
                aria-label={isBooking ? 'Month' : 'Start month'}
              >
                <option value="">Month</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className="pf-input pf-select"
                value={form.startYear}
                onChange={(e) => set({ startYear: e.target.value })}
                aria-label={isBooking ? 'Year' : 'Start year'}
              >
                <option value="">Year</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isBooking && (
            <div className="pf-field">
              <span className="pf-label">End</span>
              <div className="pf-date">
                <select
                  className="pf-input pf-select"
                  value={form.endMonth}
                  onChange={(e) => set({ endMonth: e.target.value })}
                  disabled={form.isPresent}
                  aria-label="End month"
                >
                  <option value="">Month</option>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  className="pf-input pf-select"
                  value={form.endYear}
                  onChange={(e) => set({ endYear: e.target.value })}
                  disabled={form.isPresent}
                  aria-label="End year"
                >
                  <option value="">Year</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <label className="pf-present">
                <input
                  type="checkbox"
                  checked={form.isPresent}
                  onChange={(e) => set({ isPresent: e.target.checked })}
                />
                Present
              </label>
            </div>
          )}

          <div className="pf-field">
            <span className="pf-label">
              Venue size worked <span className="pf-optional">(optional)</span>
            </span>
            <div className="pf-date">
              <input
                type="number"
                min="0"
                className="pf-input"
                value={form.minCap}
                onChange={(e) => set({ minCap: e.target.value })}
                placeholder="Min cap"
                aria-label="Minimum venue capacity"
              />
              <input
                type="number"
                min="0"
                className="pf-input"
                value={form.maxCap}
                onChange={(e) => set({ maxCap: e.target.value })}
                placeholder="Max cap"
                aria-label="Maximum venue capacity"
              />
            </div>
          </div>

          <label className="pf-field">
            <span className="pf-label">
              Contact name <span className="pf-optional">(optional)</span>
            </span>
            <input
              type="text"
              className="pf-input"
              value={form.contactName}
              onChange={(e) => set({ contactName: e.target.value })}
              placeholder="e.g. Jamie (manager)"
            />
          </label>

          <label className="pf-field">
            <span className="pf-label">
              Contact email <span className="pf-optional">(optional)</span>
            </span>
            <input
              type="email"
              className="pf-input"
              value={form.contactEmail}
              onChange={(e) => set({ contactEmail: e.target.value })}
              placeholder="e.g. mgmt@example.com"
            />
          </label>

          <label className="pf-field pf-col-2">
            <span className="pf-label">
              Notes <span className="pf-optional">(optional)</span>
            </span>
            <textarea
              className="pf-input pf-textarea"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="e.g. worked their 2025 club run — solid relationship with the TM"
              rows={3}
            />
          </label>
        </div>

        <div className="pf-actions">
          {editingId && (
            <button type="button" className="pf-btn-ghost" onClick={closeModal}>
              Cancel
            </button>
          )}
          <button type="submit" className="pf-btn" disabled={!canSave}>
            {editingId ? 'Update artist' : 'Add artist'}
          </button>
        </div>
              </form>
          </div>
        </div>
      )}

      <div className="profile-list-head">
        <h3>
          Your artists <span className="pf-count">{entries.length}</span>
        </h3>
        {entries.length > 0 && (
          <p className="profile-list-summary">
            {entries.length} artist{entries.length === 1 ? '' : 's'} ({importedCount} imported,{' '}
            {manualCount} added manually)
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="profile-empty">No artists yet. Add the first one above.</p>
      ) : (
        <>
          <input
            type="search"
            className="pf-input myartists-search"
            placeholder="Search by artist name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search your artists"
          />

          {visibleEntries.length === 0 ? (
            <p className="profile-empty">No artists match &ldquo;{search}&rdquo;.</p>
          ) : (
            <div className="cards-grid">
              {visibleEntries.map((entry) => (
                <ArtistEntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      {entries.length >= 2 && <CalibrationPanel entries={entries} />}
    </div>
  );
}

// Reuses ArtistCard.jsx directly (hideScore — these aren't scored leads, and
// their own detail route) for full visual parity with the Leads feed: same
// image, bio, genre/listener pills, stats row, release thumbnails. The My
// Artists-specific bits (role, imported badge, note, add-details prompt,
// edit/delete) live in a separate footer box appended below it, so the
// shared card itself is untouched.
function ArtistEntryCard({ entry, onEdit, onDelete }) {
  const role = roleLabel(entry);
  const genre = genreDisplay(entry, genreLabel);
  const range = dateRange(entry);
  const venues = venueRange(entry);
  const hasDetails = Boolean(role || genre || range || venues);

  return (
    <div className="myartist-item">
      <ArtistCard lead={toLeadShape(entry)} hideScore route={myArtistRoute(entry)} />

      <div className="myartist-extra">
        <div className="pc-role-row">
          <span className={role ? 'pc-role' : 'pc-role pc-role-placeholder'}>
            {role || 'Role not set'}
          </span>
          {entry.imported && <span className="pc-badge-imported">Imported</span>}
        </div>

        <div className="pc-meta">
          {genre && <span>{genre}</span>}
          {range && <span>{range}</span>}
          {entry.scope && <span>{entry.scope}</span>}
          {venues && <span>{venues}</span>}
        </div>

        {(entry.contactName || entry.contactEmail) && (
          <div className="pc-meta">
            {entry.contactName && <span>{entry.contactName}</span>}
            {entry.contactEmail && (
              <span>
                <a href={`mailto:${entry.contactEmail}`} onClick={(e) => e.stopPropagation()}>
                  {entry.contactEmail}
                </a>
              </span>
            )}
          </div>
        )}

        {entry.notes && <p className="pc-notes">{entry.notes}</p>}

        {entry.imported && !hasDetails && (
          <div className="pc-add-details">
            <span>No details yet</span>
            <button type="button" className="pc-link pc-add-details-btn" onClick={() => onEdit(entry)}>
              + Add details
            </button>
          </div>
        )}

        <div className="pc-actions">
          <button type="button" className="pc-link" onClick={() => onEdit(entry)}>
            Edit
          </button>
          <button type="button" className="pc-link pc-danger" onClick={() => onDelete(entry.id)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
