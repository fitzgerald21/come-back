# Your own scene recordings

Drop audio files in this folder and the app will use them instead of the built-in synthesized sound
for that scene. Each file loops (with a short crossfade), so a minute or more of steady sound works best.

Names, as `.mp3` or `.ogg`:

| File       | Scene            |
| ---------- | ---------------- |
| `tree.mp3` | Tree at night    |
| `rain.mp3` | Rain             |
| `ocean.mp3`| Night ocean      |
| `flame.mp3`| Candle flame     |
| `stars.mp3`| Starry sky       |
| `circle.mp3`| Breathing circle |
| `dark.mp3` | Eyes closed      |

Any scene without a file keeps its built-in sound. In the Sound menu, "Use my recordings" switches back and forth.
Only use recordings you have the right to use (your own, public domain / CC0, or properly licensed).

The tree has a day and a night version: use `daytree.mp3` for "Tree by day" and `tree.mp3` for "Tree at night".

Recordings only load when the app is served over http, not opened straight from disk (`file://`). From the project folder, run `python3 -m http.server 8000` and open http://localhost:8000.
Credits for the bundled recordings are in `CREDITS.md`.
