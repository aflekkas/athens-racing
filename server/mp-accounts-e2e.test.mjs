// Two real (stubbed-Google) signed-in drivers play a whole online race over the Node server:
// real ar_session cookies on /api/lobbies and the /ws upgrade; host, browse, join by code, start, race, finish, results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from './index.mjs';
import { accountsStub } from './accounts-stub.mjs';
import { MULTIPLAYER_PROTOCOL, AUTH_CLOSE_CODE, UPDATE_CLOSE_CODE } from '../src/multiplayer-protocol.js';
import { resolveMap } from './map-definitions.mjs';
import { MAPS } from '../src/map-catalog.js';
import { smokeDrive } from '../tools/deploy-smoke-route.mjs';

// Mirrors src/multiplayer.js: hello + ping on open, then the account name.
function player(base, auth) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws?protocol=' + MULTIPLAYER_PROTOCOL, { headers: { Cookie: auth.cookie } });
  const inbox = [], waiting = [];
  ws.on('message', data => { const m = JSON.parse(data); const i = waiting.findIndex(w => w.pred(m)); if (i >= 0) waiting.splice(i, 1)[0].resolve(m); else inbox.push(m); });
  const closed = new Promise(resolve => ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })));
  const next = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const i = inbox.findIndex(pred); if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
    const timer = setTimeout(() => reject(new Error('Message timeout')), ms);
    waiting.push({ pred, resolve: m => { clearTimeout(timer); resolve(m); } });
  });
  const send = m => ws.send(JSON.stringify(m));
  return new Promise((resolve, reject) => {
    ws.on('unexpected-response', (_, response) => reject(new Error('Upgrade refused: ' + response.statusCode)));
    ws.on('error', reject);
    ws.on('open', async () => { send({ type: 'hello', protocol: MULTIPLAYER_PROTOCOL }); send({ type: 'ping', sent: Date.now() }); resolve({ ws, send, next, closed, hello: await next(m => m.type === 'hello') }); });
  });
}
async function arena(t) {
  const stub = accountsStub('http://127.0.0.1');
  const dataDir = await mkdtemp(join(tmpdir(), 'mp-accounts-e2e-'));
  const app = await createGameServer({ accountEnv: stub.env, dataDir, countdownMs: 60 });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  return { stub, base: 'http://127.0.0.1:' + app.server.address().port };
}

test('two signed-in drivers host, browse, join by code, race to the finish and see results', async t => {
  const { stub, base } = await arena(t);
  const alice = await stub.signIn('alice-sub', 'ALICE'), bob = await stub.signIn('bob-sub', 'BOBBY');
  const listing = auth => fetch(base + '/api/lobbies', { headers: { Cookie: auth.cookie } });
  assert.equal((await fetch(base + '/api/lobbies')).status, 401, 'anonymous discovery stays closed');
  assert.deepEqual(await (await listing(bob)).json(), []);

  const a = await player(base, alice), b = await player(base, bob);
  const def = MAPS.find(m => m.id === 'psychiko'), map = resolveMap(def, JSON.parse(await readFile(new URL('../' + def.dataUrl, import.meta.url), 'utf8')));
  const event = map.definitions.get('psychiko-race');
  a.send({ type: 'name', name: 'IGNORED' }); a.send({ type: 'create', mapId: 'psychiko', eventId: event.id, lobbyName: 'Real lobby' });
  const created = (await a.next(m => m.type === 'lobby')).lobby;
  assert.equal(created.players[0].name, 'ALICE', 'the server binds the signed-in account name');
  assert.deepEqual((await (await listing(bob)).json()).map(l => l.code), [created.code]);
  b.send({ type: 'discover' });
  assert.deepEqual((await b.next(m => m.type === 'discovery' && m.lobbies.length === 1)).lobbies.map(l => l.code), [created.code]);
  b.send({ type: 'join', code: created.code });
  assert.deepEqual((await b.next(m => m.type === 'lobby')).lobby.players.map(p => p.name).sort(), ['ALICE', 'BOBBY']);

  for (const c of [a, b]) c.send({ type: 'ready', ready: true, version: map.track.version });
  await a.next(m => m.type === 'lobby' && m.lobby.players.every(p => p.ready));
  a.send({ type: 'start' });
  const race = (await b.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
  const drive = smokeDrive(race.event, map.geometry);
  // Two samples per 100 ms packet at the drive's own speed, on a clock the test advances, so the race runs in a blink.
  const realNow = Date.now.bind(Date); let skew = Math.max(0, race.startAt - realNow()) + 50;
  t.mock.method(Date, 'now', () => realNow() + skew);
  for (let i = 0; i < drive.samples.length; i += 2) {
    skew += 100;
    for (const c of [a, b]) c.send({ type: 'states', raceId: race.raceId, states: drive.samples.slice(i, i + 2) });
    await new Promise(r => setImmediate(r));
  }
  const [ra, rb] = await Promise.all([a, b].map(c => c.next(m => m.type === 'lobby' && m.lobby.status === 'results', 15000)));
  assert.equal(ra.lobby.results.length, 2); assert.ok(ra.lobby.results.every(p => Number.isFinite(p.finish) && !p.dnf));
  assert.deepEqual(rb.lobby.results.map(p => p.name).sort(), ['ALICE', 'BOBBY']);
  a.ws.close(); b.ws.close();
});

test('a revoked account session closes the socket with the sign-in code, never the update code', async t => {
  const { stub, base } = await arena(t);
  const alice = await stub.signIn('alice-sub', 'ALICE'), a = await player(base, alice);
  stub.sqlite.exec('DELETE FROM sessions');
  a.send({ type: 'ping', sent: 1 });
  const closed = await a.closed;
  assert.equal(closed.code, AUTH_CLOSE_CODE); assert.notEqual(closed.code, UPDATE_CLOSE_CODE);
});
