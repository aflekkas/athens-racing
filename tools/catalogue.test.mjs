import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/cars.js', import.meta.url), 'utf8');
const cars = Function('return ' + source.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const helpers = source.slice(source.indexOf('export function defaultTrafficWeight'), source.indexOf('export const TRAFFIC_TYPES')).replaceAll('export ', '');
const { catalogueTrafficTypes } = Function(helpers + '\nreturn { catalogueTrafficTypes };')();

test('passenger traffic follows the playable catalogue, including future entries', () => {
  const future = { id: 'future_city', body: 'future_city', class: 'normal', power: 60, length: 3.6, width: 1.6, color: '#ffffff' };
  const types = catalogueTrafficTypes([...cars, future]);
  assert.deepEqual(types.map(t => t.id), [...cars, future].filter(c => !c.police).map(c => c.id));
  assert.ok(types.every(t => t.catalogueCar.body === t.model && t.len === t.catalogueCar.length && t.wid === t.catalogueCar.width));
  assert.equal(types.at(-1).w, 18);
  assert.ok(types.find(t => t.id === 'golf').w > 50 * types.find(t => t.id === 'carrera').w);
  assert.equal(catalogueTrafficTypes([{ ...future, trafficWeight: 0 }])[0].w, 0);
});

test('stale nitro input and restored bottles cannot boost ordinary cars', async () => {
  await import('./physics-test/register.mjs');
  const { Vehicle } = await import('../src/physics.js');
  const route = { GR: null, frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); }, point(s, u) { return { x: u, z: -s, y: 0 }; }, y: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: () => 0, project(x, z) { return { s: -z, u: x }; } };
  const run = (spec, input) => {
    const v = new Vehicle(spec, route); v.reset(0, 0, 20); v.nitro = 1;
    for (let i = 0; i < 120; i++) v.update(1 / 60, { throttle: 1, brake: 0, steer: 0, nitro: input });
    return v;
  };
  const spec = cars.find(c => c.id === 'golf');
  const ordinary = run(spec, true), control = run(spec, false);
  assert.equal(ordinary.nitro, 0); assert.equal(ordinary.nitroOn, false);
  assert.equal(ordinary.vLong, control.vLong);
  const nitrous = run({ ...spec, nitrous: true }, true);
  assert.equal(nitrous.nitroOn, true); assert.ok(nitrous.nitro < 1 && nitrous.nitro > 0);
  assert.ok(nitrous.vLong > control.vLong + 1);
});
