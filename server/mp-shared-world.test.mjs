import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CAR, worldOwner, worldPackets, WorldAssembler, packCar, validWorldPart } from '../src/shared-world-protocol.js';
import { createSharedWorldRelay } from './mp-shared-world.mjs';

const row = id => [id, 10000 + id * 300, 300, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 50000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function room(n = 3) {
  const players = new Map(Array.from({ length: n }, (_, i) => ['p' + i, { id: 'p' + i, loaded: true, connected: true, state: { s: 100, u: 3 }, ws: [] }]));
  return { host: 'p0', players, raceId: 'race-one', generation: 1, status: 'race' };
}
const deliver = (ws, packet) => ws.push(typeof packet === 'string' ? JSON.parse(packet) : packet);
const packets = (now, rows = [row(0)], cones = []) => worldPackets({ raceId: 'race-one', generation: 1, seq: 0, at: now }, rows, cones);

test('world packets fit 4 KiB even with a full fleet and all displaced props; assembly is atomic', () => {
  const rows = Array.from({ length: 66 }, (_, i) => row(i).map((n, k) => k === 0 || k === CAR.DIR || k >= CAR.FLAGS ? n : 1234567));
  // Valid positions/velocities are smaller; exercise worst-case packet splitting separately.
  const cones = Array.from({ length: 256 }, (_, i) => [i, 10000, 300, 0, 0, 0, 0, 1571, 0, 0]);
  const batch = packets(Date.now(), Array.from({ length: 66 }, (_, i) => row(i)), cones);
  assert.ok(batch.length > 1 && batch.length <= 8);
  assert.ok(batch.every(p => Buffer.byteLength(JSON.stringify(p)) < 4096 && validWorldPart(p)));
  const assembler = new WorldAssembler();
  for (const p of batch.slice(1).reverse()) assert.equal(assembler.accept(p), null);
  const full = assembler.accept(batch[0]); assert.equal(full.rows.length, 66); assert.equal(full.cones.length, 256);
  assert.equal(assembler.accept(batch[0]), null, 'duplicates never rewind the world');
  assert.ok(worldPackets({ raceId: 'r'.repeat(36), generation: 9, owner: 'o'.repeat(36), seq: 99999, at: Date.now() }, rows, []).every(p => Buffer.byteLength(JSON.stringify(p)) < 4096));
});
test('bad and duplicate world rows, stale sequences and mixed timestamps cannot partially change a world', () => {
  const a = new WorldAssembler(), now = Date.now(), p = packets(now)[0];
  assert.equal(a.accept({ ...p, rows: [row(0), row(0)] }), null);
  assert.equal(a.accept({ ...p, rows: [row(0).map((n, i) => i === 3 ? NaN : n)] }), null);
  assert.ok(a.accept({ ...p, seq: 1 }));
  assert.equal(a.accept(p), null);
  assert.ok(a.accept({ ...p, owner: 'replacement', seq: 0 }), 'new authority may restart its counter');
});
test('one authority relays the same quantized world to all players and survives a host change', () => {
  const l = room(), relay = createSharedWorldRelay(deliver), now = Date.now(), batch = packets(now);
  assert.equal(worldOwner(l), 'p0'); assert.equal(relay.frame(l.players.get('p1'), l, batch[0], now), false);
  assert.equal(relay.frame(l.players.get('p0'), l, batch[0], now), true);
  assert.deepEqual(l.players.get('p0').ws, l.players.get('p2').ws);
  l.players.get('p0').connected = false; assert.equal(worldOwner(l), 'p1');
  assert.equal(relay.frame(l.players.get('p0'), l, { ...batch[0], seq: 2 }, now + 200), false);
  assert.equal(relay.frame(l.players.get('p1'), l, { ...batch[0], at: now + 200 }, now + 200), true);
  const late = []; relay.deliver(late, l); assert.equal(late[0].owner, 'p1');
  l.raceId = 'restart'; const stale = []; relay.deliver(stale, l); assert.equal(stale.length, 0);
});
test('guest collisions reach the authority once, with proximity and bounded impulses', () => {
  const l = room(), relay = createSharedWorldRelay(deliver), now = Date.now(); relay.frame(l.players.get('p0'), l, packets(now)[0], now);
  const guest = l.players.get('p1'), authority = l.players.get('p0'), m = { type: 'world-contact', raceId: l.raceId, generation: 1, at: now, nonce: 0, kind: 'car', body: [0, 5, 1, 200, 0, 50, 300, 1, 600] };
  assert.equal(relay.contact(guest, l, m, now), true); assert.equal(authority.ws.at(-1).playerId, guest.id);
  assert.equal(relay.contact(guest, l, m, now), false);
  assert.equal(relay.contact(guest, l, { ...m, nonce: 1, body: [0, 5, 1, 90000, 0, 50, 300, 1, 600] }, now), false);
  guest.state.s = 1000; assert.equal(relay.contact(guest, l, { ...m, nonce: 2 }, now), false);
  guest.state.s = 100; assert.equal(relay.contact(guest, l, { ...m, nonce: 3, kind: 'cone', body: [0, 10000, 300, 0, 2000, 300, 400, 0, 0, 3000] }, now), true);
});
test('five Hz full-fleet relay measures bounded free-plan message and CPU cost for eight clients', () => {
  const l = room(8), now = Date.now(), rows = Array.from({ length: 66 }, (_, i) => row(i)), cones = Array.from({ length: 32 }, (_, i) => [i, 10000, 300, 0, 0, 0, 0, 1571, 0, 0]);
  let outputs = 0, bytes = 0; const relay = createSharedWorldRelay((ws, data) => { outputs++; bytes += typeof data === 'string' ? Buffer.byteLength(data) : Buffer.byteLength(JSON.stringify(data)); });
  let inbound = 0; const started = performance.now();
  for (let seq = 0; seq < 300; seq++) for (const p of worldPackets({ raceId: l.raceId, generation: 1, seq, at: now + seq * 200 }, rows, cones)) { inbound++; relay.frame(l.players.get('p0'), l, p, now + seq * 200); }
  const elapsed = performance.now() - started;
  console.log(JSON.stringify({ sharedWorldBench: true, simulatedSeconds: 60, players: 8, cars: rows.length, cones: cones.length, inboundPerSecond: inbound / 60, outboundPerSecond: outputs / 60, outboundBytesPerSecond: bytes / 60, measuredCpuMsPerFrame: elapsed / 300 }));
  assert.ok(inbound / 60 <= 30); assert.ok(elapsed / 300 < 10);
});
