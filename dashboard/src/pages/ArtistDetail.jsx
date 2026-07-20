// Full-page artist detail. Reached at /artist/:id (id = leadId(lead), encoded)
// for a scored lead, or /my-artists/:id (id = the entry's own localStorage id)
// for a My Artists entry — see App.jsx. Same component either way; the latter
// passes `source="myArtists"` and `hideScore`.
//
// Layout: a full-width hero (large image, name, priority + score, genre &
// listener pills, a roomy bio, a compact contact row, and a key-stats strip)
// followed by in-page tabs:
//   - Overview        — score breakdown + base→final math + "Explain this score"
//                       (omitted entirely when hideScore — My Artists entries
//                       are never scored)
//   - Tour History    — the full show list as a table (natural page scroll)
//   - Releases & Links — all releases (large art), biggest venues, contact/links
//   - My Notes        — (hideScore only) Matthew's own logged fields for this
//                       artist — role, scope, dates/venues worked, contact,
//                       notes — with a link back to the My Artists edit modal
//                       (that form only exists in components/MyArtists.jsx, so
//                       this navigates there with the entry id in router state
//                       rather than duplicating the form here).
//
// Tabs are local useState (they don't need their own URLs). Scoring logic and
// wording are reused from utils/scoreExplanations.js — relocated, not rebuilt.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { scoreColor, mgmtLabel, longDate, shortDate, venueCap, compactNumber } from '../lib/format';
import { getGenreColor } from '../utils/genreColors';
import { getScoreBreakdown, getPriorityTier, getContributingSources } from '../utils/scoreExplanations';
import { getArtistBio } from '../utils/artistSubtitle';
import { leadId, useSavedArtists } from '../lib/savedArtists';
import { loadEntries, toLeadShape } from '../lib/myArtists';
import { roleLabel, genreDisplay, dateRange, venueRange } from '../utils/myArtistFields';
import { genreLabel } from '../lib/scoringSettings';
import {
  GlobeIcon,
  InstagramIcon,
  TwitterIcon,
  TikTokIcon,
  DiscIcon,
  CalendarIcon,
  VenueIcon,
  BuzzIcon,
} from '../components/Icons';
import BookmarkButton from '../components/BookmarkButton';
import DismissButton from '../components/DismissButton';

const LEAD_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'tours', label: 'Tour History' },
  { key: 'releases', label: 'Releases & Links' },
];

// hideScore mode: no Overview (nothing to score), plus a 4th "My Notes" tab
// for the fields Leads don't have.
const MY_ARTIST_TABS = [
  { key: 'tours', label: 'Tour History' },
  { key: 'releases', label: 'Releases & Links' },
  { key: 'notes', label: 'My Notes' },
];

const BackLink = ({ toMyArtists = false }) => (
  <Link className="detail-back" to="/">
    <span aria-hidden="true">←</span> Back to {toMyArtists ? 'My Artists' : 'leads'}
  </Link>
);

function Shell({ children, toMyArtists = false }) {
  return (
    <div className="detail-page">
      <div className="detail-topbar">
        <BackLink toMyArtists={toMyArtists} />
      </div>
      {children}
    </div>
  );
}

export default function ArtistDetail({ leads, source, hideScore = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const saved = useSavedArtists();
  const isMyArtist = source === 'myArtists';
  const TABS = isMyArtist ? MY_ARTIST_TABS : LEAD_TABS;
  const [tab, setTab] = useState(isMyArtist ? 'tours' : 'overview');
  const [explainOpen, setExplainOpen] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  // A manually-pasted or stale enrichment URL can 404 — fall back to the gray
  // placeholder rather than a broken-image icon.
  const [heroImgError, setHeroImgError] = useState(false);

  // My Artists entries live in localStorage, not the `leads` prop. Keep the
  // raw entry around separately from the lead-shaped adapter below — some of
  // its fields (`.genre`, the form-owned tiered key) mean something different
  // from the adapted lead's `.genre` (the enrichment pipeline's display genre;
  // see toLeadShape), so the My Notes tab reads the raw entry, not `lead`.
  const rawEntry = useMemo(() => {
    if (!isMyArtist) return null;
    const wanted = decodeURIComponent(id);
    return loadEntries().find((e) => e.id === wanted) || null;
  }, [id, isMyArtist]);

  // Look the lead up by id from the loaded leads first, then fall back to the
  // saved store (so a bookmarked artist opens even if it dropped off the list).
  const lead = useMemo(() => {
    if (isMyArtist) return rawEntry ? toLeadShape(rawEntry) : null;
    const wanted = decodeURIComponent(id);
    return (
      (leads || []).find((l) => leadId(l) === wanted) ||
      saved.find((s) => s.id === wanted)?.lead ||
      null
    );
  }, [id, leads, saved, isMyArtist, rawEntry]);

  // New page each time: back to the top, first tab, collapsed explainer.
  useEffect(() => {
    window.scrollTo(0, 0);
    setTab(isMyArtist ? 'tours' : 'overview');
    setExplainOpen(false);
    setShowFullHistory(false);
    setHeroImgError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!lead && !isMyArtist && (!leads || leads.length === 0)) {
    return (
      <Shell>
        <div className="detail-empty">Loading…</div>
      </Shell>
    );
  }
  if (!lead) {
    return (
      <Shell toMyArtists={isMyArtist}>
        <div className="detail-empty">
          {isMyArtist
            ? 'This artist is no longer in your My Artists list.'
            : 'That artist is no longer in the current leads.'}
        </div>
      </Shell>
    );
  }

  const s = lead.scoring || {};
  const base = s.baseScore ?? lead.baseScore;
  const mult = s.genreMultiplier ?? lead.genreMultiplier ?? 1;
  const final = s.finalScore ?? lead.finalScore;
  const confidence = lead.contactConfidence ?? lead.confidence ?? 'low';
  const genreColor = getGenreColor(lead.genre);
  const tier = hideScore ? null : getPriorityTier(final);
  const breakdown = hideScore ? [] : getScoreBreakdown(lead);
  const dataSources = hideScore ? [] : getContributingSources(lead);
  const listenerCount = lead.lastfmListeners ?? lead.listeners;

  const releases = Array.isArray(lead.recentReleases) ? lead.recentReleases : [];
  const newsArticles = Array.isArray(lead.newsArticles) ? lead.newsArticles : [];
  const windowShows = Array.isArray(lead.tourHistory) ? lead.tourHistory : [];
  const fullShows = Array.isArray(lead.fullTourHistory) ? lead.fullTourHistory : [];
  const shows = showFullHistory ? fullShows : windowShows;
  const venues = Array.isArray(lead.topVenues) ? lead.topVenues : [];
  const social = lead.socialLinks || {};
  const links = [
    lead.websiteUrl && { key: 'web', label: 'Website', href: lead.websiteUrl, Icon: GlobeIcon },
    social.instagram && { key: 'ig', label: 'Instagram', href: social.instagram, Icon: InstagramIcon },
    social.twitter && { key: 'tw', label: 'Twitter / X', href: social.twitter, Icon: TwitterIcon },
    social.tiktok && { key: 'tt', label: 'TikTok', href: social.tiktok, Icon: TikTokIcon },
  ].filter(Boolean);

  return (
    <div className="detail-page">
      <div className="detail-topbar">
        <BackLink toMyArtists={isMyArtist} />
        {!hideScore && (
          <div className="detail-topbar-actions">
            <DismissButton lead={lead} className="on-detail" />
            <BookmarkButton lead={lead} className="on-detail" />
          </div>
        )}
      </div>

      {/* ---- HERO ---- */}
      <section className="detail-hero">
        <div className="detail-hero-top">
          <div className="detail-hero-img">
            {lead.imageUrl && !heroImgError ? (
              <img src={lead.imageUrl} alt={lead.artist} onError={() => setHeroImgError(true)} />
            ) : (
              <span className="detail-hero-img-fallback" aria-hidden="true" />
            )}
          </div>

          <div className="detail-hero-body">
            <div className="detail-hero-head">
              <h1 className="detail-hero-name">{lead.artist}</h1>
              {!hideScore && (
                <div className="detail-hero-score">
                  <div className={`detail-score-badge ${scoreColor(final)}`}>{final}</div>
                  <span className={`meta-tier ${tier.tone}`}>{tier.label}</span>
                </div>
              )}
            </div>

            <div className="detail-hero-meta">
              <span className="pill genre" style={{ background: genreColor.background, color: genreColor.text }}>
                {lead.genre || 'Unknown'}
              </span>
              {listenerCount != null && (
                <span className="pill listeners">{compactNumber(listenerCount)} monthly listeners</span>
              )}
            </div>

            <p className="detail-hero-bio">{getArtistBio(lead)}</p>

            <div className="detail-hero-contact">
              <span className="detail-hero-mgmt">
                <span className="k">Management</span>
                <span className="v">{mgmtLabel(lead.managementType)}</span>
              </span>
              <span className="detail-hero-mgmt">
                <span className="k">Email</span>
                <span className={`v ${lead.contactEmail ? '' : 'muted'}`}>
                  {lead.contactEmail ? (
                    <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a>
                  ) : (
                    'Not found'
                  )}
                </span>
              </span>
              <span className="detail-hero-mgmt">
                <span className="k">Confidence</span>
                <span
                  className="v"
                  style={{ textTransform: 'capitalize' }}
                  title="How reliable this contact info is, based on where it was found."
                >
                  {confidence}
                </span>
              </span>
              {links.length > 0 && (
                <div className="detail-hero-links">
                  {links.map(({ key, label, href, Icon }) => (
                    <a
                      key={key}
                      className="detail-icon-link"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      title={label}
                    >
                      <Icon size={18} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="detail-stats">
          <Stat k="Last Tour" v={shortDate(lead.lastTourDate)} />
          <Stat k="Tours" v={lead.tourCount ?? 0} />
          <Stat k="Avg. Venue Cap" v={venueCap(lead.avgVenueSize)} />
          <Stat k="Countries" v={lead.countriesToured ?? 0} />
        </div>
      </section>

      {/* ---- TABS ---- */}
      <div className="detail-tabs" role="tablist" aria-label="Artist detail sections">
        {TABS.map((t) => {
          const count = t.key === 'tours' ? windowShows.length : null;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`detail-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {count != null && count > 0 && <span className="detail-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ---- PANELS ---- */}
      {tab === 'overview' && (
        <div className="detail-panel">
          <section className="detail-block">
            <BlockHead Icon={null} title="Score breakdown" />
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

          <section className="detail-block">
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
                  <ul className="detail-reasoning">
                    {(lead.fitReasoning || []).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <div className="why-meta">
                    <div className="contact-item">
                      <div className="k">Data sources</div>
                      <div className="v">
                        {dataSources.length > 0 ? dataSources.join(', ') : 'None identified'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'tours' && (
        <div className="detail-panel">
          {venues.length > 0 && (
            <section className="detail-block">
              <BlockHead Icon={VenueIcon} title="Biggest venues played" />
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

          <section className="detail-block">
            <BlockHead
              Icon={CalendarIcon}
              title={showFullHistory ? 'Tour history (all-time)' : 'Tour history (last 18 months)'}
              count={shows.length > 0 ? `${shows.length} show${shows.length === 1 ? '' : 's'}` : null}
            />
            {fullShows.length > windowShows.length && (
              <button
                type="button"
                className="explain-toggle"
                onClick={() => setShowFullHistory((v) => !v)}
              >
                <span className={`explain-chevron ${showFullHistory ? 'open' : ''}`} aria-hidden="true">
                  ▸
                </span>
                {showFullHistory
                  ? 'Show last 18 months only (used for scoring)'
                  : `Show full history (all-time — ${fullShows.length} shows)`}
              </button>
            )}
            {shows.length > 0 ? (
              <div className="detail-table">
                <div className="detail-table-head" aria-hidden="true">
                  <span>Date</span>
                  <span>Venue</span>
                  <span>Location</span>
                </div>
                <ul className="detail-table-body">
                  {shows.map((sh, i) => (
                    <li className="detail-table-row" key={`${sh.date}-${sh.venueName}-${i}`}>
                      <span className="dt-date">{longDate(sh.date)}</span>
                      <span className="dt-venue">{sh.venueName || 'Unknown venue'}</span>
                      <span className="dt-loc">{[sh.city, sh.country].filter(Boolean).join(', ') || '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="detail-empty-inline">
                {showFullHistory ? 'No tour history on record.' : 'No tour history in the last 18 months.'}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'releases' && (
        <div className="detail-panel">
          <section className="detail-block">
            <BlockHead Icon={DiscIcon} title="Recent releases" count={releases.length || null} />
            {releases.length > 0 ? (
              <div className="release-grid">
                {releases.map((r, i) => (
                  <div className="release-tile" key={`${r.name}-${i}`}>
                    <span className="release-tile-art">
                      {r.imageUrl ? (
                        <img src={r.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="release-tile-art-fallback" aria-hidden="true" />
                      )}
                    </span>
                    <span className="release-tile-name" title={r.name}>{r.name}</span>
                    {r.releaseDate && <span className="release-tile-date">{longDate(r.releaseDate)}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="detail-empty-inline">No recent releases found.</div>
            )}
          </section>

          {newsArticles.length > 0 && (
            <section className="detail-block">
              <BlockHead Icon={BuzzIcon} title="Recent buzz" count={newsArticles.length} />
              <ul className="buzz-list">
                {newsArticles.map((a, i) => (
                  <li className="buzz-row" key={`${a.url}-${i}`}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="buzz-row-title">
                      {a.title}
                    </a>
                    {a.publishedDate && (
                      <span className="buzz-row-date">{longDate(a.publishedDate.slice(0, 10))}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="detail-block">
            <BlockHead Icon={GlobeIcon} title="Links" />
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
          </section>
        </div>
      )}

      {tab === 'notes' && hideScore && rawEntry && (
        <div className="detail-panel">
          <section className="detail-block">
            <BlockHead Icon={null} title="My Artists details" />
            <div className="contact-grid">
              <div className="contact-item">
                <div className="k">Status</div>
                <div className="v">
                  {rawEntry.imported ? 'Imported from initial seed list' : 'Added manually'}
                </div>
              </div>
              <div className="contact-item">
                <div className="k">Role</div>
                <div className={`v ${roleLabel(rawEntry) ? '' : 'muted'}`}>
                  {roleLabel(rawEntry) || 'Role not set'}
                </div>
              </div>
              {rawEntry.relationshipType && (
                <div className="contact-item">
                  <div className="k">Relationship</div>
                  <div className="v">{rawEntry.relationshipType}</div>
                </div>
              )}
              <div className="contact-item">
                <div className="k">Logged genre</div>
                <div className={`v ${genreDisplay(rawEntry, genreLabel) ? '' : 'muted'}`}>
                  {genreDisplay(rawEntry, genreLabel) || 'Not set'}
                </div>
              </div>
              <div className="contact-item">
                <div className="k">Scope</div>
                <div className={`v ${rawEntry.scope ? '' : 'muted'}`}>{rawEntry.scope || 'Not set'}</div>
              </div>
              <div className="contact-item">
                <div className="k">Dates worked</div>
                <div className={`v ${dateRange(rawEntry) ? '' : 'muted'}`}>
                  {dateRange(rawEntry) || 'Not set'}
                </div>
              </div>
              <div className="contact-item">
                <div className="k">Venue range worked</div>
                <div className={`v ${venueRange(rawEntry) ? '' : 'muted'}`}>
                  {venueRange(rawEntry) || 'Not set'}
                </div>
              </div>
              <div className="contact-item">
                <div className="k">Contact name</div>
                <div className={`v ${rawEntry.contactName ? '' : 'muted'}`}>
                  {rawEntry.contactName || 'Not set'}
                </div>
              </div>
              <div className="contact-item">
                <div className="k">Contact email</div>
                <div className={`v ${rawEntry.contactEmail ? '' : 'muted'}`}>
                  {rawEntry.contactEmail ? (
                    <a href={`mailto:${rawEntry.contactEmail}`}>{rawEntry.contactEmail}</a>
                  ) : (
                    'Not set'
                  )}
                </div>
              </div>
            </div>

            {rawEntry.notes && <p className="pc-notes">{rawEntry.notes}</p>}

            <button
              type="button"
              className="pf-btn-ghost detail-edit-my-artist"
              onClick={() => navigate('/', { state: { editArtistId: rawEntry.id } })}
            >
              Edit in My Artists
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div className="detail-stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

function BlockHead({ Icon, title, count = null }) {
  return (
    <div className="detail-block-head">
      {Icon && (
        <span className="detail-block-icon">
          <Icon />
        </span>
      )}
      <h3>{title}</h3>
      {count != null && <span className="detail-block-count">{count}</span>}
    </div>
  );
}
