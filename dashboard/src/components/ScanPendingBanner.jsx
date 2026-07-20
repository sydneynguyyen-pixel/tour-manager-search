// Persistent scan-status banner, mounted at the app root (see App.jsx) so it
// stays visible no matter which page Matthew is on — not just the Leads tab.
//
// There's no push notification from the GitHub Action back to the dashboard,
// so "done" is inferred one of two ways: the next leads.json fetch carrying a
// generatedAt newer than when the scan started (App.jsx already polls every
// 30s regardless, so this needs no extra fetch of its own), or — if that
// never arrives — a timeout (lib/scanState.js) that downgrades the banner to
// a manual "check now" prompt instead of claiming "in progress" forever.

import { useEffect, useState } from 'react';
import { useScanPending, clearScanPending, SCAN_TIMEOUT_MS } from '../lib/scanState';

const SUCCESS_DISMISS_MS = 8000;

export default function ScanPendingBanner({ generatedAt, onRefreshNow }) {
  const pending = useScanPending();
  const [justCompleted, setJustCompleted] = useState(false);

  // Re-render periodically so the in-progress -> timed-out transition happens
  // on its own timeline, without waiting for new leads data to arrive.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [pending]);

  // Completion detection: the scan we kicked off regenerated leads.json once
  // its generatedAt timestamp moves past when we started it. App.jsx's
  // existing 30s background poll is what feeds `generatedAt` fresh values —
  // no separate fetch needed here.
  useEffect(() => {
    if (!pending || !generatedAt) return;
    const generated = new Date(generatedAt).getTime();
    const started = new Date(pending.startedAt).getTime();
    if (!Number.isNaN(generated) && generated > started) {
      clearScanPending();
      setJustCompleted(true);
    }
  }, [pending, generatedAt]);

  useEffect(() => {
    if (!justCompleted) return undefined;
    const id = setTimeout(() => setJustCompleted(false), SUCCESS_DISMISS_MS);
    return () => clearTimeout(id);
  }, [justCompleted]);

  if (justCompleted) {
    return (
      <div className="scan-banner scan-banner-ok">
        <span>Scan complete — new leads are in your feed.</span>
        <button
          type="button"
          className="scan-banner-dismiss"
          onClick={() => setJustCompleted(false)}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }

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
