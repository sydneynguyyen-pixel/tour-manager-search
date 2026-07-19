// Genre-based color coding for the genre pill. Dashboard genres arrive as
// free-text strings ("indie pop", "alternative rock", ...), so we match by
// case-insensitive substring — mirroring the backend genre-mapper approach.
//
// Order matters: more specific keys must come before broader ones (e.g. "k-pop"
// before "pop", "bedroom pop" before "pop") so the right bucket wins.
//
// Each entry provides a readable dark (or light) text color for its background.

const NEUTRAL = { background: '#E0E0E0', text: '#1f1a24' };

const GENRE_COLORS = [
  { keys: ['k-pop', 'kpop', 'j-pop', 'jpop'], background: '#F48FB1', text: '#4a1230' },
  { keys: ['bedroom pop'], background: '#F8BBD0', text: '#4a1230' },
  { keys: ['hip-hop', 'hip hop', 'rap', 'trap'], background: '#B39DDB', text: '#241246' },
  { keys: ['neo soul', 'r&b', 'rnb', 'r & b'], background: '#FFAB91', text: '#4a1c0c' },
  { keys: ['indie pop', 'synth-pop', 'synthpop', 'dance-pop', 'pop'], background: '#FFD966', text: '#4a3a0c' },
  { keys: ['house', 'techno', 'electronic', 'edm', 'dubstep', 'dance'], background: '#80DEEA', text: '#0c3a40' },
  { keys: ['indie rock', 'alternative rock', 'garage rock', 'rock'], background: '#90A4AE', text: '#1c2a30' },
  { keys: ['emo', 'punk', 'hardcore'], background: '#EF9A9A', text: '#4a1212' },
  { keys: ['folk', 'singer-songwriter', 'americana', 'acoustic'], background: '#A5D6A7', text: '#153a17' },
  { keys: ['country', 'bluegrass'], background: '#D7BFA6', text: '#3d2c18' },
  { keys: ['bollywood', 'latin', 'reggaeton', 'reggae'], background: '#FFB74D', text: '#4a2c07' },
  { keys: ['metalcore', 'metal'], background: '#78909C', text: '#ffffff' },
  { keys: ['classical', 'orchestral'], background: '#EFEAD1', text: '#3d3a1a' },
];

// Returns { background, text } for a genre string, falling back to neutral gray.
export function getGenreColor(genre) {
  if (genre) {
    const g = genre.toLowerCase();
    for (const entry of GENRE_COLORS) {
      if (entry.keys.some((k) => g.includes(k))) {
        return { background: entry.background, text: entry.text };
      }
    }
  }
  return { ...NEUTRAL };
}
