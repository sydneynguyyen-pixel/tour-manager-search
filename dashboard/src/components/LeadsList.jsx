// Responsive grid of artist cards. Each card navigates to the artist detail
// page on click (handled inside ArtistCard).

import ArtistCard from './ArtistCard';

export default function LeadsList({ leads }) {
  return (
    <div className="cards-grid">
      {leads.map((lead) => (
        <ArtistCard
          key={lead.spotifyId || lead.mbid || `${lead.artist}-${lead.rank}`}
          lead={lead}
        />
      ))}
    </div>
  );
}
