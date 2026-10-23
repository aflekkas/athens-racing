// Multiplayer police: the host's lobby config (POLICE level, CAN BE BUSTED) is the only switch. The units are part of
// the shared world: the world authority dispatches and drives them for every driver; every client judges only its own
// driver (heat, witnesses, bust) and reports it as a pursuit code in its state.
//   node --test tools/police-online.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { world, step, drive } from './police-fixture.mjs';
import { events } from '../src/events.js';
import { HEAT, encodePursuit, decodePursuit } from '../src/police.js';
import { validCarRow, copFlags, WORLD_CARS } from '../src/shared-world-protocol.js';
import { applySharedCar } from '../src/mp-shared-world.js';
import { validateStateExtras } from '../server/mp-lifecycle.mjs';

const lobby = (police, over = {}) => ({ raceId: 'race-7', generation: 3, eventId: 'quick', config: { police, time: 'afternoon', weather: 'clear', ...over }, event: { police } });
const done = W => { W.police.reset(false); W.police.offs.forEach(off => off()); };
const racer = (slot, s, vs, kind = 'remote') => ({ a: { slot }, kind, s, u: 1.9, vs, vu: 0, hs: 2.2, hu: 0.9 });
// a shared unit as a guest receives it: active, its cop state from the world frame
const sharedUnit = (W, s, cop = {}) => { const c = W.traffic.cars[0]; Object.assign(c, { active: true, s, u: 4, dir: 1, v: 0, uv: 0, crash: null, mode: 'parked' }); c.cop = { chase: false, siren: false, keep: true, target: null, tactic: 'tail', losT: 0, sees: false, ...cop }; return c; };

test('MP police are the host lobby setting, with its POLICE level and CAN BE BUSTED', t => {
  const W = world(); t.after(() => done(W));
  assert.equal(W.police.configureOnline(lobby(true, { policeLevel: 'tough', busted: false }), 2), true);
  assert.deepEqual([W.police.online.slot, W.police.C.level, W.police.C.canBust], [2, 'tough', false]);
  for (const l of [lobby(false), { raceId: 'r', generation: 1, config: {} }, null]) { assert.equal(W.police.configureOnline(l, 0), false); assert.equal(W.police.online, null); }
  // a solo race afterwards is solo again
  events.emit('start', { eventId: 'quick', type: 'sprint', def: { type: 'sprint', rules: { police: true } } });
  assert.equal(W.police.online, null); assert.equal(W.police.enabled, true);
});

test('pursuit codes carry state, stars and chase time in one small integer', () => {
  for (const [s, l, time] of [['idle', 0, 0], ['warning', 0, 3], ['pursuit', 2, 17], ['cooldown', 5, 80]]) assert.deepEqual(decodePursuit(encodePursuit(s, l, time)), { state: s, level: l, time });
  assert.ok(encodePursuit('cooldown', 5, 999) <= 2047); assert.deepEqual(decodePursuit(-4), { state: 'idle', level: 0, time: 0 });
  assert.equal(validateStateExtras({ pursuit: encodePursuit('pursuit', 3, 20) }).pursuit, 2 + 12 + 480);
  assert.equal(validateStateExtras({ pursuit: 5000 }).pursuit, undefined); assert.equal(validateStateExtras({ pursuit: 1.5 }).pursuit, undefined);
});

test('a guest judges only its own driver: speeding past a shared unit warns, then stars; it never moves or enlists units', t => {
  const W = world(); t.after(() => done(W));
  W.police.configureOnline(lobby(true), 1);
  const c = sharedUnit(W, 1060); W.player(1000, 1.9, 110 / 3.6);
  const out = step(W, 4);
  assert.deepEqual(out.filter(e => ['warning', 'start'].includes(e.phase)).map(e => e.phase), ['warning', 'start']);
  assert.equal(W.police.hm.state, 'pursuit'); assert.equal(decodePursuit(W.police.pursuitCode()).state, 'pursuit');
  assert.equal(c.cop.chase, false, 'the world authority enlists units, not the judge');
  assert.equal(W.traffic.cars.filter(q => q.active).length, 1, 'no unit spawned locally');
});

test('an arrest counts only units chasing this driver', t => {
  for (const [target, busts] of [[0, false], [1, true]]) {
    const W = world(); t.after(() => done(W));
    W.police.configureOnline(lobby(true), 1); W.player(1000, 1.9, 0);
    sharedUnit(W, 1003, { chase: true, siren: true, target }); W.traffic.cars[0].u = 1.9;
    W.police.hm.begin(1);
    const out = step(W, HEAT.bustAfter + HEAT.bustTime + 1);
    assert.equal(out.some(e => e.phase === 'busted'), busts, `unit after slot ${target}`);
  }
});

test('the world authority dispatches units per driver from their pursuit codes', t => {
  const W = world(); t.after(() => done(W));
  W.police.configureOnline(lobby(true), 0);
  const A = racer(0, 1000, 25, 'player'), B = racer(1, 4000, 25);
  const tick = (codes, secs = 0.5) => step(W, secs, {}, 1 / 30, dt => {
    A.s += A.vs * dt; B.s += B.vs * dt; W.traffic.racers = [A, B];
    for (const c of W.traffic.cars) if (c.active && c.cop?.chase && !c.crash) W.police.driveCop(c, dt);
    W.police.dispatch(dt, codes);
  });
  const unitB = W.police.spawnCop(4060, 1); unitB.mode = 'parked'; unitB.v = 0; unitB.cop.keep = true;
  tick([{ slot: 0, code: 0 }, { slot: 1, code: encodePursuit('warning') }]);
  assert.equal(unitB.cop.chase, true); assert.equal(unitB.cop.target, 1, 'the warning unit follows driver B');
  assert.ok(W.traffic.cars.every(c => !c.cop?.chase || c.cop.target === 1), 'nobody is after driver A');
  // driver A starts a pursuit far from any unit: one comes from behind at once
  tick([{ slot: 0, code: encodePursuit('pursuit', 1, 0) }, { slot: 1, code: encodePursuit('pursuit', 1, 0) }]);
  const unitA = W.traffic.cars.find(c => c.active && c.cop?.chase && c.cop.target === 0);
  assert.ok(unitA && A.s - unitA.s > 100 && A.s - unitA.s < 300, 'a unit behind driver A');
  // it drives after A (closing), and B's unit after B
  const gapA = A.s - unitA.s; tick([{ slot: 0, code: encodePursuit('pursuit', 1, 3) }, { slot: 1, code: encodePursuit('pursuit', 1, 3) }], 6);
  assert.ok(A.s - unitA.s < gapA - 40, `closing on A: ${gapA} -> ${A.s - unitA.s}`);
  assert.ok(Math.abs(B.s - unitB.s) < 80, 'B\'s unit stays on B');
  // contact only from two stars, 15 s in, judged from the driver's own code
  for (const c of W.traffic.cars) if (c.cop?.chase) { c.s = (c.cop.target === 0 ? A.s : B.s) - 8; c.cop.tacT = 0; }
  tick([{ slot: 0, code: encodePursuit('pursuit', 2, 10) }, { slot: 1, code: encodePursuit('pursuit', 1, 40) }], 0.1);
  assert.ok(W.traffic.cars.every(c => !['pit', 'box', 'ram'].includes(c.cop?.tactic)), 'no contact before 2 stars / 15 s');
  for (const c of W.traffic.cars) if (c.cop?.chase) { c.s = (c.cop.target === 0 ? A.s : B.s) - 8; c.cop.tacT = 0; }
  tick([{ slot: 0, code: encodePursuit('pursuit', 2, 16) }, { slot: 1, code: encodePursuit('pursuit', 1, 40) }], 0.1);
  assert.equal(unitA.cop.tactic, 'pit'); assert.notEqual(unitB.cop.tactic, 'pit');
  // B is arrested or gets away: B's units stand down; a driver who leaves: their units too
  tick([{ slot: 0, code: encodePursuit('pursuit', 2, 17) }, { slot: 1, code: 0 }]);
  assert.equal(unitB.cop.chase, false);
  tick([{ slot: 1, code: 0 }]);
  assert.ok(W.traffic.cars.every(c => !c.cop?.chase), 'driver A left: their unit stood down');
});

test('shared world rows carry police units: lights, chase and whom they chase', () => {
  const flags = 4 | copFlags({ siren: true, chase: true, target: 2 });
  const row = [WORLD_CARS + 1, 100000, 190, 2500, 0, 0, 0, 0, 0, 0, 0, 0, 1, flags, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.ok(validCarRow(row));
  assert.ok(!validCarRow([0, ...row.slice(1)]), 'ordinary traffic never carries police flags');
  assert.ok(!validCarRow([WORLD_CARS + 8, ...row.slice(1)]), 'beyond the police pool');
  const c = { id: WORLD_CARS + 1, police: true, active: false, len: 4.7, wid: 1.8, type: {}, m: { root: { visible: false } }, indL: {}, indR: {}, flash: {} };
  const traffic = { cars: Object.assign([], { [WORLD_CARS + 1]: c }), initDrive(q) { q.drv = { vf: 1 }; }, roadSpeed: () => 14 };
  applySharedCar(traffic, row, 0);
  assert.deepEqual([c.active, c.cop.siren, c.cop.chase, c.cop.target, c.s, c.mode], [true, true, true, 2, 1000, 'parked']);
  applySharedCar(traffic, [...row.slice(0, 13), 0, ...row.slice(14)], 0);
  assert.deepEqual([c.cop.siren, c.cop.chase, c.cop.target], [false, false, null], 'the same cop object, updated');
});

test('main and the shared world wire it: the judge runs online, the world authority dispatches', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.slice(main.indexOf('  start(lobby, id, resumeState = null) {'), main.indexOf('  remote(peers, dt) {'));
  assert.ok(start.indexOf('startOnlinePolice(lobby)') > start.indexOf('onlineWait()'), 'configured after onlineWait (which resets police)');
  assert.match(main, /function startOnlinePolice\(lobby\) \{ police\?\.configureOnline\(lobby, multiplayer\.me\?\.gridSlot \?\? 0\); \}/);
  assert.match(main, /if \(police\) for \(const e of police\.update\(/, 'the judge runs online too');
  const telemetry=main.split('\n').find(line=>line.startsWith('const networkState ='));
  assert.ok(telemetry,'test executes production networkState');
  const sample=({streamed,online=true,legacy=true,trafficCode=9})=>{const v={spec:{name:'test'}},state=Function('worldSession','multiplayer','traffic','police','settings','steeringAssistChoice','activeInputDevice','input','spectatorState','player',telemetry+';return networkState;')(streamed?{}:null,{active:online},{pursuitCode:()=>trafficCode},{online:legacy,pursuitCode:()=>5},{},()=>false,()=>'',{brake:0},()=>({}),{model:{}});return state(v).pursuit;};
  assert.equal(sample({streamed:true}),9,'streamed driver judge rides state telemetry');assert.equal(sample({streamed:false}),5,'legacy online judge still rides telemetry');assert.equal(sample({streamed:false,legacy:false}),0,'disabled legacy police sends no pursuit');assert.equal(sample({streamed:true,online:false,legacy:false}),0,'offline traffic heat never rides online state');
  const shared = readFileSync(new URL('../src/mp-shared-world.js', import.meta.url), 'utf8');
  assert.match(shared, /tr\.police\.dispatch\(dt,/);
});
