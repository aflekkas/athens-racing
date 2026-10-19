// A real (stubbed-Google) signed-in driver on the Cloudflare path: Worker gate, GameArena upgrade,
// per-message session check, and the arena being rebuilt from storage after hibernation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { resolveMap } from '../server/map-definitions.mjs';
import { MAPS } from '../src/map-catalog.js';
import { accountsStub } from '../server/accounts-stub.mjs';
import { MULTIPLAYER_PROTOCOL, UPDATE_CLOSE_CODE, AUTH_CLOSE_CODE } from '../src/multiplayer-protocol.js';
import { smokeDrive } from '../tools/deploy-smoke-route.mjs';

const load = async id => { const def = MAPS.find(m => m.id === id); return resolveMap(def, JSON.parse(await readFile(new URL('../' + def.dataUrl, import.meta.url), 'utf8'))); };
const map = await load('megara');
const catalogue = { maps: await Promise.all(['riviera', 'megara'].map(async id => { const m = id === 'megara' ? map : await load(id); return { ...m, definitions: [...m.definitions] }; })), cars: ['mini'], nitrousCars: [], carSpecs: {} };
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '../.deploy/catalogue.json') return { url: 'data:text/javascript,export default ' + encodeURIComponent(JSON.stringify(catalogue)), shortCircuit: true };
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
  return next(specifier, context);
} });
// Node's Response refuses status 101; the Workers runtime allows it with a webSocket.
const NativeResponse = Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) { if (init?.status === 101) { super(null); Object.defineProperties(this, { status: { value: 101 }, webSocket: { value: init.webSocket } }); } else super(body, init); }
};
globalThis.WebSocketRequestResponsePair ??= class {};
const { default: worker, GameArena } = await import('../worker/index.mjs');

const origin = 'https://staging.athensracing.com';
function fakeSocket() {
  const socket = { readyState: 1, sent: [], attachment: null, closed: null,
    send(data) { socket.sent.push(JSON.parse(data)); }, close(code, reason) { socket.closed = { code, reason }; socket.readyState = 3; },
    serializeAttachment(value) { socket.attachment = structuredClone(value); }, deserializeAttachment: () => structuredClone(socket.attachment), accept() {}, addEventListener() {} };
  return socket;
}
globalThis.WebSocketPair = class { constructor() { this[0] = fakeSocket(); this[1] = fakeSocket(); } };
// Durable Object context: storage and socket attachments live outside the instance, as they do across hibernation.
function platform() {
  const sql = new DatabaseSync(':memory:'), kv = new Map(), sockets = [], state = { pending: null };
  const ctx = {
    storage: { get: async key => structuredClone(kv.get(key)), put: async (key, value) => { kv.set(key, structuredClone(value)); }, deleteAlarm: async () => {}, setAlarm: async () => {}, transactionSync: fn => fn(),
      sql: { exec(query, ...args) { if (query.includes(';')) { sql.exec(query); return []; } const q = sql.prepare(query); return q.columns().length ? q.all(...args) : (q.run(...args), []); } } },
    blockConcurrencyWhile: fn => (state.pending = Promise.resolve(fn())), setWebSocketAutoResponse() {}, getWebSockets: () => sockets.filter(s => s.readyState === 1), acceptWebSocket: ws => sockets.push(ws),
  };
  return { ctx, sockets, state };
}
function harness() {
  const stub = accountsStub(origin), p = platform();
  let instance = null;
  const arena = () => instance ||= new GameArena(p.ctx, env);
  const env = { ...stub.env, GAME: { idFromName: x => x, get: () => ({ fetch: async request => { const a = arena(); await p.state.pending; return a.fetch(request); } }) } };
  // Everything the platform keeps (storage, sockets, attachments) survives; the JS instance does not.
  const hibernate = async () => { instance = null; const a = arena(); await p.state.pending; return a; };
  const connect = async auth => {
    const response = await worker.fetch(new Request(origin + '/ws?protocol=' + MULTIPLAYER_PROTOCOL, { headers: { Upgrade: 'websocket', Cookie: auth.cookie } }), env);
    assert.equal(response.status, 101);
    const ws = p.sockets.at(-1); // the server end: what the arena sends to it is what the browser receives
    return { ws, inbox: ws.sent };
  };
  const send = async (c, m) => { await p.state.pending; await arena().webSocketMessage(c.ws, JSON.stringify(m)); };
  return { stub, env, arena, hibernate, connect, send };
}
const last = (c, pred) => [...c.inbox].reverse().find(pred);

test('an anonymous upgrade never reaches the arena; a signed-in one does', async () => {
  const h = harness(), alice = await h.stub.signIn('alice', 'ALICE');
  assert.equal((await worker.fetch(new Request(origin + '/ws', { headers: { Upgrade: 'websocket' } }), h.env)).status, 401);
  assert.equal((await worker.fetch(new Request(origin + '/api/lobbies'), h.env)).status, 401);
  assert.equal((await h.connect(alice)).inbox[0].type, 'hello');
});

test('two signed-in drivers still host, browse, join and race after the arena hibernates between steps', async t => {
  const h = harness(), alice = await h.stub.signIn('alice', 'ALICE'), bob = await h.stub.signIn('bob', 'BOBBY');
  const a = await h.connect(alice), b = await h.connect(bob), { send } = h;
  const closedCodes = () => [a, b].map(c => c.ws.closed?.code).filter(Boolean);
  await send(a, { type: 'hello', protocol: MULTIPLAYER_PROTOCOL }); await send(a, { type: 'name', name: 'IGNORED' });
  await send(a, { type: 'create', mapId: 'megara', lobbyName: 'Real lobby' });
  const created = last(a, m => m.type === 'lobby').lobby;
  assert.equal(created.players[0].name, 'ALICE');

  await h.hibernate();
  const browse = await worker.fetch(new Request(origin + '/api/lobbies', { headers: { Cookie: bob.cookie } }), h.env);
  assert.deepEqual((await browse.json()).map(l => l.code), [created.code]);
  await send(b, { type: 'join', code: created.code });
  assert.deepEqual(closedCodes(), [], 'a hibernated arena must not drop signed-in sockets');
  assert.deepEqual(last(b, m => m.type === 'lobby').lobby.players.map(p => p.name).sort(), ['ALICE', 'BOBBY']);

  for (const c of [a, b]) await send(c, { type: 'ready', ready: true, version: map.track.version });
  await h.hibernate();
  await send(a, { type: 'start' });
  const race = last(b, m => m.type === 'lobby' && ['countdown', 'race'].includes(m.lobby.status)).lobby;
  assert.ok(race.raceId);
  let now = race.startAt + 100; t.mock.method(Date, 'now', () => now);
  await h.arena().alarm();
  const drive = smokeDrive(race.event, map.geometry);
  for (let i = 0; i < drive.samples.length; i += 2) {
    now += 100; if (i === 100) await h.hibernate();
    for (const c of [a, b]) await send(c, { type: 'states', raceId: race.raceId, states: drive.samples.slice(i, i + 2) });
  }
  assert.deepEqual(closedCodes(), []);
  const results = last(a, m => m.type === 'lobby' && m.lobby.status === 'results');
  assert.ok(results, 'the race ends in results');
  assert.ok(results.lobby.results.every(p => Number.isFinite(p.finish) && !p.dnf));
  assert.deepEqual(results.lobby.results.map(p => p.name).sort(), ['ALICE', 'BOBBY']);
});

test('an expired or revoked account session closes the socket with a sign-in code the client does not mistake for an update', async () => {
  const h = harness(), alice = await h.stub.signIn('alice', 'ALICE'), a = await h.connect(alice);
  h.stub.sqlite.exec('DELETE FROM sessions');
  await h.send(a, { type: 'ping', sent: 1 });
  assert.equal(a.ws.closed?.code, AUTH_CLOSE_CODE);
  assert.notEqual(a.ws.closed.code, UPDATE_CLOSE_CODE, 'the client reloads the game on the update code; a sign-out must show the gate instead');
});
