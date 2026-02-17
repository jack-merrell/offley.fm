import { useEffect, useState } from 'react';
import StationsListPanel from './StationsListPanel';
import { RETURN_FROM_ALL_STATIONS_KEY } from './playbackStorage';

function clockLabel() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());
}

function AllStationsPage() {
  const [clock, setClock] = useState(clockLabel());
  const [stations, setStations] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setClock(clockLabel()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function handleSelectStation(station) {
    const parsed = Number.parseFloat(station?.frequency);
    const hash = Number.isFinite(parsed) ? `#${parsed.toFixed(2)}MHz` : '';
    window.sessionStorage.setItem(RETURN_FROM_ALL_STATIONS_KEY, '1');
    window.location.href = `/${hash}`;
  }

  function handleReturnToRadio() {
    window.sessionStorage.setItem(RETURN_FROM_ALL_STATIONS_KEY, '1');
  }

  useEffect(() => {
    let cancelled = false;

    async function loadStations() {
      try {
        const response = await fetch(`/media/stations.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to load stations (${response.status})`);
        }
        const manifest = await response.json();
        if (!cancelled) {
          setStations(Array.isArray(manifest.stations) ? manifest.stations : []);
          setError('');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load stations.');
        }
      }
    }

    void loadStations();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell tune-shell">
      <div className="scanlines" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <main className="tune-stage">
        <section className="tune-panel">
          <header className="panel-head">
            <p className="panel-clock">{clock}</p>
            <div className="signal-bars signal-bars-steady" aria-label="Signal strength 4 of 4">
              {Array.from({ length: 4 }).map((_, index) => (
                <span key={`all-stations-signal-${index}`} className="signal-bar signal-bar-active" aria-hidden="true" />
              ))}
            </div>
          </header>
          {error ? <p className="tune-error stations-load-error">{error}</p> : null}
          <StationsListPanel
            stations={stations}
            onSelectStation={handleSelectStation}
            onReturnToRadio={handleReturnToRadio}
          />
        </section>
      </main>
    </div>
  );
}

export default AllStationsPage;
