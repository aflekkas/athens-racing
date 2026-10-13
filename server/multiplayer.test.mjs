import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from './index.mjs';

async function setup(t, opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paraliaki-test-')); await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/map.json'), JSON.stringify({ route: { start: 0, finish: 15, x: [0, 15] } }));
  await writeFile(join(root, 'index.html'), '<h1>Racing</h1>');
  const app = await createGameServer({ root, countdownMs: 60, raceLimitMs: 500, ...opts });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  async function client(name) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws'); const inbox = [], waiting = [];
    ws.on('message', data => { const m = JSON.parse(data); const i = waiting.findIndex(w => w.pred(m)); if (i >= 0) waiting.splice(i, 1)[0].resolve(m); else inbox.push(m); });
    const next = pred => new Promise((resolve, reject) => { const i = inbox.findIndex(pred); if (i >= 0) return resolve(inbox.splice(i, 1)[0]); const timer = setTimeout(() => reject(new Error('Message timeout')), 2000); waiting.push({ pred, resolve: m => { clearTimeout(timer); resolve(m); } }); });
    const hello = await next(m => m.type === 'hello');
    return { ws, id: hello.id, version: hello.track.version, next, send: m => ws.send(JSON.stringify({ name, car: 'mini', ...m })) };
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
