// The owner's report: "going into a corner at 80 in a Lambo, I should be able to go sharp into it and keep
// traction". Straight at 80 km/h, then a fast full keyboard (real Input ramp) or gamepad steer, lifted or trail-braking,
// and a lifted S-bend reversal. The car must rotate promptly, hold close to its grip-limited curvature without
// ploughing (no ESC/ABS lock-up collapsing the yaw) and stay out of drift mode.
import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS, route } from './handling.mjs';
import { Input } from '../../src/input.js';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const dt = 1 / 60, G = 9.81;
const beta = (v) => Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong)));

/** steer: 1 right / -1 left per frame (function of time); returns the per-frame trace */
export function cornerEntry(spec, { device = 'keyboard', brake = 0, steer = () => 1, seconds = 1.5 } = {}) {
  const v = new Vehicle(spec, route); v.reset(0, 0, 80 / 3.6); v.steerAssist = device === 'keyboard' ? 1 : 0.35;
  for (let i = 0; i < 60; i++) { v.update(dt, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = 80 / 3.6; }
  const controls = new Input({ target: null, navigator: null, document: null, storage: null });
  let pad = 0; const trace = [];
  // path curvature from the turn of the velocity vector (w / v misreads a car whose sideslip is unwinding)
  let course = Math.atan2(v.velocityWorld().x, -v.velocityWorld().z);
  for (let i = 0; i < seconds / dt; i++) {
    const t = (i + 1) * dt, want = steer(t);
    let s;
    if (device === 'keyboard') {
      controls.keys.delete('KeyA'); controls.keys.delete('KeyD');
      if (want) controls.keys.add(want > 0 ? 'KeyD' : 'KeyA');
      controls.update(dt, { speed: v.speed }); s = controls.state.steer;
    } else { pad += Math.max(-dt / 0.05, Math.min(dt / 0.05, want - pad)); s = pad; }
    v.update(dt, { throttle: 0, brake, steer: s });
    const vel = v.velocityWorld(), c2 = Math.atan2(vel.x, -vel.z);
    let dc = c2 - course; dc -= Math.round(dc / (2 * Math.PI)) * 2 * Math.PI; course = c2;
    trace.push({ t, w: v.w, v: v.speed, k: dc / dt / Math.max(1, v.speed), beta: beta(v), latch: v.driftLatch, front: Math.max(v.corners[0].sN, v.corners[1].sN) });
  }
  controls.destroy();
  return { v, trace, capK: (vel) => (v.ayCap ?? v.maxLatAccel(25)) / (vel * vel) };
}

const IDS = ['huracan', 'aventador_svj', 'z4', 'carrera', 'e36_m3'];
for (const id of IDS) for (const device of ['keyboard', 'gamepad']) for (const brake of [0, 0.3, 1]) {
  test(`80 km/h corner entry ${id} / ${device} / brake ${brake}: sharp turn-in, holds the line`, () => {
    const { trace, capK } = cornerEntry(CARS.find((c) => c.id === id), { device, brake });
    const at = (t) => trace[Math.round(t / dt) - 1];
    assert.ok(at(0.15).w > (brake < 0.5 ? 0.25 : 0.15), `${id}: yaw rate ${at(0.15).w.toFixed(3)} rad/s at 150 ms`);
    // Over the hold, path curvature stays near what the tyres can do at that speed (lifted) / still turns
    // hard while braking (part of the friction circle goes to the deceleration). Trail-braked RWD cars may rotate
    // (owner: less understeer than real), but only as a caught slide, never a spin.
    const need = brake === 0 ? 0.8 : brake < 0.5 ? 0.7 : 0.5;
    const hold = trace.filter((r) => r.t >= 0.4);
    const mean = (i) => trace.slice(i - 5, i + 1).reduce((a, r) => a + r.k / capK(r.v), 0) / 6; // 0.1 s window
    const worst = Math.min(...trace.map((r, i) => (r.t >= 0.4 ? mean(i) : 9)));
    assert.ok(worst > need, `${id}: curvature fell to ${(worst * 100).toFixed(0)}% of the grip limit (plough)`);
    assert.ok(hold.every((r) => Math.abs(r.beta) < (brake ? 12 : 9) / 57.3), `${id}: slid ${(Math.max(...hold.map((r) => Math.abs(r.beta))) * 57.3).toFixed(1)} deg`);
    assert.ok(trace.every((r) => r.latch === 0), `${id}: an ordinary corner entry latched drift mode`);
  });
}

for (const id of IDS) for (const device of ['keyboard', 'gamepad']) test(`80 km/h lifted S-bend ${id} / ${device}: reverses without a pendulum spin`, () => {
  const { trace } = cornerEntry(CARS.find((c) => c.id === id), { device, steer: (t) => (t < 0.6 ? 1 : -1), seconds: 2.2 });
  const maxBeta = Math.max(...trace.map((r) => Math.abs(r.beta))) * 57.3;
  assert.ok(maxBeta < 10, `${id}: S-bend sideslip ${maxBeta.toFixed(1)} deg`);
  assert.ok(trace.every((r) => r.latch === 0), `${id}: S-bend latched drift mode`);
  const late = trace.filter((r) => r.t > 1.2);
  assert.ok(late.every((r) => r.k < -0.6 * 9.81 / (r.v * r.v)), `${id}: lost the second bend`);
});
