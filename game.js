(function () {
  'use strict';

  const N = 24, START_TICK = 150, STEP = 15, MIN_TICK = 60, GRACE = 0.5, QMAX = 2;
  const TILT_ON = 14, TILT_OFF = 8, TILT_BIAS = 4;
  const FOOD_PER_LEVEL = 5, BASE_PTS = 10, SLOW_MUL = 1.6, MAG_R = 5, PU_TTL = 10000;
  const DUR = { slow: 6000, ghost: 5000, magnet: 7000, double: 8000 };
  const KINDS = Object.keys(DUR);
  const PU_COL = { slow: '#4da3ff', ghost: '#c9b6ff', magnet: '#ff9f1c', double: '#ffd23f' };
  const HIGH_KEY = 'lighthouse.neonsnake.highscore';
  const SET_KEY = 'lighthouse.neonsnake.settings';
  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const KEYDIR = {
    ArrowUp: DIRS[0], ArrowDown: DIRS[1], ArrowLeft: DIRS[2], ArrowRight: DIRS[3],
    w: DIRS[0], s: DIRS[1], a: DIRS[2], d: DIRS[3]
  };
  const TEMPL = [
    [[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
    [[0, 0], [2, 0], [0, 2], [2, 2]]
  ];

  const doc = document, win = window;
  const $ = (id) => doc.getElementById(id);
  const canvas = $('game');
  const app = $('app');
  const el = {
    score: $('hud-score'), high: $('hud-high'), level: $('hud-level'),
    combo: $('combo'), comboX: $('combo-x'), comboBar: $('combo-bar'),
    toast: $('toast'), mute: $('mute'),
    ovScore: $('ov-score'), ovFood: $('ov-food'), ovBase: $('ov-base'), ovCombo: $('ov-combo'),
    ovDbl: $('ov-dbl'), ovMax: $('ov-max'), ovLevel: $('ov-level'), ovHigh: $('ov-high'),
    ovNew: $('ov-new'), optMusic: $('opt-music'), optSfx: $('opt-sfx'), optTilt: $('opt-tilt'), btnPause: $('btn-pause')
  };

  const rnd = (n) => Math.floor(Math.random() * n);
  const clone = (a) => a.map((p) => ({ x: p.x, y: p.y }));
  const AU = () => (typeof SnakeAudio !== 'undefined' && SnakeAudio) || null;
  let R = null;

  let snake, prev, dir, queue, undo, food, powerups, obstacles, fix = null;
  let active, score, combo, comboMs, level, eaten, acc, evt;
  let phase = 'title', phaseMs = 0, timeMs = 0, demo = true, demoResetAt = 0;
  let spawnIn, maxCombo, basePts, comboBonus, dblBonus, newBest, lastIntensity = -1, intensityAt = 0;
  let high = 0, dispScore = 0, dispHigh = 0, celebAt = 0, toastUntil = 0, pausedFrom = 'playing';
  let muted = false, audioReady = false, reducedMotion = false;
  let settings = { music: true, sfx: true, tilt: false };
  let last = null;

  try { high = Number(localStorage.getItem(HIGH_KEY)) || 0; } catch (e) { high = 0; }
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY));
    if (s && typeof s === 'object') settings = { music: s.music !== false, sfx: s.sfx !== false, tilt: s.tilt === true };
  } catch (e) { /* defaults */ }
  try {
    const mq = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq) {
      reducedMotion = !!mq.matches;
      if (mq.addEventListener) mq.addEventListener('change', (e) => { reducedMotion = !!e.matches; });
    }
  } catch (e) { /* ignore */ }

  const ST = {
    grid: { w: N, h: N }, snake: [], prev: [], alpha: 0, dir: [1, 0], food: null, powerups: [],
    obstacles: [], active: {}, score: 0, high: 0, combo: 0, comboMs: 0, level: 1,
    phase: 'title', phaseMs: 0, timeMs: 0, reducedMotion: false,
    comboWinMs: 3200, demo: true, muted: false, newBest: false, eaten: 0, tickMs: START_TICK
  };

  function baseTick() { return Math.max(MIN_TICK, START_TICK - STEP * Math.floor(eaten / FOOD_PER_LEVEL)); }
  function tickMs() { return baseTick() * (active.slow > 0 ? SLOW_MUL : 1); }
  function comboWin() { return Math.max(1800, 3200 - (level - 1) * 120); }

  function fx(name, a, b, c, d) { if (R && typeof R[name] === 'function') R[name](a, b, c, d); }
  function sfx(name, opts, force) {
    const a = AU();
    if (!a || (!settings.sfx && !force) || typeof a.play !== 'function') return;
    a.play(name, opts);
  }
  function pal() { return (R && R.palette) || {}; }
  function colFood() { return pal().food || '#ff2e88'; }
  function colSnake() {
    const p = pal().snake;
    return typeof p === 'string' ? p : (p && (p.head || p.body || p.color)) || '#00f5d4';
  }
  function colPU(k) {
    const p = pal(), v = (p.powerups && p.powerups[k]) || p[k];
    return typeof v === 'string' ? v : PU_COL[k];
  }
  function shake(px, ms) { fx('shake', reducedMotion ? px * 0.25 : px, ms); }

  function setPhase(p) {
    phase = p; phaseMs = 0;
    if (app) app.setAttribute('data-phase', p);
    if (p === 'playing') tiltBase = null;
  }

  function occupancy(extra) {
    const o = new Uint8Array(N * N);
    for (const p of snake) o[p.y * N + p.x] = 1;
    for (const p of obstacles) o[p.y * N + p.x] = 1;
    if (food) o[food.y * N + food.x] = 1;
    for (const p of powerups) o[p.y * N + p.x] = 1;
    if (extra) for (const p of extra) o[p.y * N + p.x] = 1;
    return o;
  }

  function freeCell() {
    const o = occupancy(), free = [];
    for (let i = 0; i < o.length; i++) if (!o[i]) free.push(i);
    if (!free.length) return null;
    const i = free[rnd(free.length)];
    return { x: i % N, y: Math.floor(i / N) };
  }

  function obsAt(x, y) {
    for (const p of obstacles) if (p.x === x && p.y === y) return true;
    return false;
  }

  function forbidMap() {
    const f = new Uint8Array(N * N), h = snake[0];
    const mark = (x, y) => { if (x >= 0 && y >= 0 && x < N && y < N) f[y * N + x] = 1; };
    for (const p of snake) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) mark(p.x + dx, p.y + dy);
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) mark(h.x + dx, h.y + dy);
    for (let k = 1; k <= 10; k++) for (let q = -1; q <= 1; q++) {
      const x = ((h.x + dir[0] * k - dir[1] * q) % N + N) % N;
      const y = ((h.y + dir[1] * k + dir[0] * q) % N + N) % N;
      mark(x, y);
    }
    if (food) mark(food.x, food.y);
    for (const p of powerups) mark(p.x, p.y);
    return f;
  }

  function layoutOk(cells) {
    const blk = new Uint8Array(N * N);
    for (const p of cells) blk[p.y * N + p.x] = 1;
    let total = 0;
    for (let i = 0; i < blk.length; i++) if (!blk[i]) total++;
    const h = snake[0], seen = new Uint8Array(N * N), st = [h.y * N + h.x];
    seen[st[0]] = 1;
    let n = 0;
    while (st.length) {
      const i = st.pop(); n++;
      const x = i % N, y = Math.floor(i / N);
      for (const d of DIRS) {
        const nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (blk[j] || seen[j]) continue;
        seen[j] = 1; st.push(j);
      }
    }
    if (n !== total) return false;
    for (let i = 0; i < blk.length; i++) {
      if (blk[i]) continue;
      const x = i % N, y = Math.floor(i / N);
      let nb = 0;
      for (const d of DIRS) {
        const nx = x + d[0], ny = y + d[1];
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && !blk[ny * N + nx]) nb++;
      }
      if (nb < 2) return false;
    }
    return true;
  }

  function genObstacles() {
    const want = Math.min(6 + (level - 3) * 3, 36), out = [], forbid = forbidMap();
    const taken = new Uint8Array(N * N);
    for (let tries = 0; out.length < want && tries < 300; tries++) {
      const t = TEMPL[rnd(TEMPL.length)], swap = rnd(2), sx = rnd(2) ? 1 : -1, sy = rnd(2) ? 1 : -1;
      const ox = rnd(N), oy = rnd(N);
      const cells = t.map((c) => {
        const a = swap ? c[1] : c[0], b = swap ? c[0] : c[1];
        return { x: ox + a * sx, y: oy + b * sy };
      });
      let ok = true;
      for (const p of cells) {
        if (p.x < 0 || p.y < 0 || p.x >= N || p.y >= N || forbid[p.y * N + p.x] || taken[p.y * N + p.x]) { ok = false; break; }
      }
      if (!ok || !layoutOk(out.concat(cells))) continue;
      for (const p of cells) { taken[p.y * N + p.x] = 1; out.push(p); }
    }
    return out;
  }

  function placeFood() { return freeCell(); }

  function resetWorld(isDemo) {
    demo = isDemo;
    snake = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }];
    prev = clone(snake);
    fix = null; dir = [1, 0]; queue = []; undo = null; food = null; powerups = []; obstacles = [];
    active = { slow: 0, ghost: 0, magnet: 0, double: 0 };
    score = 0; combo = 0; comboMs = 0; level = 1; eaten = isDemo ? 10 : 0; acc = 0; evt = false;
    maxCombo = 0; basePts = 0; comboBonus = 0; dblBonus = 0; newBest = false;
    spawnIn = isDemo ? 4000 : 8000;
    level = 1 + Math.floor(eaten / FOOD_PER_LEVEL);
    if (level >= 3) obstacles = genObstacles();
    food = placeFood();
    dispScore = 0;
  }

  function startGame() {
    initAudio();
    resetWorld(false);
    setPhase('playing');
    sfx('start');
    applyMusic();
  }

  function toTitle() {
    resetWorld(true);
    setPhase('title');
    sfx('menu_select');
  }

  function pause() {
    if (phase !== 'playing') return;
    setPhase('paused');
    sfx('pause', null, true);
  }
  function resume() {
    if (phase !== 'paused') return;
    setPhase('playing');
    sfx('resume', null, true);
  }

  function persistHigh() {
    try { localStorage.setItem(HIGH_KEY, String(high)); } catch (e) { /* ignore */ }
  }

  function die() {
    prev = clone(snake);
    if (demo) {
      for (let i = 0; i < snake.length; i += 2) fx('burst', snake[i].x, snake[i].y, colSnake(), 6);
      demoResetAt = timeMs + 900;
      demo = 'dead';
      return;
    }
    evt = true;
    newBest = score > high && score > 0;
    if (newBest) { high = score; persistHigh(); }
    setPhase('over');
    shake(22, 650);
    fx('flash', '#ff1744', 380);
    for (let i = 0; i < snake.length; i++) fx('burst', snake[i].x, snake[i].y, i === 0 ? '#ffffff' : colSnake(), i === 0 ? 30 : 8);
    sfx('death');
    const a = AU();
    if (a && a.setIntensity) a.setIntensity(0);
    lastIntensity = 0;
    fillOver();
    celebAt = timeMs + 900;
  }

  function fillOver() {
    const set = (e, v) => { if (e) e.textContent = String(v); };
    set(el.ovScore, score); set(el.ovFood, eaten); set(el.ovBase, basePts);
    set(el.ovCombo, '+' + comboBonus); set(el.ovDbl, '+' + dblBonus); set(el.ovMax, 'x' + Math.max(1, maxCombo));
    set(el.ovLevel, level); set(el.ovHigh, high);
    if (el.ovNew) el.ovNew.classList[newBest ? 'add' : 'remove']('on');
  }

  function toast(msg, ms) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    toastUntil = timeMs + (ms || 1400);
  }

  function levelUp() {
    evt = true;
    if (level >= 3) {
      const o = genObstacles();
      if (o.length) obstacles = o;
    }
    fx('flash', '#ffffff', reducedMotion ? 160 : 320);
    shake(5, 250);
    if (!demo) { sfx('levelup'); toast('LEVEL ' + level, 1600); }
  }

  function eat(x, y) {
    evt = true;
    eaten++;
    combo = comboMs > 0 ? combo + 1 : 1;
    comboMs = comboWin();
    if (combo > maxCombo) maxCombo = combo;
    const dbl = active.double > 0 ? 2 : 1;
    score += BASE_PTS * combo * dbl;
    basePts += BASE_PTS; comboBonus += BASE_PTS * (combo - 1); dblBonus += BASE_PTS * combo * (dbl - 1);
    const cx = x, cy = y;
    fx('burst', cx, cy, colFood(), 14 + Math.min(combo, 10) * 3);
    fx('ripple', cx, cy);
    if (!demo) {
      sfx('eat', { level: Math.min(10, combo) });
      if (combo > 1) sfx('combo', { level: Math.min(10, combo) });
    }
    food = null;
    const nl = 1 + Math.floor(eaten / FOOD_PER_LEVEL);
    if (nl > level) { level = nl; levelUp(); }
    food = placeFood();
  }

  function pickup(i) {
    evt = true;
    const p = powerups.splice(i, 1)[0];
    active[p.kind] = DUR[p.kind];
    fx('burst', p.x, p.y, colPU(p.kind), 18);
    fx('ripple', p.x, p.y);
    if (!demo) { sfx('powerup'); toast(p.kind.toUpperCase(), 900); }
  }

  function magnetPull() {
    if (!(active.magnet > 0) || !food) return false;
    const h = snake[0], dx = h.x - food.x, dy = h.y - food.y;
    if ((dx === 0 && dy === 0) || Math.hypot(dx, dy) > MAG_R) return false;
    const tryMove = (mx, my) => {
      const nx = food.x + mx, ny = food.y + my;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || obsAt(nx, ny)) return false;
      if (!(nx === h.x && ny === h.y) && snake.some((p) => p.x === nx && p.y === ny)) return false;
      food.x = nx; food.y = ny;
      return true;
    };
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const xFirst = Math.abs(dx) >= Math.abs(dy);
    const moved = xFirst ? (sx && tryMove(sx, 0)) || (sy && tryMove(0, sy)) : (sy && tryMove(0, sy)) || (sx && tryMove(sx, 0));
    return !!moved && food.x === h.x && food.y === h.y;
  }

  function unwrapPrev() {
    for (let i = 0; i < snake.length; i++) {
      const q = prev[Math.min(i, prev.length - 1)];
      if (i >= prev.length) continue;
      const p = snake[i];
      const dx = p.x - q.x, dy = p.y - q.y;
      if (dx > 1) q.x = p.x + 1; else if (dx < -1) q.x = p.x - 1;
      if (dy > 1) q.y = p.y + 1; else if (dy < -1) q.y = p.y - 1;
    }
  }

  function step() {
    evt = false; fix = null;
    if (demo === true) queue = [aiPick()];
    undo = queue.length ? null : { snake: clone(snake), dir, food: food && { x: food.x, y: food.y } };
    prev = clone(snake);
    if (queue.length) dir = queue.shift();
    const ghost = active.ghost > 0;
    let hx = snake[0].x + dir[0], hy = snake[0].y + dir[1];
    if (ghost) { hx = (hx + N) % N; hy = (hy + N) % N; }
    else if (hx < 0 || hy < 0 || hx >= N || hy >= N) return die();
    if (obsAt(hx, hy)) return die();
    const grows = !!food && food.x === hx && food.y === hy;
    if (!ghost) {
      const body = grows ? snake : snake.slice(0, -1);
      for (const p of body) if (p.x === hx && p.y === hy) return die();
    }
    snake.unshift({ x: hx, y: hy });
    const pi = powerups.findIndex((p) => p.x === hx && p.y === hy);
    if (pi >= 0) pickup(pi);
    let popped = null;
    if (grows) eat(hx, hy); else popped = snake.pop();
    if (magnetPull()) {
      eat(hx, hy);
      if (popped) snake.push(popped);
    }
    unwrapPrev();
    if (evt) undo = null;
  }

  function aiPick() {
    const h = snake[0], blk = new Uint8Array(N * N);
    for (let i = 0; i < snake.length - 1; i++) blk[snake[i].y * N + snake[i].x] = 1;
    for (const o of obstacles) blk[o.y * N + o.x] = 1;
    const dist = new Int16Array(N * N).fill(-1);
    if (food) {
      const q = [food.y * N + food.x];
      dist[q[0]] = 0;
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi], x = i % N, y = Math.floor(i / N);
        for (const d of DIRS) {
          const nx = x + d[0], ny = y + d[1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (dist[j] >= 0 || blk[j]) continue;
          dist[j] = dist[i] + 1; q.push(j);
        }
      }
    }
    const space = (sx, sy) => {
      const seen = new Uint8Array(N * N), st = [sy * N + sx];
      seen[st[0]] = 1;
      let n = 0;
      while (st.length && n < 400) {
        const i = st.pop(); n++;
        const x = i % N, y = Math.floor(i / N);
        for (const d of DIRS) {
          const nx = x + d[0], ny = y + d[1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (seen[j] || blk[j]) continue;
          seen[j] = 1; st.push(j);
        }
      }
      return n;
    };
    const c = [];
    for (const d of DIRS) {
      if (d[0] === -dir[0] && d[1] === -dir[1]) continue;
      const nx = h.x + d[0], ny = h.y + d[1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || blk[ny * N + nx]) continue;
      const dd = dist[ny * N + nx];
      c.push({ d, dist: dd < 0 ? 9999 : dd, space: space(nx, ny) });
    }
    if (!c.length) return dir;
    const ok = c.filter((e) => e.space >= snake.length + 2);
    if (ok.length) { ok.sort((a, b) => a.dist - b.dist || b.space - a.space); return ok[0].d; }
    c.sort((a, b) => b.space - a.space);
    return c[0].d;
  }

  function isTurn(k, f) { return k[0] !== f[0] && k[1] !== f[1]; }

  function onDir(k) {
    if (phase !== 'playing') return;
    if (undo && !queue.length && acc < tickMs() * GRACE && isTurn(k, undo.dir)) {
      const od = undo.dir, a = acc / tickMs();
      snake = undo.snake; dir = od; food = undo.food; undo = null;
      queue = [k];
      step();
      if (phase === 'playing') { const f = a / (1 - a), P = prev[0]; fix = { x: P.x + f * (od[0] - k[0]), y: P.y + f * (od[1] - k[1]) }; }
      if (phase === 'playing') sfx('turn');
      return;
    }
    const from = queue.length ? queue[queue.length - 1] : dir;
    if (queue.length < QMAX && isTurn(k, from)) { queue.push(k); sfx('turn'); }
  }

  function spawnPowerup() {
    const c = freeCell();
    if (!c) return;
    powerups.push({ x: c.x, y: c.y, kind: KINDS[rnd(KINDS.length)], ttlMs: PU_TTL });
  }

  function timers(dt) {
    if (comboMs > 0) { comboMs -= dt; if (comboMs <= 0) { comboMs = 0; combo = 0; } }
    for (const k of KINDS) {
      if (active[k] > 0) {
        active[k] -= dt;
        if (active[k] <= 0) { active[k] = 0; if (!demo) sfx('powerdown'); }
      }
    }
    for (let i = powerups.length - 1; i >= 0; i--) {
      powerups[i].ttlMs -= dt;
      if (powerups[i].ttlMs <= 0) powerups.splice(i, 1);
    }
    spawnIn -= dt;
    if (spawnIn <= 0) {
      if (powerups.length < 2) spawnPowerup();
      spawnIn = 7000 + rnd(7000);
    }
  }

  function update(dt) {
    if (phase === 'title' && demo === 'dead') {
      if (timeMs >= demoResetAt) resetWorld(true);
      return;
    }
    if (phase !== 'playing' && phase !== 'title') return;
    acc += dt;
    for (let n = 0; n < 6 && (phase === 'playing' || (phase === 'title' && demo === true)); n++) {
      const t = tickMs();
      if (acc < t) break;
      acc -= t;
      step();
    }
    if (phase === 'playing' || phase === 'title') timers(dt);
  }

  function intensity() {
    if (phase === 'title') return 0.2;
    if (phase === 'paused') return 0.1;
    if (phase === 'over') return 0;
    const sp = (START_TICK - baseTick()) / (START_TICK - MIN_TICK);
    return Math.min(1, 0.65 * sp + 0.35 * Math.min(combo, 10) / 10 + (active.slow > 0 ? -0.1 : 0));
  }

  function updateAudio() {
    const a = AU();
    if (!a || typeof a.setIntensity !== 'function') return;
    if (timeMs - intensityAt < 120) return;
    intensityAt = timeMs;
    const x = Math.max(0, intensity());
    if (Math.abs(x - lastIntensity) > 0.02) { lastIntensity = x; a.setIntensity(x); }
  }

  function applyMusic() {
    const a = AU();
    if (!a) return;
    if (typeof a.setMusic === 'function') a.setMusic(!!settings.music);
    if (typeof a.setMuted === 'function') a.setMuted(muted);
  }

  function initAudio() {
    const a = AU();
    if (!a) return;
    if (typeof a.init === 'function') a.init();
    if (!audioReady) { audioReady = true; applyMusic(); }
  }

  function toggleMute() {
    muted = !muted;
    const a = AU();
    if (a && typeof a.setMuted === 'function') a.setMuted(muted);
    if (el.mute) el.mute.classList[muted ? 'add' : 'remove']('on');
  }

  function saveSettings() {
    try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function confirmAction() {
    if (phase === 'title') startGame();
    else if (phase === 'over') { if (phaseMs > 350) startGame(); }
    else if (phase === 'paused') resume();
  }

  function onKey(e) {
    initAudio();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key || '';
    const lk = key.length === 1 ? key.toLowerCase() : key;
    if (lk === 'm') { toggleMute(); return; }
    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'CapsLock' || key === 'Tab') return;
    const onInput = e.target && e.target.tagName === 'INPUT';
    if (phase === 'title') {
      if (onInput && (key === ' ' || key === 'Enter')) return;
      if (e.preventDefault) e.preventDefault();
      startGame();
      return;
    }
    if (phase === 'over') {
      if (key === 'Escape') { toTitle(); return; }
      if (key === ' ' || key === 'Enter') { if (e.preventDefault) e.preventDefault(); confirmAction(); }
      return;
    }
    if (lk === 'p' || key === 'Escape') {
      if (phase === 'playing') pause(); else if (phase === 'paused') resume();
      return;
    }
    const k = KEYDIR[key] || KEYDIR[lk];
    if (!k) return;
    if (e.preventDefault) e.preventDefault();
    onDir(k);
  }

  let tx = 0, ty = 0, tActive = false;
  const inUi = (t) => !!(t && t.closest && t.closest('button,.settings,label,input'));
  function swipeMin() { return Math.max(22, Math.min(win.innerWidth || 600, win.innerHeight || 600) * 0.035); }
  function onTouchStart(e) {
    initAudio();
    if (inUi(e.target)) return;
    const t = e.changedTouches[0];
    tx = t.clientX; ty = t.clientY; tActive = true;
    if (e.cancelable && e.preventDefault) e.preventDefault();
  }
  function onTouchMove(e) {
    if (!tActive) return;
    if (e.cancelable && e.preventDefault) e.preventDefault();
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < swipeMin()) return;
    onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS[3] : DIRS[2]) : (dy > 0 ? DIRS[1] : DIRS[0]));
    tx = t.clientX; ty = t.clientY;
  }
  function onTouchEnd() { tActive = false; initAudio(); }
  function onClick(e) {
    initAudio();
    if (inUi(e.target)) return;
    confirmAction();
  }

  let tiltBase = null, tiltZone = null, tiltOn = false;
  const tiltSupported = () => typeof DeviceOrientationEvent !== 'undefined' && (navigator.maxTouchPoints || 0) > 0;
  const wrap = (a) => ((a + 540) % 360) - 180;
  function screenAngle() {
    const o = win.screen && win.screen.orientation;
    return o && typeof o.angle === 'number' ? o.angle : (Number(win.orientation) || 0);
  }
  function onTilt(e) {
    if (e.beta == null || e.gamma == null) return;
    if (!tiltBase) { tiltBase = { b: e.beta, g: e.gamma }; tiltZone = null; return; }
    const db = wrap(e.beta - tiltBase.b), dg = wrap(e.gamma - tiltBase.g);
    const a = ((screenAngle() % 360) + 360) % 360;
    const x = a === 90 ? db : a === 180 ? -dg : a === 270 ? -db : dg;
    const y = a === 90 ? -dg : a === 180 ? -db : a === 270 ? dg : db;
    const ax = Math.abs(x), ay = Math.abs(y), m = Math.max(ax, ay);
    if (m < TILT_OFF) { tiltZone = null; return; }
    if (m < TILT_ON) return;
    if (tiltZone && Math.abs(ax - ay) < TILT_BIAS) return;
    const z = ax > ay ? (x > 0 ? 3 : 2) : (y > 0 ? 1 : 0);
    if (z === tiltZone) return;
    tiltZone = z;
    onDir(DIRS[z]);
  }
  function setTilt(on) {
    if (on === tiltOn) return;
    tiltOn = on; tiltBase = null; tiltZone = null;
    win[on ? 'addEventListener' : 'removeEventListener']('deviceorientation', onTilt);
  }
  function enableTilt() {
    const D = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
    if (D && typeof D.requestPermission === 'function') {
      D.requestPermission().then((r) => setTilt(r === 'granted' && settings.tilt)).catch(() => setTilt(false));
    } else setTilt(true);
  }

  let padPrev = { up: false, down: false, left: false, right: false, a: false, start: false, b: false, any: false };
  function pollPad() {
    const gps = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : null;
    if (!gps) return;
    const cur = { up: false, down: false, left: false, right: false, a: false, start: false, b: false, any: false };
    for (const gp of gps) {
      if (!gp) continue;
      const b = gp.buttons || [], ax = gp.axes || [];
      const bp = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
      cur.up = cur.up || bp(12) || ax[1] < -0.55;
      cur.down = cur.down || bp(13) || ax[1] > 0.55;
      cur.left = cur.left || bp(14) || ax[0] < -0.55;
      cur.right = cur.right || bp(15) || ax[0] > 0.55;
      cur.a = cur.a || bp(0);
      cur.b = cur.b || bp(1);
      cur.start = cur.start || bp(9);
      for (let i = 0; i < b.length; i++) if (bp(i)) cur.any = true;
    }
    const edge = (k) => cur[k] && !padPrev[k];
    if (edge('up')) onDir(DIRS[0]);
    if (edge('down')) onDir(DIRS[1]);
    if (edge('left')) onDir(DIRS[2]);
    if (edge('right')) onDir(DIRS[3]);
    if (edge('start')) { if (phase === 'playing') pause(); else confirmAction(); }
    else if (edge('a')) confirmAction();
    else if (edge('any') && phase === 'title') confirmAction();
    if (edge('b')) { if (phase === 'over') toTitle(); else if (phase === 'paused') resume(); }
    padPrev = cur;
  }

  function popEl(e) {
    if (!e) return;
    e.classList.remove('pop');
    void e.offsetWidth;
    e.classList.add('pop');
  }
  const cache = {};
  function txt(key, e, v) {
    if (!e || cache[key] === v) return;
    cache[key] = v; e.textContent = v;
  }

  function hud(dt) {
    const hs = Math.max(high, score);
    if (dispScore > score) dispScore = score;
    if (dispScore < score) {
      const inc = Math.max(1, Math.ceil((score - dispScore) * Math.min(1, dt / 140)));
      dispScore = Math.min(score, dispScore + inc);
      popEl(el.score);
    }
    if (dispHigh > hs) dispHigh = hs;
    if (dispHigh < hs) dispHigh = Math.min(hs, dispHigh + Math.max(1, Math.ceil((hs - dispHigh) * Math.min(1, dt / 140))));
    txt('s', el.score, String(dispScore));
    txt('h', el.high, String(dispHigh));
    const lvChanged = cache.l !== String(level);
    txt('l', el.level, String(level));
    if (lvChanged && phase === 'playing') popEl(el.level);
    const on = comboMs > 0 && combo >= 1;
    if (el.combo) {
      if (cache.co !== on) { cache.co = on; el.combo.classList[on ? 'add' : 'remove']('on'); }
      if (on) {
        txt('cx', el.comboX, 'x' + combo);
        if (el.comboBar) {
          const w = Math.max(0, Math.min(1, comboMs / comboWin()));
          el.comboBar.style.transform = 'scaleX(' + w.toFixed(3) + ')';
          el.comboBar.classList[w < 0.3 ? 'add' : 'remove']('low');
        }
      }
    }
    for (const k of KINDS) {
      const chip = $('chip-' + k);
      if (!chip) continue;
      const on2 = active[k] > 0;
      if (cache['c' + k] !== on2) { cache['c' + k] = on2; chip.classList[on2 ? 'add' : 'remove']('on'); }
      if (on2) {
        const sec = (active[k] / 1000).toFixed(1);
        if (cache['t' + k] !== sec) {
          cache['t' + k] = sec;
          const t = chip.querySelector && chip.querySelector('.t');
          if (t) t.textContent = sec;
          const b = chip.querySelector && chip.querySelector('.b');
          if (b) b.style.transform = 'scaleX(' + Math.min(1, active[k] / DUR[k]).toFixed(3) + ')';
        }
      }
    }
    if (toastUntil && timeMs >= toastUntil) {
      toastUntil = 0;
      if (el.toast) el.toast.classList.remove('show');
    }
  }

  function celebrate() {
    if (phase !== 'over' || !newBest || timeMs < celebAt || timeMs > celebAt + 4500) return;
    celebAt = timeMs + 260;
    const cols = ['#ff2e88', '#00f5d4', '#ffd23f', '#8a5cff', '#ffffff'];
    fx('burst', 3 + Math.random() * 18, 3 + Math.random() * 18, cols[rnd(cols.length)], 26);
    if (!reducedMotion) fx('ripple', 3 + Math.random() * 18, 3 + Math.random() * 18);
  }

  function buildState() {
    ST.snake = snake; ST.prev = fix ? [fix].concat(prev.slice(1)) : prev; ST.dir = dir; ST.food = food; ST.powerups = powerups;
    ST.obstacles = obstacles; ST.active = active; ST.score = score; ST.high = Math.max(high, score);
    ST.combo = combo; ST.comboMs = comboMs; ST.level = level; ST.phase = phase; ST.phaseMs = phaseMs;
    ST.timeMs = timeMs; ST.reducedMotion = reducedMotion; ST.comboWinMs = comboWin();
    ST.demo = demo !== false; ST.muted = muted; ST.newBest = newBest; ST.eaten = eaten;
    const t = tickMs();
    ST.tickMs = t;
    ST.alpha = phase === 'over' || (phase === 'title' && demo === 'dead') ? 1 : Math.max(0, Math.min(1, acc / t));
    return ST;
  }

  let errAt = 0;
  function frame(now) {
    win.requestAnimationFrame(frame);
    const dt = last === null ? 0 : Math.min(Math.max(now - last, 0), 250);
    last = now;
    pollPad();
    timeMs += dt; phaseMs += dt;
    update(dt);
    celebrate();
    updateAudio();
    hud(dt);
    if (R) {
      try { R.draw(buildState(), dt); } catch (err) {
        if (timeMs - errAt > 2000) { errAt = timeMs; console.error(err); }
      }
    }
  }

  function resize() {
    const w = win.innerWidth || 800, h = win.innerHeight || 600, dpr = Math.min(win.devicePixelRatio || 1, 2);
    if (R && typeof R.resize === 'function') R.resize(w, h, dpr);
  }

  function boot() {
    if (typeof SnakeRender !== 'undefined' && SnakeRender && typeof SnakeRender.create === 'function' && canvas) {
      R = SnakeRender.create(canvas);
      R.hud = false; R.reserve = true;
    }
    resize();
    win.addEventListener('resize', resize);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('touchstart', onTouchStart, { passive: false });
    doc.addEventListener('touchmove', onTouchMove, { passive: false });
    doc.addEventListener('touchend', onTouchEnd);
    doc.addEventListener('touchcancel', onTouchEnd);
    doc.addEventListener('click', onClick);
    doc.addEventListener('visibilitychange', () => { if (doc.hidden || doc.visibilityState === 'hidden') pause(); });
    doc.addEventListener('contextmenu', (e) => { if (e.preventDefault) e.preventDefault(); });
    if (el.btnPause) el.btnPause.addEventListener('click', () => { if (phase === 'playing') pause(); else resume(); });
    if (el.mute) el.mute.addEventListener('click', toggleMute);
    if (el.optMusic) {
      el.optMusic.checked = settings.music;
      el.optMusic.addEventListener('change', () => {
        settings.music = !!el.optMusic.checked; saveSettings(); initAudio(); applyMusic(); sfx('menu_move');
      });
    }
    if (el.optSfx) {
      el.optSfx.checked = settings.sfx;
      el.optSfx.addEventListener('change', () => {
        settings.sfx = !!el.optSfx.checked; saveSettings(); initAudio(); sfx('menu_move');
      });
    }
    if (el.optTilt && tiltSupported()) {
      el.optTilt.closest('label').hidden = false;
      el.optTilt.checked = settings.tilt;
      if (settings.tilt) setTilt(true);
      el.optTilt.addEventListener('change', () => {
        settings.tilt = !!el.optTilt.checked; saveSettings(); initAudio(); sfx('menu_move');
        if (settings.tilt) enableTilt(); else setTilt(false);
      });
    }
    if (win.screen && win.screen.orientation && win.screen.orientation.addEventListener) {
      win.screen.orientation.addEventListener('change', () => { tiltBase = null; });
    }
    resetWorld(true);
    setPhase('title');
    dispHigh = high;
    win.requestAnimationFrame(frame);
  }

  win.__neonSnake = {
    frame, startGame, toTitle, step, tickMs, genObstacles, onKey, aiPick,
    get: () => ({ snake, prev, dir, queue, undo, food, powerups, obstacles, active, score, combo, comboMs, level, eaten, acc, phase, high, demo }),
    set: (o) => {
      if ('snake' in o) snake = o.snake;
      if ('dir' in o) dir = o.dir;
      if ('food' in o) food = o.food;
      if ('obstacles' in o) obstacles = o.obstacles;
      if ('powerups' in o) powerups = o.powerups;
      if ('active' in o) Object.assign(active, o.active);
      if ('acc' in o) acc = o.acc;
      if ('eaten' in o) eaten = o.eaten;
      if ('level' in o) level = o.level;
      if ('queue' in o) queue = o.queue;
      if ('score' in o) score = o.score;
      if ('high' in o) high = o.high;
      if ('prev' in o) prev = o.prev;
    }
  };

  boot();
})();
