// Regression tests for the 2026-10-18 playtest ("cars move step by step", "some people can ram others, others can't").
// Everything here runs the production sender, arena core, intake, timeline and contact code through tools/mp-link-sim.mjs:
// virtual time, two drivers, a curving/accelerating car from a 15 fps sender, a 150 ms +/- 50 ms link with retransmit stalls.
// The older proofs used a constant 20 m/s straight line sampled at an exact 10 Hz, which cannot show either bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLink, runCollision, NET } from './mp-link-sim.mjs';
import { ContactCoordinator, resolvePlayerContacts, contactWindow, CONTACT_DEDUPE_MS } from '../src/multiplayer-contact.js';
import { restitutionAt } from '../src/crash-contact.js';
import { RELAY_MS, STATE_BATCHING, STATE_INTERVAL_MS } from '../src/multiplayer-protocol.js';

test('the car-state path samples at 20 Hz, relays every 50 ms and still sends at most ten messages a second', () => {
  assert.equal(STATE_INTERVAL_MS, 50); assert.equal(RELAY_MS, 50); assert.equal(STATE_BATCHING, true);
  for (const senderFps of [15, 60]) {
    const { stats } = runLink({ senderFps, net: NET.rtt150, seconds: 12 });
    assert.ok(stats.wire.upMsgPerSec <= 10, `${senderFps} fps sender: ${stats.wire.upMsgPerSec} messages/s`);
  }
});

test('a 15 fps sender over a jittery link is interpolated, not drawn step by step', () => {
  const clean = runLink({ senderFps: 15, net: NET.mid }).stats;
  // A drawn path as smooth as the real one: jerk within 3x of the car's own (it was 24x with a 15 fps sender on this link).
  assert.ok(clean.drawn.jerkRms < 3 * clean.truth.jerkRms, `jerk ${clean.drawn.jerkRms} vs real ${clean.truth.jerkRms}`);
  assert.ok(clean.drawn.speedDevMax < .05); assert.equal(clean.drawn.stallPct, 0);
  assert.ok(clean.delayMs >= 100 && clean.delayMs <= 280, 'the render delay is a 100-280 ms jitter buffer');
  for (const [name, net, jerk, lag] of [['150 ms RTT +/- 50, 1.5% stalls', NET.rtt150, 1500, 400], ['150 ms each way +/- 50, 1.5% stalls', NET.bad, 1500, 540]]) {
    const { drawn, lagMs } = runLink({ senderFps: 15, net }).stats;
    assert.ok(drawn.jerkRms < jerk, `${name}: jerk ${drawn.jerkRms} (was 2800-4700)`);
    assert.ok(drawn.speedDevMax < .15, `${name}: worst frame-to-frame speed change ${drawn.speedDevMax} (was 0.27-1.0)`);
    assert.equal(drawn.stallPct, 0, `${name}: no frozen frames`);
    assert.ok(lagMs <= lag, `${name}: smoothing must not cost latency (${lagMs} ms)`);
  }
});

test('a fast sender is just as smooth, and a perfect link is exactly as smooth as the real car', () => {
  for (const senderFps of [15, 60]) {
    const { drawn, truth } = runLink({ senderFps, net: NET.none }).stats;
    assert.ok(drawn.jerkRms < 1.5 * truth.jerkRms, `${senderFps} fps: ${drawn.jerkRms} vs ${truth.jerkRms}`);
  }
});

// ---- contacts
const cases = [[4, 'A'], [4, 'B'], [10, 'A'], [10, 'B'], [20, 'A'], [20, 'B']];
const nets = { 'no latency': NET.none, '150 ms RTT +/- 50': NET.rtt150, '150 ms each way +/- 50': NET.bad };
test('a rear-end hit changes both cars by the momentum-conserving amount, once each, whoever hits whom and whoever lags', () => {
  for (const [label, net] of Object.entries(nets)) for (const [closing, attacker] of cases) for (const fps of [{ A: 60, B: 15 }, { A: 15, B: 60 }, { A: 15, B: 15 }]) {
    const r = runCollision({ closing, attacker, fps, net });
    const where = `${label}, ${attacker} rams at +${closing} m/s, fps A${fps.A}/B${fps.B}`;
    assert.deepEqual(r.applications, [1, 1], `${where}: each car is hit exactly once (${r.applications})`);
    assert.ok(Math.abs(r.attackerDv - r.expectedAttacker) <= .06 * closing + .05, `${where}: attacker dv ${r.attackerDv} vs ${r.expectedAttacker}`);
    assert.ok(Math.abs(r.victimDv - r.expectedVictim) <= .06 * closing + .05, `${where}: victim dv ${r.victimDv} vs ${r.expectedVictim}`);
    assert.ok(Math.abs(r.momentumError) <= .1 * closing * 1500 / 2, `${where}: momentum error ${r.momentumError}`);
  }
});
test('A ramming B and B ramming A feel the same, with unequal masses too', () => {
  for (const masses of [{ A: 1000, B: 2000 }, { A: 2000, B: 1000 }]) {
    const ab = runCollision({ closing: 12, attacker: 'A', masses, net: NET.rtt150 }), ba = runCollision({ closing: 12, attacker: 'B', masses, net: NET.rtt150 });
    for (const r of [ab, ba]) { assert.deepEqual(r.applications, [1, 1]); assert.ok(Math.abs(r.attackerDv - r.expectedAttacker) < .7 && Math.abs(r.victimDv - r.expectedVictim) < .7, JSON.stringify(r)); }
    // The same two cars, hit from the other side: the lighter car always takes the bigger change, either way round.
    const light = r => r.result.A.m < r.result.B.m ? Math.abs(r.result.A.dv) : Math.abs(r.result.B.dv), heavy = r => r.result.A.m < r.result.B.m ? Math.abs(r.result.B.dv) : Math.abs(r.result.A.dv);
    assert.ok(light(ab) > 1.8 * heavy(ab) && light(ba) > 1.8 * heavy(ba));
    assert.ok(Math.abs(light(ab) - light(ba)) < .7);
  }
});
test('a parked car is solid: it stops sending, and is still rammed and shoved like any other', () => {
  for (const [label, net] of Object.entries(nets)) for (const attacker of ['A', 'B']) {
    const r = runCollision({ closing: 12, attacker, baseSpeed: 0, net, fps: { A: 15, B: 60 } });
    assert.deepEqual(r.applications, [1, 1], `${label}: ${attacker} rams a parked car`);
    assert.ok(Math.abs(r.attackerDv - r.expectedAttacker) < .5 && Math.abs(r.victimDv - r.expectedVictim) < .5, `${label}: ${r.attackerDv} / ${r.victimDv} (want ${r.expectedAttacker} / ${r.expectedVictim})`);
  }
  // The old rule skipped any car whose last packet was over 350 ms old, and a parked car's last packet is minutes old.
  const old = runCollision({ mode: 'legacy', closing: 12, attacker: 'B', baseSpeed: 0, net: NET.rtt150 });
  assert.equal(old.attackerDv, 0, 'on the old path the rammer drives straight through the parked car (its last packet is minutes old) while the parked driver is shoved');
});
test('the old path reproduces the owner\'s report: the rammer is stopped, the car it hit never notices', () => {
  const r = runCollision({ mode: 'legacy', closing: 10, attacker: 'B', fps: { A: 15, B: 60 }, net: NET.rtt150 });
  assert.equal(r.victimDv, 0, 'tested against a drawn pose that lags, the victim sees no car arrive');
  assert.ok(r.attackerDv < -9, 'and the attacker hits a ghost, repeatedly');
  assert.ok(r.applications[0] > 1);
});

test('one contact is applied once: repeated, crossed and late reports never double a hit', () => {
  const car = (z, vLong) => ({ x: 0, y: 0, z, yaw: 0, vLong, vLat: 0, halfW: .9, halfL: 2.2, m: 1500, hcg: .5, hits: 0, impactDynamics() { this.hits++; }, addDamage() {} });
  let serverNow = 5000; const sent = [], mine = new ContactCoordinator({ send: e => sent.push(e), serverNow: () => serverNow });
  const local = car(0, 30), proxy = car(-3.5, 20);
  const report = (nonce, extra = {}) => ({ from: 'them', nonce, at: serverNow, x: 0, z: 0, vx: 0, vz: -30, m: 1500, nx: 0, nz: 1, closing: 10, ...extra });
  // 1. this car detects first: it applies its half and reports once.
  mine.reset('race'); mine.step(local, [{ id: 'them', vehicle: proxy }], .016, 1000);
  assert.equal(local.hits, 1); assert.equal(sent.length, 1); assert.ok(sent[0].closing > 9);
  const after = local.vLong; assert.ok(after < 30);
  // 2. the other driver's own report of the same contact arrives afterwards: ignored (already resolved here).
  assert.equal(mine.receive(report(0), local, 1100), null); assert.equal(local.vLong, after);
  // 3. every following frame inside the window is quiet, report or not.
  mine.step(local, [{ id: 'them', vehicle: proxy }], .016, 1200); assert.equal(local.hits, 1); assert.equal(sent.length, 1);
  // 4. a pair that was only reported (never detected here): applied once, a duplicate nonce is dropped, so is a second report in the window.
  const other = new ContactCoordinator({ send() {}, serverNow: () => serverNow }), victim = car(-3.5, 20); other.reset('race');
  const hit = other.receive(report(7, { nz: 1 }), victim, 1000); assert.ok(hit); assert.ok(victim.vLong > 20, 'pushed forward by the car that hit it');
  const once = victim.vLong; assert.equal(other.receive(report(7), victim, 1050), null); assert.equal(other.receive(report(8), victim, 1100), null);
  other.step(victim, [{ id: 'them', vehicle: car(-1.5, 20) }], .016, 1200); assert.equal(victim.vLong, once, 'a local detection right after an applied report is the same contact');
  // 5. once the window has passed, a new collision is a new contact.
  const later = 1000 + contactWindow(0) + 50; assert.ok(contactWindow(0) >= CONTACT_DEDUPE_MS);
  assert.ok(other.receive(report(9), victim, later));
  // 6. old, malformed or impossible reports are refused.
  const fresh = new ContactCoordinator({ send() {}, serverNow: () => serverNow }), v = car(-3.5, 20); fresh.reset('race');
  assert.equal(fresh.receive(report(0, { at: serverNow - 5000 }), v, 1000), null, 'a contact from five seconds ago is over');
  assert.equal(fresh.receive(report(1, { x: 400 }), v, 1000), null, 'a report from a car nowhere near this one');
  assert.equal(fresh.receive(report(2, { vx: NaN }), v, 1000), null);
  assert.equal(fresh.receive(report(3), v, 1000, { ghost: true }), null, 'towed/finished/disconnected cars do not touch anyone');
  assert.equal(fresh.receive(report(4, { vz: -80 }), v, 1000, { knownVelocity: { x: 0, z: -30 } }), null, 'a velocity the reporter was nowhere near cannot buy a bigger shove');
  assert.equal(v.vLong, 20); assert.equal(v.hits, 0);
});

test('the shallowest axis the cars are closing along is the contact normal, even for a pose that arrives deep inside the other car', () => {
  const car = (z, vLong) => ({ x: 0, y: 0, z, yaw: 0, vLong, vLat: 0, halfW: .9, halfL: 2.2, m: 1500, hcg: .5, impactDynamics() {}, addDamage() {} });
  const local = car(0, 40), hits = resolvePlayerContacts(local, [{ id: 'x', vehicle: car(-2.7, 20) }], .016, 1000);
  assert.equal(hits.length, 1); assert.ok(Math.abs(hits[0].closing - 20) < 1e-6, `${hits[0].closing}: a car 1.7 m inside another is still a head-on hit`);
  assert.ok(Math.abs(local.vLong - (40 - 10 * (1 + restitutionAt(20)))) < 1e-6);
});

// ---- the production wiring in main.js, executed as written (only the world around it is stubbed)
import { readFileSync } from 'node:fs';
import { receiveRemoteSnapshot, remoteContactPose } from '../src/remote-timeline.js';
import { recoveryHeld } from '../src/recovery-policy.js';
import { containOnlineVehicle } from '../src/multiplayer-contact.js';
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const contactBlock=main.slice(main.indexOf('function stepOnlineContacts('),main.indexOf('function drawUnifiedFrame('));
function wiring({ peerAge = 0, moving = false, member = {}, peer = true, towing=false,hold=0 } = {}) {
  const sent = [], state = (t, v) => ({ x: 0, y: 0, z: -3.5 - (v ? v * t / 1000 : 0), s: 3.5, u: 0, yaw: 0, vLong: v, vLat: 0, steer: 0, rpm: 900, gear: 1, sampleTime: t, motionEpoch: 1 });
  const peers = new Map(), at = 100000 - peerAge;
  if (peer) for (const t of moving ? [0, 50, 100] : [0]) receiveRemoteSnapshot(peers, { now: at + t, players: [{ id: 'them', stateAt: at + t, state: state(t, moving ? 2 : 0) }] }, { receivedAt: at + t });
  const multiplayer = { lobby: { raceId: 'race', players: [{ id: 'them', loaded: true, connected: true, ...member }] }, peers, now: () => 100000, latency: 0, contacts: null, lastContacts: [] };
  const coordinator = new ContactCoordinator({ send: e => sent.push(e), serverNow: () => 100000 });
  const pv = { x: 0, y: 0, z: moving ? -1.5 : 0, yaw: 0, vLong: 20, vLat: 0, halfW: .9, halfL: 2.2, m: 1500, hcg: .5, s: 0, u: 0, impactDynamics() {}, addDamage() {} };
  const car = { veh: { x: 0, y: 0, z: -3.5, yaw: 0, vLong: 0, vLat: 0, halfW: .9, halfL: 2.2, m: 1500, hcg: .5 } };
  const run=Function('multiplayer','contactCoordinator','G','remoteCars','remoteContactPose','recoveryHeld','towOffer','playerImpactVoice','performance',contactBlock+';return stepOnlineContacts;')(multiplayer,coordinator,{state:'race',t:0,simNow:100000,towing},new Map([['them',car]]),remoteContactPose,recoveryHeld,{recovering:hold>0,hold},()=>{},{now:()=>100000});
  run(pv,1/60);
  return { hits: multiplayer.lastContacts, sent, pv, multiplayer };
}
test('main.js contact wiring: silent parked cars are solid, stale moving cars and absent or unloaded cars are ghosts', () => {
  assert.ok(contactBlock.includes('contactCoordinator.step(') && contactBlock.includes('remoteContactPose('), 'the block under test is the production one');
  assert.equal(wiring({towing:true}).hits.length,0,'an active tow cannot create a contact');assert.equal(wiring({hold:1}).hits.length,0,'a recovery hold cannot create a contact');
  const parked = wiring({ peerAge: 600000 });
  assert.equal(parked.hits.length, 1, 'a car that parked ten minutes ago is still there'); assert.equal(parked.sent.length, 1, 'and the hit is reported to its driver once'); assert.ok(parked.pv.vLong < 11);
  assert.equal(wiring({ moving: true, peerAge: 60 }).hits.length, 1, 'a live moving car');
  assert.equal(wiring({ moving: true, peerAge: 5000 }).hits.length, 0, 'a moving car whose stream died 5 s ago is not evidence of where anyone is');
  assert.equal(wiring({ peer: false }).hits.length, 0, 'nobody to hit before their first packet');
  for (const member of [{ loaded: false }, { connected: false }, { dnf: 'retired' }, { finish: 40 }]) assert.equal(wiring({ member }).hits.length, 0, JSON.stringify(member));
});
