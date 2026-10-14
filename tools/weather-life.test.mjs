import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldLife, FRONTS, trafficByHour, validWorldSnapshot } from '../src/world-life.js';
import { WEATHER, advanceRoadWetness } from '../src/wet-grip.js';
import * as ENV from '../src/env.js';
import { applySetup } from '../src/race-setup.js';
import { receiveWorldLife } from '../src/world-life-runtime.js';

test('free roam starts at chosen time and completes a configurable real-time day', () => {
  const world = new WorldLife({ dayMinutes: 30 }); world.configure({ type: 'free', time: 'dawn' });
  assert.equal(world.hour, 6); world.advance(450); assert.equal(world.hour, 12);
  world.advance(1350); assert.equal(world.hour, 6);
  world.configure({ type: 'free', time: 'night', dayMinutes: 40 }); world.advance(2400); assert.equal(world.hour, 3);
});
test('Quick Race stays fixed unless a Dynamic dimension is chosen', () => {
  const world = new WorldLife(); world.configure({ time: 'night', weather: 'rain' }); const before = world.sample(); world.advance(5000); assert.deepEqual(world.sample(), before);
  world.configure({ time: 'dynamic', weather: 'clear' }); world.advance(600); assert.equal(world.front, 'clear'); assert.notEqual(world.hour, 17);
  world.configure({ time: 'dawn', weather: 'dynamic' }); world.advance(1000); assert.equal(world.hour, 6); assert.notEqual(world.front, 'clear');
  const def = applySetup({ id: 'quick', type: 'sprint' }, { time: 'dynamic', weather: 'dynamic' }); assert.deepEqual(def.conditions, { time: 'dynamic', weather: 'dynamic' });
});
test('weather only crosses adjacent fronts, lasts minutes, and ramps through rain', () => {
  const world = new WorldLife({ seed: 123 }); world.configure({ type: 'free' }); let previous = world.front, rainSeen = false;
  for (let i = 0; i < 12000; i++) {
    const prevRain = world.weather.rain; world.advance(1);
    if (world.front !== previous) { assert.ok(FRONTS[previous].next.includes(world.front)); assert.ok(world.hold >= 120); previous = world.front; }
    assert.ok(Math.abs(world.weather.rain - prevRain) < .04); rainSeen ||= world.weather.rain > .9;
  }
  assert.ok(rainSeen);
});
test('host snapshots preserve the exact next front and elapsed clock, with bounded age extrapolation', () => {
  const host = new WorldLife({ seed: 55 }); host.configure({ type: 'free' }); host.advance(701);
  const client = new WorldLife({ seed: 9 }); assert.ok(client.adopt(host.snapshot(), 2)); host.advance(2);
  assert.deepEqual(client.sample(), host.sample()); host.advance(400); client.advance(400); assert.deepEqual(client.snapshot(), host.snapshot());
  assert.equal(validWorldSnapshot({ ...host.snapshot(), hour: 99 }), false); assert.equal(client.adopt({}), false);
  assert.equal(validWorldSnapshot({ ...host.snapshot(), wet: 9 }), false);
  assert.ok(receiveWorldLife({ ...host.snapshot(), wet: .65 })); assert.equal(WEATHER.wet, .65); assert.equal(WEATHER.gripScale, 1 - .24 * .65);
});
test('continuous canonical lighting is smooth at midnight/dawn/dusk, with headlights at night', () => {
  const world = new WorldLife(); world.configure({ type: 'free' });
  for (const hour of [0, 5.5, 6, 8, 14, 20, 21, 23.999]) {
    world.hour = hour; ENV.setWorldConditions(world.sample()); const before = ENV.SUN_INTENSITY;
    assert.ok(Number.isFinite(before) && before > 0); assert.ok(ENV.COND_STATE.exposure > 0);
    world.hour = (hour + .001) % 24; ENV.setWorldConditions(world.sample()); assert.ok(Math.abs(ENV.SUN_INTENSITY - before) < .01);
  }
  world.hour = 3; ENV.setWorldConditions(world.sample()); assert.equal(ENV.COND_STATE.headlights, 1);
  assert.ok(trafficByHour(8.5) > trafficByHour(3) * 2); assert.ok(trafficByHour(18.5) > trafficByHour(3) * 2);
});
test('wetness builds in rain and dries gradually after clearing', () => {
  WEATHER.wet = 0; advanceRoadWetness(20, 1, 1); const wet = WEATHER.wet; assert.ok(wet > .5);
  advanceRoadWetness(20, 0, 1); assert.ok(WEATHER.wet < wet && WEATHER.wet > .3); advanceRoadWetness(1000, 0, 1); assert.ok(WEATHER.wet < .001);
});
