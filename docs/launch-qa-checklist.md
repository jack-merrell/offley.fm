# offley.fm Launch QA Checklist

## 1. Core Playback
- Open `/` on desktop and mobile: app loads in untuned state without console errors.
- Unmute from untuned: audio starts immediately and button state matches actual audio state.
- Tune via scan buttons, dial drag, keyboard arrows, and station list/map: each method lands on a valid station.
- Space bar toggles mute/unmute reliably.
- URL hash updates to `#XX.XXMHz` when station changes.
- Loading a shared hash URL opens the matching station directly.

## 2. iOS (Safari + Home Screen)
- In Safari (production HTTPS), Add to Home Screen works and icon appears correctly.
- Open from home screen: launches in standalone mode (no browser chrome).
- Playback/unmute behavior is correct after cold open from home screen.
- Share Station copies the expected URL and can be opened from Messages/Notes.

## 3. Mobile Layout
- iPhone small viewport: no cropped content; vertical scroll works where intended.
- Drawer/list view behaves correctly on mobile route (`/all-stations`), including station selection back to radio.
- Buttons remain tappable with no overlap issues (scan, mute, live tag, share station).

## 4. Desktop Layout
- Radio panel is centered when drawer is collapsed.
- Drawer opens/closes smoothly and aligns flush to panel edge (no gap).
- Station rows/thumb clicks tune station and keep drawer state expected.
- Three.js map mode: orbit/zoom constraints feel correct and markers align with stations.

## 5. Metadata + Sharing
- Validate OG/Twitter cards on production URL:
  - [https://cards-dev.twitter.com/validator](https://cards-dev.twitter.com/validator)
  - [https://developers.facebook.com/tools/debug/](https://developers.facebook.com/tools/debug/)
- Check title, description, and preview image are correct.

## 6. Tune Station Flow
- `/tune-station`: upload audio + art + metadata works end-to-end.
- Progress percentage reaches 100 and does not stall.
- New station writes to `stations.json` with expected fields (including tags, location lat/lon, bpm when available).
- New station appears in main app and all stations views in frequency order.

## 7. Listener Count
- Heartbeat endpoint responds in production (`/api/listeners/heartbeat`).
- Listener count updates on station change and matches expected +1 illusion rule.
- No CORS or 404 errors in browser console.

## 8. Browser Coverage
- Test latest: Safari (macOS+iOS), Chrome (macOS+iOS), Firefox (desktop).
- Confirm no blocking console errors in each browser.

## 9. Final Smoke Before Launch
- Hard refresh and retest one full tune/unmute/share cycle.
- Verify favicon, manifest, apple touch icon, and meta tags on production domain.
- Confirm robots file and canonical URL are correct for your final domain.
