// "My Artists" — Matthew's own history of the artists/tours he's worked. This is
// the single consolidated log (it absorbed the old Profile experience form): a
// rich structured entry form plus editable/deletable cards, newest first.
//
// It no longer feeds any discovery/seed pipeline — it's personal history that
// also drives the "Suggested adjustments" calibration panel below the list.
// Entries save to localStorage only (see lib/myArtists).

import { useState } from 'react';
import { ROLES } from '../lib/roles';
import { GENRE_OPTIONS, genreLabel } from '../lib/scoringSettings';
import { loadEntries, saveEntries } from '../lib/myArtists';
import CalibrationPanel from './CalibrationPanel';

const SCOPES = ['Regional', 'National', 'International'];

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Year dropdown runs from this year back ~40 years — plenty for a touring career.
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 41 }, (_, i) => CURRENT_YEAR - i);

const EMPTY_FORM = {
  artistName: '',
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

// "Tour Manager", falling back to the free-text value when role is "Other".
function roleLabel(entry) {
  if (entry.role === 'Other') return entry.roleOther?.trim() || 'Other';
  return entry.role;
}

// Display label for a logged genre ("Other" -> the free-text value).
function genreDisplay(entry) {
  const g = entry.genre === 'Other' ? entry.genreOther : entry.genre;
  return g ? genreLabel(g) : '';
}

// "Jun 2025" / "" when incomplete.
function monthYear(month, year) {
  if (year && month) return `${month} ${year}`;
  if (year) return String(year);
  return '';
}

// "Jun 2025–Sep 2025" / "Jun 2025–Present" / "Jun 2025".
function dateRange(entry) {
  const start = monthYear(entry.startMonth, entry.startYear);
  const end = entry.isPresent ? 'Present' : monthYear(entry.endMonth, entry.endYear);
  if (start && end) return `${start}–${end}`;
  return start || end;
}

// "300–2000 cap venues" / "300+ cap venues" / "up to 2000 cap venues" / "".
function venueRange(entry) {
  const min = entry.minCap !== '' ? Number(entry.minCap) : null;
  const max = entry.maxCap !== '' ? Number(entry.maxCap) : null;
  if (min != null && max != null) return `${min}–${max} cap venues`;
  if (min != null) return `${min}+ cap venues`;
  if (max != null) return `up to ${max} cap venues`;
  return '';
}

export default function MyArtists() {
  const [entries, setEntries] = useState(loadEntries);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const canSave = form.artistName.trim().length > 0;

  // Single source of truth for a mutation: update state and save locally.
  // localStorage is the only store — GitHub sync is deferred (see lib/myArtists).
  const persist = (next) => {
    setEntries(next);
    saveEntries(next);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSave) return;

    const cleaned = {
      ...form,
      artistName: form.artistName.trim(),
      roleOther: form.roleOther.trim(),
      genreOther: form.genreOther.trim(),
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      notes: form.notes.trim(),
    };

    if (editingId) {
      persist(entries.map((en) => (en.id === editingId ? { ...en, ...cleaned } : en)));
    } else {
      // Newest first, auto-timestamped.
      persist([{ ...cleaned, id: crypto.randomUUID(), addedAt: new Date().toISOString() }, ...entries]);
    }
    resetForm();
  };

  const handleEdit = (entry) => {
    // Strip fields the form doesn't own (id, timestamp) before populating it.
    const { id: _id, addedAt: _addedAt, ...rest } = entry;
    setForm({ ...EMPTY_FORM, ...rest });
    setEditingId(entry.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (id) => {
    persist(entries.filter((en) => en.id !== id));
    if (editingId === id) resetForm();
  };

  return (
    <div className="myartists">
      <div className="profile-intro">
        <h2>My Artists</h2>
        <p>
          Artists you&rsquo;ve worked with. This is your own history — it also helps calibrate what
          the search prioritizes for you.
        </p>
      </div>

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

          <label className="pf-field">
            <span className="pf-label">Role</span>
            <select
              className="pf-input pf-select"
              value={form.role}
              onChange={(e) => set({ role: e.target.value })}
            >
              {ROLES.map((r) => (
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
            <span className="pf-label">Tour scope</span>
            <select
              className="pf-input pf-select"
              value={form.scope}
              onChange={(e) => set({ scope: e.target.value })}
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div className="pf-field">
            <span className="pf-label">Start</span>
            <div className="pf-date">
              <select
                className="pf-input pf-select"
                value={form.startMonth}
                onChange={(e) => set({ startMonth: e.target.value })}
                aria-label="Start month"
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
                aria-label="Start year"
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
            <button type="button" className="pf-btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          )}
          <button type="submit" className="pf-btn" disabled={!canSave}>
            {editingId ? 'Update artist' : 'Add artist'}
          </button>
        </div>
      </form>

      <div className="profile-list-head">
        <h3>
          Your artists <span className="pf-count">{entries.length}</span>
        </h3>
      </div>

      {entries.length === 0 ? (
        <p className="profile-empty">No artists yet. Add the first one above.</p>
      ) : (
        <div className="profile-cards">
          {entries.map((entry) => (
            <ArtistEntryCard
              key={entry.id}
              entry={entry}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {entries.length >= 2 && <CalibrationPanel entries={entries} />}
    </div>
  );
}

function ArtistEntryCard({ entry, onEdit, onDelete }) {
  const genre = genreDisplay(entry);
  const range = dateRange(entry);
  const venues = venueRange(entry);

  return (
    <div className="profile-card myartist-card">
      <div className="pc-body">
        <div className="pc-role">{roleLabel(entry)}</div>
        <div className="pc-artist">{entry.artistName}</div>

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
      </div>

      <div className="pc-actions">
        <button type="button" className="pc-link" onClick={() => onEdit(entry)}>
          Edit
        </button>
        <button type="button" className="pc-link pc-danger" onClick={() => onDelete(entry.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
