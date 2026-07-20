// "Next scan" time + "Scan now" primary CTA, shown in the header. Clicking
// the CTA opens a prep modal explaining what a scan does rather than firing
// immediately; confirming calls the trigger-scan Netlify function (which
// dispatches the weekly-scrape GitHub Actions workflow on demand) and marks
// a scan pending via lib/scanState.js.
//
// The button disables itself while a scan is pending (rather than a fixed
// cooldown) — see ScanPendingBanner.jsx, mounted at the app root, for the
// persistent "in progress" indicator and completion detection that drives
// this same shared state.

import { useEffect, useState } from 'react';
import { getNextScanDate, formatNextScan } from '../lib/nextScan';
import { useScanPending, startScanPending, SCAN_TIMEOUT_MS } from '../lib/scanState';

export default function ScanNow() {
  const pending = useScanPending();
  const [modalOpen, setModalOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  // Ticks while a scan is pending so `inProgress` flips to false once the
  // timeout elapses on its own, without needing a page refresh.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [pending]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !starting) setModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [modalOpen, starting]);

  const elapsed = pending ? Date.now() - new Date(pending.startedAt).getTime() : 0;
  const inProgress = !!pending && elapsed < SCAN_TIMEOUT_MS;
  const nextScan = formatNextScan(getNextScanDate());

  async function handleConfirm() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/.netlify/functions/trigger-scan', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      startScanPending();
      setModalOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  function closeModal() {
    if (starting) return;
    setModalOpen(false);
    setError(null);
  }

  return (
    <div className="scan-now-group">
      <span className="next-scan">Next scan: {nextScan}</span>
      <button
        type="button"
        className="scan-cta"
        onClick={() => setModalOpen(true)}
        disabled={inProgress}
      >
        {inProgress ? 'Scan in progress…' : 'Scan now'}
      </button>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal} role="presentation">
          <div
            className="modal scan-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Start a scan"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={closeModal} aria-label="Close" disabled={starting}>
              ✕
            </button>

            <h3 className="scan-modal-title">Start a new scan?</h3>
            <p className="scan-modal-copy">
              This checks for new artists based on who you&rsquo;ve worked with, and re-checks
              recent activity on artists already in your feed.
            </p>
            <p className="scan-modal-duration">Usually takes a few minutes.</p>

            {error && (
              <p className="scan-modal-error">Couldn&rsquo;t start scan — {error}. Try again.</p>
            )}

            <div className="scan-modal-actions">
              <button type="button" className="pf-btn-ghost" onClick={closeModal} disabled={starting}>
                Cancel
              </button>
              <button type="button" className="scan-cta" onClick={handleConfirm} disabled={starting}>
                {starting ? 'Starting…' : 'Start scan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
