// Headless tests of the police (src/police.js): the heat / pursuit state machine (offences, stars, escalation,
// cooldown -> EVADED, slow next to a unit -> BUSTED, takedowns; no points or money anywhere) and the Police runtime against a stub traffic /
// route (witnessed vs camera offences, line of sight range, the busted / evaded flow, the hook events it emits).
//   node --test tools/police-test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HeatMachine, HEAT, levelOf, Police, pursuit } from '../src/police.js';
import { events } from '../src/events.js';

const run = (hm, secs, s, dt = 1 / 60) => { const out = []; for (let t = 0; t < secs; t += dt) out.push(...hm.update(dt, s)); return out; };
const phases = (out) => out.map((e) => e.phase);

test('stars from heat', () => {
  assert.equal(levelOf(0), 0); assert.equal(levelOf(0.2), 0); assert.equal(levelOf(1.0), 1); assert.equal(levelOf(2), 2); assert.equal(levelOf(3.5), 3); assert.equal(levelOf(5), 5);
});

test('unwitnessed offences do nothing; minor witnesses warn before continued offences build a star', () => {
  const hm = new HeatMachine();
  hm.offence('camera', 0.4, false);
  assert.equal(hm.heat, 0); assert.equal(hm.state, 'idle'); assert.deepEqual(hm.drain(), []);
  hm.offence('red', 0.3, true);
  assert.equal(hm.state, 'warning'); assert.equal(hm.level, 0); assert.deepEqual(phases(hm.drain()), ['warning']);
  hm.offence('speeding', 0.7, true, { continuous: true });
  assert.equal(hm.state, 'pursuit'); assert.equal(hm.level, 1); assert.deepEqual(phases(hm.drain()), ['start', 'heat']);
  hm.offence('crash', 0.6, true); assert.equal(hm.level, 1);
  hm.offence('x', 99, true); assert.equal(hm.heat, 5);
});

test('a lawful pursuit never escalates just because time passes', () => {
  const hm = new HeatMachine(); hm.begin(1.2); hm.drain();
  run(hm, 90, { seen: true, copNear: false, slow: false });
  assert.equal(hm.state, 'pursuit'); assert.equal(hm.heat, 1.2); assert.equal(hm.level, 1);
});

test('a warning can be complied with; fleeing for six seconds gives one star', () => {
  const hm = new HeatMachine(); hm.offence('bump', .15, true); hm.drain();
  const out = run(hm, HEAT.complyTime + .1, { seen: true, copNear: true, slow: true });
  assert.ok(phases(out).includes('released')); assert.equal(hm.state, 'idle'); assert.equal(hm.heat, 0);
  hm.offence('red', .3, true); hm.drain();
  run(hm, 5.9, { seen: true, fleeing: true }); assert.equal(hm.level, 0);
  const fled = run(hm, .2, { seen: true, fleeing: true });
  assert.ok(fled.some(e => e.phase === 'start' && e.kind === 'fleeing')); assert.equal(hm.level, 1);
});

test('losing sight -> cooldown -> EVADED after the heat-scaled time, heat cleared, bonus paid', () => {
  const hm = new HeatMachine(); hm.begin(3); hm.drain(); // exactly 3 stars
  run(hm, 1, { seen: true });
  let out = run(hm, HEAT.lostAfter + 0.1, { seen: false });
  assert.deepEqual(phases(out), ['cooldown']);
  const need = HEAT.evadeBase + HEAT.evadePerLevel * 3;
  out = run(hm, need - 0.5, { seen: false });
  assert.equal(hm.state, 'cooldown'); assert.ok(hm.evade > 0.9 && hm.evade < 1);
  out = run(hm, 1, { seen: false });
  assert.deepEqual(phases(out), ['evaded']);
  assert.equal(hm.state, 'idle'); assert.equal(hm.heat, 0); assert.equal(hm.level, 0);
  assert.equal(out[0].level, 3); assert.ok(out[0].time > need, 'reports how long the pursuit lasted');
  assert.equal(out[0].pts, undefined, 'no points');
});

test('spotted again during the cooldown -> back in pursuit, evade meter halved', () => {
  const hm = new HeatMachine(); hm.begin(1); hm.drain();
  run(hm, HEAT.lostAfter + 3, { seen: false });
  assert.equal(hm.state, 'cooldown');
  const e = hm.evade;
  const out = run(hm, 0.1, { seen: true });
  assert.deepEqual(phases(out), ['resume']); assert.equal(hm.state, 'pursuit');
  assert.ok(Math.abs(hm.evade - e * 0.5) < 0.05);
});

test('BUSTED: slow with a unit on you for bustTime; moving off drains the meter', () => {
  const hm = new HeatMachine(); hm.begin(1.5); hm.drain();
  run(hm, HEAT.bustTime * 0.6, { seen: true, copNear: true, slow: true });
  assert.ok(hm.bust > 0.55 && hm.bust < 0.65);
  run(hm, 0.5, { seen: true, copNear: true, slow: false }); // got moving: drains
  assert.ok(hm.bust < 0.35);
  run(hm, 0.5, { seen: true, copNear: false, slow: true }); // slow but nobody on you
  assert.ok(hm.bust < 0.05);
  const out = run(hm, HEAT.bustTime + 0.1, { seen: true, copNear: true, slow: true });
  assert.deepEqual(phases(out), ['busted']);
  assert.equal(out[0].pts, undefined); assert.equal(hm.fine, undefined, 'no fines');
  assert.equal(hm.state, 'idle'); assert.equal(hm.heat, 0);
});

test('no bust meter outside a pursuit; takedowns add heat (no points)', () => {
  const hm = new HeatMachine();
  run(hm, 5, { seen: true, copNear: true, slow: true });
  assert.equal(hm.bust, 0); assert.equal(hm.state, 'idle');
  hm.begin(2); hm.drain();
  assert.equal(hm.takedown(), undefined); assert.ok(Math.abs(hm.heat - 2.6) < 1e-9);
  assert.deepEqual(phases(hm.drain()), ['takedown']);
});

// ------------------------------------------------------------------ the runtime against a stub world
import { world, step } from './police-fixture.mjs';

test('runtime: off unless enabled; four seconds of witnessed speeding starts pursuit; events emitted', () => {
  const W = world(); W.player(1000, 1.9, 30);
  assert.deepEqual(step(W, 1), []); assert.equal(pursuit.state, 'off');
  W.police.reset(true);
  const cop = W.police.spawnCop(1060, -1); assert.ok(cop && cop.cop && cop.active);
  const seen = [], scores = [];
  const off1 = events.on('pursuit', (p) => seen.push(p.phase)), off2 = events.on('score', (p) => scores.push(p));
  W.player(1000, 1.9, 13); // 47 km/h in a 50: legal
  step(W, 2);
  assert.equal(W.police.hm.state, 'idle'); assert.equal(W.police.hm.heat, 0);
  W.player(1000, 1.9, 30); // 108 km/h in a 50
  step(W, 1.5);
  assert.equal(W.police.hm.state, 'warning'); assert.equal(W.police.hm.level, 0);
  step(W, 2.5);
  assert.equal(W.police.hm.state, 'pursuit'); assert.ok(W.police.hm.level >= 1);
  assert.ok(seen.includes('start')); assert.equal(pursuit.state, 'pursuit');
  assert.ok(cop.cop.chase && cop.cop.siren, 'the witness joins the chase');
  off1(); off2();
  assert.equal(scores.length, 0, 'the police never emit score');
});

test('runtime: no cops, red/camera counters and trap events never build heat', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 120 / 3.6);
  step(W, 60, { reds: 0 }); events.emit('trap', { kmh: 120 });
  step(W, .1, { reds: 10 });
  assert.equal(W.police.hm.heat, 0); assert.equal(W.police.hm.state, 'idle');
});

test('runtime: stopped next to a chasing unit -> BUSTED (no score event, everyone stands down)', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 0);
  W.police.hm.begin(1.5);
  step(W, 0.05);
  const cops = W.traffic.cars.filter((c) => c.active && c.cop && c.cop.chase);
  assert.ok(cops.length >= 1);
  const c = cops[0]; c.s = 1003; c.u = 1.9; c.dir = 1; c.v = 0; // right on your bumper (and it stays there)
  const scores = []; const off = events.on('score', (p) => scores.push(p));
  const out = step(W, HEAT.bustTime + 0.5, {}, 1 / 30, () => { c.s = 1003; c.u = 1.9; c.v = 0; });
  off();
  assert.ok(out.some((e) => e.phase === 'busted'), JSON.stringify(out.map((e) => e.phase)));
  assert.equal(scores.length, 0, 'no fines / score events');
  assert.equal(W.police.hm.state, 'idle');
  assert.ok(W.traffic.cars.every((q) => !q.cop || !q.cop.chase), 'stood down');
});

test('runtime: out of sight -> EVADED (no score event)', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 40);
  W.police.hm.begin(0.5);
  step(W, 0.05);
  for (const c of W.traffic.cars) if (c.active) { c.s = 600; c.dir = 1; } // the units are 400 m back (out of range)
  const scores = []; const off = events.on('score', (p) => scores.push(p));
  const out = step(W, HEAT.lostAfter + HEAT.evadeBase + HEAT.evadePerLevel + 1, {}, 1 / 30, () => { for (const c of W.traffic.cars) if (c.active && c.cop) { c.s = 600; c.crash = null; } });
  off();
  assert.ok(out.some((e) => e.phase === 'cooldown'));
  assert.ok(out.some((e) => e.phase === 'evaded'), JSON.stringify(out.map((e) => e.phase)));
  assert.equal(scores.length, 0, 'no bounty / score events');
  assert.equal(W.police.hm.heat, 0);
});

test('runtime: wrecking a chasing unit is a takedown', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 30);
  W.police.hm.begin(1.2);
  step(W, 0.05);
  const c = W.traffic.cars.find((q) => q.active && q.cop && q.cop.chase);
  c.crash = { wreck: true, t: 0 };
  assert.equal(step(W, 0.05).filter((e) => e.phase === 'takedown').length, 0, 'wrecked without you: no takedown');
  const c2 = W.traffic.cars.find((q) => q.active && q.cop && q.cop.chase && !q.crash) || W.police.spawnCop(990, 1);
  W.police.enlist(c2);
  step(W, 0.05, { events: [{ who: 'player', car: c2, kind: 'crash' }] });
  c2.crash = { wreck: true, t: 0 };
  const out = step(W, 0.05);
  assert.ok(out.some((e) => e.phase === 'takedown'));
  assert.ok(c.cop.down && c2.cop.down);
  assert.equal(step(W, 0.2).filter((e) => e.phase === 'takedown').length, 0, 'counted once');
});

test('runtime: the posted limit comes from the map', () => {
  const W = world();
  assert.equal(W.police.limitAt(100), 50); assert.equal(W.police.limitAt(6000), 70);
});

test('runtime: a full police pool recycles a distant wreck for the next unit', () => {
  const W = world(); W.police.reset(true); W.player(5000, 1.9, 30);
  for (const c of W.traffic.cars) { Object.assign(c, { active: true, s: 3000, u: 2, dir: 1 }); c.cop = { chase: false, block: null, down: true }; c.crash = { wreck: true, t: 9 }; }
  W.police.P = W.traffic.racers[0]; // set by update() in the game
  const c = W.police.spawnCop(4800, 1);
  assert.ok(c && c.active && c.cop && !c.cop.down && !c.crash, 'recycled into a fresh unit');
});

test('a closed circuit never has police, whatever asks for them', () => {
  const W = world(); W.route.closed = true; W.player(1000, 1.9, 60);
  W.police.reset(true);
  assert.equal(W.police.enabled, false);
  assert.equal(W.police.spawnCop(1100, -1), null);
  assert.deepEqual(step(W, 1), []); assert.equal(pursuit.state, 'off');
});

test('free-roam mode wiring explicitly enables patrols on a circuit map', () => {
  const W = world(); W.route.closed = true; W.traffic.allowClosedRoam = true;
  W.police.reset(true); assert.equal(W.police.enabled, true);
  assert.ok(W.police.spawnCop(1100, 1));
  W.police.reset(false);
});

test('explicit Police On setup enables circuit patrols and accepts unwrapped race-lap progress', () => {
  const W = world(); W.route.closed = true;
  events.emit('start', { eventId: 'track-with-police', type: 'sprint', def: { type: 'sprint', rules: { police: true } } });
  assert.equal(W.police.enabled, true); assert.equal(W.traffic.allowClosedPolice, true);
  assert.ok(W.police.spawnCop(W.route.length + 100, 1));
  W.police.reset(false); assert.equal(W.traffic.allowClosedPolice, false);
});
