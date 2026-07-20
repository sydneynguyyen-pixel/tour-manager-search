// Static explainer page for how the tool works day-to-day — feed timing,
// where leads come from, Leads vs My Artists, contact info gaps, genre
// nudges. For how scores are calculated, see ScoringGuide.jsx (/scoring-guide).
// Reached at /faq via the header's info menu (see components/InfoMenu.jsx).

import { Link } from 'react-router-dom';

export default function FAQ() {
  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/">
          <span aria-hidden="true">←</span> Back
        </Link>
      </div>

      <article className="guide-article">
        <h1>FAQ</h1>

        <section className="guide-section">
          <h2>How often does the feed update?</h2>
          <p>
            Every Sunday night, the system automatically looks for new artists and re-checks
            existing ones. You'll usually have fresh leads by Monday morning. You can also click
            "Scan now" anytime if you don't want to wait — it kicks off a fresh check right away,
            though it can take a few minutes to finish.
          </p>
        </section>

        <section className="guide-section">
          <h2>Where do new artists come from?</h2>
          <p>
            Every artist you log in My Artists helps the system find more. It looks at who's
            musically similar to the people you already know and work with, then checks if any of
            those similar artists are showing signs of touring soon. The more you add to My
            Artists, the smarter and more personalized your Leads feed gets over time.
          </p>
        </section>

        <section className="guide-section">
          <h2>How does the system know a tour is actually happening?</h2>
          <p>
            Most of the time it's an educated guess — a fresh release with no tour on the books
            yet, or an artist breaking a long touring gap. But when an artist has a real,
            on-sale tour listed on Ticketmaster, that's a confirmed signal, not a guess, and it
            counts for more. You'll see the actual dates on an artist's profile under "On sale
            now" whenever that's the case.
          </p>
        </section>

        <section className="guide-section">
          <h2>Why did an artist disappear from my Leads feed?</h2>
          <p>
            A few reasons: they might have been re-scored and dropped below the visibility
            threshold (see the <Link to="/scoring-guide">Scoring Guide</Link> for how that's
            calculated), they may already be logged in your My Artists (which automatically
            excludes them from Leads — no reason to get a "lead" on someone you already work
            with), their touring signal simply changed (e.g., they announced a tour, which
            changes their timing score), or you dismissed them (see{' '}
            <Link to="/settings/dismissed">Settings → Dismissed Artists</Link> to check and undo).
          </p>
        </section>

        <section className="guide-section">
          <h2>What does "Not Interested" do?</h2>
          <p>
            Tap the eye icon on any lead to hide it — maybe they're too mainstream, not your
            genre, or just not a fit right now. Dismissed artists won't show up again, even in
            future scans. You can see everything you've dismissed (and undo any of them) in{' '}
            <Link to="/settings/dismissed">Settings → Dismissed Artists</Link>.
          </p>
        </section>

        <section className="guide-section">
          <h2>What's the difference between Leads and My Artists?</h2>
          <p>
            Leads is artists the system found and thinks might be worth reaching out to. My
            Artists is your own record — people you've actually worked with or booked before. My
            Artists artists never show up in Leads, and adding details there (your role, venue
            sizes, notes) helps you build a real, searchable history alongside making the Leads
            feed smarter.
          </p>
        </section>

        <section className="guide-section">
          <h2>Why is contact info sometimes missing?</h2>
          <p>
            Most artist websites don't publish a direct booking email anywhere we can find. When
            that happens, we still estimate how reachable they are based on their label/management
            situation — "Not found" just means dig a little, not "dead end."
          </p>
        </section>

        <section className="guide-section">
          <h2>Can I change what genres show up more?</h2>
          <p>
            Yes — <Link to="/settings">Settings</Link> has a genre ranking tool. Drag genres up or
            down based on what you're currently most interested in. This nudges scoring slightly,
            it doesn't exclude anything — an artist outside your top genres can still show up if
            everything else about them is strong. See the{' '}
            <Link to="/scoring-guide">Scoring Guide</Link> for more on how that nudge works.
          </p>
        </section>

        <section className="guide-section">
          <h2>Is this the same as a job board?</h2>
          <p>
            No — nothing here is a public listing or job posting. It's a research tool that finds
            people who might need help before they've announced it publicly. Every lead still
            needs your own judgment and a real cold email — the tool just narrows down who's worth
            that effort.
          </p>
        </section>
      </article>
    </div>
  );
}
