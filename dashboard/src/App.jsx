import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { config } from './config';
import mockLeads from './mock-leads.json';
import LeadsList from './components/LeadsList';
import Filters, { DEFAULT_FILTERS, applyFilters } from './components/Filters';
import ArtistDetail from './pages/ArtistDetail';
import ScoringGuide from './pages/ScoringGuide';
import Settings from './pages/Settings';
import ScoreLegend from './components/ScoreLegend';
import SettingsLink from './components/SettingsLink';
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
  // Filters + active tab live here (above the router) so they survive a trip
  // into an artist detail page and back.
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [tab, setTab] = useState('leads'); // 'leads' | 'saved' | 'myArtists'

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

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Dashboard
            data={data}
            status={status}
            error={error}
            leads={leads}
            filters={filters}
            setFilters={setFilters}
            tab={tab}
            setTab={setTab}
            onRetry={() => {
              setStatus('loading');
              load(false);
            }}
          />
        }
      />
      <Route path="/artist/:id" element={<ArtistDetail leads={leads} />} />
      <Route path="/my-artists/:id" element={<ArtistDetail source="myArtists" hideScore />} />
      <Route path="/scoring-guide" element={<ScoringGuide />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Dashboard({ data, status, error, leads, filters, setFilters, tab, setTab, onRetry }) {
  const savedCount = useSavedArtists().length;
  const filtered = useMemo(() => applyFilters(leads, filters), [leads, filters]);

  return (
    <>
      <header className="top-bar">
        <img className="brand-mark" src="/tourfinder-icon-horizontal.webp" alt="Tour Finder" />
        <div className="top-bar-right">
          <ScoreLegend />
          <SettingsLink />
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
            <WeeklyHighlight leads={leads} generatedAt={data?.generatedAt} />
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
            onRetry={onRetry}
          />
        </>
      )}
    </>
  );
}

function MainContent({ status, error, leads, filtered, onResetFilters, onRetry }) {
  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState message={error} onRetry={onRetry} />;
  if (leads.length === 0) return <EmptyState />;
  if (filtered.length === 0) return <NoMatchesState onReset={onResetFilters} />;

  return (
    <>
      <div className="result-count">
        Showing {filtered.length} of {leads.length} leads
      </div>
      <LeadsList leads={filtered} />
    </>
  );
}
