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
test('circuit contact validation uses the same physical position across lap numbers',()=>{
 const l=room(),relay=createSharedWorldRelay(deliver,{period:()=>2000}),now=Date.now();relay.frame(l.players.get('p0'),l,packets(now)[0],now);
 const guest=l.players.get('p1');guest.state.s=4100;
 assert.equal(relay.contact(guest,l,{type:'world-contact',raceId:l.raceId,generation:1,at:now,nonce:0,kind:'car',body:[0,5,1,200,0,50,300,1,600]},now),true);
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

const identity = Object.freeze({ worldId: 'athens', projectionId: 'athens-v1', routeId: 'fixture-race', routeHash: 'a'.repeat(64), geometryHash: 'b'.repeat(64), worldSetRevision: 'c'.repeat(64), onlineGridHash: 'd'.repeat(64) });
const physicalRow = id => [...row(id), ...Array(8).fill(0), 100000 + id * 300, 1200, -50000, 1, 1200, 0, 1, 0];
const physicalCone = id => [id, 10000, 300, 0, 0, 0, 0, 0, 0, 0, 100000, 1200, -50000, 1, 0, 0, 1, 0];
function worldRoom() { const l = room(); l.mapId = 'fixture-race'; l.routeIdentity = identity; for (const p of l.players.values()) p.state = { s: 0, u: 0, x: 1000, y: 12, z: -500, layer: 1 }; return l; }
const physicalPackets = (l, now, rows = [physicalRow(0)], cones = [physicalCone(0)]) => worldPackets({ raceId: l.raceId, generation: l.generation, seq: 0, at: now, mapId: l.mapId, routeIdentity: l.routeIdentity }, rows, cones);

test('authenticated world rows retain physical off-course poses and tuple through relay, late delivery and host change', () => {
 const l = worldRoom(), relay = createSharedWorldRelay(deliver), now = Date.now(), batch = physicalPackets(l, now);
 for (const packet of batch) relay.frame(l.players.get('p0'), l, packet, now);
 assert.ok(l.sharedWorld); assert.equal(l.sharedWorld.rows[0][32], 100000); assert.deepEqual(l.players.get('p0').ws, l.players.get('p2').ws);
 const late = []; relay.deliver(late, l); assert.ok(late.length); assert.ok(late.every(p => p.mapId === l.mapId && p.routeIdentity.routeHash === identity.routeHash));
 l.players.get('p0').connected = false; for (const packet of physicalPackets(l, now + 1000)) relay.frame(l.players.get('p1'), l, packet, now + 1000); assert.equal(l.sharedWorld.owner, 'p1');
 l.routeIdentity = { ...identity, worldSetRevision: 'e'.repeat(64) }; const stale = []; relay.deliver(stale, l); assert.equal(stale.length, 0);
});
test('world relay rejects stale tuples, legacy coordinate rows, invalid physical variants and stale generations before changing cache', () => {
 const l = worldRoom(), relay = createSharedWorldRelay(deliver), now = Date.now(), host = l.players.get('p0'), packet = physicalPackets(l, now)[0];
 for (const bad of [{ ...packet, routeIdentity: { ...identity, onlineGridHash: 'e'.repeat(64) } }, { ...packet, mapId: 'riviera' }, { ...packet, generation: 0 }, { ...packet, rows: [row(0)] }, { ...packet, cones: [physicalCone(0).slice(0, 10)] }, { ...packet, rows: [physicalRow(0).map((v, i) => i === 39 ? 1 : v)] }]) assert.equal(relay.frame(host, l, bad, now), false);
 assert.equal(l.sharedWorld, undefined); assert.equal(relay.frame(host, l, packet, now), true);
 const legacy = room(), oldRelay = createSharedWorldRelay(deliver); assert.equal(oldRelay.frame(legacy.players.get('p0'), legacy, { ...packet, routeIdentity: undefined, mapId: undefined }, now), false);
});
test('world traffic and displaced-cone contacts use physical proximity and reject bridge decks with matching route stations', () => {
 const l = worldRoom(), relay = createSharedWorldRelay(deliver), now = Date.now(), guest = l.players.get('p1'), host = l.players.get('p0');
 for (const packet of physicalPackets(l, now)) relay.frame(host, l, packet, now);
 const contact = { type: 'world-contact', raceId: l.raceId, generation: l.generation, mapId: l.mapId, routeIdentity: identity, at: now, nonce: 0, kind: 'car', body: [0, 5, 1, 200, 0, 50, 300, 1, 600] };
 assert.equal(relay.contact(guest, l, contact, now), true); assert.deepEqual(host.ws.at(-1).routeIdentity, identity);
 for (const [nonce, state] of [[1, { layer: 0 }], [2, { y: 0 }], [3, { x: 1200 }]]) { const before = guest.state; guest.state = { ...before, ...state }; assert.equal(relay.contact(guest, l, { ...contact, nonce }, now), false); guest.state = before; }
 assert.equal(relay.contact(guest, l, { ...contact, nonce: 4, kind: 'cone', body: physicalCone(0) }, now), true);
 assert.equal(relay.contact(guest, l, { ...contact, nonce: 5, kind: 'cone', body: physicalCone(0).slice(0, 10) }, now), false);
 assert.equal(relay.contact(guest, l, { ...contact, nonce: 6, kind: 'cone', body: physicalCone(0).map((v, i) => i === 13 ? 0 : v) }, now), false);
});

test('physical full-fleet relay keeps every actor within the sustained thirty-packet budget for eight drivers',async()=>{
 const {WORLD_IDS,worldFrameIntervalMs}=await import('../src/shared-world-protocol.js'),l=worldRoom();for(let i=3;i<8;i++)l.players.set('p'+i,{...l.players.get('p1'),id:'p'+i,ws:[]});
 const rows=Array.from({length:WORLD_IDS},(_,id)=>physicalRow(id)),cones=Array.from({length:256},(_,id)=>physicalCone(id));let outputs=0,bytes=0;
 const relay=createSharedWorldRelay((ws,data)=>{outputs++;bytes+=typeof data==='string'?Buffer.byteLength(data):Buffer.byteLength(JSON.stringify(data));}),start=Date.now(),batch=physicalPackets(l,start,rows,cones),interval=worldFrameIntervalMs(batch.length+1),cpu=performance.now();let inbound=0;
 for(let seq=0;seq<100;seq++){const now=start+seq*interval;for(const p of worldPackets({raceId:l.raceId,generation:l.generation,owner:l.host,seq,at:now,now,mapId:l.mapId,routeIdentity:identity},rows,cones)){inbound++;relay.frame(l.players.get('p0'),l,p,now);}}
 assert.equal(l.sharedWorld.seq,99);assert.equal(l.sharedWorld.rows.length,74);assert.equal(l.sharedWorld.cones.length,256);assert.ok(inbound*1000/(100*interval)<=30+1e-8);assert.ok(l.worldRelayBudget.credits>=0);
 console.log(JSON.stringify({physicalWorldBench:true,players:8,cars:74,cones:256,parts:batch.length,intervalMs:interval,inboundPerSecond:inbound*1000/(100*interval),outboundBytesPerSecond:bytes*1000/(100*interval),measuredCpuMsPerFrame:(performance.now()-cpu)/100,outputs}));
 // A host that sends every120ms cannot bypass the room's sustained part budget.
 const fast=worldRoom(),guarded=createSharedWorldRelay(()=>{});let accepted=0,parts=0;
 for(let seq=0;seq<100;seq++){const now=start+seq*120;for(const p of worldPackets({raceId:fast.raceId,generation:fast.generation,seq,at:now,mapId:fast.mapId,routeIdentity:identity},rows,cones))if(guarded.frame(fast.players.get('p0'),fast,p,now)){accepted++;parts+=fast.sharedWorld?worldPackets({...fast.sharedWorld,now},rows,cones).length:0;}}
 assert.ok(accepted<100);assert.ok(parts<=30+30*99*.12+1e-6);
});
