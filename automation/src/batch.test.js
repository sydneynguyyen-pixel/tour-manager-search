// Unit tests for seed batch rotation (pure logic, no network/config).
// Run with:  node src/batch.test.js   (from automation/)

const logger = require('./utils/logger');
const { selectBatch } = require('./batch');

let failures = 0;
function assert(cond, msg) {
  if (cond) logger.success(`PASS ${msg}`);
  else { failures += 1; logger.error(`FAIL ${msg}`); }
}

// 27 seeds, batch size 8 -> expected rotation: [0-7],[8-15],[16-23],[24-26], wrap.
const seeds = Array.from({ length: 27 }, (_, i) => `A${i}`);

let r = selectBatch(seeds, 8, 0);
assert(r.batch.length === 8 && r.batch[0] === 'A0' && r.nextIndex === 8, 'run1: seeds[0..7], next=8');

r = selectBatch(seeds, 8, 8);
assert(r.batch.length === 8 && r.batch[0] === 'A8' && r.nextIndex === 16, 'run2: seeds[8..15], next=16');

r = selectBatch(seeds, 8, 16);
assert(r.batch.length === 8 && r.batch[0] === 'A16' && r.nextIndex === 24, 'run3: seeds[16..23], next=24');

r = selectBatch(seeds, 8, 24);
assert(r.batch.length === 3 && r.batch[0] === 'A24' && r.nextIndex === 0, 'run4: remainder seeds[24..26] (3), wraps to 0');

// Full rotation: union covers all seeds exactly once, no duplicates.
const seen = [];
let idx = 0;
for (let run = 0; run < 4; run += 1) {
  const b = selectBatch(seeds, 8, idx);
  seen.push(...b.batch);
  idx = b.nextIndex;
}
assert(idx === 0, 'index returns to 0 after a full rotation (4 runs)');
assert(seen.length === 27 && new Set(seen).size === 27, 'full rotation covers all 27 seeds with no duplicates');

// Edge cases.
assert(selectBatch(seeds, 100, 0).batch.length === 27 && selectBatch(seeds, 100, 0).nextIndex === 0, 'batchSize >= n -> whole list, wraps to 0');
assert(selectBatch(seeds, 8, 999).start === 0, 'out-of-range startIndex clamps to 0');
assert(selectBatch([], 8, 0).batch.length === 0, 'empty seed list -> empty batch');
assert(selectBatch(seeds, 0, 0).batch.length === 27, 'batchSize 0 -> treated as whole list');

if (failures > 0) { logger.error(`${failures} check(s) failed.`); process.exit(1); }
logger.success('batch rotation checks passed.');
