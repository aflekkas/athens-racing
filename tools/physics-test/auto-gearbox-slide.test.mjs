// Owner playtest 2026-10-18 (BMW M3 / E36): "the thing keeps fucking shifting to 1" while drifting. The automatic box
// read the driven wheels as road speed: once the handbrake came off, or the rears dragged in a slide, they turned far
// slower than the car and the box walked down the gears. Downshifts now read the car's speed along its heading (never less
// than the wheels), cannot over-rev the engine, and 1st is only for crawling speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../../src/physics.js';
import { catalogue } from './powertrain.mjs';
const cars = catalogue();
const route = { frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); }, point(s, u) { return { x: u, z: -s, y: 0 }; }, y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0, project(x, z) { return { s: -z, u: x }; } };
const dt = 1 / 60, beta = c => Math.atan2(c.vLat, Math.max(2, Math.abs(c.vLong))), rpmAt = (c, g) => Math.hypot(c.vLong, c.vLat) / c.spec.wheelR * c.ratio(g) * 60 / (2 * Math.PI);
const FIRST_GEAR_KMH = 30;
function slide(id, entry, thr, kmh) {
  const c = new Vehicle({ ...cars.find(x => x.id === id) }, route); c.setManual(false); c.reset(0, 0, kmh / 3.6); c.gear = kmh > 75 ? 4 : 3; c.syncWheels();
  for (let i = 0; i < 90; i++) { c.update(dt, { throttle: .4, brake: 0, steer: 0 }); c.vLong = kmh / 3.6; }
  if (entry === 'handbrake') for (let i = 0; i < 24; i++) c.update(dt, { throttle: .5, brake: 0, steer: .6, handbrake: i < 14 });
  if (entry === 'power') for (let i = 0; i < 40; i++) c.update(dt, { throttle: 1, brake: 0, steer: .7 });
  if (entry === 'feint') { for (let i = 0; i < 24; i++) c.update(dt, { throttle: .5, brake: 0, steer: -.7 }); for (let i = 0; i < 20; i++) c.update(dt, { throttle: 0, brake: i < 9 ? .4 : 0, steer: .7 }); }
  const side = Math.abs(beta(c)) > .05 ? Math.sign(beta(c)) : -Math.sign(c.w), downs = [];
  let serial = c.gearChangeSerial || 0;
  for (let i = 0; i < 360; i++) {
    c.update(dt, { throttle: thr, brake: 0, steer: Math.max(-1, Math.min(1, side * 1.2 * (beta(c) * side - .45) - .25 * c.w)), handbrake: false });
    if ((c.gearChangeSerial || 0) !== serial) { serial = c.gearChangeSerial; const e = c.gearChangeEvent; if (e.direction < 0) downs.push({ t: i * dt, to: e.to, kmh: Math.hypot(c.vLong, c.vLat) * 3.6, rpm: rpmAt(c, e.to) }); }
  }
  return { c, downs };
}
for (const id of ['e36_m3', 'e36', 'huracan']) test(`${id}: no downshift in or after a slide over-revs the engine or drops into 1st at speed`, () => {
  let shifts = 0;
  for (const entry of ['handbrake', 'power', 'feint']) for (const thr of [.5, .8, 1]) for (const kmh of [60, 90]) {
    const { c, downs } = slide(id, entry, thr, kmh);
    for (const d of downs) {
      shifts++;
      assert.ok(d.rpm <= c.spec.redline * .9, `${id} ${entry} thr ${thr} from ${kmh}: ${d.t.toFixed(1)} s, down to ${d.to} at ${d.kmh.toFixed(0)} km/h is ${d.rpm.toFixed(0)} rpm of ${c.spec.redline}`);
      if (d.to === 1) assert.ok(d.kmh < FIRST_GEAR_KMH, `${id} ${entry} thr ${thr} from ${kmh}: dropped to 1st at ${d.kmh.toFixed(0)} km/h`);
    }
  }
  assert.ok(shifts > 0, 'the matrix exercises downshifts');
});
test('after a straight handbrake pull at speed the box holds its gear: the dragged rears are not the road speed', () => {
  for (const id of ['e36_m3', 'e36', 'huracan']) for (const [thr, pull] of [[0, .6], [.3, .6], [.3, 1.2]]) {
    const c = new Vehicle({ ...cars.find(x => x.id === id) }, route); c.setManual(false); c.reset(0, 0, 100 / 3.6); c.gear = Math.min(5, c.spec.gears.length - 1); c.syncWheels();
    let serial = c.gearChangeSerial;
    for (let i = 0; i < 4 * 240; i++) {
      const t = i / 240; c.update(1 / 240, { throttle: t < .2 ? .4 : thr, brake: 0, steer: 0, handbrake: t > .2 && t < .2 + pull });
      if (c.gearChangeEvent && c.gearChangeSerial !== serial) { serial = c.gearChangeSerial; const e = c.gearChangeEvent; if (e.direction < 0) assert.ok(c.kmh < 80, `${id} thr ${thr} pull ${pull}: ${e.from}>${e.to} at ${c.kmh.toFixed(0)} km/h after the handbrake, ${t.toFixed(2)} s`); }
    }
  }
});
