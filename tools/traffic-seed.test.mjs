// node --import ./tools/physics-test/register.mjs --test tools/traffic-seed.test.mjs
// Online traffic is simulated by one driver (the lobby's traffic authority) and shown to the rest, and the authority can change
// mid-race (the host disconnects or is still loading). Whoever takes over must start from the same traffic: the race's seed is the
// text `raceId:generation`, so two clients that seed from it must build the same pool and the same road. The owner's playtest
// ("why is there traffic on Megara", "traffic differs between us") asks for exactly this to hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RNG, smoothstep } from '../src/util.js';
import { Route } from '../src/map.js';
import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { trafficSeed } from '../src/mp-shared-world.js';
import { buildWorld } from './headless-traffic.mjs';

const data = JSON.parse(readFileSync(new URL('../data/map.json', import.meta.url)));
function client(key, { s = 800, hour = 15 } = {}) {
  const route = new Route(data.route, { corridors: RIVIERA_TUNNELS });
  route.urban = (v) => { let u = data.zones[0].urban; for (let i = 1; i < data.zones.length; i++) u += (data.zones[i].urban - data.zones[i - 1].urban) * smoothstep(data.zones[i].s - 120, data.zones[i].s + 130, v); return u; };
  const { traffic } = buildWorld(route, data, { hour });
  traffic.rng = new RNG(trafficSeed(key)); traffic.reset(s); // exactly what SharedWorld.configure does when a race key is first seen
  return traffic;
}
const f = n => Number.isFinite(n) ? +n.toFixed(3) : n;
const view = t => t.cars.map(c => c.active ? { id: c.id, type: c.type.id, active: true, s: f(c.s), u: f(c.u), dir: c.dir, lane: c.lane, mode: c.mode, v: f(c.v) } : { id: c.id, type: c.type.id, active: false });

test('two clients that seed from the same race key build identical traffic, before and after the road is driven', () => {
  const a = client('race-1:3'), b = client('race-1:3');
  assert.equal(a.cars.length, b.cars.length); assert.deepEqual(view(a), view(b));
  assert.ok(a.cars.some(c => c.active), 'the seeded reset populates the road');
  for (let i = 0; i < 1200; i++) { a.update(1 / 60, 800 + i * .4, []); b.update(1 / 60, 800 + i * .4, []); }
  assert.deepEqual(view(a), view(b), 'twenty seconds later the two simulations still agree car for car');
});

test('a different race, or a restarted race, is different traffic (the generation is part of the seed)', () => {
  const a = client('race-1:3'), other = client('race-2:3'), restarted = client('race-1:4');
  assert.notDeepEqual(view(a), view(other)); assert.notDeepEqual(view(a), view(restarted));
  assert.notEqual(trafficSeed('race-1:3'), trafficSeed('race-1:4'));
});

test('the authority that takes over mid-race continues from the same cars as the one that left', () => {
  const a = client('race-1:3'); for (let i = 0; i < 600; i++) a.update(1 / 60, 800 + i * .4, []);
  const before = view(a).filter(c => c.active);
  // The new authority seeds the same race, then adopts the last shared frame (SharedWorld.apply with promote): the road it shows
  // is the one everybody was already looking at.
  const b = client('race-1:3');
  for (const c of a.cars) if (c.active) { const t = b.cars[c.id]; Object.assign(t, { active: true, s: c.s, u: c.u, dir: c.dir, v: c.v, lane: c.lane, mode: c.mode }); }
  for (const c of before) { const t = b.cars[c.id]; assert.ok(t.active); assert.equal(t.type.id, c.type, `car ${c.id} is the same model on both clients`); assert.equal(f(t.s), c.s); }
});
