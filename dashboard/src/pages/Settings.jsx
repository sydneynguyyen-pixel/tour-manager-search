// Settings page — reached at /settings via the "Settings" button in the
// header (see components/SettingsLink.jsx). Currently just Genre
// Preferences: a full ranked list of every tiered genre, reorderable by
// drag or the up/down buttons (drag alone doesn't work on touch devices, so
// the buttons are the accessible/mobile-friendly path, not an afterthought).
//
// Reordering is handled by lib/genrePreferences.js — this component only
// tracks transient drag-hover state; the actual persist + tier-recompute +
// background sync all happen in moveGenre().

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { genreLabel } from '../lib/scoringSettings';
import { getGenreColor } from '../utils/genreColors';
import { useGenrePreferenceOrder, moveGenre, tierIndexOf } from '../lib/genrePreferences';

const TIER_META = {
  1: { label: 'Tier 1', mult: '×1.15', className: 'tier1' },
  2: { label: 'Tier 2', mult: '×1.00', className: 'tier2' },
  3: { label: 'Tier 3', mult: '×0.95', className: 'tier3' },
  4: { label: 'Tier 4', mult: '×0.92', className: 'tier4' },
};

export default function Settings() {
  const order = useGenrePreferenceOrder();
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  // dragIndex (state) drives styling; this ref is what drop handlers read,
  // since it's always current even inside a handler created earlier in the
  // same drag gesture's render.
  const dragIndexRef = useRef(null);

  const handleDragStart = (index) => (e) => {
    dragIndexRef.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox won't initiate a drag without data set on it.
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (index) => (e) => {
    e.preventDefault();
    if (index !== overIndex) setOverIndex(index);
  };

  const clearDragState = () => {
    setDragIndex(null);
    setOverIndex(null);
    dragIndexRef.current = null;
  };

  const handleDrop = (index) => (e) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from != null) moveGenre(order, from, index);
    clearDragState();
  };

  const move = (index, delta) => moveGenre(order, index, index + delta);

  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/">
          <span aria-hidden="true">←</span> Back
        </Link>
      </div>

      <div className="settings-article">
        <h1>Settings</h1>

        <section className="settings-section">
          <h2>Genre Preferences</h2>
          <p className="settings-instructions">
            Drag genres to reorder — artists in genres near the top get a small scoring boost,
            genres near the bottom get a slight reduction. Doesn&rsquo;t exclude anything, just
            nudges priority.
          </p>
          <p className="settings-note">
            Changes here affect new leads going forward — they won&rsquo;t re-score artists
            already in your feed. If you want fresher scores reflecting your updated preferences,
            click &ldquo;Scan now&rdquo; from the main feed to pull in new leads.
          </p>

          <ul className="genre-rank-list" role="list">
            {order.map((genre, index) => {
              const tier = tierIndexOf(order, index);
              const meta = TIER_META[tier];
              const color = getGenreColor(genre);
              const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;
              return (
                <li
                  key={genre}
                  className={`genre-rank-item ${dragIndex === index ? 'dragging' : ''} ${
                    isOver ? 'drag-over' : ''
                  }`}
                  draggable
                  onDragStart={handleDragStart(index)}
                  onDragOver={handleDragOver(index)}
                  onDrop={handleDrop(index)}
                  onDragEnd={clearDragState}
                >
                  <span className="genre-rank-handle" aria-hidden="true">
                    ⠿
                  </span>
                  <span className="genre-rank-pos">{index + 1}</span>
                  <span
                    className="pill genre genre-rank-pill"
                    style={{ background: color.background, color: color.text }}
                  >
                    {genreLabel(genre)}
                  </span>
                  <span className={`genre-tier-badge ${meta.className}`}>
                    {meta.label} · {meta.mult}
                  </span>
                  <span className="genre-rank-arrows">
                    <button
                      type="button"
                      aria-label={`Move ${genreLabel(genre)} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${genreLabel(genre)} down`}
                      disabled={index === order.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
