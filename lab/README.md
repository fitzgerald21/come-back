# Two sounds lab

A standalone prototype for improving the "Two tones" listening exercise before it goes into the main app.
Open `index.html` (any static server). It plays through the same engine and recordings as the app (`../instruments.js`, `../samples/`), so it is the place to try ideas before they go into Come back. The two exercises the app kept (Two voices, Hidden overtone) now live in the app itself; the rest are still here.

## Sounds

The instruments and recordings are shared with the app: see the main README and `../samples/CREDITS.md`. To add or change recordings, edit `../tools/build_samples.py` and run it.

## Files

- `modes.js` – the ways of combining sounds. Each mode is data (controls, defaults, presets) plus a `build(layer, params)` function. Add a mode by adding one entry to `Lab.MODES`.
- `index.html` – the page. It draws itself from the mode data, so new modes and controls appear without touching it.

## Modes

| Mode | The exercise |
| --- | --- |
| Two voices | The original: two held sounds, now with every instrument, volume swell or pitch glide, together/opposite/independent |
| Hidden overtone | A singing-bowl style note with a faint harmonic that swells in and out. Tap when you hear it; it's scored |
| Call and response | Two instruments trade phrases (echo, answer, or overlap) in a pentatonic or other scale |
| Two rhythms | Two patterns in different beat counts (3 against 4 …) in each ear |
| Orbit | One sound stays put, the other travels around your head (3D audio, headphones) |
| Endless rise | A Shepard–Risset glissando that climbs forever, with an optional steady anchor note |
| Binaural beat | A different pitch in each ear, so a pulse exists only in your head (headphones) |

## Testing without speakers

`Lab.render(modeId, params, seconds)` renders a mode offline and returns an `AudioBuffer`, so levels, silence and clipping can be checked in headless Chrome.
