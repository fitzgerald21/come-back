/* Two-sounds lab: the audio engine and the instrument library.
   Everything is synthesized (no sample files). An instrument is { make(note, freq, out, t), kind, ... }:
   "sustained" ones hold as long as asked (or forever, as a drone); "struck" ones ring and decay by themselves.
   Lab.play() wraps any of them in an envelope, so every mode can use every instrument. */
(function (global) {
  "use strict";
  var Lab = global.Lab = global.Lab || {};
  var AC = null, MASTER = null, NB = {}, WV = {};
  var LOOK = 3;   // seconds of notes scheduled ahead of the audio clock

  /* ---------- notes ---------- */
  var NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  Lab.mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
  Lab.noteName = function (m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };

  /* ---------- context, master bus ---------- */
  Lab.sampleBase = "samples/";   // where the recordings live, relative to the page
  Lab.useContext = function (ctx, opts) {
    opts = opts || {};
    AC = ctx; NB = {}; WV = {}; Lab.offline = !!opts.offline; Lab.fixedGain = !!opts.fixedGain;
    MASTER = AC.createGain();
    var comp = AC.createDynamicsCompressor();   // a safety net so stacked voices never clip
    comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 5; comp.attack.value = 0.01; comp.release.value = 0.4;
    MASTER.connect(comp); comp.connect(opts.dest || AC.destination);
    Lab.setVolume(Lab.vol == null ? 0.7 : Lab.vol);
  };
  Lab.ac = function () { return AC; };
  Lab.master = function () { return MASTER; };
  Lab.setVolume = function (v) {
    Lab.vol = v;
    if (!MASTER) return;
    if (Lab.fixedGain) { MASTER.gain.value = 1; return; }   // inside the app, its own master handles volume
    if (Lab.offline) MASTER.gain.value = v * v * 1.3; else MASTER.gain.setTargetAtTime(v * v * 1.3, AC.currentTime, 0.05);
  };

  /* ---------- small helpers (shared with modes.js) ---------- */
  function gainNode(v) { var g = AC.createGain(); g.gain.value = v; return g; }
  function filt(type, f, q) { var b = AC.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function chain() { for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
  function stereoPan(p) { var n = AC.createStereoPanner ? AC.createStereoPanner() : gainNode(1); if (n.pan) n.pan.value = p; return n; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  Lab.u = { gain: gainNode, filt: filt, chain: chain, pan: stereoPan, rnd: rnd };

  // Looped noise, crossfaded at the seam so it never clicks. Every kind lands at the same loudness.
  function noiseBuf(kind) {
    if (NB[kind]) return NB[kind];
    var sr = AC.sampleRate, N = Math.round(sr * 4), F = Math.round(sr * 0.15), raw = new Float32Array(N + F), i;
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (i = 0; i < N + F; i++) {
      var w = Math.random() * 2 - 1, v;
      if (kind === "white") v = w;
      else {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
      raw[i] = v;
    }
    var buf = AC.createBuffer(1, N, sr), d = buf.getChannelData(0), sum = 0;
    for (i = 0; i < N; i++) { d[i] = i < F ? raw[i] * (i / F) + raw[N + i] * (1 - i / F) : raw[i]; sum += d[i] * d[i]; }
    var k = 0.25 / Math.sqrt(sum / N);
    for (i = 0; i < N; i++) d[i] *= k;
    return (NB[kind] = buf);
  }

  // A tone with a chosen mix of harmonics: wave([1, 0.5, 0.2]) is a fundamental plus a quieter 2nd and 3rd.
  function wave(amps) {
    var key = amps.join(",");
    if (WV[key]) return WV[key];
    var re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1);
    for (var i = 0; i < amps.length; i++) im[i + 1] = amps[i];
    return (WV[key] = AC.createPeriodicWave(re, im));
  }
  function decayGain(t, v, secs) { var g = gainNode(0.0001); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + secs); return g; }

  /* ---------- layers: one running sound, with everything needed to stop it cleanly ---------- */
  Lab.layer = function () {
    var L = { out: gainNode(0), srcs: [], fns: [], alive: true, timer: 0, events: [] };
    L.out.connect(MASTER);
    L.osc = function (type, f) { var o = AC.createOscillator(); o.type = type; o.frequency.value = f; o.start(); L.srcs.push(o); return o; };
    // A scheduler is fn(upTo): put every event earlier than `upTo` on the audio clock, remember your place, return.
    // The audio clock keeps going when a locked phone throttles timers, so we schedule a few seconds ahead.
    L.sched = function (fn) { L.fns.push(fn); fn(AC.currentTime + LOOK); };
    L.run = function (upTo) { L.fns.forEach(function (fn) { fn(upTo); }); };   // for offline rendering
    if (!Lab.offline) L.timer = setInterval(function () { if (L.alive) L.run(AC.currentTime + LOOK); }, 250);
    L.stop = function () {
      L.alive = false; clearInterval(L.timer);
      L.srcs.forEach(function (s) { try { s.stop(); } catch (e) {} });
      try { L.out.disconnect(); } catch (e) {}
    };
    return L;
  };
  Lab.fadeIn = function (L, secs) { if (Lab.offline) L.out.gain.value = 1; else L.out.gain.setTargetAtTime(1, AC.currentTime, secs / 3); };
  Lab.retire = function (L, secs) {
    L.out.gain.setTargetAtTime(0, AC.currentTime, secs / 3);
    setTimeout(L.stop, secs * 1000 + 500);
  };

  /* ---------- instruments ---------- */
  var INST = Lab.INST = {};
  function def(id, name, kind, o) { o.id = id; o.name = name; o.kind = kind; if (o.trim == null) o.trim = 1; INST[id] = o; }

  // Sustained --------------------------------------------------------------------------------------------
  def("pure", "Pure tone", "sustained", { atk: 0.4, rel: 0.5, trim: 0.649, make: function (n, f, out) {
    n.osc("sine", f).connect(out); chain(n.osc("sine", f * 2), gainNode(0.14), out);
  } });
  def("soft", "Soft (triangle)", "sustained", { atk: 0.4, rel: 0.5, trim: 0.744, make: function (n, f, out) {
    chain(n.osc("triangle", f), gainNode(1.1), out);
  } });
  def("organ", "Organ", "sustained", { atk: 0.3, rel: 0.4, trim: 0.559, make: function (n, f, out) {
    [[1, 1], [2, 0.5], [3, 0.3], [4, 0.15]].forEach(function (h) { chain(n.osc("sine", f * h[0]), gainNode(h[1]), out); });
  } });
  def("hollow", "Hollow (square)", "sustained", { atk: 0.4, rel: 0.5, trim: 0.72, make: function (n, f, out) {
    chain(n.osc("square", f), filt("lowpass", f * 3.5, 0.5), gainNode(0.76), out);
  } });
  def("buzz", "Buzzy hum", "sustained", { atk: 0.4, rel: 0.5, trim: 0.75, make: function (n, f, out) {
    chain(n.osc("sawtooth", f), filt("lowpass", Math.min(f * 5, 5000), 0.7), gainNode(1.3), out);
  } });
  def("chime", "Chime", "sustained", { atk: 0.5, rel: 0.6, trim: 0.7, make: function (n, f, out) {
    [[1, 1], [2.76, 0.35], [5.4, 0.12]].forEach(function (h) { chain(n.osc("sine", f * h[0]), gainNode(h[1]), out); });
  } });
  def("flute_syn", "Flute (synth)", "sustained", { atk: 0.28, rel: 0.35, trim: 0.648, make: function (n, f, out) {
    var o = n.osc(null, f, wave([1, 0.22, 0.07, 0.02]));
    n.vib([o], 5.2, 9, 0.6);
    o.connect(out);
    // the breath: noise shaped around the pitch, with a slow flutter
    var br = gainNode(0.5);
    chain(n.noise("pink"), filt("bandpass", f * 2, 1.4), br, out);
    chain(n.lfo(0.37), gainNode(0.25), br.gain);
  } });
  def("clarinet_syn", "Clarinet (synth)", "sustained", { atk: 0.12, rel: 0.2, trim: 0.651, make: function (n, f, out) {
    // a clarinet is nearly all odd harmonics, which is what gives it that hollow, woody sound
    var o = n.osc(null, f, wave([1, 0, 0.5, 0, 0.28, 0, 0.16, 0, 0.09]));
    chain(o, filt("lowpass", Math.min(f * 8, 6000), 0.5), out);
    chain(n.noise("pink"), filt("bandpass", f * 3, 2), gainNode(0.12), out);
  } });
  def("cello_syn", "Cello (synth)", "sustained", { atk: 0.45, rel: 0.5, trim: 0.81, make: function (n, f, out) {
    var lp = filt("lowpass", f * 3.2, 1.1), a = n.osc("sawtooth", f), b = n.osc("sawtooth", f);
    a.detune.value = -5; b.detune.value = 5;
    a.connect(lp); b.connect(lp);
    n.vib([a, b], 5.3, 11, 0.8);
    chain(n.lfo(0.28), gainNode(f * 0.9), lp.frequency);   // the bow pressing a little harder and lighter
    chain(lp, filt("peaking", 230, 0.8), gainNode(0.9), out);
  } });
  function vowel(forms) {
    return function (n, f, out) {
      var src = gainNode(1), saws = [];
      [-9, 0, 9].forEach(function (c) { var o = n.osc("sawtooth", f); o.detune.value = c; o.connect(src); saws.push(o); });
      n.vib(saws, 4.9, 10, 0.7);
      var lp = filt("lowpass", Math.max(3500, f * 6), 0.4); src.connect(lp);
      forms.forEach(function (fm) { chain(lp, filt("bandpass", fm[0], fm[2] || 9), gainNode(fm[1]), out); });
    };
  }
  def("ooh", "Voice: ooh (synth)", "sustained", { atk: 0.6, rel: 0.7, trim: 3.77, make: vowel([[300, 1], [870, 0.35]]) });
  def("aah", "Voice: aah (synth)", "sustained", { atk: 0.5, rel: 0.7, trim: 3.6, make: vowel([[730, 1], [1090, 0.5], [2440, 0.15]]) });
  // Real bowls ring in inharmonic partials, and each partial is a pair of slightly different pitches.
  // That pair is why a singing bowl shimmers and pulses.
  function bowl(parts, swell) {
    return function (n, f, out) {
      var g = gainNode(0.75);
      parts.forEach(function (p) {
        chain(n.osc("sine", f * p[0]), gainNode(p[1] * 0.5), g);
        chain(n.osc("sine", f * p[0] + p[2]), gainNode(p[1] * 0.5), g);
      });
      chain(n.lfo(swell), gainNode(0.25), g.gain);
      g.connect(out);
    };
  }
  def("bowl_syn", "Singing bowl (synth)", "sustained", { atk: 1.2, rel: 1.2, trim: 1.013, make: bowl([[1, 1, 0.45], [2.71, 0.45, 0.7], [5.15, 0.15, 1.1]], 0.09) });
  def("crystal", "Crystal bowl", "sustained", { atk: 1.2, rel: 1.2, trim: 1.229, make: bowl([[1, 1, 0.3], [3.0, 0.22, 0.4], [5.9, 0.06, 0.6]], 0.07) });
  def("drone", "Warm drone", "sustained", { atk: 1.0, rel: 1.0, trim: 0.782, make: function (n, f, out) {
    var lp = filt("lowpass", f * 5, 0.5); n.osc("triangle", f).connect(lp); n.osc("triangle", f * 1.004).connect(lp);
    chain(lp, gainNode(0.7), out);
  } });
  def("breath", "Breathy", "sustained", { atk: 0.8, rel: 0.8, trim: 0.772, make: function (n, f, out) {
    chain(n.noise("pink"), filt("bandpass", f, 4), gainNode(12.5), out);
  } });
  def("whir", "Whir (narrow noise)", "sustained", { atk: 0.8, rel: 0.8, trim: 0.718, make: function (n, f, out) {
    chain(n.noise("pink"), filt("bandpass", f, 14), gainNode(22), out);
  } });

  // Struck ----------------------------------------------------------------------------------------------
  function click(n, t, fc, v, secs) { chain(n.noise("white"), filt("bandpass", fc, 1), decayGain(t, v, secs), n.dest); }
  def("kalimba_syn", "Kalimba (synth)", "struck", { atk: 0.002, decay: 1.9, trim: 1.286, make: function (n, f, out, t) {
    n.dest = out;
    n.osc("sine", f).connect(out);
    chain(n.osc("sine", f * 6.3), decayGain(t, 0.22, 0.09), out);
    chain(n.osc("sine", f * 2.01), decayGain(t, 0.12, 0.5), out);
    click(n, t, 3000, 0.12, 0.02);
  } });
  def("handpan", "Handpan", "struck", { atk: 0.003, decay: 3.4, trim: 1.154, make: function (n, f, out, t) {
    n.dest = out;
    n.osc("sine", f).connect(out);
    chain(n.osc("sine", f * 2), decayGain(t, 0.45, 1.8), out);
    chain(n.osc("sine", f * 3), decayGain(t, 0.14, 0.9), out);
    click(n, t, 500, 0.3, 0.05);
  } });
  def("marimba_syn", "Marimba (synth)", "struck", { atk: 0.002, decay: 0.95, trim: 1.221, make: function (n, f, out, t) {
    n.dest = out;
    n.osc("sine", f).connect(out);
    chain(n.osc("sine", f * 4), decayGain(t, 0.3, 0.25), out);
    chain(n.osc("sine", f * 9.9), decayGain(t, 0.07, 0.06), out);
    click(n, t, 1800, 0.12, 0.015);
  } });
  def("harp_syn", "Harp (synth)", "struck", { atk: 0.003, decay: 2.4, trim: 1.755, make: function (n, f, out, t) {
    var lp = filt("lowpass", f * 10, 0.7);
    lp.frequency.setValueAtTime(f * 10, t); lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.8, 80), t + 0.9);
    chain(n.osc("sawtooth", f), lp, gainNode(0.5), out);
    chain(n.osc("sine", f), gainNode(0.5), out);
  } });
  def("bell", "Bell", "struck", { atk: 0.003, decay: 5, trim: 0.973, make: function (n, f, out, t) {
    n.osc("sine", f).connect(out);
    chain(n.osc("sine", f * 2.76), decayGain(t, 0.35, 2.8), out);
    chain(n.osc("sine", f * 5.4), decayGain(t, 0.12, 1.4), out);
  } });

  Lab.instIds = function (kind) { return Object.keys(INST).filter(function (k) { return !kind || INST[k].kind === kind; }); };

  /* ---------- playing an instrument ----------
     play(L, id, freq, when, seconds, loudness, destination, opts)
     seconds = Infinity holds it as a drone until the layer stops. opts.bus is a node of cents that every oscillator in
     the note follows (this is how a pitch glide moves a voice). */
  Lab.play = function (L, id, f, t, dur, vel, dest, opts) {
    opts = opts || {};
    var I = INST[id], forever = !isFinite(dur), srcs = [], end;
    if (I.sampled && !SAMP[id]) I = INST[I.fallback] || INST.pure;   // not loaded (yet, or at all): use the synthesized version
    var env = gainNode(I.sampled && I.kind === "struck" ? vel * I.trim : 0), g = env.gain;
    var n = {
      bus: opts.bus || null,
      osc: function (type, fr, wv) {
        var o = AC.createOscillator(); if (wv) o.setPeriodicWave(wv); else o.type = type;
        o.frequency.value = fr; if (n.bus) n.bus.connect(o.detune); o.start(t); srcs.push(o); return o;
      },
      lfo: function (rate) { var o = AC.createOscillator(); o.frequency.value = rate; o.start(t); srcs.push(o); return o; },
      noise: function (kind) {
        var s = AC.createBufferSource(); s.buffer = noiseBuf(kind); s.loop = true; s.start(t, Math.random() * s.buffer.duration * 0.9); srcs.push(s); return s;
      },
      vib: function (oscs, rate, cents, delay) {   // vibrato that begins a moment after the note, like a player's
        var l = n.lfo(rate), d = gainNode(0); d.gain.setValueAtTime(0, t); d.gain.linearRampToValueAtTime(cents, t + delay + 1.5);
        l.connect(d); oscs.forEach(function (o) { d.connect(o.detune); });
      }
    };
    n.keep = function (src) { if (forever) L.srcs.push(src); else srcs.push(src); };   // sources made later by a loop scheduler
    var made = I.make(n, f, env, t, { dur: dur, forever: forever, L: L });
    vel *= I.trim;
    if (I.sampled && I.kind === "struck") {
      end = made.end;   // a recording carries its own attack and decay
    } else if (I.kind === "struck") {
      g.setValueAtTime(0, t);
      var d = I.decay * (opts.decayScale || 1);
      g.linearRampToValueAtTime(vel, t + I.atk); g.exponentialRampToValueAtTime(0.0001, t + I.atk + d); end = t + I.atk + d + 0.1;
    } else {
      var a = opts.atk || I.atk, rel = opts.rel || I.rel;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(vel, t + a);
      if (!forever) { g.setValueAtTime(vel, t + Math.max(a, dur)); g.linearRampToValueAtTime(0, t + Math.max(a, dur) + rel); end = t + Math.max(a, dur) + rel + 0.05; }
    }
    if (forever) srcs.forEach(function (s) { L.srcs.push(s); });
    else srcs.forEach(function (s) { try { s.stop(end); } catch (e) {} });
    env.connect(dest);
    return { env: env, end: end };
  };

  // One second of an instrument, for the "hear it" buttons.
  Lab.audition = function (id, midi) {
    Lab.load([id]).then(function () {
      var L = Lab.layer(), t = AC.currentTime + 0.05;
      L.out.gain.value = 1;
      Lab.play(L, id, Lab.mtof(Lab.actualMidi(id, midi)), t, 1.6, 0.35, L.out);
      setTimeout(L.stop, 6500);
    });
  };

  /* ---------- recorded instruments ----------
     samples/manifest.js (made by tools/build_samples.py) lists real recordings: a few notes per instrument, each with its
     measured pitch. We load an instrument the first time it's needed, play the nearest recorded note retuned to the one
     asked for, and for held sounds loop the steady part of the recording with crossfades so it can last forever. */
  var SAMP = {}, LOADING = {};
  var FEEL = { choir: [0.6, 0.9], voice: [0.6, 0.9], bowl: [1.0, 1.4], panflute: [0.3, 0.5], shakuhachi: [0.3, 0.5], ocarina: [0.25, 0.5], cello: [0.35, 0.6], violin: [0.3, 0.6] };
  function fetchBuf(url) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest(); x.open("GET", url); x.responseType = "arraybuffer";
      x.onload = function () { (x.status === 200 || x.status === 0) && x.response && x.response.byteLength ? res(x.response) : rej(new Error(url)); };
      x.onerror = function () { rej(new Error(url)); }; x.send();
    });
  }
  function decode(ab) {
    return new Promise(function (res, rej) { var p = AC.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });   // older Safari only has the callback form
  }
  Lab.load = function (ids) {
    return Promise.all(ids.map(function (id) {
      var I = INST[id];
      if (!I || !I.sampled || SAMP[id]) return null;
      if (!LOADING[id]) {
        var def = Lab.SAMPLE_DEFS[id];
        LOADING[id] = Promise.all(def.notes.map(function (nt) {
          return fetchBuf(Lab.sampleBase + nt.f).then(decode).then(function (buf) { return { m: nt.m, ls: nt.ls, xf: nt.xf, cc: nt.cc, buf: buf }; });
        })).then(function (notes) { SAMP[id] = { notes: notes, def: def }; })
          .catch(function (e) { console.warn("Could not load " + id + ", using the synthesized version.", e); });
      }
      return LOADING[id];
    }));
  };
  Lab.isLoaded = function (id) { return !INST[id] || !INST[id].sampled || !!SAMP[id]; };
  // The pitch that will really sound. A recorded bowl always rings near its own pitch, whatever octave is asked for.
  Lab.actualMidi = function (id, midi) {
    var I = INST[id], S = SAMP[id];
    if (I && I.sampled && S && S.def.octave) { var m = S.notes[0].m; return midi - 12 * Math.round((midi - m) / 12); }
    return midi;
  };
  function samplePlayer(id) {
    return function (n, f, out, t, c) {
      var S = SAMP[id], midi = 69 + 12 * Math.log2(f / 440);
      midi = Lab.actualMidi(id, midi);
      var best = S.notes[0];
      S.notes.forEach(function (x) { if (Math.abs(x.m - midi) < Math.abs(best.m - midi)) best = x; });
      var rate = Math.pow(2, (midi - best.m) / 12), buf = best.buf, d = buf.duration;
      function src(at, offset, g0) {
        var s = AC.createBufferSource(), g = gainNode(g0 == null ? 1 : g0);
        s.buffer = buf; s.playbackRate.value = rate; if (n.bus) n.bus.connect(s.detune);
        s.connect(g); g.connect(out); s.start(at, offset); n.keep(s);
        return { s: s, g: g.gain };
      }
      if (S.def.kind === "struck") { var a = src(t, 0); return { end: t + d / rate + 0.1 }; }
      // held: play the recording once, then keep crossfading into its steady part. Each new pass starts a little before the
      // loop point, so that by the time its fade-in ends it is exactly where the old pass would loop to: the waveform
      // continues smoothly instead of two copies fighting.
      // crossfade length, in recording seconds: the one the loop was matched with when the file was built
      var ls = best.ls, xb = best.xf ? Math.min(best.xf, ls * 0.95) : Math.min(0.6, 0.4 * (d - ls), ls * 0.95);
      var D = d / rate, XF = xb / rate, LOOP = (d - ls) / rate, SEG = (d - ls + xb) / rate, first = src(t, 0);
      // recordings whose two passes don't line up (a bowl, or a whole section of players) crossfade by equal power instead
      var power = S.def.power || (best.cc != null && best.cc < 0.85), UP = [], DOWN = [];
      for (var q = 0; q < 24; q++) { UP.push(Math.sin(q / 23 * Math.PI / 2)); DOWN.push(Math.cos(q / 23 * Math.PI / 2)); }
      function fadeIn(g, at) { if (power) g.setValueCurveAtTime(new Float32Array(UP), at, XF); else g.linearRampToValueAtTime(1, at + XF); }
      function fadeOut(g, at) { if (power) g.setValueCurveAtTime(new Float32Array(DOWN), at, XF); else { g.setValueAtTime(1, at); g.linearRampToValueAtTime(0, at + XF); } }
      fadeOut(first.g, t + D - XF); first.s.stop(t + D + 0.05);
      var next = t + D - XF, until = c.forever ? 0 : t + c.dur + 1.5;
      function chunk() {
        var k = src(next, ls - xb, 0);
        if (power) fadeIn(k.g, next); else { k.g.setValueAtTime(0, next); fadeIn(k.g, next); k.g.setValueAtTime(1, next + XF); }
        fadeOut(k.g, next + SEG - XF);
        k.s.stop(next + SEG + 0.05);
        next += LOOP;
      }
      if (c.forever) c.L.sched(function (upTo) { while (next < upTo) chunk(); });
      else while (next < until) chunk();
      return {};
    };
  }
  Lab.registerSamples = function () {
    var defs = Lab.SAMPLE_DEFS || {};
    Object.keys(defs).forEach(function (id) {
      var d = defs[id], f = FEEL[id] || [0.15, 0.45], held = d.kind === "sustained";
      INST[id] = { id: id, name: d.name, kind: d.kind, sampled: true, atk: held ? f[0] : 0.002, rel: f[1], decay: 0,
        trim: (held ? 0.5 : 0.15) / d.level, fallback: id + "_syn", make: samplePlayer(id) };
    });
  };
  Lab.registerSamples();
})(window);
