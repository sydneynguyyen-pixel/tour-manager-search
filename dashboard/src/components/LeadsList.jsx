// Responsive grid of artist cards. Card clicks bubble up via onSelect so the
// parent can open the detail modal.

import ArtistCard from './ArtistCard';

export default function LeadsList({ leads, onSelect }) {
  return (
    <div className="cards-grid">
      {leads.map((lead) => (
        <ArtistCard
          key={lead.spotifyId || lead.mbid || `${lead.artist}-${lead.rank}`}
          lead={lead}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
