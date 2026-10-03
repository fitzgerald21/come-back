# Come back

A quiet meditation counter. Each time you notice your mind has wandered, tap to count it, and come back.

**Open it:** https://fitzgerald21.github.io/come-back/

On iPhone, open the link in Safari, tap Share, then **Add to Home Screen** to use it like an app (it works offline).

## What it does

- Pick a scene to rest on (Eyes closed, flame, trees, rain, ocean, stars) and a length, or no limit.
- Tap each time you return. A reminder from your own list appears.
- Background sound is one of: **Scene sounds**, **Two tones** (a listening exercise) or **Silent**. Bells are a separate option.
- Past sessions and insights are kept on your device only.

## Development

Plain static files: `index.html`, `sw.js`, `manifest.webmanifest`. No build step. Serve the folder with any static server, or push to `master` to publish via GitHub Pages. Bump the cache name in `sw.js` when you ship changes.
