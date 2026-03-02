import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findStationIndexByFrequency,
  hasLiveAssetChange,
  normalizeManifestStations
} from '../src/stationsManifest.js';

test('normalizeManifestStations filters, normalizes tags, and sorts by frequency', () => {
  const normalized = normalizeManifestStations([
    {
      id: 'b',
      title: 'B station',
      frequency: '101.30',
      track: '/media/audio/128k/b.mp3',
      art: '/media/artwork/b.jpg',
      tags: ['house', 'vinyl only', 'house']
    },
    {
      id: 'missing-track',
      title: 'Broken',
      frequency: '102.10',
      art: '/media/artwork/broken.jpg',
      tags: ['techno']
    },
    {
      id: 'a',
      title: 'A station',
      frequency: '89.90',
      track: '/media/audio/128k/a.mp3',
      art: '/media/artwork/a.jpg',
      tags: ['ambient', 'unknown-tag']
    }
  ]);

  assert.ok(Array.isArray(normalized));
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].id, 'a');
  assert.equal(normalized[1].id, 'b');
  assert.deepEqual(normalized[0].tags, ['Ambient', 'Unknown Tag']);
  assert.deepEqual(normalized[1].tags, ['House', 'Strictly Vinyl']);
});

test('findStationIndexByFrequency returns expected match index', () => {
  const stations = [
    { id: 'a', frequency: '88.10' },
    { id: 'b', frequency: '95.05' },
    { id: 'c', frequency: '107.90' }
  ];

  assert.equal(findStationIndexByFrequency(stations, '95.05'), 1);
  assert.equal(findStationIndexByFrequency(stations, '95.00'), -1);
});

test('hasLiveAssetChange only reports track/art changes', () => {
  const prev = { track: '/a.mp3', art: '/a.jpg', title: 'A' };
  const sameAssets = { track: '/a.mp3', art: '/a.jpg', title: 'A2' };
  const nextTrack = { track: '/b.mp3', art: '/a.jpg' };
  const nextArt = { track: '/a.mp3', art: '/b.jpg' };

  assert.equal(hasLiveAssetChange(prev, sameAssets), false);
  assert.equal(hasLiveAssetChange(prev, nextTrack), true);
  assert.equal(hasLiveAssetChange(prev, nextArt), true);
  assert.equal(hasLiveAssetChange(null, nextArt), false);
});

