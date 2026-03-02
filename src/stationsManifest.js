import { normalizeStationTags } from './stationTags.js';

export function normalizeManifestStations(manifestStations) {
  if (!Array.isArray(manifestStations)) {
    return null;
  }

  const merged = manifestStations
    .map((station) => ({
      ...station,
      tags: normalizeStationTags(station?.tags)
    }))
    .filter((station) => station.id && station.track && station.art && station.frequency && station.title)
    .sort((a, b) => {
      const aFreq = Number.parseFloat(a.frequency);
      const bFreq = Number.parseFloat(b.frequency);
      if (Number.isFinite(aFreq) && Number.isFinite(bFreq) && aFreq !== bFreq) {
        return aFreq - bFreq;
      }
      return String(a.id).localeCompare(String(b.id));
    });

  return merged.length > 0 ? merged : null;
}

export function hasLiveAssetChange(prevStation, nextStation) {
  if (!prevStation || !nextStation) {
    return false;
  }

  return prevStation.track !== nextStation.track || prevStation.art !== nextStation.art;
}

export function findStationIndexByFrequency(stationList, targetFrequencyString) {
  if (!targetFrequencyString || !Array.isArray(stationList) || stationList.length === 0) {
    return -1;
  }

  return stationList.findIndex((station) => {
    const parsed = Number.parseFloat(station.frequency);
    if (!Number.isFinite(parsed)) {
      return false;
    }
    return parsed.toFixed(2) === targetFrequencyString;
  });
}
