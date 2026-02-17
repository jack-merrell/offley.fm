# offley.fm

Retro-styled synchronized web radio.

## What it does
- Plays looping local MP3 tracks as stations.
- Seeks each station to a UTC-synced playback offset so listeners hear the same moment in the loop.
- Lets users tune between multiple stations in a black/red analogue-style console UI.

## Tech
- React + Vite
- Static media served from `public/media`

## Station updates without reload
Station definitions are in `/public/media/stations.json`.

When you swap a track/art file, update that station's `track`/`art` path in `stations.json`.
The app polls this manifest every 30 seconds and will hot-retune live listeners when it detects a path change.

## Run
```bash
npm install
npm run dev
```

## Tune New Station Admin
Use `/tune-station` for uploading a new station audio/artwork and writing metadata.

1. Start the upload backend:
```bash
npm run admin-api
```
2. Start the frontend:
```bash
npm run dev
```
3. Open:
`http://localhost:5173/tune-station`

Submitting "Tune Station" will:
- save the original audio to `media-originals/original/`
- convert it to 128kbps MP3 via `scripts/convert-to-128k.sh`
- write output to `public/media/audio/128k/`
- copy artwork to `public/media/artwork/`
- upsert and frequency-sort `public/media/stations.json`

## Build
```bash
npm run build
npm run preview
```
