# Neon Snake module contract

Files in games/neon-snake/: index.html, audio.js, render.js, game.js. Classic scripts (NOT ES modules, must run from file://), loaded in that order, each an IIFE attaching one global. No external network deps, no build, no assets: everything procedural.

## window.SnakeAudio (audio.js)
- init(): create AudioContext; called on first user gesture. Safe to call repeatedly.
- play(name, opts?): names: start, turn, eat, combo (opts.level 1..10), powerup, powerdown, levelup, death, pause, resume, menu_move, menu_select.
- setIntensity(x 0..1): music layers/tempo react to game speed + combo.
- setMusic(on: bool), setMuted(bool), get muted.
- All calls no-op safely before init().

## window.SnakeRender (render.js)
- create(canvas) -> r
- r.resize(cssW, cssH, dpr)
- r.draw(state, dtMs): render one frame from state (below). Must hold 60fps+ at 1080p on a laptop iGPU.
- r.burst(cellX, cellY, color, count?) particles at cell (float coords ok)
- r.shake(intensityPx, durationMs)
- r.flash(color, durationMs)
- r.ripple(cellX, cellY) shockwave
- colors are CSS strings; renderer owns its palette in r.palette (food, snake, powerups by kind).

## state (owned by game.js, passed every frame)
{
  grid: {w, h},                 // cells, e.g. 24x24
  snake: [{x,y}], prev: [{x,y}],// head first; draw segment i lerped prev[min(i,prev.length-1)] -> snake[i] by alpha
  alpha: 0..1,                  // progress through current tick
  dir: [dx,dy],
  food: {x,y} | null,
  powerups: [{x,y,kind,ttlMs}], // kind: 'slow' | 'ghost' | 'magnet' | 'double'
  obstacles: [{x,y}],
  active: {slow:ms, ghost:ms, magnet:ms, double:ms}, // remaining ms, 0 = off
  score, high, combo, comboMs, level,
  phase: 'title' | 'playing' | 'paused' | 'over',
  phaseMs,                      // ms since phase entered
  timeMs                        // monotonic game clock
}

## Gameplay rules game.js must keep
Tick-based logic with requestAnimationFrame accumulator, render interpolation, turn grace window (redo step if turn arrives in first 30% of tick), 2-key turn buffer, no reversal, P/Esc pause, tick starts 150ms, -15ms every 5 food, min 60ms (slow powerup multiplies tick). Walls kill (ghost passes through self + wraps walls). High score in localStorage key "lighthouse.neonsnake.highscore". Swipe on touch. Optional tilt steering (deviceorientation, setting key tilt).
