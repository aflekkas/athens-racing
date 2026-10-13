import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('Usage: node tools/deploy-smoke.mjs https://worker.workers.dev [--race] [--map=megara]');
const raceProof = process.argv.includes('--race'), mapId = process.argv.find(v => v.startsWith('--map='))?.slice(6) || 'riviera';
for (const path of ['/', '/src/main.js', '/assets/maps/riviera.svg']) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, 200, `${path} HTTP ${r.status}`);
  assert.ok((await r.arrayBuffer()).byteLength > 0, `${path} is empty`);
}
for (const path of ['/server/core.mjs', '/tools/prepare-deploy.mjs', '/package.json', '/wrangler.jsonc', '/.git/config', '/chain.pid']) assert.equal((await fetch(base + path)).status, 404, `${path} must remain private`);
function client(name) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { origin: base }), identity = `smoke-${randomUUID()}`;
  const inbox = [], pending = new Set();
  ws.on('message', bytes => {
    if (String(bytes) === 'alive') return;
    const m = JSON.parse(bytes), waiter = [...pending].find(w => w.pred(m));
    if (waiter) { pending.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(m); } else inbox.push(m);
  });
  const next = (pred, timeout = 15000) => new Promise((resolve, reject) => {
    const index = inbox.findIndex(pred); if (index >= 0) return resolve(inbox.splice(index, 1)[0]);
    const waiter = { pred, resolve, timer: setTimeout(() => { pending.delete(waiter); reject(new Error(`${name}: message timeout; inbox=${JSON.stringify(inbox).slice(-1000)}`)); }, timeout) }; pending.add(waiter);
  });
  ws.on('error', e => { for (const waiter of pending) { clearTimeout(waiter.timer); waiter.resolve({ type: 'socket-error', error: e.message }); } pending.clear(); });
  return { ws, next, send: m => ws.send(JSON.stringify({ name, car: 'mini', driverId: identity, ...m })), close: () => { for (const waiter of pending) clearTimeout(waiter.timer); ws.close(); } };
}
const clients = [];
try {
  const a = client('Deployment smoke host'); clients.push(a);
  const hello = await a.next(m => m.type === 'hello'); assert.ok(hello.token); assert.ok(hello.id);
  const map = hello.maps.find(m => m.id === mapId); assert.ok(map, `Missing ${mapId} in hello`);
  const event = map.events.slice().sort((a, b) => a.len - b.len)[0];
  a.send({ type: 'create', mapId, eventId: event.id, private: true, lobbyName: 'Deployment smoke' });
  const created = (await a.next(m => m.type === 'lobby')).lobby;
  assert.equal(created.mapId, mapId); assert.equal(created.eventId, event.id); assert.equal(created.players.length, 1);
  if (raceProof) {
    const b = client('Deployment smoke guest'); clients.push(b); const guest = await b.next(m => m.type === 'hello');
    b.send({ type: 'join', code: created.code }); await b.next(m => m.type === 'lobby' && m.lobby.players.length === 2);
    for (const c of [a, b]) c.send({ type: 'ready', ready: true, version: map.track.version });
    await a.next(m => m.type === 'lobby' && m.lobby.players.length === 2 && m.lobby.players.every(p => p.ready));
    a.send({ type: 'start' });
    const running = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
    const other = (await b.next(m => m.type === 'lobby' && m.lobby.status === 'race')).lobby;
    assert.equal(running.raceId, other.raceId); assert.equal(running.startAt, other.startAt);
    let samples = [];
    const interval = setInterval(() => {
      const elapsed = (Date.now() - running.startAt) / 1000, s = event.s0 + event.dir * Math.min(event.len, Math.max(0, elapsed) * 120);
      const sample = { x: 0, y: 0, z: 0, yaw: 0, s, u: 0, vLong: 120, vLat: 0, steer: 0, rpm: 5000, gear: 5 };
      samples.push(sample);
      if (samples.length >= 2 || (s - event.s1) * event.dir >= 0) {
        for (const c of [a, b]) c.send(hello.features?.stateBatching ? { type: 'states', raceId: running.raceId, states: samples } : { type: 'state', raceId: running.raceId, state: sample });
        samples = [];
      }
    }, 100);
    try {
      await b.next(m => m.type === 'snapshot' && m.players.some(p => p.id === hello.id && p.state), 15000);
      const result = (await a.next(m => m.type === 'lobby' && m.lobby.status === 'results', Math.ceil(event.len / 120 * 1000) + 30000)).lobby;
      assert.equal(result.results.length, 2); assert.ok(result.results.every(p => Number.isFinite(p.finish) && !p.dnf));
      console.log(JSON.stringify({ proof: 'create → join → ready → start → snapshot → finish', mapId, eventId: event.id, raceId: running.raceId, startAt: running.startAt, results: result.results.map(({ id, finish, dnf }) => ({ id, finish, dnf })) }, null, 2));
    } finally { clearInterval(interval); }
    b.send({ type: 'leave' }); await b.next(m => m.type === 'left');
    assert.ok(guest.id);
  }
  a.send({ type: 'leave' }); await a.next(m => m.type === 'left');
  console.log(`PASS: assets, private paths and /ws create-lobby round trip at ${base}`);
} finally { for (const c of clients) c.close(); }
