/* Two-sounds lab: the ways of combining sounds. Each mode is a recipe that builds one Layer out of instruments.
   A mode is { id, name, blurb, listen, headphones, controls, defaults, presets, build(L, params) }.
   Controls are described as data, so the page draws them without knowing anything about any mode. */
(function (global) {
  "use strict";
  var Lab = global.Lab, u = Lab.u, mtof = Lab.mtof, INST = Lab.INST;
  var gainNode = u.gain, filt = u.filt, chain = u.chain, rnd = u.rnd;
  function ac() { return Lab.ac(); }

  /* ---------- control builders ---------- */
  function inst(k, label, o) { o = o || {}; return { k: k, label: label, t: "inst", kinds: o.kinds, only: o.only, none: o.none }; }
  function note(k, label, min, max) { return { k: k, label: label, t: "note", min: min || 36, max: max || 84 }; }
  function rng(k, label, min, max, step, fmt) { return { k: k, label: label, t: "range", min: min, max: max, step: step, fmt: fmt || String }; }
  function sel(k, label, opts) { return { k: k, label: label, t: "sel", opts: opts }; }
  var pct = function (v) { return Math.round(v * 100) + "%"; };
  var secs = function (v) { return (+v).toFixed(v < 10 ? 1 : 0) + " s"; };

  /* ---------- shared pieces ---------- */
  // Keep one instrument sounding as a steady voice: sustained ones are held as a drone, struck ones are re-struck.
  function hold(L, instId, midi, dest, o) {
    o = o || {};
    var f = mtof(midi), t0 = o.t0, vel = o.vel == null ? 1 : o.vel;
    if (INST[instId].kind === "sustained") { Lab.play(L, instId, f, t0, Infinity, vel, dest, { bus: o.bus }); return; }
    var next = t0 + (o.offset || 0), period = o.period || 2.4;
    L.sched(function (upTo) {
      while (next < upTo) { Lab.play(L, instId, f, next, 0, vel, dest, { bus: o.bus }); next += period * rnd(0.93, 1.07); }
    });
  }
  function start() { return ac().currentTime + 0.1; }

  /* ---------- 1. Two voices (the original exercise, with every instrument) ---------- */
  function buildDuo(L, p) {
    var t0 = start();
    [0, 1].forEach(function (i) {
      var id = i ? p.iB : p.iA, lvl = 0.35 * (i ? p.bal : 1), sign = (i && p.move === "opposite") ? -1 : 1;
      var rate = p.rate * (i && p.move === "drift" ? 1.6 : 1);   // different speeds wander in and out of step
      var out = gainNode(lvl), bus = null;
      if (p.what === "pitch" && p.depth > 0) { bus = gainNode(sign * p.depth * 400); chain(L.osc("sine", rate), bus); }   // cents, up to a third of an octave
      if (p.what === "volume" && p.depth > 0) chain(L.osc("sine", rate), gainNode(sign * lvl * p.depth * 0.9), out.gain);
      chain(out, u.pan(i ? p.spread : -p.spread), L.out);
      hold(L, id, i ? p.nB : p.nA, out, { t0: t0, bus: bus, period: 2.3 + i * 0.7, offset: i * 1.1 });
    });
  }

  /* ---------- 2. Hidden overtone (the bowl) ---------- */
  function buildHidden(L, p) {
    var t0 = start(), f = mtof(Lab.actualMidi(p.inst, p.note)), out = gainNode(0.35), amp = 0.25 * 1.4142 * Math.pow(10, (-8 - p.hide * 44) / 20);
    chain(out, u.pan({ c: 0, l: -0.9, r: 0.9 }[p.side] || 0), L.out);
    hold(L, p.inst, p.note, out, { t0: t0 });
    var o = L.osc("sine", f * p.ratio), hg = gainNode(0), rv = gainNode(0);   // the quiet partner: a pure harmonic of the same note
    chain(o, hg, out); chain(o, rv, out);
    L.reveal = function (on) { rv.gain.setTargetAtTime(on ? amp * 5 : 0, ac().currentTime, 0.15); };   // a separate path, so it never disturbs the swells
    if (p.show === "always") { hg.gain.value = amp; return; }
    // comes and goes: swells in over a few seconds, stays a moment, fades, then a long silence before the next
    var next = t0 + rnd(9, 15);
    L.sched(function (upTo) {
      while (next < upTo) {
        var s = next;
        hg.gain.setValueAtTime(0, s); hg.gain.linearRampToValueAtTime(amp, s + 3); hg.gain.linearRampToValueAtTime(amp, s + 6); hg.gain.linearRampToValueAtTime(0, s + 9);
        L.events.push({ a: s + 1, b: s + 10, hit: false });
        next = s + 9 + rnd(10, 26);
      }
    });
    // taps from the page are scored against when the overtone was actually there
    L.score = { hits: 0, misses: 0, extra: 0 };
    L.tap = function () {
      var now = ac().currentTime, e = L.events.filter(function (v) { return now >= v.a && now <= v.b; })[0];
      if (e && !e.hit) { e.hit = true; L.score.hits++; return "hit"; }
      L.score.extra++; return "extra";
    };
    L.tally = function () {
      var now = ac().currentTime;
      L.score.misses = L.events.filter(function (v) { return v.b < now - 1 && !v.hit; }).length;
      return L.score;
    };
  }

  /* ---------- 3. Call and response ---------- */
  var SCALES = {
    pent: { n: "Major pentatonic", s: [0, 2, 4, 7, 9] }, minor: { n: "Minor pentatonic", s: [0, 3, 5, 7, 10] },
    hira: { n: "Hirajōshi (Japanese)", s: [0, 2, 3, 7, 8] }, dorian: { n: "Dorian", s: [0, 2, 3, 5, 7, 9, 10] },
    whole: { n: "Whole tone (dreamy)", s: [0, 2, 4, 6, 8, 10] }
  };
  function scaleNotes(root, steps, lo, hi) {
    var out = [];
    for (var o = -2; o <= 3; o++) steps.forEach(function (s) { var m = root + o * 12 + s; if (m >= root + lo && m <= root + hi) out.push(m); });
    return out.sort(function (a, b) { return a - b; });
  }
  function walk(len, count) {   // a gentle random walk over the scale, which is what makes it sound like a phrase
    var i = Math.floor(count * rnd(0.3, 0.7)), r = [];
    for (var k = 0; k < len; k++) {
      r.push(i);
      var d = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
      i = Math.max(0, Math.min(count - 1, i + d));
    }
    return r;
  }
  function buildAnswer(L, p) {
    var t0 = start(), sc = SCALES[p.scale].s, A = scaleNotes(p.root, sc, 0, 19), B = A.map(function (m) { return m - 12; });
    var oa = gainNode(0.35), ob = gainNode(0.35 * p.bal);
    chain(oa, u.pan(-p.spread), L.out); chain(ob, u.pan(p.spread), L.out);
    if (p.ground !== "none") { var og = gainNode(0.3); chain(og, L.out); hold(L, p.ground, p.root - 12, og, { t0: t0, period: 3.2 }); }
    var tcur = t0 + 0.5;
    function phrase(inst, dest, list, idx, t, step) {
      idx.forEach(function (ix, k) {
        var dur = INST[inst].kind === "sustained" ? step * 1.35 : 0;
        Lab.play(L, inst, mtof(list[ix]), t + k * step, dur, rnd(0.75, 1), dest);
      });
    }
    L.sched(function (upTo) {
      while (tcur < upTo) {
        var n = p.len, step = p.step, gap = p.rest * step, pa = walk(n, A.length), pb;
        phrase(p.iA, oa, A, pa, tcur, step);
        if (p.pattern === "overlap") { pb = walk(n, A.length); phrase(p.iB, ob, B, pb, tcur + step / 2, step); tcur += n * step + gap; }
        else {
          pb = p.pattern === "echo" ? pa : walk(n, A.length).slice(0, n - 1).concat([0]);   // an answer lands back at home
          phrase(p.iB, ob, B, pb, tcur + n * step + step * 0.3, step);
          tcur += 2 * n * step + step * 0.3 + gap;
        }
      }
    });
  }

  /* ---------- 4. Two rhythms ---------- */
  function buildRhythm(L, p) {
    var t0 = start() + 0.2, pent = SCALES.pent.s, voices = [
      { inst: p.iA, n: p.nA, midi: p.mA, pan: -p.spread, lvl: 0.35 },
      { inst: p.iB, n: p.nB, midi: p.mB, pan: p.spread, lvl: 0.35 * p.bal }
    ];
    function degree(d) { return pent[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5); }
    function pitchFor(v, i) {
      var d = p.figure === "climb" ? i : p.figure === "rock" ? (i % 2 ? 2 : 0) : 0;
      return v.midi + degree(d);
    }
    voices.forEach(function (v) {
      var dest = gainNode(v.lvl), k = 0, gap = p.cycle / v.n, sustained = INST[v.inst].kind === "sustained";
      chain(dest, u.pan(v.pan), L.out);
      L.sched(function (upTo) {
        while (t0 + k * gap < upTo) {
          var i = k % v.n;
          Lab.play(L, v.inst, mtof(pitchFor(v, i)), t0 + k * gap, sustained ? Math.max(0.25, gap * 0.55) : 0, i === 0 ? 1 : 0.62, dest);
          k++;
        }
      });
    });
  }

  /* ---------- 5. Orbit (one steady, one moving through space) ---------- */
  function spatial() {
    // Real 3D placement (HRTF) when the browser has it. It sounds like a place in the room, not just left and right.
    var a = ac(), s = { move: null, node: null };
    if (a.createPanner && a.createPanner().positionX) {
      var pn = a.createPanner(); pn.panningModel = "HRTF"; pn.distanceModel = "inverse"; pn.refDistance = 1; pn.rolloffFactor = 0.6;
      s.node = pn;
      s.move = function (x, z, t) { pn.positionX.linearRampToValueAtTime(x, t); pn.positionZ.linearRampToValueAtTime(z, t); };
      s.set = function (x, z, t) { pn.positionX.setValueAtTime(x, t); pn.positionZ.setValueAtTime(z, t); pn.positionY.value = 0; };
    } else {
      var sp = u.pan(0); s.node = sp;
      s.move = function (x, z, t) { sp.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, x / 1.5)), t); };
      s.set = function (x, z, t) { sp.pan.setValueAtTime(Math.max(-1, Math.min(1, x / 1.5)), t); };
    }
    return s;
  }
  var PATHS = {
    circle: function (th, r) { return [Math.sin(th) * r, -Math.cos(th) * r]; },                 // all the way round the head, front to right to back to left
    sweep:  function (th, r) { return [Math.sin(th) * r * 1.3, -r * 0.8]; },                    // left to right across the front
    wander: function (th, r) { return [Math.sin(th) * r * 0.9 + Math.sin(th * 2.618) * r * 0.5, -Math.cos(th * 1.414 + 1) * r * 0.9]; }   // an unpredictable drift
  };
  var FIXED = { centre: [0, -0.01], left: [-1.4, -0.3], right: [1.4, -0.3], behind: [0, 1.4] };
  function buildOrbit(L, p) {
    var t0 = start(), fx = spatial(), mv = spatial(), fpos = FIXED[p.fixed];
    fx.set(fpos[0], fpos[1], t0);
    var og = gainNode(0.35), om = gainNode(0.35 * p.bal);
    chain(og, fx.node, L.out); chain(om, mv.node, L.out);
    hold(L, p.iA, p.nA, og, { t0: t0, period: 2.4 });
    hold(L, p.iB, p.nB, om, { t0: t0, period: 2.9, offset: 1.2 });
    var path = PATHS[p.path], dir = p.dir === "ccw" ? -1 : 1, k = 0, STEP = 0.05, p0 = path(0, p.radius);
    mv.set(p0[0], p0[1], t0);
    L.sched(function (upTo) {
      while (t0 + k * STEP < upTo) {
        k++;
        var t = t0 + k * STEP, xz = path(dir * 2 * Math.PI * (k * STEP) / p.period, p.radius);
        mv.move(xz[0], xz[1], t);
      }
    });
  }

  /* ---------- 6. Endless rise (a Shepard-Risset glissando) ---------- */
  function buildRise(L, p) {
    var t0 = start(), N = 7, fmin = mtof(p.note), out = gainNode(0.5), dir = p.dir === "down" ? -1 : 1, oct = p.speed / 60, parts = [];
    chain(out, u.pan(p.anchorOn ? p.spread : 0), L.out);
    // N sine tones, an octave apart, all gliding the same way. Each fades in at the bottom and out at the top,
    // so the ear never finds the end: it climbs and climbs and gets nowhere.
    for (var i = 0; i < N; i++) {
      var o = L.osc("sine", fmin), g = gainNode(0);
      chain(o, g, out); parts.push({ o: o, g: g, i: i });
    }
    function pos(i, t) { var x = (i / N + dir * oct * t / N) % 1; return x < 0 ? x + 1 : x; }
    function hann(x) { return 0.5 - 0.5 * Math.cos(2 * Math.PI * x); }
    function fr(x) { return fmin * Math.pow(2, N * x); }
    var tc = 0, DT = 0.2;
    parts.forEach(function (q) { var x = pos(q.i, 0); q.o.frequency.setValueAtTime(fr(x), t0); q.g.gain.setValueAtTime(0.16 * hann(x), t0); });
    L.sched(function (upTo) {
      while (t0 + tc < upTo) {
        var ts = t0 + tc, te = ts + DT;
        parts.forEach(function (q) {
          var x0 = pos(q.i, tc), x1 = pos(q.i, tc + DT), wrapped = dir > 0 ? x1 < x0 : x1 > x0;
          if (wrapped) { q.o.frequency.setValueAtTime(fr(x0), ts); q.g.gain.setValueAtTime(0, ts); q.o.frequency.setValueAtTime(fr(x1), te); q.g.gain.setValueAtTime(0.16 * hann(x1), te); }
          else { q.o.frequency.exponentialRampToValueAtTime(fr(x1), te); q.g.gain.linearRampToValueAtTime(0.16 * hann(x1), te); }
        });
        tc += DT;
      }
    });
    if (p.anchorOn) {
      var ag = gainNode(0.35); chain(ag, u.pan(-p.spread), L.out);
      hold(L, p.iA, p.nA, ag, { t0: t0, period: 2.6 });
    }
  }

  /* ---------- 7. Binaural beat ---------- */
  function buildBinaural(L, p) {
    var t0 = start(), f = mtof(p.note);
    // A slightly different pitch in each ear. Nothing in the air is pulsing, the beat only exists in your head.
    [0, 1].forEach(function (i) {
      var g = gainNode(0.4); chain(g, u.pan(i ? 1 : -1), L.out);
      Lab.play(L, p.inst, f + (i ? p.beat : 0), t0, Infinity, 1, g);
    });
    if (p.iC !== "none") { var cg = gainNode(0.3 * p.bal); chain(cg, L.out); hold(L, p.iC, p.nC, cg, { t0: t0, period: 3.1 }); }
  }
  var BEAT_BANDS = function (v) { v = +v; return v.toFixed(1) + " Hz · " + (v < 4 ? "delta" : v < 8 ? "theta" : v < 13 ? "alpha" : "beta"); };

  /* ---------- the list ---------- */
  Lab.MODES = [
    {
      id: "duo", name: "Two voices", blurb: "Hold two sounds at once. The classic.",
      listen: "Keep hearing both. When one slips away, notice, and bring it back.",
      build: buildDuo,
      controls: [
        inst("iA", "Voice 1 sound"), note("nA", "Voice 1 pitch"), inst("iB", "Voice 2 sound"), note("nB", "Voice 2 pitch"),
        rng("bal", "Voice 2 loudness", 0, 1.5, 0.01, pct), rng("spread", "Ear separation", 0, 1, 0.01, pct),
        sel("what", "Each one slowly changes its…", { volume: "Volume", pitch: "Pitch", none: "Nothing (steady)" }),
        sel("move", "Voices move…", { drift: "Each on its own", sync: "Together (in sync)", opposite: "Opposite (out of sync)" }),
        rng("depth", "How much", 0, 1, 0.01, pct), rng("rate", "How fast", 0.02, 0.4, 0.01, function (v) { return (+v).toFixed(2) + " Hz"; })
      ],
      defaults: { iA: "flute", nA: 57, iB: "cello", nB: 64, bal: 0.9, spread: 0.6, what: "volume", move: "drift", depth: 0.3, rate: 0.1 },
      presets: [
        { n: "Flute and cello", note: "Two different instruments, a fifth apart. Easy to tell apart.", v: {} },
        { n: "Bowl and voice", note: "Both warm and sustained. They blend, so it takes more listening.", v: { iA: "bowl", nA: 52, iB: "voice", nB: 59, spread: 0.3, depth: 0.4 } },
        { n: "Same sound, close", note: "Hard: one sound, close together, in the middle. The quieter one keeps slipping.", v: { iA: "pure", nA: 57, iB: "pure", nB: 62, bal: 0.5, spread: 0, depth: 0.5 } },
        { n: "Glide together", note: "Both slide higher and lower together, keeping their distance.", v: { iA: "clarinet", nA: 55, iB: "flute", nB: 62, what: "pitch", move: "sync", rate: 0.08, depth: 0.4 } },
        { n: "Glide apart", note: "One slides up while the other slides down, then back.", v: { iA: "cello", nA: 52, iB: "flute", nB: 62, what: "pitch", move: "opposite", rate: 0.08, depth: 0.4 } },
        { n: "Pulse and drone", note: "A struck note repeating over a held one.", v: { iA: "drone", nA: 45, iB: "kalimba", nB: 69, spread: 0.5, what: "volume", depth: 0.2 } }
      ]
    },
    {
      id: "hidden", name: "Hidden overtone", blurb: "One note, and a much quieter harmonic inside it.",
      listen: "Behind the main note there is a faint pure tone that fades in and out. Tap when you hear it. Hold “Show me” to hear what you’re looking for.",
      build: buildHidden,
      controls: [
        inst("inst", "Main sound", { kinds: "sustained" }), note("note", "Note", 36, 72),
        sel("ratio", "Hidden tone is…", { 2: "An octave up", 3: "An octave and a fifth up", 4: "Two octaves up", 5: "Two octaves and a third up", 6: "Two octaves and a fifth up" }),
        rng("hide", "How well hidden", 0, 1, 0.01, function (v) { return v < 0.3 ? "Easy" : v < 0.6 ? "Medium" : v < 0.85 ? "Hard" : "Barely there"; }),
        sel("show", "The hidden tone", { events: "Comes and goes (tap when you hear it)", always: "Always there, very quiet" }),
        sel("side", "Where it sits", { c: "With the main note", l: "Left", r: "Right" })
      ],
      defaults: { inst: "bowl", note: 50, ratio: 3, hide: 0.45, show: "events", side: "c" },
      presets: [
        { n: "Bowl", note: "A singing bowl with a faint harmonic swelling in and out.", v: {} },
        { n: "Crystal, higher", note: "A brighter bowl, with the hidden tone two octaves up.", v: { inst: "crystal", note: 55, ratio: 4, hide: 0.4 } },
        { n: "Under a voice", note: "A sung note with a faint tone above. Harder, the voice is busy.", v: { inst: "voice", note: 52, ratio: 3, hide: 0.5 } },
        { n: "Always there", note: "It never leaves, it’s just very quiet. Can you keep it in your attention?", v: { show: "always", hide: 0.55 } },
        { n: "Barely there", note: "As quiet as it goes. Expect to lose it.", v: { hide: 0.85 } }
      ]
    },
    {
      id: "answer", name: "Call and response", blurb: "Two instruments take turns, like a conversation.",
      listen: "Follow one instrument’s line, and notice what the other one does with it.",
      build: buildAnswer,
      controls: [
        inst("iA", "Instrument 1 (higher)"), inst("iB", "Instrument 2 (lower)"), note("root", "Home note", 40, 64),
        sel("scale", "Scale", Object.keys(SCALES).reduce(function (o, k) { o[k] = SCALES[k].n; return o; }, {})),
        sel("pattern", "They…", { echo: "Echo each other", answer: "Answer each other", overlap: "Play over each other" }),
        rng("len", "Phrase length", 2, 6, 1, function (v) { return v + " notes"; }), rng("step", "Speed", 0.6, 3, 0.05, function (v) { return (+v).toFixed(2) + " s per note"; }),
        rng("rest", "Silence between", 0, 4, 0.5, function (v) { return v + " beats"; }),
        rng("bal", "Instrument 2 loudness", 0, 1.5, 0.01, pct), rng("spread", "Ear separation", 0, 1, 0.01, pct),
        inst("ground", "Drone underneath", { kinds: "sustained", none: true })
      ],
      defaults: { iA: "flute", iB: "marimba", root: 57, scale: "pent", pattern: "answer", len: 4, step: 1.1, rest: 1, bal: 1, spread: 0.6, ground: "none" },
      presets: [
        { n: "Flute and marimba", note: "Pentatonic, so every note works with every other. Nothing can sound wrong.", v: {} },
        { n: "Echo", note: "The second instrument repeats each phrase, an octave lower.", v: { pattern: "echo", iA: "harp", iB: "cello" } },
        { n: "Over each other", note: "Two lines at once, offset. Hold both.", v: { pattern: "overlap", iA: "flute", iB: "kalimba", step: 1.4, rest: 2 } },
        { n: "Japanese garden", note: "Hirajōshi scale with a low drone.", v: { scale: "hira", iA: "harp", iB: "flute", ground: "drone", step: 1.6, root: 55 } },
        { n: "Slow and dreamy", note: "Whole-tone scale, voices and bowls.", v: { scale: "whole", iA: "voice", iB: "crystal", step: 2.4, rest: 2, ground: "bowl" } }
      ]
    },
    {
      id: "rhythm", name: "Two rhythms", blurb: "Two patterns that never line up the same way.",
      listen: "Follow one pattern with your whole attention, and still know the other one is there.",
      build: buildRhythm,
      controls: [
        inst("iA", "Pattern 1 sound"), note("mA", "Pattern 1 pitch", 48, 84), rng("nA", "Pattern 1 beats", 1, 9, 1, String),
        inst("iB", "Pattern 2 sound"), note("mB", "Pattern 2 pitch", 48, 84), rng("nB", "Pattern 2 beats", 1, 9, 1, String),
        rng("cycle", "Cycle length", 2, 12, 0.5, secs),
        sel("figure", "Each pattern plays…", { same: "One note", climb: "Climbing notes", rock: "Two notes, rocking" }),
        rng("bal", "Pattern 2 loudness", 0, 1.5, 0.01, pct), rng("spread", "Ear separation", 0, 1, 0.01, pct)
      ],
      defaults: { iA: "kalimba", mA: 57, nA: 3, iB: "marimba", mB: 69, nB: 4, cycle: 6, figure: "same", bal: 1, spread: 0.7 },
      presets: [
        { n: "Three against four", note: "The classic. They only meet at the start of each cycle.", v: {} },
        { n: "Two against three", note: "Easier. A lilting, swinging feel.", v: { nA: 2, nB: 3, cycle: 4 } },
        { n: "Four against five", note: "Hard. You’ll keep losing your place in one of them.", v: { nA: 4, nB: 5, cycle: 8 } },
        { n: "Climbing figures", note: "Each pattern climbs its own little scale.", v: { nA: 3, nB: 4, figure: "climb", iA: "harp", iB: "kalimba", mA: 52, mB: 64 } },
        { n: "Handpan and bell", note: "Slow and spacious.", v: { iA: "handpan", iB: "bell", mA: 50, mB: 72, nA: 3, nB: 2, cycle: 9, figure: "same" } }
      ]
    },
    {
      id: "orbit", name: "Orbit", blurb: "One sound stays put. Another moves around you.",
      listen: "Keep one sound fixed in its place in your mind, and track the other as it travels.",
      headphones: true,
      build: buildOrbit,
      controls: [
        inst("iA", "Steady sound"), note("nA", "Steady pitch"), sel("fixed", "It sits…", { centre: "In the middle", left: "On the left", right: "On the right", behind: "Behind you" }),
        inst("iB", "Moving sound"), note("nB", "Moving pitch"), sel("path", "It travels…", { circle: "All the way around", sweep: "Side to side in front", wander: "Wandering" }),
        sel("dir", "Direction", { cw: "Clockwise", ccw: "Counter-clockwise" }),
        rng("period", "Time for one trip", 6, 60, 1, secs), rng("radius", "Distance", 0.6, 3, 0.1, function (v) { return (+v).toFixed(1); }),
        rng("bal", "Moving sound loudness", 0, 1.5, 0.01, pct)
      ],
      defaults: { iA: "bowl", nA: 45, fixed: "centre", iB: "flute", nB: 64, path: "circle", dir: "cw", period: 20, radius: 1.4, bal: 1 },
      presets: [
        { n: "Around you", note: "A flute circling your head, over a bowl in the middle.", v: {} },
        { n: "Side to side", note: "A kalimba sweeping across the front.", v: { iB: "kalimba", nB: 69, path: "sweep", period: 10 } },
        { n: "Wandering voice", note: "Unpredictable. You can’t anticipate where it goes.", v: { iB: "voice", nB: 62, path: "wander", period: 25, iA: "drone", nA: 45 } },
        { n: "Behind and around", note: "The steady sound is behind you. Keep it there.", v: { fixed: "behind", iA: "cello", nA: 48, iB: "harp", nB: 66, period: 16 } }
      ]
    },
    {
      id: "rise", name: "Endless rise", blurb: "A tone that climbs forever and never gets higher.",
      listen: "The glide keeps rising but never gets anywhere. Hold the steady note against it, and see how long you can keep both in mind.",
      build: buildRise,
      controls: [
        sel("dir", "Direction", { up: "Rising", down: "Falling" }), rng("speed", "Speed", 3, 40, 1, function (v) { return v + " octaves a minute"; }),
        note("note", "Lowest pitch", 24, 48),
        sel("anchorOn", "A steady note alongside", { true: "Yes", "": "No" }),
        inst("iA", "Steady note sound"), note("nA", "Steady note pitch"), rng("spread", "Ear separation", 0, 1, 0.01, pct)
      ],
      defaults: { dir: "up", speed: 10, note: 30, anchorOn: true, iA: "bowl", nA: 52, spread: 0.6 },
      presets: [
        { n: "Slow rise", note: "A very slow, hypnotic climb with a bowl to hold on to.", v: {} },
        { n: "Falling", note: "The same, going down.", v: { dir: "down", speed: 8 } },
        { n: "Faster", note: "Quicker, with a clarinet as the anchor.", v: { speed: 24, iA: "clarinet", nA: 55 } },
        { n: "On its own", note: "No anchor. Just the endless climb.", v: { anchorOn: "" } }
      ]
    },
    {
      id: "binaural", name: "Binaural beat", blurb: "A different pitch in each ear makes a pulse that isn’t really there.",
      listen: "Nothing in the room is pulsing. The slow throb is made inside your head, from the two ears disagreeing. Listen to it, and to the steady note.",
      headphones: true,
      build: buildBinaural,
      controls: [
        inst("inst", "Sound", { only: ["pure", "soft", "organ", "clarinet_syn"] }), note("note", "Pitch", 36, 72),
        rng("beat", "Beat speed", 1, 20, 0.5, BEAT_BANDS),
        inst("iC", "A steady note in the middle", { kinds: "sustained", none: true }), note("nC", "Its pitch", 36, 84), rng("bal", "Its loudness", 0, 1.5, 0.01, pct)
      ],
      defaults: { inst: "soft", note: 48, beat: 6, iC: "bowl", nC: 60, bal: 0.8 },
      presets: [
        { n: "Slow throb", note: "About 6 Hz. A slow pulse with a bowl in the middle.", v: {} },
        { n: "Very slow", note: "2 Hz, almost a breathing rhythm.", v: { beat: 2 } },
        { n: "Quicker flutter", note: "10 Hz, a rapid shimmer.", v: { beat: 10 } },
        { n: "Just the beat", note: "No steady note, only the phantom pulse.", v: { iC: "none" } }
      ]
    }
  ];
  Lab.mode = function (id) { return Lab.MODES.filter(function (m) { return m.id === id; })[0]; };

  // Which instruments does this setup use? Recorded ones are fetched the first time they're needed.
  Lab.ready = function (params) {
    return Lab.load(Object.keys(params).map(function (k) { return params[k]; }).filter(function (v) { return typeof v === "string" && INST[v]; }));
  };

  /* Build a mode's sound as a running layer. Replaces whatever was playing, with a short crossfade. */
  var current = null;
  Lab.start = function (id, params) {
    var m = Lab.mode(id), L = Lab.layer(), p = {};
    Object.keys(m.defaults).forEach(function (k) { p[k] = params && params[k] != null ? params[k] : m.defaults[k]; });
    ["ratio", "nA", "nB", "mA", "mB", "len", "root", "note", "nC", "beat", "step", "rest", "cycle", "hide", "bal", "spread", "depth", "rate", "speed", "period", "radius"].forEach(function (k) { if (k in p) p[k] = +p[k]; });
    p.anchorOn = p.anchorOn === true || p.anchorOn === "true";
    m.build(L, p);
    Lab.fadeIn(L, 1.5);
    if (current) Lab.retire(current, 0.9);
    current = L;
    return L;
  };
  Lab.stop = function () { if (current) { Lab.retire(current, 0.9); current = null; } };
  Lab.current = function () { return current; };

  /* Render a mode offline, for testing: returns a Promise of an AudioBuffer. */
  Lab.render = function (id, params, seconds) {
    var ctx = new OfflineAudioContext(2, Math.round(44100 * seconds), 44100);
    Lab.useContext(ctx, { offline: true });
    var m = Lab.mode(id), p = Object.assign({}, m.defaults, params);
    return Lab.ready(p).then(function () {
      var L = Lab.start(id, params);
      L.out.gain.value = 1;
      L.run(seconds);
      return ctx.startRendering().then(function (buf) { Lab.stop(); return buf; });
    });
  };
})(window);
