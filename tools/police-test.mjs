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

test('a warning can be complied with; fleeing for ten seconds gives one star', () => {
  const hm = new HeatMachine(); hm.offence('bump', .15, true); hm.drain();
  const out = run(hm, HEAT.complyTime + .1, { seen: true, copNear: true, slow: true });
  assert.ok(phases(out).includes('released')); assert.equal(hm.state, 'idle'); assert.equal(hm.heat, 0);
  hm.offence('red', .3, true); assert.equal(hm.state, 'idle', 'released: minor offences ignored in the quiet spell'); hm.drain();
  run(hm, HEAT.quietAfter * .5 + .1, { seen: false });
  hm.offence('red', .3, true); hm.drain(); assert.equal(hm.state, 'warning');
  run(hm, HEAT.fleeAfter - .1, { seen: true, fleeing: true }); assert.equal(hm.level, 0);
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

test('BUSTED: only in an established pursuit, slow with a unit on you for bustTime; moving off drains the meter', () => {
  const hm = new HeatMachine(); hm.begin(1.5); hm.drain();
  run(hm, HEAT.bustAfter - 0.2, { seen: true, copNear: true, slow: true });
  assert.equal(hm.bust, 0, 'a unit that just caught up cannot bust you');
  run(hm, 0.2 + HEAT.bustTime * 0.6, { seen: true, copNear: true, slow: true });
  assert.ok(hm.bust > 0.55 && hm.bust < 0.65, hm.bust);
  run(hm, 0.3, { seen: true, copNear: true, slow: false }); // got moving: drains
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
import { world, step, drive } from './police-fixture.mjs';

test('runtime: off unless enabled; five seconds of witnessed flagrant speeding starts pursuit; events emitted', () => {
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
  step(W, 2.3); assert.equal(W.police.hm.level, 0, 'not yet sustained');
  step(W, 1.3);
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
  const pin = () => { c.s = 1003; c.u = 1.9; c.v = 0; };
  assert.ok(!step(W, HEAT.bustAfter - 0.5, {}, 1 / 30, pin).some(e => e.phase === 'busted'), 'no bust in the first seconds of a chase');
  const out = step(W, HEAT.bustTime + 1, {}, 1 / 30, pin);
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

test('runtime: a little over the limit past a unit is tolerated; +35 km/h past it is only a warning', () => {
  const W = world(); W.police.reset(true); const cop = W.police.spawnCop(1000, 1); cop.mode = 'parked'; cop.v = 0;
  W.player(900, 1.9, 75 / 3.6); // +25 in a 50, drives right past the unit
  step(W, 10, {}, 1 / 30, dt => { W.traffic.racers[0].s += 75 / 3.6 * dt; cop.s = 1000; });
  assert.equal(W.police.hm.state, 'idle'); assert.equal(W.police.hm.heat, 0);
  W.police.reset(true); const c2 = W.police.spawnCop(1000, 1); c2.mode = 'parked';
  W.player(900, 1.9, 85 / 3.6); // +35: seen for ~150 m either side of the unit
  step(W, 12, {}, 1 / 30, dt => { W.traffic.racers[0].s += 85 / 3.6 * dt; c2.s = 1000; c2.v = 0; });
  assert.equal(W.police.hm.level, 0, 'a drive-past never gives a star');
  assert.notEqual(W.police.hm.state, 'pursuit');
  W.police.reset(false); W.police.offs.forEach(off => off());
});

test('runtime: boxed in by two units busts faster than one; the cooldown never busts', () => {
  const hm = new HeatMachine(); hm.begin(2); hm.drain();
  run(hm, HEAT.bustAfter, { seen: true });
  const t1 = run(hm, HEAT.boxedBustTime + 0.1, { seen: true, copNear: true, copsNear: 2, slow: true });
  assert.ok(t1.some(e => e.phase === 'busted'));
  hm.begin(2); hm.drain(); run(hm, HEAT.bustAfter, { seen: true });
  assert.ok(!run(hm, HEAT.boxedBustTime + 0.1, { seen: true, copNear: true, copsNear: 1, slow: true }).some(e => e.phase === 'busted'));
  hm.begin(2); hm.drain(); run(hm, HEAT.bustAfter, { seen: true }); run(hm, HEAT.lostAfter + .1, { seen: false });
  assert.equal(hm.state, 'cooldown');
  run(hm, 1, { seen: false, copNear: true, slow: true }); assert.equal(hm.bust, 0);
});

test('runtime: after a bust the police stay quiet and patrols do not respawn next to you', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 0);
  W.police.hm.begin(1); step(W, 0.05);
  const c = W.traffic.cars.find(q => q.active && q.cop?.chase); const pin = () => { c.s = 1003; c.u = 1.9; c.v = 0; };
  const out = step(W, HEAT.bustAfter + HEAT.bustTime + 0.5, {}, 1 / 30, pin);
  assert.ok(out.some(e => e.phase === 'busted'));
  W.player(1000, 1.9, 30); // flooring it straight away in front of the same unit
  step(W, 6, {}, 1 / 30, pin);
  assert.equal(W.police.hm.state, 'idle', 'minor offences ignored in the quiet spell');
});

test('runtime: reinforcements are capped, slow and never spawn in view ahead', () => {
  const W = world(); W.police.reset(true); W.player(5000, 1.9, 30);
  W.police.rng = { next: () => 0.1, range: (a, b) => a, chance: () => true, int: (a) => a };
  W.police.hm.begin(5); const spawned = [];
  const spawn = W.police.spawnCop.bind(W.police); W.police.spawnCop = (s, ...a) => { spawned.push(s); return spawn(s, ...a); };
  step(W, 60, {}, 1 / 30, dt => { W.traffic.racers[0].s += 30 * dt; for (const q of W.traffic.cars) if (q.cop?.chase && q.active) q.s = W.traffic.racers[0].s - 40; });
  const chasing = W.traffic.cars.filter(q => q.active && q.cop?.chase && !q.cop.block).length;
  assert.ok(chasing <= HEAT.maxChasers, `chasing ${chasing}`);
  assert.ok(spawned.length <= 6, `spawned ${spawned.length} in a minute`);
  // headless LOS is always clear, so every reinforcement came from behind
  assert.ok(spawned.every((s, i) => s < 5000 + 30 * 60), JSON.stringify(spawned));
  W.police.reset(false); W.police.offs.forEach(off => off());
});

test('runtime: no PIT, box or ram in a warning, at one star, or early in a two-star chase', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 13); // 47 km/h: no further offences, so no escalation
  W.police.rng = { next: () => 0.5, range: (a, b) => (a + b) / 2, chance: () => false, int: (a) => a };
  const units = () => W.traffic.cars.filter(q => q.active && q.cop?.chase);
  const contact = () => units().filter(q => ['pit', 'ram', 'box'].includes(q.cop.tactic));
  const follow = dt => { const P = W.traffic.racers[0]; P.s += 13 * dt; units().forEach((q, i) => { q.s = P.s - 8 - i * 6; q.dir = 1; }); };
  // a warning: lights and following only
  W.police.spawnCop(1010, 1); W.police.hm.offence('red', .3, true); step(W, .05);
  assert.equal(W.police.hm.state, 'warning');
  for (let i = 0; i < 60; i++) { step(W, .1, {}, 1 / 30, follow); assert.equal(contact().length, 0, 'warning'); }
  // one star, a long time: still only tailing
  W.police.hm.begin(1); step(W, .05);
  for (let i = 0; i < 400; i++) { step(W, .1, {}, 1 / 30, follow); assert.equal(contact().length, 0, `one star, ${i / 10} s`); }
  // two stars: nothing in the first contactAfter seconds, a PIT once the chase is established
  W.police.hm.begin(2); step(W, .05);
  let first = null;
  for (let i = 0; i < 300 && first === null; i++) { step(W, .1, {}, 1 / 30, follow); if (contact().length) first = W.police.hm.time; }
  assert.ok(first !== null && first >= HEAT.contactAfter - 1e-6, `first contact at ${first}`);
  // a stale PIT tactic is never driven once the pursuit drops into the cooldown
  const c = units()[0]; c.cop.tactic = 'pit'; W.police.hm.state = 'cooldown';
  assert.equal(W.police.contactAllowed(), false);
  W.police.reset(false); W.police.offs.forEach(off => off());
});

// ------------------------------------------------------------------ organic play: units driven by driveCop
const parkedUnit = (W, s) => { const c = W.police.spawnCop(s, 1); c.mode = 'parked'; c.parkT = 1e9; c.v = 0; c.cop.keep = true; return c; };
const cruise = (W, kmh) => dt => { W.traffic.racers[0].s += kmh / 3.6 * dt; };

test('organic: blasting past a parked unit (even at 140 in a 50) warns, it follows with lights, and speeding on becomes a pursuit', () => {
  for (const kmh of [88, 110, 140]) {
    const W = world(); W.police.reset(true); const cop = parkedUnit(W, 1000);
    W.player(800, 1.9, kmh / 3.6);
    let warnAt = null, startAt = null, t = 0, maxGap = 0;
    const out = drive(W, 40, {}, 1 / 30, dt => {
      cruise(W, kmh)(dt); t += dt;
      if (warnAt === null && W.police.hm.state === 'warning') warnAt = t;
      if (warnAt !== null && startAt === null) maxGap = Math.max(maxGap, W.traffic.racers[0].s - cop.s);
      if (startAt === null && W.police.hm.state === 'pursuit') startAt = t;
    });
    assert.ok(warnAt !== null, `${kmh}: warned`);
    assert.ok(startAt !== null && startAt - warnAt <= 12, `${kmh}: pursuit ${startAt} after the warning at ${warnAt}`);
    assert.ok(maxGap < 170, `${kmh}: the following unit kept you in view (max gap ${maxGap})`);
    assert.ok(out.some(e => e.phase === 'start') && cop.cop.chase && W.police.hm.level >= 1);
    assert.ok(W.traffic.racers[0].s - cop.s < 40, `${kmh}: the unit is on your tail (${W.traffic.racers[0].s - cop.s} m)`);
    W.police.reset(false); W.police.offs.forEach(off => off());
  }
});

test('organic: slowing to the limit after a drive-past warning is a release, not a chase', () => {
  const W = world(); W.police.reset(true); parkedUnit(W, 1000); W.player(800, 1.9, 88 / 3.6);
  let v = 88;
  const out = drive(W, 40, {}, 1 / 30, dt => { if (W.police.hm.state === 'warning') v = 48; W.traffic.racers[0].vs = v / 3.6; cruise(W, v)(dt); });
  assert.ok(out.some(e => e.phase === 'warning') && out.some(e => e.phase === 'released'), JSON.stringify(out.map(e => e.phase)));
  assert.ok(!out.some(e => e.phase === 'start'));
  W.police.reset(false); W.police.offs.forEach(off => off());
});

test('organic: a pursuit has a unit closing on you within 4 s and reinforcements on the reinforcement clock', () => {
  const W = world(); W.police.reset(true); W.player(2000, 1.9, 30);
  W.police.rng = { next: () => 0.5, range: (a, b) => (a + b) / 2, chance: () => false, int: (a) => a };
  W.police.hm.begin(2); // no unit anywhere near: the first one comes from behind
  const gaps = [], firstAt = { chase: null, near: null }; let t = 0;
  drive(W, 30, {}, 1 / 30, dt => {
    cruise(W, 108)(dt); t += dt;
    const P = W.traffic.racers[0], units = W.traffic.cars.filter(c => c.active && c.cop?.chase);
    if (units.length && firstAt.chase === null) firstAt.chase = t;
    const g = Math.min(...units.map(c => P.s - c.s));
    if (Math.abs(t % 1) < dt) gaps.push(Math.round(g));
    if (g < HEAT.witnessRange && firstAt.near === null) firstAt.near = t;
  });
  assert.ok(firstAt.chase !== null && firstAt.chase < 0.1, `a unit is assigned at once (${firstAt.chase})`);
  assert.ok(gaps[4] < gaps[0] - 40, `closing within 4 s: ${gaps}`);
  assert.ok(firstAt.near !== null && firstAt.near < 15, `in sight within 15 s (${firstAt.near}): ${gaps}`);
  assert.ok(W.traffic.cars.filter(c => c.active && c.cop?.chase).length === 2, 'a second unit by 30 s at two stars');
  W.police.reset(false); W.police.offs.forEach(off => off());
});

test('organic: a pursuit that starts by crashing into the unit following you still gets a unit after you at once', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 25);
  const cop = W.police.spawnCop(1010, 1); cop.v = 20; W.police.enlist(cop); // following you with lights
  cop.crash = { wreck: false, t: 0 }; // traffic.collide spun it (not a wreck) before the police see the crash
  W.police.update(1 / 30, { racing: true, dir: 1, events: [{ who: 'player', car: cop, kind: 'crash' }] });
  const fresh = W.traffic.cars.filter(c => c.active && c.cop?.chase && !c.crash);
  assert.equal(W.police.hm.state, 'pursuit'); assert.ok(fresh.length >= 1, 'a unit that can drive is chasing');
  W.police.reset(false); W.police.offs.forEach(off => off());
});

test('organic: a unit that warns you from the kerb ahead never pulls across you; it lets you by and falls in behind', () => {
  for (const kmh of [60, 90, 140]) {
    const W = world(); W.police.reset(true); const cop = parkedUnit(W, 1000); cop.u = 5.2;
    W.player(940, 1.9, kmh / 3.6); W.police.hm.offence('red', 0.3, true); // warned while it is still ahead of you
    let minClear = Infinity;
    drive(W, 8, {}, 1 / 60, dt => {
      const P = W.traffic.racers[0]; P.s += kmh / 3.6 * dt;
      if (Math.abs(P.s - cop.s) < P.hs + cop.len / 2) minClear = Math.min(minClear, Math.abs(P.u - cop.u) - (P.hu + cop.wid / 2));
    });
    assert.ok(minClear > 0.5, `${kmh}: ${minClear} m side clearance while alongside`);
    if (kmh > 80) assert.ok(cop.cop.chase && W.traffic.racers[0].s - cop.s > 0, `${kmh}: still speeding: following, behind you`);
    W.police.reset(false); W.police.offs.forEach(off => off());
  }
});

test('organic: stopping for a warning brings the unit up behind you and you are released for complying', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 0);
  const cop = W.police.spawnCop(970, 1); cop.v = 12;
  W.police.hm.offence('speeding', 0.9, true, { continuous: true, sustained: false }); // a warning at high suspicion
  let t = 0, at = null;
  drive(W, 12, {}, 1 / 30, dt => { t += dt; if (at === null && W.police.hm.state === 'idle') at = t; });
  // lawful driving alone would take warningGrace + 0.9 / suspicionDecay = 7.5 s to drain it
  assert.ok(at !== null && at < HEAT.warningGrace + 0.9 / HEAT.suspicionDecay - 1, `released at ${at}`);
  assert.ok(Math.abs(W.traffic.racers[0].s - cop.s) < HEAT.bustDist || !cop.cop.chase);
  W.police.reset(false); W.police.offs.forEach(off => off());
});

test('organic: stopping in a one-star pursuit is an arrest once the chase is established (the unit pulls up to you)', () => {
  const W = world(); W.police.reset(true); W.player(1000, 1.9, 0);
  const cop = W.police.spawnCop(960, 1); cop.v = 15; W.police.enlist(cop);
  W.police.hm.begin(1);
  const out = drive(W, HEAT.bustAfter + HEAT.bustTime + 4);
  assert.ok(out.some(e => e.phase === 'busted'), JSON.stringify(out.map(e => e.phase)));
  W.police.reset(false); W.police.offs.forEach(off => off());
});
