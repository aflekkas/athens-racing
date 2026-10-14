import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGameCore } from './core.mjs';
import { createSqlLeaderboard } from '../worker/leaderboard.mjs';
import { createAccountService } from './accounts.mjs';
import { createFriendService } from './friends.mjs';
import { createMemorySocialStore } from './social-store.mjs';

const map = (id, len, version, closed = false) => ({ id, name: id, track: { start: 0, finish: len, version }, definitions: new Map([[id === 'riviera' ? 'quick' : id + '-race', { id: id === 'riviera' ? 'quick' : id + '-race', name: id, type: 'sprint', s0: 0, s1: len, dir: 1, len, routeKey: `0>${len}`, traffic: false, closed }]]) });
// Lobby fixtures use only enabled maps (Megara is retained in MAPS/data but not
// offered: the registry rejects it at create/options). Leaderboard history
// below still covers megara records.
const maps = new Map([['riviera', map('riviera', 15, 'coast')], ['penteli', map('penteli', 40, 'circuit')], ['megara', map('megara', 40, 'circuit', true)]]), cars = new Set(['mini']);
const socket = () => ({ readyState: 1, messages: [], send(data) { this.messages.push(JSON.parse(data)); }, close() { this.readyState = 3; } });
const state = s => ({ x: s, y: 0, z: 0, yaw: 0, s, u: 0, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2 });

test('shared core restores lobby, socket identity, race clock and state after hibernation; coalesces relays', t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const opts = { maps, cars, leaderboard: { submit: async () => ({ saved: true }) }, countdownMs: 100, raceLimitMs: 5000, reconnectGraceMs: 500 };
  let core = createGameCore(opts); const a = socket(), b = socket(); core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const hello = a.messages.find(m => m.type === 'hello'); assert.equal(hello.maps.length, 2);
  assert.deepEqual(hello.maps.map((m) => m.id).sort(), ['penteli', 'riviera'], 'disabled maps leave the catalogue');
  const send = (ws, value) => core.message(ws, JSON.stringify(value));
  send(a, { type: 'create', mapId: 'penteli', eventId: 'quick' }); assert.match(a.messages.at(-1).message, /route/);
  send(a, { type: 'create', mapId: 'penteli' }); const lobby = a.messages.at(-1).lobby; assert.equal(lobby.track.version, 'circuit');
  send(b, { type: 'join', code: lobby.code });
  send(a, { type: 'ready', ready: true, version: 'coast' }); assert.match(a.messages.at(-1).message, /track changed/);
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'circuit' });
  send(a, { type: 'start' }); now += 101; core.tick();
  const race = a.messages.at(-1).lobby; send(a, { type: 'states', raceId: race.raceId, states: [state(5), state(6)] });
  core.tick(); assert.equal(b.messages.at(-1).type, 'snapshot'); assert.equal(b.messages.at(-1).players.find(p => p.id === hello.id).state.s, 6);
  const count = b.messages.length; core.tick(); assert.equal(b.messages.length, count, 'unchanged state must not relay');
  const saved = JSON.parse(JSON.stringify(core.exportState()));
  const connections = new Map([...core.clients].map(c => [c.token, c.ws]));
  core = createGameCore(opts); core.restore(saved, connections);
  send(a, { type: 'ping', sent: 42 }); assert.equal(a.messages.at(-1).sent, 42);
  assert.equal(core.lobbies.get(lobby.code).raceId, race.raceId);
  assert.equal(core.lobbies.get(lobby.code).startAt, race.startAt);
  assert.equal(core.sessions.get(hello.token).state.s, 6);
  now += 1000; for (const ws of [a, b]) send(ws, { type: 'state', raceId: race.raceId, state: state(40) });
  assert.equal(a.messages.at(-1).lobby.status, 'results'); assert.ok(a.messages.at(-1).lobby.results.every(p => p.finish !== null));
});

test('disabled maps leave every lobby list: hello excludes Megara; create/switch/join reject it', () => {
  const core = createGameCore({ maps, cars, leaderboard: { submit: async () => ({}) } });
  const a = socket(), b = socket(); core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, value) => core.message(ws, JSON.stringify(value));
  assert.deepEqual(a.messages.find((m) => m.type === 'hello').maps.map((m) => m.id).sort(), ['penteli', 'riviera']);
  send(a, { type: 'create', mapId: 'megara' });
  assert.match(a.messages.at(-1).message, /unavailable/);
  send(a, { type: 'create', mapId: 'riviera' });
  const code = a.messages.at(-1).lobby.code;
  send(a, { type: 'options', mapId: 'megara' });
  assert.match(a.messages.at(-1).message, /unavailable/);
  assert.equal(core.lobbies.get(code).mapId, 'riviera', 'rejected switch keeps the lobby');
  core.lobbies.set('MEG', { code: 'MEG', status: 'waiting', players: new Map(), mapId: 'megara' });
  send(b, { type: 'join', code: 'meg' });
  assert.match(b.messages.at(-1).message, /unavailable/);
});

test('idle lobbies expire without a repeating timer and map changes invalidate ready votes', t => {
  let now = 10000; t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps, cars, leaderboard: { submit: async () => ({}) }, idleLobbyMs: 1000 });
  const a = socket(); core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); const send = value => core.message(a, JSON.stringify(value));
  send({ type: 'create' }); send({ type: 'ready', ready: true, version: 'coast' });
  send({ type: 'options', mapId: 'penteli' }); const lobby = a.messages.at(-1).lobby;
  assert.equal(lobby.eventId, 'penteli-race'); assert.equal(lobby.players[0].ready, false);
  assert.equal(core.nextWake(), now + 1001); now += 1002; core.tick(); assert.equal(core.lobbies.size, 0);
  assert.ok(a.messages.some(m => m.type === 'left'));
});

test('SQLite leaderboard persists best records, separates map versions and shares Node validation', () => {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query, ...args) { if (query.includes(';')) { db.exec(query); return []; } const q = db.prepare(query); return q.columns().length ? q.all(...args) : (q.run(...args), []); } };
  const board = createSqlLeaderboard(sql, maps, cars), base = { driverId: 'test-driver-1', name: '<Driver>', car: 'mini', eventId: 'megara-race', mapId: 'megara', time: 2 };
  return (async () => {
    assert.equal((await board.submit(base)).saved, true); assert.equal((await board.submit({ ...base, time: 3 })).saved, false);
    assert.equal((await board.submit({ ...base, time: 1 })).saved, true);
    const reopened = createSqlLeaderboard(sql, maps, cars); assert.equal(reopened.list({ mapId: 'megara' })[0].time, 1); assert.equal(reopened.list({ mapId: 'megara' })[0].driverId, undefined);
    assert.equal(reopened.list({ mapId: 'riviera' }).length, 0);
    await assert.rejects(board.submit({ ...base, mapId: 'riviera' }), /Unknown event/); await assert.rejects(board.submit({ ...base, time: 0.001 }), /implausible/);
    db.close();
  })();
});

test('wreck DNF is authoritative, never records a time, ignores fake finish and completes with the other finisher', t => {
  let now = 200000; t.mock.method(Date, 'now', () => now);
  const submissions = [], opts = { maps, cars, leaderboard: { submit: async r => submissions.push(r) }, countdownMs: 100 };
  let core = createGameCore(opts);
  const a = socket(), b = socket(); core.connect(a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  const helloA = a.messages.find(m => m.type === 'hello'), helloB = b.messages.find(m => m.type === 'hello');
  assert.equal(helloA.features.wreckDnf, true);
  const send = (ws, m) => core.message(ws, JSON.stringify(m));
  send(a, { type: 'create' }); const code = a.messages.at(-1).lobby.code;
  send(b, { type: 'join', code });
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' }); const raceId = a.messages.at(-1).lobby.raceId;
  // A pre-GO or stale packet cannot declare a wreck for a different race.
  send(a, { type: 'dnf', raceId, reason: 'wrecked', impactEbs: 90 / 3.6 }); assert.equal(core.lobbies.get(code).players.get(helloA.id).dnf, false);
  now += 2100; core.tick();
  send(a, { type: 'dnf', raceId: 'stale-race', reason: 'wrecked' }); assert.equal(core.lobbies.get(code).players.get(helloA.id).dnf, false);
  send(a, { type: 'dnf', raceId, reason: 'busted' }); assert.match(a.messages.at(-1).message, /Unknown DNF/);
  for (const evidence of [{}, { impactEbs: 60 / 3.6 }, { impactEbs: 89 / 3.6 }, { impactMechanical: .97 }]) {
    send(a, { type: 'dnf', raceId, reason: 'wrecked', ...evidence });
    assert.equal(core.lobbies.get(code).players.get(helloA.id).dnf, false);
    assert.match(a.messages.at(-1).message, /recoverable/);
  }
  send(a, { type: 'dnf', raceId, reason: 'wrecked', impactEbs: 90 / 3.6 });
  const wreck = a.messages.at(-1).lobby.players.find(p => p.id === helloA.id);
  assert.equal(wreck.dnf, 'wrecked'); assert.equal(wreck.finish, null); assert.equal(submissions.length, 0);
  const saved = JSON.parse(JSON.stringify(core.exportState())), sockets = new Map([...core.clients].map(c => [c.token, c.ws]));
  core = createGameCore(opts); core.restore(saved, sockets);
  send(a, { type: 'states', raceId, states: [state(14), state(15)] });
  const wrecked = core.lobbies.get(code).players.get(helloA.id);
  assert.equal(wrecked.finish, null); assert.equal(wrecked.state, null); assert.equal(submissions.length, 0);
  send(b, { type: 'state', raceId, state: state(15) });
  const lobby = b.messages.at(-1).lobby; assert.equal(lobby.status, 'results');
  const lost = lobby.results.find(p => p.id === helloA.id), won = lobby.results.find(p => p.id === helloB.id);
  assert.equal(lost.dnf, 'wrecked'); assert.equal(lost.finish, null);
  assert.equal(won.dnf, false); assert.ok(Number.isFinite(won.finish));
  assert.equal(submissions.length, 1); assert.equal(submissions[0].driverId, helloB.id);
  // Later duplicate declarations or fake progress cannot mutate either result.
  send(a, { type: 'state', raceId, state: state(15) }); assert.equal(submissions.length, 1);
  send(a, { type: 'rematch' }); assert.ok(a.messages.at(-1).lobby.players.every(p => p.dnf === false && p.finish === null));
});

// --- Username accounts, plate = username, lobby allow-lists, MP stats -------
const cars3 = new Set(['mini', 'z4', 'carrera']);
function socialCore(t, nowRef = { at: 500000 }) {
  t.mock.method(Date, 'now', () => nowRef.at);
  const store = createMemorySocialStore();
  const accounts = createAccountService(store, { now: () => nowRef.at });
  const friends = createFriendService(store, { now: () => nowRef.at });
  const core = createGameCore({ maps, cars: cars3, leaderboard: { submit: async () => ({ saved: true }) }, accounts, friends, countdownMs: 100, raceLimitMs: 5000 });
  const subs = ['one', 'two'].map(name => accounts.createAccount(name).sub);
  const login = (ws) => { const sub = ws === sockets.a ? subs[0] : subs[1]; core.message(ws, JSON.stringify({ type: 'auth', ticket: accounts.createTicket(sub).ticket })); };
  const sockets = { a: socket(), b: socket() };
  core.connect(sockets.a, 'one', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(sockets.b, 'two', { protocol: MULTIPLAYER_PROTOCOL });
  return { core, accounts, friends, subs, nowRef, ...sockets, login, send: (ws, m) => core.message(ws, JSON.stringify(m)) };
}

test('ticket auth links the username plate; allow-lists coerce and reject; stats and recent accrue', t => {
  const { core, accounts, friends, subs, nowRef, a, b, login, send } = socialCore(t);
  assert.match(a.messages.at(-1).type, /discovery/);
  send(a, { type: 'auth', ticket: 'bogus' }); assert.match(a.messages.at(-1).message, /ticket/);
  login(a); login(b);
  assert.equal([...a.messages].reverse().find(m => m.type === 'account').account.username, 'ONE');
  send(a, { type: 'create', name: 'Alice', car: 'carrera', allowedCars: ['mini', 'z4'] });
  let lobby = a.messages.at(-1).lobby;
  assert.equal(lobby.players[0].plate, 'ONE', 'plate is the username');
  assert.deepEqual(lobby.allowedCars, ['mini', 'z4']);
  assert.equal(lobby.players[0].car, 'mini', 'a disallowed create car is coerced');
  send(b, { type: 'join', code: lobby.code, name: 'Bob', car: 'carrera' });
  lobby = b.messages.at(-1).lobby;
  assert.equal(lobby.players.find(p => p.name === 'Bob').car, 'mini', 'a disallowed join car is coerced');
  assert.equal(lobby.players.find(p => p.name === 'Bob').plate, 'TWO');
  send(b, { type: 'ready', ready: false, version: 'coast', car: 'carrera' });
  assert.match(b.messages.at(-1).message, /not allowed/);
  send(a, { type: 'options', allowedCars: [] }); assert.match(a.messages.at(-1).message, /at least one/);
  send(a, { type: 'options', allowedCars: ['mini', 'nope'] });
  assert.deepEqual(a.messages.at(-1).lobby.allowedCars, ['mini'], 'unknown ids are dropped, never stored');
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' });
  const race = a.messages.at(-1).lobby; assert.equal(race.status, 'countdown');
  nowRef.at = 500000 + 101; core.tick();
  send(a, { type: 'state', raceId: race.raceId, state: state(15) });
  send(b, { type: 'state', raceId: race.raceId, state: state(15) });
  const done = a.messages.at(-1).lobby;
  assert.equal(done.status, 'results');
  const s1 = accounts.get(subs[0]).stats;
  assert.deepEqual([s1.started, s1.finished, s1.wins, s1.podiums, s1.km], [1, 1, 1, 0, 0.015]);
  assert.equal(s1.best['riviera|quick|mini|0'], done.players.find(p => p.name === 'Alice').finish);
  assert.deepEqual(friends.recent(subs[0]).map(u => u.username), ['TWO'], 'shared races make recent players');
});

test('presence rides lobby transitions: menu, lobby, racing, offline', t => {
  const { core, friends, subs, a, b, login, send } = socialCore(t);
  login(a); login(b);
  friends.request(subs[0], 'two'); friends.accept(subs[1], 'one');
  const lastFriends = () => [...a.messages].reverse().find(m => m.type === 'friends');
  send(a, { type: 'create', name: 'Alice' });
  const code = [...a.messages].reverse().find(m => m.type === 'lobby').lobby.code;
  send(b, { type: 'join', code, name: 'Bob' });
  let snap = lastFriends();
  assert.equal(snap.friends[0].username, 'TWO');
  assert.equal(snap.friends[0].presence.online, true);
  assert.equal(snap.friends[0].presence.activity, 'lobby');
  assert.equal(snap.friends[0].presence.lobbyCode, code);
  assert.equal(snap.friends[0].presence.joinable, true);
  for (const ws of [a, b]) send(ws, { type: 'ready', ready: true, version: 'coast' });
  send(a, { type: 'start' });
  snap = lastFriends();
  assert.equal(snap.friends[0].presence.activity, 'racing');
  assert.equal(snap.friends[0].presence.joinable, false);
  send(b, { type: 'leave' });
  snap = lastFriends();
  assert.equal(snap.friends[0].presence.activity, 'menu');
  core.disconnect(b);
  snap = lastFriends();
  assert.equal(snap.friends[0].presence.online, false);
});

test('accumulated big frontal crashes share the client mechanical wreck threshold',t=>{
  let now=900000;t.mock.method(Date,'now',()=>now);
  const core=createGameCore({maps,cars,leaderboard:{submit:async()=>assert.fail('wreck cannot record a time')},countdownMs:100});
  const a=socket(),b=socket();core.connect(a,'one',{protocol:MULTIPLAYER_PROTOCOL});core.connect(b,'two',{protocol:MULTIPLAYER_PROTOCOL});
  const id=a.messages.find(m=>m.type==='hello').id,send=(ws,m)=>core.message(ws,JSON.stringify(m));
  send(a,{type:'create'});const code=a.messages.at(-1).lobby.code;send(b,{type:'join',code});
  for(const ws of [a,b])send(ws,{type:'ready',ready:true,version:'coast'});
  send(a,{type:'start'});const raceId=a.messages.at(-1).lobby.raceId;now+=2100;core.tick();
  send(a,{type:'dnf',raceId,reason:'wrecked',impactEbs:60/3.6,impactMechanical:.97});assert.equal(core.lobbies.get(code).players.get(id).dnf,false);
  send(a,{type:'dnf',raceId,reason:'wrecked',impactEbs:60/3.6,impactMechanical:.98});assert.equal(core.lobbies.get(code).players.get(id).dnf,'wrecked');assert.equal(core.lobbies.get(code).players.get(id).finish,null);
});
