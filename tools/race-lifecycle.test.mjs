import test from 'node:test';
import assert from 'node:assert/strict';
import { SpectatorSelection, rankDrivers, driverTelemetry, spectatorState, applySpectatorState } from '../src/race-lifecycle.js';
import { Multiplayer } from '../src/multiplayer.js';
import { StateSender } from '../src/multiplayer-state.js';
import { readFileSync } from 'node:fs';

test('chosen identity survives joins, reordering, time and finish; disconnect falls back and race resets', () => {
  const selection = new SpectatorSelection(), a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  selection.choose('b', 'race', [a, b]);
  for (let i = 0; i < 100; i++) assert.equal(selection.target('race', [c, b, a]).id, 'b');
  b.finish = 12; assert.equal(selection.target('race', [a, b]).id, 'b');
  assert.equal(selection.step(1, 'race', [a, b]).id, 'a');
  selection.choose('b', 'race', [a, b]); assert.equal(selection.target('race', [a, c]).id, 'a');
  assert.equal(selection.target('new-race', [c, a]).id, 'c');
  assert.equal(selection.target('new-race', []), null);
});

test('target HUD uses its speed, gear, rpm, finish clock and directed distance instead of retired local state', () => {
  const m = Object.create(Multiplayer.prototype);
  Object.assign(m, { id: 'me', peers: new Map(), offset: 0, lobby: { raceId: 'r', status: 'race', startAt: 1000, event: { s0: 100, s1: 0, dir: -1 }, standings: [{ id: 'a', progress: 70 }, { id: 'b', progress: 50 }, { id: 'me', progress: 0 }], players: [{ id: 'me', dnf: 'retired', finish: null }, { id: 'a', name: 'Alice', finish: null }, { id: 'b', name: 'Bob', finish: null }] } });
  m.now = () => 21000;
  m.peers.set('a', { state: { s: 30, vLong: 22, rpm: 5100, gear: 4 } });
  m.peers.set('b', { state: { s: 50, vLong: 0, rpm: 900, gear: 1 } });
  m.selectSpectator('b');
  const hud = m.telemetry({ s: 0, vLong: 99, rpm: 7000, gear: 6 });
  assert.equal(hud.member.id, 'b'); assert.equal(hud.state.rpm, 900); assert.equal(hud.state.gear, 1); assert.equal(hud.state.vLong, 0);
  assert.equal(hud.progress, 50); assert.equal(hud.time, 20); assert.equal(hud.gap, 20); assert.equal(hud.gapUnit, 'm');
  assert.equal(hud.ahead.id, 'a'); assert.equal(hud.leaderMetres, 20);
  // The gap is server-authoritative: it follows lobby.standings, not the peers' live positions.
  m.lobby.standings = [{ id: 'a', progress: 90 }, { id: 'b', progress: 50 }, { id: 'me', progress: 0 }];
  assert.equal(m.telemetry({ s: 0 }).gap, 40); assert.equal(m.telemetry({ s: 0 }).leaderMetres, 40);
  m.lobby.standings = [{ id: 'a', progress: 70 }, { id: 'b', progress: 50 }, { id: 'me', progress: 0 }];
  m.lobby.players[2].finish = 19; assert.equal(m.spectating().id, 'a'); assert.equal(m.telemetry({ s: 0 }).time, 20);
  m.lobby.players[2].connected = false; assert.equal(m.spectating().id, 'a');
  m.lobby.status = 'results'; assert.equal(m.spectating(), null);
});

test('finish order uses recorded times; running gaps never divide by speed', () => {
  const drivers = [{ id: 'late', finish: 15 }, { id: 'fast', finish: 12 }, { id: 'running', finish: null }, { id: 'dnf', dnf: true, finish: null }];
  const progress = p => ({ late: 100, fast: 100, running: 50, dnf: 500 })[p.id];
  const ranked = rankDrivers(drivers, progress); assert.deepEqual(ranked.map(p => p.id), ['fast', 'late', 'running', 'dnf']);
  const hud = driverTelemetry({ member: drivers[0], state: { s: 100, vLong: 0 }, event: { s0: 0, dir: 1 }, now: 50000, startAt: 0, ranked, progress });
  assert.equal(hud.time, 15); assert.equal(hud.gap, 3); assert.equal(hud.gapUnit, 's');
});

test('a fresh resumed client advances beyond the saved tow epoch and retains the recovery clock', async () => {
  const m = Object.create(Multiplayer.prototype), starts = [];
  Object.assign(m, { loaded: true, connected: true, mapId: 'riviera', peers: new Map(), id: 'me', offset: 0, panel: { hidden: true },
    stateSender: new StateSender(() => {}), pendingResume: true, $: () => ({}), resumeState: { s: 10, motionEpoch: 40, recoveryUntil: Date.now() + 4000 },
    lobby: { mapId: 'riviera', raceId: 'r', status: 'race', startAt: Date.now() - 1000, players: [{ id: 'me', finish: null }] },
    hooks: { members() {}, remote() {}, clock() {}, start: (...args) => starts.push(args) }, renderRoom() {}, hidePanel() {} });
  await m.syncLobby(); assert.equal(m.stateSender.motionEpoch, 41); assert.equal(starts[0][2].motionEpoch, 40); assert.ok(starts[0][2].recoveryUntil > Date.now());
  m.stateSender.reset();
});

test('spectator relay is a small immutable axle summary and absence clears old engine telemetry', () => {
  const axle = Object.freeze({ utilization: .6, slipDemand: .7, contact: true, saturated: false, sliding: false });
  const source = { engineDamage: .3, engHealth: .7, coolantTemp: 108, engineFailureReason: null, tyreTelemetry: { front: axle, rear: axle, understeer: false, wheels: [{ force: 5000 }] } };
  const packet = spectatorState(source); assert.equal(packet.tyreTelemetry.wheels, undefined); assert.notEqual(packet.tyreTelemetry.front, axle);
  const remote = {}; applySpectatorState(remote, packet); assert.equal(remote.engHealth, .7); assert.equal(remote.remoteTyreTelemetry.front.contact, true);
  applySpectatorState(remote, {}); assert.equal(remote.engHealth, undefined); assert.equal(remote.remoteTyreTelemetry, null); assert.equal(remote.remoteEngineTelemetry, false);
});

test('stationary engine changes relay on the existing capped state cadence', () => {
  let now = 0; const packets = [];
  const q = new StateSender(p => packets.push(p), { now: () => now });
  const s = { x: 0, y: 0, z: 0, s: 0, u: 0, yaw: 0, vLong: 0, vLat: 0, steer: 0, rpm: 900, gear: 1, damage: {}, engHealth: 1, coolantTemp: 90 };
  q.sample(s, 'r'); now = 50; q.sample({ ...s, engHealth: .5 }, 'r'); assert.equal(packets.length, 1);
  now = 100; q.sample({ ...s, engHealth: .5 }, 'r'); assert.equal(packets.length, 2); assert.equal(packets[1].state.engHealth, .5);
  now = 200; q.sample({ ...s, engHealth: .5 }, 'r'); assert.equal(packets.length, 2); q.reset();
});

test('actual main HUD override takes chosen vehicle instruments and target finish time', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('    const telemetry = multiplayer.telemetry(pv)'), end = main.indexOf("  if (G.state === 'race' && G.raceT > 5)", start);
  const body = main.slice(start, end).replace(/\n  }\s*$/, '');
  const local = { s: 0, rpm: 7100, kmh: 250, gear: 6 }, target = { s: 70, rpm: 4200, kmh: 90, gear: 3, x: 1, z: 2, yaw: .4, reverse: false };
  const car = { veh: { ...target, manual: true }, spec: { redline: 6500, nitrous: false }, model: { root: { visible: true } } };
  const multiplayer = { telemetry: () => ({ pos: 2, time: 12.3, gap: 20, gapUnit: 'm', member: { id: 'target' }, comparison: { name: 'Ahead' } }), spectating: () => ({ id: 'target' }), lobby: { players: [{}, {}, {}], event: { s0: 0 } } };
  const st = { rpm: local.rpm, kmh: local.kmh, gearLabel: '6', time: 99 }, element = {};
  Function('multiplayer', 'pv', 'player', 'remoteCars', 'st', '$', 'document', 'speedIn', 'speedLimitAt', 'map', `let pos; ${body}`)(multiplayer, local, { veh: local }, new Map([['target', car]]), st, () => element, { querySelector: () => element }, v => v, () => 50, {});
  assert.equal(st.rpm, 4200); assert.equal(st.kmh, 90); assert.equal(st.gearLabel, '3'); assert.equal(st.redline, 6500); assert.equal(st.time, 12.3); assert.equal(st.s, 70); assert.equal(st.manual, true); assert.equal(st.gapUnit, 'm'); assert.equal(element.textContent, '/3');
});

test('objective HUD skips identical writes and restores content after another screen replaces its DOM',()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const line=source.split('\n').find(line=>line.includes('const content = drivingModeHud('));
 const render=Function('box','drivingModeHud','objective','objectiveRoutes','selectedPose','notifications','objectiveNotice',line);
 let writes=0,value='',child=null;
 const box={classList:{toggle(){}},get firstChild(){return child;},get innerHTML(){return value;},set innerHTML(html){writes++;value=html;child={};}};
 const update=()=>render(box,()=>'<span>Turn left</span>',{},[],{}, {dismiss(){}},()=>{});
 update();update();assert.equal(writes,1);
 box.innerHTML='<header>A different event</header>';update();
 assert.equal(writes,3);assert.equal(value,'<span>Turn left</span>');update();assert.equal(writes,3);
});

test('production solo HUD position and gap follow current validated progress through shortcut, retreat and finish', async () => {
  const { courseProgress } = await import('../src/course.js');
  const EV = await import('../src/events.js');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const earnedSource = main.slice(main.indexOf('const earnedProgress ='), main.indexOf('function advanceRivalCourses('));
  const rankSource = main.slice(main.indexOf('const rivalDnf ='), main.indexOf("/** how: 'finish'"));
  const player = { veh: { s: 900 } }, G = { pFinish: null, run: { course: { validProgress: 100 } } };
  const grid = [{ name: 'AI', finish: null, veh: { s: 950 }, course: { validProgress: 90 } }];
  const element = {};
  const api = Function('player','G','grid','EV','courseProgress','$', earnedSource + rankSource + 'return {racePosition,raceGap};')(player,G,grid,EV,courseProgress,()=>element);
  assert.deepEqual(api.raceGap(), {pos:1,gap:-10,gapUnit:'m'});
  // An unvalidated AI station jump remains behind; a legal pass then changes both.
  grid[0].veh.s = 12000; assert.equal(api.racePosition(),1);
  grid[0].course.validProgress=120; assert.deepEqual(api.raceGap(), {pos:2,gap:20,gapUnit:'m'});
  G.run.course.validProgress=50; assert.deepEqual(api.raceGap(), {pos:2,gap:70,gapUnit:'m'});
  assert.equal(element.textContent,'AI');
  G.pFinish=30;grid[0].finish=29;assert.deepEqual(api.raceGap(),{pos:2,gap:1,gapUnit:'s'});
});
