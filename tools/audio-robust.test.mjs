// Audio that survives a weak machine: voice cap, ramped (never stepped) parameter changes in hot paths, scheduling on the
// audio clock instead of the frame clock, smooth loop seams, a context watchdog, and a granular engine bed that is built
// in short slices instead of one multi-second freeze.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceBudget, seamlessLoop, seamlessBuffer, ContextWatchdog, audioLatencyHint, useKRate, playoutUnderruns } from '../src/audio/robust.js';
import { createMockContext } from './audio-mock-context.mjs';

console.warn = () => {};
globalThis.fetch = async () => { throw new Error('offline'); }; // no recordings in Node: the procedural engine plays
const { Audio } = await import('../src/audio.js');
const { CARS } = await import('../src/cars.js');
const { engineGrainBedAsync, GranularEngineLoop } = await import('../src/engine-recordings.js');

const telemetry = (dt, over = {}) => ({ dt, speed: 28, rpm: 4200, redline: 7000, load: 0.6, throttle: 0.6, surfaces: [], nominalLoad: 3500, skid: 0.3, open: false, cockpit: true,
  sea: 0.7, seaPan: 0.5, city: 0.2, cicadas: 1, gear: 3, gearRatio: 3, wb: 2.5, bump: 0, boost: 0.4, rivals: [], traffic: [], mapId: 'riviera',
  wheels: Array.from({ length: 4 }, () => ({ sx: 0.1, sy: 0.4, Fz: 3500, vw: 25, vgx: 25 })), ...over });
function liveAudio({ fps = 60, seconds = 0, over = {}, setup } = {}) {
  const ctx = createMockContext(), audio = new Audio();
  audio.start({ context: ctx, recordings: false });
  audio.setEngine(CARS[0]);
  setup?.(audio, ctx);
  ctx.currentTime += 1 / fps; audio.update(telemetry(1 / fps, over)); // the first update builds the weather / ambience graph
  ctx.log.armed = true; ctx.log.armedSeq = ctx.log.seq; ctx.log.direct.length = 0; ctx.log.scheduled.length = 0; const created0 = { ...ctx.log.created };
  for (let i = 0; i < Math.round(seconds * fps); i++) { ctx.currentTime += 1 / fps; audio.update(telemetry(1 / fps, typeof over === 'function' ? over(i / fps) : over)); }
  return { ctx, audio, created0 };
}

test('voice budget: caps simultaneous one-shots, frees finished ones, keeps a reserve for crashes', () => {
  const b = new VoiceBudget(4, 2);
  for (let i = 0; i < 4; i++) assert.equal(b.take(0, 1), true);
  assert.equal(b.take(0, 1), false, 'fifth ordinary voice refused');
  assert.equal(b.take(0, 1, 1), true, 'priority voices use the reserve');
  assert.equal(b.take(0, 1, 1), true); assert.equal(b.take(0, 1, 1), false, 'reserve is finite');
  assert.equal(b.dropped, 2);
  assert.equal(b.take(1.01, 2), true, 'everything that ended frees its slot'); assert.equal(b.active, 1);
});

test('audio.noise / tone / sample / voice never exceed the voice cap in one frame', () => {
  const { ctx, audio } = liveAudio({ seconds: 0.1 });
  audio.S = { 'crash-heavy': { buffer: ctx.createBuffer(1, 48000, 48000) } };
  const before = ctx.log.created.BufferSource + ctx.log.created.Oscillator;
  for (let i = 0; i < 200; i++) { audio.noise({ dur: 0.5 }); audio.tone({ dur: 0.5 }); audio.sample('crash-heavy', { priority: 0 }); audio.voice([{ v: 'a', dur: 0.2, f0: 200 }]); }
  const added = ctx.log.created.BufferSource + ctx.log.created.Oscillator - before;
  assert.ok(audio.voices.dropped > 500, 'the pile-up was refused, not played');
  assert.ok(audio.voices.active <= audio.voices.limit, `active ${audio.voices.active} <= limit ${audio.voices.limit}`);
  assert.ok(added <= audio.voices.limit * 6, `a bounded number of nodes (${added}) reached the graph`);
  audio.sample('crash-heavy', { priority: 1 }); assert.equal(audio.voices.active <= audio.voices.limit + audio.voices.reserve, true);
  assert.equal(audio.sample('crash-heavy', { priority: 0 }), true, 'a refused sample is not re-synthesised by the caller');
});

test('hot paths ramp every parameter: update() never assigns AudioParam.value directly', () => {
  for (const fps of [60, 30, 15]) {
    const { ctx } = liveAudio({ fps, seconds: 2, over: t => ({ rpm: 1500 + 4500 * Math.abs(Math.sin(t * 2)), load: Math.sin(t * 3), skid: t % 1 > 0.5 ? 1.2 : 0.1, speed: 10 + t * 8, overrun: t % 1 > 0.7 }) });
    // a one-shot voice initialises its own fresh nodes before connecting them; a node that already plays is only ever ramped
    assert.deepEqual(ctx.log.direct.filter(d => d.node.born <= ctx.log.armedSeq).map(d => `${d.node.kind}.${d.param}`), [], `no direct writes to live nodes at ${fps} fps`);
    assert.ok(ctx.log.scheduled.every(e => e.kind !== 'set' || e.args[1] >= e.at - 1e-9), 'nothing is scheduled in the past of the audio clock');
  }
});

test('engine and tyre scheduling follows the audio clock, not the frame rate', () => {
  const run = fps => liveAudio({ fps, seconds: 3, over: { rpm: 6400, load: -0.4, overrun: true, damage: { rear: 1 }, bump: 0, skid: 0.2 } });
  const oneShots = r => (r.ctx.log.created.BufferSource - r.created0.BufferSource) + (r.ctx.log.created.Oscillator - r.created0.Oscillator);
  const rates = [60, 30, 15].map(fps => oneShots(run(fps)));
  assert.ok(Math.min(...rates) > 0, 'the overrun produced pops and rattles');
  assert.ok(Math.max(...rates) <= Math.min(...rates) * 1.6 + 6, `one-shot density does not scale with fps: ${rates}`);
  // the AudioParam event rate is bounded per frame (a frame at 15 fps schedules no more than one at 60)
  const perSecond = fps => liveAudio({ fps, seconds: 2 }).ctx.log.scheduled.length / 2;
  assert.ok(perSecond(15) <= perSecond(60) * 0.5, 'parameter events per audio second shrink with the frame rate: no catch-up bursts');
});

test('a suspended context is resumed by the watchdog, at most once a second', () => {
  const { ctx, audio } = liveAudio({ seconds: 0.1 });
  ctx.state = 'suspended'; ctx.resumed = 0; ctx.resume = function () { this.resumed++; return Promise.resolve(); };
  const realNow = performance.now.bind(performance); let wall = realNow() + 5000;
  performance.now = () => wall;
  try {
    for (let i = 0; i < 10; i++) { wall += 50; audio.update(telemetry(1 / 60)); }
    assert.equal(ctx.resumed, 1, 'resume requested once in 0.5 s');
    wall += 1000; audio.update(telemetry(1 / 60)); assert.equal(ctx.resumed, 2, 'and again after a second');
  } finally { performance.now = realNow; }
  const w = new ContextWatchdog(); assert.equal(w.check({ state: 'running' }, 10), false); assert.equal(w.check({ state: 'closed' }, 20), false);
  assert.equal(w.check({ state: 'interrupted', resume: () => Promise.reject(new Error('gesture')) }, 30), true);
});

test('AudioContext is created with the weak-machine latency hint, falling back when the browser rejects it', () => {
  assert.equal(audioLatencyHint('potato', 16), 'playback'); assert.equal(audioLatencyHint('low', 16), 'playback'); assert.equal(audioLatencyHint('med', 16), 'playback');
  assert.equal(audioLatencyHint('auto', 4), 'playback'); assert.equal(audioLatencyHint('auto', 8), 'balanced'); assert.equal(audioLatencyHint('high', 4), 'balanced');
  const seen = [];
  globalThis.window = { AudioContext: class { constructor(options) { seen.push(options); return createMockContext(); } } };
  try {
    const a = new Audio(); a.latencyHint = 'playback'; a.start({ recordings: false });
    assert.deepEqual(seen[0], { latencyHint: 'playback' });
    globalThis.window = { AudioContext: class { constructor(options) { if (options) throw new TypeError('bad hint'); return createMockContext(); } } };
    const b = new Audio(); b.latencyHint = 'nonsense'; b.start({ recordings: false }); assert.ok(b.ctx, 'falls back to a default context');
  } finally { delete globalThis.window; }
});

test('k-rate automation is requested for filters and panners, never for envelope gains', () => {
  const ctx = createMockContext(), set = [];
  const wrap = name => { const create = ctx[name]; ctx[name] = () => { const n = create(); return new Proxy(n, { get: (t, p) => { const v = t[p]; if (v && typeof v === 'object' && 'setTargetAtTime' in v) return new Proxy(v, { set: (o, k, x) => { if (k === 'automationRate') set.push(`${name}:${p}:${x}`); o[k] = x; return true; } }); return v; } }); }; };
  for (const name of ['createBiquadFilter', 'createStereoPanner', 'createOscillator', 'createGain']) wrap(name);
  useKRate(ctx);
  ctx.createBiquadFilter(); ctx.createStereoPanner(); ctx.createOscillator(); ctx.createGain();
  assert.deepEqual(set.sort(), ['createBiquadFilter:Q:k-rate', 'createBiquadFilter:detune:k-rate', 'createBiquadFilter:frequency:k-rate', 'createBiquadFilter:gain:k-rate',
    'createOscillator:detune:k-rate', 'createOscillator:frequency:k-rate', 'createStereoPanner:pan:k-rate']);
});

test('loop seams: a clicking loop is crossfaded, a smooth one is left alone, every channel gets the same blend', () => {
  const n = 40000, sr = 48000, make = (jump) => { const d = new Float32Array(n + 4000); for (let i = 0; i < d.length; i++) d[i] = 0.2 * Math.sin(i * 2 * Math.PI / 100) + (i < n ? jump * i / n : 0); return d; };
  const seam = (d, start, end) => Math.abs(d[start] - d[end - 1]);
  const smooth = make(0); assert.equal(seamlessLoop(smooth, 0, n), null, 'a sine that closes on itself is not touched');
  const clicky = make(0.5); const before = seam(clicky, 0, n), fixed = seamlessLoop(clicky, 0, n, { fade: 2048 });
  assert.ok(before > 0.4); assert.ok(fixed && fixed.start === 2048 && fixed.end === n);
  const step = (() => { let s = 0; for (let i = fixed.start + 1; i < n; i++) s += (clicky[i] - clicky[i - 1]) ** 2; return Math.sqrt(s / (n - fixed.start)); })();
  assert.ok(seam(clicky, fixed.start, n) <= 3 * step, `the seam now steps like the rest of the loop (${seam(clicky, fixed.start, n).toFixed(4)} vs ${step.toFixed(4)})`);
  const buf = createMockContext({ sampleRate: sr }).createBuffer(2, n + 4000, sr); buf.getChannelData(0).set(make(0.5)); buf.getChannelData(1).set(make(0.5));
  const l0 = buf.getChannelData(1)[n - 1]; assert.ok(seamlessBuffer(buf, 0, n, { fade: 2048 })); assert.notEqual(buf.getChannelData(1)[n - 1], l0, 'the second channel was blended too');
});

test('granular engine bed: built in short slices, identical to the one-shot build', async () => {
  const sr = 24000, input = new Float32Array(Math.round(sr * 0.6)); for (let i = 0; i < input.length; i++) input[i] = 0.4 * Math.sin(i * 2 * Math.PI * 100 / sr) + 0.1 * Math.sin(i * 0.37 * i / 4000);
  const ctx = createMockContext({ sampleRate: sr }), mk = () => ({ length: input.length, sampleRate: sr, duration: input.length / sr, getChannelData: () => input });
  let ticks = 0; const timer = setInterval(() => ticks++, 0);
  const a = mk(), asyncBed = await engineGrainBedAsync(ctx, a, 3000, 4, 1); clearInterval(timer);
  assert.ok(ticks >= 5, `the event loop kept running while the bed was built (${ticks} turns)`);
  const b = mk(); const sync = new GranularEngineLoop(ctx, b, { }, 3000, 4);
  assert.equal(sync.source.buffer.length, asyncBed.length); assert.equal(sync.source.buffer.getChannelData(0).every((v, i) => Object.is(v, asyncBed.getChannelData(0)[i])), true);
  assert.equal(await engineGrainBedAsync(ctx, a, 3000, 4), asyncBed, 'cached per take');
});

test('playout statistics are optional', () => { assert.equal(playoutUnderruns({}), null); assert.equal(playoutUnderruns({ playoutStats: { underrunEvents: 3 } }), 3); });
