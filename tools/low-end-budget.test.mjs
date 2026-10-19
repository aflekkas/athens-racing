// A weak laptop: the performance classes budget the CPU (not just pixels), the first-run check measures the CPU, a frame
// governor steps the class down when frames keep missing the budget, a long frame no longer multiplies the per-frame
// work, and the per-frame DOM / canvas work is cached. High keeps everything it had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERFORMANCE, PERF_CLASSES, RENDER, resolveGraphics, cpuProbe, cpuCap, CPU_PROBE_LIMITS } from '../src/graphics.js';
import { PerfGovernor } from '../src/perf-governor.js';
import { Hud } from '../src/hud.js';
import { Input } from '../src/input.js';

const LOCK = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('classes only ever get cheaper towards potato, and high keeps the full budget', () => {
  const order = ['potato', 'low', 'med', 'high'];
  assert.deepEqual(PERF_CLASSES, order);
  for (const key of ['pixelRatio', 'drawDistance', 'crowd', 'detail', 'traffic', 'walkers', 'trafficHz']) for (let i = 1; i < order.length; i++)
    assert.ok(PERFORMANCE[order[i]][key] >= PERFORMANCE[order[i - 1]][key], `${key}: ${order[i]} >= ${order[i - 1]}`);
  for (const key of ['tacho', 'map', 'mapBig']) for (let i = 1; i < order.length; i++) assert.ok(PERFORMANCE[order[i]].hud[key] >= PERFORMANCE[order[i - 1]].hud[key], `hud ${key}`);
  const high = PERFORMANCE.high;
  assert.equal(high.traffic, 1, 'high: full traffic'); assert.equal(high.walkers, 1); assert.equal(high.trafficHz, 60); assert.deepEqual({ ...high.hud }, { tacho: 30, map: 15, mapBig: 30 }, 'high: the HUD refresh it always had');
  assert.equal(PERFORMANCE.med.hud.tacho, 30);
  assert.ok(PERFORMANCE.potato.traffic < PERFORMANCE.low.traffic && PERFORMANCE.potato.traffic <= 0.5, 'potato halves the traffic');
  assert.ok(Object.isFrozen(PERFORMANCE) && Object.isFrozen(PERFORMANCE.high.hud));
});

test('the CPU budget never touches the look: every class resolves to the one RENDER config', () => {
  for (const perfClass of PERF_CLASSES) {
    const g = resolveGraphics({ perfClass }, { deviceRatio: 2 });
    assert.equal(g.R, RENDER, `look is fixed in ${perfClass}. ${LOCK}`);
    assert.equal(g.traffic, PERFORMANCE[perfClass].traffic); assert.equal(g.walkers, PERFORMANCE[perfClass].walkers); assert.equal(g.hud, PERFORMANCE[perfClass].hud); assert.equal(g.trafficHz, PERFORMANCE[perfClass].trafficHz);
  }
  const main = src('src/main.js');
  assert.match(main, /traffic\.density = \(s\) => base\(s\) \* \(G\.trafficMul \?\? 1\) \* \(multiplayer\.active \? 1 : G\.trafficTier \?\? 1\)/, 'offline only: online traffic is the server\'s');
  assert.match(main, /if \(!multiplayer\.active\) \{ G\.trafficAcc/, 'the traffic AI rate applies offline only');
  assert.equal(RENDER.shadow, null); assert.equal(RENDER.ao, 0);
});

test('first-run check measures the CPU as well as the GPU', async () => {
  const t = performance.now(), probe = cpuProbe(30); const took = performance.now() - t;
  assert.ok(probe.msPerMillion > 0 && Number.isFinite(probe.msPerMillion)); assert.ok(took < 250, `a probe is short (${took.toFixed(0)} ms)`);
  assert.equal(cpuCap(CPU_PROBE_LIMITS.med - 1), 'high'); assert.equal(cpuCap(CPU_PROBE_LIMITS.med + 1), 'med'); assert.equal(cpuCap(CPU_PROBE_LIMITS.low + 1), 'low'); assert.equal(cpuCap(CPU_PROBE_LIMITS.potato + 1), 'potato');
  const graphics = src('src/graphics.js');
  assert.match(graphics, /cpu = Math\.min\(cpu, cpuProbe\(40\)\.msPerMillion\)/, 'detectPerformance runs the best-of-three CPU probe');
  assert.match(graphics, /perfClass = minClass\(perfClass, cap\);[\s\S]*cores <= 2/, 'the CPU class can only lower the class');
  assert.match(src('src/ui/graphics-onboarding.js'), /setItem\(PERF_CEILING_KEY/, 'the first check records the ceiling the governor may climb back to');
  assert.match(src('src/ui/graphics-onboarding.js'), /skipPerformanceProbe/, 'automation still skips the probes');
});

test('frame governor: steps down when late and CPU-bound, ignores pixel-bound lateness and hitches, climbs back only to its ceiling', () => {
  const run = (g, frames, { wall, cpu = wall * 0.8, budget = 1000 / 60, current, pixelBound = false }) => { let out = null, at = current; for (let i = 0; i < frames && !out; i++) { out = g.sample(wall, cpu, budget, at, { pixelBound }); } return { out, spent: 0 }; };
  // hot: 28 ms frames against a 16.7 ms budget
  const g = new PerfGovernor({ cooldownS: 5 });
  let current = 'high', steps = [];
  for (let i = 0; i < 3000 && current !== 'potato'; i++) { const out = g.sample(28, 22, 1000 / 60, current); if (out) { steps.push(out); current = out; } }
  assert.deepEqual(steps, ['med', 'low', 'potato'], 'one class at a time, never below potato');
  for (let i = 0; i < 3000; i++) assert.equal(g.sample(28, 22, 1000 / 60, 'potato'), null, 'potato is the floor');
  // lateness that a smaller picture can fix is left to dynamic resolution
  const px = new PerfGovernor({ cooldownS: 0 }); for (let i = 0; i < 2000; i++) assert.equal(px.sample(30, 25, 1000 / 60, 'high', { pixelBound: true }), null);
  // hitches / hidden tabs are not steady state; a capped game (30 fps) is judged against its own budget
  const hitch = new PerfGovernor({ cooldownS: 0 }); for (let i = 0; i < 2000; i++) assert.equal(hitch.sample(400, 400, 1000 / 60, 'high'), null);
  const capped = new PerfGovernor({ cooldownS: 0 }); for (let i = 0; i < 2000; i++) assert.equal(capped.sample(33.4, 20, 1000 / 30, 'med'), null, '30 fps on a 30 fps cap is on budget');
  // quiet for a minute: climbs back, but never above the ceiling and never again onto a class that just failed
  const up = new PerfGovernor({ cooldownS: 0, ceiling: 'med' }); let cls = 'low', climbed = [];
  for (let i = 0; i < 20000; i++) { const out = up.sample(16.7, 5, 1000 / 60, cls); if (out) { climbed.push(out); cls = out; } }
  assert.deepEqual(climbed, ['med'], 'stops at the ceiling');
  const flaky = new PerfGovernor({ cooldownS: 0, ceiling: 'high' }); cls = 'low'; const log = [];
  for (let i = 0; i < 30000; i++) { const wall = cls === 'med' ? 28 : 16.7, out = flaky.sample(wall, cls === 'med' ? 20 : 5, 1000 / 60, cls); if (out) { log.push(out); cls = out; } }
  assert.deepEqual(log, ['med', 'low'], 'med failed once: the governor does not bounce between low and med');
  assert.equal(flaky.ceiling, 'low');
});

test('a long frame is simulated in slices but the HUD, audio, camera and picture update once', () => {
  const main = src('src/main.js');
  assert.match(main, /const MAX_SLICES = 10/);
  assert.match(main, /const slices = Math\.min\(MAX_SLICES, Math\.max\(1, Math\.ceil\(dt \/ \(1 \/ 60\) - 1e-6\)\)\)/, 'a 33.4 ms frame is 2 slices, not 3');
  assert.match(main, /const last = i === reps - 1 && j === slices - 1; step\(dt \/ slices, last, last, dt\)/, 'only the last slice draws and updates visuals, with the frame time');
  assert.match(main, /function step\(dt, draw = true, visual = true, frameDt = dt\)/, 'test hooks (__sim.step) keep the full step');
  const body = main.slice(main.indexOf('function step('));
  const gate = body.indexOf('if (!visual) return;');
  assert.ok(gate > 0 && gate < body.indexOf('syncCar(player'), 'slices before the last stop before syncCar');
  for (const heavy of ['hud.update(st)', 'updateAudio(dt)', 'updateCamera(dt)', 'fx.update(', 'drawMinimap', 'render();']) assert.ok(body.indexOf(heavy) > gate, `${heavy} runs only in the visual slice`);
  for (const sim of ['pv.update(dt, pin)', 'traffic.update(', 'people.update(dt', 'police.update(dt']) assert.ok(body.indexOf(sim) < gate, `${sim} runs in every slice`);
});

test('analogue cluster: static layer built once, one stroke per lit colour, nothing drawn when nothing changed', () => {
  const calls = [], counts = {};
  const ctxFor = (name) => new Proxy({}, { get: (t, p) => p in t ? t[p] : (...args) => { counts[name + '.' + String(p)] = (counts[name + '.' + String(p)] || 0) + 1; calls.push(name + '.' + String(p)); return p === 'createRadialGradient' ? { addColorStop() {} } : undefined; }, set: (t, p, v) => { t[p] = v; return true; } });
  const layers = [];
  globalThis.document = { createElement: () => { const c = { width: 0, height: 0, ctx: ctxFor('base' + layers.length) }; c.getContext = () => c.ctx; layers.push(c); return c; }, fonts: { check: () => true } };
  try {
    const hud = Object.create(Hud.prototype); hud.tacho = { width: 360, height: 300 }; hud.tctx = ctxFor('main');
    const st = { rpm: 3500, redline: 6500, kmh: 88.2, unit: 'KM/H', gearLabel: '3', damageLabel: '', nitrous: false, shiftFlash: 0, manual: false, esc: false, tc: false, abs: true, aidsOff: false };
    hud.drawTacho(st);
    assert.equal(counts['main.clearRect'], 1); assert.equal(layers.length, 1, 'the base layer was built'); const baseStrokes = counts['base0.stroke'];
    assert.equal(baseStrokes, 46, 'the base draws the 46 dim segments once');
    assert.ok(counts['main.stroke'] <= 3, `the lit segments are at most one stroke per colour (${counts['main.stroke']})`);
    hud.drawTacho({ ...st, kmh: 88.4 }); assert.equal(counts['main.clearRect'], 1, 'same rounded speed, same lit segments: nothing redrawn');
    hud.drawTacho({ ...st, kmh: 89 }); assert.equal(counts['main.clearRect'], 2, 'a visible change redraws');
    assert.equal(counts['base0.stroke'], baseStrokes, 'without rebuilding the base'); assert.equal(layers.length, 1);
    hud.drawTacho({ ...st, kmh: 89, redline: 8000 }); assert.equal(layers.length, 1, 'the same layer element is reused'); assert.ok(counts['base0.stroke'] > baseStrokes, 'a new redline rebuilds it');
    for (let i = 0; i < 60; i++) hud.drawTacho({ ...st, rpm: 800 + i * 90, kmh: 30 + i });
    assert.ok((counts['main.stroke'] || 0) < 61 * 4, 'a sweep through the revs costs a few strokes a frame, not 46');
  } finally { delete globalThis.document; }
});

test('HUD redraw rates are clocks, from the performance class', () => {
  const hud = Object.create(Hud.prototype); hud.rates = { tacho: 30, map: 15, mapBig: 30 };
  hud.setRates({ tacho: 20, map: 8, mapBig: 15 }); assert.deepEqual(hud.rates, { tacho: 20, map: 8, mapBig: 15 });
  hud.setRates(); assert.deepEqual(hud.rates, { tacho: 30, map: 15, mapBig: 30 });
  const hudSrc = src('src/hud.js');
  assert.match(hudSrc, /clock - this\._tachoAt >= 1000 \/ rates\.tacho/); assert.doesNotMatch(hudSrc, /this\.frame & 1\) === 0\) this\.drawTacho/, 'no frame divisor');
});

test('per-frame DOM probes are cached: setCarSpec, notifications', () => {
  const calls = { aids: 0, nitrous: 0 }, fake = { setAidsEnabled() { calls.aids++; }, setNitrousEnabled() { calls.nitrous++; }, touchUI: null };
  for (let i = 0; i < 300; i++) Input.prototype.setCarSpec.call(fake, { nitrous: true });
  assert.ok(calls.nitrous <= 6, `300 frames, ${calls.nitrous} DOM syncs (one per second + changes)`); assert.ok(calls.nitrous >= 1);
  const before = calls.nitrous; Input.prototype.setCarSpec.call(fake, { nitrous: false }); assert.equal(calls.nitrous, before + 1, 'a car change syncs at once');
  const notifications = src('src/ui/notifications.js'); assert.match(notifications, /if\(!this\.dirty&&time<\(this\.nextProbe\|\|0\)\)return;this\.nextProbe=time\+50/);
});
