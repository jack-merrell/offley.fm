import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeStationTags } from '../shared/stationTags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const stationsPath = path.join(repoRoot, 'public', 'media', 'stations.json');

function stableStringify(value) {
  return JSON.stringify(value);
}

async function main() {
  const raw = await fs.readFile(stationsPath, 'utf8');
  const manifest = JSON.parse(raw);
  const stations = Array.isArray(manifest.stations) ? manifest.stations : [];

  let updatedStations = 0;
  let updatedTags = 0;

  const normalizedStations = stations.map((station) => {
    const currentTags = station?.tags;
    const nextTags = normalizeStationTags(currentTags);

    if (stableStringify(currentTags ?? []) !== stableStringify(nextTags)) {
      updatedStations += 1;
      updatedTags += Array.isArray(currentTags) ? currentTags.length : currentTags ? 1 : 0;
    }

    return {
      ...station,
      tags: nextTags
    };
  });

  const nextManifest = {
    ...manifest,
    stations: normalizedStations
  };

  await fs.writeFile(stationsPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

  console.log(`Normalized station tags in ${stationsPath}`);
  console.log(`Stations touched: ${updatedStations}/${stations.length}`);
  console.log(`Original tag entries touched: ${updatedTags}`);
}

void main();

