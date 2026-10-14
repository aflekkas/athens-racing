import './physics-test/register.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Input } from '../src/input.js';
const { Vehicle } = await import('../src/physics.js');

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const poll = source.slice(source.indexOf('function readInput(dt)'), source.indexOf('// ------------------------------------------------------------------ events, modes & menus'));
const cars = Function('return ' + readFileSync(new URL('../src/cars.js', import.meta.url), 'utf8').split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const route = { GR: null, frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); }, point: (s, u) => ({ x: u, z: -s, y: 0 }), y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0, project: (x, z) => ({ s: -z, u: x }) };

for (const id of ['mini', 'golf', 'corolla', 'ibiza']) test(`${id}: real ShiftLeft events through production player polling and physics`, () => {
  const run = boost => {
    const target = new EventTarget(), controls = new Input({ target, navigator: { getGamepads: () => [] }, storage: null, document: null });
    const veh = new Vehicle(cars.find(c => c.id === id), route); veh.reset(0, 0, 20); veh.nitro = 1;
    const readInput = Function('window', 'document', 'G', 'controls', 'player', 'multiplayer', 'ui', 'syncSteeringAssist', 'menu', 'settings', 'input', 'drivingHints', 'flowAction', poll + ';return readInput;')(
      { __flow: { inMenu: () => false } }, { hidden: false, body: { dataset: {}, classList: { add() {} } } }, { state: 'race' }, controls, { veh }, { panel: { hidden: true } }, { hintDevice: x => x }, () => false, null, {}, controls.state, { action() {} }, () => {});
    const key = code => { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { code, repeat: false }); target.dispatchEvent(event); };
    readInput(1 / 60); // The selected vehicle is polled before player input arrives.
    key('KeyW'); if (boost) key('ShiftLeft');
    for (let i = 0; i < 120; i++) { readInput(1 / 60); veh.update(1 / 60, controls.state); }
    const result = { inputNitro: controls.state.nitro, nitro: veh.nitro, nitroOn: veh.nitroOn, speed: veh.vLong }; controls.destroy(); return result;
  };
  const shifted = run(true), ordinary = run(false);
  if (id === 'ibiza') { assert.equal(shifted.inputNitro, true); assert.equal(shifted.nitroOn, true); assert.ok(shifted.nitro < 1 && shifted.nitro > 0); assert.ok(shifted.speed > ordinary.speed); }
  else { assert.equal(shifted.inputNitro, false); assert.equal(shifted.nitroOn, false); assert.equal(shifted.nitro, 0); assert.equal(shifted.speed, ordinary.speed); }
});
