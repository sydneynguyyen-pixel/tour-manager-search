// Seed rotation: process a fixed-size batch of seed artists per run so a single
// run stays under the Spotify quota. The final batch of a rotation is just the
// remainder (no wrap-around WITHIN a batch), so no artist is processed twice
// before a full rotation completes. The next start index wraps to 0 once the
// end is reached.

// Returns { batch, start, nextIndex } for the given starting index.
function selectBatch(seeds, batchSize, startIndex) {
  const n = Array.isArray(seeds) ? seeds.length : 0;
  if (n === 0) return { batch: [], start: 0, nextIndex: 0 };

  let start = Number.isInteger(startIndex) ? startIndex : 0;
  if (start < 0 || start >= n) start = 0; // clamp stale/out-of-range indexes

  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : n;
  const batch = seeds.slice(start, start + size); // remainder only near the end

  let nextIndex = start + size;
  if (nextIndex >= n) nextIndex = 0; // wrap for the next run

  return { batch, start, nextIndex };
}

module.exports = { selectBatch };
