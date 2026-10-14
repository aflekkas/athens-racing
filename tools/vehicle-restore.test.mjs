import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './physics-test/register.mjs';
import { spectatorState, applySpectatorState, restoreVehicleState } from '../src/race-lifecycle.js';
const { Vehicle } = await import('../src/physics.js');

const route = {
  GR: null,
  frame: (s, out) => Object.assign(out, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }),
  point: (s, u) => ({ x: u, z: -s, y: 0 }),
};
const spec = {
  id: 'taxi', body: 'sedan', engine: 'diesel', drive: 'fwd', mass: 1500,
  idle: 800, redline: 5000, gears: [3.8, 2.4, 1.7, 1.3, 1.05, .85], final: 3.4, wheelR: .33,
};

test('actual multiplayer start resume path restores a real Vehicle with lifecycle tyre telemetry', () => {
  const source = new Vehicle(spec, route);
  source.reset(123, 2, 18);
  Object.assign(source, {
    yaw: .3, vLat: 1.5, steer: .12, rpm: 2300, gear: 3,
  });
  source.damage.left = .25;
  source.damageFx();
  const resumeState = {
    ...Object.fromEntries(['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear', 'reverse'].map(k => [k, source[k]])),
    damage: { ...source.damage }, ...spectatorState(source),
    nitro: .9, nitroOn: true, remoteTyreTelemetry: { stale: true }, speed: 999, kmh: 999,
  };
  const before = structuredClone(resumeState);
  assert.ok(resumeState.tyreTelemetry.front);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const line = main.split('\n').find(line => line.includes('if (resumeState) { const v = new Vehicle('));
  assert.ok(line, 'execute the production resume block');
  const player = { veh: source }, ground = {};
  assert.doesNotThrow(() => Function('Vehicle', 'restoreVehicleState', 'player', 'route', 'ground', 'resumeState', line)(Vehicle, restoreVehicleState, player, route, ground, resumeState));
  const restored = player.veh;
  assert.notEqual(restored, source);
  assert.equal(restored.ground, ground);
  for (const key of Object.keys(resumeState)) {
    if (['tyreTelemetry', 'remoteTyreTelemetry', 'speed', 'kmh', 'nitro', 'nitroOn'].includes(key)) continue;
    assert.deepEqual(restored[key], resumeState[key], key);
  }
  assert.equal(restored.nitro, 0);
  assert.equal(restored.nitroOn, false);
  assert.equal(restored.lastV, resumeState.vLong);
  assert.equal(restored.remoteTyreTelemetry, undefined);
  assert.equal(Object.hasOwn(restored, 'tyreTelemetry'), false);
  assert.equal(restored.speed, Math.hypot(restored.vLong, restored.vLat));
  assert.equal(restored.kmh, 18 * 3.6);
  assert.deepEqual(resumeState, before, 'snapshot remains intact for spectators');
  const remote = new Vehicle(spec, route);
  applySpectatorState(remote, resumeState);
  assert.equal(remote.remoteTyreTelemetry, resumeState.tyreTelemetry);
  assert.equal(remote.engHealth, source.engHealth);
});

test('restoration skips accessors and non-writable data anywhere in the prototype chain', () => {
  let writes = 0;
  class DerivedVehicle extends Vehicle {
    get derived() { return 42; }
    set derived(value) { writes++; }
  }
  const vehicle = new DerivedVehicle(spec, route);
  Object.defineProperty(vehicle, 'fixed', { value: 7, writable: false });
  assert.equal(restoreVehicleState(vehicle, { derived: 0, fixed: 0, kmh: 0, s: 45, remoteTyreTelemetry: {} }), vehicle);
  assert.equal(writes, 0);
  assert.equal(vehicle.derived, 42);
  assert.equal(vehicle.fixed, 7);
  assert.equal(vehicle.s, 45);
  assert.equal(vehicle.remoteTyreTelemetry, undefined);
  const snapshot = { ...spectatorState(vehicle), engineDamage: .2, engHealth: .8, coolantTemp: 106 };
  restoreVehicleState(vehicle, snapshot);
  assert.equal(vehicle.engineDamage, .2);
  assert.equal(vehicle.engHealth, .8);
  assert.equal(vehicle.coolantTemp, 106);
});
