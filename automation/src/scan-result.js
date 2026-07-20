// Per-run scan summary for the dashboard — written every run (unlike
// data/history/*.json, which only records empty runs for debugging), so the
// dashboard can show what a scan actually found even when the answer is
// "nothing new." See run.js's call site for the funnel numbers this reads.

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const { LEADS_PATH } = require('./output');

const RESULT_PATH = path.join(__dirname, '..', 'data', 'last-scan-result.json');
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'scan-history.json');
// Weekly cadence plus occasional manual "Scan now" runs — a year or so of
// history without the file growing unbounded.
const HISTORY_LIMIT = 100;

function readTotalLeads(leadsPath) {
  try {
    const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
    return leads.totalLeads ?? (Array.isArray(leads.leads) ? leads.leads.length : 0);
  } catch {
    return 0;
  }
}

// candidatesProcessed/WithRelease/Scored are this run's funnel counts;
// newLeadsAdded is just THIS run's new leads (not the accumulated feed —
// totalLeadsNow covers that).
function writeScanResult({ candidatesProcessed, candidatesWithRelease, candidatesScored, newLeadsAdded }) {
  const result = {
    timestamp: new Date().toISOString(),
    candidatesProcessed,
    candidatesWithRelease,
    candidatesScored,
    newLeadsAdded,
    totalLeadsNow: readTotalLeads(LEADS_PATH),
  };

  fs.writeFileSync(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);

  let history = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    // No prior history file (or unreadable) — start fresh.
  }
  history.push(result);
  if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);
  fs.writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);

  logger.info(
    `Scan result saved: ${newLeadsAdded.length} new lead(s), ${result.totalLeadsNow} total in feed.`
  );
  return result;
}

module.exports = { writeScanResult, RESULT_PATH, HISTORY_PATH };
