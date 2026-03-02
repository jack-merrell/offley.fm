import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import {
  STATION_TAG_OPTIONS as SHARED_STATION_TAG_OPTIONS,
  normalizeStationTags as normalizeSharedStationTags
} from '../shared/stationTags.js';
import {
  STATION_TAG_OPTIONS as CLIENT_STATION_TAG_OPTIONS,
  normalizeStationTags as normalizeClientStationTags
} from '../src/stationTags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const stationsPath = path.join(repoRoot, 'public', 'media', 'stations.json');
const serverPath = path.join(repoRoot, 'server', 'admin-api.mjs');

function asJson(value) {
  return JSON.stringify(value);
}

async function main() {
  assert.deepEqual(
    CLIENT_STATION_TAG_OPTIONS,
    SHARED_STATION_TAG_OPTIONS,
    'Client and shared canonical station tag options diverged.'
  );

  const samples = [
    ['house', ['House']],
    ['house, techno,unknown-tag', ['House', 'Techno', 'Unknown Tag']],
    ['["deep house","House","vinyl only"]', ['House', 'Strictly Vinyl', 'Deep House']],
    [['Trance', ' trance ', 'TRANCE'], ['Trance']]
  ];

  for (const [input, expected] of samples) {
    const sharedOutput = normalizeSharedStationTags(input);
    const clientOutput = normalizeClientStationTags(input);
    assert.deepEqual(clientOutput, sharedOutput, `Client/shared normalizer output mismatch for input: ${asJson(input)}`);
    assert.deepEqual(sharedOutput, expected, `Unexpected normalization output for input: ${asJson(input)}`);
  }

  const serverSource = await fs.readFile(serverPath, 'utf8');
  assert.match(
    serverSource,
    /import\s+\{\s*normalizeStationTags\s*\}\s+from\s+'\.\.\/shared\/stationTags\.js';/,
    'Server must import normalizeStationTags from shared/stationTags.js'
  );
  assert.doesNotMatch(serverSource, /const\s+STATION_TAG_OPTIONS\s*=/, 'Server should not define local STATION_TAG_OPTIONS');
  assert.doesNotMatch(serverSource, /function\s+normalizeTags\s*\(/, 'Server should not define a local normalizeTags function');

  const manifestRaw = await fs.readFile(stationsPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const stations = Array.isArray(manifest.stations) ? manifest.stations : [];

  const driftedStations = [];
  for (const station of stations) {
    const currentTags = Array.isArray(station?.tags) ? station.tags : [];
    const normalized = normalizeSharedStationTags(currentTags);
    if (asJson(currentTags) !== asJson(normalized)) {
      driftedStations.push(station?.id || '(unknown-id)');
    }
  }

  assert.equal(
    driftedStations.length,
    0,
    `stations.json contains non-canonical tag values for: ${driftedStations.join(', ')}`
  );

  console.log('Tag validation passed.');
}

void main();
