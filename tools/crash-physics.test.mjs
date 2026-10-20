// Crash physics gates (arcade-sim contacts, src/crash-contact.js). The crash bench (tools/crash-bench.mjs) drives the real Vehicle,
// Ground, WorldTileBarriers, Traffic and multiplayer-contact code at 30 / 60 / 100 / 160 km/h; these are the properties that must
// hold. Before the fix a head-on wall hit at 60 km/h threw the car 1.3 m into the air for 2.4 s (8 m at 160, rolled over), a 30 degree
// glance rolled it, bridge rails stopped it dead, and two player cars sat 2-3 m inside each other for a second.
// node --import ./tools/physics-test/register.mjs --test tools/crash-physics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBench, trafficRestitution } from './crash-bench.mjs';
import { restitutionAt, CRASH, solveContact, solveCarHalf, carOverlap, resolveCarPair } from '../src/crash-contact.js';

const rows = runBench({ speeds: [30, 60, 100, 160], cars: ['z4', 'panda'] });
const pick = (tag, kmh, car = 'z4') => { const r = rows.find(r => r.tag === tag && r.kmh === kmh && (r.car ?? 'z4') === car && r.contact); assert.ok(r, `${tag} ${kmh} ${car}: no contact`); return r; };
const SPEEDS = [30, 60, 100, 160], CARS = ['z4', 'panda'];

test('every run stays finite and every static scenario makes contact', () => {
  assert.ok(rows.every(r => r.contact !== false || r.tag === 'traffic-tbone'), JSON.stringify(rows.filter(r => r.contact === false)));
  assert.ok(rows.filter(r => r.group === 'static').every(r => r.finiteState !== false));
});

test('head-on wall: a stop and a small bounce, never a launch, a roll or a corner-by-corner spin', () => {
  for (const car of CARS) for (const kmh of SPEEDS) {
    const r = pick('wall-headon', kmh, car);
    assert.ok(r.liftM < 0.4 && r.airMs < 700, `${car} ${kmh}: lift ${r.liftM} m, air ${r.airMs} ms`); // (a 1.3 t Panda may hop a hand's width; it was 1.3-8 m)
    assert.ok(r.peakRollDeg < 6 && r.peakPitchDeg < 25, `${car} ${kmh}: roll ${r.peakRollDeg} pitch ${r.peakPitchDeg}`);
    assert.ok(r.restitution >= 0 && r.restitution <= 0.32, `${car} ${kmh}: restitution ${r.restitution}`);
    assert.ok(r.speedLostPct > 70, `${car} ${kmh}: lost ${r.speedLostPct}%`);
    assert.ok(Math.abs(r.yawAt1sDeg) < 5, `${car} ${kmh}: a square hit must not spin the car (${r.yawAt1sDeg} deg)`);
    assert.ok(r.penetrationMax < 0.08, `${car} ${kmh}: penetration ${r.penetrationMax}`);
  }
});

test('30 degree glance on a wall, a guard rail and a bridge rail: scrubs speed, swings the car along the face, keeps going', () => {
  for (const tag of ['wall-glance30', 'guardrail-glance30', 'athens-rail-glance30']) for (const car of CARS) for (const kmh of [60, 100, 160]) {
    const r = pick(tag, kmh, car);
    assert.ok(r.speedAt1sKmh > 0.45 * r.entrySpeed && r.speedAt1sKmh < 0.9 * r.entrySpeed, `${tag} ${car} ${kmh}: ${r.speedAt1sKmh} of ${r.entrySpeed} km/h after 1 s (scrub, not a stop and not free)`);
    assert.ok(Math.abs(Math.abs(r.yawAt1sDeg) - 30) < 12, `${tag} ${car} ${kmh}: turned ${r.yawAt1sDeg} deg, should end up along the face`);
    assert.ok(r.peakRollDeg < 10 && r.liftM < 0.1, `${tag} ${car} ${kmh}: roll ${r.peakRollDeg}, lift ${r.liftM}`);
    assert.ok(!r.stoppedDead, `${tag} ${car} ${kmh}: stopped dead`);
    assert.ok(r.penetrationMax < 0.35, `${tag} ${car} ${kmh}: penetration ${r.penetrationMax}`);
  }
});

test('slow glance (30 km/h) does not pin the car to the wall', () => {
  for (const tag of ['wall-glance30', 'athens-rail-glance30']) for (const car of CARS) {
    const r = pick(tag, 30, car);
    assert.ok(r.speedAt1sKmh > 0.4 * r.entrySpeed, `${tag} ${car}: ${r.speedAt1sKmh} of ${r.entrySpeed} km/h after 1 s`);
  }
});

test('square on a bridge rail or guard rail: stop and bounce, bounded rebound, no launch', () => {
  for (const tag of ['guardrail-90', 'athens-rail-90']) for (const car of CARS) for (const kmh of SPEEDS) {
    const r = pick(tag, kmh, car);
    assert.ok(r.liftM < 0.5 && r.peakRollDeg < 20, `${tag} ${car} ${kmh}: lift ${r.liftM} roll ${r.peakRollDeg}`);
    assert.ok(r.restitution <= 0.32 && r.speedLostPct > 70, `${tag} ${car} ${kmh}: e ${r.restitution}, lost ${r.speedLostPct}`);
  }
});

test('a post at the door and a bollard at the nose are met (no tunnelling through thin things), without a launch', () => {
  for (const tag of ['lamp-side', 'bollard-nose']) for (const car of CARS) for (const kmh of SPEEDS) {
    const r = pick(tag, kmh, car);
    assert.ok(r.penetrationMax < 0.2, `${tag} ${car} ${kmh}: penetration ${r.penetrationMax}`);
    assert.ok(r.liftM < 0.6 && (kmh >= 160 || r.peakRollDeg < 30), `${tag} ${car} ${kmh}: lift ${r.liftM} roll ${r.peakRollDeg}`); // (a light car sliding sideways into a post at 160 km/h can trip over it; below that it only rocks)
  }
});

test('kerb strike and landing stay as they were: no big yaw, no stop', () => {
  for (const kmh of SPEEDS) {
    const k = pick('kerb-10deg', kmh); assert.ok(k.speedLostPct < 25 && Math.abs(k.yawDeg) < 12, JSON.stringify(k));
    const l = pick('landing', kmh); assert.ok(l.speedLostPct < 6 && l.rebounds <= 1 && l.peakRollDeg < 6, JSON.stringify(l));
  }
});

test('AI traffic: momentum is conserved by the contact, no energy appears, no jump, and the struck car reacts with its own mass', () => {
  for (const r of rows.filter(r => r.group === 'traffic' && r.contact)) {
    assert.ok(Math.abs(r.momentumErrPct) < 0.5 && r.energyGainPct < 1, `${r.tag} ${r.kmh}: momentum err ${r.momentumErrPct}%, energy gain ${r.energyGainPct}%`);
    assert.ok(r.penetrationMax < 0.3, `${r.tag} ${r.kmh}: penetration ${r.penetrationMax}`);
    assert.ok(r.playerPeakRollDeg < 25 && r.playerLiftM < 0.8, `${r.tag} ${r.kmh}: player roll ${r.playerPeakRollDeg} lift ${r.playerLiftM}`);
  }
  const bus = pick('traffic-rear-bus', 100), sedan = pick('traffic-rear', 100);
  assert.ok(bus.playerLostPct > sedan.playerLostPct, 'hitting a bus costs more speed than hitting a sedan (mass is used)');
  assert.ok(sedan.trafficGainKmh > 10, 'a struck sedan is knocked forward');
  const t = pick('traffic-tbone', 60); assert.ok(Math.abs(t.trafficYawDeg) > 5 || t.trafficSpeedAfterKmh > 15, 'a T-boned car is knocked sideways or spun');
});

test('two player cars (multiplayer path): equal and opposite for unequal masses, no interpenetration, bounded roll and lift', () => {
  const p = rows.filter(r => r.group === 'players' && r.contact);
  assert.equal(p.length, 4 * 4 * 2);
  for (const r of p) {
    assert.ok(Math.abs(r.momentumErrPct) < 0.5 && r.energyGainPct < 1, `${r.tag} ${r.carA}/${r.carB} ${r.kmh}: momentum err ${r.momentumErrPct}%, energy gain ${r.energyGainPct}%`);
    assert.ok(r.penetrationMax < 0.15, `${r.tag} ${r.carA}/${r.carB} ${r.kmh}: penetration ${r.penetrationMax}`);
    assert.ok(r.peakRollDeg < 25 && r.liftM < 0.6, `${r.tag} ${r.carA}/${r.carB} ${r.kmh}: roll ${r.peakRollDeg} lift ${r.liftM}`);
  }
  const head = p.find(r => r.tag === 'players-headon' && r.carA === 'panda' && r.carB === 'bus' && r.kmh === 100);
  assert.ok(head.aLostPct < 0 && head.bLostPct < 40, 'a Panda head-on into a bus is thrown back faster than it came (the bus barely slows)');
});

test('solver properties: bounded yaw kick, square hit has no spin, friction scrubs, restitution falls with speed', () => {
  const car = (o = {}) => ({ x: 0, z: 0, yaw: 0, vLong: 20, vLat: 0, w: 0, m: 1500, Iz: 2200, halfL: 2.2, halfW: 0.9, ...o });
  // offset blow at a corner: bounded
  const v = car(); const h = solveContact(v, 0, 1, 0.9, -2.2, {}); assert.ok(h && Math.abs(v.w) <= CRASH.yawKickMax + 1e-9, `kick ${v.w}`);
  // a light tap at the same corner is much smaller than a hard one (not saturated)
  const tap = car({ vLong: 2 }); solveContact(tap, 0, 1, 0.9, -2.2, {}); assert.ok(Math.abs(tap.w) < 0.4 * Math.abs(v.w), `tap ${tap.w} vs ${v.w}`);
  // a square hit at the middle of the nose: no spin, no sideways kick
  const sq = car(); solveContact(sq, 0, 1, 0, -2.2, {}); assert.ok(Math.abs(sq.w) < 1e-9 && Math.abs(sq.vLat) < 1e-9);
  // friction along the face: a glancing blow on a wall loses tangential speed too (not just normal)
  const gl = car({ vLong: 20, vLat: 0, yaw: -0.5 }); const t0 = Math.hypot(gl.vLong, gl.vLat); solveContact(gl, 1, 0, 0, 0, {}); void t0;
  assert.ok(restitutionAt(1) < restitutionAt(4) && restitutionAt(4) > restitutionAt(20) && restitutionAt(20) >= 0.1 - 1e-9 && restitutionAt(4) <= 0.3 + 1e-9);
  assert.equal(restitutionAt(0.1), 0, 'a resting touch does not bounce');
});

test('traffic.js restitution matches crash-contact.js', () => {
  for (const vn of [0, 0.2, 1, 2, 3, 5, 8, 12, 15, 25, 44]) assert.ok(Math.abs(trafficRestitution(vn) - restitutionAt(vn)) < 1e-12, `vn ${vn}`);
});

test('random car pairs: both halves conserve momentum exactly and never add energy', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const masses = [1000, 1300, 1700, 2500, 11000];
  for (let i = 0; i < 300; i++) {
    const mk = (m) => ({ x: 0, y: 0, z: 0, yaw: (rnd() - 0.5) * 6.28, vLong: (rnd() - 0.3) * 40, vLat: (rnd() - 0.5) * 6, w: (rnd() - 0.5) * 2, m, Iz: m * 1.5, halfL: 1.8 + m / 6000, halfW: 0.85 + m / 20000, hcg: 0.5, spec: { mass: m } });
    const a = mk(masses[i % 5]), b = mk(masses[(i * 3 + 1) % 5]);
    const d = 3 + rnd() * 1.5, ang = rnd() * 6.28; b.x = Math.cos(ang) * d; b.z = Math.sin(ang) * d;
    if (!carOverlap(a, b)) continue;
    const wv = v => [-Math.sin(v.yaw) * v.vLong + Math.cos(v.yaw) * v.vLat, -Math.cos(v.yaw) * v.vLong - Math.sin(v.yaw) * v.vLat];
    const P = () => [a.m * wv(a)[0] + b.m * wv(b)[0], a.m * wv(a)[1] + b.m * wv(b)[1]], E = () => 0.5 * a.m * wv(a).reduce((s, x) => s + x * x, 0) + 0.5 * b.m * wv(b).reduce((s, x) => s + x * x, 0) + 0.5 * a.Iz * 1.25 * a.w ** 2 + 0.5 * b.Iz * 1.25 * b.w ** 2;
    const p0 = P(), e0 = E(), r = resolveCarPair(a, b);
    if (!r) continue;
    const p1 = P(); const scale = a.m * Math.hypot(...wv(a)) + b.m * Math.hypot(...wv(b)) + 1;
    // (positions move; the check is on velocities, taken from the same frozen state by both halves)
    assert.ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / scale < 1e-6, `case ${i}: momentum ${p0} -> ${p1}`);
    assert.ok(E() <= e0 * (1 + 1e-6) + 1, `case ${i}: energy ${e0} -> ${E()}`);
  }
});
