// Shared formatting helpers for lead display.

// Compact number: 8_200_000 -> "8.2M", 780_000 -> "780K".
export function compactNumber(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trimZero(n / 1_000)}K`;
  return String(n);
}
function trimZero(x) {
  return x.toFixed(x % 1 === 0 ? 0 : 1).replace(/\.0$/, '');
}

// Short numeric date: "2026-05-28" -> "5/28/26" (matches the mockup style).
export function shortDate(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${Number(mo)}/${Number(d)}/${y.slice(2)}`;
}

// Venue capacity with thousands separators.
export function venueCap(n) {
  if (!n) return '—';
  return n.toLocaleString();
}

// Longer, human date for release lists: "2026-06-19" -> "Jun 19, 2026".
export function longDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Score badge color bucket. >=85 green, 70-84 amber, <70 red.
export function scoreColor(score) {
  if (score >= 85) return 'green';
  if (score >= 70) return 'amber';
  return 'red';
}

const MGMT_LABELS = {
  'self-managed': 'Self-managed',
  'indie-label': 'Indie label',
  'indie-booking': 'Indie booking',
  'booking-agency': 'Booking agency',
  'major-agency': 'Major agency',
  'major-label': 'Major label',
  unknown: 'Unknown',
};
export function mgmtLabel(type) {
  return MGMT_LABELS[type] || type || 'Unknown';
}
