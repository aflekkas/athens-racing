import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from './index.mjs';

async function setup(t, opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paraliaki-test-')); await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/map.json'), JSON.stringify({ route: { start: 0, finish: 15, x: [0, 15] }, marks: ['astir', 'lake', 'limanakia', 'varkiza', 'coast', 'lomvarda'].map((id, i) => ({ id, name: id, s: i * 2 + 1 })) }));
  await writeFile(join(root, 'index.html'), '<h1>Racing</h1>');
  const app = await createGameServer({ root, countdownMs: 60, raceLimitMs: 500, reconnectGraceMs: 0, ...opts });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  async function client(name) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws'); const inbox = [], waiting = [];
    ws.on('message', data => { const m = JSON.parse(data); const i = waiting.findIndex(w => w.pred(m)); if (i >= 0) waiting.splice(i, 1)[0].resolve(m); else inbox.push(m); });
    const next = pred => new Promise((resolve, reject) => { const i = inbox.findIndex(pred); if (i >= 0) return resolve(inbox.splice(i, 1)[0]); const timer = setTimeout(() => reject(new Error('Message timeout')), 2000); waiting.push({ pred, resolve: m => { clearTimeout(timer); resolve(m); } }); });
    const hello = await next(m => m.type === 'hello');
    return { ws, id: hello.id, token: hello.token, version: hello.track.version, next, send: m => ws.send(JSON.stringify({ name, car: 'mini', ...m })) };
  }
  return { app, base, client };
}
const room = c => c.next(m => m.type === 'lobby');
async function pair(env) {
  const a = await env.client('Alice'), b = await env.client('Bob'); a.send({ type: 'create', lobbyName: 'Coast sprint' });
  const l = (await room(a)).lobby; b.send({ type: 'join', code: l.code }); await room(b); await room(a);
  return { a, b, code: l.code };
}
async function readyAndStart(a, b) {
  a.send({ type: 'ready', ready: true, version: a.version }); await room(a); await room(b);
  b.send({ type: 'ready', ready: true, version: b.version }); await room(a); await room(b);
  a.send({ type: 'start' }); const l = (await room(a)).lobby; await room(b); return l;
}
const state = s => ({ x: s, y: 0, z: 0, yaw: 0, s, u: 2, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2 });

test('public discovery, ready checks, synchronized start, replication, finish and rematch', async t => {
  const env = await setup(t); const { a, b, code } = await pair(env);
  assert.equal((await (await fetch(env.base + '/api/lobbies')).json())[0].code, code);
  b.send({ type: 'start' }); assert.match((await b.next(m => m.type === 'error')).message, /host/);
  a.send({ type: 'start' }); assert.match((await a.next(m => m.type === 'error')).message, /ready/);
  const l = await readyAndStart(a, b); assert.equal(l.status, 'countdown');
  const ar = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
  const br = (await b.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
  assert.equal(ar.startAt, br.startAt); assert.equal(ar.raceId, br.raceId);
  a.send({ type: 'state', raceId: l.raceId, state: state(5) });
  const snap = await b.next(m => m.type === 'snapshot' && m.players.some(p => p.id === a.id && p.state?.s === 5));
  assert.equal(snap.players.find(p => p.id === a.id).state.x, 5);
  a.send({ type: 'state', raceId: l.raceId, state: state(15) }); b.send({ type: 'state', raceId: l.raceId, state: state(15) });
  const result = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'results')).lobby;
  assert.ok(result.players.every(p => p.finish >= 0 && !p.dnf));
  a.send({ type: 'rematch' }); const rematch = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'waiting')).lobby;
  assert.equal(rematch.raceId, null); assert.ok(rematch.players.every(p => !p.ready && p.finish === null));
});
test('private rooms, track mismatch, countdown cancellation, host transfer and cleanup', async t => {
  const env = await setup(t); const a = await env.client('Alice'), b = await env.client('Bob');
  a.send({ type: 'create', private: true, car: 'z4' }); const created = (await room(a)).lobby; const code = created.code;
  assert.equal(created.players[0].car, 'z4');
  assert.deepEqual(await (await fetch(env.base + '/api/lobbies')).json(), []);
  b.send({ type: 'join', code }); await room(b); await room(a);
  a.send({ type: 'ready', ready: true, version: 'stale' }); assert.match((await a.next(m => m.type === 'error')).message, /track changed/);
  await readyAndStart(a, b); b.send({ type: 'leave' }); await b.next(m => m.type === 'left');
  const waiting = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'waiting')).lobby;
  assert.equal(waiting.startAt, null); assert.equal(waiting.players[0].ready, false);
  b.send({ type: 'join', code }); await room(b); await room(a); a.ws.close();
  const transferred = (await b.next(m => m.type === 'lobby' && m.lobby.host === b.id)).lobby;
  assert.equal(transferred.players.length, 1);
  b.send({ type: 'leave' }); await b.next(m => m.type === 'left'); assert.equal(env.app.lobbies.size, 0);
});
test('rejects live joins, stale race packets and teleports; expires unfinished races', async t => {
  const env = await setup(t); const { a, b, code } = await pair(env); const outsider = await env.client('Chris');
  const l = await readyAndStart(a, b); outsider.send({ type: 'join', code }); assert.match((await outsider.next(m => m.type === 'error')).message, /already racing/);
  await a.next(m => m.type === 'lobby' && m.lobby.status === 'race');
  a.send({ type: 'state', raceId: 'old-race', state: state(15) }); a.send({ type: 'state', raceId: l.raceId, state: state(400) });
  const r = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'results')).lobby;
  assert.ok(r.players.every(p => p.finish === null && p.dnf));
});
test('static server exposes game files and health without repository metadata', async t => {
  const { base } = await setup(t);
  assert.equal((await fetch(base + '/')).status, 200); assert.equal((await (await fetch(base + '/health')).json()).ok, true);
  for (const path of ['/.git/config', '/server/index.mjs', '/package.json', '/src/../../package.json']) assert.equal((await fetch(base + path)).status, 404);
});

test('eight-driver capacity, discovery counts and independent lobby snapshots', async t => {
  const env = await setup(t, { raceLimitMs: 5000 });
  const { a, b, code } = await pair(env);
  const others = [];
  for (let i = 0; i < 6; i++) {
    const c = await env.client('Driver ' + i); c.send({ type: 'join', code });
    const joined = (await room(c)).lobby;
    assert.equal(joined.players.length, i + 3); others.push(c);
  }
  const outsider = await env.client('Outsider'); outsider.send({ type: 'join', code });
  assert.match((await outsider.next(m => m.type === 'error')).message, /full/);
  outsider.send({ type: 'create', lobbyName: 'Separate race' });
  const separate = (await room(outsider)).lobby;
  const discovered = await (await fetch(env.base + '/api/lobbies')).json();
  assert.equal(discovered.find(l => l.code === code).players.length, 8);
  assert.equal(discovered.find(l => l.code === separate.code).players.length, 1);
  for (const c of [a, b, ...others]) c.send({ type: 'ready', ready: true, version: c.version });
  await a.next(m => m.type === 'lobby' && m.lobby.players.every(p => p.ready));
  a.send({ type: 'start' });
  const race = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
  a.send({ type: 'state', raceId: race.raceId, state: state(5) });
  const replicated = await others[5].next(m => m.type === 'snapshot' && m.players.some(p => p.id === a.id && p.state?.s === 5));
  assert.equal(replicated.players.length, 8);
  assert.equal(env.app.lobbies.get(separate.code).status, 'waiting');
  assert.equal(env.app.lobbies.get(separate.code).players.size, 1);
});

test('race results retain a finisher who disconnects before the other driver finishes', async t => {
  const env = await setup(t, { raceLimitMs: 5000 }); const { a, b } = await pair(env);
  const l = await readyAndStart(a, b); await a.next(m => m.type === 'lobby' && m.lobby.status === 'race');
  a.send({ type: 'state', raceId: l.raceId, state: state(15) });
  const finished = (await b.next(m => m.type === 'lobby' && m.lobby.players.some(p => p.id === a.id && p.finish !== null))).lobby.players.find(p => p.id === a.id);
  a.ws.close(); await b.next(m => m.type === 'lobby' && m.lobby.players.length === 1);
  b.send({ type: 'state', raceId: l.raceId, state: state(15) });
  const results = (await b.next(m => m.type === 'lobby' && m.lobby.status === 'results')).lobby;
  assert.equal(results.results.length, 2);
  const winner = results.results.find(p => p.id === a.id);
  assert.equal(winner.finish, finished.finish); assert.equal(winner.dnf, false); assert.equal(winner.disconnected, true);
  b.send({ type: 'rematch' }); const waiting = (await b.next(m => m.type === 'lobby' && m.lobby.status === 'waiting')).lobby;
  assert.equal(waiting.results, null); assert.equal(waiting.players.length, 1);
});

test('dropped driver rejoins the same live race with token, state, identity and finish intact', async t => {
  const env = await setup(t, { reconnectGraceMs: 1000, raceLimitMs: 5000 }); const { a, b } = await pair(env);
  const l = await readyAndStart(a, b); await a.next(m => m.type === 'lobby' && m.lobby.status === 'race');
  a.send({ type: 'state', raceId: l.raceId, state: { ...state(5), nitro: 0.07, damage: { front: 0.6, rear: 0, left: 0.2, right: 0 } } });
  await b.next(m => m.type === 'snapshot' && m.players.some(p => p.id === a.id && p.state?.s === 5));
  a.ws.terminate();
  const dropped = (await b.next(m => m.type === 'lobby' && m.lobby.players.some(p => p.id === a.id && !p.connected))).lobby;
  assert.equal(dropped.players.length, 2); assert.equal(dropped.host, b.id);
  const rejoined = await env.client('Reloaded'); rejoined.send({ type: 'resume', token: a.token });
  const session = await rejoined.next(m => m.type === 'session'); assert.equal(session.resumed, true); assert.equal(session.id, a.id);
  const restored = await rejoined.next(m => m.type === 'lobby' && m.resume);
  assert.equal(restored.lobby.raceId, l.raceId); assert.equal(restored.state.s, 5); assert.equal(restored.state.nitro, 0.07); assert.equal(restored.state.damage.front, 0.6); assert.equal(restored.lobby.players.find(p => p.id === a.id).name, 'Alice');
  rejoined.send({ type: 'state', raceId: l.raceId, state: state(15) });
  const finished = (await b.next(m => m.type === 'lobby' && m.lobby.players.some(p => p.id === a.id && p.finish != null))).lobby.players.find(p => p.id === a.id).finish;
  rejoined.send({ type: 'state', raceId: l.raceId, state: state(20) });
  const coast = await b.next(m => m.type === 'snapshot' && m.players.some(p => p.id === a.id && p.state?.s === 20));
  assert.equal(coast.players.find(p => p.id === a.id).finish, finished);
  rejoined.ws.terminate(); const again = await env.client('Second reload'); again.send({ type: 'resume', token: a.token });
  const second = await again.next(m => m.type === 'lobby' && m.resume);
  assert.equal(second.state.s, 20); assert.equal(second.lobby.players.find(p => p.id === a.id).finish, finished);
});

test('invalid/expired tokens cannot recover a race and explicit leave releases the seat', async t => {
  const env = await setup(t, { reconnectGraceMs: 100 }); const { a, b, code } = await pair(env);
  const wrong = await env.client('Wrong'); wrong.send({ type: 'resume', token: 'invalid-token' });
  assert.equal((await wrong.next(m => m.type === 'session')).resumed, false);
  a.ws.terminate(); await b.next(m => m.type === 'lobby' && m.lobby.players.length === 1);
  wrong.send({ type: 'resume', token: a.token }); assert.equal((await wrong.next(m => m.type === 'session')).resumed, false);
  b.send({ type: 'leave' }); await b.next(m => m.type === 'left');
  const reload = await env.client('Reload'); reload.send({ type: 'resume', token: b.token });
  const session = await reload.next(m => m.type === 'session'); assert.equal(session.resumed, true); assert.equal(session.lobby, false);
  assert.equal(env.app.lobbies.has(code), false);
});

test('host route/traffic choices clear ready votes; reverse finish follows event direction', async t => {
  const env = await setup(t, { raceLimitMs: 5000 }); const { a, b } = await pair(env);
  b.send({ type: 'options', eventId: 'return-leg', traffic: true }); assert.match((await b.next(m => m.type === 'error')).message, /host/);
  a.send({ type: 'ready', ready: true, version: a.version }); await room(a); await room(b);
  a.send({ type: 'options', eventId: 'return-leg', traffic: true });
  const changed = (await room(a)).lobby; await room(b);
  assert.equal(changed.event.dir, -1); assert.equal(changed.traffic, true); assert.ok(changed.players.every(p => !p.ready));
  const l = await readyAndStart(a, b); await a.next(m => m.type === 'lobby' && m.lobby.status === 'race');
  a.send({ type: 'state', raceId: l.raceId, state: state(10) });
  await b.next(m => m.type === 'snapshot' && m.players.some(p => p.id === a.id && p.state?.s === 10));
  assert.equal(env.app.lobbies.get(l.code).players.get(a.id).finish, null);
  await new Promise(r => setTimeout(r, 120));
  a.send({ type: 'state', raceId: l.raceId, state: state(0) }); b.send({ type: 'state', raceId: l.raceId, state: state(0) });
  const completed = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'results')).lobby;
  assert.ok(completed.players.every(p => p.finish != null));
  await env.app.leaderboard.flush();
  const times = await (await fetch(env.base + '/api/leaderboard?eventId=return-leg&car=mini&traffic=true')).json();
  assert.equal(times.length, 2); assert.ok(times.every(e => e.source === 'online' && e.routeKey === '15>0'));
});

test('leaderboard HTTP rejects invalid times, aborted runs, unknown cars, cross-origin and oversized requests; rate limits POST', async t => {
  const env = await setup(t);
  const result = { driverId: 'browser-driver-1', name: 'Alice', eventId: 'quick', car: 'mini', time: 2, valid: true };
  const post = (body, headers = {}) => fetch(env.base + '/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await post({ ...result, time: 0.001 })).status, 400);
  assert.equal((await post({ ...result, valid: false })).status, 400);
  assert.equal((await post({ ...result, car: 'imaginary' })).status, 400);
  assert.equal((await post(result, { Origin: 'https://another-host.example' })).status, 403);
  assert.equal((await post(' '.repeat(5000))).status, 413);
  assert.equal((await post(result)).status, 200);
  const times = await (await fetch(env.base + '/api/leaderboard?eventId=quick&car=mini')).json();
  assert.equal(times.length, 1); assert.equal(times[0].time, 2); assert.equal(times[0].driverId, undefined);
  for (let i = 0; i < 7; i++) await post(result);
  assert.equal((await post(result)).status, 429);
  assert.equal((await fetch(env.base + '/.data/leaderboard.json')).status, 404);
});

test('session switching cannot orphan a joined lobby or retain duplicate live sockets', async t => {
  const env = await setup(t, { reconnectGraceMs: 500 });
  const a = await env.client('Alice'); a.send({ type: 'create' }); await room(a);
  const b = await env.client('Bob'); b.send({ type: 'create' }); const own = (await room(b)).lobby;
  b.send({ type: 'resume', token: a.token }); assert.match((await b.next(m => m.type === 'error')).message, /Leave/);
  assert.equal(env.app.lobbies.get(own.code).players.get(b.id).connected, true);
  b.send({ type: 'leave' }); await b.next(m => m.type === 'left');
  b.send({ type: 'resume', token: a.token }); const session = await b.next(m => m.type === 'session'); assert.equal(session.id, a.id);
  await b.next(m => m.type === 'lobby' && m.resume);
  b.send({ type: 'leave' }); await b.next(m => m.type === 'left'); assert.equal(env.app.lobbies.size, 0);
});

test('all ten catalogue cars can switch while waiting; race car changes are locked', async t => {
  const env = await setup(t, { raceLimitMs: 5000 }); const { a, b } = await pair(env);
  for (const car of ['mini', 'z4', 'taxi', 'carrera', 'gr_yaris', 'gtv', 'golf', 'corolla', 'superb', 'police_octavia', 'mini_jcw', 'huracan', 'cle']) {
    a.send({ type: 'ready', ready: false, version: a.version, car }); const changed = (await room(a)).lobby; await room(b);
    assert.equal(changed.players.find(p => p.id === a.id).car, car);
  }
  const l = await readyAndStart(a, b); a.send({ type: 'ready', ready: false, version: a.version, car: 'z4' });
  assert.match((await a.next(m => m.type === 'error')).message, /already started/);
  assert.equal(env.app.lobbies.get(l.code).players.get(a.id).car, l.players.find(p => p.id === a.id).car);
});

test('departing host hands control to a connected driver ahead of reserved disconnected seats', async t => {
  const env = await setup(t, { reconnectGraceMs: 1000 }); const { a, b, code } = await pair(env);
  const c = await env.client('Charlie'); c.send({ type: 'join', code }); await room(c);
  a.ws.terminate(); await b.next(m => m.type === 'lobby' && m.lobby.host === b.id);
  b.send({ type: 'leave' }); await b.next(m => m.type === 'left');
  const roomC = (await c.next(m => m.type === 'lobby' && m.lobby.host === c.id)).lobby;
  assert.equal(roomC.players.find(p => p.id === a.id).connected, false);
  c.send({ type: 'options', eventId: 'return-leg', traffic: false });
  assert.equal((await c.next(m => m.type === 'lobby' && m.lobby.eventId === 'return-leg')).lobby.host, c.id);
});
