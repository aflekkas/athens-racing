// Deliberate handbrake burnouts through the keyboard and pad input chains.
import './register.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const { Vehicle } = await import(process.env.PHYS || '../../src/physics.js');
const { Input } = await import('../../src/input.js');
const catalogue = readFileSync(new URL('../../src/cars.js', import.meta.url), 'utf8');
const cars = Function('return ' + catalogue.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const route = { GR: null, frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); }, point(s, u) { return { x: u, z: -s, y: 0 }; }, y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0 };
route.project = (x,z) => ({s:-z,u:x});
const baseline = process.argv.includes('--baseline'), rows = [];
for (const spec of cars) for (const device of ['keyboard', 'gamepad']) for (const entry of [0, 10]) {
  const v = new Vehicle(spec, route); v.reset(100, 0, entry/3.6); v.roadEvents = false;
  const pad = { index: 0, id: 'burnout bench', connected: true, axes: [0,0,0,0], buttons: Array.from({length:17}, () => ({ value: 0 })) };
  const input = new Input({ target: null, document: null, storage: null, navigator: { getGamepads: () => device === 'gamepad' ? [pad] : [] } });
  if (device === 'keyboard') { input.keyDown({code:'KeyW'}); input.keyDown({code:'Space'}); } else { pad.buttons[7].value = pad.buttons[0].value = 1; }
  let maxHoldKmh = 0, minSpin = Infinity, minRpm = Infinity, maxCut = 0, spinSeconds = 0;
  const spinAxle = spec.drive === 'fwd' ? [0,1] : [2,3], holdAxle = spec.drive === 'fwd' ? [2,3] : [0,1];
  for (let i = 0; i < 420; i++) {
    v.update(1/60, input.update(1/60));
    if (!baseline) assert.equal(v.handbrakeInput, true);
    if (i >= 240) { maxHoldKmh = Math.max(maxHoldKmh, v.kmh); minSpin = Math.min(minSpin, ...spinAxle.map(i => v.corners[i].vw - v.vLong)); minRpm = Math.min(minRpm, v.rpm); maxCut = Math.max(maxCut, v.tcCut); if (spinAxle.every(i => v.corners[i].vw - v.vLong > 6)) spinSeconds += 1/60; }
  }
  const holdWheelSpeed = Math.max(...holdAxle.map(i => Math.abs(v.corners[i].vw))), heldDistance = -v.z - 100;
  if (device === 'keyboard') input.keys.delete('Space'); else pad.buttons[0].value = 0;
  const releaseS = v.s;
  for (let i = 0; i < 180; i++) v.update(1/60, input.update(1/60));
  const row = { car: spec.id, drive: spec.drive, device, entry, maxHoldKmh, minSpin, minRpm, redline: spec.redline, maxCut, spinSeconds, holdWheelSpeed, heldDistance, launchKmh: v.kmh, launchDistance: v.s - releaseS };
  rows.push(row); console.log(JSON.stringify(row));
  if (!baseline) { assert.ok(maxHoldKmh < 3, 'must hold near stationary: '+JSON.stringify(row)); assert.ok(minSpin > 6 && spinSeconds >= 2.99, 'sustained driven tyre slip: '+JSON.stringify(row)); assert.ok(minRpm > spec.redline*0.65); assert.equal(maxCut,0); assert.ok(holdWheelSpeed < 0.5); assert.ok(v.kmh > 25 && row.launchDistance > 10); assert.equal(v.burnout,false); assert.equal(v.handbrakeInput,false); }
}
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6); if (out) writeFileSync(out, JSON.stringify(rows,null,2)+'\n');
