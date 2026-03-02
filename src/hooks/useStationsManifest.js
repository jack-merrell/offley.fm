import { useEffect, useRef } from 'react';
import {
  findStationIndexByFrequency,
  hasLiveAssetChange,
  normalizeManifestStations
} from '../stationsManifest';

export default function useStationsManifest({
  pollMs,
  stationsRef,
  activeIndexRef,
  isUntunedRef,
  pendingInitialHashFrequencyRef,
  setStations,
  setActiveIndex,
  setIsManifestHydrated,
  tuneToStation
}) {
  const tuneToStationRef = useRef(tuneToStation);

  useEffect(() => {
    tuneToStationRef.current = tuneToStation;
  }, [tuneToStation]);

  useEffect(() => {
    let stopped = false;

    async function refreshManifest() {
      try {
        const response = await fetch(`/media/stations.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
          return;
        }

        const manifest = await response.json();
        const incomingStations = normalizeManifestStations(manifest.stations);
        if (!incomingStations || stopped) {
          return;
        }

        const currentStations = stationsRef.current;
        const currentActiveIndex = activeIndexRef.current;
        const currentActiveStation = isUntunedRef.current ? null : currentStations[currentActiveIndex];
        const pendingHashFrequency = pendingInitialHashFrequencyRef.current;

        if (pendingHashFrequency) {
          const hashedIndex = findStationIndexByFrequency(incomingStations, pendingHashFrequency);
          if (hashedIndex >= 0) {
            pendingInitialHashFrequencyRef.current = null;
            setStations(incomingStations);
            setIsManifestHydrated(true);
            void tuneToStationRef.current(hashedIndex, incomingStations);
            return;
          }
        }

        if (!currentActiveStation) {
          setStations(incomingStations);
          setIsManifestHydrated(true);
          return;
        }

        const currentFrequency = Number.parseFloat(currentActiveStation.frequency);
        const normalizedCurrentFrequency = Number.isFinite(currentFrequency) ? currentFrequency.toFixed(2) : null;
        const frequencyMatchIndex = normalizedCurrentFrequency
          ? findStationIndexByFrequency(incomingStations, normalizedCurrentFrequency)
          : -1;
        const nextActiveIndex =
          frequencyMatchIndex >= 0
            ? frequencyMatchIndex
            : incomingStations.findIndex((station) => station.id === currentActiveStation.id);
        const resolvedActiveIndex = nextActiveIndex >= 0 ? nextActiveIndex : 0;
        const nextActiveStation = incomingStations[resolvedActiveIndex];
        const changedWhileLive = hasLiveAssetChange(currentActiveStation, nextActiveStation);

        setStations(incomingStations);
        setIsManifestHydrated(true);
        if (resolvedActiveIndex !== currentActiveIndex) {
          setActiveIndex(resolvedActiveIndex);
        }

        if (changedWhileLive) {
          void tuneToStationRef.current(resolvedActiveIndex, incomingStations);
        }
      } catch (_error) {
        // Ignore polling errors to keep playback uninterrupted.
      }
    }

    void refreshManifest();
    const intervalId = window.setInterval(() => {
      void refreshManifest();
    }, pollMs);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [pollMs, stationsRef, activeIndexRef, isUntunedRef, pendingInitialHashFrequencyRef, setStations, setActiveIndex, setIsManifestHydrated]);
}

