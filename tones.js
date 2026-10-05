/* Come back: the two listening exercises, built on the held instruments in instruments.js.

   Two voices      two steady sounds at once. Hold both in mind.
   Hidden overtone one held note with a much quieter pure tone hidden inside it. It can sit there the whole time, or come
                   and go. Then a tap answers by sound: a small ding when the tone was there, a wooden knock when it
                   wasn't. A visit you let slip by makes no sound; the app just counts it. */
(function (global) {
  "use strict";
  var Lab = global.Lab, u = Lab.u, INST = Lab.INST, mtof = Lab.mtof;
  var gainNode = u.gain, filt = u.filt, chain = u.chain, rnd = u.rnd;
  var T = Lab.Tones = { last: null };
  function ac() { return Lab.ac(); }

  // Anything that isn't a held instrument (an old saved setting, a recording that couldn't be listed) falls back to something that is.
  T.held = function (id) {
    if (INST[id] && INST[id].kind === "sustained") return id;
    if (INST[id + "_syn"]) return id + "_syn";
    return "pure";
  };

  /* ---------- two voices ---------- */
  T.duo = function (L, p) {
    var t0 = ac().currentTime + 0.1;
    [0, 1].forEach(function (i) {
      var id = T.held(i ? p.iB : p.iA), midi = i ? p.nB : p.nA, lvl = 0.35 * (i ? p.bal : 1);
      var sign = (i && p.move === "opposite") ? -1 : 1, rate = p.rate * (i && p.move === "drift" ? 1.6 : 1);   // different speeds wander in and out of step
      var out = gainNode(lvl), bus = null;
      if (p.what === "pitch" && p.depth > 0) { bus = gainNode(sign * p.depth * 400); chain(L.osc("sine", rate), bus); }   // in cents: up to about a third of an octave each way
      if (p.what === "volume" && p.depth > 0) chain(L.osc("sine", rate), gainNode(sign * lvl * p.depth * 0.9), out.gain);
      chain(out, u.pan(i ? p.spread : -p.spread), L.out);
      Lab.play(L, id, mtof(Lab.actualMidi(id, midi)), t0, Infinity, 1, out, { bus: bus });
    });
  };

  /* ---------- hidden overtone ---------- */
  // db: how far below the main note the hidden tone sits. Easy is meant to be obvious, so you can learn what you are listening for;
  // each step down is about 8 dB quieter. gap: the usual silence between visits, a range in seconds (the real gaps vary a lot more, see below).
  T.DIFF = {
    easy:     { name: "Easy",         db: -6,  hold: 6, gap: [8, 14] },
    medium:   { name: "Medium",       db: -14, hold: 5, gap: [10, 20] },
    hard:     { name: "Hard",         db: -22, hold: 4, gap: [12, 24] },
    veryhard: { name: "Very hard",    db: -30, hold: 3, gap: [14, 28] },
    barely:   { name: "Barely there", db: -38, hold: 3, gap: [14, 30] }
  };

  T.hidden = function (L, p, hooks) {
    hooks = hooks || {};
    var D = T.DIFF[p.hDiff] || T.DIFF.medium, t0 = ac().currentTime + 0.1;
    var id = T.held(p.hInst), midi = Lab.actualMidi(id, p.hNote), f = mtof(midi);
    var out = gainNode(0.35), level = function (db) { return 0.5 * 1.4142 * Math.pow(10, db / 20); }, amp = level(D.db);
    chain(out, u.pan({ c: 0, l: -0.9, r: 0.9 }[p.hSide] || 0), L.out);
    // A note made of harmonics (an organ, a triangle wave, a buzz) already has energy at exactly the pitch the hidden tone
    // lands on, so the tone would just merge into it and never stand out. A narrow notch there clears the space, so the
    // hidden tone is a separate thing that appears and disappears.
    var held = out;
    if (hooks.notch !== false) { held = filt("notch", f * p.hRatio, 14); held.connect(out); }
    Lab.play(L, id, f, t0, Infinity, 1, held);

    // the quiet partner: a pure harmonic of the same note
    var o = L.osc("sine", f * p.hRatio), hg = gainNode(0), rv = gainNode(0);
    chain(o, hg, out); chain(o, rv, out);
    // "show me": a separate louder path, so it never disturbs the scheduled swells
    L.reveal = function (on) { rv.gain.setTargetAtTime(on ? level(T.DIFF.easy.db) : 0, ac().currentTime, 0.15); };   // as clear as Easy

    L.events = [];
    if (p.hShow !== "events") { hg.gain.value = amp; L.tap = null; return; }

    // Comes and goes, with no pattern to find: it can sit silent for a long while, then come, or come twice in a row.
    var timers = [];
    // if it came and went and you never tapped, say so, gently (each visit keeps its own watch)
    function watch(e) {
      timers.push(setTimeout(function () { if (L.alive && !e.hit && hooks.miss) hooks.miss(); }, Math.max(0, (e.b + 0.5 - ac().currentTime) * 1000)));
    }
    function nextGap() {   // seconds of silence after a visit has faded
      var u = Math.random();
      if (u < 0.22) return rnd(1.5, 5);                          // soon: sometimes it comes again right away
      if (u < 0.7) return rnd(D.gap[0], D.gap[1]);               // the usual
      return rnd(D.gap[1], D.gap[1] * 3.2);                      // a long wait
    }
    var next = t0 + (hooks.preview ? rnd(3, 5) : rnd(4, 30));
    L.sched(function (upTo) {
      while (next < upTo) {
        var s = next, ramp = rnd(2.2, 4), hold = D.hold * rnd(0.7, 1.4), len = 2 * ramp + hold;
        var e = { a: s + 1, b: s + len + 1, hit: false };   // you can answer from a second in until a second after it has gone
        hg.gain.setValueAtTime(0, s);
        hg.gain.linearRampToValueAtTime(amp, s + ramp);
        hg.gain.linearRampToValueAtTime(amp, s + ramp + hold);
        hg.gain.linearRampToValueAtTime(0, s + len);
        L.events.push(e);
        watch(e);
        next = s + len + nextGap();
      }
      var now = ac().currentTime;
      L.events = L.events.filter(function (v) { return v.b > now - 30; });
    });
    var baseStop = L.stop;
    L.stop = function () { timers.forEach(clearTimeout); baseStop(); };

    // returns "hit" (it was there), "again" (you already caught this visit) or "nothing" (it wasn't there)
    L.tap = function () {
      var now = ac().currentTime, e = L.events.filter(function (v) { return now >= v.a && now <= v.b; })[0];
      if (!e) return "nothing";
      if (e.hit) return "again";
      e.hit = true; return "hit";
    };
  };

  /* ---------- feedback sounds ---------- */
  // Both go through the same output as the tones, so they follow the volume setting.
  function bus() { return Lab.master(); }
  function osc(type, f, t) { var o = ac().createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); return o; }
  function env(t, peak, secs, attack) {
    var g = ac().createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + (attack || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    return g;
  }
  // a small bright ding, like a tiny bell
  T.ding = function () {
    var a = ac(); if (!a) return;
    var t = a.currentTime + 0.01;
    [[1320, 0.22, 1.1], [1320 * 2.76, 0.07, 0.4]].forEach(function (h) {
      var o = osc("sine", h[0], t), g = env(t, h[1], h[2]);
      o.connect(g); g.connect(bus()); o.start(t); o.stop(t + h[2] + 0.05);
    });
  };
  // a soft wooden knock: two short, dull, slightly out-of-tune tones and a tiny tick of noise
  T.clank = function () {
    var a = ac(); if (!a) return;
    var t = a.currentTime + 0.01;
    [[330, 0.3, 0.16], [547, 0.16, 0.1], [861, 0.07, 0.06]].forEach(function (h) {
      var o = osc("sine", h[0], t); o.frequency.exponentialRampToValueAtTime(h[0] * 0.94, t + h[2]);
      var g = env(t, h[1], h[2], 0.002);
      o.connect(g); g.connect(bus()); o.start(t); o.stop(t + h[2] + 0.05);
    });
    var n = a.createBufferSource(), b = a.createBuffer(1, Math.round(a.sampleRate * 0.04), a.sampleRate), d = b.getChannelData(0), i;
    for (i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = b;
    var bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 2;
    var g = env(t, 0.1, 0.035, 0.001);
    n.connect(bp); bp.connect(g); g.connect(bus()); n.start(t);
  };
})(window);
