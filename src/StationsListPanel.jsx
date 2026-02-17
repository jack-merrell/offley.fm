import { Fragment, Suspense, lazy, useMemo, useState } from 'react';
import { normalizeStationTags } from './stationTags';

const StationsGlobe = lazy(() => import('./StationsGlobe'));

function locationLabel(station) {
  if (station?.location && Number.isFinite(Number(station.location.lat)) && Number.isFinite(Number(station.location.lon))) {
    return `${Number(station.location.lat).toFixed(3)}, ${Number(station.location.lon).toFixed(3)}`;
  }
  if (typeof station?.coordinates === 'string' && station.coordinates.trim()) {
    return station.coordinates.replace(/\s*\n\s*/g, ', ');
  }
  return '-';
}

function sortByFrequency(stations) {
  return [...stations].sort((a, b) => {
    const aFreq = Number.parseFloat(a.frequency);
    const bFreq = Number.parseFloat(b.frequency);
    if (Number.isFinite(aFreq) && Number.isFinite(bFreq) && aFreq !== bFreq) {
      return aFreq - bFreq;
    }
    return String(a.id).localeCompare(String(b.id));
  });
}

function StationsListPanel({ stations, onClose, onSelectStation, onReturnToRadio, activeStationId, showClose = false }) {
  const [expandedId, setExpandedId] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const orderedStations = useMemo(() => sortByFrequency(Array.isArray(stations) ? stations : []), [stations]);

  function handleRowKeyDown(event, station) {
    const isEnter = event.key === 'Enter';
    const isSpace =
      event.code === 'Space' ||
      event.key === ' ' ||
      event.key === 'Space' ||
      event.key === 'Spacebar';

    if (!isEnter && !isSpace) {
      return;
    }
    event.preventDefault();
    onSelectStation?.(station);
  }

  return (
    <section className="all-stations-panel-content">
      <header className="tune-head all-stations-head">
        <p>All Stations</p>
        {showClose ? (
          <button type="button" className="stations-close" onClick={onClose}>
            close
          </button>
        ) : (
          <a href="/" className="back-to-radio-link" onClick={onReturnToRadio}>
            back to radio
          </a>
        )}
      </header>

      <section className="stations-list-head">
        <div className="stations-list-meta">
          <p className="stations-count">{orderedStations.length} stations</p>
          <div className="stations-view-toggle" role="tablist" aria-label="All stations view mode">
            <button
              type="button"
              className={viewMode === 'list' ? 'stations-view-button stations-view-button-active' : 'stations-view-button'}
              onClick={() => setViewMode('list')}
            >
              list
            </button>
            <button
              type="button"
              className={viewMode === 'map' ? 'stations-view-button stations-view-button-active' : 'stations-view-button'}
              onClick={() => setViewMode('map')}
            >
              map
            </button>
          </div>
        </div>
        {viewMode === 'list' ? (
          <table className="stations-table stations-table-head" aria-hidden="true">
            <colgroup>
              <col className="col-art" />
              <col className="col-meta" />
              <col className="col-freq" />
              <col className="col-info" />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="Artwork" />
                <th>Host / Title</th>
                <th>MHz</th>
                <th>Info</th>
              </tr>
            </thead>
          </table>
        ) : null}
      </section>

      <section className={viewMode === 'map' ? 'stations-table-wrap stations-table-wrap-map' : 'stations-table-wrap'}>
        {viewMode === 'list' ? (
          <table className="stations-table">
            <colgroup>
              <col className="col-art" />
              <col className="col-meta" />
              <col className="col-freq" />
              <col className="col-info" />
            </colgroup>
            <tbody>
              {orderedStations.map((station, index) => {
                const expanded = expandedId === station.id;
                const stationTags = normalizeStationTags(station?.tags);
                const displayFreq = Number.parseFloat(station.frequency);
                const readableFreq = Number.isFinite(displayFreq) ? displayFreq.toFixed(2) : station.frequency;
                const stationBpm = Number.parseFloat(station?.bpm);
                const stationBpmLabel = Number.isFinite(stationBpm) ? Math.round(stationBpm) : '-';
                return (
                  <Fragment key={station.id || index}>
                    <tr
                      className={station.id === activeStationId ? 'station-row station-row-active' : 'station-row'}
                      role="button"
                      tabIndex={0}
                      aria-label={`Tune ${readableFreq} megahertz: ${station.title}`}
                      onClick={() => onSelectStation?.(station)}
                      onKeyDown={(event) => handleRowKeyDown(event, station)}
                    >
                      <td>
                        <img src={station.art} alt="" className="station-thumb" loading="lazy" />
                      </td>
                      <td>
                        <p className="station-host">{station.host || 'TBC'}</p>
                        <p className="station-title">{station.title}</p>
                      </td>
                      <td className="station-freq">{readableFreq}</td>
                      <td>
                        <button
                          type="button"
                          className="station-expand"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedId(expanded ? null : station.id);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {expanded ? 'hide' : 'more'}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="station-meta-row">
                        <td colSpan={4}>
                          <p>ID: {station.id}</p>
                          <p>Signal: {station.signal ?? 3}</p>
                          <p>BPM: {stationBpmLabel}</p>
                          <p>Location: {locationLabel(station)}</p>
                          <p>Tags: {stationTags.length ? stationTags.join(', ') : '-'}</p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              <tr className="station-cta-row">
                <td colSpan={4}>
                  <a href="/tune-station" className="station-add-cta">
                    tune new station
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Suspense
            fallback={
              <div className="stations-globe-wrap">
                <p className="stations-globe-empty">Loading map</p>
              </div>
            }
          >
            <StationsGlobe stations={orderedStations} activeStationId={activeStationId} onSelectStation={onSelectStation} />
          </Suspense>
        )}
      </section>
    </section>
  );
}

export default StationsListPanel;
