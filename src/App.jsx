import { useEffect, useRef, useState } from 'react';
import StationsListPanel from './StationsListPanel';
import { normalizeStationTags } from './stationTags';
import { MUTE_STORAGE_KEY, RETURN_FROM_ALL_STATIONS_KEY } from './playbackStorage';
import UntunedStaticDisc from './UntunedStaticDisc';

const SECONDS_PER_DAY = 86400;
const MANIFEST_POLL_MS = 30000;
const FM_MIN = 87.5;
const FM_MAX = 108.0;
const FM_STEP = 0.1;
const DIAL_TICK_GAP = 7;
const EDGE_DOT_GAP = 13;
const EDGE_DOT_SIZE = 1;
const EDGE_RUN_PADDING = 8;
const LISTENER_HEARTBEAT_MS = 15000;
const LOCAL_API_BASE = 'http://localhost:8787';
const MOBILE_BREAKPOINT = 520;
const STATION_TRANSITION_MS = 660;
const STATION_TRANSITION_SWAP_MS = 360;
const CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const CAST_LOCALHOST_FALLBACK_BASE_URL = 'https://offley.fm';
const DIAL_TICKS = (() => {
  const ticks = [];
  for (let value = FM_MIN; value <= FM_MAX + 0.0001; value += FM_STEP) {
    const rounded = Number(value.toFixed(1));
    const major = Math.abs(rounded - Math.round(rounded)) < 0.0001;
    ticks.push({
      value: rounded,
      label: major ? String(Math.round(rounded)) : null
    });
  }
  return ticks;
})();
const EDGE_DOT_COUNT = 36;
const SIGNAL_BAR_COUNT = 4;
const EDGE_RUN_WIDTH =
  EDGE_DOT_COUNT * EDGE_DOT_SIZE +
  (EDGE_DOT_COUNT - 1) * EDGE_DOT_GAP +
  EDGE_RUN_PADDING * 2;
const UNTUNED_DIAL_OFFSET_PX = -510;

function utcSecondsToday() {
  const now = new Date();
  return now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
}

function syncedOffset(duration) {
  if (!duration || !Number.isFinite(duration)) {
    return 0;
  }

  const progress = utcSecondsToday() / SECONDS_PER_DAY;
  const loopsPerDay = SECONDS_PER_DAY / duration;
  const completedLoops = Math.floor(loopsPerDay * progress);
  return duration * (loopsPerDay * progress - completedLoops);
}

function circularDiff(a, b, duration) {
  const raw = Math.abs(a - b);
  return Math.min(raw, Math.abs(duration - raw));
}

function waitForMetadata(audioElement) {
  if (audioElement.readyState >= 1 && Number.isFinite(audioElement.duration)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      audioElement.removeEventListener('loadedmetadata', onReady);
      audioElement.removeEventListener('canplay', onReady);
      audioElement.removeEventListener('error', onError);
      window.clearTimeout(timeoutId);
    };

    const onReady = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const onError = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error('Unable to load track metadata.'));
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error('Track metadata timed out.'));
    }, 10000);

    audioElement.addEventListener('loadedmetadata', onReady, { once: true });
    audioElement.addEventListener('canplay', onReady, { once: true });
    audioElement.addEventListener('error', onError, { once: true });
  });
}

function clockLabel() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());
}

function normalizeManifestStations(manifestStations) {
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

function hasLiveAssetChange(prevStation, nextStation) {
  if (!prevStation || !nextStation) {
    return false;
  }

  return prevStation.track !== nextStation.track || prevStation.art !== nextStation.art;
}

function normalizeFrequencyHash(hashValue) {
  if (!hashValue) {
    return null;
  }
  const cleaned = hashValue
    .replace(/^#/, '')
    .trim()
    .replace(/mhz$/i, '')
    .trim();
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed.toFixed(2);
}

function findStationIndexByFrequency(stationList, targetFrequencyString) {
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

function normalizeSignalStrength(signalValue) {
  const parsed = Number.parseInt(signalValue, 10);
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.max(1, Math.min(SIGNAL_BAR_COUNT, parsed));
}

function stationHashFromFrequency(frequencyValue) {
  const parsed = Number.parseFloat(frequencyValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return `${parsed.toFixed(2)}MHz`;
}

function simplifyCoordinates(rawCoordinates) {
  const dmsPattern = /(\d+(?:\.\d+)?)°\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"?\s*([NSEW])/gi;

  if (rawCoordinates && typeof rawCoordinates === 'object') {
    const lat = Number.parseFloat(rawCoordinates.lat);
    const lon = Number.parseFloat(rawCoordinates.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
  }

  const source = String(rawCoordinates || '').trim();
  if (!source) {
    return '';
  }

  const matches = [...source.matchAll(dmsPattern)];

  if (matches.length >= 2) {
    const toDecimal = (degrees, minutes, seconds, hemisphere) => {
      const value =
        Number.parseFloat(degrees) +
        Number.parseFloat(minutes) / 60 +
        Number.parseFloat(seconds) / 3600;
      const signed = hemisphere === 'S' || hemisphere === 'W' ? -value : value;
      return signed;
    };

    const lat = toDecimal(matches[0][1], matches[0][2], matches[0][3], matches[0][4].toUpperCase());
    const lon = toDecimal(matches[1][1], matches[1][2], matches[1][3], matches[1][4].toUpperCase());

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
  }

  return source.replace(/\s*\n\s*/g, ', ');
}

function setSafeMediaSessionAction(action, handler) {
  if (!('mediaSession' in navigator)) {
    return;
  }
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch (_error) {
    // Some action types are not supported on all platforms.
  }
}

async function postListenerHeartbeat(payload) {
  const endpoints = [];
  if (window.location.hostname === 'localhost') {
    endpoints.push(`${LOCAL_API_BASE}/api/listeners/heartbeat`);
  }
  endpoints.push('/api/listeners/heartbeat');

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 404) {
          lastError = new Error('Listener endpoint not found');
          continue;
        }
        throw new Error(`Listener heartbeat failed (${response.status})`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Listener heartbeat failed');
}

function isIdLikeTitle(station) {
  if (!station) {
    return true;
  }
  const title = String(station.title ?? '').trim().toLowerCase();
  const id = String(station.id ?? '').trim().toLowerCase();
  return !title || title === id;
}

function getStationRotationDeg(station) {
  const explicit = Number.parseFloat(station?.rotation);
  if (Number.isFinite(explicit)) {
    return ((explicit % 360) + 360) % 360;
  }

  const seedSource = `${station?.id ?? ''}:${station?.frequency ?? ''}`;
  let hash = 0;
  for (let i = 0; i < seedSource.length; i += 1) {
    hash = (hash * 31 + seedSource.charCodeAt(i)) % 3600;
  }
  return hash / 10;
}

function fallbackStationDurationMs(station) {
  const source = `${station?.id ?? ''}:${station?.track ?? ''}:${station?.frequency ?? ''}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 33 + source.charCodeAt(i)) % 900000;
  }
  return 180000 + hash;
}

function getStationCoreCode(station, durationMsById) {
  const durationMs = durationMsById?.[station.id] ?? fallbackStationDurationMs(station);
  const rotationCode = Math.round(getStationRotationDeg(station) * 10);
  return {
    durationCode: String(durationMs).padStart(6, '0'),
    rotationCode: String(rotationCode).padStart(4, '0')
  };
}

function resolveSlideDirection(fromIndex, toIndex, totalStations) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || totalStations <= 1 || fromIndex === toIndex) {
    return 'right';
  }
  const forward = (toIndex - fromIndex + totalStations) % totalStations;
  const backward = (fromIndex - toIndex + totalStations) % totalStations;
  return forward <= backward ? 'right' : 'left';
}

function App() {
  const audioRef = useRef(null);
  const liveTagButtonRef = useRef(null);
  const stationsDrawerRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const transitionSwapTimerRef = useRef(null);
  const frequencyRafRef = useRef(null);
  const handBounceStartTimerRef = useRef(null);
  const handBounceStopTimerRef = useRef(null);
  const discWakeTimerRef = useRef(null);
  const untunedStaticContextRef = useRef(null);
  const untunedStaticSourceRef = useRef(null);
  const untunedStaticGainRef = useRef(null);
  const untunedStaticHighPassRef = useRef(null);
  const untunedStaticLowPassRef = useRef(null);
  const untunedStaticRequestRef = useRef(0);
  const castContextRef = useRef(null);
  const castSessionRef = useRef(null);
  const castSessionStateHandlerRef = useRef(null);
  const castLoadedStationKeyRef = useRef('');
  const castLoadedMutedRef = useRef(null);
  const isCastingRef = useRef(false);
  const dialDriftWrapRef = useRef(null);
  const dialDriftRafRef = useRef(null);
  const dialDriftPxRef = useRef(0);
  const dialStripRef = useRef(null);
  const dialDragRef = useRef({
    pointerId: null,
    startX: 0,
    startOffset: 0,
    startDrift: 0
  });
  const [stations, setStations] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isUntuned, setIsUntuned] = useState(() => normalizeFrequencyHash(window.location.hash) === null);
  const [isMuted, setMuted] = useState(() => {
    const shouldRestore = window.sessionStorage.getItem(RETURN_FROM_ALL_STATIONS_KEY) === '1';
    if (shouldRestore) {
      window.sessionStorage.removeItem(RETURN_FROM_ALL_STATIONS_KEY);
      const raw = window.localStorage.getItem(MUTE_STORAGE_KEY);
      if (raw === '0') {
        return false;
      }
      if (raw === '1') {
        return true;
      }
    }
    return true;
  });
  const [clock, setClock] = useState(clockLabel());
  const [isSwitchingStation, setIsSwitchingStation] = useState(false);
  const [previousStation, setPreviousStation] = useState(null);
  const [isDialDragging, setIsDialDragging] = useState(false);
  const [isDialSnapEasing, setIsDialSnapEasing] = useState(false);
  const [isHandBouncing, setIsHandBouncing] = useState(false);
  const [isDiscWaking, setIsDiscWaking] = useState(false);
  const [stationSlideDirection, setStationSlideDirection] = useState('right');
  const [hasTransitionArtworkSwapped, setHasTransitionArtworkSwapped] = useState(true);
  const [displayFrequency, setDisplayFrequency] = useState(FM_MIN);
  const [signalDirection, setSignalDirection] = useState('steady');
  const [isManifestHydrated, setIsManifestHydrated] = useState(false);
  const [durationMsById, setDurationMsById] = useState({});
  const [listenerCount, setListenerCount] = useState(1);
  const [shareStatus, setShareStatus] = useState('');
  const [isStationsPanelOpen, setIsStationsPanelOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches);
  const [isCastSupported, setIsCastSupported] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const initialHashFrequencyRef = useRef(normalizeFrequencyHash(window.location.hash));
  const pendingInitialHashFrequencyRef = useRef(normalizeFrequencyHash(window.location.hash));
  const hasBootstrappedStationRef = useRef(false);
  const hasSeenStationChangeRef = useRef(false);
  const previousSignalRef = useRef(3);
  const listenerClientIdRef = useRef('');
  const isMutedRef = useRef(isMuted);
  const isUntunedRef = useRef(isUntuned);

  const stationsRef = useRef(stations);
  const activeIndexRef = useRef(activeIndex);

  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isUntunedRef.current = isUntuned;
  }, [isUntuned]);

  useEffect(() => {
    isCastingRef.current = isCasting;
  }, [isCasting]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current);
      }
      if (transitionSwapTimerRef.current) {
        window.clearTimeout(transitionSwapTimerRef.current);
      }
      if (frequencyRafRef.current) {
        window.cancelAnimationFrame(frequencyRafRef.current);
      }
      if (handBounceStartTimerRef.current) {
        window.clearTimeout(handBounceStartTimerRef.current);
      }
      if (handBounceStopTimerRef.current) {
        window.clearTimeout(handBounceStopTimerRef.current);
      }
      if (discWakeTimerRef.current) {
        window.clearTimeout(discWakeTimerRef.current);
      }
      if (dialDriftRafRef.current) {
        window.cancelAnimationFrame(dialDriftRafRef.current);
      }
      stopUntunedStatic();
      if (untunedStaticContextRef.current) {
        void untunedStaticContextRef.current.close().catch(() => {
          // Ignore close errors.
        });
      }
      untunedStaticContextRef.current = null;
    };
  }, []);

  function stopUntunedStatic() {
    untunedStaticRequestRef.current += 1;

    const source = untunedStaticSourceRef.current;
    if (source) {
      try {
        source.stop();
      } catch (_error) {
        // Source can already be stopped.
      }
      try {
        source.disconnect();
      } catch (_error) {
        // No-op.
      }
    }
    untunedStaticSourceRef.current = null;

    try {
      untunedStaticHighPassRef.current?.disconnect();
    } catch (_error) {
      // No-op.
    }
    try {
      untunedStaticLowPassRef.current?.disconnect();
    } catch (_error) {
      // No-op.
    }
    try {
      untunedStaticGainRef.current?.disconnect();
    } catch (_error) {
      // No-op.
    }

    untunedStaticHighPassRef.current = null;
    untunedStaticLowPassRef.current = null;
    untunedStaticGainRef.current = null;
  }

  function setUntunedState(nextUntuned) {
    isUntunedRef.current = nextUntuned;
    setIsUntuned(nextUntuned);
  }

  async function startUntunedStatic() {
    if (untunedStaticSourceRef.current) {
      return;
    }

    const requestId = untunedStaticRequestRef.current + 1;
    untunedStaticRequestRef.current = requestId;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    let context = untunedStaticContextRef.current;
    if (!context) {
      context = new AudioContextCtor();
      untunedStaticContextRef.current = context;
    }

    if (context.state !== 'running') {
      try {
        await context.resume();
      } catch (_error) {
        return;
      }
    }

    if (requestId !== untunedStaticRequestRef.current || !isUntunedRef.current || isMutedRef.current) {
      return;
    }

    const durationSeconds = 2;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * durationSeconds), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 900;
    highPass.Q.value = 0.65;

    const lowPass = context.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 7000;
    lowPass.Q.value = 0.72;

    const gain = context.createGain();
    gain.gain.value = 0.0001;

    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(gain);
    gain.connect(context.destination);

    if (requestId !== untunedStaticRequestRef.current || !isUntunedRef.current || isMutedRef.current) {
      return;
    }

    source.start();
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.015, now + 0.14);

    untunedStaticSourceRef.current = source;
    untunedStaticHighPassRef.current = highPass;
    untunedStaticLowPassRef.current = lowPass;
    untunedStaticGainRef.current = gain;
  }

  const hasStations = stations.length > 0;
  const activeStation = isUntuned ? null : stations[activeIndex] || null;
  const isLive = true;
  const activeFrequency = Number.parseFloat(activeStation?.frequency);
  const activeSignalStrength = isUntuned ? 3 : normalizeSignalStrength(activeStation?.signal);
  const clampedFrequency = Math.min(FM_MAX, Math.max(FM_MIN, Number.isFinite(activeFrequency) ? activeFrequency : FM_MIN));
  const activeStationHash = isUntuned ? null : stationHashFromFrequency(activeStation?.frequency);
  const listenerLabel = isUntuned ? '0 Listening' : `${listenerCount} Listening`;
  const activeTickIndex = Number.isFinite(activeFrequency) ? Math.round((clampedFrequency - FM_MIN) / FM_STEP) : null;
  const untunedFocusTick = (-UNTUNED_DIAL_OFFSET_PX - EDGE_RUN_WIDTH) / DIAL_TICK_GAP;
  const dialFocusTickIndex = Number.isInteger(activeTickIndex) ? activeTickIndex : untunedFocusTick;
  const dialTranslatePx = dialFocusTickIndex * DIAL_TICK_GAP;
  const dialBaseOffsetPx = isUntuned ? UNTUNED_DIAL_OFFSET_PX : -EDGE_RUN_WIDTH - dialTranslatePx;
  const activeCoordinates = activeStation?.location || activeStation?.coordinates || null;
  const simplifiedCoordinates = activeCoordinates ? simplifyCoordinates(activeCoordinates) : '-';
  const titleForDisplay = isUntuned
    ? ''
    : activeStation
      ? !isManifestHydrated && isIdLikeTitle(activeStation)
        ? ''
        : activeStation.title
      : '';
  const activeCoreCode = activeStation ? getStationCoreCode(activeStation, durationMsById) : { durationCode: '000000', rotationCode: '0000' };
  const activeHost = activeStation?.host || '---';
  const activeRotation = activeStation ? getStationRotationDeg(activeStation) : 0;
  const activeTags = normalizeStationTags(activeStation?.tags);
  const activeBpm = Number.parseFloat(activeStation?.bpm);
  const activeBpmTag = Number.isFinite(activeBpm) ? `BPM:${Math.round(activeBpm)}` : null;
  const activeTagsWithBpm = activeBpmTag ? [...activeTags, activeBpmTag] : activeTags;
  const discMotionClass = isSwitchingStation
    ? stationSlideDirection === 'right'
      ? 'disc-motion disc-motion-right'
      : 'disc-motion disc-motion-left'
    : 'disc-motion';
  const stationTickMeta = stations
    .map((station, index) => {
      const freq = Number.parseFloat(station.frequency);
      if (!Number.isFinite(freq)) {
        return null;
      }
      const tickIndex = Math.round((freq - FM_MIN) / FM_STEP);
      return { stationIndex: index, tickIndex };
    })
    .filter(Boolean);
  const activeStationKey = activeStationHash || activeStation?.id || '';
  const castUnsupportedReason = !window.isSecureContext ? 'Cast requires HTTPS or localhost.' : 'Cast is unavailable in this browser.';

  function getCastMediaBaseUrl() {
    const configured = String(import.meta.env.VITE_CAST_MEDIA_BASE_URL || '').trim();
    if (configured) {
      return configured;
    }
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return CAST_LOCALHOST_FALLBACK_BASE_URL;
    }
    return window.location.origin;
  }

  function resolveCastAssetUrl(assetPath) {
    if (!assetPath) {
      return '';
    }
    try {
      return new URL(assetPath, getCastMediaBaseUrl()).href;
    } catch (_error) {
      return '';
    }
  }

  function getCastSdk() {
    const castFramework = window.cast?.framework;
    const chromeCast = window.chrome?.cast;
    if (!castFramework || !chromeCast?.media) {
      return null;
    }
    return { castFramework, chromeCast };
  }

  async function setCastPlaybackMuted(nextMuted) {
    const sdk = getCastSdk();
    const session = castSessionRef.current;
    if (!sdk || !session) {
      return;
    }

    const mediaSession = session.getMediaSession?.();
    if (!mediaSession) {
      return;
    }

    await new Promise((resolve, reject) => {
      const onSuccess = () => resolve();
      const onError = () => reject(new Error('Cast playback command failed.'));
      if (nextMuted) {
        const request = new sdk.chromeCast.media.PauseRequest();
        mediaSession.pause(request, onSuccess, onError);
      } else {
        const request = new sdk.chromeCast.media.PlayRequest();
        mediaSession.play(request, onSuccess, onError);
      }
    });
  }

  async function loadCastStationMedia(station, muted) {
    const sdk = getCastSdk();
    const session = castSessionRef.current;
    if (!sdk || !session || !station?.track) {
      return;
    }

    const mediaUrl = resolveCastAssetUrl(station.track);
    if (!mediaUrl) {
      throw new Error('Missing cast media URL.');
    }
    const mediaInfo = new sdk.chromeCast.media.MediaInfo(mediaUrl, 'audio/mpeg');
    mediaInfo.streamType = sdk.chromeCast.media.StreamType.BUFFERED;

    const metadata = new sdk.chromeCast.media.MusicTrackMediaMetadata();
    metadata.title = station.title || 'offley.fm';
    metadata.artist = station.host ? `Host: ${station.host}` : 'offley.fm';
    metadata.albumName = Number.isFinite(Number.parseFloat(station.frequency))
      ? `${Number.parseFloat(station.frequency).toFixed(2)} MHz`
      : 'offley.fm';
    if (station.art) {
      const artworkUrl = resolveCastAssetUrl(station.art);
      if (artworkUrl) {
        metadata.images = [new sdk.chromeCast.Image(artworkUrl)];
      }
    }
    mediaInfo.metadata = metadata;

    const request = new sdk.chromeCast.media.LoadRequest(mediaInfo);
    request.autoplay = !muted;

    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      request.currentTime = syncedOffset(audio.duration);
    } else {
      request.currentTime = 0;
    }

    await session.loadMedia(request);
    if (!muted) {
      await setCastPlaybackMuted(false);
    }
  }

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = () => setIsMobileViewport(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (isMobileViewport && isStationsPanelOpen) {
      setIsStationsPanelOpen(false);
    }
  }, [isMobileViewport, isStationsPanelOpen]);

  useEffect(() => {
    let cancelled = false;

    const initCast = () => {
      if (cancelled) {
        return;
      }
      const sdk = getCastSdk();
      if (!sdk) {
        return;
      }

      setIsCastSupported(true);
      const castContext = sdk.castFramework.CastContext.getInstance();
      castContextRef.current = castContext;
      castContext.setOptions({
        receiverApplicationId: sdk.chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: sdk.chromeCast.AutoJoinPolicy.ORIGIN_SCOPED
      });
      castSessionRef.current = castContext.getCurrentSession?.() || null;
      setIsCasting(Boolean(castSessionRef.current));

      const existingSessionStateHandler = castSessionStateHandlerRef.current;
      if (existingSessionStateHandler) {
        castContext.removeEventListener(sdk.castFramework.CastContextEventType.SESSION_STATE_CHANGED, existingSessionStateHandler);
        castSessionStateHandlerRef.current = null;
      }

      const onSessionStateChanged = (event) => {
        const started =
          event.sessionState === sdk.castFramework.SessionState.SESSION_STARTED ||
          event.sessionState === sdk.castFramework.SessionState.SESSION_RESUMED;

        if (started) {
          castSessionRef.current = castContext.getCurrentSession();
          setIsCasting(true);
          stopUntunedStatic();
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.muted = true;
          }
          return;
        }

        const ended =
          event.sessionState === sdk.castFramework.SessionState.SESSION_ENDED ||
          event.sessionState === sdk.castFramework.SessionState.SESSION_START_FAILED;

        if (ended) {
          castSessionRef.current = null;
          castLoadedStationKeyRef.current = '';
          castLoadedMutedRef.current = null;
          setIsCasting(false);
          const audio = audioRef.current;
          if (audio) {
            audio.muted = isMutedRef.current;
            if (!isMutedRef.current && !isUntunedRef.current) {
              void audio.play().catch(() => {
                // Playback can remain blocked until next interaction.
              });
            }
          }
        }
      };

      castSessionStateHandlerRef.current = onSessionStateChanged;
      castContext.addEventListener(sdk.castFramework.CastContextEventType.SESSION_STATE_CHANGED, onSessionStateChanged);
    };

    const previousCastApiHandler = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable) => {
      if (typeof previousCastApiHandler === 'function') {
        previousCastApiHandler(isAvailable);
      }
      if (isAvailable) {
        initCast();
      }
    };

    if (getCastSdk()) {
      initCast();
    } else {
      const sdkScript = document.querySelector(`script[src="${CAST_SDK_URL}"]`);
      if (!sdkScript) {
        const newScript = document.createElement('script');
        newScript.src = CAST_SDK_URL;
        newScript.async = true;
        document.head.appendChild(newScript);
      }
    }

    return () => {
      cancelled = true;
      if (typeof previousCastApiHandler === 'function') {
        window.__onGCastApiAvailable = previousCastApiHandler;
      } else {
        delete window.__onGCastApiAvailable;
      }
      const castContext = castContextRef.current;
      const sessionStateHandler = castSessionStateHandlerRef.current;
      if (castContext && sessionStateHandler) {
        const sdk = getCastSdk();
        if (sdk) {
          castContext.removeEventListener(sdk.castFramework.CastContextEventType.SESSION_STATE_CHANGED, sessionStateHandler);
        }
        castSessionStateHandlerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isCasting) {
      castLoadedStationKeyRef.current = '';
      castLoadedMutedRef.current = null;
      return;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.muted = true;
    }

    let cancelled = false;
    async function syncCast() {
      if (isUntuned || !activeStation) {
        return;
      }

      try {
        if (castLoadedStationKeyRef.current !== activeStationKey) {
          await loadCastStationMedia(activeStation, isMuted);
          if (cancelled) {
            return;
          }
          castLoadedStationKeyRef.current = activeStationKey;
          castLoadedMutedRef.current = isMuted;
          return;
        }

        if (castLoadedMutedRef.current !== isMuted) {
          await setCastPlaybackMuted(isMuted);
          if (cancelled) {
            return;
          }
          castLoadedMutedRef.current = isMuted;
        }
      } catch (_error) {
        // Keep local player state stable if cast command fails.
      }
    }

    void syncCast();
    return () => {
      cancelled = true;
    };
  }, [isCasting, isUntuned, activeStation, activeStationKey, isMuted]);

  useEffect(() => {
    const previousSignal = previousSignalRef.current;
    if (activeSignalStrength > previousSignal) {
      setSignalDirection('up');
    } else if (activeSignalStrength < previousSignal) {
      setSignalDirection('down');
    } else {
      setSignalDirection('steady');
    }
    previousSignalRef.current = activeSignalStrength;
  }, [activeSignalStrength]);

  useEffect(() => {
    if (!Number.isFinite(activeFrequency)) {
      return;
    }

    if (frequencyRafRef.current) {
      window.cancelAnimationFrame(frequencyRafRef.current);
    }

    const startValue = Number.isFinite(displayFrequency) ? displayFrequency : activeFrequency;
    const endValue = activeFrequency;
    const durationMs = 780;
    const startedAt = performance.now();

    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const tick = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeOut(progress);
      const value = startValue + (endValue - startValue) * eased;
      setDisplayFrequency(value);
      if (progress < 1) {
        frequencyRafRef.current = window.requestAnimationFrame(tick);
      } else {
        frequencyRafRef.current = null;
        setDisplayFrequency(endValue);
      }
    };

    frequencyRafRef.current = window.requestAnimationFrame(tick);
  }, [activeFrequency]);

  useEffect(() => {
    const strip = dialStripRef.current;
    if (!strip || isDialDragging) {
      return;
    }
    strip.style.transform = `translateX(${dialBaseOffsetPx}px)`;
  }, [dialBaseOffsetPx, isDialDragging]);

  useEffect(() => {
    const driftWrap = dialDriftWrapRef.current;
    if (!driftWrap) {
      return;
    }

    if (dialDriftRafRef.current) {
      window.cancelAnimationFrame(dialDriftRafRef.current);
      dialDriftRafRef.current = null;
    }

    if (!isUntuned) {
      dialDriftPxRef.current = 0;
      driftWrap.style.transform = 'translateX(0px)';
      return;
    }

    if (isDialDragging) {
      driftWrap.style.transform = `translateX(${dialDriftPxRef.current.toFixed(2)}px)`;
      return;
    }

    const amplitudePx = 10;
    const cycleMs = 16000;
    const startedAt = performance.now();
    let active = true;

    const animate = (now) => {
      if (!active) {
        return;
      }
      const elapsed = now - startedAt;
      const phase = (elapsed / cycleMs) * Math.PI * 2;
      const drift = Math.sin(phase) * amplitudePx;
      dialDriftPxRef.current = drift;
      driftWrap.style.transform = `translateX(${drift.toFixed(2)}px)`;
      dialDriftRafRef.current = window.requestAnimationFrame(animate);
    };

    dialDriftRafRef.current = window.requestAnimationFrame(animate);

    return () => {
      active = false;
      if (dialDriftRafRef.current) {
        window.cancelAnimationFrame(dialDriftRafRef.current);
        dialDriftRafRef.current = null;
      }
    };
  }, [isUntuned, isDialDragging]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(clockLabel()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!shareStatus) {
      return;
    }
    const timer = window.setTimeout(() => setShareStatus(''), 1500);
    return () => window.clearTimeout(timer);
  }, [shareStatus]);

  useEffect(() => {
    if (!activeStationHash) {
      return;
    }

    const getClientId = () => {
      if (listenerClientIdRef.current) {
        return listenerClientIdRef.current;
      }
      const storageKey = 'offley_listener_id';
      const fromStorage = window.localStorage.getItem(storageKey);
      if (fromStorage) {
        listenerClientIdRef.current = fromStorage;
        return fromStorage;
      }
      const nextId =
        typeof window.crypto?.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      window.localStorage.setItem(storageKey, nextId);
      listenerClientIdRef.current = nextId;
      return nextId;
    };

    let cancelled = false;

    const sendHeartbeat = async () => {
      try {
        const data = await postListenerHeartbeat({
          station: activeStationHash,
          clientId: getClientId()
        });
        const nextCount = Number.parseInt(data.listeners, 10);
        if (!cancelled && Number.isFinite(nextCount)) {
          setListenerCount(Math.max(1, nextCount + 1));
        }
      } catch (_error) {
        if (!cancelled) {
          setListenerCount(1);
        }
      }
    };

    void sendHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, LISTENER_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeStationHash]);

  useEffect(() => {
    let cancelled = false;
    const pending = [];

    for (const station of stations) {
      if (!station?.id || !station?.track || durationMsById[station.id]) {
        continue;
      }

      const probe = new Audio();
      probe.preload = 'metadata';
      probe.src = station.track;

      const onLoaded = () => {
        if (cancelled || !Number.isFinite(probe.duration)) {
          return;
        }
        const durationMs = Math.max(1, Math.round(probe.duration * 1000));
        setDurationMsById((prev) => {
          if (prev[station.id]) {
            return prev;
          }
          return { ...prev, [station.id]: durationMs };
        });
      };

      probe.addEventListener('loadedmetadata', onLoaded, { once: true });
      probe.load();
      pending.push(probe);
    }

    return () => {
      cancelled = true;
      for (const probe of pending) {
        probe.src = '';
      }
    };
  }, [stations, durationMsById]);

  useEffect(() => {
    const fallbackTimer = window.setTimeout(() => {
      setIsManifestHydrated(true);
    }, 1800);
    return () => window.clearTimeout(fallbackTimer);
  }, []);

  useEffect(() => {
    if (isUntuned) {
      return;
    }
    if (!hasSeenStationChangeRef.current) {
      hasSeenStationChangeRef.current = true;
      return;
    }

    if (handBounceStartTimerRef.current) {
      window.clearTimeout(handBounceStartTimerRef.current);
    }
    if (handBounceStopTimerRef.current) {
      window.clearTimeout(handBounceStopTimerRef.current);
    }

    setIsHandBouncing(false);
    handBounceStartTimerRef.current = window.setTimeout(() => {
      setIsHandBouncing(true);
      handBounceStopTimerRef.current = window.setTimeout(() => {
        setIsHandBouncing(false);
      }, 480);
    }, 0);
  }, [activeIndex, isUntuned]);

  useEffect(() => {
    if (!hasBootstrappedStationRef.current) {
      return;
    }
    if (isUntuned) {
      return;
    }
    const station = stations[activeIndex];
    if (!station) {
      return;
    }
    const parsed = Number.parseFloat(station.frequency);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const nextHash = `#${parsed.toFixed(2)}MHz`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [stations, activeIndex, isUntuned]);

  useEffect(() => {
    if (!isLive || isUntuned) {
      return undefined;
    }

    const resyncTimer = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
      }

      const expected = syncedOffset(audio.duration);
      const drift = circularDiff(expected, audio.currentTime, audio.duration);
      if (drift > 0.9) {
        audio.currentTime = expected;
      }
    }, 30000);

    return () => window.clearInterval(resyncTimer);
  }, [isLive, activeIndex, isUntuned]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return undefined;
    }

    const session = navigator.mediaSession;
    const metadataArtwork = [];
    if (activeStation?.art) {
      metadataArtwork.push({ src: activeStation.art });
    }
    metadataArtwork.push({ src: '/media/assets/favicon.png' });

    if ('MediaMetadata' in window) {
      session.metadata = new MediaMetadata({
        title: isUntuned ? 'Scanning' : activeStation?.title || 'offley.fm',
        artist: isUntuned ? 'offley.fm' : activeStation?.host ? `Host: ${activeStation.host}` : 'offley.fm',
        album: isUntuned
          ? 'Untuned FM'
          : Number.isFinite(activeFrequency)
            ? `${activeFrequency.toFixed(2)} MHz`
            : 'Live radio',
        artwork: metadataArtwork
      });
    }

    session.playbackState = isMuted ? 'paused' : 'playing';

    setSafeMediaSessionAction('play', () => {
      if (isMutedRef.current) {
        toggleMute();
      }
    });
    setSafeMediaSessionAction('pause', () => {
      if (!isMutedRef.current) {
        toggleMute();
      }
    });
    setSafeMediaSessionAction('nexttrack', () => {
      if (stationsRef.current.length > 0) {
        scan(1);
      }
    });
    setSafeMediaSessionAction('previoustrack', () => {
      if (stationsRef.current.length > 0) {
        scan(-1);
      }
    });
    setSafeMediaSessionAction('seekforward', () => {
      if (stationsRef.current.length > 0) {
        scan(1);
      }
    });
    setSafeMediaSessionAction('seekbackward', () => {
      if (stationsRef.current.length > 0) {
        scan(-1);
      }
    });

    return () => {
      setSafeMediaSessionAction('play', null);
      setSafeMediaSessionAction('pause', null);
      setSafeMediaSessionAction('nexttrack', null);
      setSafeMediaSessionAction('previoustrack', null);
      setSafeMediaSessionAction('seekforward', null);
      setSafeMediaSessionAction('seekbackward', null);
    };
  }, [activeStation, activeFrequency, isMuted, isUntuned, activeIndex, stations.length]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || isUntuned) {
      return undefined;
    }

    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    const syncPosition = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
      }
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: audio.currentTime || 0
        });
      } catch (_error) {
        // Position state is not supported everywhere.
      }
    };

    syncPosition();
    audio.addEventListener('timeupdate', syncPosition);
    audio.addEventListener('durationchange', syncPosition);
    audio.addEventListener('ratechange', syncPosition);

    return () => {
      audio.removeEventListener('timeupdate', syncPosition);
      audio.removeEventListener('durationchange', syncPosition);
      audio.removeEventListener('ratechange', syncPosition);
    };
  }, [activeStationHash, isUntuned]);

  useEffect(() => {
    if (isUntuned && !isMuted) {
      void startUntunedStatic();
      return;
    }
    stopUntunedStatic();
  }, [isUntuned, isMuted]);

  useEffect(() => {
    window.localStorage.setItem(MUTE_STORAGE_KEY, isMuted ? '1' : '0');
  }, [isMuted]);

  useEffect(() => {
    if (discWakeTimerRef.current) {
      window.clearTimeout(discWakeTimerRef.current);
    }

    if (isMuted) {
      setIsDiscWaking(false);
      return;
    }

    setIsDiscWaking(true);
    discWakeTimerRef.current = window.setTimeout(() => {
      setIsDiscWaking(false);
    }, 520);
  }, [isMuted]);

  function beginStationTransition(fromStation, toStation, fromIndex, toIndex, totalStations) {
    if (!fromStation || !toStation) {
      return;
    }

    const changedVisual = fromStation.id !== toStation.id || fromStation.art !== toStation.art;
    if (!changedVisual) {
      return;
    }

    setStationSlideDirection(resolveSlideDirection(fromIndex, toIndex, totalStations));
    setPreviousStation(fromStation);
    setIsSwitchingStation(true);
    setHasTransitionArtworkSwapped(false);
    if (transitionSwapTimerRef.current) {
      window.clearTimeout(transitionSwapTimerRef.current);
    }
    transitionSwapTimerRef.current = window.setTimeout(() => {
      setHasTransitionArtworkSwapped(true);
    }, STATION_TRANSITION_SWAP_MS);
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
    transitionTimerRef.current = window.setTimeout(() => {
      setIsSwitchingStation(false);
      setPreviousStation(null);
      setHasTransitionArtworkSwapped(true);
    }, STATION_TRANSITION_MS);
  }

  async function tuneToStation(index, stationList = stationsRef.current) {
    const station = stationList[index];
    const audio = audioRef.current;
    const currentStation = isUntunedRef.current ? null : stationsRef.current[activeIndexRef.current];
    const currentIndex = activeIndexRef.current;

    if (!station) {
      return;
    }

    beginStationTransition(currentStation, station, currentIndex, index, stationList.length);
    stopUntunedStatic();
    setUntunedState(false);
    setActiveIndex(index);

    if (!audio) {
      return;
    }

    audio.pause();
    audio.src = station.track;
    audio.load();

    if (isCastingRef.current) {
      audio.muted = true;
      return;
    }

    try {
      await waitForMetadata(audio);
      audio.currentTime = syncedOffset(audio.duration);
      await audio.play();
    } catch (_error) {
      // Autoplay can fail after navigation. Keep UI/audio state in sync.
      if (!isMutedRef.current) {
        setMuted(true);
      }
    }
  }

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
            void tuneToStation(hashedIndex, incomingStations);
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
        const nextActiveIndex =
          findStationIndexByFrequency(incomingStations, normalizedCurrentFrequency) >= 0
            ? findStationIndexByFrequency(incomingStations, normalizedCurrentFrequency)
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
          void tuneToStation(resolvedActiveIndex, incomingStations);
        }
      } catch (_error) {
        // Ignore polling errors to keep playback uninterrupted.
      }
    }

    void refreshManifest();
    const intervalId = window.setInterval(() => {
      void refreshManifest();
    }, MANIFEST_POLL_MS);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (hasBootstrappedStationRef.current || stations.length === 0) {
      return;
    }
    const requestedIndex = findStationIndexByFrequency(stations, initialHashFrequencyRef.current);
    if (requestedIndex >= 0) {
      pendingInitialHashFrequencyRef.current = null;
      setUntunedState(false);
      hasBootstrappedStationRef.current = true;
      void tuneToStation(requestedIndex, stations);
      return;
    }
    hasBootstrappedStationRef.current = true;
    setUntunedState(true);
  }, [stations]);

  function scan(delta) {
    if (stations.length === 0) {
      return;
    }
    if (isUntuned) {
      const nextIndex = delta >= 0 ? 0 : stations.length - 1;
      void tuneToStation(nextIndex);
      return;
    }
    const nextIndex = (activeIndex + delta + stations.length) % stations.length;
    void tuneToStation(nextIndex);
  }

  function handleLiveTagClick() {
    if (isMobileViewport) {
      const hash = window.location.hash || '';
      window.location.href = `/all-stations${hash}`;
      return;
    }
    setIsStationsPanelOpen((prev) => {
      const nextOpen = !prev;
      if (!nextOpen) {
        window.requestAnimationFrame(() => {
          liveTagButtonRef.current?.focus();
        });
      }
      return nextOpen;
    });
  }

  function handleSelectStationFromPanel(station) {
    const selectedIndex = stations.findIndex((entry) => entry.id === station.id);
    if (selectedIndex >= 0) {
      void tuneToStation(selectedIndex);
    }
  }

  function closeStationsPanel() {
    setIsStationsPanelOpen(false);
    window.requestAnimationFrame(() => {
      liveTagButtonRef.current?.focus();
    });
  }

  useEffect(() => {
    if (isStationsPanelOpen) {
      return;
    }
    const drawer = stationsDrawerRef.current;
    if (!drawer) {
      return;
    }
    const active = document.activeElement;
    if (active && drawer.contains(active)) {
      liveTagButtonRef.current?.focus();
    }
  }, [isStationsPanelOpen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const isSpace =
        event.code === 'Space' ||
        event.key === ' ' ||
        event.key === 'Space' ||
        event.key === 'Spacebar';

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        scan(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        scan(1);
      } else if (isSpace) {
        event.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeIndex, stations, isUntuned]);

  function toggleMute() {
    const audio = audioRef.current;
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setMuted(nextMuted);

    if (audio) {
      if (isCastingRef.current && !isUntunedRef.current) {
        audio.pause();
        audio.muted = true;
        void setCastPlaybackMuted(nextMuted).catch(() => {
          // Keep mute state local if cast command fails.
        });
      } else {
        audio.muted = nextMuted;
        if (!nextMuted && audio.paused && !isUntunedRef.current) {
          void audio.play().catch(() => {
            // If play is still blocked, the next user interaction can retry.
          });
        }
      }
    }

    if (isUntunedRef.current) {
      if (nextMuted) {
        stopUntunedStatic();
      } else {
        void startUntunedStatic();
      }
    }
  }

  async function copyStationUrl() {
    if (isUntuned || !activeStationHash) {
      return;
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}#${activeStationHash}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus('Copied');
    } catch (_error) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setShareStatus('Copied');
      } catch (_fallbackError) {
        setShareStatus('Copy failed');
      }
    }
  }

  async function handleCastButtonClick() {
    const context = castContextRef.current;
    if (!context || !isCastSupported || isUntuned) {
      return;
    }

    if (isCastingRef.current) {
      try {
        await context.endCurrentSession(true);
      } catch (_error) {
        // Ignore failed disconnect attempts.
      }
      return;
    }

    try {
      await context.requestSession();
    } catch (_error) {
      // Request can be cancelled by user.
    }
  }

  function snapToNearestStation(targetTick) {
    if (stationTickMeta.length === 0) {
      return;
    }

    let nearest = stationTickMeta[0];
    let bestDistance = Math.abs(targetTick - nearest.tickIndex);

    for (const candidate of stationTickMeta) {
      const distance = Math.abs(targetTick - candidate.tickIndex);
      if (distance < bestDistance) {
        nearest = candidate;
        bestDistance = distance;
      }
    }

    void tuneToStation(nearest.stationIndex);
  }

  function handleDialPointerDown(event) {
    dialDragRef.current.pointerId = event.pointerId;
    dialDragRef.current.startX = event.clientX;
    dialDragRef.current.startOffset = dialBaseOffsetPx;
    dialDragRef.current.startDrift = dialDriftPxRef.current;
    setIsDialDragging(true);
    setIsDialSnapEasing(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDialPointerMove(event) {
    if (!isDialDragging || event.pointerId !== dialDragRef.current.pointerId) {
      return;
    }
    const strip = dialStripRef.current;
    if (!strip) {
      return;
    }
    const delta = event.clientX - dialDragRef.current.startX;
    strip.style.transform = `translateX(${dialDragRef.current.startOffset + delta}px)`;
  }

  function handleDialPointerEnd(event) {
    if (event.pointerId !== dialDragRef.current.pointerId) {
      return;
    }

    const delta = event.clientX - dialDragRef.current.startX;
    const targetTick = dialFocusTickIndex - (dialDragRef.current.startDrift + delta) / DIAL_TICK_GAP;

    setIsDialDragging(false);
    setIsDialSnapEasing(true);
    snapToNearestStation(targetTick);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer may already be released.
    }

    dialDragRef.current.pointerId = null;
  }

  return (
    <div className="app-shell">
      <div className="scanlines" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <main className={isStationsPanelOpen ? 'radio-stage radio-stage-panel-open' : 'radio-stage'}>
        <div className="radio-stack">
          <aside
            ref={stationsDrawerRef}
            className={isStationsPanelOpen ? 'stations-drawer stations-drawer-open' : 'stations-drawer'}
            aria-hidden={!isStationsPanelOpen}
          >
            <section className="all-stations-panel all-stations-embedded-panel">
              <StationsListPanel
                stations={stations}
                activeStationId={activeStation?.id}
                onSelectStation={handleSelectStationFromPanel}
                onClose={closeStationsPanel}
                showClose
              />
            </section>
          </aside>
          <section className="radio-panel">
          <header className="panel-head">
            <p className="panel-clock">{clock}</p>
            <div className="panel-head-tools">
              <div className={`signal-bars signal-bars-${signalDirection}`} aria-label={`Signal strength ${activeSignalStrength} of ${SIGNAL_BAR_COUNT}`}>
                {Array.from({ length: SIGNAL_BAR_COUNT }).map((_, index) => (
                  <span
                    key={`signal-${index}`}
                    className={index < activeSignalStrength ? 'signal-bar signal-bar-active' : 'signal-bar'}
                    aria-hidden="true"
                  />
                ))}
              </div>
              <button
                type="button"
                className={isCasting ? 'cast-button cast-button-active' : isCastSupported ? 'cast-button' : 'cast-button cast-button-disabled'}
                onClick={handleCastButtonClick}
                disabled={isUntuned || !isCastSupported}
                title={isCastSupported ? 'Cast to speaker' : castUnsupportedReason}
              >
                {isCasting ? 'casting' : 'cast'}
              </button>
            </div>
          </header>

          <section className="meta-block">
            <div className="meta-top">
              <div className="host-inline">
                <p className="host-key">HOST</p>
                <p className="host-value">{activeHost}</p>
              </div>
              <button ref={liveTagButtonRef} type="button" className={isUntuned ? 'live-tag live-scanning' : 'live-tag live-on'} onClick={handleLiveTagClick}>
                <span>{isUntuned ? 'SCANNING' : 'LIVE'}</span>
                <span className={isUntuned ? 'live-dot live-dot-scanning' : 'live-dot'} aria-hidden="true" />
              </button>
            </div>
            <h1>{titleForDisplay}</h1>
          </section>

          <div className="panel-bottom">
            <div className="panel-rule" />

            <button type="button" className="disc-block" onClick={toggleMute}>
            <div
              className={`disc-zone${isSwitchingStation ? ' switching' : ''}${isMuted ? ' disc-zone-muted' : ''}${isDiscWaking ? ' disc-zone-wake' : ''}${isUntuned ? ' disc-zone-untuned' : ''}`}
            >
              <div className={discMotionClass}>
                {previousStation ? (
                  <img
                    src={previousStation.art}
                    alt=""
                    className={hasTransitionArtworkSwapped ? 'disc-art disc-out' : 'disc-art disc-hold'}
                    style={{ '--disc-rotation-start': `${getStationRotationDeg(previousStation)}deg` }}
                    aria-hidden="true"
                    loading="eager"
                  />
                ) : null}
                {activeStation ? (
                  <img
                    src={activeStation.art}
                    alt={`${activeStation.title} artwork`}
                    className={hasTransitionArtworkSwapped ? 'disc-art disc-in disc-spin' : 'disc-art disc-in-pending disc-spin'}
                    style={{ '--disc-rotation-start': `${activeRotation}deg` }}
                    loading="eager"
                  />
                ) : null}
                {isUntuned ? <UntunedStaticDisc /> : null}
                <img src="/media/assets/cd.png" alt="" className={isUntuned ? 'disc-glare' : 'disc-glare disc-overlay-spin'} aria-hidden="true" loading="eager" />
                <div className={isUntuned ? 'disc-overlay' : 'disc-overlay disc-overlay-spin'} aria-hidden="true" />
                <span className="disc-core" aria-hidden="true">
                  <span
                    className={isUntuned ? 'disc-core-code disc-core-code-static' : 'disc-core-code'}
                    style={{ '--disc-rotation-start': `${activeRotation}deg` }}
                  >
                    <span>{activeCoreCode.durationCode}</span>
                    <span>{activeCoreCode.rotationCode}</span>
                  </span>
                </span>
              </div>
            </div>
              <span className={isMuted ? 'mute-button mute-button-muted' : 'mute-button mute-button-unmuted'} aria-hidden="true">
                <span className="mute-label">{isMuted ? 'unmute' : 'mute'}</span>
                <span className="mute-icon-stack">
                  <img src="/media/assets/muted.svg" alt="" className="mute-icon mute-icon-muted" draggable="false" />
                  <img src="/media/assets/unmuted.svg" alt="" className="mute-icon mute-icon-unmuted" draggable="false" />
                </span>
              </span>
            </button>

            <div className="panel-rule" />

            <div className="station-tags" aria-label="Station tags">
              {isUntuned ? (
                <span className="station-tag station-tag-empty">untuned</span>
              ) : activeTagsWithBpm.length ? (
                activeTagsWithBpm.map((tag) => (
                  <span key={tag} className="station-tag">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="station-tag station-tag-empty">untagged</span>
              )}
            </div>
            <div className="panel-rule" />

            <div className="scan-row">
              <button type="button" className="scan-button" onClick={() => scan(-1)} disabled={!hasStations}>
                <span className="scan-arrow scan-arrow-left" aria-hidden="true">
                  <img src="/media/assets/arrow.svg" alt="" draggable="false" />
                </span>
                <span>scan</span>
              </button>
              <span className={isHandBouncing ? 'scan-hand scan-hand-bounce' : 'scan-hand'} aria-hidden="true">
                <img src="/media/assets/hand.png" alt="" draggable="false" />
              </span>
              <button type="button" className="scan-button" onClick={() => scan(1)} disabled={!hasStations}>
                <span>scan</span>
                <span className="scan-arrow" aria-hidden="true">
                  <img src="/media/assets/arrow.svg" alt="" draggable="false" />
                </span>
              </button>
            </div>

            <div
              className="dial-window"
              aria-label="FM Dial Spectrum"
              onPointerDown={handleDialPointerDown}
              onPointerMove={handleDialPointerMove}
              onPointerUp={handleDialPointerEnd}
              onPointerCancel={handleDialPointerEnd}
            >
              <div ref={dialDriftWrapRef} className={isUntuned ? 'dial-drift-wrap dial-drift-wrap-untuned' : 'dial-drift-wrap'}>
                <div
                  ref={dialStripRef}
                  className={isDialDragging ? 'dial-strip dial-strip-dragging' : isDialSnapEasing ? 'dial-strip dial-strip-snap' : 'dial-strip'}
                  style={{ transform: `translateX(${dialBaseOffsetPx}px)` }}
                >
                  <div className="dial-edge-run" aria-hidden="true">
                    {Array.from({ length: EDGE_DOT_COUNT }).map((_, index) => (
                      <span key={`left-dot-${index}`} className="dial-edge-dot" />
                    ))}
                  </div>
                  {DIAL_TICKS.map((tick, index) => {
                    const isActive = !isUntuned && index === activeTickIndex;
                    const stationAtTick = stations.find((station) => {
                      const stationFreq = Number.parseFloat(station.frequency);
                      if (!Number.isFinite(stationFreq)) {
                        return false;
                      }
                      return Math.round((stationFreq - FM_MIN) / FM_STEP) === index;
                    });
                    const isStationTick = Boolean(stationAtTick);
                    return (
                      <div key={tick.value} className="dial-mark">
                        {isStationTick ? (
                          <span className={isActive ? 'station-dot station-dot-active' : 'station-dot'} aria-hidden="true" />
                        ) : (
                          <span className="station-dot-spacer" aria-hidden="true" />
                        )}
                        <span className={tick.label ? 'dial-tick dial-tick-major' : 'dial-tick'} />
                        {tick.label ? <span className={isActive ? 'dial-label dial-label-active' : 'dial-label'}>{tick.label}</span> : <span className="dial-label-spacer" aria-hidden="true" />}
                      </div>
                    );
                  })}
                  <div className="dial-edge-run" aria-hidden="true">
                    {Array.from({ length: EDGE_DOT_COUNT }).map((_, index) => (
                      <span key={`right-dot-${index}`} className="dial-edge-dot" />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="panel-rule" />

            <footer className="panel-foot">
              <div className="footer-left">
                <p className="freq-readout">
                  <span className="freq-value">{isUntuned ? '--.--' : displayFrequency.toFixed(2)}</span>
                  <span className="freq-unit"> MHz</span>
                </p>
                <p className="coords footer-coords">{simplifiedCoordinates}</p>
              </div>
              <div className="station-tools">
                <p className="listener-count">{listenerLabel}</p>
                <button
                  type="button"
                  className={shareStatus ? 'share-station share-station-feedback' : 'share-station'}
                  onClick={copyStationUrl}
                  disabled={isUntuned}
                >
                  {shareStatus || 'share station'}
                </button>
              </div>
            </footer>
          </div>
          </section>
        </div>
      </main>

      <audio ref={audioRef} preload="metadata" loop />
    </div>
  );
}

export default App;
