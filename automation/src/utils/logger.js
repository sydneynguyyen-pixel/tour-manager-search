// Minimal timestamped logger for scraper progress, errors, and data counts.

function ts() {
  return new Date().toISOString();
}

function emit(level, args) {
  console.log(`[${ts()}] [${level}]`, ...args);
}

module.exports = {
  info: (...args) => emit('INFO', args),
  success: (...args) => emit('OK', args),
  warn: (...args) => emit('WARN', args),
  error: (...args) => emit('ERROR', args),
  // Convenience for logging how many records a scraper produced.
  count: (label, n) => emit('COUNT', [`${label}: ${n}`]),
};
