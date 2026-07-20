// Static explainer page listing every external source the automation
// pipeline pulls from, plus a consolidated "known gaps" section (previously
// scattered across FAQ.jsx and ScoringGuide.jsx — kept in one place here so
// it isn't maintained in three spots). Source content lives in
// data/dataSources.js. Reached at /data-sources, cross-linked from the FAQ
// and Scoring Guide pages.

import { Link } from 'react-router-dom';
import DATA_SOURCES from '../data/dataSources';

export default function DataSources() {
  return (
    <div className="guide-page">
      <div className="guide-topbar">
        <Link className="detail-back" to="/">
          <span aria-hidden="true">←</span> Back
        </Link>
      </div>

      <article className="guide-article">
        <h1>Data Sources</h1>

        <section className="guide-section">
          <p>
            Every lead in your feed is built from several public data sources, not one — no
            single site has everything (releases, tour history, genre, contact info), so the
            pipeline combines a handful of free/public sources and cross-checks them against each
            other. Here's what each one contributes.
          </p>

          <ul className="source-list">
            {DATA_SOURCES.map((s) => (
              <li key={s.name} className="source-row">
                <div className="source-name">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                  {s.active === false && <span className="source-badge">Coming soon</span>}
                </div>
                <p className="source-desc">{s.description}</p>
                <p className="source-contributes">
                  <strong>Used for:</strong> {s.contributes}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="guide-section">
          <h2>What this can't see yet</h2>
          <p>Worth knowing upfront, so nothing feels like a bug:</p>

          <div className="guide-callout">
            <strong>Small/local artists often won't show up at all.</strong> This tool only sees
            what's publicly trackable — official releases, logged concerts, artist databases. A
            lot of great smaller artists just don't have that digital footprint yet. If you
            already know someone like that, log them in My Artists instead — no algorithm needed
            for people you already know.
          </div>

          <div className="guide-callout">
            <strong>Not every artist has genre data.</strong> Roughly 6 in 10 artists have a clear
            genre tag across our sources. When one's missing, scoring treats it as neutral — it
            doesn't help or hurt the score.
          </div>

          <div className="guide-callout">
            <strong>Contact info is often missing.</strong> Most artist websites don't publish a
            booking email where we can find it. When we can't find one, we still estimate
            reachability based on their label/management situation — "not found" is common, not a
            dead end.
          </div>

          <div className="guide-callout">
            <strong>Music-news coverage skews indie/alt.</strong> The RSS sources (Pitchfork,
            Stereogum) lean toward indie and alternative acts, and each only carries that
            publication's most recent posts — roughly the last several days, not a rolling
            history. "No recent buzz" just means outside what those two feeds happened to cover
            recently, not that nothing's happening.
          </div>
        </section>

        <p className="guide-crosslink">
          Have other questions about how this works? Check the <Link to="/faq">FAQ</Link> or the{' '}
          <Link to="/scoring-guide">Scoring Guide</Link>.
        </p>
      </article>
    </div>
  );
}
