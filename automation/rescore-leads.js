// One-off: recompute scoring on the EXISTING leads.json in place, without
// re-running the full pipeline (no re-scraping). Use this after a score.js
// rule change (e.g. the comeback-signal logic) so leads.json reflects the new
// rules immediately instead of waiting for the next scheduled run.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { scoreArtist, priorityFor } = require('./src/score');
const { buildReasoning } = require('./src/output');
const { loadConfig } = require('./src/cli/seed-store');
const { summarizeReleases } = require('./src/release-classifier');

const LEADS_PATH = path.join(__dirname, 'data', 'leads.json');

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function main() {
  const config = loadConfig();
  const payload = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8'));
  const minScore = config?.scoringThresholds?.minScore ?? 60;

  const rescored = payload.leads
    .map((lead) => {
      // leads.json doesn't persist setlistCount separately — it's the window
      // tourHistory length (see aggregate.js); buildReasoning needs it. Same
      // for the release-quality classification — recompute it from
      // recentReleases since older leads.json entries predate that field.
      const releaseSummary = summarizeReleases(lead.recentReleases);
      const releaseFields = {
        fullOriginalReleaseCount: releaseSummary.fullOriginalCount,
        selfRemixReleaseCount: releaseSummary.selfRemixCount,
        otherRemixReleaseCount: releaseSummary.otherRemixCount,
        releaseQualityScore: releaseSummary.releaseQualityScore,
      };
      const withDerivedFields = {
        ...lead,
        setlistCount: (lead.tourHistory || []).length,
        ...releaseFields,
      };
      const scored = scoreArtist(withDerivedFields, config);
      return {
        ...lead,
        ...releaseFields,
        baseScore: scored.baseScore,
        finalScore: scored.finalScore,
        scoring: scored.scoring,
        fitReasoning: buildReasoning(scored, config),
      };
    })
    .filter((l) => l.finalScore >= minScore)
    .map((l) => ({ ...l, priority: priorityFor(l.finalScore, config) }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((l, i) => ({ ...l, rank: i + 1 }));

  for (const l of rescored) {
    const before = payload.leads.find((p) => p.artist === l.artist);
    console.log(
      `${l.artist}: ${before.finalScore} -> ${l.finalScore}` +
        (l.scoring.comebackGapMonths != null ? ` (comeback: ${Math.round(l.scoring.comebackGapMonths)}mo gap)` : '')
    );
  }

  const scores = rescored.map((l) => l.finalScore);
  payload.leads = rescored;
  payload.stats = {
    avgScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : 0,
    medianScore: median(scores),
    priorityBreakdown: {
      immediate: rescored.filter((l) => l.priority === 'immediate').length,
      high: rescored.filter((l) => l.priority === 'high').length,
      qualified: rescored.filter((l) => l.priority === 'qualified').length,
    },
  };
  payload.totalLeads = rescored.length;

  fs.writeFileSync(LEADS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote ${rescored.length} leads to ${path.relative(process.cwd(), LEADS_PATH)}`);
}

main();
