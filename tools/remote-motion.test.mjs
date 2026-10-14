import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StateSender } from '../src/multiplayer-state.js';
import { Multiplayer } from '../src/multiplayer.js';
import { RemoteTimeline, applyRemotePose, receiveRemoteSnapshot } from '../src/remote-timeline.js';
import { applySpectatorState } from '../src/race-lifecycle.js';
import { createGameCore } from '../server/core.mjs';

const state = (t, extra = {}) => ({ x: 0, y: 0, z: -20*t/1000, s: 20*t/1000, u: 0, yaw: 0, vLong: 20, vLat: 0, steer: 0, rpm: 3000, gear: 2, reverse: false, damage: { front: 0, rear: 0, left: 0, right: 0 }, ...extra });
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a-b) < tolerance, `${a} != ${b}`);
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const renderBody = main.slice(main.indexOf('  remote(peers, dt) {'), main.indexOf('  wrecked() {', main.indexOf('  remote(peers, dt) {')));
// Execute the production render hook, with only the graphics side effects stubbed.
function productionRender(client, clock) {
  const vehicle = state(0), car = { veh: vehicle, model: { root: {}, paintColor: '#123456' }, driver: { update() {} } };
  let draws = 0;
  const remote = Function('remoteCars', 'multiplayer', 'applyRemotePose', 'performance', 'setPaint', 'applyCarDecals', 'unpackDecals', 'syncCar', 'applySpectatorState', 'G', `return ({${renderBody}}).remote`)(
    new Map([['driver', car]]), client, applyRemotePose, { now: clock }, () => {}, () => {}, x => x, () => draws++, applySpectatorState, { t: 0 });
  return { remote, vehicle, car, get draws() { return draws; } };
}

function pipeline(t, { fps = 60, duration = 5000, jitter = false, loss = false, path = state } = {}) {
  let now = 0; const base = 100000;
  t.mock.method(Date, 'now', () => base + now); t.mock.method(performance, 'now', () => now);
  const map = { id: 'riviera', name: 'proof', track: { start: 0, finish: 10000, version: 'v1' }, definitions: new Map([['quick', { id: 'quick', name: 'proof', type: 'sprint', s0: 0, s1: 10000, dir: 1, len: 10000 }]]) };
  const core = createGameCore({ maps: new Map([['riviera', map]]), cars: new Set(['mini']), leaderboard: { submit: async () => {} }, countdownMs: 0 });
  const queue = [], timers = new Map(); let serial = 0, packetCount = 0, relayAt = null, deliveries = 0;
  const socket = () => ({ readyState: 1, messages: [], send(bytes) { const m = JSON.parse(bytes); this.messages.push(m); if (m.type === 'snapshot') queue.push({ at: now + (jitter ? [0, 30, 80, 10][deliveries++ % 4] : 0), m }); }, close() {} });
  const a = socket(), b = socket(); core.connect(a, 'a', { protocol: MULTIPLAYER_PROTOCOL }); core.connect(b, 'b', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (ws, m) => core.message(ws, JSON.stringify(m));
  send(a, { type: 'create' }); const code = a.messages.at(-1).lobby.code; send(b, { type: 'join', code });
  for (const ws of [a,b]) send(ws, { type: 'ready', ready: true, version: 'v1' }); send(a, { type: 'start' }); core.tick();
  const lobby = a.messages.findLast(m => m.type === 'lobby').lobby, realId = a.messages[0].id;
  const client = Object.create(Multiplayer.prototype);
  Object.assign(client, { id: 'observer', lobby: { ...lobby, players: [{ id: 'driver', car: 'mini', connected: true, finish: null }] }, peers: new Map(), hooks: { clearInput() {} }, stateSender: { reset() {} }, advanceClock() {}, loaded: false, status() {} });
  // Install the actual WebSocket onmessage path, not a copy of intake logic.
  const oldLocation = globalThis.location, oldWs = globalThis.WebSocket, oldDocument = globalThis.document;
  globalThis.location = { href: 'http://localhost/', protocol: 'http:' };
  globalThis.WebSocket = class { static OPEN = 1; constructor() { this.readyState = 1; } send() {} };
  globalThis.document = { hidden: false };
  try { client.connect(); } finally { globalThis.location = oldLocation; globalThis.WebSocket = oldWs; globalThis.document = oldDocument; }
  const render = productionRender(client, () => now), frames = [], oldFrames = []; let nextFrame = 0, oldZ = 0;
  const sender = new StateSender(packet => {
    packetCount++;
    if (loss && packetCount === 12) return;
    send(a, packet); if (relayAt === null) relayAt = now + 100;
  }, { now: () => now, schedule: (fn, delay) => { const id = ++serial; timers.set(id, { at: now+delay, fn }); return id; }, cancel: id => timers.delete(id) });
  for (now = 0; now <= duration; now++) {
    if (now % 100 === 0) sender.sample(path(now), lobby.raceId, { batching: true });
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    if (relayAt !== null && now >= relayAt) { core.tick(); relayAt = null; }
    for (let i = queue.length-1; i >= 0; i--) if (queue[i].at <= now) {
      const m = queue.splice(i,1)[0].m; m.players = m.players.filter(p => p.id === realId).map(p => ({ ...p, id: 'driver' }));
      globalThis.document = { hidden: false }; try { client.ws.onmessage({ data: JSON.stringify(m) }); } finally { globalThis.document = oldDocument; }
    }
    if (now + .001 >= nextFrame) {
      render.remote(client.peers, 1/fps);
      const target = client.peers.get('driver')?.state.z ?? 0; oldZ += (target-oldZ)*(1-Math.exp(-18/fps));
      if (now > 1000) { frames.push({ at: now, z: render.vehicle.z, s: render.vehicle.s }); oldFrames.push({ at: now, z: oldZ }); }
      nextFrame += 1000/fps;
    }
  }
  sender.reset(); return { client, render, frames, oldFrames, packetCount };
}
function metrics(frames) {
  const velocities = frames.slice(1).map((p,i) => Math.abs((p.z - frames[i].z) * 1000/(p.at-frames[i].at)));
  const mean = velocities.reduce((a,b) => a+b,0)/velocities.length;
  const deviation = Math.sqrt(velocities.reduce((a,b) => a+(b-mean)**2,0)/velocities.length);
  return { mean, min: Math.min(...velocities), max: Math.max(...velocities), cv: deviation/mean };
}

test('actual intake and render hook replace 5 Hz batch stair steps with uniform motion at 30/60/144 FPS', t => {
  for (const fps of [30,60,144]) {
    const result = pipeline(t, { fps }); const before = metrics(result.oldFrames), after = metrics(result.frames);
    console.log('MP motion', JSON.stringify({ fps, before, after, packets: result.packetCount }));
    assert.ok(before.cv > .75, 'regression must reproduce visible old speed oscillation');
    assert.ok(after.cv < .025, 'render speed stays uniform despite latest-only relay'); close(after.mean, 20, .1);
    assert.ok(result.packetCount <= 26); assert.ok(result.render.draws > 100);
    assert.ok(result.client.peers.get('driver').state.s > result.render.vehicle.s, 'ranking uses latest state, not delayed pose');
    t.mock.restoreAll();
  }
});

test('jitter, delayed/out-of-order duplicate snapshots and one lost batch remain bounded and never rewind', t => {
  const { frames, client } = pipeline(t, { jitter: true, loss: true });
  for (let i=1;i<frames.length;i++) { assert.ok(frames[i].s >= frames[i-1].s); assert.ok(Math.abs(frames[i].z-frames[i-1].z) < .9); }
  const peer = client.peers.get('driver'), length = peer.timeline.samples.length, original = peer.state;
  receiveRemoteSnapshot(client.peers, { now: 100, players: [{ id: 'driver', state: state(0, { sampleTime: 0 }), stateAt: 50 }] }, { receivedAt: 5100 });
  assert.equal(client.peers.get('driver').state, original); assert.equal(peer.timeline.samples.length, length); assert.ok(peer.timeline.delay <= 400);
});

const push = (timeline, time, extra = {}, options = {}) => timeline.push(state(time, { sampleTime: time, sampleAge: 0, motionEpoch: 1, ...extra }), { receivedAt: time+100, serverNow: time+100000, stateAt: time+100000, car: 'mini', ...options });

test('accelerating positions use endpoint velocities; yaw crosses ±pi along the short arc', () => {
  const timeline = new RemoteTimeline();
  push(timeline, 0, { z: 0, vLong: 0 }); push(timeline, 200, { z: -.4, vLong: 4 });
  const middle = timeline.sample(220); close(middle.z, -.1); close(middle.vLong, 2);
  const turn = new RemoteTimeline(); push(turn, 0, { yaw: Math.PI-.1 }); push(turn, 200, { yaw: -Math.PI+.1 });
  close(Math.abs(turn.sample(220).yaw), Math.PI);
});

test('a parked/finished/wrecked car cannot extrapolate; a missing stream coasts at most 350ms then freezes wheels', () => {
  const timeline = new RemoteTimeline(); push(timeline, 0); push(timeline, 200);
  const end = timeline.sample(1000); const later = timeline.sample(5000); close(end.z, later.z); close(end.z, -11); close(later.vLong, 0);
  const parked = new RemoteTimeline(); push(parked, 0, { z: 0, vLong: 0 }); push(parked, 200, { z: 0, vLong: 0 }); close(parked.sample(2000).z, 0);
  for (const flag of [{ finish: 3 }, { dnf: 'wrecked' }]) {
    const peers = new Map(); receiveRemoteSnapshot(peers, { now: 0, players: [{ id: 'p', state: state(0, { sampleTime: 0 }), stateAt: 0 }] }, { receivedAt: 100 });
    receiveRemoteSnapshot(peers, { now: 200, players: [{ id: 'p', state: state(200, { sampleTime: 200 }), stateAt: 200, ...flag }] }, { receivedAt: 300 });
    const v = {}; applyRemotePose(peers.get('p'), v, 2000); close(v.z, -4); close(v.vLong, 0);
  }
});

test('stop/resume, epoch tow, teleport, car switch and a stalled reconnect reset without drawing a streak', () => {
  const timeline = new RemoteTimeline(); push(timeline, 0); push(timeline, 200); push(timeline, 400, { vLong: 0 });
  close(timeline.sample(1000).z, -8); push(timeline, 600); const resumed = timeline.sample(1050); assert.ok(resumed.z < -8 && resumed.z >= -14.4);
  push(timeline, 800, { x: 2, z: -10, vLong: 0, motionEpoch: 2 }); close(timeline.sample(900).x, 2); close(timeline.sample(900).z, -10);
  push(timeline, 1000, { x: 500 }); close(timeline.sample(1100).x, 500);
  push(timeline, 1200, { x: 0 }, { car: 'z4' }); close(timeline.sample(1300).x, 0);
  push(timeline, 4000, { z: -80 }); close(timeline.sample(4100).z, -80);
  assert.ok(timeline.samples.length <= 16);
});

test('per-player age survives other-driver relays; duplicate idle states do not rejuvenate the stream', () => {
  const peers = new Map(), packet = { now: 1000, players: [{ id: 'p', state: state(100, { sampleTime: 100, sampleAge: 200 }), stateAt: 800 }] };
  receiveRemoteSnapshot(peers, packet, { receivedAt: 2000 }); const peer = peers.get('p'); close(peer.timeline.offset, 1500);
  packet.now = 1200; receiveRemoteSnapshot(peers, packet, { receivedAt: 2200 }); assert.equal(peer.at, 2000); assert.equal(peer.timeline.samples.length, 1);
  assert.equal(peer.state.sampleTime, 100);
});

test('sender tow epoch cancels the pending pre-tow sample and preserves bounded message rate', () => {
  let now = 0, timer; const packets = [];
  const sender = new StateSender(p => packets.push(p), { now: () => now, schedule: fn => { timer=fn; return 1; }, cancel: () => { timer=null; } });
  sender.sample(state(0), 'race', { batching: true }); const epoch = sender.motionEpoch; sender.discontinuity(); assert.equal(timer, null);
  now=30; sender.sample(state(30, { vLong: 0 }), 'race', { batching: true }); now=230; timer();
  assert.equal(packets.length, 1); assert.equal(packets[0].states.length, 1); assert.equal(packets[0].states[0].motionEpoch, epoch+1); assert.equal(packets[0].states[0].sampleAge, 200);
});

test('legacy snapshots without timing metadata still interpolate, suppress repeated held poses and freeze', () => {
  const peers = new Map();
  for (const time of [0,200,400]) receiveRemoteSnapshot(peers, { now: 100000+time, players: [{ id: 'p', state: state(time) }] }, { receivedAt: time+100 });
  const peer = peers.get('p'), v = {}; applyRemotePose(peer,v,650); close(v.z,-10.6);
  receiveRemoteSnapshot(peers, { now: 100800, players: [{ id: 'p', state: state(400) }] }, { receivedAt: 900 });
  assert.equal(peer.at,500); applyRemotePose(peer,v,2000); close(v.z,-15); applyRemotePose(peer,v,4000); close(v.z,-15); close(v.vLong,0);
});

test('production lobby handler clears race history and resets car/rejoin timelines; socket close preserves authoritative state', t => {
  const { client } = pipeline(t, { duration: 1200 });
  client.renderRoom = () => {}; client.syncLobby = () => {}; client.panel = {};
  const original = client.peers.get('driver').state;
  const deliver = lobby => client.ws.onmessage({ data: JSON.stringify({ type: 'lobby', lobby }) });
  client.lobby.players.push({ id: 'observer', car: 'mini' });
  deliver({ ...client.lobby, players: [{ id: 'driver', car: 'mini', connected: false }, { id: 'observer', car: 'mini' }] });
  deliver({ ...client.lobby, players: [{ id: 'driver', car: 'mini', connected: true }, { id: 'observer', car: 'mini' }] });
  assert.equal(client.peers.get('driver').timeline, undefined); assert.equal(client.peers.get('driver').state, original);
  receiveRemoteSnapshot(client.peers, { now: 2000, players: [{ id: 'driver', state: state(1200), stateAt: 2000 }] }, { members: client.lobby.players, receivedAt: 1300 });
  deliver({ ...client.lobby, players: [{ id: 'driver', car: 'z4', connected: true }, { id: 'observer', car: 'mini' }] });
  assert.equal(client.peers.get('driver').timeline, undefined);
  t.mock.method(globalThis,'setTimeout',() => 1);
  client.ws.onclose({ reason: '' }); assert.equal(client.peers.get('driver').state.s, 24);
  deliver({ ...client.lobby, raceId: 'next' }); assert.equal(client.peers.size,0);
});

test('recorded ~4.78Hz Worker arrivals survive queued receiver bursts without reconnect resets or pose chasing', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/remote-motion-arrivals.json', import.meta.url), 'utf8'));
  const client = { peers: new Map(), lobby: { players: [{ id: 'driver', car: 'mini', connected: true }] } };
  let now = 0, index = 0; const render = productionRender(client, () => now), frames = [];
  for (now of fixture.frames) {
    while (index < fixture.arrivals.length && fixture.arrivals[index][1] <= now) {
      const [time, receivedAt, age] = fixture.arrivals[index++];
      receiveRemoteSnapshot(client.peers, { now: 100000 + time + age, players: [{ id: 'driver', stateAt: 100000 + time, state: state(time, { sampleTime: time, motionEpoch: 1 }) }] }, { members: client.lobby.players, receivedAt });
    }
    if (!client.peers.size) continue;
    render.remote(client.peers, .5);
    frames.push({ at: now, z: render.vehicle.z });
  }
  const stats = metrics(frames), timeline = client.peers.get('driver').timeline;
  console.log('Recorded WebGL arrival replay', JSON.stringify(stats));
  assert.equal(timeline.resetCount, 0, 'continuous source samples must survive >1.5sec receiver stalls');
  assert.ok(stats.cv < .04, 'recorded burst timing must not cause the old clock-reset oscillations');
  assert.ok(stats.max <= 20.001, 'recovery must not accelerate the car to chase its target');
  assert.ok(timeline.samples.length <= 16); assert.ok(timeline.delay >= 20 && timeline.delay <= 100);
});

test('4.78Hz snapshots with measured-scale arrival jitter and two dropped batches freeze and resume at normal speed', () => {
  const peers = new Map(), interval = 1000 / 4.78;
  const jitter = [30, 62, 15, 95, 20, 5, 80, 40];
  const arrivals = Array.from({ length: 55 }, (_, i) => ({ source: i * interval, at: i * interval + 100 + jitter[i % jitter.length] })).filter((_, i) => i !== 16 && i !== 17);
  let index = 0, previous, freezes = 0; const frames = [];
  for (let now = 0; now < 12000; now += 1000 / 60) {
    while (index < arrivals.length && arrivals[index].at <= now) {
      const a = arrivals[index++];
      receiveRemoteSnapshot(peers, { now: 100000 + a.source + 100, players: [{ id: 'p', stateAt: 100000 + a.source, state: state(a.source, { sampleTime: a.source, motionEpoch: 1 }) }] }, { receivedAt: a.at });
    }
    if (!peers.size) continue;
    const t = peers.get('p').timeline, p = t.sample(now);
    if (t.mode === 'freeze') { freezes++; close(p.vLong, 0); }
    if (previous && now > 1000) {
      const velocity = (p.s - previous.s) * 1000 / (now - previous.at);
      assert.ok(velocity >= -1e-7 && velocity <= 20.001, `${velocity} m/s: recovery must not chase a target`);
    }
    frames.push({ at: now, z: p.z }); previous = { at: now, s: p.s };
  }
  assert.ok(freezes > 0, 'packet loss must exercise bounded extrapolation followed by freeze');
  assert.equal(peers.get('p').timeline.resetCount, 0);
  assert.ok(peers.get('p').timeline.delay <= 400);
});

test('a frozen playhead stays at the prediction horizon and resumes without a 1.5x catch-up phase', () => {
  const timeline = new RemoteTimeline(); push(timeline, 0); push(timeline, 200);
  const frozen = timeline.sample(1000), head = timeline.playhead;
  close(head, 550); close(timeline.sample(1016).z, frozen.z); close(timeline.playhead, head);
  push(timeline, 600, {}, { receivedAt: 1030 });
  const resumed = timeline.sample(1032); close(Math.abs(resumed.z - frozen.z), 20 * .016, .0001);
  assert.equal(timeline.resetCount, 0); assert.equal(timeline.mode, 'interpolate');
});


test('bounded half-RTT compensation predicts toward current time without changing authoritative state', () => {
 const peers=new Map();
 for(const time of [0,100])receiveRemoteSnapshot(peers,{now:100000+time,players:[{id:'p',stateAt:100000+time,state:state(time,{sampleTime:time,motionEpoch:1})}]},{receivedAt:time+150,networkDelay:50});
 const peer=peers.get('p'),p=peer.timeline.sample(300);
 close(p.s,3.6);close(peer.state.s,2);assert.ok(peer.timeline.delay<=100);
});
