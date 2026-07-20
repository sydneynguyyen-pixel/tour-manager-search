// Monthly call-budget tracker for the JamBase Data API (jambase-scraper.js).
//
// Unlike Deezer/TheAudioDB (unauthenticated, unthrottled) or Ticketmaster
// (free, rate-limited but not metered), JamBase's free "Developer" tier is
// hard-capped at 1,000 calls/month and overage is billed per call ($0.05).
// A code bug or an unusually large run that blew past the cap would be a
// real, unexpected charge — not just a degraded feature — so usage is
// persisted here and checked BEFORE every call, with a stop threshold well
// under the actual cap to leave buffer for the rest of the billing month.

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const USAGE_PATH = path.join(__dirname, '..', 'data', 'jambase-usage.json');
const MONTHLY_CALL_CAP = 1000;
// Hard-stop here, not at the real cap — leaves buffer for any in-flight
// runs/miscounts rather than risking an overage charge on the last call.
const STOP_AT = 950;

function currentMonthKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function readUsage() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8'));
    if (parsed && typeof parsed.count === 'number' && typeof parsed.month === 'string') return parsed;
  } catch {
    // No file yet, or unreadable — treat as a fresh month.
  }
  return { month: currentMonthKey(), count: 0 };
}

function writeUsage(usage) {
  fs.writeFileSync(USAGE_PATH, `${JSON.stringify(usage, null, 2)}\n`);
}

// True if a call is safe to make right now (and rolls the counter over to a
// fresh month if the persisted one has gone stale). Call this immediately
// before every request — never batch/precompute, since count must reflect
// calls made so far this run too.
function canMakeCall() {
  const month = currentMonthKey();
  let usage = readUsage();
  if (usage.month !== month) {
    usage = { month, count: 0 };
    writeUsage(usage);
  }
  if (usage.count >= STOP_AT) {
    logger.warn(
      `JamBase: monthly usage at ${usage.count}/${MONTHLY_CALL_CAP} (stop threshold ${STOP_AT}) — ` +
        `skipping further calls this month to avoid overage charges.`
    );
    return false;
  }
  return true;
}

// Record one completed call attempt (call regardless of whether the request
// itself succeeded — a 4xx/5xx from JamBase still consumes quota).
function recordCall() {
  const month = currentMonthKey();
  let usage = readUsage();
  if (usage.month !== month) usage = { month, count: 0 };
  usage.count += 1;
  writeUsage(usage);
  return usage.count;
}

module.exports = { canMakeCall, recordCall, MONTHLY_CALL_CAP, STOP_AT, USAGE_PATH };
