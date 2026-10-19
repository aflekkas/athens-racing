// Owner playtest 2026-10-18: other drivers' tyre smoke and burnouts were never visible online (fx.update did not run in
// multiplayer, and the wheel flags never left the driver's machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Fx } from '../src/fx.js';
import { StateSender } from '../src/multiplayer-state.js';
import { spectatorState, applySpectatorState } from '../src/race-lifecycle.js';
import { tyreFxState } from '../src/remote-tyre-fx.js';
import { validateStateExtras } from '../server/mp-lifecycle.mjs';

const corner = () => ({ vw: 0, sN: 0, Fz: 0 });
const car = (extra = {}) => ({ x: 0, y: 0, z: 0, s: 50, u: 0, yaw: 0, steer: 0, vLong: 0, vLat: 0, w: 0, m: 1200, a: 1.2, b: 1.4, track: 1.5, air: 0, water: 0, drift: 0, burnout: false, lockup: 0, wheelspin: 0, absOn: false,
  corners: [corner(), corner(), corner(), corner()], pose: { heave: 0, pitch: 0, roll: 0 }, velocityWorld(v) { v.set(0, 0, -this.vLong); return v; }, ...extra });
const route = { length: 1000, frame: () => ({ tx: 0, tz: -1, rx: 1, rz: 0 }), surfaceY: () => 0, edge: () => 8 };
const fxFor = () => new Fx(new THREE.Scene(), route, null);
const camera = { fov: 60 };

test('the burnout flag survives send, server validation and receipt, and rebuilds spinning rear wheels', () => {
  const driver = car({ burnout: true, drift: 0.123456, wheelspin: 0.5, lockup: 0 });
  const sent = spectatorState(driver);
  assert.equal(sent.burnout, true); assert.equal(sent.drift, 0.12);
  const stored = validateStateExtras(sent);
  assert.equal(stored.burnout, true); assert.equal(stored.wheelspin, 0.5);
  for (const bad of [{ burnout: 'yes' }, { drift: 99 }, { lockup: -1 }, { wheelspin: NaN }]) assert.deepEqual(Object.keys(validateStateExtras(bad)), [], JSON.stringify(bad));
  const remote = car(); applySpectatorState(remote, stored);
  assert.equal(remote.burnout, true);
  assert.ok(remote.corners[2].vw - remote.vLong > 6 && remote.corners[3].vw - remote.vLong > 6, 'rear tyres spin well past road speed');
  assert.equal(remote.corners[0].vw, remote.vLong, 'front tyres roll');
  assert.ok(remote.corners[2].sN > 1.5);
});

test('a remote burnout makes smoke through the same Fx path as the driver\'s own car; a rolling one does not', t => {
  const fx = fxFor(), spinning = car(), rolling = car({ vLong: 30 }), emit = t.mock.method(fx.smoke, 'emit', () => {});
  applySpectatorState(spinning, { ...tyreFxState({ burnout: true }), vLong: 0 });
  applySpectatorState(rolling, tyreFxState({}));
  for (let i = 0; i < 40; i++) fx.update(1 / 30, [rolling], camera, 800);
  assert.equal(emit.mock.callCount(), 0, 'a car rolling normally makes no tyre smoke');
  for (let i = 0; i < 40; i++) fx.update(1 / 30, [spinning], camera, 800);
  assert.ok(emit.mock.callCount() > 5, `burnout smoke appears (${emit.mock.callCount()} puffs)`);
});

test('a parked car that starts a burnout is still sent although its pose is unchanged', () => {
  const sent = []; let now = 0; const timers = [];
  const sender = new StateSender(p => sent.push(p), { now: () => now, schedule: (fn, d) => { timers.push([now + d, fn]); return timers.length; }, cancel() {} });
  const base = { x: 0, y: 0, z: 0, s: 0, u: 0, yaw: 0, vLong: 0, vLat: 0, steer: 0, rpm: 900, gear: 1, nitro: 0, reverse: false, damage: { front: 0, rear: 0, left: 0, right: 0 }, burnout: false, wheelspin: 0 };
  const flush = () => { now += 300; for (const [at, fn] of timers.splice(0)) if (at <= now) fn(); };
  sender.sample(base, 'race'); flush(); const first = sent.length;
  now += 100; sender.sample({ ...base }, 'race'); flush(); assert.equal(sent.length, first, 'unchanged parked state stays quiet');
  now += 100; sender.sample({ ...base, burnout: true, wheelspin: 0.9, rpm: 6500 }, 'race'); flush();
  assert.equal(sent.length, first + 1, 'the burnout reaches the other drivers');
});

test('the race loop runs Fx online for the driver and nearby visible rivals', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const frame = main.slice(main.indexOf('_fxVehs.length = 0'), main.indexOf('_fxVehs.length = 0') + 700);
  assert.match(frame, /multiplayer\.active\) \{ for \(const c of remoteCars\.values\(\)\)/);
  assert.doesNotMatch(main.slice(main.indexOf('_fxVehs.length = 0') - 80, main.indexOf('_fxVehs.length = 0')), /if \(!multiplayer\.active\) \{/);
  assert.match(frame, /fx\.update\(simulate \? dt : 0, _fxVehs/);
});
