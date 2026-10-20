// Performance guard for the Attica track picker (owner report 2026-10-18: "athens map is super laggy").
// The sea, land, coast and road paint is expensive vector work that used to be redone on every pointer move and animation
// frame (a clip by the whole coastline, an image, ~25 strokes of up to 20k points). It now lives in cached bitmaps
// (src/map-select-render.js): a resting map does no work at all, and a pan or a flight blits cached tiles, painting new ones
// only a few milliseconds a frame. This test drives the real renderer against a recording canvas and the real map data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP_VIEW, MAP_ASSETS, TRACK_ROUTES } from '../src/attica-map-data.js';
import { coverScale, routeBounds, fitTracks, focusTrack, clampCamera, flight } from '../src/map-select-camera.js';
import { createMapRenderer, levelFor, TILE, MAX_LEVEL, CACHE_BYTES, MARGIN, BUDGET } from '../src/map-select-render.js';

const read = path => readFileSync(path, 'utf8');
const owner = 'Perf guard for the track map (owner 2026-10-18: "athens map is super laggy"): keep the base layer cached, see tools/map-select-perf.test.mjs.';

// ---- the real vector data, bucketed into cells exactly like parseVectors in src/map-select.js (boxes only; no Path2D in node)
function layersFromAsset() {
  const view = new DataView(readFileSync('assets/maps/attica-vectors.bin').buffer.slice(0)), q = 1 / MAP_ASSETS.quantize, CELL = 96, layers = {};
  let at = 6; const count = view.getUint16(4, true);
  for (let n = 0; n < count; n++) {
    const id = MAP_ASSETS.layers[view.getUint8(at)], lines = view.getUint32(at + 1, true); at += 5;
    const cells = new Map();
    for (let l = 0; l < lines; l++) {
      const pts = view.getUint16(at, true); at += 2; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let p = 0; p < pts; p++, at += 4) { const x = view.getUint16(at, true) * q, y = view.getUint16(at + 2, true) * q; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (id === 'land') continue;
      const key = `${Math.floor((x0 + x1) / 2 / CELL)},${Math.floor((y0 + y1) / 2 / CELL)}`;
      let cell = cells.get(key); if (!cell) cells.set(key, cell = { path: {}, box: [Infinity, Infinity, -Infinity, -Infinity] });
      cell.box = [Math.min(cell.box[0], x0), Math.min(cell.box[1], y0), Math.max(cell.box[2], x1), Math.max(cell.box[3], y1)];
    }
    layers[id] = id === 'land' ? {} : [...cells.values()];
  }
  return layers;
}

// ---- a recording canvas: every call is counted per surface; a fake clock advances 0.02 ms per call so time budgets are testable
function rig({ dpr = 1, width = 1280, height = 800 } = {}) {
  let now = 0; const tally = new Map(), ops = label => tally.get(label) || tally.set(label, {}).get(label);
  const context = label => new Proxy({ getImageData: () => ({}) }, {
    get(target, name) { if (name in target) return target[name]; return (...args) => { const o = ops(label); o[name] = (o[name] || 0) + 1; now += .02; target.last = { name, args }; if (name === 'drawImage') (target.draws ||= []).push(args); }; },
    set(target, name, value) { target[name] = value; return true; },
  });
  let n = 0; const surfaces = [];
  const makeCanvas = (w, h) => { const label = `tile${n++}`, g = context(label); const c = { width: w, height: h, getContext: () => g, label, g }; surfaces.push(c); return c; };
  const main = context('main');
  const image = (w, h) => ({ width: w, height: h });
  const data = { art: { sea: image(750, 342), land: image(3000, 1370), detail: MAP_ASSETS.detail.map(d => ({ ...d, img: image(400, 300) })) }, layers: layersFromAsset(), size: MAP_VIEW };
  const renderer = createMapRenderer({ ctx: main, data, makeCanvas, clock: () => now });
  const view = { width, height }; renderer.resize(view, dpr);
  const sum = (label, names) => Object.entries(ops(label)).filter(([k]) => !names || names.includes(k)).reduce((a, [, v]) => a + v, 0);
  const offscreen = names => [...tally].filter(([k]) => k !== 'main').reduce((a, [k]) => a + sum(k, names), 0);
  return { renderer, main, view, dpr, surfaces, ops, now: () => now, advance: ms => { now += ms; },
    mainOps: names => sum('main', names), offOps: offscreen, mainDraws: () => main.draws || [], reset: () => { for (const k of tally.keys()) tally.set(k, {}); main.draws = []; } };
}
const VECTOR = ['stroke', 'fill', 'clip'];
const cameraAt = (view, scale, wx, wy) => clampCamera({ scale, x: -(wx - MAP_VIEW.width / 2) * scale, y: -(wy - MAP_VIEW.height / 2) * scale }, view, MAP_VIEW);
const bounds = routeBounds(Object.values(TRACK_ROUTES));
const safe = view => ({ left: 0, top: 80, right: view.width * .7, bottom: view.height - 60 });

// One frame the way src/map-select.js runs it: paint, then background work.
const frame = (t, camera, now) => { t.renderer.paint(camera, now); return t.renderer.pump(now); };
// Run frames at a fixed camera until nothing is pending.
function settle(t, camera, start = 0, max = 400) { let now = start, frames = 0; do { now += 16.7; frames++; t.advance(16.7); } while (frame(t, camera, now) && frames < max); return { now, frames }; }

test('the pyramid level is a power-of-two zoom step, at most a modest upscale of its tiles', () => {
  for (const dpr of [1, 1.5, 2]) for (let scale = .8; scale <= 20; scale *= 1.07) {
    const j = levelFor(scale, dpr), shown = scale * dpr / 2 ** j;
    assert.ok(j >= 0 && j <= MAX_LEVEL, `level ${j}`);
    if (j > 0 && j < MAX_LEVEL) assert.ok(shown > .59 && shown <= 1.19 + 1e-9, `scale ${scale} dpr ${dpr}: tiles shown at ${shown.toFixed(2)}x`);
  }
  assert.equal(levelFor(20, 2), MAX_LEVEL, 'the closest zoom on a retina screen is still inside the pyramid');
});

test('a resting map does no work: the renderer reports idle and a pump issues no canvas calls', () => {
  const t = rig(), cam = fitTracks(t.view, MAP_VIEW, bounds, safe(t.view));
  t.renderer.prime(cam); const { now } = settle(t, cam);
  assert.equal(t.renderer.busy, false, `still busy after settling. ${owner}`);
  t.reset(); const before = t.now();
  for (let i = 0; i < 120; i++) assert.equal(t.renderer.pump(now + 16.7 * i), false);
  assert.equal(t.mainOps() + t.offOps(), 0, `a resting pump touched a canvas. ${owner}`);
  assert.equal(t.now(), before);
  // Repainting the settled camera (the route trace animates over it) is one blit of the exact view.
  t.renderer.paint(cam, now + 5000);
  assert.deepEqual([t.mainOps(VECTOR), t.mainOps(['drawImage'])], [0, 1], `a settled frame is a single drawImage. ${owner}`);
});

test('the settled view is blitted pixel for pixel (no resampling, no offset)', () => {
  for (const dpr of [1, 2]) {
    const t = rig({ dpr }), cam = focusTrack(t.view, MAP_VIEW, TRACK_ROUTES.riviera, safe(t.view));
    t.renderer.prime(cam); settle(t, cam); t.reset(); t.renderer.paint(cam, 1e6);
    const [src, dx, dy, dw, dh] = t.mainDraws().at(-1), m = Math.round(MARGIN * dpr);
    assert.deepEqual([dx, dy], [-m, -m], `dpr ${dpr}: the snapshot's margin sits off canvas, the view is 1:1`);
    assert.deepEqual([dw, dh], [src.width, src.height]);
    assert.deepEqual([src.width, src.height], [t.view.width * dpr + 2 * m, t.view.height * dpr + 2 * m]);
  }
});

test('panning blits cached bitmaps: no vector work on the visible canvas, little painting anywhere', () => {
  const t = rig(), start = focusTrack(t.view, MAP_VIEW, TRACK_ROUTES.riviera, safe(t.view));
  t.renderer.prime(start); let { now } = settle(t, start); t.reset();
  const perFrame = [];
  for (let i = 0; i < 120; i++) {
    const cam = clampCamera({ ...start, x: start.x - i * 9, y: start.y + Math.sin(i / 12) * 40 }, t.view, MAP_VIEW);
    t.reset(); now += 16.7; t.advance(16.7); frame(t, cam, now);
    perFrame.push({ main: t.mainOps(), vector: t.mainOps(VECTOR), off: t.offOps() });
  }
  const worst = key => Math.max(...perFrame.map(f => f[key]));
  assert.equal(worst('vector'), 0, `a pan frame stroked or clipped on the visible canvas. ${owner}`);
  assert.ok(worst('main') <= 150, `pan frame used ${worst('main')} canvas calls (budget 150, was ~50 vector calls plus a whole-coast clip per move). ${owner}`);
  // Tiles are painted inside the pump's time budget: at most a handful per frame, never the whole view at once.
  assert.ok(worst('off') <= 1200, `painted ${worst('off')} offscreen calls in one frame. ${owner}`);
});

test('a flight blits cached bitmaps and paints its tiles ahead, inside a per-frame budget', () => {
  const t = rig(), from = fitTracks(t.view, MAP_VIEW, bounds, safe(t.view)), to = focusTrack(t.view, MAP_VIEW, TRACK_ROUTES.penteli, safe(t.view));
  t.renderer.prime(from); let { now } = settle(t, from);
  const path = flight(from, to, t.view, MAP_VIEW), frames = Math.ceil(path.duration / 16.7);
  t.renderer.prepare([.2, .4, .6, .8].map(e => path.at(e)).concat(to), to);
  const perFrame = [];
  for (let i = 1; i <= frames; i++) {
    const cam = i === frames ? to : path.at(Math.min(1, (i * 16.7) / path.duration)); t.reset(); now += 16.7;
    const clock0 = t.now(); frame(t, cam, now);
    perFrame.push({ main: t.mainOps(), vector: t.mainOps(VECTOR), off: t.offOps(), work: t.now() - clock0 });
  }
  const worst = key => Math.max(...perFrame.map(f => f[key]));
  assert.equal(worst('vector'), 0, `a flight frame stroked or clipped on the visible canvas. ${owner}`);
  assert.ok(worst('main') <= 150, `flight frame used ${worst('main')} canvas calls (budget 150). ${owner}`);
  // BUDGET ms of background painting per frame, plus at most the one tile that crossed the line.
  assert.ok(worst('work') <= BUDGET + 2, `a frame spent ${worst('work').toFixed(1)} ms of work (budget ${BUDGET} ms + one tile). ${owner}`);
  // Arriving: the exact view of the destination was built during the flight, so the last frame is not a repaint.
  const end = settle(t, to, now); t.reset(); t.renderer.paint(to, end.now + 1000);
  assert.deepEqual([t.mainOps(VECTOR), t.mainOps(['drawImage'])], [0, 1], `the destination settles on its prebuilt exact view. ${owner}`);
  assert.equal(t.renderer.busy, false);
});

test('the tile cache stays inside its memory budget however far the camera wanders, at every zoom and density', () => {
  for (const dpr of [1, 2]) {
    const t = rig({ dpr, width: 1440, height: 900 });
    let now = 0;
    for (let i = 0; i < 400; i++) {
      const scale = coverScale(t.view, MAP_VIEW) * Math.pow(20 / coverScale(t.view, MAP_VIEW), (Math.sin(i / 9) + 1) / 2);
      const cam = cameraAt(t.view, scale, 200 + (i * 37) % 1100, 100 + (i * 53) % 480);
      now += 16.7; t.advance(16.7); frame(t, cam, now);
    }
    const { bytes, tiles } = t.renderer.stats();
    assert.ok(bytes <= CACHE_BYTES + 2 * (TILE + 4) ** 2 * 4 * 8, `dpr ${dpr}: ${tiles} tiles hold ${(bytes / 2 ** 20).toFixed(0)} MB (cache budget ${CACHE_BYTES >> 20} MB)`);
  }
});

test('leaving the screen and changing display density drop what no longer fits', () => {
  const t = rig(), cam = fitTracks(t.view, MAP_VIEW, bounds, safe(t.view));
  t.renderer.prime(cam); settle(t, cam);
  assert.ok(t.renderer.stats().tiles > 0 && t.renderer.stats().snapshot);
  t.renderer.resize(t.view, 2); assert.equal(t.renderer.stats().tiles, 0, 'tiles painted at 1x are not reused at 2x');
  t.renderer.dispose(); assert.deepEqual([t.renderer.stats().tiles, t.renderer.stats().snapshot], [0, false]);
});

test('src/map-select.js draws on demand: no polling, no drawing from gesture handlers, off-screen means no frames', () => {
  const js = read('src/map-select.js'), render = read('src/map-select-render.js');
  assert.doesNotMatch(js + render, /setInterval|setTimeout\(/, `no timers: the map is driven by animation frames only while it has work. ${owner}`);
  assert.doesNotMatch(js + render, /shadowBlur|ctx\.filter\s*=/, `no per-frame blur or filter on the canvas. ${owner}`);
  assert.doesNotMatch(js, /ctx\.(clip|drawImage)\(/, `the base layer (images, clip, roads) is painted by map-select-render.js only. ${owner}`);
  // The frame loop re-arms only while the camera, the route trace, a released drag's glide or background painting has work.
  assert.match(js, /if \(motion \|\| reveal \|\| glide\.active \|\| base\?\.busy\) frame = requestAnimationFrame\(run\);/, owner);
  assert.equal([...js.matchAll(/requestAnimationFrame\(run\)/g)].length, 2, 'only run() and start() schedule the frame loop');
  // Pointer gestures only mark the frame dirty; the painting happens once per animation frame, however fast the mouse reports.
  const gesture = js.slice(js.indexOf("map.addEventListener('pointermove'"), js.indexOf('  const up ='));
  assert.doesNotMatch(gesture, /\bsync\(|\bdraw\(|\.paint\(/, `pointermove must not paint. ${owner}`);
  assert.match(gesture, /want\(\)/, owner);
  // A trackpad scroll pans by marking the frame dirty too (src/map-wheel.js, owner 2026-10-20).
  const wheel = js.slice(js.indexOf("map.addEventListener('wheel'"), js.indexOf("map.addEventListener('pointerdown'"));
  assert.doesNotMatch(wheel, /\bsync\(|\bdraw\(|\.paint\(/, `the wheel handler must not paint. ${owner}`); assert.match(wheel, /want\(\)/, owner);
  // Hidden tab, another screen or a closed menu: cancel the frame and do nothing until visible again.
  assert.match(js, /document\.addEventListener\('visibilitychange'/, owner);
  assert.match(js, /new IntersectionObserver\(/, owner);
  assert.match(js, /if \(!view \|\| !onScreen \|\| document\.hidden\) return;/, owner);
  assert.match(js, /seen\.disconnect\(\)/, 'the observer is released with the screen');
  // The card keeps its glass at rest (shared kit) and swaps the live blur for a tint only while the camera moves.
  assert.match(read('src/ui/ui.css'), /\.panel--float\.panel--moving \{[^}]*backdrop-filter: none/, owner);
  assert.match(js, /card\.classList\.toggle\('panel--moving'/, owner);
  assert.match(read('src/ui/ui.css'), /\.panel--float \{[^}]*backdrop-filter: blur\(/, owner);
});
