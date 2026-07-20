// Manually-maintained, human-readable changelog for Matthew (and any future
// users) — see pages/Updates.jsx. Deliberately NOT auto-generated from commit
// history: commit messages are written for developers, not Matthew, and would
// read as noisy and jargon-heavy here. Add a new entry to the TOP of this
// array whenever something user-facing changes; date as 'YYYY-MM-DD'.

const UPDATES = [
  {
    date: '2026-07-20',
    title: 'See exactly what each scan finds',
    description:
      "Every scan — automatic or manual — now shows a real summary: how many candidates were checked, how many had recent activity, and any new leads that qualified. A \"no new leads\" result now explains why instead of just looking empty.",
  },
  {
    date: '2026-07-19',
    title: 'Mark leads "Not Interested"',
    description:
      "You can now dismiss a lead you're not interested in, and it won't come back in future scans. Settings also got reorganized into one place instead of being scattered across the app.",
  },
  {
    date: '2026-07-19',
    title: 'You can now rank your genre preferences',
    description:
      "Head to Settings to reorder which genres you're most interested in right now — this nudges scoring without excluding anything.",
  },
  {
    date: '2026-07-19',
    title: 'My Artists syncs automatically',
    description:
      "Adding or editing an artist in My Artists now saves back to the system automatically instead of staying local to your browser — your roster stays consistent everywhere.",
  },
  {
    date: '2026-07-19',
    title: 'Full artist profiles and a Scoring Guide',
    description:
      "Every lead now has its own detail page with tour history and contact info, plus a Scoring Guide that explains exactly why an artist scored the way it did.",
  },
  {
    date: '2026-07-19',
    title: 'Smarter scoring for new artists',
    description:
      "Brand-new artists with no touring history yet no longer get unfairly penalized — the system now tells the difference between \"hasn't toured yet\" and \"not a good fit.\" A \"Scan now\" button was also added so you don't have to wait for the weekly check.",
  },
  {
    date: '2026-07-19',
    title: "Finds new artists based on who you've worked with",
    description:
      "Instead of rotating through a fixed list, the system now looks at who's musically similar to artists you've actually worked with and checks them for touring signs. The more you add to My Artists, the smarter this gets — and it now runs automatically every week.",
  },
  {
    date: '2026-07-19',
    title: 'Switched to a richer, more reliable data pipeline',
    description:
      'Replaced the original single-source setup with a combination of sources for release data, tour history, listener stats, and verification — so leads come with more complete, more trustworthy information.',
  },
  {
    date: '2026-07-18',
    title: 'Tour Finder launches',
    description:
      'The first version went live: automated artist discovery, scoring, and a dashboard to review leads.',
  },
];

export default UPDATES;
