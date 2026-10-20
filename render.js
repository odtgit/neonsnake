(function () {
'use strict';

var TAU = Math.PI * 2;
var FONT = '"Orbitron","Eurostile","Segoe UI",system-ui,sans-serif';
var MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
var LUTN = 48;
var NP = 640;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function sstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function rng(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mk() {
  var c = document.createElement('canvas');
  return { c: c, g: c.getContext('2d') };
}
function size(o, w, h) {
  o.c.width = Math.max(1, w | 0);
  o.c.height = Math.max(1, h | 0);
}

var probe = mk();
probe.c.width = probe.c.height = 1;
function rgb(col) {
  var g = probe.g;
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = '#000';
  g.fillStyle = col;
  g.fillRect(0, 0, 1, 1);
  var d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
function mixA(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function str(a) {
  return 'rgb(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ')';
}

var sprites = {};
var spriteN = 0;
function sprite(col) {
  var s = sprites[col];
  if (s) return s;
  if (spriteN > 80) { sprites = {}; spriteN = 0; }
  var o = mk(), g = o.g;
  o.c.width = o.c.height = 64;
  var a = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  a.addColorStop(0, '#fff');
  a.addColorStop(0.16, col);
  a.addColorStop(1, col);
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'destination-in';
  var m = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(0.22, 'rgba(0,0,0,.85)');
  m.addColorStop(0.5, 'rgba(0,0,0,.25)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, 64, 64);
  spriteN++;
  return (sprites[col] = o.c);
}

function create(canvas) {
  var ctx = canvas.getContext('2d', { alpha: false });
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var r = {
    palette: {
      food: '#ffb02e',
      snake: { head: '#22e8ff', tail: '#d62bff' },
      powerups: { slow: '#4da3ff', ghost: '#c9b6ff', magnet: '#ff9f1c', double: '#ffd23f' },
      obstacle: '#ff3df2',
      border: ['#22e8ff', '#d62bff']
    },
    hud: true
  };

  var W = 1, H = 1, dpr = 1, ready = false;
  var gw = 24, gh = 24, cs = 20, ox = 0, oy = 0, bw = 0, bh = 0, hudH = 0, hz = 0, pad = 0, obsPad = 0;
  var sky = mk(), boardC = mk(), obsC = mk(), tmpG = mk(), ovl = mk(), sunC = mk();
  var tmpA = null, tmpB = null;
  var b1 = mk(), bm = mk(), b2 = mk(), bc = mk(), bk = 0.25;

  var T = 0, shx = 0, shy = 0;
  var shk = { amp: 0, dur: 1, left: 0 };
  var fl = { col: '#fff', dur: 1, left: 0 };
  var ca = 0, gi = 0, lastPhase = '', scorePop = 0, lastScore = 0, comboPeak = 1;
  var foodX = -1, foodY = -1, foodT = 0;
  var lutKey = '', bodyRGB = [], bodyS = [], coreS = [];

  var NS = 150, stX = new Float32Array(NS), stY = new Float32Array(NS),
    stZ = new Float32Array(NS), stP = new Float32Array(NS);

  var px = new Float32Array(NP), py = new Float32Array(NP), pvx = new Float32Array(NP),
    pvy = new Float32Array(NP), pl = new Float32Array(NP), pml = new Float32Array(NP),
    ps = new Float32Array(NP), pcol = new Array(NP), pn = 0;
  var RN = 8, rx = new Float32Array(RN), ry = new Float32Array(RN),
    rt = new Float32Array(RN).fill(-1), rn = 0;

  var cap = 256;
  var rawX = new Float32Array(cap), rawY = new Float32Array(cap);
  var fx = new Float32Array(cap * 3), fy = new Float32Array(cap * 3), fb = new Uint8Array(cap * 3);
  var scap = 1024;
  var sX = new Float32Array(scap), sY = new Float32Array(scap), sR = new Float32Array(scap),
    sC = new Uint8Array(scap);
  var np = 0, ns = 0, headX = 0, headY = 0, hdx = 1, hdy = 0, snakeLen = 0;

  function grow(n) {
    if (n <= cap) return;
    cap = n * 2;
    rawX = new Float32Array(cap); rawY = new Float32Array(cap);
    fx = new Float32Array(cap * 3); fy = new Float32Array(cap * 3); fb = new Uint8Array(cap * 3);
  }
  function growS(n) {
    if (n <= scap) return;
    scap = n * 2;
    sX = new Float32Array(scap); sY = new Float32Array(scap);
    sR = new Float32Array(scap); sC = new Uint8Array(scap);
  }

  function buildLut(wf) {
    var p = r.palette.snake;
    var key = p.head + p.tail + wf;
    if (key === lutKey) return;
    lutKey = key;
    var h = rgb(p.head), t = rgb(p.tail), w = [255, 255, 255];
    bodyRGB.length = bodyS.length = coreS.length = 0;
    for (var i = 0; i < LUTN; i++) {
      var b = mixA(h, t, i / (LUTN - 1));
      bodyRGB.push(b);
      bodyS.push(str(b));
      coreS.push(str(mixA(b, w, wf)));
    }
  }

  function layout() {
    pad = Math.round(0.03 * Math.min(W, H));
    hudH = r.hud ? Math.round(Math.min(H * 0.09, 72 * dpr)) : r.reserve ? Math.round(Math.min(H * 0.115, 92 * dpr)) : 0;
    var aw = W - 2 * pad, ah = H - hudH - pad * 1.2;
    cs = Math.max(4, Math.floor(Math.min(aw / gw, ah / gh)));
    bw = cs * gw; bh = cs * gh;
    ox = Math.floor((W - bw) / 2);
    oy = hudH + Math.max(0, Math.floor((ah - bh) / 2)) + Math.round(pad * 0.2);
    buildBoard();
    buildObs();
  }

  function buildSky() {
    var c = sky.c, g = sky.g;
    size(sky, W, H);
    hz = Math.floor(H * 0.56);
    var gr = g.createLinearGradient(0, 0, 0, hz);
    gr.addColorStop(0, '#04010d');
    gr.addColorStop(0.55, '#14052f');
    gr.addColorStop(1, '#4b0c6e');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, hz);

    var sr = Math.min(W, H) * 0.27, sx = W / 2, sy = hz - sr * 0.15;
    var hg = g.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 2.4);
    hg.addColorStop(0, 'rgba(255,50,170,.42)');
    hg.addColorStop(1, 'rgba(255,50,170,0)');
    g.fillStyle = hg;
    g.fillRect(0, 0, W, hz);

    size(sunC, sr * 2, sr * 2);
    var s = sunC.g;
    var sg = s.createLinearGradient(0, 0, 0, sr * 2);
    sg.addColorStop(0, '#ffe45c');
    sg.addColorStop(0.45, '#ff5fa8');
    sg.addColorStop(1, '#9a2cff');
    s.fillStyle = sg;
    s.beginPath(); s.arc(sr, sr, sr, 0, TAU); s.fill();
    s.globalCompositeOperation = 'destination-out';
    for (var i = 0; i < 8; i++) {
      var yy = sr * 1.08 + i * sr * 0.115;
      s.fillRect(0, yy, sr * 2, 1 + i * sr * 0.017);
    }
    g.drawImage(sunC.c, sx - sr, sy - sr);

    g.fillStyle = '#0b0222';
    g.fillRect(0, hz, W, H - hz);
    var fg = g.createLinearGradient(0, hz, 0, H);
    fg.addColorStop(0, '#2a0a52');
    fg.addColorStop(0.25, '#0e0328');
    fg.addColorStop(1, '#05010f');
    g.fillStyle = fg;
    g.fillRect(0, hz, W, H - hz);

    var rd = rng(7);
    g.beginPath();
    g.moveTo(0, hz);
    var step = Math.max(12, W / 40);
    for (var x = 0; x <= W + step; x += step) {
      var k = Math.abs(x - W / 2) / (W / 2);
      var hh = (0.015 + rd() * 0.16) * H * (0.2 + 0.8 * k);
      g.lineTo(x, hz - hh);
      g.lineTo(x + step / 2, hz - hh * (0.3 + rd() * 0.3));
    }
    g.lineTo(W, hz); g.closePath();
    g.fillStyle = '#0a021f'; g.fill();
    g.strokeStyle = 'rgba(255,45,170,.75)';
    g.lineWidth = 1.5 * dpr; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = '#0b0222';
    g.fillRect(0, hz, W, 2);

    var lg = g.createLinearGradient(0, hz, 0, H);
    lg.addColorStop(0, 'rgba(255,45,200,0)');
    lg.addColorStop(0.3, 'rgba(255,45,200,.55)');
    lg.addColorStop(1, 'rgba(120,80,255,.75)');
    g.strokeStyle = lg; g.lineWidth = Math.max(1, dpr);
    g.beginPath();
    for (var j = -16; j <= 16; j++) {
      g.moveTo(sx, hz);
      g.lineTo(sx + j * W * 0.1 * (1 + Math.abs(j) * 0.04), H);
    }
    g.stroke();
    var hl = g.createLinearGradient(0, hz - 4 * dpr, 0, hz + 10 * dpr);
    hl.addColorStop(0, 'rgba(255,90,200,0)');
    hl.addColorStop(0.4, 'rgba(255,130,230,.95)');
    hl.addColorStop(1, 'rgba(255,90,200,0)');
    g.fillStyle = hl;
    g.fillRect(0, hz - 4 * dpr, W, 14 * dpr);

    var rs = rng(99);
    for (var q = 0; q < NS; q++) {
      stX[q] = rs() * W; stY[q] = rs() * hz * 0.92;
      stZ[q] = 0.2 + rs() * 0.8; stP[q] = rs() * TAU;
    }
    g.globalCompositeOperation = 'lighter';
    for (q = 0; q < NS; q++) {
      g.globalAlpha = (0.55 + 0.45 * Math.sin(stP[q])) * (0.35 + stZ[q] * 0.65);
      g.fillStyle = q % 5 === 0 ? '#ff9de8' : q % 7 === 0 ? '#9defff' : '#e6e9ff';
      var z = Math.max(1, stZ[q] * 2.2 * dpr);
      g.fillRect(stX[q], stY[q], z, z);
    }
    g.strokeStyle = '#ff3de0';
    for (q = 0; q < 14; q++) {
      var p = q / 14, y = hz + (H - hz) * p * p;
      g.globalAlpha = 0.12 * p;
      g.lineWidth = 4 * dpr * p + 1;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      g.globalAlpha = 0.85 * p;
      g.lineWidth = Math.max(1, 1.4 * dpr * (0.4 + p));
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    void c;
  }

  function buildOvl() {
    size(ovl, W, H);
    var g = ovl.g;
    var v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    v.addColorStop(0, 'rgba(0,0,12,0)');
    v.addColorStop(1, 'rgba(0,0,12,.72)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    var pitch = Math.max(2, Math.round(3 * dpr));
    g.fillStyle = 'rgba(0,0,0,.16)';
    for (var y = 0; y < H; y += pitch) g.fillRect(0, y, W, Math.max(1, pitch >> 1));
  }

  function buildBoard() {
    size(boardC, bw, bh);
    var g = boardC.g;
    var gr = g.createLinearGradient(0, 0, 0, bh);
    gr.addColorStop(0, 'rgba(18,6,46,.80)');
    gr.addColorStop(1, 'rgba(8,2,26,.86)');
    g.fillStyle = gr; g.fillRect(0, 0, bw, bh);
    g.fillStyle = 'rgba(160,120,255,.028)';
    for (var y = 0; y < gh; y++) for (var x = (y & 1); x < gw; x += 2) g.fillRect(x * cs, y * cs, cs, cs);
    var lw = Math.max(1, Math.round(dpr * 0.8));
    g.lineWidth = lw;
    for (var i = 1; i < gw; i++) {
      g.strokeStyle = i % 4 === 0 ? 'rgba(140,110,255,.2)' : 'rgba(120,100,255,.09)';
      g.beginPath(); g.moveTo(i * cs + 0.5, 0); g.lineTo(i * cs + 0.5, bh); g.stroke();
    }
    for (var j = 1; j < gh; j++) {
      g.strokeStyle = j % 4 === 0 ? 'rgba(140,110,255,.2)' : 'rgba(120,100,255,.09)';
      g.beginPath(); g.moveTo(0, j * cs + 0.5); g.lineTo(bw, j * cs + 0.5); g.stroke();
    }
  }

  function rrect(g, x, y, w, h, rad) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, rad); else g.rect(x, y, w, h);
  }

  function buildObs() {
    obsPad = Math.ceil(cs * 0.4);
    var S = cs + obsPad * 2;
    size(obsC, S, S);
    var g = obsC.g, col = r.palette.obstacle;
    var x0 = obsPad + cs * 0.07, y0 = x0, w = cs * 0.86, x1 = x0 + w, y1 = y0 + w, b = cs * 0.14;
    g.shadowColor = col; g.shadowBlur = cs * 0.45;
    g.fillStyle = col;
    rrect(g, x0, y0, w, w, cs * 0.08); g.fill();
    g.shadowBlur = 0; g.shadowColor = 'transparent';
    g.fillStyle = '#1b0838';
    rrect(g, x0, y0, w, w, cs * 0.08); g.fill();
    function poly(c, a) {
      g.fillStyle = c; g.beginPath(); g.moveTo(a[0], a[1]);
      for (var i = 2; i < a.length; i += 2) g.lineTo(a[i], a[i + 1]);
      g.closePath(); g.fill();
    }
    poly('rgba(255,170,240,.6)', [x0, y0, x1, y0, x1 - b, y0 + b, x0 + b, y0 + b]);
    poly('rgba(255,110,230,.35)', [x0, y0, x0 + b, y0 + b, x0 + b, y1 - b, x0, y1]);
    poly('rgba(15,0,35,.7)', [x0, y1, x0 + b, y1 - b, x1 - b, y1 - b, x1, y1]);
    poly('rgba(35,0,65,.6)', [x1, y0, x1, y1, x1 - b, y1 - b, x1 - b, y0 + b]);
    var fg = g.createLinearGradient(x0, y0, x1, y1);
    fg.addColorStop(0, '#3a1260'); fg.addColorStop(1, '#170630');
    g.fillStyle = fg; g.fillRect(x0 + b, y0 + b, w - 2 * b, w - 2 * b);
    g.strokeStyle = 'rgba(255,61,242,.4)';
    g.lineWidth = Math.max(1, cs * 0.03);
    g.beginPath();
    g.moveTo(x0 + b * 1.5, y0 + b * 1.5); g.lineTo(x1 - b * 1.5, y1 - b * 1.5);
    g.moveTo(x1 - b * 1.5, y0 + b * 1.5); g.lineTo(x0 + b * 1.5, y1 - b * 1.5);
    g.stroke();
    g.strokeStyle = col; g.lineWidth = Math.max(1.5, cs * 0.05);
    rrect(g, x0, y0, w, w, cs * 0.08); g.stroke();
  }

  function setBuffers() {
    bk = 0.25 / dpr;
    size(b1, Math.ceil(W * bk), Math.ceil(H * bk));
    size(bm, Math.ceil(W * bk / 2), Math.ceil(H * bk / 2));
    size(b2, Math.ceil(W * bk / 4), Math.ceil(H * bk / 4));
    size(bc, b1.c.width, b1.c.height);
    size(tmpG, W, H);
    tmpA = tmpB = null;
  }

  r.resize = function (cw, ch, d) {
    var nd = d || 1, nW = Math.max(2, Math.round(cw * nd)), nH = Math.max(2, Math.round(ch * nd));
    if (ready && nW === W && nH === H && nd === dpr) return;
    dpr = nd; W = nW; H = nH;
    canvas.width = W; canvas.height = H;
    if (canvas.style) { canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px'; }
    ctx = canvas.getContext('2d', { alpha: false });
    setBuffers();
    buildSky();
    buildOvl();
    layout();
    ready = true;
  };

  r.burst = function (cx, cy, color, count) {
    var n = count == null ? 28 : count, col = sprite(color || r.palette.food);
    for (var i = 0; i < n; i++) {
      var k = pn++ % NP, a = Math.random() * TAU, sp = (2 + Math.random() * 8) * (0.35 + Math.random() * 0.65);
      px[k] = cx + 0.5; py[k] = cy + 0.5;
      pvx[k] = Math.cos(a) * sp; pvy[k] = Math.sin(a) * sp;
      pml[k] = pl[k] = 450 + Math.random() * 700;
      ps[k] = 0.22 + Math.random() * 0.5;
      pcol[k] = col;
    }
  };
  r.shake = function (amp, dur) {
    var cur = shk.left > 0 ? shk.amp * Math.pow(shk.left / shk.dur, 2) : 0;
    if (amp >= cur) { shk.amp = amp; shk.dur = Math.max(1, dur); shk.left = dur; }
  };
  r.flash = function (color, dur) {
    fl.col = color || '#fff'; fl.dur = Math.max(1, dur || 200); fl.left = fl.dur;
    ca = Math.max(ca, 0.6);
  };
  r.ripple = function (cx, cy) {
    var k = rn++ % RN;
    rx[k] = cx + 0.5; ry[k] = cy + 0.5; rt[k] = 0;
  };

  function buildSnake(S) {
    var sn = S.snake || [], pv = S.prev && S.prev.length ? S.prev : sn, n = sn.length;
    ns = 0; np = 0; snakeLen = n;
    if (!n) return;
    grow(n + 4);
    var a = clamp(S.alpha || 0, 0, 1), pl_ = pv.length, hw = gw / 2, hh = gh / 2, i;
    for (i = 0; i < n; i++) {
      var p = pv[i < pl_ ? i : pl_ - 1], q = sn[i];
      var dx = q.x - p.x, dy = q.y - p.y;
      if (dx > hw) dx -= gw; else if (dx < -hw) dx += gw;
      if (dy > hh) dy -= gh; else if (dy < -hh) dy += gh;
      rawX[i] = (((p.x + dx * a + 0.5) % gw) + gw) % gw;
      rawY[i] = (((p.y + dy * a + 0.5) % gh) + gh) % gh;
    }
    headX = rawX[0]; headY = rawY[0];
    var d = S.dir || [1, 0];
    hdx = d[0]; hdy = d[1];
    if (!hdx && !hdy) hdx = 1;

    function push(x, y, b) { fx[np] = x; fy[np] = y; fb[np] = b; np++; }
    function fr(v) { v -= 0.5; return Math.abs(v - Math.round(v)); }
    push(rawX[0], rawY[0], 0);
    for (i = 1; i < n; i++) {
      var ax = rawX[i - 1], ay = rawY[i - 1], bx = rawX[i], by = rawY[i];
      var ddx = bx - ax, ddy = by - ay;
      if (Math.abs(ddx) > 2.5 || Math.abs(ddy) > 2.5) {
        var ex = 0, ey = 0;
        if (Math.abs(ddx) > 2.5) ex = ddx < 0 ? 1 : -1;
        if (Math.abs(ddy) > 2.5) ey = ddy < 0 ? 1 : -1;
        push(ax + ex * 1.3, ay + ey * 1.3, 0);
        push(bx - ex * 1.3, by - ey * 1.3, 1);
        push(bx, by, 0);
      } else {
        if (Math.abs(ddx) > 0.02 && Math.abs(ddy) > 0.02) {
          var s1 = fr(ax) + fr(by), s2 = fr(bx) + fr(ay);
          if (s1 <= s2) push(ax, by, 0); else push(bx, ay, 0);
        }
        push(bx, by, 0);
      }
    }

    var L = 0;
    for (i = 1; i < np; i++) if (!fb[i]) L += Math.hypot(fx[i] - fx[i - 1], fy[i] - fy[i - 1]);
    var step = (coarse ? Math.max(0.3, L / 600) : Math.max(0.15, L / 1500)), R = 0.4, s = 0, next = 0;
    growS(Math.ceil(L / step) + 8);

    function emit(x, y, sd) {
      var de = L - sd, f = de >= 4 ? 1 : 0.28 + 0.72 * sstep(de / 4);
      var t = L > 0 ? sd / L : 0;
      var idx = (t + 0.05 * Math.sin(sd * 0.9 - T * 0.006)) * (LUTN - 1);
      sX[ns] = x; sY[ns] = y; sR[ns] = R * f;
      sC[ns] = clamp(idx | 0, 0, LUTN - 1);
      ns++;
    }
    for (i = 1; i < np; i++) {
      if (fb[i]) continue;
      var x0 = fx[i - 1], y0 = fy[i - 1], len = Math.hypot(fx[i] - x0, fy[i] - y0);
      if (len < 1e-6) continue;
      while (next <= s + len) {
        var t = (next - s) / len;
        emit(lerp(x0, fx[i], t), lerp(y0, fy[i], t), next);
        next += step;
      }
      s += len;
    }
    if (ns === 0 || next - step < L - 0.03) emit(fx[np - 1], fy[np - 1], L);
  }

  function drawHeadAt(g, hx, hy, glow) {
    var col = bodyS[0];
    if (glow) {
      g.fillStyle = col;
      g.beginPath(); g.arc(hx, hy, 0.8, 0, TAU); g.fill();
      return;
    }
    g.fillStyle = col;
    g.beginPath(); g.arc(hx, hy, 0.5, 0, TAU); g.fill();
    var hg = g.createRadialGradient(hx - 0.12, hy - 0.14, 0.02, hx, hy, 0.5);
    hg.addColorStop(0, 'rgba(255,255,255,.55)');
    hg.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = hg;
    g.beginPath(); g.arc(hx, hy, 0.5, 0, TAU); g.fill();
    var dx = hdx, dy = hdy, nx = -dy, ny = dx;
    for (var sd = -1; sd <= 1; sd += 2) {
      var ex = hx + dx * 0.13 + nx * 0.21 * sd, ey = hy + dy * 0.13 + ny * 0.21 * sd;
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(ex, ey, 0.155, 0, TAU); g.fill();
      g.fillStyle = '#12012e';
      g.beginPath(); g.arc(ex + dx * 0.06, ey + dy * 0.06, 0.088, 0, TAU); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(ex + dx * 0.03 - 0.025, ey + dy * 0.03 - 0.03, 0.025, 0, TAU); g.fill();
    }
  }

  function drawSnake(g, glow) {
    var i;
    var j, c;
    if (glow) {
      var gs = 1.2 + 0.07 * (gi * 5);
      for (i = ns - 1; i >= 0; i = j) {
        c = sC[i]; g.fillStyle = bodyS[c]; g.beginPath();
        for (j = i; j >= 0 && sC[j] === c; j--) { g.moveTo(sX[j] + sR[j] * gs, sY[j]); g.arc(sX[j], sY[j], sR[j] * gs, 0, TAU); }
        g.fill();
      }
    } else {
      for (i = ns - 1; i >= 0; i = j) {
        c = sC[i]; g.fillStyle = bodyS[c]; g.beginPath();
        for (j = i; j >= 0 && sC[j] === c; j--) { g.moveTo(sX[j] + sR[j], sY[j]); g.arc(sX[j], sY[j], sR[j], 0, TAU); }
        g.fill();
      }
      for (i = ns - 1; i >= 0; i = j) {
        c = sC[i]; g.fillStyle = coreS[c]; g.beginPath();
        for (j = i; j >= 0 && sC[j] === c; j--) { g.moveTo(sX[j] + sR[j] * 0.45, sY[j]); g.arc(sX[j], sY[j], sR[j] * 0.45, 0, TAU); }
        g.fill();
      }
    }
    var ox_ = headX < 0.8 ? gw : headX > gw - 0.8 ? -gw : 0;
    var oy_ = headY < 0.8 ? gh : headY > gh - 0.8 ? -gh : 0;
    drawHeadAt(g, headX, headY, glow);
    if (ox_) drawHeadAt(g, headX + ox_, headY, glow);
    if (oy_) drawHeadAt(g, headX, headY + oy_, glow);
    if (ox_ && oy_) drawHeadAt(g, headX + ox_, headY + oy_, glow);
  }

  function drawBorder(g, glow, S) {
    var act = S.active || {}, c0 = r.palette.border[0], c1 = r.palette.border[1], pu = r.palette.powerups;
    if (act.ghost > 0) { c0 = pu.ghost; c1 = pu.ghost; }
    else if (act.slow > 0) { c0 = pu.slow; c1 = pu.slow; }
    else if (act.magnet > 0) { c0 = pu.magnet; c1 = pu.magnet; }
    else if (act.double > 0) { c0 = pu.double; c1 = pu.double; }
    var gr = g.createLinearGradient(0, 0, gw, gh);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    var pulse = 0.78 + 0.22 * Math.sin(T / 420), lw = 0.07 + gi * 0.03;
    g.strokeStyle = gr; g.lineJoin = 'round';
    if (glow) {
      g.globalAlpha = Math.min(1, pulse * (0.8 + gi * 0.4));
      g.lineWidth = 0.34;
      g.strokeRect(-0.04, -0.04, gw + 0.08, gh + 0.08);
    } else {
      g.globalAlpha = 0.22; g.lineWidth = 0.26;
      g.strokeRect(-0.04, -0.04, gw + 0.08, gh + 0.08);
      g.globalAlpha = pulse; g.lineWidth = lw;
      g.strokeRect(-0.04, -0.04, gw + 0.08, gh + 0.08);
    }
    g.globalAlpha = 1;
  }

  function drawFood(g, f, glow) {
    var cx = f.x + 0.5, cy = f.y + 0.5, pulse = Math.sin(T / 170);
    var grow_ = sstep(foodT / 260), rad = (0.27 + 0.045 * pulse) * grow_;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = (glow ? 0.9 : 0.75) * grow_;
    var sz = (glow ? 3.4 : 2.5) + 0.3 * pulse;
    g.drawImage(sprite('#ff7a1c'), cx - sz / 2, cy - sz / 2, sz, sz);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    if (glow) {
      g.fillStyle = r.palette.food;
      g.beginPath(); g.arc(cx, cy, rad * 1.2, 0, TAU); g.fill();
    } else {
      var og = g.createRadialGradient(cx - 0.08, cy - 0.09, 0.015, cx, cy, rad);
      og.addColorStop(0, '#fffbe6'); og.addColorStop(0.3, r.palette.food); og.addColorStop(1, '#ff2e63');
      g.fillStyle = og;
      g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'lighter';
    var sp = sprite('#ffd070');
    for (var i = 0; i < 5; i++) {
      for (var j = 0; j < 4; j++) {
        var a = T * 0.0028 + i * (TAU / 5) - j * 0.16, rr = 0.58 + 0.07 * Math.sin(T / 260 + i * 2);
        var z = (0.2 - j * 0.04) * (glow ? 1.7 : 1);
        g.globalAlpha = (1 - j * 0.25) * grow_;
        g.drawImage(sp, cx + Math.cos(a) * rr - z / 2, cy + Math.sin(a) * rr * 0.92 - z / 2, z, z);
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  function icon(g, kind, col) {
    g.scale(1.3, 1.3); g.lineWidth = 0.07; g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#fff'; g.fillStyle = '#fff';
    g.beginPath();
    if (kind === 'slow') {
      g.moveTo(-0.12, -0.16); g.lineTo(0.12, -0.16); g.lineTo(-0.12, 0.16); g.lineTo(0.12, 0.16);
      g.closePath(); g.stroke();
      g.fillStyle = col;
      g.beginPath(); g.arc(0, 0.1, 0.035, 0, TAU); g.fill();
    } else if (kind === 'ghost') {
      g.arc(0, -0.02, 0.14, Math.PI, 0);
      g.lineTo(0.14, 0.15); g.lineTo(0.07, 0.1); g.lineTo(0, 0.15); g.lineTo(-0.07, 0.1);
      g.lineTo(-0.14, 0.15); g.closePath(); g.stroke();
      g.fillStyle = col;
      g.beginPath(); g.arc(-0.05, -0.03, 0.028, 0, TAU); g.arc(0.05, -0.03, 0.028, 0, TAU); g.fill();
    } else if (kind === 'magnet') {
      g.arc(0, 0.02, 0.12, 0, Math.PI);
      g.moveTo(0.12, 0.02); g.lineTo(0.12, -0.12);
      g.moveTo(-0.12, 0.02); g.lineTo(-0.12, -0.12);
      g.stroke();
      g.strokeStyle = col; g.lineWidth = 0.09;
      g.beginPath();
      g.moveTo(0.12, -0.12); g.lineTo(0.12, -0.17);
      g.moveTo(-0.12, -0.12); g.lineTo(-0.12, -0.17);
      g.stroke();
    } else {
      g.save(); g.scale(0.01, 0.01);
      g.font = '800 30px ' + MONO;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('x2', 0, 2);
      g.restore();
    }
  }

  function drawPowerup(g, p, glow) {
    var col = r.palette.powerups[p.kind] || '#fff', bob = Math.sin(T / 300 + p.x) * 0.04;
    var cx = p.x + 0.5, cy = p.y + 0.5 + bob, a = 1;
    if (p.ttlMs < 2000) a = ((T / (p.ttlMs < 700 ? 80 : 150)) | 0) & 1 ? 0.25 : 1;
    var pu = 1 + 0.05 * Math.sin(T / 200);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a * (glow ? 0.95 : 0.7);
    var sz = (glow ? 3 : 2.1) * pu;
    g.drawImage(sprite(col), cx - sz / 2, cy - sz / 2, sz, sz);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a;
    g.save();
    g.translate(cx, cy);
    g.scale(pu, pu);
    g.fillStyle = glow ? col : '#0d0426';
    g.beginPath(); g.arc(0, 0, 0.4, 0, TAU); g.fill();
    g.strokeStyle = col; g.lineWidth = 0.07;
    g.beginPath(); g.arc(0, 0, 0.43, 0, TAU); g.stroke();
    if (!glow) {
      g.lineWidth = 0.035; g.globalAlpha = a * 0.9;
      var rot = T / 700;
      for (var i = 0; i < 3; i++) {
        g.beginPath(); g.arc(0, 0, 0.52, rot + i * 2.094, rot + i * 2.094 + 0.9); g.stroke();
      }
      g.globalAlpha = a;
      icon(g, p.kind, col);
    }
    g.restore();
    g.globalAlpha = 1;
  }

  function drawObstacles(g, list) {
    var op = obsPad / cs;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      g.globalAlpha = 0.86 + 0.14 * Math.sin(T / 420 + o.x * 0.7 + o.y * 1.3);
      g.drawImage(obsC.c, o.x - op, o.y - op, 1 + 2 * op, 1 + 2 * op);
    }
    g.globalAlpha = 1;
  }

  function drawRipples(g, glow) {
    for (var i = 0; i < RN; i++) {
      if (rt[i] < 0) continue;
      var p = rt[i] / 850, e = 1 - p;
      g.globalAlpha = e * e * (glow ? 0.5 : 0.9);
      g.strokeStyle = '#d8f8ff';
      g.lineWidth = (glow ? 0.35 : 0.14) * e + 0.03;
      g.beginPath(); g.arc(rx[i], ry[i], 0.4 + p * 9, 0, TAU); g.stroke();
      g.globalAlpha = e * e * 0.6;
      g.strokeStyle = '#ff4de0';
      g.lineWidth = (glow ? 0.3 : 0.1) * e + 0.02;
      g.beginPath(); g.arc(rx[i], ry[i], 0.2 + p * 6.2, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
  }

  function drawParticles(g, glow) {
    g.globalCompositeOperation = 'lighter';
    var m = glow ? 2.2 : 1.5;
    for (var i = 0; i < NP; i++) {
      var l = pl[i];
      if (l <= 0) continue;
      var a = l / pml[i], z = ps[i] * (0.35 + 0.65 * a) * m;
      g.globalAlpha = Math.min(1, a * 1.5);
      g.drawImage(pcol[i], px[i] - z / 2, py[i] - z / 2, z, z);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  function txt(g, s, x, y, font, align, col) {
    g.font = font; g.textAlign = align; g.fillStyle = col;
    g.fillText(s, x, y);
  }

  function drawHud(g, k, glow, S) {
    if (!r.hud || hudH < 8) return;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.textBaseline = 'alphabetic'; g.globalAlpha = glow ? 0.45 : 1;
    var lf = Math.round(hudH * 0.2), vf = Math.round(hudH * 0.46);
    var lab = '700 ' + lf + 'px ' + FONT, val = '800 ' + vf + 'px ' + MONO;
    var L = ox, R = ox + bw, C = ox + bw / 2, ls = Math.round(lf * 0.2) + 'px';
    var dbl = S.active && S.active.double > 0;
    var lc = 'rgba(150,200,255,.75)';
    if ('letterSpacing' in g) g.letterSpacing = ls;
    txt(g, 'SCORE', L, hudH * 0.3, lab, 'left', lc);
    txt(g, 'LEVEL', C, hudH * 0.3, lab, 'center', lc);
    txt(g, 'BEST', R, hudH * 0.3, lab, 'right', lc);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    var sc = scorePop > 0 ? '#ffffff' : dbl ? r.palette.powerups.double : '#c8f8ff';
    txt(g, String(S.score | 0).padStart(6, '0'), L, hudH * 0.8, val, 'left', sc);
    txt(g, String(S.level | 0), C, hudH * 0.8, val, 'center', '#ffd6fb');
    txt(g, String(Math.max(S.high | 0, S.score | 0)).padStart(6, '0'), R, hudH * 0.8, val, 'right', '#c8f8ff');
    if (S.combo > 1) {
      var bwid = vf * 3.6, bx = L, by = hudH * 0.9, bhh = Math.max(2, hudH * 0.05);
      var fr = clamp((S.comboMs || 0) / comboPeak, 0, 1);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(bx, by, bwid, bhh);
      g.fillStyle = '#ff4de0'; g.fillRect(bx, by, bwid * fr, bhh);
      txt(g, 'x' + S.combo, L + bwid + vf * 0.3, hudH * 0.96, '800 ' + Math.round(vf * 0.62) + 'px ' + MONO,
        'left', '#ff4de0');
    }
  }

  function scene(g, k, glow, S) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    var s = cs * k, tx = (ox + shx) * k, ty = (oy + shy) * k;
    g.setTransform(s, 0, 0, s, tx, ty);
    drawBorder(g, glow, S);
    g.save();
    g.beginPath(); g.rect(0, 0, gw, gh); g.clip();
    if (S.obstacles && S.obstacles.length) drawObstacles(g, S.obstacles);
    drawRipples(g, glow);
    if (S.food) drawFood(g, S.food, glow);
    var pus = S.powerups;
    if (pus) for (var i = 0; i < pus.length; i++) drawPowerup(g, pus[i], glow);
    if (snakeLen) {
      var act = S.active || {};
      if (act.magnet > 0) {
        g.globalAlpha = (glow ? 0.9 : 0.35) * (0.6 + 0.4 * Math.sin(T / 140));
        g.strokeStyle = r.palette.powerups.magnet; g.lineWidth = glow ? 0.25 : 0.06;
        g.beginPath(); g.arc(headX, headY, 2.2 + 0.25 * Math.sin(T / 200), 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }
      var ghost = act.ghost > 0, ga = 1;
      if (ghost) {
        ga = act.ghost < 2000 ? (((T / 90) | 0) & 1 ? 0.22 : 0.6) : 0.4 + 0.12 * Math.sin(T / 45);
      }
      if (ghost && !glow) {
        var t2 = tmpG.g;
        var gx = Math.max(0, Math.floor(tx) - 1), gy = Math.max(0, Math.floor(ty) - 1);
        var gw2 = Math.min(W, Math.ceil(tx + gw * s) + 1) - gx, gh2 = Math.min(H, Math.ceil(ty + gh * s) + 1) - gy;
        t2.setTransform(1, 0, 0, 1, 0, 0);
        t2.clearRect(gx, gy, gw2, gh2);
        t2.setTransform(s, 0, 0, s, tx, ty);
        drawSnake(t2, false);
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = ga;
        g.drawImage(tmpG.c, gx, gy, gw2, gh2, gx, gy, gw2, gh2);
        g.restore();
      } else {
        g.globalAlpha = glow ? ga * Math.min(1, 0.75 + gi * 0.25) : 1;
        drawSnake(g, glow);
        g.globalAlpha = 1;
      }
    }
    drawParticles(g, glow);
    g.restore();
    drawHud(g, k, glow, S);
  }

  function drawBackdrop(g) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(sky.c, 0, 0);
  }

  function getTmp(o) {
    if (!o) { o = mk(); size(o, W, H); }
    return o;
  }

  function chroma(g, amt) {
    tmpA = getTmp(tmpA); tmpB = getTmp(tmpB);
    var a = tmpA.g, b = tmpB.g, off = amt * 7 * dpr;
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'copy';
    a.drawImage(canvas, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    var ch = ['#ff0000', '#00ff00', '#0000ff'], of = [-off, 0, off];
    for (var i = 0; i < 3; i++) {
      b.globalCompositeOperation = 'copy';
      b.drawImage(tmpA.c, 0, 0);
      b.globalCompositeOperation = 'multiply';
      b.fillStyle = ch[i]; b.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(tmpB.c, of[i], 0);
    }
    g.globalCompositeOperation = 'source-over';
  }

  r.draw = function (S, dtMs) {
    if (!ready) r.resize(canvas.clientWidth || canvas.width || 800, canvas.clientHeight || canvas.height || 600, 1);
    var dt = clamp(dtMs == null ? 16.7 : dtMs, 0, 50), i;
    if (S.grid && (S.grid.w !== gw || S.grid.h !== gh)) { gw = S.grid.w; gh = S.grid.h; layout(); }
    var phase = S.phase;
    if (phase !== lastPhase) {
      if (phase === 'over') ca = 1;
      lastPhase = phase;
    }
    var ts = phase === 'paused' ? 0 : phase === 'over' ? lerp(1, 0.22, sstep((S.phaseMs || 0) / 700)) : 1;
    var d = dt * ts;
    T += d;

    for (i = 0; i < NP; i++) {
      if (pl[i] <= 0) continue;
      pl[i] -= d;
      var dr = 1 - 2.4 * d / 1000;
      pvx[i] *= dr; pvy[i] *= dr;
      px[i] += pvx[i] * d / 1000; py[i] += pvy[i] * d / 1000;
    }
    for (i = 0; i < RN; i++) if (rt[i] >= 0) { rt[i] += d; if (rt[i] > 850) rt[i] = -1; }
    if (shk.left > 0) {
      shk.left -= dt;
      var am = shk.left > 0 ? shk.amp * Math.pow(shk.left / shk.dur, 2) * dpr : 0;
      shx = (Math.random() * 2 - 1) * am; shy = (Math.random() * 2 - 1) * am;
    } else { shx = shy = 0; }
    if (fl.left > 0) fl.left -= dt;
    if (ca > 0) ca = Math.max(0, ca - dt / 520);

    var cm = S.combo || 0;
    gi += (clamp((cm - 1) / 5, 0, 1) - gi) * Math.min(1, dt / 160);
    if (cm <= 1) comboPeak = 1; else comboPeak = Math.max(comboPeak, S.comboMs || 0, 1);
    if (S.score !== lastScore) { if (S.score > lastScore) scorePop = 180; lastScore = S.score; }
    if (scorePop > 0) scorePop -= dt;
    var f = S.food;
    if (f) {
      if (f.x !== foodX || f.y !== foodY) { foodX = f.x; foodY = f.y; foodT = 0; }
      foodT += dt;
    }

    buildLut(Math.round((0.18 + gi * 0.3) * 20) / 20);
    buildSnake(S);

    var g = ctx;
    drawBackdrop(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = phase === 'title' ? 0.85 : 1;
    g.drawImage(boardC.c, ox + shx, oy + shy);
    g.globalAlpha = 1;
    if (phase === 'title') {
      var sy = oy + shy + ((T / 5200) % 1) * bh;
      var sg = g.createLinearGradient(0, sy - 40 * dpr, 0, sy + 4 * dpr);
      sg.addColorStop(0, 'rgba(34,232,255,0)'); sg.addColorStop(1, 'rgba(34,232,255,.16)');
      g.fillStyle = sg; g.globalCompositeOperation = 'lighter';
      g.save(); g.beginPath(); g.rect(ox + shx, oy + shy, bw, bh); g.clip();
      g.fillRect(ox + shx, sy - 40 * dpr, bw, 44 * dpr);
      g.restore(); g.globalCompositeOperation = 'source-over';
    }

    scene(g, 1, false, S);

    var gg = b1.g;
    gg.setTransform(1, 0, 0, 1, 0, 0);
    gg.globalCompositeOperation = 'source-over'; gg.globalAlpha = 1;
    gg.clearRect(0, 0, b1.c.width, b1.c.height);
    scene(gg, bk, true, S);
    gg.setTransform(1, 0, 0, 1, 0, 0); gg.globalAlpha = 1;
    bm.g.imageSmoothingQuality = 'low'; b2.g.imageSmoothingQuality = 'low';
    bm.g.clearRect(0, 0, bm.c.width, bm.c.height);
    bm.g.drawImage(b1.c, 0, 0, bm.c.width, bm.c.height);
    b2.g.clearRect(0, 0, b2.c.width, b2.c.height);
    b2.g.drawImage(bm.c, 0, 0, b2.c.width, b2.c.height);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
    var bl = r.nobloom ? 0 : 0.65 + gi * 0.5;
    if (bl > 0) {
      var cg = bc.g, cw = bc.c.width, ch = bc.c.height;
      cg.globalCompositeOperation = 'copy'; cg.globalAlpha = 0.2; cg.imageSmoothingQuality = 'low';
      cg.drawImage(b1.c, 0, 0);
      cg.globalCompositeOperation = 'lighter';
      cg.globalAlpha = 0.35; cg.drawImage(bm.c, 0, 0, cw, ch);
      cg.globalAlpha = 0.5; cg.drawImage(b2.c, 0, 0, cw, ch);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = bl; g.drawImage(bc.c, 0, 0, W, H);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

    var act = S.active || {};
    if (act.slow > 0) {
      g.fillStyle = 'rgba(40,110,255,.07)'; g.fillRect(ox + shx, oy + shy, bw, bh);
    }
    if (phase === 'over') {
      var k = sstep((S.phaseMs || 0) / 900);
      if (!coarse) {
        g.globalCompositeOperation = 'saturation';
        g.globalAlpha = 0.88 * k; g.fillStyle = '#808080';
        g.fillRect(0, 0, W, H);
      }
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = (coarse ? 0.5 : 0.38) * k; g.fillStyle = '#12000e';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    } else if (phase === 'paused') {
      g.fillStyle = 'rgba(4,0,16,.5)'; g.fillRect(0, 0, W, H);
    }
    if (fl.left > 0) {
      var fa = Math.pow(fl.left / fl.dur, 2) * 0.55;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = fa; g.fillStyle = fl.col;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    if (!coarse && ca > 0.02) chroma(g, ca * ca);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(ovl.c, 0, 0);
  };

  return r;
}

window.SnakeRender = { create: create };
})();
