import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const manifestPath = path.join(repoRoot, 'public', 'media', 'stations.json');
const artworkDir = path.join(repoRoot, 'public', 'media', 'artwork');
const outputAudioDir = path.join(repoRoot, 'public', 'media', 'audio', '128k');
const originalsDir = path.join(repoRoot, 'media-originals', 'original');
const convertScript = path.join(repoRoot, 'scripts', 'convert-to-128k.sh');
const estimateBpmScript = path.join(repoRoot, 'scripts', 'estimate_bpm.py');
const venvPython = path.join(repoRoot, '.venv', 'bin', 'python');
const LISTENER_TTL_MS = 45000;
const listenersByStation = new Map();
const STATION_TAG_OPTIONS = [
  'House',
  'strictly vinyl',
  'disco',
  'techno',
  'balearic',
  'Ambient',
  'dub',
  'Trance',
  'groovy'
];
const TAG_LOOKUP = new Map(STATION_TAG_OPTIONS.map((tag) => [tag.toLowerCase(), tag]));

const upload = multer({
  dest: path.join(os.tmpdir(), 'offley-fm-uploads'),
  limits: {
    fileSize: 512 * 1024 * 1024
  }
});

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json());

function pruneStationListeners(stationKey, now = Date.now()) {
  const stationListeners = listenersByStation.get(stationKey);
  if (!stationListeners) {
    return 0;
  }

  for (const [clientId, lastSeen] of stationListeners.entries()) {
    if (now - lastSeen > LISTENER_TTL_MS) {
      stationListeners.delete(clientId);
    }
  }

  if (stationListeners.size === 0) {
    listenersByStation.delete(stationKey);
    return 0;
  }

  return stationListeners.size;
}

function listenerCountForStation(stationKey) {
  return pruneStationListeners(stationKey);
}

function sanitizeId(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureFiniteFrequency(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

function normalizeTags(rawValue) {
  let values = [];
  if (Array.isArray(rawValue)) {
    values = rawValue;
  } else if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        values = parsed;
      } else {
        values = trimmed.split(/[,\n]/g);
      }
    } catch (_error) {
      values = trimmed.split(/[,\n]/g);
    }
  }

  const deduped = new Set();
  for (const value of values) {
    const key = String(value || '').trim().toLowerCase();
    if (!key || !TAG_LOOKUP.has(key) || deduped.has(key)) {
      continue;
    }
    deduped.add(key);
  }
  return [...deduped].map((key) => TAG_LOOKUP.get(key));
}

function parseLocationFromInput(rawValue) {
  const source = String(rawValue || '').trim();
  if (!source) {
    return undefined;
  }

  const decimalPattern = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
  const decimalMatch = source.match(decimalPattern);
  if (decimalMatch) {
    const lat = Number.parseFloat(decimalMatch[1]);
    const lon = Number.parseFloat(decimalMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6))
      };
    }
  }

  const dmsPattern = /(\d+(?:\.\d+)?)°\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"?\s*([NSEW])/gi;
  const matches = [...source.matchAll(dmsPattern)];
  if (matches.length >= 2) {
    const toDecimal = (degrees, minutes, seconds, hemisphere) => {
      const value =
        Number.parseFloat(degrees) +
        Number.parseFloat(minutes) / 60 +
        Number.parseFloat(seconds) / 3600;
      return hemisphere === 'S' || hemisphere === 'W' ? -value : value;
    };

    const lat = toDecimal(matches[0][1], matches[0][2], matches[0][3], matches[0][4].toUpperCase());
    const lon = toDecimal(matches[1][1], matches[1][2], matches[1][3], matches[1][4].toUpperCase());
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6))
      };
    }
  }

  return undefined;
}

function parseLatLonInput(latRaw, lonRaw) {
  const lat = Number.parseFloat(String(latRaw ?? '').trim());
  const lon = Number.parseFloat(String(lonRaw ?? '').trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return undefined;
  }
  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6))
  };
}

async function runConvertTo128(inputPath, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(convertScript, [inputPath, outputPath], {
      cwd: repoRoot,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`convert-to-128k failed with code ${code}`));
    });
  });
}

async function estimateBpmInt(trackPath) {
  const candidates = [venvPython, 'python3'];
  let lastError = null;

  for (const pythonBin of candidates) {
    try {
      const payload = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const child = spawn(pythonBin, [estimateBpmScript, trackPath], {
          cwd: repoRoot,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('exit', (code) => {
          if (code === 0) {
            resolve(stdout.trim());
            return;
          }
          reject(new Error(stderr.trim() || stdout.trim() || `BPM estimator failed (${code})`));
        });
      });

      const parsed = JSON.parse(payload);
      const bpmInt = Number.parseInt(parsed?.bpmInt, 10);
      if (Number.isFinite(bpmInt)) {
        return bpmInt;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn(`[bpm] unable to estimate BPM for ${trackPath}: ${lastError.message}`);
  }
  return null;
}

async function readManifest() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

async function patchStationBpm(stationId, bpmInt) {
  if (!stationId || !Number.isFinite(bpmInt)) {
    return false;
  }
  const manifest = await readManifest();
  const stations = Array.isArray(manifest.stations) ? manifest.stations : [];
  const index = stations.findIndex((station) => station.id === stationId);
  if (index < 0) {
    return false;
  }
  stations[index] = {
    ...stations[index],
    bpm: Math.round(bpmInt)
  };
  const nextManifest = {
    ...manifest,
    stations: sortStationsByFrequency(stations)
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  return true;
}

function scheduleBpmRetry({ stationId, trackPath, delayMs = 1200 }) {
  if (!stationId || !trackPath) {
    return;
  }
  setTimeout(async () => {
    try {
      const retryBpm = await estimateBpmInt(trackPath);
      if (!Number.isFinite(retryBpm)) {
        console.warn(`[bpm] retry unavailable for ${stationId}`);
        return;
      }
      const patched = await patchStationBpm(stationId, retryBpm);
      if (patched) {
        console.log(`[bpm] retry patched ${stationId} -> ${retryBpm}`);
      }
    } catch (error) {
      console.warn(`[bpm] retry failed for ${stationId}: ${error.message}`);
    }
  }, delayMs).unref();
}

function sortStationsByFrequency(stations) {
  return [...stations].sort((a, b) => {
    const aFreq = Number.parseFloat(a.frequency);
    const bFreq = Number.parseFloat(b.frequency);
    if (Number.isFinite(aFreq) && Number.isFinite(bFreq) && aFreq !== bFreq) {
      return aFreq - bFreq;
    }
    return String(a.id).localeCompare(String(b.id));
  });
}

function createTuneResponder(req, res) {
  const streamProgress = String(req.query?.stream || '') === '1';
  let lastPercent = 0;
  let responseEnded = false;

  const clampPercent = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return lastPercent;
    }
    return Math.max(lastPercent, Math.min(100, parsed));
  };

  const writeEvent = (payload) => {
    if (!streamProgress || responseEnded) {
      return;
    }
    res.write(`${JSON.stringify(payload)}\n`);
  };

  if (streamProgress) {
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
  }

  return {
    progress(percent, stage) {
      if (!streamProgress || responseEnded) {
        return;
      }
      lastPercent = clampPercent(percent);
      writeEvent({
        type: 'progress',
        ok: true,
        percent: lastPercent,
        stage: String(stage || '').trim()
      });
    },
    success(station) {
      if (responseEnded) {
        return;
      }
      if (streamProgress) {
        lastPercent = 100;
        writeEvent({
          type: 'result',
          ok: true,
          percent: 100,
          stage: 'Done',
          station
        });
        responseEnded = true;
        res.end();
        return;
      }
      responseEnded = true;
      res.json({ ok: true, station });
    },
    failure(statusCode, errorMessage) {
      if (responseEnded) {
        return;
      }
      const message = String(errorMessage || 'Unknown error');
      if (streamProgress) {
        writeEvent({
          type: 'error',
          ok: false,
          percent: lastPercent,
          error: message
        });
        responseEnded = true;
        res.end();
        return;
      }
      responseEnded = true;
      res.status(statusCode).json({ error: message });
    }
  };
}

app.get('/api/stations', async (_req, res) => {
  try {
    const manifest = await readManifest();
    res.json(manifest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/listeners', (req, res) => {
  const station = String(req.query.station || '').trim();
  if (!station) {
    res.status(400).json({ error: 'Missing station query param.' });
    return;
  }
  const listeners = listenerCountForStation(station);
  res.json({ ok: true, station, listeners });
});

app.post('/api/listeners/heartbeat', (req, res) => {
  const station = String(req.body?.station || '').trim();
  const clientId = String(req.body?.clientId || '').trim();

  if (!station || !clientId) {
    res.status(400).json({ error: 'Missing station/clientId.' });
    return;
  }

  let stationListeners = listenersByStation.get(station);
  if (!stationListeners) {
    stationListeners = new Map();
    listenersByStation.set(station, stationListeners);
  }

  stationListeners.set(clientId, Date.now());
  const listeners = pruneStationListeners(station);
  console.log(`[listeners] #${station} -> ${listeners}`);
  res.json({ ok: true, station, listeners });
});

app.post('/api/tune-station', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'art', maxCount: 1 }]), async (req, res) => {
  const audioFile = req.files?.audio?.[0];
  const artFile = req.files?.art?.[0];
  const tuneResponse = createTuneResponder(req, res);

  try {
    const title = String(req.body.title || '').trim();
    const providedId = sanitizeId(req.body.id);
    const stationId = providedId || sanitizeId(title);
    const frequency = ensureFiniteFrequency(req.body.frequency);
    const location = parseLatLonInput(req.body?.lat, req.body?.lon) || parseLocationFromInput(req.body.coordinates);

    if (!stationId || !title || !frequency || !audioFile || !artFile) {
      tuneResponse.failure(400, 'Missing required fields: id/title/frequency/audio/art');
      return;
    }

    tuneResponse.progress(91, 'Preparing files');
    await fs.mkdir(artworkDir, { recursive: true });
    await fs.mkdir(outputAudioDir, { recursive: true });
    await fs.mkdir(originalsDir, { recursive: true });

    const audioExt = path.extname(audioFile.originalname || '') || '.audio';
    const artExt = path.extname(artFile.originalname || '') || '.jpg';
    const originalAudioPath = path.join(originalsDir, `${stationId}${audioExt}`);
    const convertedAudioPath = path.join(outputAudioDir, `${stationId}.mp3`);
    const artworkPath = path.join(artworkDir, `${stationId}${artExt.toLowerCase()}`);

    tuneResponse.progress(93, 'Saving original audio');
    await fs.copyFile(audioFile.path, originalAudioPath);
    tuneResponse.progress(94, 'Converting to 128kbps');
    await runConvertTo128(audioFile.path, convertedAudioPath);
    tuneResponse.progress(97, 'Estimating BPM');
    const estimatedBpm = await estimateBpmInt(convertedAudioPath);
    tuneResponse.progress(98, 'Saving artwork');
    await fs.copyFile(artFile.path, artworkPath);
    tuneResponse.progress(99, 'Updating manifest');

    const manifest = await readManifest();
    const stations = Array.isArray(manifest.stations) ? manifest.stations : [];

    const parsedTags = normalizeTags(req.body.tags);
    const fallbackTags = normalizeTags(req.body.tag || req.body.pendingTag);

    const upsertedStation = {
      id: stationId,
      frequency,
      title,
      host: String(req.body.host || '').trim(),
      tags: parsedTags.length > 0 ? parsedTags : fallbackTags,
      signal: Number.isFinite(Number.parseInt(req.body.signal, 10))
        ? Math.max(1, Math.min(4, Number.parseInt(req.body.signal, 10)))
        : 3,
      track: `/media/audio/128k/${stationId}.mp3`,
      art: `/media/artwork/${stationId}${artExt.toLowerCase()}`
    };

    if (Number.isFinite(estimatedBpm)) {
      upsertedStation.bpm = estimatedBpm;
    }

    if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
      upsertedStation.location = {
        lat: Number(location.lat.toFixed(6)),
        lon: Number(location.lon.toFixed(6))
      };
    }

    const existingIndex = stations.findIndex((station) => station.id === stationId);
    if (existingIndex >= 0) {
      const merged = {
        ...stations[existingIndex],
        ...upsertedStation
      };
      delete merged.coordinates;
      stations[existingIndex] = merged;
    } else {
      stations.push(upsertedStation);
    }

    const nextManifest = {
      ...manifest,
      stations: sortStationsByFrequency(stations)
    };

    await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

    await Promise.allSettled([
      fs.unlink(audioFile.path),
      fs.unlink(artFile.path)
    ]);

    tuneResponse.success(upsertedStation);

    if (!Number.isFinite(estimatedBpm)) {
      scheduleBpmRetry({ stationId, trackPath: convertedAudioPath });
    }
  } catch (error) {
    if (audioFile?.path) {
      await fs.unlink(audioFile.path).catch(() => {});
    }
    if (artFile?.path) {
      await fs.unlink(artFile.path).catch(() => {});
    }
    tuneResponse.failure(500, error.message);
  }
});

const port = Number.parseInt(process.env.ADMIN_API_PORT || '8787', 10);
setInterval(() => {
  const now = Date.now();
  for (const stationKey of listenersByStation.keys()) {
    pruneStationListeners(stationKey, now);
  }
}, 10000).unref();

app.listen(port, () => {
  console.log(`offley admin API listening on http://localhost:${port}`);
});
