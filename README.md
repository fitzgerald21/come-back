# Come back

A quiet meditation counter. Each time you notice your mind has wandered, tap to count it, and come back.

**Open it:** https://fitzgerald21.github.io/come-back/

On iPhone, open the link in Safari, tap Share, then **Add to Home Screen** to use it like an app (it works offline).

## What it does

- Swipe through the scenes on the start screen (Eyes closed, breathing circle, candle, tree by day and by night, rain on a lake, night ocean, starry sky, northern lights, snowy cabin, koi pond), pick a length, and Begin. Your last scene, length and choices are remembered. Eyes closed is a black screen with one big number in the middle.
- During a sit the controls fade back after a few seconds. Pause sits at the top; the options button opens a sheet with sound, a note, and cancel.
- Tap each time you return. A reminder from your own list appears.
- Background sound is one of: **Scene sounds**, **Two voices**, **Hidden overtone** or **Silent**. Bells are a separate option.
  - **Two voices:** two held sounds at once (real recorded flute, cello, clarinet, bowl, choir and more, or synthesized ones). Keep hearing both, and tap when one slips away.
  - **Hidden overtone:** one held note with a much quieter tone inside it. Either **Always there** (keep listening for it, and tap when it slips away) or **Challenge** (it comes and goes: tap when you hear it. A small ding says you caught it and a wooden knock says nothing was there; a visit that slips by makes no sound. A gentle running count of caught, slipped by and extra taps shows while you play. Those taps aren't counted as returns).
  - Both have ready-made setups at different difficulties, and you can save your own and come back to them. You can change anything during a sit from the Sound menu.
- The start screen shows your streak and time sat today and this week; the end of a sit shows a short summary. Everything is saved on your device, and if you sign in with Google (Account and backup, on the start screen) it is also backed up to Firebase so you can pick it up on any device.

## Development

Plain static files: `index.html`, `instruments.js` (the audio engine and instrument library), `tones.js` (the two listening exercises), `sw.js`, `manifest.webmanifest`, and `samples/` (recordings, see `samples/CREDITS.md`). No build step; `tools/build_samples.py` only regenerates `samples/`. `lab/` is a standalone playground for trying new listening ideas. Serve the folder with any static server, or push to `master` to publish via GitHub Pages. Bump the cache name in `sw.js` when you ship changes.

## Cloud backup (Firebase)

The site stays on GitHub Pages; only your data lives in Firebase (Auth + Firestore, free Spark plan).

1. In the [Firebase console](https://console.firebase.google.com) create a project, then **Build > Authentication > Get started > Google** and enable it.
2. **Authentication > Settings > Authorized domains**: add `fitzgerald21.github.io`.
3. **Build > Firestore Database > Create database**, then paste `firestore.rules` into the Rules tab and publish.
4. **Project settings > Your apps > Web app**, copy the config into `firebase-config.js`.
5. Push to `master`. Until the config is filled in, the Account panel is hidden and the app stays local-only.

Settings live in one document per user (`users/{uid}`) and each sit is its own document (`users/{uid}/sessions/{start}`), so history can grow without limit. `cloud.js` mirrors every `come-back:*` localStorage key into it, so the app itself still reads and writes locally.
