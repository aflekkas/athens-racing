import test from 'node:test';
import assert from 'node:assert/strict';
import { CockpitLamps } from '../src/cockpit-telltales.js';
const lit = lamps => Object.fromEntries(lamps.filter(([, colour]) => colour));
test('ignition checks every bulb, seatbelt clears, restart checks bulbs again', () => {
  const lamps = new CockpitLamps(), st = { ignition: true, vehicle: {} };
  assert.equal(Object.keys(lit(lamps.update(0, st))).length, 13);
  assert.deepEqual(Object.keys(lit(lamps.update(1.1, st))), ['seatbelt']);
  assert.deepEqual(lit(lamps.update(3, st)), {});
  lamps.update(0, { ignition: false });
  assert.equal(Object.keys(lit(lamps.update(0, st))).length, 13);
});
test('intervention flashes and holds brief TC/ABS pulses; disabling TC shows OFF', () => {
  const lamps = new CockpitLamps();
  assert.ok(lit(lamps.update(0, { vehicle: { tcOn: true, absOn: true } })).esc);
  assert.ok(lit(lamps.update(.1, {})).abs);
  assert.equal(lit(lamps.update(.2, {})).esc, undefined);
  assert.deepEqual(Object.keys(lit(lamps.update(.3, { aidsOff: true }))), ['esc-off']);
});
test('damage severity, temperature, wheels, brake and lighting follow vehicle state', () => {
  const lamps = new CockpitLamps();
  assert.equal(lit(lamps.update(0, { vehicle: { engHealth: .8 } })).engine, '#ffb21a');
  const st = { vehicle: { engHealth: .2, coolantTemp: 130, cornerDamage: [0, .2, 0, 0] }, handbrake: true, lowBeam: true };
  const on = lit(lamps.update(0, st));
  for (const name of ['engine', 'oil', 'temperature', 'handbrake']) assert.equal(on[name], '#ff453a');
  assert.equal(on.tyre, '#ffb21a'); assert.equal(on.low, '#46e878');
  const beams = lit(lamps.update(0, { highBeam: true, lowBeam: true, hazards: true }));
  assert.equal(beams.high, '#429cff'); assert.equal(beams.low, undefined); assert.ok(beams.left && beams.right);
  assert.deepEqual(lit(lamps.update(0, {})), {});
});
