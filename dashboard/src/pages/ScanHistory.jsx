// Scan History — every run's funnel numbers over time (automation/src/
// scan-result.js appends one entry per run, including 0-new-lead runs, to
// data/scan-history.json), so patterns are visible instead of each scan
// being a one-off, forgotten data point. Reached at /scan-history via the
// header's info menu (see components/InfoMenu.jsx).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { config } from '../config';

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}

function summarize(history) {
  if (!history.length) return null;
  const counts = history.map((r) => (r.newLeadsAdded || []).length);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return { avg, min, max, runs: history.length };
}

export default function ScanHistory() {
  const [history, setHistory] = useState(null); // null = loading, [] = loaded-but-empty
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!config.scanHistoryUrl) {
      setHistory([]);
      return;
    }
    fetch(`${config.scanHistoryUrl}?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => setHistory(Array.isArray(json) ? json : []))
      .catch((err) => {
        setHistory([]);
        setError(err.message);
      });
  }, []);

  // Newest first.
  const rows = [...(history || [])].reverse();
  const summary = summarize(history || []);

  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/">
          <span aria-hidden="true">←</span> Back
        </Link>
      </div>

      <article className="guide-article">
        <h1>Scan History</h1>
        <p className="scan-history-intro">
          What every scan actually found — including the ones that came back empty.
        </p>

        {summary && (
          <p className="scan-history-summary">
            Over the last {summary.runs} scan{summary.runs === 1 ? '' : 's'}: {summary.avg.toFixed(1)} new
            lead{summary.avg === 1 ? '' : 's'} on average (range {summary.min}–{summary.max}).
          </p>
        )}

        {history === null && <p className="scan-history-intro">Loading…</p>}

        {history !== null && history.length === 0 && (
          <p className="scan-history-intro">
            {error ? `Couldn't load scan history — ${error}.` : 'No scans recorded yet.'}
          </p>
        )}

        {rows.length > 0 && (
          <ul className="scan-history-list">
            {rows.map((r, i) => {
              const newLeads = r.newLeadsAdded || [];
              return (
                <li key={r.timestamp ?? i} className="scan-history-row">
                  <div className="scan-history-row-top">
                    <span className="scan-history-date">{formatWhen(r.timestamp)}</span>
                    <span
                      className={`scan-history-badge ${newLeads.length > 0 ? 'scan-history-badge-found' : ''}`}
                    >
                      {newLeads.length > 0
                        ? `${newLeads.length} new lead${newLeads.length === 1 ? '' : 's'}`
                        : 'No new leads'}
                    </span>
                  </div>
                  <div className="scan-history-funnel">
                    {r.candidatesProcessed} candidates checked → {r.candidatesWithRelease} had recent activity →{' '}
                    {r.candidatesScored} scored → {newLeads.length} qualified
                  </div>
                  {newLeads.length > 0 && (
                    <div className="scan-history-names">
                      {newLeads.map((l) => (
                        <span key={l.artist} className="scan-history-name-chip">
                          {l.artist} ({l.score})
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="scan-history-total">{r.totalLeadsNow} total leads in feed after this run.</div>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </div>
  );
}
