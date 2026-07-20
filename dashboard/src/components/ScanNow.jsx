// "Next scan" time + manual "Scan now" trigger, shown in the header next to
// "Last updated". Scan now calls the trigger-scan Netlify function, which
// dispatches the weekly-scrape GitHub Actions workflow on demand.
//
// Double-trigger protection is client-side only (button disabled for a
// cooldown after a click) — this is a two-person tool, so no server-side
// rate limiting. The cooldown deadline is persisted to localStorage so a
// page refresh during the cooldown doesn't re-enable the button.

import { useEffect, useState } from 'react';
import { getNextScanDate, formatNextScan } from '../lib/nextScan';

const COOLDOWN_MS = 5 * 60 * 1000;
const COOLDOWN_KEY = 'scanNowCooldownUntil';

function readCooldownUntil() {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    const ts = raw ? Number(raw) : 0;
    return ts > Date.now() ? ts : 0;
  } catch {
    return 0;
  }
}

function writeCooldownUntil(ts) {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(ts));
  } catch {
    // Storage unavailable — cooldown just won't survive a refresh.
  }
}

export default function ScanNow() {
  const [cooldownUntil, setCooldownUntil] = useState(readCooldownUntil);
  const [status, setStatus] = useState(null); // null | 'starting' | 'started' | 'error'
  const disabled = status === 'starting' || cooldownUntil > Date.now();

  // Tick every second while on cooldown so the button re-enables itself
  // without needing a page refresh.
  useEffect(() => {
    if (!cooldownUntil) return undefined;
    const id = setInterval(() => {
      if (cooldownUntil <= Date.now()) setCooldownUntil(0);
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const nextScan = formatNextScan(getNextScanDate());

  async function handleScanNow() {
    setStatus('starting');
    try {
      const res = await fetch('/.netlify/functions/trigger-scan', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setStatus('started');
      const until = Date.now() + COOLDOWN_MS;
      setCooldownUntil(until);
      writeCooldownUntil(until);
    } catch (err) {
      setStatus('error');
      console.error('Scan now failed:', err.message);
    }
  }

  return (
    <div className="scan-now">
      <span className="next-scan">Next scan: {nextScan}</span>
      <button type="button" className="legend-btn" onClick={handleScanNow} disabled={disabled}>
        {status === 'starting' ? 'Starting…' : 'Scan now'}
      </button>
      {status === 'started' && (
        <span className="scan-status scan-status-ok">Scan started — new leads will appear in a few minutes.</span>
      )}
      {status === 'error' && <span className="scan-status scan-status-error">Couldn't start scan — try again.</span>}
    </div>
  );
}
