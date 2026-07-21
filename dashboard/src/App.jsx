import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { config } from './config';
import mockLeads from './mock-leads.json';
import LeadsList from './components/LeadsList';
import Filters, { DEFAULT_FILTERS, applyFilters } from './components/Filters';
import ArtistDetail from './pages/ArtistDetail';
import ScoringGuide from './pages/ScoringGuide';
import FAQ from './pages/FAQ';
import DataSources from './pages/DataSources';
import Settings from './pages/Settings';
import GenrePreferences from './pages/GenrePreferences';
import DismissedArtists from './pages/DismissedArtists';
import InfoMenu from './components/InfoMenu';
import SavedArtists from './components/SavedArtists';
import MyArtists from './components/MyArtists';
import TourAnnouncements from './components/TourAnnouncements';
import WeeklyHighlight from './components/WeeklyHighlight';
import ScanNow from './components/ScanNow';
import ScanPendingBanner from './components/ScanPendingBanner';
import ScanResultModal from './components/ScanResultModal';
import ScanHistory from './pages/ScanHistory';
import Updates from './pages/Updates';
import { useSavedArtists, leadId } from './lib/savedArtists';
import { useDismissedArtists } from './lib/dismissedArtists';
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
  const [tab, setTab] = useState('leads'); // 'leads' | 'saved' | 'myArtists' | 'announcements'
  // Per-run scan summary (automation/src/scan-result.js) — polled alongside
  // leads.json so ScanPendingBanner can detect completion even on a
  // 0-new-lead run, when leads.json itself never changes.
  const [scanResult, setScanResult] = useState(null);
  // The result to show in the "what did the scan find" modal, set once when
  // ScanPendingBanner detects the pending scan has finished.
  const [completedScanResult, setCompletedScanResult] = useState(null);

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

  const loadScanResult = useCallback(async () => {
    if (!config.scanResultUrl) return;
    try {
      const res = await fetch(`${config.scanResultUrl}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return; // No scan has ever run yet — leave scanResult null.
      setScanResult(await res.json());
    } catch {
      // Background poll — keep the last known scan result on a failed fetch.
    }
  }, []);

  const loadAll = useCallback(
    (isBackground = false) => {
      load(isBackground);
      loadScanResult();
    },
    [load, loadScanResult]
  );

  useEffect(() => {
    loadAll(false);
    const id = setInterval(() => loadAll(true), config.refreshIntervalMs);
    return () => clearInterval(id);
  }, [loadAll]);

  const allLeads = data?.leads ?? [];
  const dismissed = useDismissedArtists();
  const dismissedIds = useMemo(() => new Set(dismissed.map((d) => d.id)), [dismissed]);
  const leads = dismissedIds.size === 0 ? allLeads : allLeads.filter((lead) => !dismissedIds.has(leadId(lead)));

  return (
    <>
      <ScanPendingBanner
        scanResult={scanResult}
        onRefreshNow={() => loadAll(false)}
        onScanComplete={setCompletedScanResult}
      />
      <ScanResultModal result={completedScanResult} onClose={() => setCompletedScanResult(null)} />
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
        <Route path="/tour-announcements/:id" element={<ArtistDetail source="announcements" hideScore />} />
        <Route path="/scoring-guide" element={<ScoringGuide />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/data-sources" element={<DataSources />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/genres" element={<GenrePreferences />} />
        <Route path="/settings/dismissed" element={<DismissedArtists />} />
        <Route path="/scan-history" element={<ScanHistory />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
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
          <InfoMenu />
          <ScanNow />
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'announcements'}
          className={tab === 'announcements' ? 'active' : ''}
          onClick={() => setTab('announcements')}
        >
          New Tour Detected
        </button>
      </nav>

      {tab === 'saved' && <SavedArtists />}
      {tab === 'myArtists' && <MyArtists />}
      {tab === 'announcements' && <TourAnnouncements />}

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
