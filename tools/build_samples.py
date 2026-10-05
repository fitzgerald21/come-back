#!/usr/bin/env python3
"""Builds samples/ from free libraries. Run: python3 tools/build_samples.py

For every instrument it downloads a handful of notes, trims the silence, evens out the level, measures the
true pitch of each recording (so notes land exactly in tune), and writes small mono mp3s plus samples/manifest.js.
Needs: ffmpeg, numpy. Downloads are cached in tools/.cache (not committed).

Sources and licenses are in samples/CREDITS.md.
"""
import json, os, re, subprocess, sys, urllib.parse, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "samples")
CACHE = os.path.join(HERE, ".cache")
SR = 44100

VSCO = "https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/"
FLUID = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/%s-mp3/%s.mp3"

NOTE_IDX = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def midi(name):
    m = re.match(r"([A-G][#b]?)(-?\d)$", name)
    return NOTE_IDX[m.group(1)] + 12 * (int(m.group(2)) + 1)


def name_of(m):
    return ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][m % 12] + str(m // 12 - 1)


def fetch(url, local):
    p = os.path.join(CACHE, local)
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "come-back-lab"})
        with urllib.request.urlopen(req, timeout=60) as r, open(p, "wb") as f:
            f.write(r.read())
    return p


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def measure_pitch(x, expect, span=2):
    """True fundamental of a recording, in fractional MIDI (autocorrelation, so strong harmonics don't fool it).
    Bells and other inharmonic sounds don't have a clear period, so there we trust the note name."""
    seg = x[int(len(x) * 0.25): int(len(x) * 0.75)][: SR]
    seg = seg - seg.mean()
    n = 1 << int(np.ceil(np.log2(len(seg) * 2)))
    F = np.fft.rfft(seg, n); ac = np.fft.irfft(F * np.conj(F))[: len(seg)]
    ac /= ac[0] + 1e-12
    f0 = 440 * 2 ** ((expect - 69) / 12)
    lo, hi = int(SR / (f0 * 2 ** (span / 12))), int(SR / (f0 * 2 ** (-span / 12)))
    k = lo + int(np.argmax(ac[lo:hi]))
    if ac[k] < 0.8 or not 1 < k < len(ac) - 1:
        return float(expect)
    a, b, c = ac[k - 1], ac[k], ac[k + 1]
    k = k + 0.5 * (a - c) / (a - 2 * b + c)
    return float(69 + 12 * np.log2(SR / k / 440))


def process(x, sustain, maxlen):
    """Trim leading silence and cap the length. For held sounds also find the steady stretch to loop.
    Returns (samples, loop_start_seconds or None)."""
    env = np.abs(x)
    thr = max(env.max() * 0.02, 1e-4)
    start = max(0, int(np.argmax(env > thr)) - int(0.005 * SR))
    x = x[start:]
    if len(x) > maxlen * SR:
        x = x[: int(maxlen * SR)]
    x = x.copy()
    if not sustain:
        fade = int(0.08 * SR); x[-fade:] *= np.linspace(1, 0, fade) ** 1.5
        return x, None
    w = int(0.05 * SR); n = len(x) // w
    r = np.array([np.sqrt(np.mean(x[i * w:(i + 1) * w] ** 2)) for i in range(n)])
    mid = np.median(r[int(n * 0.3):int(n * 0.65)])
    good = (r >= 0.75 * mid) & (r <= 1.35 * mid)
    idx = np.where(good)[0]
    first = int(idx[idx >= int(n * 0.12)][0]) if len(idx[idx >= int(n * 0.12)]) else int(n * 0.3)
    last = int(idx[-1]) + 1
    # the loop runs from `first` to the end of the file, so cut the file where the steady part stops
    if (last - first) * w < 0.9 * SR:
        first, last = int(n * 0.35), n
    x = x[: min(len(x), last * w)]
    fade = int(0.01 * SR); x[-fade:] *= np.linspace(1, 0, fade)
    return x, first * w / SR


def loudness(x, sustain):
    if sustain:
        seg = x[int(len(x) * 0.2): int(len(x) * 0.85)]
        return float(np.sqrt(np.mean(seg ** 2))) + 1e-9
    return float(np.sqrt(np.mean(x[:SR] ** 2))) + 1e-9   # struck sounds: how loud the first second is, not the sharp peak of the attack


def encode(x, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-codec:a", "libmp3lame", "-q:a", "5", path], stdin=subprocess.PIPE)
    p.communicate(x.astype(np.float32).tobytes())
    return os.path.getsize(path)


def fluid_notes_unused():
    pass


def fl(n):  # FluidR3 uses flats in its file names
    return {"C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb"}.get(n[:-1], n[:-1]) + n[-1]


def fluid_notes(inst, notes):
    return [(n, FLUID % (inst, fl(n)), "fluid/%s_%s.mp3" % (inst, fl(n))) for n in notes]


FLUID_RANGE = ["C3", "E3", "G3", "C4", "E4", "G4", "C5", "E5", "G5", "C6"]

# real recordings: VSCO 2 Community Edition (CC0). Files are chosen from the repo listing by folder.
VSCO_SETS = {
    "flute":    ("Flute", "sustained", "Woodwinds/Flute/susNV/", 3.2),
    "clarinet": ("Clarinet", "sustained", "Woodwinds/Clarinet/susLong/", 3.2),
    "oboe":     ("Oboe", "sustained", "Woodwinds/Oboe/Sus/", 3.2),
    "cello":    ("Cello (section)", "sustained", "Strings/Cello Section/susvib/", 3.2),
    "violin":   ("Violin (solo)", "sustained", "Strings/Solo Violin/Arco Vib/", 3.2),
    "harp":     ("Harp", "struck", "Strings/Harp/", 3.5),
    "marimba":  ("Marimba", "struck", "Percussion/Marimba/", 2.5),
}
INSTRUMENTS = {
    # FluidR3 General MIDI soundfont (CC BY 3.0)
    "choir":    ("Choir (aah)", "sustained", fluid_notes("choir_aahs", FLUID_RANGE), 3.1),
    "voice":    ("Voice (ooh)", "sustained", fluid_notes("voice_oohs", FLUID_RANGE), 3.1),
    "panflute": ("Pan flute", "sustained", fluid_notes("pan_flute", FLUID_RANGE), 3.1),
    "shakuhachi": ("Shakuhachi", "sustained", fluid_notes("shakuhachi", FLUID_RANGE), 3.1),
    "ocarina":  ("Ocarina", "sustained", fluid_notes("ocarina", FLUID_RANGE), 3.1),
    "kalimba":  ("Kalimba", "struck", fluid_notes("kalimba", FLUID_RANGE), 3.1),
    "vibes":    ("Vibraphone", "struck", fluid_notes("vibraphone", FLUID_RANGE), 3.1),
    "musicbox": ("Music box", "struck", fluid_notes("music_box", FLUID_RANGE), 3.1),
    "tubular":  ("Tubular bell", "struck", fluid_notes("tubular_bells", FLUID_RANGE), 3.1),
    "steeldrum": ("Steel drum", "struck", fluid_notes("steel_drums", FLUID_RANGE), 3.1),
}


def vsco_listing():
    """The repo's file list, so instruments whose file names vary can be picked by pattern."""
    p = fetch("https://api.github.com/repos/sgossner/VSCO-2-CE/git/trees/master?recursive=1", "vsco_tree.json")
    return [t["path"] for t in json.load(open(p))["tree"] if t["type"] == "blob" and t["path"].endswith(".wav")]


def pick(tree, prefix, regex, per_note_first=True):
    """Files under prefix whose name matches regex (with the note as group 1); the first file for each note."""
    got = {}
    for p in sorted(tree):
        if p.startswith(prefix):
            m = re.search(regex, p)
            if m and m.group(1) not in got:
                got[m.group(1)] = p
    return got


def main():
    tree = vsco_listing()
    # instruments whose files are best found by pattern rather than by hand
    for k, (name, kind, prefix, ml) in VSCO_SETS.items():
        files = pick(tree, prefix, r"_([A-G]#?\d)[_.]")
        notes = sorted(files, key=midi)
        keep = notes[::2] if len(notes) > 12 else notes   # every other note is plenty: we retune between them
        INSTRUMENTS[k] = (name, kind, [(n, VSCO + urllib.parse.quote(files[n]), "vsco/" + k + "/" + os.path.basename(files[n])) for n in keep], ml)

    manifest = {}
    total = 0
    for iid, (name, kind, files, maxlen) in INSTRUMENTS.items():
        sustain = kind == "sustained"
        rows = []
        for note, url, local in files:
            try:
                x = decode(fetch(url, local))
            except Exception as e:
                print("  skip", iid, note, e); continue
            x, ls = process(x, sustain, maxlen)
            m = measure_pitch(x, midi(note))
            rows.append((note, m, x, loudness(x, sustain), ls))
        if not rows:
            print("no samples for", iid); continue
        target = 0.12 if sustain else 0.10            # every note of an instrument at the same level, loud enough that mp3 noise stays far below it
        out = []
        for note, m, x, lv, ls in rows:
            x = x * (target / lv)
            peak = np.max(np.abs(x)); x = x * min(1, 0.95 / peak)   # a very peaky note (kalimba) is capped, so it sits a little lower
            if ls is not None and kind == "sustained" and iid not in ("bowl",):
                # make the loop a whole number of pitch cycles long, so where it joins itself the waveform is continuous
                period = SR / (440 * 2 ** ((m - 69) / 12)); dsec = len(x) / SR
                cycles = max(1, round((dsec - ls) * SR / period)); ls = dsec - cycles * period / SR
            rel = "%s/%s.mp3" % (iid, note.replace("#", "s"))
            total += encode(x, os.path.join(OUT, rel))
            out.append({"f": rel, "m": round(float(m), 2), "d": round(len(x) / SR, 2), "ls": None if ls is None else round(ls, 4)})
        manifest[iid] = {"name": name, "kind": kind, "level": target, "notes": out}
        print("%-11s %2d notes  pitch error (cents) max %3.0f" % (iid, len(out), max(abs(o["m"] - midi(r[0])) for o, r in zip(out, rows)) * 100))

    # the singing bowl: the recording rises, then rings down over ~40 s. To make it a steady held sound we keep the rise and
    # the first twelve seconds after the peak, and flatten the slow decay out of that stretch (the shimmer stays).
    try:
        x = decode(fetch("https://bigsoundbank.com/UPLOAD/mp3/1109.mp3", "bowl.mp3"))
        x, _ = process(x, False, 40)
        w = int(1.0 * SR)
        env = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode="same")) + 1e-6
        pk = int(np.argmax(env)); x = x[: pk + 12 * SR]; env = env[: len(x)]
        gain = np.ones(len(x)); gain[pk:] = np.minimum(env[pk] / env[pk:], 5)
        x = x * gain
        x = x * (0.12 / (np.sqrt(np.mean(x[pk:] ** 2)) + 1e-9)); x = x * min(1, 0.95 / np.max(np.abs(x)))
        seg = x[pk: pk + 4 * SR]; n = 1 << 19
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n)); freqs = np.arange(len(spec)) * SR / n
        k = int(np.argmax(np.where((freqs > 80) & (freqs < 900), spec, 0)))
        a_, b_, c_ = np.log(spec[k - 1]), np.log(spec[k]), np.log(spec[k + 1]); k += 0.5 * (a_ - c_) / (a_ - 2 * b_ + c_)
        m = 69 + 12 * np.log2(k * SR / n / 440)
        total += encode(x, os.path.join(OUT, "bowl/bowl.mp3"))
        manifest["bowl"] = {"name": "Singing bowl", "kind": "sustained", "octave": True, "power": True, "level": 0.12,
                            "notes": [{"f": "bowl/bowl.mp3", "m": round(float(m), 2), "d": round(len(x) / SR, 2), "ls": round((pk + 2 * SR) / SR, 3)}]}
        print("bowl        pitch %.2f (%s)  %.1fs, loops %.1fs-%.1fs" % (m, name_of(int(round(m))), len(x) / SR, (pk + 2 * SR) / SR, len(x) / SR))
    except Exception as e:
        print("bowl failed:", e)

    with open(os.path.join(OUT, "manifest.js"), "w") as f:
        f.write("/* generated by tools/build_samples.py, do not edit. Read by the page and by the service worker. */\n(function (g) { g.Lab = g.Lab || {}; g.Lab.SAMPLE_DEFS = " + json.dumps(manifest, separators=(",", ":")) + ";\n})(typeof self !== \"undefined\" ? self : window);\n")
    print("total %.1f MB" % (total / 1e6))


if __name__ == "__main__":
    main()
