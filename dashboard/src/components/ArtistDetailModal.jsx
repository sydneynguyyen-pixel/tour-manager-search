// Shadowbox modal with the full lead detail. Closes on the X button, a click on
// the backdrop, or the Escape key.
//
// Layout: LEFT column = everything about the artist (header, contact, releases,
// venues). RIGHT column = everything about the score (breakdown + a collapsible
// "Explain this score" holding the reasoning bullets + source/confidence).

import { useEffect, useState } from 'react';
import { scoreColor, mgmtLabel, longDate, compactNumber } from '../lib/format';
import { getGenreColor } from '../utils/genreColors';
import { getScoreBreakdown, getPriorityTier } from '../utils/scoreExplanations';
import { GlobeIcon, InstagramIcon, TwitterIcon, TikTokIcon } from './Icons';
import BookmarkButton from './BookmarkButton';

export default function ArtistDetailModal({ lead, onClose }) {
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Prevent the page behind the modal from scrolling.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!lead) return null;

  const s = lead.scoring || {};
  const base = s.baseScore ?? lead.baseScore;
  const mult = s.genreMultiplier ?? lead.genreMultiplier ?? 1;
  const final = s.finalScore ?? lead.finalScore;
  const confidence = lead.contactConfidence ?? lead.confidence ?? 'low';
  const genreColor = getGenreColor(lead.genre);
  const tier = getPriorityTier(final);
  const breakdown = getScoreBreakdown(lead);

  const releases = Array.isArray(lead.recentReleases) ? lead.recentReleases.slice(0, 5) : [];
  const shows = Array.isArray(lead.tourHistory) ? lead.tourHistory : [];
  const venues = Array.isArray(lead.topVenues) ? lead.topVenues.slice(0, 3) : [];
  const social = lead.socialLinks || {};
  const links = [
    lead.websiteUrl && { key: 'web', label: 'Website', href: lead.websiteUrl, Icon: GlobeIcon },
    social.instagram && { key: 'ig', label: 'Instagram', href: social.instagram, Icon: InstagramIcon },
    social.twitter && { key: 'tw', label: 'Twitter / X', href: social.twitter, Icon: TwitterIcon },
    social.tiktok && { key: 'tt', label: 'TikTok', href: social.tiktok, Icon: TikTokIcon },
  ].filter(Boolean);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${lead.artist} details`}
        onClick={(e) => e.stopPropagation()}
      >
        <BookmarkButton lead={lead} className="in-modal" />
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="modal-cols">
          {/* LEFT — everything about the artist */}
          <div className="modal-left">
            <div className="modal-head">
              <div className="modal-portrait">
                {lead.imageUrl ? (
                  <img src={lead.imageUrl} alt={lead.artist} />
                ) : (
                  <span className="modal-portrait-fallback" aria-hidden="true" />
                )}
              </div>
              <div className="titles">
                <h3 className="modal-title">{lead.artist}</h3>
                <div className="modal-meta">
                  <span className="pill genre" style={{ background: genreColor.background, color: genreColor.text }}>
                    {lead.genre || 'Unknown'}
                  </span>
                  {lead.listeners != null && (
                    <span className="pill listeners">{compactNumber(lead.listeners)} monthly listeners</span>
                  )}
                  <span className={`meta-tier ${tier.tone}`}>{tier.label}</span>
                </div>
                {lead.releaseName && <div className="modal-sub">Latest: {lead.releaseName}</div>}
              </div>
              <div
                className={`modal-score score-badge ${scoreColor(final)}`}
                style={{ position: 'static', border: 'none', boxShadow: 'none' }}
              >
                {final}
              </div>
            </div>

            <section className="modal-section">
              <h4>Contact</h4>
              <div className="contact-stack">
                <div className="contact-item">
                  <div className="k">Management</div>
                  <div className="v">
                    <span className="mgmt-type">{mgmtLabel(lead.managementType)}</span>
                  </div>
                </div>
                <div className="contact-item">
                  <div className="k">Email</div>
                  <div className={`v ${lead.contactEmail ? '' : 'muted'}`}>
                    {lead.contactEmail ? (
                      <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a>
                    ) : (
                      'Not found'
                    )}
                  </div>
                </div>
                <div className="contact-item">
                  <div className="k">Links</div>
                  {links.length > 0 ? (
                    <div className="links-row">
                      {links.map(({ key, label, href, Icon }) => (
                        <a
                          key={key}
                          className="link-chip"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={label}
                          title={label}
                        >
                          <Icon />
                          <span>{label}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="v muted">No public links found</div>
                  )}
                </div>
              </div>
            </section>

            <section className="modal-section">
              <h4>Recent releases</h4>
              {releases.length > 0 ? (
                <div className="release-strip">
                  {releases.map((r, i) => {
                    const tip = [r.name, longDate(r.releaseDate)].filter(Boolean).join(' · ');
                    return (
                      <span className="release-thumb" key={`${r.name}-${i}`} title={tip} aria-label={tip}>
                        {r.imageUrl ? (
                          <img src={r.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="release-thumb-fallback" aria-hidden="true" />
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="modal-empty">No recent releases found.</div>
              )}
            </section>

            {shows.length > 0 && (
              <section className="modal-section">
                <h4>
                  Tour history <span className="section-count">{shows.length} shows</span>
                </h4>
                <div className="tour-history-scroll">
                  <ul className="tour-history-list">
                    {shows.map((sh, i) => (
                      <li className="tour-row" key={`${sh.date}-${sh.venueName}-${i}`}>
                        <span className="tour-row-date">{longDate(sh.date)}</span>
                        <span className="tour-row-info">
                          <span className="tour-row-venue">{sh.venueName || 'Unknown venue'}</span>
                          {(sh.city || sh.country) && (
                            <span className="tour-row-loc">
                              {[sh.city, sh.country].filter(Boolean).join(', ')}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {venues.length > 0 && (
              <section className="modal-section">
                <h4>Biggest venues played</h4>
                <ul className="venue-list">
                  {venues.map((v, i) => (
                    <li className="venue-row" key={`${v.name}-${i}`}>
                      <span className="venue-row-cap">
                        {v.capacity != null ? v.capacity.toLocaleString() : '—'}
                      </span>
                      <span className="venue-row-info">
                        <span className="venue-row-name">{v.name}</span>
                        {(v.city || v.country) && (
                          <span className="venue-row-loc">{[v.city, v.country].filter(Boolean).join(', ')}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* RIGHT — everything about the score */}
          <div className="modal-right">
            <section className="modal-section">
              <h4>Score breakdown</h4>
              <div className="score-breakdown">
                {breakdown.map((d) => (
                  <div className="sb-row" key={d.key}>
                    <div className="sb-head">
                      <span className="sb-label">{d.label}</span>
                      <span className="sb-points">
                        {d.points}
                        <span className="sb-max"> / {d.max}</span>
                      </span>
                    </div>
                    <div className="sb-bar">
                      <div className={`sb-fill ${d.tone}`} style={{ width: `${d.pct}%` }} />
                    </div>
                    <div className="sb-why">{d.explanation}</div>
                  </div>
                ))}
              </div>
              <div className="sb-math">
                Base score <strong>{base}</strong>/100 → Genre fit ({lead.genre || 'unknown'},{' '}
                <span className="mult">×{mult}</span>) → <strong>{final} final score</strong>
              </div>
            </section>

            <div className="explain">
              <button
                className="explain-toggle"
                onClick={() => setExplainOpen((o) => !o)}
                aria-expanded={explainOpen}
              >
                <span className={`explain-chevron ${explainOpen ? 'open' : ''}`} aria-hidden="true">
                  ▸
                </span>
                Explain this score
              </button>
              {explainOpen && (
                <div className="explain-body">
                  <ul className="modal-reasoning">
                    {(lead.fitReasoning || []).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <div className="why-meta">
                    <div className="contact-item">
                      <div className="k">Source</div>
                      <div className="v">{lead.contactSource || 'none'}</div>
                    </div>
                    <div className="contact-item">
                      <div className="k">Confidence</div>
                      <div className="v" style={{ textTransform: 'capitalize' }}>{confidence}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
