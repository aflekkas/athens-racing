import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FrameLimiter, dynamicBudgetMs } from '../src/frame-pacing.js';

const memory = (seed = {}) => ({ values: new Map(Object.entries(seed)), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } });
let serial = 0;
async function preferences(storage) {
  globalThis.localStorage = storage;
  return import('../src/settings.js?frame-cap=' + serial++);
}
/** drive the limiter with a fake display: `seconds` of vsync callbacks at `hz` (optionally with timestamp jitter) and count the frames let through */
function run(cap, hz, { seconds = 10, jitter = 0, start = 1234.5 } = {}) {
  const limiter = new FrameLimiter(), period = 1000 / hz, times = [];
  let rng = 12345, ticks = 0;
  for (let i = 0; i < hz * seconds; i++) {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    const now = start + i * period + (jitter ? ((rng / 2 ** 32) - .5) * 2 * jitter : 0);
    ticks++;
    if (limiter.allow(now, cap)) times.push(now);
  }
  return { ticks, frames: times.length, fps: times.length / seconds, times };
}

test('no limit lets every requestAnimationFrame callback through at any refresh rate', () => {
  for (const hz of [24, 30, 60, 75, 90, 120, 144, 165, 240]) {
    const r = run(0, hz);
    assert.equal(r.frames, r.ticks, `${hz} Hz display: no frame skipped`);
  }
  // jitter, hitches, a clock that runs backwards and a long pause never skip a frame either
  const limiter = new FrameLimiter();
  for (const now of [0, 0.1, 8.3, 8.3, 5, 1e9, 3, 1e9 + 1, 1e9 + 1.2]) assert.equal(limiter.allow(now, 0), true);
  for (const cap of [undefined, null, NaN, -1]) assert.equal(new FrameLimiter().allow(1, cap), true, `cap ${cap} is "no limit"`);
});

test('switching to no limit forgets the old schedule, switching back starts a fresh one', () => {
  const limiter = new FrameLimiter(), step = 1000 / 120;
  let t = 0, passed = 0;
  for (let i = 0; i < 120; i++) if (limiter.allow(t += step, 30)) passed++;
  assert.ok(passed === 30 || passed === 31, 'the first frame always runs');
  for (let i = 0; i < 120; i++) assert.equal(limiter.allow(t += step, 0), true);
  passed = 0;
  for (let i = 0; i < 120; i++) if (limiter.allow(t += step, 60)) passed++;
  assert.equal(passed, 60);
});

test('each limit holds its rate on 60, 120, 144 and 240 Hz displays', () => {
  for (const hz of [60, 120, 144, 165, 240]) {
    for (const cap of [30, 60, 120]) {
      const r = run(cap, hz), expected = Math.min(cap, hz);
      assert.ok(Math.abs(r.fps - expected) <= expected * 0.02, `${cap} fps limit on ${hz} Hz gave ${r.fps} fps (want ~${expected})`);
      assert.ok(r.fps <= expected * 1.02, `${cap} fps limit on ${hz} Hz never exceeds the limit`);
    }
  }
  // a limit below the display rate is enforced exactly on matching multiples, the "60 on a 120 Hz screen" case
  assert.equal(run(60, 120).frames, 600);
  assert.equal(run(30, 120).frames, 300);
  assert.equal(run(30, 60).frames, 300);
  assert.equal(run(120, 120).frames, 1200);
});

test('vsync jitter does not make a limit that matches the display drop frames', () => {
  const r = run(60, 60, { jitter: 1.5 });
  assert.equal(r.frames, r.ticks, '60 fps limit on a 60 Hz display with ±1.5 ms timestamps still draws every frame');
  const r120 = run(120, 120, { jitter: .8 });
  assert.equal(r120.frames, r120.ticks);
  const r30 = run(30, 120, { jitter: 1.5 });
  assert.ok(Math.abs(r30.fps - 30) <= 1, `30 on 120 Hz with jitter: ${r30.fps}`);
});

test('frames passed by a limit are spaced evenly enough, and a hitch does not cause a burst', () => {
  const r = run(60, 120);
  for (let i = 1; i < r.times.length; i++) assert.ok(Math.abs(r.times[i] - r.times[i - 1] - 1000 / 60) < 1e-6);
  const limiter = new FrameLimiter();
  assert.equal(limiter.allow(0, 60), true);
  assert.equal(limiter.allow(2000, 60), true, 'after a 2 s hitch the next callback runs');
  assert.equal(limiter.allow(2008, 60), false, 'but no catch-up burst follows it');
  assert.equal(limiter.allow(2017, 60), true);
  assert.equal(limiter.allow(10, 60), true, 'a clock that jumps backwards restarts the schedule');
});

test('the dynamic-resolution budget follows the limit and never skips frames; no limit aims at the 50 fps floor', () => {
  assert.equal(dynamicBudgetMs(30), 40);
  assert.equal(dynamicBudgetMs(60), 20);
  assert.equal(dynamicBudgetMs(120), 10);
  assert.equal(dynamicBudgetMs(0), 20);
});

test('frame rate limit setting: unlimited is stored and restored as 0, never as a number', async () => {
  const storage = memory();
  const first = await preferences(storage);
  assert.equal(first.settings.frameCap, 60, 'default');
  first.setSetting('frameCap', '0');
  assert.equal(first.settings.frameCap, 0);
  assert.equal(JSON.parse(storage.getItem('paraliaki.settings')).frameCap, 0);
  const reloaded = await preferences(storage);
  assert.equal(reloaded.settings.frameCap, 0, 'no limit survives a reload');
  for (const cap of [30, 120, 60]) { reloaded.setSetting('frameCap', String(cap)); assert.equal(reloaded.settings.frameCap, cap); assert.equal((await preferences(storage)).settings.frameCap, cap); }
  reloaded.setSetting('frameCap', 'garbage');
  assert.equal(reloaded.settings.frameCap, 60, 'an unreadable value is ignored');
  assert.equal(reloaded.frameCapValue('0'), 0);
});

test('older saved frame limits migrate: unlimited stays unlimited, other values land on a real limit', async () => {
  const cases = [[0, 0], ['0', 0], [null, 0], ['unlimited', 0], ['none', 0], ['No limit', 0], [144, 0], [240, 0], [30, 30], ['60', 60], [120, 120], [45, 30], [100, 120], [undefined, 60], ['', 60], ['abc', 60], [-5, 60], [true, 60]];
  for (const [saved, expected] of cases) {
    const storage = memory({ 'paraliaki.settings': saved === undefined ? '{}' : JSON.stringify({ frameCap: saved }) });
    assert.equal((await preferences(storage)).settings.frameCap, expected, `saved ${JSON.stringify(saved)}`);
  }
  // a save that predates the setting entirely gets the default, and the other preferences are kept
  const old = await preferences(memory({ 'paraliaki.settings': JSON.stringify({ master: .3, units: 'mph' }) }));
  assert.equal(old.settings.frameCap, 60);
  assert.equal(old.settings.units, 'mph');
});

test('every frame consumer goes through the limiter: no leftover fixed rate in the loops', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /frameLimiter\.allow\(now, settings\.frameCap\)/);
  assert.doesNotMatch(main, /800 \/ cap/);
  assert.match(main, /dynamicBudgetMs\(settings\.frameCap\)/);
  const showroom = readFileSync(new URL('../src/car-select.js', import.meta.url), 'utf8');
  assert.doesNotMatch(showroom, /now - drawn < 32|< 32\)/, 'the showroom has no fixed 30 fps gate');
  assert.match(showroom, /limiter\.allow\(now, showroomCap\(\)\)/);
  assert.match(showroom, /settings\.frameCap > 0 \? Math\.min\(30, settings\.frameCap\) : settings\.frameCap/, 'no limit means no limit in the lobby showroom too');
  // timers never drive a render loop: the only one in these files is the hidden-tab online timer, which steps without drawing
  const timers = file => [...readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').matchAll(/^.*(?:setInterval|setTimeout)\(.*$/gm)].map(m => m[0].trim());
  assert.equal(timers('main.js').length, 1);
  assert.match(timers('main.js')[0], /^const onlineBackgroundTimer = setInterval/);
  for (const file of ['car-select.js', 'post.js', 'frame-pacing.js', 'render-scale.js']) assert.deepEqual(timers(file), [], file);
});
