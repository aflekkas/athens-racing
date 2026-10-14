import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { scenarios, measure } from './police-tuning.mjs';
import { world, step } from './police-fixture.mjs';
import { HEAT } from '../src/police.js';
import { patrolPlan } from '../src/police-patrols.js';
for (const scenario of scenarios) test(`trigger table: ${scenario.trigger}`, () => {
  for (const dt of [1 / 60, 1 / 30]) {
    const row = measure(scenario, { dt });
    if (scenario.star === undefined) assert.equal(row.timeToStar, null, JSON.stringify(row));
    else assert.ok(Math.abs(row.timeToStar - scenario.star) <= dt + 1e-6, JSON.stringify(row));
    if (scenario.trigger === '+40 km/h; cop 60 m') assert.ok(Math.abs(row.timeToWarning - .25 / HEAT.speedHeat) <= dt, JSON.stringify(row));
    if (scenario.trigger === '+60 km/h; cop 60 m') assert.ok(Math.abs(row.timeToWarning - .25 / HEAT.seriousSpeedHeat) <= dt, JSON.stringify(row));
  }
});
const fixture = t => { const W = world(); t.after(() => { W.police.reset(false); W.police.offs.forEach(off => off()); }); W.police.reset(true); return W; };
test('normal 120 km/h race through 2 km without cops never builds heat', t => {
  const W = fixture(t); W.player(1000, 2, 120 / 3.6);
  step(W, 60, {}, 1 / 60, dt => { W.traffic.racers[0].s += 120 / 3.6 * dt; });
  assert.equal(W.police.hm.heat, 0); assert.equal(W.police.hm.level, 0);
});
test('speed observation is consecutive; a brief pass decays out of sight', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); const c = W.police.spawnCop(1060, 1);
  step(W, 2); assert.equal(W.police.hm.level, 0); const heat = W.police.hm.heat;
  c.s = 1100; step(W, 1); assert.ok(W.police.hm.heat < heat); assert.equal(W.police.speedT, 0);
  c.s = 1060; step(W, 2); assert.equal(W.police.hm.level, 0);
  c.s = 1300; step(W, 8); assert.equal(W.police.hm.heat, 0); assert.equal(W.police.hm.state, 'idle');
});
test('witness range boundaries are inclusive at 75 m, checked fresh for each offence', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); const c = W.police.spawnCop(1000, 1); c.u = 2;
  c.s = 1075; assert.equal(W.police.witnesses(W.traffic.racers[0]), true);
  c.s = 1075.01; c.cop.sees = true; assert.equal(W.police.witnesses(W.traffic.racers[0]), false);
  step(W, 4); assert.equal(W.police.hm.heat, 0);
});
test('real LOS checks hills and walls even within 25 m and on the road', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); const c = W.police.spawnCop(1020, 1);
  W.traffic.ground = { at: () => ({ y: 4 }), walls: () => null };
  assert.equal(W.police.los(c, W.traffic.racers[0]), false);
  W.traffic.ground.at = () => ({ y: 0 }); W.traffic.ground.walls = () => ({ collider: true });
  assert.equal(W.police.los(c, W.traffic.racers[0]), false);
  step(W, 4); assert.equal(W.police.hm.heat, 0);
});
test('continued witnessed speeding takes 20 more seconds to the second star', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); W.police.spawnCop(1060, 1);
  step(W, 12.5, {}, 1 / 60); assert.equal(W.police.hm.level, 1);
  step(W, 19, {}, 1 / 60); assert.equal(W.police.hm.level, 1);
  step(W, 1, {}, 1 / 60); assert.equal(W.police.hm.level, 2);
});
test('a witnessed minor bump follows with lights, no reinforcements; stopping releases', t => {
  const W = fixture(t); W.player(1000, 2, 45 / 3.6); const c = W.police.spawnCop(1003, 1);
  step(W, 1 / 60, { events: [{ who: 'player', kind: 'bump', car: {} }] }, 1 / 60);
  assert.equal(W.police.hm.state, 'warning'); assert.equal(W.police.hm.level, 0);
  assert.equal(c.cop.siren, true); assert.equal(c.cop.chase, true);
  W.player(1000, 2, 0); step(W, HEAT.complyTime + .1);
  assert.equal(W.police.hm.state, 'idle'); assert.equal(c.cop.chase, false);
  assert.equal(W.police.cops.length, 1);
});
test('one scrape over many frames counts once, police PIT is not your offence', t => {
  const W = fixture(t); W.player(1000, 2, 45 / 3.6); const c = W.police.spawnCop(1003, 1), car = {};
  step(W, .5, { events: [{ who: 'player', kind: 'bump', car }] }, 1 / 60);
  assert.ok(Math.abs(W.police.hm.heat - .15) < 1e-6);
  W.police.hm.begin(2); W.police.hm.drain(); c.cop.tactic = 'pit'; c.cop.tacT = 10; const h = W.police.hm.heat;
  step(W, .1, { events: [{ who: 'player', kind: 'crash', car: c }] }, 1 / 60);
  assert.equal(W.police.hm.heat, h);
});
test('reset clears pedestrian/stop-line queues and warning counters', t => {
  const W = fixture(t); W.player(1000, 2, 0); W.police.spawnCop(1003, 1);
  W.police.witnessedRed(W.traffic.racers[0]); W.police.pedEvents([{ who: 'player', kind: 'dive' }]);
  W.police.reset(true); step(W, .1); assert.equal(W.police.hm.heat, 0); assert.equal(W.police.pending.length, 0);
});
test('map plans use real junction anchors, at most two roaming patrols and kilometre gaps', () => {
  const route = { length: 10988, curv: () => 0 };
  const data = JSON.parse(readFileSync(new URL('../data/map.json', import.meta.url)));
  const plan = patrolPlan(route, data, [{ s: 230 }, { s: 4650 }]);
  assert.equal(plan.find(p => p.id === 'vouliagmeni-junction').s, 230);
  assert.equal(plan.find(p => p.id === 'varkiza-junction').s, 4650);
  assert.equal(plan.filter(p => !p.fixed).length, 1); assert.equal(plan.length, 4);
  const fixed = plan.filter(p => p.fixed).map(p => p.s).sort((a,b) => a-b);
  assert.ok(fixed[1] - fixed[0] > 3000 && fixed[2] - fixed[1] > 800);
  const penteli = JSON.parse(readFileSync(new URL('../data/maps/penteli/map.json', import.meta.url)));
  const village = patrolPlan({ ...route, length: 10480 }, penteli);
  assert.equal(village.length, 2); assert.equal(village[0].id, 'dionysos-village');
});
test('fixed sites stream at their coordinates, not ahead of the player, and roam count stays bounded', t => {
  const W = fixture(t); W.traffic.data = { marks: [{id:'astir',s:545},{id:'lake',s:864},{id:'varkiza',s:4622}] };
  W.police.reset(true); W.player(2000, 2, 45 / 3.6); step(W, .1);
  assert.equal(W.police.cops.filter(c => c.mode === 'parked').length, 0);
  W.player(4500, 2, 45 / 3.6); step(W, .1);
  assert.equal(W.police.cops.find(c => c.cop.station === 'varkiza-junction').s, 4622);
  W.player(8000, 2, 45 / 3.6); step(W, 10);
  assert.equal(W.police.cops.filter(c => c.mode === 'parked').length, 0);
  assert.equal(W.police.cops.length, 1);
});

test('a police scrape itself identifies the officer even when visibility is blocked', t => {
  const W = fixture(t); W.player(1000, 2, 45 / 3.6); const c = W.police.spawnCop(1003, 1);
  W.police.los = () => false;
  step(W, 1 / 60, { events: [{ who: 'player', kind: 'bump', car: c }] }, 1 / 60);
  assert.equal(W.police.hm.state, 'warning'); assert.equal(W.police.hm.level, 0); assert.equal(c.cop.siren, true);
});
test('a minor contact never reduces existing suspicion; a witnessed severe impact is serious', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); W.police.spawnCop(1060, 1);
  step(W, 12.4, {}, 1 / 60); const heat = W.police.hm.heat;
  W.police.hm.offence('bump', .15, true); assert.ok(W.police.hm.heat >= heat); assert.equal(W.police.hm.level, 0);
  step(W, 1 / 60, { events: [{ who: 'player', kind: 'crash', car: {}, dv: 9 }] }, 1 / 60);
  assert.equal(W.police.hm.level, 1); assert.equal(W.police.hm.state, 'pursuit');
});
