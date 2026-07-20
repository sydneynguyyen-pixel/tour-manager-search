// "This week" panel beside the hero welcome card. It surfaces, in one place:
//   - how many leads are new this week + how many are "immediate" priority
//   - the single highest-scoring lead overall ("Top lead")
//   - the single highest-scoring artist first seen in this run ("Top new")
//
// "new this week" keys off firstSeen within the last 7 days (wall clock).
// "Top new" keys off firstSeen within 24h of the run's generatedAt, so it means
// "newest as of this scrape" and is deterministic for a given leads.json.
// Each mini-card opens the artist's detail modal.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { scoreColor } from '../lib/format';
import { leadRoute } from '../lib/savedArtists';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function isNewThisWeek(lead, now) {
  const ts = lead.firstSeen ? new Date(lead.firstSeen).getTime() : NaN;
  if (Number.isNaN(ts)) return false;
  return now - ts <= WEEK_MS && ts <= now;
}

function isNewThisRun(lead, ref) {
  const ts = lead.firstSeen ? new Date(lead.firstSeen).getTime() : NaN;
  if (Number.isNaN(ts) || Number.isNaN(ref)) return false;
  return ts <= ref && ref - ts <= DAY_MS;
}

export default function WeeklyHighlight({ leads, generatedAt }) {
  // Mini-cards are collapsed by default on mobile (see .weekly-toggle /
  // .weekly-cards CSS) — this only controls that collapsed state; desktop
  // always shows the cards regardless via CSS.
  const [expanded, setExpanded] = useState(false);
  const { newCount, immediateCount, topLead, topNew } = useMemo(() => {
    const now = Date.now();
    const ref = generatedAt ? new Date(generatedAt).getTime() : NaN;
    let newCount = 0;
    let immediateCount = 0;
    let topLead = null;
    let topNew = null;
    for (const lead of leads) {
      if (isNewThisWeek(lead, now)) newCount += 1;
      if (lead.priority === 'immediate') immediateCount += 1;
      if (!topLead || (lead.finalScore ?? 0) > (topLead.finalScore ?? 0)) topLead = lead;
      if (isNewThisRun(lead, ref) && (!topNew || (lead.finalScore ?? 0) > (topNew.finalScore ?? 0))) {
        topNew = lead;
      }
    }
    return { newCount, immediateCount, topLead, topNew };
  }, [leads, generatedAt]);

  return (
    <div className="weekly-panel">
      <div className="weekly-head">This week</div>

      {newCount > 0 ? (
        <div className="weekly-stat">
          <strong>{newCount}</strong> new {newCount === 1 ? 'lead' : 'leads'}
          <span className="weekly-dot" aria-hidden="true" />
          <strong>{immediateCount}</strong> Strong Match
        </div>
      ) : (
        <div className="weekly-stat weekly-stat-empty">
          No new leads this week — check back soon
        </div>
      )}

      {(topLead || topNew) && (
        <button
          type="button"
          className="weekly-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide top picks ▲' : 'Show top picks ▾'}
        </button>
      )}

      <div className={`weekly-cards ${expanded ? 'is-expanded' : ''}`}>
        {topLead && <MiniCard label="Top lead" lead={topLead} />}
        {topNew ? (
          <MiniCard label="Top new" lead={topNew} />
        ) : (
          <div className="weekly-card weekly-card-empty">
            <div className="weekly-card-body">
              <div className="weekly-card-label">Top new</div>
              <div className="weekly-card-empty-text">No new artists scraped this run</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniCard({ label, lead }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="weekly-card"
      onClick={() => navigate(leadRoute(lead))}
      aria-label={`View ${lead.artist}`}
    >
      <div className="weekly-thumb">
        {lead.imageUrl ? (
          <img src={lead.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="weekly-thumb-fallback" aria-hidden="true" />
        )}
      </div>
      <div className="weekly-card-body">
        <div className="weekly-card-label">{label}</div>
        <div className="weekly-card-name">{lead.artist}</div>
      </div>
      <span className={`weekly-score ${scoreColor(lead.finalScore)}`}>{lead.finalScore}</span>
      <span className="weekly-view">View</span>
    </button>
  );
}
