(function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  var C, master, sfxBus, sfxDry, musicBus, harm, drum, leadBus, musicLP, pauseG, conv, dlyIn, noiseBuf;
  var musicOn = true, muted = false, paused = false;
  var inten = 0, intenS = 0, bpm = 100, step = 0, nextT = 0, timer = 0;
  var streak = 0, lastEat = -1e9, lastTurn = 0, lastMove = 0;
  var SC = [0, 2, 3, 5, 7, 8, 10];
  var PROG = [
    { r: 45, c: [57, 60, 64] }, { r: 41, c: [57, 60, 65] },
    { r: 48, c: [55, 60, 64] }, { r: 43, c: [55, 59, 62] },
    { r: 45, c: [57, 60, 64] }, { r: 41, c: [57, 60, 65] },
    { r: 38, c: [57, 62, 65] }, { r: 40, c: [56, 59, 64] }
  ];
  var ARP = [0, 1, 2, 3, 2, 1, 3, 2];

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sm(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function lay(a, b) { return sm((intenS - a) / (b - a)); }
  function sn(i, base) { return base + SC[i % 7] + 12 * Math.floor(i / 7); }
  function G(v) { var g = C.createGain(); g.gain.value = v; return g; }

  function env(g, t, a, v, d, rel) {
    var p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(v, t + a);
    if (rel) p.setValueAtTime(v, t + d - rel);
    p.exponentialRampToValueAtTime(0.0001, t + d);
  }

  function voice(o) {
    var t = o.t, d = o.d, det = o.det || [0], g = C.createGain(), out = g, f, s, i;
    env(g, t, o.a || 0.004, o.v / Math.sqrt(det.length), d, o.rel);
    if (o.lp) {
      f = C.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.lp, t);
      f.frequency.exponentialRampToValueAtTime(o.lp2 || o.lp, t + d * (o.ld || 1));
      f.connect(g);
      out = f;
    }
    for (i = 0; i < det.length; i++) {
      s = C.createOscillator();
      s.type = o.type || 'sine';
      s.frequency.setValueAtTime(o.f, t);
      if (o.f2) s.frequency.exponentialRampToValueAtTime(o.f2, t + d * (o.fd || 1));
      s.detune.value = det[i];
      s.connect(out);
      s.start(t);
      s.stop(t + d + 0.05);
    }
    g.connect(o.dest || sfxBus);
  }

  function noise(o) {
    var t = o.t, d = o.d, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain();
    s.buffer = noiseBuf;
    f.type = o.ft || 'lowpass';
    f.Q.value = o.q || 0.7;
    f.frequency.setValueAtTime(o.f, t);
    f.frequency.exponentialRampToValueAtTime(o.f2 || o.f, t + d);
    env(g, t, o.a || 0.002, o.v, d);
    s.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    s.start(t, Math.random() * 0.5, d + 0.05);
  }

  function makeIR() {
    var n = (C.sampleRate * 2.4) | 0, b = C.createBuffer(2, n, C.sampleRate), c, d, i, lp, x;
    for (c = 0; c < 2; c++) {
      d = b.getChannelData(c);
      lp = 0;
      for (i = 0; i < n; i++) {
        x = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.8);
        lp += (x - lp) * (0.6 - 0.5 * i / n);
        d[i] = lp;
      }
    }
    return b;
  }

  function comp(th, knee, ratio, rel) {
    var c = C.createDynamicsCompressor();
    c.threshold.value = th; c.knee.value = knee; c.ratio.value = ratio;
    c.attack.value = 0.003; c.release.value = rel;
    return c;
  }

  function build() {
    var c1, c2, dl, fb, lf, n, d, i;
    master = G(muted ? 0 : 0.85);
    c1 = comp(-16, 14, 6, 0.2);
    c2 = comp(-2, 0, 20, 0.05);
    master.connect(c1); c1.connect(c2); c2.connect(C.destination);

    sfxBus = G(0.9); sfxDry = G(0.8);
    musicBus = G(musicOn ? 0.5 : 0);
    harm = G(1); drum = G(1); leadBus = G(1); pauseG = G(1);
    musicLP = C.createBiquadFilter();
    musicLP.type = 'lowpass'; musicLP.frequency.value = 18000;
    drum.connect(musicBus); leadBus.connect(harm); harm.connect(musicBus);
    musicBus.connect(musicLP); musicLP.connect(pauseG); pauseG.connect(master);
    sfxBus.connect(master); sfxDry.connect(master);

    conv = C.createConvolver();
    conv.buffer = makeIR();
    conv.connect(G(0.5)); conv.connect(master);
    sfxBus.connect(G(0.22)).connect(conv);
    pauseG.connect(G(0.16)).connect(conv);

    dlyIn = G(1);
    dl = C.createDelay(1); dl.delayTime.value = 0.19;
    fb = G(0.32);
    lf = C.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 2800;
    dlyIn.connect(dl); dl.connect(lf); lf.connect(fb); fb.connect(dl);
    lf.connect(G(0.35)).connect(master);
    sfxBus.connect(G(0.12)).connect(dlyIn);
    leadBus.connect(G(0.35)).connect(dlyIn);

    n = C.sampleRate * 2;
    noiseBuf = C.createBuffer(1, n, C.sampleRate);
    d = noiseBuf.getChannelData(0);
    for (i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  function kick(t, v) {
    voice({ t: t, d: 0.38, a: 0.002, v: v, f: 160, f2: 42, fd: 0.3, dest: drum });
    noise({ t: t, d: 0.015, ft: 'highpass', f: 3000, v: v * 0.15, dest: drum });
  }
  function snare(t, v) {
    noise({ t: t, d: 0.2, ft: 'bandpass', f: 2200, q: 0.6, v: v, dest: drum });
    voice({ t: t, d: 0.12, type: 'triangle', f: 220, f2: 130, v: v * 0.5, dest: drum });
  }
  function clap(t, v) {
    var k;
    for (k = 0; k < 3; k++) noise({ t: t + k * 0.011, d: 0.02, ft: 'bandpass', f: 1300, q: 1.2, v: v, dest: drum });
    noise({ t: t + 0.033, d: 0.18, ft: 'bandpass', f: 1200, q: 1.2, v: v, dest: drum });
  }
  function hat(t, v, open) {
    noise({ t: t, d: open ? 0.22 : 0.045, ft: 'highpass', f: 7500, f2: 9000, v: v, dest: drum });
  }
  function pump(t) {
    var p = harm.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0.28, t, 0.004);
    p.setTargetAtTime(1, t + 0.035, 0.08);
  }

  function tick(s, t) {
    var ch = PROG[(s >> 4) & 7], c = ch.c, r = ch.r, i = s & 15, sd = 60 / bpm / 4, x, m, k;
    if (i % 4 === 0) { kick(t, 0.9); pump(t); }
    if (i === 4 || i === 12) {
      x = lay(0, 0.12); if (x > 0.02) clap(t, 0.5 * x);
      x = lay(0.5, 0.75); if (x > 0.02) snare(t, 0.35 * x);
    }
    if (i % 4 === 2) { x = lay(0.05, 0.25); if (x > 0.02) hat(t, 0.13 * x, 1); }
    else if (i & 1) { x = lay(0.4, 0.65); if (x > 0.02) hat(t, 0.07 * x, 0); }
    else if (i % 4 === 0) { x = lay(0.7, 0.9); if (x > 0.02) hat(t, 0.05 * x, 0); }
    if (!(i & 1)) {
      m = mtof(r + (i % 8 === 6 ? 12 : 0));
      voice({ t: t, d: sd * 1.9, type: 'sawtooth', f: m, v: 0.3, lp: 900, lp2: 180, ld: 0.8, q: 3, dest: harm });
      voice({ t: t, d: sd * 1.9, f: m, v: 0.25, dest: harm });
    }
    if (i === 0) {
      for (k = 0; k < 3; k++) {
        voice({ t: t, d: sd * 16 + 0.3, a: 0.5, rel: 0.5, type: 'sawtooth', f: mtof(c[k]), det: [-12, 0, 12],
          v: 0.07, lp: 700, lp2: 1400, dest: harm });
      }
    }
    x = lay(0.22, 0.5);
    if (x > 0.02) {
      k = [c[0], c[1], c[2], c[0] + 12][ARP[i & 7]] + 12;
      voice({ t: t, d: sd * 1.6, type: 'sawtooth', f: mtof(k), det: [-5, 5], v: 0.09 * x,
        lp: 3200, lp2: 500, ld: 0.9, q: 2, dest: harm });
    }
    x = lay(0.6, 0.9);
    if (x > 0.02 && (i === 0 || i === 6 || i === 10)) {
      voice({ t: t, d: sd * (i === 10 ? 3 : 4), a: 0.01, type: 'sawtooth', f: mtof(c[(s / 4 | 0) % 3] + 24),
        det: [-9, 9], v: 0.1 * x, lp: 2500, lp2: 1200, dest: leadBus });
    }
  }

  function sched() {
    timer = setTimeout(sched, 25);
    var now = C.currentTime, la = (typeof document !== 'undefined' && document.hidden) ? 1.2 : 0.14;
    if (nextT < now - 0.02) nextT = now + 0.03;
    while (nextT < now + la) {
      tick(step, nextT);
      intenS += (inten - intenS) * 0.1;
      bpm += (100 + 28 * intenS - bpm) * 0.08;
      nextT += 60 / bpm / 4;
      step = (step + 1) & 127;
    }
  }

  function startMusic() {
    if (timer) return;
    nextT = C.currentTime + 0.08;
    sched();
  }

  function duck(p) {
    paused = p;
    if (!C) return;
    var t = C.currentTime;
    musicLP.frequency.cancelScheduledValues(t);
    pauseG.gain.cancelScheduledValues(t);
    musicLP.frequency.setTargetAtTime(p ? 420 : 18000, t, p ? 0.08 : 0.12);
    pauseG.gain.setTargetAtTime(p ? 0.4 : 1, t, 0.1);
  }

  function dip(t) {
    pauseG.gain.cancelScheduledValues(t);
    musicLP.frequency.cancelScheduledValues(t);
    pauseG.gain.setTargetAtTime(0.25, t, 0.02);
    musicLP.frequency.setTargetAtTime(900, t, 0.03);
    pauseG.gain.setTargetAtTime(paused ? 0.4 : 1, t + 1.2, 0.4);
    musicLP.frequency.setTargetAtTime(paused ? 420 : 18000, t + 1.2, 0.4);
  }

  var SFX = {
    start: function (t) {
      voice({ t: t, d: 0.5, type: 'sawtooth', f: 110, f2: 440, det: [-8, 8], v: 0.25, lp: 300, lp2: 5000, q: 2 });
      voice({ t: t, d: 0.35, type: 'square', f: 220, f2: 880, v: 0.08, lp: 2000 });
      noise({ t: t, d: 0.4, ft: 'highpass', f: 500, f2: 8000, v: 0.1 });
      [69, 76, 81].forEach(function (m) {
        voice({ t: t + 0.28, d: 0.6, type: 'triangle', f: mtof(m), v: 0.12 });
      });
    },
    turn: function (t) {
      if (t - lastTurn < 0.08) return;
      lastTurn = t;
      voice({ t: t, d: 0.03, type: 'triangle', f: 1400 + Math.random() * 120, f2: 900, v: 0.035, dest: sfxDry });
    },
    eat: function (t, o) {
      var n, f;
      if (typeof o.combo === 'number') n = o.combo;
      else { streak = t - lastEat < 2.5 ? streak + 1 : 0; n = streak; }
      lastEat = t;
      f = mtof(sn(clamp(Math.round(n), 0, 14), 57));
      voice({ t: t, d: 0.28, type: 'triangle', f: f, v: 0.24, lp: 5000, lp2: 700, ld: 0.8, q: 2 });
      voice({ t: t, d: 0.2, type: 'square', f: f, det: [5], v: 0.06, lp: 3000, lp2: 600 });
      voice({ t: t, d: 0.22, f: f * 2, v: 0.1 });
      noise({ t: t, d: 0.02, ft: 'highpass', f: 6000, v: 0.12 });
    },
    combo: function (t, o) {
      var l = clamp(Math.round(o.level || 1), 1, 10), i = l - 1, f = mtof(sn(i, 60)), k, g = 0.8 + 0.04 * l;
      voice({ t: t, d: 0.5, type: 'triangle', f: f, v: 0.22 * g, lp: 7000, lp2: 1500 });
      voice({ t: t, d: 0.35, f: f * 2, v: 0.1 * g });
      voice({ t: t, d: 0.25, f: f * 2.76, v: 0.05 * g });
      for (k = 0; k < 3; k++) {
        voice({ t: t + k * 0.045, d: 0.22, type: 'triangle', f: mtof(sn(i + 2 * k, 72)), v: 0.12 * g });
      }
      noise({ t: t, d: 0.03, ft: 'highpass', f: 7000, v: 0.1 });
    },
    powerup: function (t) {
      voice({ t: t, d: 0.45, type: 'sawtooth', f: 200, f2: 1600, det: [-6, 6], v: 0.22, lp: 400, lp2: 6000, q: 4 });
      voice({ t: t, d: 0.3, f: 800, f2: 3200, v: 0.1 });
      noise({ t: t, d: 0.4, ft: 'bandpass', f: 1000, f2: 6000, q: 2, v: 0.08 });
      voice({ t: t + 0.35, d: 0.3, f: 2093, v: 0.1 });
    },
    powerdown: function (t) {
      voice({ t: t, d: 0.55, type: 'square', f: 900, f2: 110, v: 0.18, lp: 4000, lp2: 200 });
      voice({ t: t, d: 0.5, type: 'sawtooth', f: 400, f2: 60, v: 0.1, lp: 2000, lp2: 150 });
      noise({ t: t, d: 0.45, f: 3000, f2: 200, v: 0.1 });
    },
    levelup: function (t) {
      [57, 60, 64, 69, 72, 76].forEach(function (m, k) {
        voice({ t: t + k * 0.07, d: 0.3, type: 'sawtooth', f: mtof(m + 12), det: [-6, 6], v: 0.14, lp: 4000, lp2: 1200 });
        voice({ t: t + k * 0.07, d: 0.2, type: 'square', f: mtof(m + 12), v: 0.04 });
      });
      [69, 72, 76, 81].forEach(function (m) {
        voice({ t: t + 0.45, d: 1.0, type: 'triangle', f: mtof(m), det: [-5, 5], v: 0.1 });
      });
      noise({ t: t + 0.45, d: 0.5, ft: 'highpass', f: 5000, v: 0.06 });
    },
    death: function (t) {
      voice({ t: t, d: 0.9, type: 'sawtooth', f: 440, f2: 40, fd: 1, det: [-10, 10], v: 0.28, lp: 3000, lp2: 120 });
      voice({ t: t, d: 0.7, f: 90, f2: 30, v: 0.6 });
      noise({ t: t, d: 0.8, f: 3000, f2: 200, v: 0.3 });
      noise({ t: t, d: 0.1, ft: 'highpass', f: 2000, v: 0.2 });
      dip(t);
    },
    pause: function (t) {
      duck(true);
      voice({ t: t, d: 0.16, type: 'triangle', f: 660, f2: 330, v: 0.15, lp: 3000 });
    },
    resume: function (t) {
      duck(false);
      voice({ t: t, d: 0.16, type: 'triangle', f: 330, f2: 660, v: 0.15, lp: 3000 });
    },
    menu_move: function (t) {
      if (t - lastMove < 0.04) return;
      lastMove = t;
      voice({ t: t, d: 0.05, type: 'triangle', f: 520, f2: 580, v: 0.07, dest: sfxDry });
    },
    menu_select: function (t) {
      voice({ t: t, d: 0.1, type: 'triangle', f: 660, v: 0.12 });
      voice({ t: t + 0.06, d: 0.14, type: 'triangle', f: 990, v: 0.12 });
    }
  };

  var api = {
    init: function () {
      if (C) { if (C.state === 'suspended') C.resume(); return; }
      if (!AC) return;
      try { C = new AC({ latencyHint: 'interactive' }); }
      catch (e) { try { C = new AC(); } catch (e2) { return; } }
      build();
      if (C.state === 'suspended') C.resume();
      if (musicOn) startMusic();
    },
    play: function (name, opts) {
      if (!C) return;
      try {
        if (C.state === 'suspended') C.resume();
        var f = SFX[name];
        if (f) f(C.currentTime + 0.005, opts || {});
      } catch (e) {}
    },
    setIntensity: function (x) { inten = clamp(+x || 0, 0, 1); },
    setMusic: function (on) {
      musicOn = !!on;
      if (!C) return;
      musicBus.gain.setTargetAtTime(musicOn ? 0.5 : 0, C.currentTime, 0.12);
      if (musicOn) startMusic();
      else setTimeout(function () { if (!musicOn && timer) { clearTimeout(timer); timer = 0; } }, 700);
    },
    setMuted: function (m) {
      muted = !!m;
      if (C) master.gain.setTargetAtTime(muted ? 0 : 0.85, C.currentTime, 0.04);
    }
  };
  Object.defineProperty(api, 'muted', { get: function () { return muted; }, enumerable: true });
  window.SnakeAudio = api;
})();
