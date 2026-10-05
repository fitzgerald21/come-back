# Come back

A quiet meditation counter. Each time you notice your mind has wandered, tap to count it, and come back.

**Open it:** https://fitzgerald21.github.io/come-back/

On iPhone, open the link in Safari, tap Share, then **Add to Home Screen** to use it like an app (it works offline).

## What it does

- Pick a scene to rest on (Eyes closed, flame, trees, rain, ocean, stars) and a length, or no limit. Eyes closed is a black screen with one big number in the middle.
- Tap each time you return. A reminder from your own list appears.
- Background sound is one of: **Scene sounds**, **Two voices**, **Hidden overtone** or **Silent**. Bells are a separate option.
  - **Two voices:** two held sounds at once (real recorded flute, cello, clarinet, bowl, choir and more, or synthesized ones). Keep hearing both, and tap when one slips away.
  - **Hidden overtone:** one held note with a much quieter tone inside it. Either **Always there** (keep listening for it, and tap when it slips away) or **Challenge** (it comes and goes: tap when you hear it, and a small ding says you caught it, a wooden knock says it wasn't there. There's no score, and those taps aren't counted as returns).
  - Both have ready-made setups at different difficulties, and you can save your own and come back to them. You can change anything during a sit from the Sound menu.
- Past sessions and insights are kept on your device only.

## Development

Plain static files: `index.html`, `instruments.js` (the audio engine and instrument library), `tones.js` (the two listening exercises), `sw.js`, `manifest.webmanifest`, and `samples/` (recordings, see `samples/CREDITS.md`). No build step; `tools/build_samples.py` only regenerates `samples/`. `lab/` is a standalone playground for trying new listening ideas. Serve the folder with any static server, or push to `master` to publish via GitHub Pages. Bump the cache name in `sw.js` when you ship changes.
