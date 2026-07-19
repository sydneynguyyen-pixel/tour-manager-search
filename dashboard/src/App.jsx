import { useCallback, useEffect, useMemo, useState } from 'react';
import { config } from './config';
import mockLeads from './mock-leads.json';
import LeadsList from './components/LeadsList';
import Filters, { DEFAULT_FILTERS, applyFilters } from './components/Filters';
import ArtistDetailModal from './components/ArtistDetailModal';
import ScoreLegend from './components/ScoreLegend';
import SavedArtists from './components/SavedArtists';
import MyArtists from './components/MyArtists';
import WeeklyHighlight from './components/WeeklyHighlight';
import { useSavedArtists } from './lib/savedArtists';
import {
  LoadingState,
  EmptyState,
  NoMatchesState,
  ErrorState,
} from './components/EmptyState';

function formatUpdated(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const date = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const time = d
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s/g, '');
  return `${date}, ${time}`;
}

export default function App() {
  const [data, setData] = useState(null);
  // Full loading screen only on first load; the 30s auto-refresh updates silently.
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('leads'); // 'leads' | 'saved' | 'myArtists'
  const savedCount = useSavedArtists().length;

  const load = useCallback(async (isBackground = false) => {
    // Dev with no configured URL: use the bundled mock (no fetch).
    if (!config.leadsUrl) {
      setData(mockLeads);
      setStatus('ready');
      return;
    }
    try {
      const res = await fetch(`${config.leadsUrl}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setStatus('ready');
      setError(null);
    } catch (err) {
      // A failed background refetch keeps the last good data on screen.
      if (!isBackground) {
        setError(err.message);
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), config.refreshIntervalMs);
    return () => clearInterval(id);
  }, [load]);

  const leads = data?.leads ?? [];
  const filtered = useMemo(() => applyFilters(leads, filters), [leads, filters]);

  return (
    <>
      <header className="top-bar">
        <h1 className="brand">Tour Finder</h1>
        <div className="top-bar-right">
          <ScoreLegend />
          {data?.generatedAt && (
            <div className="last-updated">
              <span className="dot" />
              Last updated {formatUpdated(data.generatedAt)}
            </div>
          )}
        </div>
      </header>

      <nav className="tab-nav" role="tablist" aria-label="Views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'leads'}
          className={tab === 'leads' ? 'active' : ''}
          onClick={() => setTab('leads')}
        >
          Leads
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'saved'}
          className={tab === 'saved' ? 'active' : ''}
          onClick={() => setTab('saved')}
        >
          Saved
          {savedCount > 0 && <span className="tab-count">{savedCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'myArtists'}
          className={tab === 'myArtists' ? 'active' : ''}
          onClick={() => setTab('myArtists')}
        >
          My Artists
        </button>
      </nav>

      {tab === 'saved' && <SavedArtists />}
      {tab === 'myArtists' && <MyArtists />}

      {tab === 'leads' && (
        <>
          <section className="hero-row">
            <div className="hero-welcome">
              <h2>
                Welcome back,
                <br />
                Matthew
              </h2>
            </div>
            <WeeklyHighlight
              leads={leads}
              generatedAt={data?.generatedAt}
              onSelect={setSelected}
            />
          </section>

          {status === 'ready' && leads.length > 0 && (
            <Filters filters={filters} onChange={setFilters} />
          )}

          <MainContent
            status={status}
            error={error}
            leads={leads}
            filtered={filtered}
            onResetFilters={() => setFilters({ ...DEFAULT_FILTERS })}
            onSelect={setSelected}
            onRetry={() => {
              setStatus('loading');
              load(false);
            }}
          />

          {selected && (
            <ArtistDetailModal lead={selected} onClose={() => setSelected(null)} />
          )}
        </>
      )}
    </>
  );
}

function MainContent({ status, error, leads, filtered, onResetFilters, onSelect, onRetry }) {
  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState message={error} onRetry={onRetry} />;
  if (leads.length === 0) return <EmptyState />;
  if (filtered.length === 0) return <NoMatchesState onReset={onResetFilters} />;

  return (
    <>
      <div className="result-count">
        Showing {filtered.length} of {leads.length} leads
      </div>
      <LeadsList leads={filtered} onSelect={onSelect} />
    </>
  );
}
