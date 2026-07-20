// Every external source the automation pipeline pulls from — see
// automation/src/scrapers/ (and automation/src/musicbrainz.js) for the actual
// scraper code this describes. Kept as a plain data array (mirrors
// data/updates.js) so adding a new source later is a quick addition, not a
// rewrite. Rendered by pages/DataSources.jsx (/data-sources).
//
// `active: false` marks a source that has scraper code in the repo but isn't
// wired into aggregate.js/score.js yet — keep that flag accurate rather than
// listing it as if it's already contributing to leads.

const DATA_SOURCES = [
  {
    name: 'Deezer',
    description: 'Free music-streaming catalog — no signup or API key required.',
    contributes: 'Detects new releases and pulls an artist photo.',
  },
  {
    name: 'Setlist.fm',
    description: 'Community-logged concert data, built by fans tracking real shows.',
    contributes: 'Powers tour history, show counts, and venue name/city.',
  },
  {
    name: 'MusicBrainz',
    description: 'Open, community-maintained music encyclopedia.',
    contributes: "Supplies genre classification, using the artist ID Setlist.fm resolves.",
  },
  {
    name: 'TheAudioDB',
    description: 'A community artist encyclopedia.',
    contributes: "Fills in an artist photo, bio, or social links whenever another source comes up empty.",
  },
  {
    name: 'Last.fm',
    description: "Listener/scrobble data and an artist-similarity graph.",
    contributes:
      "Powers monthly listener counts, a genre cross-check against MusicBrainz, and artist discovery — finding new candidates based on who you've worked with.",
  },
  {
    name: 'Discogs',
    description: 'Music database and marketplace with detailed release histories.',
    contributes: "Cross-verifies an artist's discography as a confidence check.",
  },
  {
    name: 'Wikipedia',
    description: 'Public reference encyclopedia.',
    contributes: "Supplies an artist's official website, label/management info, and venue capacity where Setlist.fm doesn't have it.",
  },
  {
    name: 'Wikidata',
    description: "Wikipedia's structured-data companion project.",
    contributes: 'Supplies verified social media and YouTube links.',
  },
  {
    name: 'RSS feeds (Pitchfork, Stereogum)',
    description: 'Music news coverage from two publications.',
    contributes: 'Surfaces recent press mentions as "Recent Buzz" on an artist\'s profile — shown for context, doesn\'t affect their score.',
  },
  {
    name: 'Ticketmaster',
    description: 'Official event data straight from the box office.',
    contributes: "Confirms real, on-sale, announced tour dates — the strongest touring signal available, since it's a verified listing rather than an inference.",
  },
  {
    name: 'JamBase',
    url: 'https://www.jambase.com',
    description: 'Live music database and events API. Data provided by JamBase.',
    contributes:
      "A second, independent confirmation source alongside Ticketmaster — when both list the same artist's tour, that's two vendors agreeing, not just one.",
  },
];

export default DATA_SOURCES;
