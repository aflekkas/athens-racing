import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { getMap } from '../src/map-catalog.js';
import { verifySessionCatalogueWithRetry } from './deploy-smoke-catalogue.mjs';
import { checkDeployedEntry } from './deploy-smoke-assets.mjs';
import { smokeDrive, SMOKE_SPEED, SMOKE_STEP } from './deploy-smoke-route.mjs';
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('Usage: node tools/deploy-smoke.mjs https://worker.workers.dev [--race] [--map=riviera|megara|penteli]');
const raceProof = process.argv.includes('--race'), mapId = process.argv.find(v => v.startsWith('--map='))?.slice(6) || 'riviera';
const { build, entry } = await checkDeployedEntry(base);
const preview = await fetch(base + '/assets/maps/riviera.svg', { signal: AbortSignal.timeout(15000) });
assert.equal(preview.status, 200, `Map preview HTTP ${preview.status}`);
assert.ok((await preview.arrayBuffer()).byteLength, 'Map preview is empty');
for (const path of ['/server/core.mjs', '/tools/prepare-deploy.mjs', '/package.json', '/wrangler.jsonc', '/.git/config', '/chain.pid']) assert.equal((await fetch(base + path, { signal: AbortSignal.timeout(15000) })).status, 404, `${path} must remain private`);
const healthResponse = await fetch(base + '/health', { signal: AbortSignal.timeout(15000) });
assert.equal(healthResponse.status, 200);
console.log(JSON.stringify({ proof: 'health', base, entry, build: build || null, health: await healthResponse.json() }));
function client(name) {
  const url = new URL('/ws', base.replace(/^http/, 'ws'));
  url.searchParams.set('protocol', MULTIPLAYER_PROTOCOL);
  if (build) url.searchParams.set('build', build);
  const ws = new WebSocket(url, { origin: base }), identity = `smoke-${randomUUID()}`;
  const inbox = [], pending = new Set();
  let failure, lastState, checkpoint = null;
  const fail = error => {
    failure ||= error;
    for (const waiter of pending) { clearTimeout(waiter.timer); waiter.reject(failure); }
    pending.clear();
  };
  ws.on('message', bytes => {
    if (String(bytes) === 'alive') return;
    const m = JSON.parse(bytes);
    if (m.type === 'reload') return fail(new Error(`${name}: server requests reload (${m.reason}); protocol ${MULTIPLAYER_PROTOCOL}`));
    if (m.type === 'error') return fail(new Error(`${name}: ${JSON.stringify(m)}`));
    if (m.type === 'checkpoint') {
      checkpoint = m;
      if (m.missed) return fail(new Error(`${name}: legal smoke path rejected: ${JSON.stringify({ checkpoint: m, lastState })}`));
    }
    const waiter = [...pending].find(w => w.pred(m));
    if (waiter) { pending.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(m); }
    else if (m.type !== 'snapshot' && m.type !== 'checkpoint') inbox.push(m);
  });
  const next = (pred, timeout = 15000) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const index = inbox.findIndex(pred); if (index >= 0) return resolve(inbox.splice(index, 1)[0]);
    const waiter = { pred, resolve, reject, timer: setTimeout(() => { pending.delete(waiter); reject(new Error(`${name}: message timeout; checkpoint=${JSON.stringify(checkpoint)}; inbox=${JSON.stringify(inbox).slice(-1000)}`)); }, timeout) }; pending.add(waiter);
  });
  ws.on('error', e => fail(e));
  ws.on('close', (code, reason) => fail(new Error(`${name}: socket closed ${code} ${reason}`)));
  return { ws, next, get checkpoint() { return checkpoint; }, send: m => {
    if (failure) throw failure;
    lastState = m.state || m.states?.at(-1) || lastState;
    ws.send(JSON.stringify({ name, car: 'mini', driverId: identity, ...m }));
  }, close: () => { for (const waiter of pending) clearTimeout(waiter.timer); ws.close(); } };
}
const clients = [];
async function connect(name) {
  const c = client(name); clients.push(c);
  const hello = await c.next(m => m.type === 'hello');
  assert.ok(hello.token); assert.ok(hello.id);
  assert.ok(hello.maps.some(map => map.id === 'megara'), 'Megara Circuit must be advertised');
  // Old Workers ignore the query and omit hello.protocol. Do not send the new
  // hello message to them; explicit reload/mismatched protocols never downgrade.
  if (hello.protocol !== undefined) {
    assert.equal(hello.protocol, MULTIPLAYER_PROTOCOL);
    c.send({ type: 'hello', protocol: MULTIPLAYER_PROTOCOL, ...(build ? { build } : {}) });
  }
  return { c, hello };
}
try {
  const meta = getMap(mapId);
  const { c: a, hello, map, event, definition, resolved } = await verifySessionCatalogueWithRetry(meta, async () => {
    const { c, hello } = await connect('Deployment smoke host');
    const map = hello.maps.find(m => m.id === mapId); assert.ok(map, `Missing ${mapId} in hello`);
    const response = await fetch(new URL(meta.dataUrl, base + '/'), { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    return { c, hello, map, data: await response.json() };
  }, { onRetry: (error, attempt) => console.warn(`Catalogue propagation retry ${attempt}/2: ${error.message}`) });
  console.log(JSON.stringify({ proof: 'matching Quick Race + Free Roam catalogues', mapId, events: map.events.map(({ id, type }) => ({ id, type })) }));
  a.send({ type: 'create', mapId, eventId: event.id, private: true, lobbyName: 'Deployment smoke' });
  const created = (await a.next(m => m.type === 'lobby')).lobby;
  assert.equal(created.mapId, mapId); assert.equal(created.eventId, event.id); assert.equal(created.players.length, 1);
  if (raceProof) {
    const { c: b, hello: guest } = await connect('Deployment smoke guest');
    b.send({ type: 'join', code: created.code }); await b.next(m => m.type === 'lobby' && m.lobby.players.length === 2);
    for (const c of [a, b]) c.send({ type: 'ready', ready: true, version: map.track.version });
    await a.next(m => m.type === 'lobby' && m.lobby.players.length === 2 && m.lobby.players.every(p => p.ready));
    a.send({ type: 'start' });
    const running = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
    const other = (await b.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
    assert.equal(running.raceId, other.raceId); assert.equal(running.startAt, other.startAt);
    assert.equal(running.eventId, definition.id, 'Started race must retain the verified Quick Race ID');
    for (const field of ['s0', 's1', 'dir', 'len']) assert.equal(running.event[field], definition[field], `Server ${field} must match resolved event`);
    const drive = smokeDrive(running.event, resolved.geometry);
    let cursor = 0;
    const interval = setInterval(() => {
      if (Date.now() < running.startAt || cursor === drive.samples.length) return;
      const samples = drive.samples.slice(cursor, cursor + 2); cursor += samples.length;
      try {
        for (const [c, greeting] of [[a, hello], [b, guest]]) {
          if (greeting.features?.stateBatching) c.send({ type: 'states', raceId: running.raceId, states: samples });
          else for (const state of samples) c.send({ type: 'state', raceId: running.raceId, state });
        }
      } catch { clearInterval(interval); } // next() reports the socket/checkpoint failure.
    }, 2 * SMOKE_STEP / SMOKE_SPEED * 1000);
    try {
      await b.next(m => m.type === 'snapshot' && m.players.some(p => p.id === hello.id && p.state), 15000);
      const timeout = Math.ceil(event.len / SMOKE_SPEED * 1000) + 30000;
      const results = await Promise.all([a, b].map(c => c.next(m => m.type === 'lobby' && m.lobby.status === 'results', timeout)));
      const result = results[0].lobby;
      assert.equal(result.results.length, 2); assert.ok(result.results.every(p => Number.isFinite(p.finish) && !p.dnf));
      if (hello.protocol !== undefined) for (const c of [a, b]) {
        assert.equal(c.checkpoint?.passed, drive.checkpoints);
        assert.equal(c.checkpoint?.missed, false);
      }
      console.log(JSON.stringify({ proof: 'create → join → ready → start → snapshot → checkpoints → finish', base, protocol: hello.protocol ?? 0, legacy: hello.protocol === undefined, mapId, eventId: event.id, checkpoints: drive.checkpoints, raceId: running.raceId, startAt: running.startAt, results: result.results.map(({ id, finish, dnf }) => ({ id, finish, dnf })) }, null, 2));
    } finally { clearInterval(interval); }
    b.send({ type: 'leave' }); await b.next(m => m.type === 'left');
  }
  a.send({ type: 'leave' }); await a.next(m => m.type === 'left');
  console.log(`PASS: assets, private paths, playable map catalogue and /ws create-lobby round trip at ${base}`);
} finally { for (const c of clients) c.close(); }
