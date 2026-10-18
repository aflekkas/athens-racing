import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { smokeClient } from './resumable-smoke-client.mjs';
import { loadSmokeToken } from './smoke-token.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { getMap } from '../src/map-catalog.js';
import { verifySessionCatalogueWithRetry } from './deploy-smoke-catalogue.mjs';
import { checkDeployedEntry } from './deploy-smoke-assets.mjs';
import { smokeDrive, SMOKE_SPEED, SMOKE_STEP } from './deploy-smoke-route.mjs';
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('Usage: node tools/deploy-smoke.mjs https://worker.workers.dev [--race] [--map=riviera|megara|penteli|psychiko]');
const raceProof = process.argv.includes('--race'), mapId = process.argv.find(v => v.startsWith('--map='))?.slice(6) || 'riviera';
// Deployed Workers require Google sign-in; the smoke session credential is the only non-account path.
const smokeToken = loadSmokeToken();
const signIn = await fetch(base + '/api/auth/config', { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => ({ required: false }));
if (signIn.required && !smokeToken) { console.error('Deployment smoke: sign-in is required here; set SMOKE_TOKEN; see deploy/README.md'); process.exit(2); }
const { build, entry } = await checkDeployedEntry(base);
const preview = await fetch(base + getMap(mapId).preview.replace(/^\./, ''), { signal: AbortSignal.timeout(15000) });
assert.equal(preview.status, 200, `Map preview HTTP ${preview.status}`);
assert.ok((await preview.arrayBuffer()).byteLength, 'Map preview is empty');
for (const path of ['/server/core.mjs', '/tools/prepare-deploy.mjs', '/package.json', '/wrangler.jsonc', '/.git/config', '/chain.pid']) assert.equal((await fetch(base + path, { signal: AbortSignal.timeout(15000) })).status, 404, `${path} must remain private`);
const healthResponse = await fetch(base + '/health', { signal: AbortSignal.timeout(15000) });
assert.equal(healthResponse.status, 200);
console.log(JSON.stringify({ proof: 'health', base, entry, build: build || null, health: await healthResponse.json() }));
function client(name) { return smokeClient(base, name, { build, identity: `smoke-${randomUUID()}`, smokeToken }); }
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
    // A transport loss during countdown can legitimately cancel it. Re-vote
    // and ask the current host to start after both seats have resumed.
    let lastStart = 0;
    const prepare = setInterval(() => {
      if (!a.available || !b.available) return;
      const lobby = a.lobby;
      if (lobby?.status !== 'waiting') return;
      for (const c of [a, b]) if (!lobby.players.find(p => p.id === c.id)?.ready) c.send({ type: 'ready', ready: true, version: map.track.version });
      if (lobby.players.length === 2 && lobby.players.every(p => p.ready) && Date.now() - lastStart > 1250) {
        lastStart = Date.now(); ([a, b].find(c => c.id === lobby.host) || a).send({ type: 'start' });
      }
    }, 250);
    let running, other;
    try {
      running = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'race', 120000)).lobby;
      other = (await b.next(m => m.type === 'lobby' && m.lobby.status === 'race', 120000)).lobby;
    } finally { clearInterval(prepare); }
    assert.equal(running.raceId, other.raceId); assert.equal(running.startAt, other.startAt);
    assert.equal(running.eventId, definition.id, 'Started race must retain the verified Quick Race ID');
    for (const field of ['s0', 's1', 'dir', 'len']) assert.equal(running.event[field], definition[field], `Server ${field} must match resolved event`);
    const drive = smokeDrive(running.event, resolved.geometry);
    let cursor = 0; const resetAfter = Number(process.argv.find(v => v.startsWith('--reset-after-ms='))?.slice(17));
    const resetTimer = Number.isFinite(resetAfter) && resetAfter >= 0 ? setTimeout(() => b.forceReset(), resetAfter) : null;
    const interval = setInterval(() => {
      if (Date.now() < running.startAt || cursor === drive.samples.length || !a.available || !b.available) return;
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
      const timeout = Math.ceil(event.len / SMOKE_SPEED * 1000) + 120000;
      const results = await Promise.all([a, b].map(c => c.next(m => m.type === 'lobby' && m.lobby.status === 'results', timeout)));
      const result = results[0].lobby;
      assert.equal(result.results.length, 2); assert.ok(result.results.every(p => Number.isFinite(p.finish) && !p.dnf));
      if (hello.protocol !== undefined) for (const c of [a, b]) {
        assert.equal(c.checkpoint?.passed, drive.checkpoints);
        assert.equal(c.checkpoint?.missed, false);
      }
      console.log(JSON.stringify({ proof: 'create → join → ready → start → snapshot → checkpoints → finish', base, protocol: hello.protocol ?? 0, legacy: hello.protocol === undefined, mapId, eventId: event.id, checkpoints: drive.checkpoints, raceId: running.raceId, startAt: running.startAt, reconnects: a.reconnects + b.reconnects, results: result.results.map(({ id, finish, dnf }) => ({ id, finish, dnf })) }, null, 2));
    } finally { clearInterval(interval); clearTimeout(resetTimer); }
    b.send({ type: 'leave' }); await b.next(m => m.type === 'left');
  }
  a.send({ type: 'leave' }); await a.next(m => m.type === 'left');
  console.log(`PASS: assets, private paths, playable map catalogue and /ws create-lobby round trip at ${base}`);
} finally { for (const c of clients) await c.close(); console.log(JSON.stringify({ proof: 'reconnect summary', reconnects: clients.reduce((n, c) => n + c.reconnects, 0) })); }
