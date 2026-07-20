// Static explainer page for how lead scores are calculated. Reached at
// /scoring-guide via the "Scoring guide" button in the header (see
// components/ScoreLegend.jsx). Content is fixed copy, not derived from data.

import { Link } from 'react-router-dom';

export default function ScoringGuide() {
  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/">
          <span aria-hidden="true">←</span> Back
        </Link>
      </div>

      <article className="guide-article">
        <h1>How Scoring Works</h1>

        <section className="guide-section">
          <h2>The big picture</h2>
          <p>
            Every artist that shows up in your Leads feed gets a score from 0–100. That score is
            our best guess at how good a fit they are for you <em>right now</em> — based on how
            much they tour, how big their shows are, whether their team is reachable, and whether
            they seem to be gearing up for something. It's not a guarantee, just a starting point
            for where to spend your time.
          </p>
        </section>

        <section className="guide-section">
          <h2>The three match tiers</h2>
          <ul className="guide-tiers">
            <li>
              <span className="guide-tier-emoji" aria-hidden="true">🟢</span>
              <span>
                <strong>Strong Match (85+)</strong> — everything's lining up: they tour at your
                scale, seem reachable, and there's a real signal they're about to need help.
              </span>
            </li>
            <li>
              <span className="guide-tier-emoji" aria-hidden="true">🟡</span>
              <span>
                <strong>Good Match (70–84)</strong> — solid fit, worth a look, but maybe one thing
                is uncertain (harder to reach, or the timing's a little fuzzy).
              </span>
            </li>
            <li>
              <span className="guide-tier-emoji" aria-hidden="true">🔴</span>
              <span>
                <strong>Possible Match (below 70)</strong> — could still be worth pursuing, but
                something's working against them — could be venue size, timing, or we just don't
                have great data on them yet.
              </span>
            </li>
          </ul>
        </section>

        <section className="guide-section">
          <h2>The five things we look at</h2>

          <div className="guide-factor">
            <h3>1. Touring track record (up to 25 points)</h3>
            <p>
              Have they actually toured recently? We look at the last 18 months. Someone with 15+
              shows scores higher than someone touring for the first time — not because new
              artists aren't worth it, just because we have less to go on.
            </p>
          </div>

          <div className="guide-factor">
            <h3>2. Venue scale fit (up to 25 points)</h3>
            <p>
              We look at their average venue size over recent shows and compare it to the range
              you actually work in. Right in your range scores highest; way bigger or way smaller
              scores lower — not because they're bad artists, just less likely to be the right
              stage for you specifically.
            </p>
          </div>

          <div className="guide-factor">
            <h3>3. How reachable is their team (up to 20 points)</h3>
            <p>
              Self-managed or on an indie label — you can probably get a real person on the phone.
              Signed to a major label or represented by a big agency — technically possible, but
              there's more red tape between you and them.
            </p>
          </div>

          <div className="guide-factor">
            <h3>4. Timing (up to 25 points)</h3>
            <p>This is the "is now the moment" score. A few situations we look for:</p>
            <ul className="guide-list">
              <li>
                <strong>Fresh music, no tour booked yet</strong> — this is the best window.
                They're likely about to start planning, and nobody's locked in yet.
              </li>
              <li>
                <strong>A real comeback</strong> — they went quiet for a while (a year or more) and
                just came back with new material. Same opportunity as above, maybe even better,
                since there's genuinely no existing relationship to compete with.
              </li>
              <li>
                <strong>Already touring</strong> — still worth a look, but they've probably already
                got someone handling this.
              </li>
            </ul>
            <p>
              One thing worth knowing: we can tell the difference between a brand-new original
              song and a remix of someone else's track. A comeback built on one real new song
              scores higher than one built on four remixes — remixes are a weaker signal that
              they're about to hit the road.
            </p>
          </div>

          <div className="guide-factor">
            <h3>5. Momentum (up to 10-13 points)</h3>
            <p>
              Are they playing more shows, in more places, than they used to? Growing activity is
              a good sign they're scaling up, not slowing down.
            </p>
          </div>
        </section>

        <section className="guide-section">
          <h2>Genre preferences</h2>
          <p>
            You can set which genres you're currently most interested in working with — this
            doesn't lock anything out, it just nudges the score up or down a little for artists in
            genres you've flagged as priorities right now. You can change this anytime in
            Settings, and it won't stop artists outside those genres from showing up if everything
            else about them is strong.
          </p>
        </section>

        <section className="guide-section">
          <h2>What we can't see</h2>
          <p>Worth knowing upfront, so nothing feels like a bug:</p>

          <div className="guide-callout">
            <strong>Small/local artists often won't show up at all.</strong> This tool only sees
            what's publicly trackable — official releases, logged concerts, artist databases. A
            lot of great smaller artists just don't have that digital footprint yet. If you
            already know someone like that, log them in My Artists instead — no algorithm needed
            for people you already know.
          </div>

          <div className="guide-callout">
            <strong>Not every artist has genre data.</strong> About 4 in 10 artists don't have a
            clear genre tag in our sources. When that happens, we treat it as neutral — it doesn't
            help or hurt their score.
          </div>

          <div className="guide-callout">
            <strong>Contact info is often missing.</strong> Most artist websites don't publish a
            booking email where we can find it. When we can't find one, we still estimate
            reachability based on their label/management situation — just know "email not found"
            is common, not a dead end.
          </div>
        </section>
      </article>
    </div>
  );
}
