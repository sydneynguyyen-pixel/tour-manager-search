// Display helpers for My Artists-specific (form-owned) fields — role, logged
// genre, dates worked, venue range worked. Shared by MyArtists.jsx (the list/
// edit form) and ArtistDetail.jsx (the "My Notes" tab on a My Artists entry's
// detail page) so the two never drift on formatting.

// "Tour Manager", falling back to the free-text value when role is "Other".
// Blank ("" — every bulk-imported entry) -> '' so callers can show a distinct
// "Role not set" placeholder instead of an empty line.
export function roleLabel(entry) {
  if (entry.role === 'Other') return entry.roleOther?.trim() || 'Other';
  return entry.role || '';
}

// Display label for a logged genre ("Other" -> the free-text value). Needs
// genreLabel from scoringSettings but that module also depends on nothing
// here, so it's passed in to avoid a circular/unnecessary import surface.
export function genreDisplay(entry, genreLabel) {
  const g = entry.genre === 'Other' ? entry.genreOther : entry.genre;
  return g ? genreLabel(g) : '';
}

// "Jun 2025" / "" when incomplete.
function monthYear(month, year) {
  if (year && month) return `${month} ${year}`;
  if (year) return String(year);
  return '';
}

// "Jun 2025–Sep 2025" / "Jun 2025–Present" / "Jun 2025".
export function dateRange(entry) {
  const start = monthYear(entry.startMonth, entry.startYear);
  const end = entry.isPresent ? 'Present' : monthYear(entry.endMonth, entry.endYear);
  if (start && end) return `${start}–${end}`;
  return start || end;
}

// "300–2000 cap venues" / "300+ cap venues" / "up to 2000 cap venues" / "".
export function venueRange(entry) {
  const min = entry.minCap !== '' && entry.minCap != null ? Number(entry.minCap) : null;
  const max = entry.maxCap !== '' && entry.maxCap != null ? Number(entry.maxCap) : null;
  if (min != null && max != null) return `${min}–${max} cap venues`;
  if (min != null) return `${min}+ cap venues`;
  if (max != null) return `up to ${max} cap venues`;
  return '';
}
