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
test('speed observation is consecutive; a brief sighting decays out of sight', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); const c = W.police.spawnCop(1060, 1);
  step(W, .9); assert.equal(W.police.hm.state, 'idle'); const heat = W.police.hm.heat; assert.ok(heat > 0);
  c.s = 1300; step(W, 1); assert.ok(W.police.hm.heat < heat); assert.equal(W.police.speedT, 0);
  c.s = 1060; step(W, .9); assert.equal(W.police.hm.level, 0);
  c.s = 1300; step(W, 8); assert.equal(W.police.hm.heat, 0); assert.equal(W.police.hm.state, 'idle');
});
test('witness range boundaries are inclusive at the witness range, checked fresh for each offence', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); const c = W.police.spawnCop(1000, 1); c.u = 2;
  c.s = 1000 + HEAT.witnessRange; assert.equal(W.police.witnesses(W.traffic.racers[0]), true);
  c.s = 1000 + HEAT.witnessRange + .01; c.cop.sees = true; assert.equal(W.police.witnesses(W.traffic.racers[0]), false);
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
test('fleeing in sight of a unit takes ~25 more seconds to the second star', t => {
  const W = fixture(t); W.player(1000, 2, 90 / 3.6); W.police.spawnCop(1060, 1);
  step(W, 4.6, {}, 1 / 60); assert.equal(W.police.hm.level, 1);
  step(W, 24.4, {}, 1 / 60); assert.equal(W.police.hm.level, 1);
  step(W, 1.2, {}, 1 / 60); assert.equal(W.police.hm.level, 2);
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
test('map plans use real junction anchors, at most two roaming patrols, none at a start grid, a unit every few km', () => {
  const route = { length: 10988, curv: () => 0 };
  const data = JSON.parse(readFileSync(new URL('../data/map.json', import.meta.url)));
  const plan = patrolPlan(route, data, [{ s: 230 }, { s: 2400 }, { s: 4650 }, { s: 7507 }]);
  assert.equal(plan.find(p => p.id === 'varkiza-junction').s, 4650); assert.equal(plan.find(p => p.id === 'limanakia').s, 2400);
  assert.ok(plan.filter(p => !p.fixed).length <= 2); assert.equal(plan.length, 5);
  const ends = (plan, a, b) => { const all = [a, ...plan.map(p => p.s).sort((x, y) => x - y), b]; return Math.max(...all.slice(1).map((s, i) => s - all[i])); };
  assert.ok(plan.filter(p => p.fixed).every(p => Math.abs(p.s - 241) > 1000 && Math.abs(p.s - 10548) > 1000), 'nobody parked at a grid');
  assert.ok(ends(plan, 241, 10548) < 3300, 'a unit every ~3 km');
  const penteli = JSON.parse(readFileSync(new URL('../data/maps/penteli/map.json', import.meta.url)));
  const village = patrolPlan({ ...route, length: 10480 }, penteli);
  assert.equal(village.length, 4); assert.ok(village.filter(p => p.fixed).every(p => Math.abs(p.s - 292) > 1000));
  assert.ok(ends(village, 292, 10188) < 3300);
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
  step(W, 4.4, {}, 1 / 60); const heat = W.police.hm.heat; assert.equal(W.police.hm.level, 0);
  W.police.hm.offence('bump', .15, true); assert.ok(W.police.hm.heat >= heat); assert.equal(W.police.hm.level, 0);
  step(W, 1 / 60, { events: [{ who: 'player', kind: 'crash', car: {}, dv: 9 }] }, 1 / 60);
  assert.equal(W.police.hm.level, 1); assert.equal(W.police.hm.state, 'pursuit');
});

test('speeding thresholds: +15 ignored; +25 warns within 1.5 s and stars in 4-5 s; +50 stars in 2-3 s', () => {
  assert.equal(measure({ trigger: '+15', kmh: 65, cop: 60 }).timeToWarning, null);
  const at25 = measure({ trigger: '+25', kmh: 75, cop: 60 }), at51 = measure({ trigger: '+51', kmh: 101, cop: 60 });
  assert.ok(at25.timeToWarning <= 1.5 && at25.timeToStar >= 4 && at25.timeToStar <= 5, JSON.stringify(at25));
  assert.ok(at51.timeToStar >= 2 && at51.timeToStar <= 3, JSON.stringify(at51));
  assert.ok(HEAT.witnessRange >= 120 && HEAT.witnessRange <= 150);
});

test('every road map meets a patrol within two minutes of race pace in either direction, none parked at a start grid', async () => {
  const { Route } = await import('../src/map.js');
  const { findJunctions } = await import('../src/signals.js');
  for (const file of ['../data/map.json', '../data/maps/penteli/map.json']) {
    const data = JSON.parse(readFileSync(new URL(file, import.meta.url))), route = new Route(data.route);
    const plan = patrolPlan(route, data, findJunctions({ route, data }));
    for (const [s0, dir] of [[route.start, 1], [route.finish, -1]]) {
      const units = plan.map(p => ({ ...p })); let s = s0, t = 0, met = null;
      while (t < 120 && met === null) { // race pace: 130 km/h, slower for bends; roaming units at ~50 km/h
        let kc = 0; for (let d = 0; d <= 80; d += 10) kc = Math.max(kc, Math.abs(route.curv(s + dir * d)));
        s += dir * Math.min(130 / 3.6, Math.sqrt(7 / Math.max(1e-4, kc))) * 0.25; t += 0.25;
        for (const u of units) {
          if (!u.fixed) u.s += u.dir * 13 * 0.25;
          const a = route.point(s, 0), b = route.point(u.s, 0);
          if (Math.hypot(a.x - b.x, a.z - b.z) < HEAT.witnessRange) { met = t; if (t < 15) assert.ok(!u.fixed, `${data.id}: ${u.id} at the grid`); }
        }
      }
      assert.ok(met !== null && met >= 15, `${data.id} from ${Math.round(s0)} (${dir}): first unit at ${met} s`);
    }
  }
});
