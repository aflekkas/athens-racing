import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGameServer } from './index.mjs';
import { createGameCore } from './core.mjs';
import { authorizeGame, identityActive } from './auth-policy.mjs';
import { SMOKE_HEADER, SMOKE_TTL_MS, canSaveResults, constantTimeEqual, smokeName, smokePayload, smokeSession } from './smoke-session.mjs';
import { smokeClient, signSmokeSession } from '../tools/resumable-smoke-client.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';

const SECRET = 'node-smoke-test-secret-0123456789abcdef';
const OAUTH = { GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test' };
const env = extra => ({ ...OAUTH, SMOKE_TOKEN: SECRET, ...extra });
const nonce = () => randomBytes(16).toString('hex');
const sign = (secret, payload) => payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
const request = (headers = {}, path = '/ws') => new Request('https://staging.athensracing.com' + path, { headers });

test('a valid smoke token authenticates live play with a fixed SMOKE name and a bounded lifetime', async () => {
  const n = nonce(), token = signSmokeSession(SECRET, n);
  const auth = await authorizeGame(request({ [SMOKE_HEADER]: token }), env());
  assert.equal(auth.response, undefined);
  assert.equal(auth.identity.smoke, true);
  assert.equal(auth.identity.name, smokeName(n)); assert.match(auth.identity.name, /^SMOKE-\d{3}$/);
  assert.ok(auth.identity.expires - Date.now() <= SMOKE_TTL_MS);
  assert.equal(await identityActive(auth.identity, env()), true);
  // Turning the credential off closes the socket at its next message, even before expiry.
  assert.equal(await identityActive(auth.identity, env({ SMOKE_TOKEN: undefined })), false);
});

test('forged, tampered, expired, over-long and malformed smoke tokens are rejected', async () => {
  const now = Date.now(), n = nonce(), good = signSmokeSession(SECRET, n, now);
  assert.notEqual(await smokeSession(request({ [SMOKE_HEADER]: good }), env(), now), null);
  const rejected = {
    'signed by another secret': sign('another-secret-0123456789abcdefghijkl', smokePayload(n, now + 60000)),
    'expiry extended after signing': good.replace(/:(\d+)\./, (_, expires) => `:${Number(expires) + 60000}.`),
    'expired': signSmokeSession(SECRET, n, now - 11 * 60000),
    'valid signature beyond ten minutes': sign(SECRET, smokePayload(n, now + SMOKE_TTL_MS + 60000)),
    'non-hex nonce': sign(SECRET, `smoke:${'z'.repeat(32)}:${now + 60000}`),
    'missing signature': good.slice(0, good.lastIndexOf('.')),
    'empty header': '',
    'oversized header': 'x'.repeat(300) + '.' + 'y',
  };
  for (const [name, value] of Object.entries(rejected)) {
    assert.equal(await smokeSession(request({ [SMOKE_HEADER]: value }), env(), now), null, name);
    assert.equal((await authorizeGame(request({ [SMOKE_HEADER]: value }), env())).response?.status, 401, name);
  }
  assert.equal(await smokeSession(request({}), env(), now), null, 'absent header');
});

test('unset or short SMOKE_TOKEN disables the smoke path completely', async () => {
  const n = nonce(), token = signSmokeSession(SECRET, n);
  for (const extra of [{ SMOKE_TOKEN: undefined }, { SMOKE_TOKEN: '' }, { SMOKE_TOKEN: 'short' }]) {
    assert.equal((await authorizeGame(request({ [SMOKE_HEADER]: token }), env(extra))).response?.status, 401, JSON.stringify(extra));
  }
  // A token minted with a short configured value is never accepted either.
  assert.equal(await smokeSession(request({ [SMOKE_HEADER]: signSmokeSession('short', n) }), env({ SMOKE_TOKEN: 'short' })), null);
  // Real sign-in is still required without a smoke session.
  assert.equal((await authorizeGame(request({}), env({ SMOKE_TOKEN: undefined }))).response?.status, 401);
});

test('smoke sessions reach only live play and discovery, never account or friends routes', async () => {
  const token = signSmokeSession(SECRET, nonce());
  for (const path of ['/ws', '/api/lobbies', '/api/leaderboard']) {
    assert.equal((await authorizeGame(request({ [SMOKE_HEADER]: token }, path), env())).identity?.smoke, true, path);
  }
  for (const path of ['/api/account/presence', '/api/account/export', '/api/account/profile', '/api/auth/session']) {
    const auth = await authorizeGame(request({ [SMOKE_HEADER]: token }, path), env());
    assert.equal(auth.response?.status, 401, path); assert.equal(auth.identity, undefined, path);
  }
});

test('smoke identities cannot save leaderboard records and signatures compare exactly', () => {
  assert.equal(canSaveResults({ smoke: true, userId: 'smoke-0123456789abcdef' }), false);
  assert.equal(canSaveResults({ userId: 'account-user-1' }), true);
  assert.equal(canSaveResults(null), true);
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('', ''), true);
});

test('Node server under OAuth: smoke client connects, bad or missing credentials fail fast, smoke lobbies stay unlisted, and smoke results are refused', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'smoke-session-test-'));
  const app = await createGameServer({ accountEnv: env(), dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); });
  const connect = (name, smokeToken, recoveryMs) => { const c = smokeClient(base, name, { smokeToken, recoveryMs }); clients.push(c); return c; };

  const host = connect('smoke host', SECRET);
  await host.next(m => m.type === 'hello');
  host.send({ type: 'create', private: false, lobbyName: 'Smoke public' });
  const created = (await host.next(m => m.type === 'lobby')).lobby;
  assert.match(created.players[0].name, /^SMOKE-\d{3}$/);
  const listing = await (await fetch(base + '/api/lobbies', { headers: { [SMOKE_HEADER]: signSmokeSession(SECRET, nonce()) } })).json();
  assert.ok(!listing.some(l => l.code === created.code), 'smoke-hosted lobby must not be listed');
  assert.equal((await fetch(base + '/api/lobbies')).status, 401, 'discovery needs a session or smoke credential');

  const forged = connect('forged', 'f'.repeat(64), 60000);
  const started = Date.now();
  await assert.rejects(forged.next(m => m.type === 'hello', 5000), /smoke session rejected; SMOKE_TOKEN must match/);
  assert.ok(Date.now() - started < 5000, 'a rejected credential must not wait out recovery');

  const unset = connect('no token', '', 60000);
  await assert.rejects(unset.next(m => m.type === 'hello', 5000), /set SMOKE_TOKEN; see deploy\/README\.md/);

  const submit = await fetch(base + '/api/leaderboard', { method: 'POST', headers: { [SMOKE_HEADER]: signSmokeSession(SECRET, nonce()), 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: true }) });
  assert.equal(submit.status, 403);
  assert.deepEqual(await (await fetch(base + '/api/leaderboard', { headers: { [SMOKE_HEADER]: signSmokeSession(SECRET, nonce()) } })).json(), []);
  assert.equal((await fetch(base + '/api/account/presence', { headers: { [SMOKE_HEADER]: signSmokeSession(SECRET, nonce()) } })).status, 401);
  await host.close();
});

test('Node server without SMOKE_TOKEN keeps the smoke path disabled even for a correctly signed session', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'smoke-session-off-'));
  const app = await createGameServer({ accountEnv: { ...OAUTH }, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const client = smokeClient(base, 'disabled', { smokeToken: SECRET, recoveryMs: 60000 });
  t.after(() => client.close());
  await assert.rejects(client.next(m => m.type === 'hello', 5000), /smoke session rejected/);
  assert.equal((await fetch(base + '/api/lobbies')).status, 401);
});

// A synthetic one-sprint route keeps the race short. Non-smoke clients stand in for verified accounts.
async function syntheticArena(t) {
  const maps = new Map([['riviera', { track: { version: 'v' }, definitions: new Map([['quick', { id: 'quick', type: 'sprint', s0: 0, s1: 320, dir: 1, len: 320 }]]) }]]);
  const submitted = [];
  const core = createGameCore({ maps, cars: new Set(['mini']), leaderboard: { submit: async r => { submitted.push(r); return { saved: true }; } }, countdownMs: 0 });
  const server = http.createServer(), wss = new WebSocketServer({ server });
  const account = { userId: 'account-user-1', name: 'ACCOUNT', expires: Date.now() + 3600000, sessionToken: 'session' };
  wss.on('connection', async (ws, req) => {
    const smoke = req.headers[SMOKE_HEADER.toLowerCase()];
    const auth = smoke ? await authorizeGame(new Request('https://staging.athensracing.com/ws', { headers: req.headers }), env()) : { identity: account };
    if (auth.response) return ws.close(4401, 'Sign in');
    core.connect(ws, 'test', { protocol: MULTIPLAYER_PROTOCOL, identity: auth.identity });
    ws.on('message', m => core.message(ws, String(m)));
    ws.on('close', () => core.disconnect(ws));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, clients = [];
  const timer = setInterval(() => core.tick(), 10);
  t.after(async () => { clearInterval(timer); for (const c of clients) await c.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); });
  const client = (name, smokeToken) => { const c = smokeClient(base, name, { smokeToken }); clients.push(c); return c; };
  return { core, submitted, client };
}

test('smoke races finish without reaching the leaderboard while account races still submit', async t => {
  const { client, submitted } = await syntheticArena(t);
  const host = client('smoke host', SECRET), guest = client('account guest', '');
  await Promise.all([host.next(m => m.type === 'hello'), guest.next(m => m.type === 'hello')]);
  host.send({ type: 'create', private: true });
  const lobby = (await host.next(m => m.type === 'lobby')).lobby;
  guest.send({ type: 'join', code: lobby.code }); await guest.next(m => m.type === 'lobby');
  for (const c of [host, guest]) c.send({ type: 'ready', ready: true, version: 'v' });
  await host.next(m => m.type === 'lobby' && m.lobby.players.every(p => p.ready));
  host.send({ type: 'start' });
  const race = (await guest.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
  let s = 0;
  const drive = setInterval(() => {
    if (!host.available || !guest.available || s > 322) return;
    s = Math.min(322, s + 6);
    for (const c of [host, guest]) c.send({ type: 'state', raceId: race.raceId, state: { s, u: 0, x: s, y: 0, z: 0, yaw: 0, vLong: 120, vLat: 0, steer: 0, rpm: 3000, gear: 3 } });
  }, 10);
  try { await Promise.all([host, guest].map(c => c.next(m => m.type === 'lobby' && m.lobby.status === 'results', 15000))); } finally { clearInterval(drive); }
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].driverId, 'account-user-1');
  assert.equal(submitted[0].name, 'ACCOUNT');
});

test('smoke-hosted public lobbies stay out of discovery while account-hosted public lobbies stay listed', async t => {
  const { core, client } = await syntheticArena(t);
  const smoke = client('smoke host', SECRET), account = client('account host', '');
  await Promise.all([smoke.next(m => m.type === 'hello'), account.next(m => m.type === 'hello')]);
  smoke.send({ type: 'create', private: false });
  await smoke.next(m => m.type === 'lobby');
  account.send({ type: 'create', private: false });
  const listed = (await account.next(m => m.type === 'lobby')).lobby;
  assert.deepEqual(core.discover().lobbies.map(l => l.code), [listed.code]);
});
