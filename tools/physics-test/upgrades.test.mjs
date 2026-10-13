// Every catalogue car at full upgrades (src/progression.js applyUpgrades) must still be a sane car:
//   node --import ./tools/physics-test/register.mjs --test tools/physics-test/upgrades.test.mjs
// finite state, plausible 0-100 / top speed / 100-0, and a straight full-throttle (+ nitro) launch with the car's own
// aids on does not spin or wander (also when kicked with a yaw-rate disturbance).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vehicle } from '../../src/physics.js';
import { applyUpgrades, UPGRADE_KEYS, MAX_STAGE, nitroRefund } from '../../src/progression.js';

const route = { GR: null, frame: (s, o) => Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }), point: (s, u) => ({ x: u, z: -s, y: 0 }), y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0, project: (x, z) => ({ s: -z, u: x }) };
const src = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const arr = src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length);
let depth = 0, end = 0;
for (let i = 0; i < arr.length; i++) { if (arr[i] === '[') depth++; else if (arr[i] === ']' && --depth === 0) { end = i + 1; break; } }
const CARS = new Function('return ' + arr.slice(0, end))();
const MAX = Object.fromEntries(UPGRADE_KEYS.map((k) => [k, MAX_STAGE]));
const DT = 1 / 60;
const finite = (v) => [v.x, v.z, v.yaw, v.vLong, v.vLat, v.w, v.rpm, ...v.corners.map((c) => c.vw)].every(Number.isFinite);

function launch(spec, nitro = false, kick = 0) {
  const v = new Vehicle(spec, route); v.reset(0, 0, 0);
  let t = 0, t100 = null, maxYaw = 0, maxLat = 0, maxW = 0, ok = true, n = 0;
  while (t < 60) {
    if (kick && n++ === 30) v.w = kick; // a yaw-rate disturbance half a second into the launch (a bump, a twitch)
    v.update(DT, { throttle: 1, brake: 0, steer: 0, nitro });
    if (v.nitroOn) v.nitro = Math.min(1, v.nitro + DT * nitroRefund(spec)); // what main.js does each frame
    t += DT;
    if (!t100 && v.kmh >= 100) t100 = t;
    maxYaw = Math.max(maxYaw, Math.abs(v.yaw)); maxLat = Math.max(maxLat, Math.abs(v.x)); maxW = Math.max(maxW, Math.abs(v.w));
    if (!finite(v)) { ok = false; break; }
  }
  return { v, t100, maxYaw, maxLat, maxW, ok };
}
function stop(spec) {
  const b = new Vehicle(spec, route); b.reset(0, 0, 100 / 3.6); const z0 = b.z;
  for (let i = 0; i < 900 && b.kmh > 0.3; i++) b.update(DT, { throttle: 0, brake: 1, steer: 0 });
  return { d: Math.abs(b.z - z0), ok: finite(b) };
}

test('catalogue parsed', () => assert.ok(CARS.length >= 6));
for (const base of CARS) {
  test(`${base.id} at max upgrades stays stable and plausible`, () => {
    const spec = applyUpgrades(base, MAX), stock = applyUpgrades(base, {});
    for (const k of ['mass', 'grip', 'brake', 'vmax', 'powerMul', 'nitroCap']) assert.ok(Number.isFinite(spec[k]) && spec[k] > 0, k);
    const L = launch(spec), S = launch(stock);
    assert.ok(L.ok, 'finite through 60 s of full throttle');
    assert.ok(L.t100 > 2.5 && L.t100 < 14, `0-100 ${L.t100?.toFixed(2)} s`);
    assert.ok(L.t100 <= S.t100 + 0.05, `upgraded no slower to 100 (${L.t100.toFixed(2)} vs stock ${S.t100.toFixed(2)})`);
    assert.ok(L.v.kmh > spec.vmax * 0.85 && L.v.kmh < spec.vmax * 1.05, `top ${L.v.kmh.toFixed(1)} vs vmax ${spec.vmax}`);
    // no spin on a straight launch with the car's own aids
    assert.ok(L.maxYaw < 0.05 && L.maxLat < 0.5 && L.maxW < 0.05, `yaw ${L.maxYaw.toFixed(4)} rad, drift ${L.maxLat.toFixed(3)} m, w ${L.maxW.toFixed(4)}`);
    const N = launch(spec, true);
    assert.ok(N.ok && N.maxYaw < 0.05 && N.maxLat < 0.5, `nitro launch: yaw ${N.maxYaw.toFixed(4)}, drift ${N.maxLat.toFixed(3)}`);
    // disturbed launch: the yaw kick must die out, not grow into a spin
    const K = launch(spec, false, 0.15);
    assert.ok(K.ok && K.maxYaw < 0.25 && Math.abs(K.v.w) < 0.01, `kicked launch: max yaw ${K.maxYaw.toFixed(3)} rad, final w ${K.v.w.toFixed(4)}`);
    // ...and on nitro, for cars that have aids (the GTV has no TC / ESC at all: stock, it already spins when
    // kicked on a nitro launch, so that case is a property of the car, not of the upgrades)
    if (base.tc > 0 || base.esc > 0) {
      const KN = launch(spec, true, 0.15);
      assert.ok(KN.ok && KN.maxYaw < 0.25 && Math.abs(KN.v.w) < 0.01, `kicked nitro launch: max yaw ${KN.maxYaw.toFixed(3)} rad, final w ${KN.v.w.toFixed(4)}`);
    }
    const B = stop(spec);
    assert.ok(B.ok && B.d > 22 && B.d < 50, `100-0 ${B.d.toFixed(1)} m`);
  });
}

test('nitro capacity: stage 3 bottle lasts ~1.8x as long', () => {
  const spec = applyUpgrades(CARS[0], { nitro: 3 }), stock = applyUpgrades(CARS[0], {});
  const burn = (s) => { const v = new Vehicle(s, route); v.reset(0, 0, 20); v.gear = 3; v.nitro = 1; let t = 0; while (v.nitro > 0.01 && t < 30) { v.update(DT, { throttle: 1, brake: 0, steer: 0, nitro: true }); if (v.nitroOn) v.nitro = Math.min(1, v.nitro + DT * nitroRefund(s)); t += DT; } return t; };
  const a = burn(stock), b = burn(spec);
  assert.ok(Math.abs(b / a - 1.8) < 0.1, `stock ${a.toFixed(2)} s, stage 3 ${b.toFixed(2)} s`);
});
