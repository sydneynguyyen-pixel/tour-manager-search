// Horizontal search + filter + sort bar above the cards grid.
// Search matches against BOTH artist name and genre (single input).

// Labels mirror the score-tier names in scoreExplanations.js (SCORE_TIERS); the
// values stay the backend priority keys from output.js so filtering still works:
// immediate = 85+ (Strong), high = 70–84 (Good), qualified = <70 (Possible).
const PRIORITIES = [
  { value: 'all', label: 'All priorities' },
  { value: 'immediate', label: 'Strong Match' },
  { value: 'high', label: 'Good Match' },
  { value: 'qualified', label: 'Possible Match' },
];

// Genre-fit groups map to the backend genreTier (1-4) but are labeled by what the
// tier means to the user (a genre-preference multiplier) rather than exposing the
// internal "tier" numbering.
const GENRE_TIERS = [
  { value: 'all', label: 'All genres' },
  { value: '1', label: 'Best genre fit' },
  { value: '2', label: 'Good genre fit' },
  { value: '3', label: 'Fair genre fit' },
  { value: '4', label: 'Lower genre fit' },
];

// Management types match the values produced by automation/src/output.js.
const MGMT_TYPES = [
  { value: 'all', label: 'All management' },
  { value: 'self-managed', label: 'Self-managed' },
  { value: 'indie-label', label: 'Indie label' },
  { value: 'indie-booking', label: 'Indie booking' },
  { value: 'booking-agency', label: 'Booking agency' },
  { value: 'major-agency', label: 'Major agency' },
  { value: 'major-label', label: 'Major label' },
  { value: 'unknown', label: 'Unknown' },
];

export const DEFAULT_FILTERS = {
  search: '',
  priority: 'all',
  genreTier: 'all',
  managementType: 'all',
  sortBy: 'score', // 'score' | 'lastTour'
};

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export default function Filters({ filters, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const isDefault =
    filters.search === DEFAULT_FILTERS.search &&
    filters.priority === DEFAULT_FILTERS.priority &&
    filters.genreTier === DEFAULT_FILTERS.genreTier &&
    filters.managementType === DEFAULT_FILTERS.managementType &&
    filters.sortBy === DEFAULT_FILTERS.sortBy;

  return (
    <div className="controls-row">
      <div className="search-field">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search by artist or genre"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          aria-label="Search by artist or genre"
        />
      </div>

      <select
        className="control-select"
        value={filters.priority}
        onChange={(e) => set({ priority: e.target.value })}
        aria-label="Filter by priority"
      >
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        className="control-select"
        value={filters.genreTier}
        onChange={(e) => set({ genreTier: e.target.value })}
        aria-label="Filter by genre fit"
      >
        {GENRE_TIERS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <select
        className="control-select"
        value={filters.managementType}
        onChange={(e) => set({ managementType: e.target.value })}
        aria-label="Filter by management type"
      >
        {MGMT_TYPES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      <div className="segmented" role="group" aria-label="Sort leads">
        <button
          type="button"
          className={filters.sortBy === 'score' ? 'active' : ''}
          onClick={() => set({ sortBy: 'score' })}
        >
          Score
        </button>
        <button
          type="button"
          className={filters.sortBy === 'lastTour' ? 'active' : ''}
          onClick={() => set({ sortBy: 'lastTour' })}
        >
          Recent tour
        </button>
      </div>

      {!isDefault && (
        <button className="controls-reset" type="button" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
          Reset
        </button>
      )}
    </div>
  );
}

// Pure helper: apply search + filters + sort to a leads array.
export function applyFilters(leads, filters) {
  const q = filters.search.trim().toLowerCase();

  const out = (leads || []).filter((l) => {
    // Search matches artist name OR genre.
    if (q) {
      const hay = `${l.artist || ''} ${l.genre || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.priority !== 'all' && l.priority !== filters.priority) return false;
    if (filters.genreTier !== 'all' && String(l.genreTier) !== filters.genreTier) return false;
    if (
      filters.managementType !== 'all' &&
      (l.managementType ?? 'unknown') !== filters.managementType
    ) {
      return false;
    }
    return true;
  });

  out.sort((a, b) => {
    if (filters.sortBy === 'lastTour') {
      const ad = a.lastTourDate || '';
      const bd = b.lastTourDate || '';
      if (ad === bd) return (b.finalScore ?? 0) - (a.finalScore ?? 0);
      if (!ad) return 1;
      if (!bd) return -1;
      return bd.localeCompare(ad);
    }
    return (b.finalScore ?? 0) - (a.finalScore ?? 0);
  });

  return out;
}
