// Detailed "what did the scan actually find" summary, shown once when a
// scan Matthew started (ScanPendingBanner detects completion via
// last-scan-result.json's timestamp, which — unlike leads.json's
// generatedAt — updates even on a 0-new-lead run) finishes. Covers both
// outcomes honestly: a list of new leads, or a plain explanation of why
// nothing new qualified this time. See pages/ScanHistory.jsx for the
// longer-run view of this same data.

import { Link } from 'react-router-dom';
import { scoreColor } from '../lib/format';

export default function ScanResultModal({ result, onClose }) {
  if (!result) return null;

  const newLeads = result.newLeadsAdded || [];
  const found = newLeads.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal scan-modal scan-result-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Scan results"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        {found ? (
          <>
            <h3 className="scan-modal-title">
              Scan complete — found {newLeads.length} new lead{newLeads.length === 1 ? '' : 's'}
            </h3>
            <ul className="scan-result-lead-list">
              {newLeads.map((l) => (
                <li key={l.artist} className="scan-result-lead-row">
                  <span className="scan-result-lead-name">{l.artist}</span>
                  <span className={`scan-result-score ${scoreColor(l.score)}`}>{l.score}</span>
                </li>
              ))}
            </ul>
            <Link to="/" className="scan-cta scan-result-view-link" onClick={onClose}>
              View in Leads
            </Link>
          </>
        ) : (
          <>
            <h3 className="scan-modal-title">Scan complete — no new leads this time</h3>
            <p className="scan-modal-copy">
              Checked {result.candidatesProcessed} candidate{result.candidatesProcessed === 1 ? '' : 's'},{' '}
              {result.candidatesWithRelease} had recent activity, but none scored high enough yet.
            </p>
          </>
        )}

        <p className="scan-result-footer">{result.totalLeadsNow} total leads in your feed.</p>
      </div>
    </div>
  );
}
