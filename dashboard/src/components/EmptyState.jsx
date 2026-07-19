// Friendly loading, empty, and error states for the leads view.

export function LoadingState() {
  return (
    <div className="cards-grid" aria-busy="true" aria-label="Loading leads">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

// Shown when the pipeline produced 0 leads. The pipeline preserves the previous
// leads.json on empty runs, so this should rarely appear — but handle it kindly.
export function EmptyState() {
  return (
    <div className="state">
      <div className="emoji">🎧</div>
      <h2>No leads yet</h2>
      <p>
        The pipeline hasn&apos;t produced any qualifying artists yet — likely a quota
        window or an empty run. Fresh leads appear here automatically once the next
        run completes.
      </p>
    </div>
  );
}

// Shown when leads match the current data but every one is filtered out.
export function NoMatchesState({ onReset }) {
  return (
    <div className="state">
      <div className="emoji">🔍</div>
      <h2>No leads match your filters</h2>
      <p>Try lowering the minimum score or widening the priority/genre filters.</p>
      {onReset && (
        <p style={{ marginTop: 14 }}>
          <button
            onClick={onReset}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              textDecoration: 'underline',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Reset filters
          </button>
        </p>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state">
      <div className="emoji">⚠️</div>
      <h2>Couldn&apos;t load leads</h2>
      <p>{message || 'Something went wrong fetching the data.'}</p>
      {onRetry && (
        <p style={{ marginTop: 14 }}>
          <button
            onClick={onRetry}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              textDecoration: 'underline',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
