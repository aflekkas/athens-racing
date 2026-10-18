import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { StateSender } from '../src/multiplayer-state.js';
import { Multiplayer } from '../src/multiplayer.js';
import { getLeaderboard, submitResult } from '../src/leaderboard.js';
import { getPlayableMaps } from '../src/enabled-maps.js';
import './remote-motion.test.mjs';

const state = (extra = {}) => ({ x: 0, y: 0, z: 0, s: 0, u: 0, yaw: 0, vLong: 0, vLat: 0, steer: 0, rpm: 900, gear: 1, nitro: 1, reverse: false, damage: { front: 0, rear: 0, left: 0, right: 0 }, ...extra });
function sender() {
  let now = 0, sequence = 0; const timers = new Map(), packets = [];
  const sender = new StateSender(p => packets.push(p), { now: () => now,
    schedule: (fn, delay) => { const id = ++sequence; timers.set(id, { at: now + delay, fn }); return id; },
    cancel: id => timers.delete(id) });
  const advance = value => { now = value; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } };
  return { sender, packets, advance, timers };
}

test('moving clients produce at most five immutable two-sample messages per second', () => {
  const q = sender();
  for (let t = 0; t < 1000; t += 10) { q.advance(t); const s = state({ s: t / 100, vLong: 10 }); q.sender.sample(s, 'race', { batching: true }); s.s = -999; s.damage.front = 1; }
  assert.equal(q.packets.length, 5);
  assert.ok(q.packets.every(p => p.type === 'states' && p.states.length === 2 && p.raceId === 'race'));
  assert.deepEqual(q.packets[0].states.map(s => s.s), [0, 1]);
  assert.equal(q.packets[0].states[0].damage.front, 0);
});

test('a single sample flushes at 200ms and unchanged stationary clients remain quiet', () => {
  const q = sender(); q.sender.sample(state(), 'race', { batching: true });
  q.advance(199); assert.equal(q.packets.length, 0);
  q.advance(200); assert.equal(q.packets.length, 1); assert.equal(q.packets[0].states.length, 1);
  for (let t = 300; t <= 10000; t += 100) { q.advance(t); q.sender.sample(state({ rpm: 950 }), 'race', { batching: true }); }
  assert.equal(q.packets.length, 1);
  q.advance(10100); q.sender.sample(state({ gear: 2 }), 'race', { batching: true }); q.advance(10300);
  assert.equal(q.packets.length, 2); assert.equal(q.packets[1].states[0].gear, 2);
});
test('parked brake-light and suspension changes are sent without reintroducing an idle stream', () => {
  const q=sender(),pose=state({braking:false,bodyHeave:0,bodyPitch:0,bodyRoll:0});q.sender.sample(pose,'race');
  q.advance(100);q.sender.sample({...pose,braking:true},'race');assert.equal(q.packets.length,2);assert.equal(q.packets[1].state.braking,true);
  q.advance(200);q.sender.sample({...pose,braking:true,bodyRoll:.05},'race');assert.equal(q.packets.length,3);
  q.advance(300);q.sender.sample({...pose,braking:true,bodyRoll:.05},'race');assert.equal(q.packets.length,3);
});

test('finish forces a sub-100ms flush and reset cancels packets from an earlier race', () => {
  const q = sender(); q.sender.sample(state({ vLong: 10, s: 99 }), 'first', { batching: true });
  q.advance(20); q.sender.sample(state({ vLong: 10, s: 101 }), 'first', { batching: true, force: true });
  assert.equal(q.packets.length, 1); assert.equal(q.packets[0].states.at(-1).s, 101);
  q.advance(120); q.sender.sample(state({ vLong: 10 }), 'first', { batching: true }); q.sender.reset();
  q.advance(1000); assert.equal(q.packets.length, 1);
  q.sender.sample(state({ vLong: 10 }), 'second', { batching: true }); q.advance(1200);
  assert.equal(q.packets[1].raceId, 'second');
});

test('legacy servers receive single states at ten Hz', () => {
  const q = sender(); for (let t = 0; t < 1000; t += 10) { q.advance(t); q.sender.sample(state({ vLong: 10, s: t / 100 }), 'race'); }
  assert.equal(q.packets.length, 10); assert.ok(q.packets.every(p => p.type === 'state'));
});

test('default timers retain the browser global receiver when called through the sender', () => {
  const oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout; let scheduled = 0, canceled = 0;
  globalThis.setTimeout = function() { assert.equal(this, globalThis); scheduled++; return 123; };
  globalThis.clearTimeout = function(id) { assert.equal(this, globalThis); assert.equal(id, 123); canceled++; };
  try { const sender = new StateSender(() => {}, { now: () => 0 }); sender.sample(state(), 'race', { batching: true }); sender.reset(); assert.equal(scheduled, 1); assert.equal(canceled, 1); }
  finally { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
});

function lobbyClient(mapId = 'megara') {
  const m = Object.create(Multiplayer.prototype), starts = [], maps = [], packets = [];
  Object.assign(m, { loaded: true, connected: true, mapId: 'riviera', preparing: null, failedMap: null, id: 'me', offset: 0,
    pendingResume: false, resumeState: null, startedRace: null, panel: { hidden: false }, peers: new Map(),
    lobby: { mapId, raceId: 'race', status: 'race', startAt: Date.now() - 1000, players: [{ id: 'me', finish: null }], event: { s1: 100, dir: 1 } },
    hooks: { clearInput() {}, members() {}, wait() {}, results() {}, remote() {}, clock() {}, wrecked() {}, start: (...args) => starts.push(args), mapChanged: async id => { maps.push(id); m.mapId = id; } },
    renderRoom() {}, status() {}, hidePanel() { this.panel.hidden = true; }, stateSender: new StateSender(p => packets.push(p)) });
  return { m, starts, maps, packets };
}

test('race start and state sending wait for async map preparation', async () => {
  const { m, starts, packets } = lobbyClient(); let release;
  m.hooks.mapChanged = async id => { await new Promise(resolve => { release = resolve; }); m.mapId = id; };
  const pending = m.syncLobby(); await Promise.resolve();
  m.peers.set('stationary', { state: state(), at: 0 });
  assert.equal(m.worldReady, false); m.update(1 / 60, state({ vLong: 10 })); assert.equal(packets.length, 0); assert.equal(starts.length, 0);
  release(); await pending; assert.equal(m.worldReady, true); assert.equal(starts.length, 1);
  assert.ok(m.peers.has('stationary'), 'snapshots arriving during loading must survive race hydration');
  await m.syncLobby(); assert.equal(starts.length, 1); m.stateSender.reset();
});

test('a stale route version cannot hydrate a race or send state', async () => {
  const { m, starts, packets } = lobbyClient('riviera');
  m.trackVersion = 'old'; m.lobby.track = { version: 'new' };
  await m.syncLobby(); m.update(1 / 60, state({ vLong: 10 }));
  assert.equal(m.versionMismatch, true); assert.equal(m.worldReady, false); assert.equal(starts.length, 0); assert.equal(packets.length, 0);
});

test('queued map and resume changes hydrate only the newest lobby and saved state', async () => {
  const { m, starts, maps } = lobbyClient(); let release;
  m.hooks.mapChanged = async id => { maps.push(id); if (id === 'megara') await new Promise(resolve => { release = resolve; }); m.mapId = id; };
  const pending = m.syncLobby(); await Promise.resolve();
  m.lobby = { ...m.lobby, mapId: 'penteli', raceId: 'new-race' }; m.pendingResume = true; m.resumeState = state({ s: 30 });
  release(); await pending;
  assert.deepEqual(maps, ['megara', 'penteli']); assert.equal(starts.length, 1); assert.equal(starts[0][0].raceId, 'new-race'); assert.equal(starts[0][2].s, 30);
  assert.equal(m.pendingResume, false); assert.equal(m.resumeState, null); m.stateSender.reset();
});

test('solo and online board requests include the selected map', async () => {
  const oldFetch = globalThis.fetch, oldStore = globalThis.localStorage, requests = [];
  globalThis.localStorage = { getItem: key => key === 'paraliaki.driverId' ? 'abc' : 'QA' };
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ saved: true }) }; };
  try {
    await getLeaderboard({ mapId: 'megara', eventId: 'megara-tt' });
    await submitResult({ mapId: 'penteli', eventId: 'penteli-tt', car: 'mini', time: 120, valid: true });
    await submitResult({ mapId: 'penteli', time: 120, valid: false });
    assert.equal(new URL(requests[0].url, 'http://localhost').searchParams.get('mapId'), 'megara');
    assert.equal(JSON.parse(requests[1].options.body).mapId, 'penteli'); assert.equal(requests.length, 2);
  } finally { globalThis.fetch = oldFetch; if (oldStore === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStore; }
});


test('100 km/h impact stays recoverable and explicit retirement cancels queued finish', () => {
  const { m, packets } = lobbyClient('riviera'); let retirements = 0;
  const q = sender(); m.stateSender = q.sender; m.send = p => packets.push(p); m.hooks.wrecked = () => retirements++;
  m.boardAt = performance.now();
  q.sender.sample(state({ s: 90, vLong: 10 }), 'race', { batching: true });
  assert.equal(m.wreck(120 / 3.6), false); assert.equal(m.retired, false); assert.equal(q.timers.size, 1);
  assert.equal(m.retire(), true); assert.equal(m.retire(), false);
  assert.deepEqual(packets, [{ type: 'dnf', raceId: 'race', generation: undefined, reason: 'retired' }]); assert.equal(retirements, 1);
  q.advance(200); m.update(1 / 60, state({ s: 101, vLong: 10 }));
  assert.equal(q.packets.length, 0); assert.equal(packets.length, 1); assert.equal(m.me.finish, null);
  m.me.dnf = 'retired'; m.sendWreck(); assert.equal(packets.length, 1);
});

test('explicit retirement persists through reconnect and a new race clears it', async () => {
  const { m, packets } = lobbyClient('riviera'); m.startedRace = 'race'; m.send = p => packets.push(p);
  assert.equal(m.retire(), true); assert.equal(packets.length, 1);
  m.connected = false; m.wreckSent = false; assert.equal(m.retired, true);
  m.connected = true; m.pendingResume = true; await m.syncLobby();
  assert.equal(m.retired, true); assert.equal(packets.filter(p => p.type === 'dnf').length, 2);
  m.lobby.raceId = 'next'; await m.syncLobby(); assert.equal(m.wrecked, false); assert.equal(m.retired, false);
});

test('wrecked drivers rank behind active racers and spectate only remaining drivers', () => {
  const { m } = lobbyClient('riviera'); m.me.dnf = 'wrecked'; m.spectateIndex = 0; m.spectateAt = performance.now();
  m.lobby.players.push({ id: 'active', finish: null }, { id: 'retired', finish: null, dnf: 'wrecked' });
  m.peers.set('active', { state: state({ s: 10 }) }); m.peers.set('retired', { state: state({ s: 99 }) });
  assert.equal(m.ranking(100)[0].id, 'active'); assert.equal(m.spectating().id, 'active');
  m.me.finish = 1; assert.equal(m.wreck(120 / 3.6), false);
});

test('plate text normalizes usernames to fit the texture', async () => {
  const { formatPlate, carClass, presetCars } = await import('../src/plate.js');
  assert.equal(formatPlate('speed-queen-99'), 'SPEED-QUEEN-99');
  assert.equal(formatPlate('  z4-racer  '), 'Z4-RACER');
  assert.equal(formatPlate('a'.repeat(20)).length, 16);
  assert.equal(formatPlate('<x>'), 'X');
  assert.equal(formatPlate(''), '');
  assert.equal(carClass({ power: 257 }), 'supercar');
  assert.equal(carClass({ power: 141 }), 'normal');
  assert.equal(carClass({}), 'normal');
  const cars = [{ id: 'mini', power: 141 }, { id: 'z4', power: 250 }, { id: 'carrera', power: 257 }, { id: 'golf', power: 103 }, { id: 'gr_yaris', power: 206 }];
  assert.deepEqual(presetCars(cars, 'all'), ['mini', 'z4', 'carrera', 'golf', 'gr_yaris']);
  assert.deepEqual(presetCars(cars, 'normal'), ['mini', 'golf']);
  assert.deepEqual(presetCars(cars, 'supercar'), ['z4', 'carrera', 'gr_yaris']);
  assert.deepEqual(presetCars(cars, 'bogus'), ['mini', 'z4', 'carrera', 'golf', 'gr_yaris']);
});

test('lobby map picker offers only enabled maps (including Megara Circuit)', () => {
  // The hello handler assigns this.maps through getPlayableMaps, so the
  // lobby pickers and the solo selector share one registry.
  assert.deepEqual(getPlayableMaps([{ id: 'riviera' }, { id: 'megara' }, { id: 'penteli' }, { id: 'psychiko' }]).map((m) => m.id), ['riviera', 'megara', 'penteli', 'psychiko']);
  assert.deepEqual(getPlayableMaps([]), []);
});

// Exercise the actual results renderer without loading a WebGL world.
function resultsPanel(t, mode, results, config = { sessionDuration: 30 }) {
  const element = tag => ({ tag, textContent: '', children: [], append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; } });
  const panel = element('section'), m = Object.create(Multiplayer.prototype);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { createElement: element } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  Object.assign(m, { id: results[0]?.id, lobby: { mode, event: { type: mode }, status: 'results', config, results, players: results },
    peers: new Map(), $: () => panel, status() {} });
  m.renderResults();
  return { m, panel, title: panel.children[0].textContent, rows: panel.children.slice(1).map(row => row.textContent) };
}
const objectiveDriver = (id, completed, bestTrip, elapsed = 30, extra = {}) => ({ id, name: id, finish: null, dnf: false,
  objective: { phase: 'finished', done: true, completed, bestTrip, elapsed }, ...extra });

test('Taxi results render completed fares, real DNF only, and configured session time', t => {
  const drivers = [objectiveDriver('Empty', 0, null), objectiveDriver('Winner', 3, 42), objectiveDriver('Retired', 0, null, 12, { dnf: true })];
  const { m, title, rows } = resultsPanel(t, 'taxi', drivers);
  assert.equal(title, 'TAXI RESULTS');
  assert.deepEqual(rows, ['1 · Winner · 3 fares · best 0:42', 'DNF · Retired · 0 fares · best —', '3 · Empty · 0 fares · best —']);
  assert.equal(m.sessionDurationText() + ' SESSION', '0:30 SESSION');
  m.lobby.config.sessionDuration = 90; assert.equal(m.sessionDurationText() + ' SESSION', '1:30 SESSION');
  m.lobby.config = {}; assert.equal(m.sessionDurationText() + ' SESSION', '5:00 SESSION');
  assert.deepEqual(drivers.map(p => p.id), ['Empty', 'Winner', 'Retired'], 'rendering does not mutate server results');
});

test('Getaway results sort counts, fastest trip, then elapsed; retirements remain DNF', t => {
  const drivers = [objectiveDriver('Slower', 2, 50), objectiveDriver('Fewer', 1, 10), objectiveDriver('Later', 2, 40),
    objectiveDriver('Earlier', 2, 40, 27), objectiveDriver('Wreck', 0, null, 20, { dnf: 'wrecked' })];
  const { title, rows } = resultsPanel(t, 'getaway', drivers);
  assert.equal(title, 'GETAWAY RESULTS');
  assert.deepEqual(rows, ['1 · Earlier · 2 missions · best 0:40', '2 · Later · 2 missions · best 0:40',
    '3 · Slower · 2 missions · best 0:50', '4 · Fewer · 1 mission · best 0:10', 'DNF · Wreck · 0 missions · best — · WRECKED']);
});

test('race result heading, finish seconds, DNF rows and ordering stay unchanged', t => {
  const drivers = [{ id: 'slow', name: 'Slow', finish: 72.345, dnf: false }, { id: 'wreck', name: 'Wreck', finish: null, dnf: 'wrecked' },
    { id: 'fast', name: 'Fast', finish: 65.125, dnf: false }];
  const { title, rows } = resultsPanel(t, 'sprint', drivers);
  assert.equal(title, 'RACE RESULTS');
  assert.deepEqual(rows, ['1. Fast · 65.13 s', '2. Slow · 72.34 s', 'DNF · Wreck · WRECKED']);
});

test('objective results subtitle says round complete and avoids repeating the event mode', () => {
  const m = Object.create(Multiplayer.prototype);
  Object.assign(m, { id: 'guest', maps: [{ id: 'riviera', name: 'ATHENS RIVIERA' }],
    lobby: { host: 'host', status: 'results', mapId: 'riviera', mode: 'taxi', event: { name: 'TAXI', type: 'taxi' }, players: [] } });
  assert.equal(m.roomHelpText(), 'Round complete. The host can prepare a rematch. ATHENS RIVIERA · TAXI');
  m.lobby.mode = 'getaway'; m.lobby.event = { name: 'Getaway', type: 'getaway' };
  assert.equal(m.roomHelpText(), 'Round complete. The host can prepare a rematch. ATHENS RIVIERA · Getaway');
  m.lobby.event.name = 'BANK PICKUP';
  assert.equal(m.roomHelpText(), 'Round complete. The host can prepare a rematch. ATHENS RIVIERA · BANK PICKUP · GETAWAY');
  m.lobby.host = m.id;
  assert.equal(m.roomHelpText(), 'Round complete. The host can prepare a rematch.');
  m.lobby.host = 'host'; m.lobby.mode = 'sprint'; m.lobby.event = { name: 'COAST RUN', type: 'sprint' };
  assert.equal(m.roomHelpText(), 'Race complete. The host can prepare a rematch. ATHENS RIVIERA · COAST RUN · SPRINT');
});

test('UI session APIs send authoritative commands; car changes are available after results and picker survives publishes', async () => {
  const { m, packets } = lobbyClient('riviera'); m.lobby.host='me'; m.lobby.status='waiting'; m.lobby.allowedCars=['mini','z4'];m.cars=[{id:'mini'},{id:'z4'}];m.send=p=>packets.push(p);
  assert.equal(m.startRace({force:true}),true);assert.deepEqual(packets.pop(),{type:'start',force:true});assert.equal(m.kickPlayer('guest'),true);assert.deepEqual(packets.pop(),{type:'kick',id:'guest'});assert.equal(m.kickPlayer('me'),false);m.unblockPlayer('guest');assert.deepEqual(packets.pop(),{type:'unblock',id:'guest'});
  m.lobby.raceId=null;m.setCarPickerOpen(true);m.panel.hidden=true;await m.syncLobby();assert.equal(m.panel.hidden,true);m.setCarPickerOpen(false);await m.syncLobby();assert.equal(m.panel.hidden,false);
  assert.equal(m.changeCar('z4'),true);assert.deepEqual(packets.pop(),{type:'car',car:'z4'});m.lobby.status='results';assert.equal(m.canChangeCar,true);assert.equal(m.changeCar('mini'),true);m.lobby.status='race';assert.equal(m.changeCar('z4'),false);m.lobby.host='guest';assert.equal(m.startRace({force:true}),false);assert.equal(m.kickPlayer('guest'),false);
});
test('the multiplayer client keeps no checkpoint state or hook: progress is tracked invisibly by the server',()=>{const {m}=lobbyClient('riviera');assert.equal(typeof m.applyCheckpoint,'undefined');assert.equal(m.checkpoint,undefined);assert.equal('checkpoint' in m.hooks,false);});

test('race updates accept legacy events without timing sectors across modes, reconnect and forced finish',()=>{
  for(const mode of ['sprint','free','taxi','getaway'])for(const resumed of [false,true]){
    const {m,packets}=lobbyClient('riviera');m.lobby.mode=mode;m.lobby.event={type:mode,s0:0,s1:100,dir:1};m.pendingResume=resumed;m.startedRace=resumed?'race':null;m.boardAt=Infinity;
    let remoteDt;m.hooks.remote=(_peers,dt)=>remoteDt=dt;
    assert.doesNotThrow(()=>m.update(1/60,state({s:10,vLong:10})),mode+' running');assert.equal(remoteDt,1/60);assert.equal(packets.at(-1).state.s,10);
    assert.doesNotThrow(()=>m.update(1/60,state({s:110,vLong:10})),mode+' force finish');assert.equal(m.finishSent,'race');assert.equal(packets.at(-1).state.s,110);
    m.lobby.status='results';assert.doesNotThrow(()=>m.update(1/60,state({s:110})),mode+' results');
  }
});

test('protocol hello carries the integer version and optional HTML build metadata', async () => {
  const { clientHello, MULTIPLAYER_PROTOCOL } = await import('../src/multiplayer-protocol.js');
  assert.deepEqual(clientHello({ querySelector: () => null }), { type: 'hello', protocol: MULTIPLAYER_PROTOCOL });
  assert.deepEqual(clientHello({ querySelector: () => ({ content: 'release-abc' }) }), { type: 'hello', protocol: MULTIPLAYER_PROTOCOL, build: 'release-abc' });
});
function protocolClient(t) {
  const packets = [], timers = [], nodes = [];
  const element = tag => ({ tag, children: [], setAttribute() {}, append(...items) { this.children.push(...items); }, replaceChildren() {} });
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = new URL(url); this.readyState = 1; }
    send(data) { packets.push(JSON.parse(data)); }
    close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
  }
  let reloads = 0;
  t.mock.method(globalThis, 'setTimeout', fn => { timers.push(fn); return 42; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  t.mock.method(globalThis, 'clearInterval', () => {});
  const replaceGlobal = (key, value) => { const old = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; }); };
  replaceGlobal('WebSocket', Socket);
  replaceGlobal('location', { href: 'https://game.test/?map=penteli', protocol: 'https:', reload() { reloads++; } });
  replaceGlobal('document', { querySelector: () => ({ content: 'tab-build' }), createElement: element, body: { append(node) { nodes.push(node); } } });
  const m = Object.create(Multiplayer.prototype), controls = new Map();
  Object.assign(m, { button: { hidden: true }, connected: false, loaded: false, token: null, hooks: { clearInput() {} }, peers: new Map(), stateSender: { reset() {} },
    status(text) { this.lastStatus = text; }, cancelRecovery() {}, renderEvents() {}, saveToken(token) { this.token = token; }, authSession() {},
    $(id) { if (!controls.has(id)) controls.set(id, element('select')); return controls.get(id); } });
  m.connect(); m.ws.onopen();
  return { m, packets, timers, nodes, reloads: () => reloads };
}
for (const protocol of [undefined, 0, 99]) {
  test(`server hello protocol ${String(protocol)} shows Reload and stops reconnection`, async t => {
    const { UPDATE_CLOSE_CODE } = await import('../src/multiplayer-protocol.js');
    const q = protocolClient(t), { m } = q;
    // No track/map fields: mismatch must be handled before interpreting the greeting.
    m.ws.onmessage({ data: JSON.stringify({ type: 'hello', protocol }) });
    assert.equal(m.reloadRequired, true); assert.equal(m.ws.closed.code, UPDATE_CLOSE_CODE);
    m.ws.onclose({ code: UPDATE_CLOSE_CODE }); m.ws.onerror(); m.connect(); m.send({ type: 'create' });
    assert.equal(q.timers.length, 0); assert.equal(m.lastStatus, 'Game updated, reload');
    assert.equal(q.nodes.length, 1); const button = q.nodes[0].children[1];
    assert.equal(button.textContent, 'Reload'); button.onclick(); assert.equal(q.reloads(), 1);
  });
}
test('matching server protocol accepts a different build and sends versioned hello/connect metadata', async t => {
  const { MULTIPLAYER_PROTOCOL } = await import('../src/multiplayer-protocol.js');
  const { m, packets, nodes } = protocolClient(t);
  assert.equal(m.ws.url.searchParams.get('protocol'), String(MULTIPLAYER_PROTOCOL));
  assert.equal(m.ws.url.searchParams.get('build'), 'tab-build');
  assert.deepEqual(packets[0], { type: 'hello', protocol: MULTIPLAYER_PROTOCOL, build: 'tab-build' });
  m.ws.onmessage({ data: JSON.stringify({ type: 'hello', protocol: MULTIPLAYER_PROTOCOL, build: 'server-other-build', track: { version: 'track' }, maps: [], events: [], now: Date.now(), id: 'driver', token: 'session' }) });
  assert.equal(m.connected, true); assert.equal(m.id, 'driver'); assert.equal(m.reloadRequired, undefined); assert.equal(nodes.length, 0);
});
test('server reload message or update close code shows exactly one notice with no retry loop', async t => {
  const { UPDATE_CLOSE_CODE } = await import('../src/multiplayer-protocol.js');
  const { m, nodes, timers } = protocolClient(t);
  m.ws.onmessage({ data: JSON.stringify({ type: 'reload', reason: 'update' }) });
  m.ws.onclose({ code: UPDATE_CLOSE_CODE }); m.ws.onerror(); m.connect();
  assert.equal(nodes.length, 1); assert.equal(timers.length, 0); assert.equal(m.connected, false);
});
test('update close code alone stops retry even if the reload frame was lost', async t => {
  const { UPDATE_CLOSE_CODE } = await import('../src/multiplayer-protocol.js');
  const { m, nodes, timers } = protocolClient(t);
  m.ws.onclose({ code: UPDATE_CLOSE_CODE });
  assert.equal(m.reloadRequired, true); assert.equal(nodes.length, 1); assert.equal(timers.length, 0);
});

for (const code of [1006, 1011, 1000]) test(`transport close ${code} preserves driving and schedules token resume`, t => {
  const {m, timers, packets}=protocolClient(t);let cleared=0;m.hooks.clearInput=()=>cleared++;
  const lobby={code:'ABCDEF',mapId:'riviera',raceId:'same-race',status:'race',startAt:Date.now()-1000,players:[{id:'me',car:'mini'}]};
  Object.assign(m,{lobby,id:'me',token:'reserved-token',startedRace:'same-race',panel:{hidden:true},connectionChip:{hidden:true}});
  const prior=m.ws;m.ws.onclose({code,reason:''});
  assert.equal(cleared,0);assert.equal(m.lobby,lobby);assert.equal(m.panel.hidden,true);assert.equal(m.connectionChip.hidden,false);assert.equal(timers.length,1);
  timers.shift()();assert.notEqual(m.ws,prior);m.ws.onopen();
  m.ws.onmessage({data:JSON.stringify({type:'hello',protocol:MULTIPLAYER_PROTOCOL,now:Date.now(),id:'temporary',token:'temporary-token',track:{version:'v'},maps:[],events:[]})});
  assert.ok(packets.some(p=>p.type==='resume'&&p.token==='reserved-token'));
  Object.assign(m,{loaded:true,mapId:'riviera',renderRoom(){},syncLobby(){},reconnectHistory:{resume(){},flush(){}}});
  m.ws.onmessage({data:JSON.stringify({type:'session',resumed:true,lobby:true,id:'me',token:'reserved-token'})});
  m.ws.onmessage({data:JSON.stringify({type:'lobby',resume:true,lobby,state:{s:1}})});
  assert.equal(m.pendingResume,false,'same live race must not reconstruct the vehicle');assert.equal(m.startedRace,'same-race');assert.equal(m.reconnecting,false);assert.equal(m.connectionChip.hidden,true);assert.equal(cleared,0);
});

test('race clock and state sampling continue locally while disconnected',()=>{
  const {m,packets}=lobbyClient('riviera');let clocks=0;m.startedRace='race';m.connected=false;m.boardAt=Infinity;m.hooks.clock=()=>clocks++;
  m.update(1/60,state({s:10,vLong:20}));assert.equal(clocks,1);assert.equal(packets.length,1);m.stateSender.reset();
});

test('bounded reconnect breadcrumbs replay at a safe rate and discard accepted poses',async()=>{
  const {ReconnectHistory,reconnectDelay}=await import('../src/reconnect-history.js');assert.deepEqual([0,1,2,3,9].map(reconnectDelay),[750,1500,3000,6000,8000]);
  const h=new ReconnectHistory();for(let i=0;i<1000;i++)h.record({type:'state',raceId:'r',state:{sampleTime:i,motionEpoch:1,s:i}});
  assert.equal(h.frames.length,900);h.resume({sampleTime:995,motionEpoch:1});const sent=[];h.flush(p=>sent.push(p),2,2000);h.flush(p=>sent.push(p),2,2050);h.flush(p=>sent.push(p),2,2100);
  assert.deepEqual(sent.flatMap(p=>p.states.map(s=>s.s)),[996,997,998,999]);assert.ok(sent.every(p=>p.generation===2));assert.equal(h.replaying,false);
  h.record({raceId:'next',state:{sampleTime:2001}});assert.equal(h.frames.length,1);
});
