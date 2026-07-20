// Computes the next weekly-scrape run time client-side from the known cron
// schedule in .github/workflows/weekly-scrape.yml ('0 6 * * 1' — Monday
// 06:00 UTC). Kept here instead of fetched from GitHub so it renders
// instantly with no extra request; if the cron schedule in the workflow file
// ever changes, update CRON_UTC_HOUR/CRON_UTC_WEEKDAY to match.

const CRON_UTC_HOUR = 6;
const CRON_UTC_WEEKDAY = 1; // 0 = Sunday, 1 = Monday, per Date#getUTCDay()

export function getNextScanDate(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(CRON_UTC_HOUR, 0, 0, 0);

  const day = next.getUTCDay();
  let daysUntil = (CRON_UTC_WEEKDAY - day + 7) % 7;
  if (daysUntil === 0 && next <= now) daysUntil = 7; // today is run day but past the run time already
  next.setUTCDate(next.getUTCDate() + daysUntil);

  return next;
}

export function formatNextScan(date) {
  const dateStr = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} at ${timeStr}`;
}
