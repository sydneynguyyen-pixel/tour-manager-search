// Persistent scan-status banner, mounted at the app root (see App.jsx) so it
// stays visible no matter which page Matthew is on — not just the Leads tab.
//
// There's no push notification from the GitHub Action back to the dashboard,
// so "done" is inferred one of two ways: the next last-scan-result.json fetch
// carrying a timestamp newer than when the scan started (App.jsx already
// polls every 30s regardless, so this needs no extra fetch of its own), or —
// if that never arrives — a timeout (lib/scanState.js) that downgrades the
// banner to a manual "check now" prompt instead of claiming "in progress"
// forever.
//
// This deliberately watches last-scan-result.json rather than leads.json's
// generatedAt: leads.json is left untouched on a 0-new-lead run (see
// automation/src/output.js writeLeadsJSON), so generatedAt alone would never
// resolve the pending state on that — common — outcome. The scan summary's
// own timestamp updates every run regardless of outcome.
//
// The detailed "what did it find" summary lives in ScanResultModal.jsx — this
// banner only detects completion and hands the finished result up via
// onScanComplete so App.jsx can show that modal.

import { useEffect, useState } from 'react';
import { useScanPending, clearScanPending, SCAN_TIMEOUT_MS } from '../lib/scanState';

export default function ScanPendingBanner({ scanResult, onRefreshNow, onScanComplete }) {
  const pending = useScanPending();

  // Re-render periodically so the in-progress -> timed-out transition happens
  // on its own timeline, without waiting for new scan data to arrive.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [pending]);

  // Completion detection: the scan we kicked off wrote a fresh
  // last-scan-result.json once its timestamp moves past when we started it.
  useEffect(() => {
    if (!pending || !scanResult?.timestamp) return;
    const generated = new Date(scanResult.timestamp).getTime();
    const started = new Date(pending.startedAt).getTime();
    if (!Number.isNaN(generated) && generated > started) {
      clearScanPending();
      onScanComplete?.(scanResult);
    }
  }, [pending, scanResult, onScanComplete]);

  if (!pending) return null;

  const elapsed = Date.now() - new Date(pending.startedAt).getTime();
  const timedOut = elapsed >= SCAN_TIMEOUT_MS;

  if (timedOut) {
    return (
      <div className="scan-banner scan-banner-stale">
        <span>This scan should be done by now — refresh to check for new leads.</span>
        <button type="button" className="scan-banner-action" onClick={onRefreshNow}>
          Refresh now
        </button>
        <button
          type="button"
          className="scan-banner-dismiss"
          onClick={clearScanPending}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="scan-banner scan-banner-active">
      <span className="scan-banner-spinner" aria-hidden="true" />
      <span>Scan in progress — usually takes a few minutes. New leads will appear automatically.</span>
    </div>
  );
}
