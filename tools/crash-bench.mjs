// Deterministic crash bench (no browser): drives the REAL Vehicle / Ground / WorldTileBarriers / Traffic / multiplayer-contact code
// into walls, rails, posts, kerbs, AI traffic and other players at 30 / 60 / 100 / 160 km/h and measures what happens.
//   node tools/crash-bench.mjs [--out=file.json] [--only=substring] [--speeds=30,60,100,160] [--cars=z4,panda] [--md]
// Every row is one run; nothing is injected after the run starts except the initial speed (and the obstacle layout).
import './physics-test/register.mjs';
import { register } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from './physics-test/three-stub.mjs';

// ---- load the production modules (rendering imports stubbed only)
const roadSource = readFileSync(new URL('../src/road.js', import.meta.url), 'utf8'), roadStart = roadSource.indexOf('export const ROAD =');
const roadURL = 'data:text/javascript,' + encodeURIComponent(`import { lerp, smoothstep } from ${JSON.stringify(new URL('../src/util.js', import.meta.url).href)};\n` + roadSource.slice(roadStart, roadSource.indexOf('\n};', roadStart) + 3));
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (ctx.parentURL?.endsWith('/src/ground.js')) {
    if (spec === './road.js') return {url:${JSON.stringify(roadURL)},shortCircuit:true};
    if (spec === './tex.js') return {url:'data:text/javascript,export const TX={};',shortCircuit:true};
  } return next(spec,ctx);
}`), import.meta.url);
const { ROAD: REAL_ROAD } = await import(roadURL);
const { ROAD: STUB_ROAD } = await import('./physics-test/road-stub.mjs');
Object.assign(STUB_ROAD, { gutter: REAL_ROAD.gutter, curbH: REAL_ROAD.curbH, sidewalk: REAL_ROAD.sidewalk }); // physics.js sees the headless stub; kerbs need the real numbers
const { Ground } = await import('../src/ground.js');
const { Vehicle } = await import('../src/physics.js');
const { AthensGround, AthensRoute } = await import('../src/athens-ground.js');
const { WorldTileBarriers } = await import('../src/world-tile-barriers.js');
const { ContactCoordinator } = await import('../src/multiplayer-contact.js');
const { startFlight } = await import('../src/airborne-dynamics.js');
const { RNG, clamp, lerp, smoothstep } = await import('../src/util.js');
const { damageIncrement, equivalentBarrierSpeed } = await import('../src/damage-math.js');
const { impactTarget } = await import('../src/impact-ragdoll.js');
const roundaboutHelpers = await import('../src/roundabouts.js');
const trafficSource = readFileSync(new URL('../src/traffic.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const T = new Function('THREE', 'RNG', 'clamp', 'lerp', 'smoothstep', 'ROAD', 'LANE_W', 'damageIncrement', 'equivalentBarrierSpeed', 'impactTarget', 'roundaboutHelpers',
  'const {circulatingPoint,roundaboutRange,entryYieldDistance,ringStation,ringPoint,polylinePoint,polylineStation,trafficRoundaboutRange,roundaboutYield}=roundaboutHelpers;\n' + trafficSource + '\nreturn { Traffic, routeVel, setRouteVel, pushVeh, restitutionFor: typeof restitutionFor === "function" ? restitutionFor : null };',
)(THREE, RNG, clamp, lerp, smoothstep, { gutter: 0.3 }, 3.5, damageIncrement, equivalentBarrierSpeed, impactTarget, roundaboutHelpers);
const catalogue = readFileSync(new URL('../src/cars.js', import.meta.url), 'utf8');
const CARS = Function('return ' + catalogue.split('export const CARS = ')[1].split('\n];')[0] + '\n];')();
const spec = id => { const c = CARS.find(c => c.id === id); if (!c) throw new Error('no car ' + id); return c; };

// ---- constants / helpers
export let lastVehicle = null;
const DT = 1 / 60, G = 9.81, DEG = 180 / Math.PI;
const KMH = [30, 60, 100, 160];
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const fwdOf = v => [-Math.sin(v.yaw), -Math.cos(v.yaw)], rightOf = v => [Math.cos(v.yaw), -Math.sin(v.yaw)];
const worldVel = v => { const f = fwdOf(v), r = rightOf(v); return [f[0] * v.vLong + r[0] * v.vLat, f[1] * v.vLong + r[1] * v.vLat]; };
const speedOf = v => Math.hypot(...worldVel(v));
const round = (x, n = 3) => Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : x;
function bodyAngles(v) {
  if (v.rigid) {
    const q = v.rigid.q;
    return { pitch: Math.asin(clamp(2 * (q[3] * q[0] - q[1] * q[2]), -1, 1)), roll: Math.atan2(2 * (q[0] * q[1] + q[3] * q[2]), 1 - 2 * (q[0] * q[0] + q[2] * q[2])) };
  }
  return { pitch: v.pose.pitch || 0, roll: v.pose.roll || 0 };
}
// SAT overlap depth of two oriented boxes ({x,z,yaw,hw,hl}: forward = (-sin yaw, -cos yaw)); 0 when apart
function obbOverlap(A, B, inflate = 0) {
  const ax = (o) => [{ x: Math.cos(o.yaw), z: -Math.sin(o.yaw), h: o.hw }, { x: -Math.sin(o.yaw), z: -Math.cos(o.yaw), h: o.hl }];
  const Aa = ax(A), Bb = ax(B), dx = B.x - A.x, dz = B.z - A.z;
  let depth = Infinity;
  for (const n of [...Aa, ...Bb]) {
    const ra = Aa.reduce((s, a) => s + a.h * Math.abs(a.x * n.x + a.z * n.z), 0) + inflate, rb = Bb.reduce((s, b) => s + b.h * Math.abs(b.x * n.x + b.z * n.z), 0);
    const o = ra + rb - Math.abs(dx * n.x + dz * n.z);
    if (o <= 0) return 0;
    depth = Math.min(depth, o);
  }
  return depth;
}
const carBox = v => ({ x: v.x, z: v.z, yaw: v.yaw, hw: v.halfW, hl: v.halfL });

// ---- flat worlds
function flatRoute(extra = {}) {
  return { closed: true, length: 1e6, wrap: s => s, GR: null, TX: 'TX', TZ: 'TZ',
    frame(s, o) { return Object.assign(o, { tx: 0, tz: -1, rx: 1, rz: 0, grade: 0, bank: 0 }); },
    point: (s, u) => ({ x: u, z: -s, y: 0 }), y: () => 0, bank: () => 0, surfaceY: () => 0, urban: () => 1, edge: () => 900, lin: (a) => a === 'TZ' ? -1 : 0,
    medHalf: () => 0, div: () => 0, seaR: () => 1e4, seaL: () => 1e4, lanes: () => 2, laneU: (_, lane) => 1.75 + 3.5 * lane, district: () => 'town',
    project: (x, z) => ({ s: -z, u: x }), ...extra };
}
function flatGround(route, { parked = [], walls = [], rail = null } = {}) {
  const g = Object.assign(Object.create(Ground.prototype), { HC: 20, bh: new Map(), hh: new Map(), parked, route, out: {}, traps: [], heightC: () => 0, terrain: { cls: () => 0 }, hump: () => 0,
    limits: (s, r, o) => Object.assign(o, { min: -900, max: rail === null ? 900 : rail - 0.25 - r }) });
  for (const seg of walls) g._put(g.bh, (seg[0] + seg[2]) / 2, (seg[1] + seg[3]) / 2, Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) / 2 + 2, seg);
  return g;
}
function gearFor(v, ms) { // what a driver would be in: engine near half the redline
  const sp = v.spec, rpmAt = g => ms / sp.wheelR * sp.gears[g - 1] * sp.final * 60 / (2 * Math.PI);
  let best = 1, err = Infinity;
  for (let g = 1; g <= sp.gears.length; g++) { const e = Math.abs(rpmAt(g) - sp.redline * 0.5); if (e < err) { err = e; best = g; } }
  return best;
}
function makeCar(id, route, ground, ms, { s = 40, u = 0, yaw = 0 } = {}) {
  const v = new Vehicle(spec(id), route);
  v.ground = ground; v.reset(s, u, ms); v.manual = true; v.gear = gearFor(v, ms); v.roadEvents = false;
  if (yaw) { v.yaw += yaw; const f = Math.hypot(v.vLong, v.vLat); v.vLong = f; v.vLat = 0; }
  v.syncWheels();
  return v;
}

// ---- one static run: record a trace, then reduce it to the report columns
function runStatic({ car, kmh, build, seconds = 3.5, approach = 0.5, pre = 0.4, obstacle, normal, input = { throttle: 0, brake: 0, steer: 0 }, tag }) {
  const ms = kmh / 3.6, w = build(ms, car);
  lastVehicle = w.v;
  const { v, step = (dt) => v.update(dt, input), done = () => false } = w;
  const trace = [];
  let t = 0, first = null, last = null, prevAir = true, landingSpeed = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++, t += DT) {
    const before = { vel: worldVel(v), yaw: v.yaw, w: v.w, speed: speedOf(v) };
    const hit0 = v.wallHit; v.wallHit = 0; v.curbHit = 0;
    step(DT);
    const a = bodyAngles(v), cb = carBox(v);
    const pen = obstacle ? obbOverlap(cb, obstacle(), 0) : 0, touch = obstacle ? obbOverlap(cb, obstacle(), 0.04) : 0;
    const row = { t, vel: worldVel(v), speed: speedOf(v), yaw: v.yaw, w: v.w, pen, touch, wall: v.wallHit, roll: a.roll, pitch: a.pitch, y: v.y, vy: v.vy || 0, air: !!(v.bodyDynamic || v.air), x: v.x, z: v.z, before };
    const kerbHit = v.curbHit > 0 && tag === 'kerb-10deg', airNow = !!(v.bodyDynamic || v.air), landed = tag === 'landing' && prevAir && !airNow;
    prevAir = airNow;
    if (first === null && (v.wallHit > 0 || pen > 0 || kerbHit || landed)) first = i;
    if (v.wallHit > 0 || touch > 0 || kerbHit || landed) last = i;
    if (landed) landingSpeed = v.landingSpeed || 0;
    trace.push(row); v.wallHit = Math.max(v.wallHit, 0); void hit0;
    if (done()) break;
  }
  if (process.env.BENCH_TRACE) for (let i = 0; i < trace.length; i += 6) console.error(tag, kmh, i, 'v', round(trace[i].speed * 3.6, 1), 'yaw', round(trace[i].yaw * DEG, 1), 'pen', round(trace[i].pen, 3), 'wall', round(trace[i].wall, 2), 'y', round(trace[i].y, 2));
  const r = reduce({ car, kmh, tag, trace, first, last, normal, v, ms, obstacle });
  if (process.env.BENCH_PATH) { r.dims = [v.halfL, v.halfW]; r.firstFrame = first; r.path = trace.map(t => [round(t.x, 2), round(t.z, 2), round(t.yaw, 3), round(t.y, 2), round(t.pitch, 3), round(t.roll, 3), round(t.speed, 2)]); }
  if (tag === 'landing' && r.contact) { let bounces = 0, p = false, settle = null; for (let i = first; i < trace.length; i++) { if (trace[i].air && !p) bounces++; p = trace[i].air; if (settle === null && !trace[i].air && Math.abs(trace[i].pitch) < 0.01 && Math.abs(trace[i].roll) < 0.01 && Math.abs(trace[i].vy) < 0.05) settle = (i - first) * DT * 1000; } r.landingSpeedMs = round(landingSpeed, 2); r.rebounds = bounces; r.settleMs = settle === null ? null : round(settle, 0); }
  return r;
}
function reduce({ car, kmh, tag, trace, first, last, normal, v, ms }) {
  const out = { car, kmh, tag };
  if (first === null) return { ...out, contact: false, note: 'no contact' };
  const pre = trace[Math.max(0, first - 1)], speed0 = pre.speed, vel0 = pre.vel, yaw0 = pre.yaw;
  const win = trace.slice(first), end = trace[Math.min(trace.length - 1, last + 6)];
  const n = normal ? normal : [-vel0[0] / (speed0 || 1), -vel0[1] / (speed0 || 1)]; // from the obstacle toward the car
  const vn0 = -(vel0[0] * n[0] + vel0[1] * n[1]);
  let pen = 0, contactFrames = 0, jitter = 0, prevSign = 0, peakYawRate = 0, peakRoll = 0, peakPitch = 0, peakUp = 0, peakDv = 0, tunnel = false, maxVy = 0, airFrames = 0, vnMin = Infinity, vnMax = -Infinity;
  for (let i = 0; i < win.length; i++) {
    const r = win[i]; pen = Math.max(pen, r.pen);
    if (i <= last - first + 6) {
      if (r.touch > 0 || r.wall > 0) contactFrames++;
      const vn = r.vel[0] * n[0] + r.vel[1] * n[1];
      const sign = r.touch > 0 ? Math.sign(vn) || prevSign : prevSign;
      if (prevSign && sign && sign !== prevSign) jitter++;
      if (sign) prevSign = sign;
      vnMin = Math.min(vnMin, vn); vnMax = Math.max(vnMax, vn);
    }
    peakYawRate = Math.max(peakYawRate, Math.abs(r.w)); peakRoll = Math.max(peakRoll, Math.abs(r.roll)); peakPitch = Math.max(peakPitch, Math.abs(r.pitch));
    peakUp = Math.max(peakUp, r.y - pre.y); maxVy = Math.max(maxVy, r.vy); if (r.air) airFrames++;
    peakDv = Math.max(peakDv, Math.hypot(r.vel[0] - r.before.vel[0], r.vel[1] - r.before.vel[1]));
  }
  const vnAfter = end.vel[0] * n[0] + end.vel[1] * n[1], rebound = vn0 > 0.5 ? clamp(vnAfter / vn0, -1, 5) : null;
  const dirDeg = (a, b) => wrapPi(Math.atan2(b[0], -b[1]) - Math.atan2(a[0], -a[1])) * DEG;
  const t1 = trace[Math.min(trace.length - 1, first + 60)];
  return { ...out, contact: true, entrySpeed: round(speed0 * 3.6, 1), closing: round(vn0 * 3.6, 1),
    speedAfterKmh: round(end.speed * 3.6, 1), speedLostPct: round(100 * (1 - end.speed / speed0), 1), speedAt1sKmh: round(t1.speed * 3.6, 1),
    restitution: rebound === null ? null : round(Math.max(0, rebound), 2), vnAfterKmh: round(vnAfter * 3.6, 1),
    reboundTurnDeg: round(dirDeg(vel0, end.vel), 0), yawDeg: round(wrapPi(end.yaw - yaw0) * DEG, 1), yawAt1sDeg: round(wrapPi(t1.yaw - yaw0) * DEG, 1), peakYawRate: round(peakYawRate, 2),
    peakRollDeg: round(peakRoll * DEG, 1), peakPitchDeg: round(peakPitch * DEG, 1), liftM: round(peakUp, 2), peakVy: round(maxVy, 2), airMs: round(airFrames * DT * 1000, 0),
    penetrationMax: round(pen, 3), contactMs: round(contactFrames * DT * 1000, 0), jitter, peakDvFrame: round(peakDv * 3.6, 1),
    stoppedDead: end.speed < 0.6 && speed0 > 8, finiteState: [v.x, v.z, v.yaw, v.vLong, v.vLat, v.w].every(Number.isFinite),
    tunnelled: tunnel };
}

// ---- static scenarios
const WALL_Z = -60;
const wallHeadOn = ({ car, kmh }) => {
  const route = flatRoute(), wall = [-40, WALL_Z, 40, WALL_Z];
  return { car, kmh, tag: 'wall-headon', normal: [0, 1], obstacle: () => ({ x: 0, z: WALL_Z - 0.01, yaw: 0, hw: 40, hl: 0.01 }),
    build: (ms) => ({ v: makeCar(car, route, flatGround(route, { walls: [wall] }), ms, { s: -WALL_Z - 6 - ms * 0.8 }) }) };
};
const wall30 = ({ car, kmh }) => {
  // a long wall whose face makes 30 degrees with the car's path (a true glancing blow), met by the car's left front corner
  const route = flatRoute(), a = 30 / DEG, Q = [0.8, WALL_Z], t = [Math.sin(a), -Math.cos(a)], n = [Math.cos(a), Math.sin(a)];
  const seg = [Q[0] - t[0] * 40, Q[1] - t[1] * 40, Q[0] + t[0] * 40, Q[1] + t[1] * 40];
  return { car, kmh, tag: 'wall-glance30', normal: n, obstacle: () => ({ x: Q[0], z: Q[1], yaw: Math.PI / 2 - a, hw: 40, hl: 0.01 }),
    build: (ms) => ({ v: makeCar(car, route, flatGround(route, { walls: [seg] }), ms, { s: -WALL_Z - 6 - ms * 0.8 }) }) };
};
const railGlance = ({ car, kmh }) => {
  const route = flatRoute(), RAIL = 4.0, a = 30 / DEG;
  // the car travels along the road at 30 degrees towards the rail (right side): yaw to the right (negative yaw is right in this convention)
  return { car, kmh, tag: 'guardrail-glance30', normal: [-1, 0], obstacle: () => ({ x: RAIL + 0.25 + 0.5, z: -3000, yaw: 0, hw: 0.5, hl: 3000 }),
    build: (ms) => ({ v: makeCar(car, route, flatGround(route, { rail: RAIL }), ms, { s: 20, u: 0, yaw: -a }) }) };
};
const railHeadOn = ({ car, kmh }) => {
  const route = flatRoute(), RAIL = 4.0, a = 90 / DEG;
  return { car, kmh, tag: 'guardrail-90', normal: [-1, 0], obstacle: () => ({ x: RAIL + 0.25 + 0.5, z: -3000, yaw: 0, hw: 0.5, hl: 3000 }),
    build: (ms) => ({ v: makeCar(car, route, flatGround(route, { rail: RAIL }), ms, { s: 20, u: -2, yaw: -a }) }) };
};
const post = (tag, side) => ({ car, kmh }) => {
  const route = flatRoute();
  const sp = spec(car), hw = (sp.width ?? 1.8) / 2, post = { x: 0, z: WALL_Z, yaw: 0, hw: 0.15, hl: 0.15, kind: tag === 'bollard-nose' ? 'bollard' : undefined };
  return { car, kmh, tag, normal: side ? [1, 0] : [0, 1], obstacle: () => post,
    build: (ms) => {
      if (!side) { const v = makeCar(car, route, flatGround(route, { parked: [post] }), ms, { s: -WALL_Z - 6 - ms * 0.8, u: hw * 0.3 }); return { v }; }
      // a car sliding sideways (yaw 90 degrees to its path) into a post at mid-body
      const v = makeCar(car, route, flatGround(route, { parked: [post] }), ms, { s: -WALL_Z - 2.1, u: 0 });
      v.yaw += Math.PI / 2; v.vLat = ms; v.vLong = 0; // facing left, sliding forward along the road: the right door meets the post
      post.x = 0.0; v.syncWheels();
      return { v };
    } };
};
const kerb = ({ car, kmh }) => {
  const route = flatRoute({ closed: false, length: 1e6, edge: () => 7, surfaceY: () => 0, wrap: s => s }), a = 10 / DEG;
  return { car, kmh, tag: 'kerb-10deg', normal: [-1, 0], obstacle: null,
    build: (ms) => { const g = flatGround(route, {}); return { v: makeCar(car, route, g, ms, { s: 30, u: 3, yaw: -a }) }; } };
};
const landing = ({ car, kmh }) => {
  const route = flatRoute(), drop = { 30: 0.4, 60: 0.8, 100: 1.5, 160: 2.5 }[kmh];
  return { car, kmh, tag: 'landing', normal: [0, 0], obstacle: null,
    build: (ms) => { const v = makeCar(car, route, flatGround(route, {}), ms, { s: 40 }); v.y = drop; v.vy = 0; v.step(0.0001, { throttle: 0, brake: 0, steer: 0 }); startFlight(v, 0); v.y = drop; v.rigid.cy = drop + v.hcg; v.vy = 0; return { v }; } };
};
const STATIC = { 'wall-headon': wallHeadOn, 'wall-glance30': wall30, 'guardrail-glance30': railGlance, 'guardrail-90': railHeadOn, 'lamp-side': post('lamp-side', true), 'bollard-nose': post('bollard-nose', false), 'kerb-10deg': kerb, 'landing': landing };

// ---- Athens bridge rail (swept OBB) scenarios use the production AthensGround
function athensRail({ car, kmh, angleDeg, tag }) {
  const a = angleDeg / DEG, route = new AthensRoute({ x: 0, y: 0, z: 0 });
  route.project = (x, z) => ({ s: -z, u: x });
  const barriers = new WorldTileBarriers(); barriers.install('t', { metadata: { origin: [0, 0, 0], rails: [[4.25, 0, -3000, 4.25, 0, 100, 0.65]] } });
  const stream = { contact: () => ({ y: 0, nx: 0, nz: 0, flags: 1 }), readyAt: () => true };
  const g = new AthensGround(stream, route, barriers, { contact: () => null });
  return { car, kmh, tag, normal: [-1, 0], obstacle: () => ({ x: 4.5, z: -3000, yaw: 0, hw: 0.25, hl: 3000 }),
    build: (ms) => { const v = new Vehicle(spec(car), route); v.ground = g; v.reset(0, 0, ms); v.x = 0; v.z = -20; v.manual = true; v.gear = gearFor(v, ms); v.roadEvents = false; if (a) v.yaw -= a; v.syncWheels(); g.begin(v);
      return { v, step: (dt) => { g.begin(v); v.update(dt, { throttle: 0, brake: 0, steer: 0 }); } }; } };
}

// ---- traffic scenarios: real Traffic.collide / crash response against the real Vehicle
function trafficWorld(route) {
  const Tr = Object.create(T.Traffic.prototype);
  Object.assign(Tr, { route, rng: { chance: (p) => p > 0, range: (a, b) => (a + b) / 2 }, t: 0, dir: 1, cars: [], racers: [], wrecks: [], objs: [], sites: [], cones: [], honks: [], sounds: [] });
  return Tr;
}
function trafficCar(Tr, { mass = 1500, len = 4.4, wid = 1.8, s, u, dir = 1, v = 0, type = {} }) {
  const c = { id: Tr.cars.length + 1, s, u, dir, lane: 0, v, len, wid, mass, I: mass * (len * len + wid * wid) / 12, kind: 'sedan', type, active: true, dmg: 0, wheel: 0, steerA: 0,
    m: { root: { visible: true }, setDamage() {}, setDamageSnapshot() {} }, indL: {}, indR: {}, flash: {}, pHitT: -9, pRel: 0, pMin: 99, dz: { front: 0, rear: 0, left: 0, right: 0 },
    drv: { arch: 'normal', agg: 0.3, rt: 0.5, freeze: 0, horn: 1, mirror: 0.35, indicate: 1 } };
  Tr.initDrive(c); Tr.cars.push(c); return c;
}
const TRAFFIC_MASS = { sedan: 1500, bus: 11000, panda: 1000 };
function runTraffic({ tag, car, kmh, trafficKind = 'sedan', mode }) {
  const ms = kmh / 3.6, route = flatRoute(), Tr = trafficWorld(route), g = flatGround(route);
  const tm = TRAFFIC_MASS[trafficKind], big = trafficKind === 'bus';
  const v = makeCar(car, route, g, ms, { s: 20 });
  const gap = 8 + ms * 0.3;
  let c;
  if (mode === 'rear') c = trafficCar(Tr, { mass: tm, len: big ? 11.5 : 4.4, wid: big ? 2.5 : 1.8, s: 20 + gap + (big ? 5.75 : 2.2), u: 0, v: 15 / 3.6, type: big ? { bus: true } : {} });
  else { // crossing traffic, moving right to left, timed to be mid-lane when we arrive
    c = trafficCar(Tr, { mass: tm, len: big ? 11.5 : 4.4, wid: big ? 2.5 : 1.8, s: 20 + gap + 4, u: 0, v: 0, type: big ? { bus: true } : {} });
    const tArr = (c.s - 20 - v.halfL - c.wid / 2) / ms;
    c.cross = { j: 0, side: 1, P: null, t: 0, len: 1, mode: 'exit' }; c.xyaw = Math.PI / 2; c.xvs = 0; c.xvu = -4; c.u = 0.4 + 4 * tArr;
  }
  lastVehicle = v;
  const actor = { veh: v, kind: 'player' }, events = [];
  const trace = []; let first = null, last = null, pre = null, m0 = null, dE = 0; const dP = [0, 0];
  const kin = (veh) => T.routeVel(veh, route);
  const mom = () => { const a = kin(v), k = cState(); return [v.m * a.vs + c.mass * k.vs, v.m * a.vu + c.mass * k.vu]; };
  const energy = () => { const a = kin(v), k = cState(); return 0.5 * v.m * (a.vs ** 2 + a.vu ** 2) + 0.5 * c.mass * (k.vs ** 2 + k.vu ** 2) + 0.5 * v.Iz * v.w ** 2 + 0.5 * c.I * k.w ** 2; };
  const cState = () => { const k = c.crash; return k ? { vs: k.vs, vu: k.vu, w: k.w, yaw: k.yaw } : c.cross ? { vs: c.xvs, vu: c.xvu, w: 0, yaw: c.xyaw } : { vs: c.dir * c.v, vu: c.uv || 0, w: 0, yaw: c.yawLC || 0 }; };
  for (let i = 0; i < Math.round(3.5 / DT); i++) {
    const t = i * DT;
    const A0 = kin(v), C0 = cState(), V0 = worldVel(v), y0 = v.yaw;
    v.wallHit = 0; v.update(DT, { throttle: 0, brake: 0, steer: 0 });
    // kinematic traffic motion between hits (what the AI does when nobody is crashing)
    if (!c.crash) { if (c.cross) { c.u += c.xvu * DT; c.s += c.xvs * DT; } else { c.s += c.dir * c.v * DT; c.u += (c.uv || 0) * DT; } }
    else Tr.updateCrashed(c, DT);
    events.length = 0; Tr.t = t;
    const hadCrash = !!c.crash;
    const Pb = mom(), Eb = energy();
    Tr.collide(actor, events, t);
    const Pa = mom(), Ea = energy(); dP[0] += Pa[0] - Pb[0]; dP[1] += Pa[1] - Pb[1]; dE += Ea - Eb;
    const ev = events.find(e => e.kind === 'crash' || e.kind === 'bump' || e.kind === 'scrape');
    for (const e of events) if (e.zone && e.dv > 0 && e.who === 'player') v.addDamage?.(e.zone, e.dv, e); // what main.js handleEvents does
    const A1 = kin(v), C1 = cState();
    const hit = !!ev || (!hadCrash && !!c.crash);
    const cPos = { x: c.u, z: -c.s }, cb = { x: cPos.x, z: cPos.z, yaw: -(cState().yaw) + Math.PI / 2 * 0, hw: c.wid / 2, hl: c.len / 2 };
    // penetration between the two boxes after the step (route space s,u -> x=u, z=-s)
    const k = c.crash, phi = k ? k.yaw + (c.dir < 0 ? Math.PI : 0) : c.cross ? c.xyaw : (c.dir < 0 ? Math.PI : 0);
    const pen = obbOverlap(carBox(v), { x: c.u, z: -c.s, yaw: -phi + 0, hw: c.wid / 2, hl: c.len / 2 }, 0);
    void cb;
    if (hit && first === null) { first = i; pre = { A: A0, C: C0, V: V0, yaw: y0, vehW: 0, cVs: C0.vs, cVu: C0.vu }; m0 = { pa: [v.m * A0.vs, v.m * A0.vu], pb: [c.mass * C0.vs, c.mass * C0.vu], ke: 0.5 * v.m * (A0.vs ** 2 + A0.vu ** 2) + 0.5 * c.mass * (C0.vs ** 2 + C0.vu ** 2) }; }
    if (hit || pen > 0) last = i;
    trace.push({ t, A: A1, C: C1, vel: worldVel(v), speed: speedOf(v), yaw: v.yaw, w: v.w, pen, hit, ev: ev ? { kind: ev.kind, sev: ev.sev, dv: ev.dv, dvCar: ev.dvCar } : null, roll: bodyAngles(v).roll, y: v.y, vy: v.vy || 0, cw: C1.w, cyaw: C1.yaw, crash: !!c.crash, cvs: C1.vs, cvu: C1.vu, wallHit: v.wallHit });
  }
  if (first === null) return { tag, car, kmh, trafficKind, contact: false };
  const end = trace[Math.min(trace.length - 1, last + 12)], at1 = trace[Math.min(trace.length - 1, first + 30)];
  const V0 = pre.V, speed0 = Math.hypot(...V0);
  const A = end.A, C = end.C;
  const scale = Math.hypot(...m0.pa) + Math.hypot(...m0.pb) || 1, ke1 = energy();
  let pen = 0, jitter = 0, prev = 0, peakW = 0, peakCW = 0, contactFrames = 0;
  for (let i = first; i <= Math.min(trace.length - 1, last + 12); i++) { const r = trace[i]; pen = Math.max(pen, r.pen); peakW = Math.max(peakW, Math.abs(r.w)); peakCW = Math.max(peakCW, Math.abs(r.cw)); if (r.hit || r.pen > 0) contactFrames++; const s = Math.sign(r.A.vs - r.cvs) || prev; if (prev && s && s !== prev) jitter++; prev = s || prev; }
  const hitRow = trace[first];
  return { tag, car, kmh, trafficKind, contact: true, entrySpeed: round(speed0 * 3.6, 1), closing: round(Math.hypot(pre.A.vs - pre.C.vs, pre.A.vu - pre.C.vu) * 3.6, 1),
    playerSpeedAfterKmh: round(Math.hypot(A.vs, A.vu) * 3.6, 1), playerLostPct: round(100 * (1 - Math.hypot(A.vs, A.vu) / Math.hypot(pre.A.vs, pre.A.vu)), 1),
    trafficSpeedAfterKmh: round(Math.hypot(C.vs, C.vu) * 3.6, 1), trafficGainKmh: round((Math.hypot(C.vs, C.vu) - Math.hypot(pre.C.vs, pre.C.vu)) * 3.6, 1),
    playerYawDeg: round(wrapPi(end.yaw - pre.yaw) * DEG, 1), playerPeakYawRate: round(peakW, 2), trafficYawDeg: round(wrapPi(end.cyaw - pre.C.yaw) * DEG, 1), trafficPeakYawRate: round(peakCW, 2),
    trafficCrashed: end.crash, event: hitRow.ev?.kind || null, evSev: round(hitRow.ev?.sev ?? 0, 1), penetrationMax: round(pen, 3), contactMs: round(contactFrames * DT * 1000, 0), jitter,
    momentumErrPct: round(100 * Math.hypot(dP[0], dP[1]) / scale, 2), energyGainPct: round(100 * Math.max(0, dE) / m0.ke, 1), energyRatio: round(ke1 / m0.ke, 2), playerSpeedAt1sKmh: round(at1.speed * 3.6, 1),
    playerPeakRollDeg: round(Math.max(...trace.map(r => Math.abs(r.roll))) * DEG, 1), playerLiftM: round(Math.max(...trace.map(r => r.y)), 2) };
}

// ---- legacy replica of main.js racerPair (a rival / AI racer against the player), for the "before" column. Not exported by main.js.
function legacyRacerPair(a, b, route) {
  const ds = b.s - a.s; if (Math.abs(ds) > 8) return 0;
  const ext = v => { const ry = Math.atan2(-route.lin(route.TX, v.s), -route.lin(route.TZ, v.s)); const d = wrapPi(v.yaw - ry); const c = Math.abs(Math.cos(d)), s = Math.abs(Math.sin(d)); return { hs: v.halfL * c + v.halfW * s, hu: v.halfL * s + v.halfW * c }; };
  const ea = ext(a), eb = ext(b), du = b.u - a.u, ox = ea.hs + eb.hs - Math.abs(ds), oy = ea.hu + eb.hu - Math.abs(du);
  if (ox <= 0 || oy <= 0) return 0;
  const ra = T.routeVel(a, route), rb = T.routeVel(b, route); let sev = 0;
  if (ox < oy) { const n = Math.sign(ds) || 1; T.pushVeh(a, ra.f, -n * ox / 2, 0); T.pushVeh(b, rb.f, n * ox / 2, 0); const cl = (ra.vs - rb.vs) * n; if (cl > 0) { const j = cl * 0.6; ra.vs -= n * j; rb.vs += n * j; sev = cl; b.w += 0; } }
  else { const n = Math.sign(du) || 1; T.pushVeh(a, ra.f, 0, -n * oy / 2); T.pushVeh(b, rb.f, 0, n * oy / 2); const cl = (ra.vu - rb.vu) * n; if (cl > 0) { const j = cl * 0.6; ra.vu -= n * j; rb.vu += n * j; sev = cl; } }
  T.setRouteVel(a, ra.f, ra.vs, ra.vu); T.setRouteVel(b, rb.f, rb.vs, rb.vu);
  return sev;
}

// ---- two player cars through the multiplayer contact path (each client resolves its own half; zero latency here)
function runPlayers({ tag, carA, carB, kmh, mode, solver }) {
  const ms = kmh / 3.6, route = flatRoute();
  const a = makeCar(carA, route, null, ms, { s: 20, u: 0 });
  const bSpeed = mode === 'headon' ? ms : mode === 'tbone' ? 0 : mode === 'rear' ? 15 / 3.6 : 0;
  const gap = 10 + ms * 0.4;
  const b = makeCar(carB, route, null, bSpeed, { s: 20 + gap, u: 0 });
  if (mode === 'headon') { b.yaw += Math.PI; b.vLong = ms; b.syncWheels(); b.s = 20 + gap; b.z = -(20 + gap); }
  if (mode === 'tbone') { b.yaw += Math.PI / 2; b.vLong = 0; b.syncWheels(); b.x = 0; b.z = -(20 + gap); }
  let clock = 0; const outA = [], outB = [], nonceOf = {};
  // zero-latency link: each side's contact report reaches the other at once (production: via the arena, validated, ~RTT later)
  const cA = new ContactCoordinator({ serverNow: () => clock, send: e => outA.push(e) }), cB = new ContactCoordinator({ serverNow: () => clock, send: e => outB.push(e) });
  const trace = []; let first = null, last = null, m0 = null, pre = null, dEm = 0; const dPm = [0, 0];
  const mom = () => { const va = worldVel(a), vb = worldVel(b); return { p: [a.m * va[0] + b.m * vb[0], a.m * va[1] + b.m * vb[1]], scale: a.m * Math.hypot(...va) + b.m * Math.hypot(...vb), ke: 0.5 * a.m * (va[0] ** 2 + va[1] ** 2) + 0.5 * b.m * (vb[0] ** 2 + vb[1] ** 2) + 0.5 * a.Iz * a.w ** 2 + 0.5 * b.Iz * b.w ** 2, L: a.Iz * a.w + b.Iz * b.w }; };
  for (let i = 0; i < Math.round(3.5 / DT); i++) {
    const t = i * DT, now = t * 1000;
    a.update(DT, { throttle: 0, brake: 0, steer: 0 }); b.update(DT, { throttle: 0, brake: 0, steer: 0 });
    for (const v of [a, b]) { const p = route.project(v.x, v.z); v.s = p.s; v.u = p.u; }
    const beforeSolve = mom(), vaS = worldVel(a), vbS = worldVel(b), yawS = [a.yaw, b.yaw];
    // each client sees the other car as it was when the packet left (here: this frame's state before either side reacts)
    const snap = v => ({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, vLong: v.vLong, vLat: v.vLat, w: v.w, m: v.m, hcg: v.hcg, halfL: v.halfL, halfW: v.halfW, Iz: v.Iz, spec: v.spec, stale: false });
    const sa = snap(a), sb = snap(b);
    clock = now;
    const hitsA = solver.step(cA, a, sb, DT, now), hitsB = solver.step(cB, b, sa, DT, now);
    for (const e of outA.splice(0)) { const h = cB.receive({ ...e, from: 'other', at: now }, b, now, { rtt: 0 }); if (h) hitsB.push(h); }
    for (const e of outB.splice(0)) { const h = cA.receive({ ...e, from: 'other', at: now }, a, now, { rtt: 0 }); if (h) hitsA.push(h); }
    const afterSolve = mom(); dPm[0] += afterSolve.p[0] - beforeSolve.p[0]; dPm[1] += afterSolve.p[1] - beforeSolve.p[1]; dEm += afterSolve.ke - beforeSolve.ke;
    if (process.env.BENCH_TRACE && (hitsA.length || hitsB.length || Math.hypot(afterSolve.p[0] - beforeSolve.p[0], afterSolve.p[1] - beforeSolve.p[1]) > 1)) console.error('frame', i, 'hitsA', hitsA.length, 'hitsB', hitsB.length, 'dP', round(afterSolve.p[0] - beforeSolve.p[0], 1), round(afterSolve.p[1] - beforeSolve.p[1], 1), 'closA', hitsA.map(h => round(h.closing, 2)).join(), 'closB', hitsB.map(h => round(h.closing, 2)).join());
    const hit = hitsA.length + hitsB.length > 0, pen = obbOverlap(carBox(a), carBox(b), 0);
    if (hit && first === null) { first = i; m0 = beforeSolve; pre = { va: vaS, vb: vbS, ya: yawS[0], yb: yawS[1] }; }
    if (hit || pen > 0) last = i;
    trace.push({ t, hit, pen, yawA: a.yaw, yawB: b.yaw, wA: a.w, wB: b.w, vA: speedOf(a), vB: speedOf(b), mom: mom(), roll: Math.max(Math.abs(bodyAngles(a).roll), Math.abs(bodyAngles(b).roll)), lift: Math.max(a.y, b.y), velA: worldVel(a), velB: worldVel(b) });
  }
  if (first === null) return { tag, carA, carB, kmh, contact: false };
  const e = trace[Math.min(trace.length - 1, last + 12)], m1 = e.mom;
  let pen = 0, peakA = 0, peakB = 0, jitter = 0, frames = 0, lift = 0, roll = 0;
  for (let i = first; i <= Math.min(trace.length - 1, last + 12); i++) { const r = trace[i]; pen = Math.max(pen, r.pen); peakA = Math.max(peakA, Math.abs(r.wA)); peakB = Math.max(peakB, Math.abs(r.wB)); if (r.hit || r.pen > 0) frames++; lift = Math.max(lift, r.lift); roll = Math.max(roll, r.roll); }
  const sA0 = Math.hypot(...pre.va), sB0 = Math.hypot(...pre.vb);
  return { tag, carA, carB, kmh, contact: true, closingKmh: round(Math.hypot(pre.va[0] - pre.vb[0], pre.va[1] - pre.vb[1]) * 3.6, 1),
    aLostPct: round(100 * (1 - e.vA / (sA0 || 1)), 1), bLostPct: sB0 > 0.5 ? round(100 * (1 - e.vB / sB0), 1) : null, aAfterKmh: round(e.vA * 3.6, 1), bAfterKmh: round(e.vB * 3.6, 1),
    aYawDeg: round(wrapPi(e.yawA - (first ? trace[0].yawA : 0)) * DEG, 1), bYawDeg: round(wrapPi(e.yawB - trace[0].yawB) * DEG, 1), aPeakYawRate: round(peakA, 2), bPeakYawRate: round(peakB, 2),
    penetrationMax: round(pen, 3), contactMs: round(frames * DT * 1000, 0), momentumErrPct: round(100 * Math.hypot(dPm[0], dPm[1]) / (m0.scale || 1), 2), energyGainPct: round(100 * Math.max(0, dEm) / m0.ke, 1),
    energyRatio: round(m1.ke / m0.ke, 2), peakRollDeg: round(roll * DEG, 1), liftM: round(lift, 2) };
}
const mpSolver = { step: (coord, local, remote, dt, now) => coord.step(local, [{ id: 'other', vehicle: remote, age: 0 }], dt, now, { rtt: 0 }) };

// ---- lasting damage: what a crash costs afterwards. The damaged car's snapshot (what a tow or reset keeps) goes into a fresh car,
// which drives 1.5 km flat out from a rolling 80 km/h on a straight, hands off the wheel.
const HAS_SNAPSHOT = typeof Vehicle.prototype.damageSnapshot === 'function';
// What a car keeps when it drives on after a crash. The same state goes in whether or not Vehicle has damageSnapshot, so the table
// compares the damage models (before 2026-10-20 a tow or reset also cleared it; the trial never tows).
const snapshotOf = v => HAS_SNAPSHOT ? v.damageSnapshot() : { damage: { ...v.damage }, cornerDamage: v.cornerDamage?.slice(), impactMechanical: v.impactMechanical, radiatorDamage: v.radiatorDamage };
function restoreDamage(v, s) {
  if (HAS_SNAPSHOT) return v.restoreDamageSnapshot(s);
  v.damage = { ...s.damage }; v.damageFx(); v.cornerDamage = s.cornerDamage.slice(); v.impactMechanical = s.impactMechanical; v.radiatorDamage = s.radiatorDamage; v.damageFx();
}
function trial(id, snap, { metres = 1500, seconds = 90 } = {}) {
  const route = flatRoute(), v = new Vehicle(spec(id), route);
  v.reset(10, 0, 80 / 3.6); v.manual = false; v.roadEvents = false; v.syncWheels();
  if (snap) restoreDamage(v, snap);
  let t = 0, top = 0, x0 = v.s, effort = 0, worstU = 0;
  for (let i = 0; i < seconds * 60; i++, t += DT) {
    // a driver who holds the road: heading and offset feedback on the steering (yaw > 0 is the nose left, u > 0 is right of the road)
    const steer = clamp(1.6 * v.yaw - 0.04 * v.u + 0.35 * -v.w, -1, 1);
    v.update(DT, { throttle: 1, brake: 0, steer }); const p = route.project(v.x, v.z); v.s = p.s; v.u = p.u;
    top = Math.max(top, v.kmh); effort += Math.abs(steer); worstU = Math.max(worstU, Math.abs(v.u));
    if (v.s - x0 >= metres) return { time: t, topKmh: top, effort: effort / (i + 1), worstU, power: v.engHealth };
  }
  return { time: Infinity, topKmh: top, effort: effort / (seconds * 60), worstU, power: v.engHealth };
}
export function damageTrials({ car = 'z4' } = {}) {
  const clean = trial(car, null), rows = [], row = (label, vehicle, extra = {}) => {
    const snap = vehicle ? snapshotOf(vehicle) : null, r = trial(car, snap);
    rows.push({ group: 'damage', scenario: label, mechanical: round(vehicle?.impactMechanical ?? 0, 3), powerPct: round(100 * (r.power ?? 1), 0), topKmh: round(r.topKmh, 0), wheelEffortPct: round(100 * r.effort, 1), worstOffsetM: round(r.worstU, 1),
      timeS: round(r.time, 2), lossS: round(r.time - clean.time, 2), ...extra });
  };
  rows.push({ group: 'damage', scenario: 'undamaged', mechanical: 0, powerPct: 100, topKmh: round(clean.topKmh, 0), wheelEffortPct: round(100 * clean.effort, 1), worstOffsetM: round(clean.worstU, 1), timeS: round(clean.time, 2), lossS: 0 });
  const crash = (tag, kmh, seconds = 3) => { const sc = STATIC[tag]({ car, kmh }), w = sc.build(kmh / 3.6); for (let i = 0; i < seconds * 60; i++) w.v.update(DT, { throttle: 0, brake: 0, steer: 0 }); return w.v; };
  for (const kmh of [30, 60, 100, 160]) row(`head-on wall ${kmh} km/h`, crash('wall-headon', kmh));
  row('30 degree wall glance 100 km/h', crash('wall-glance30', 100));
  row('30 degree guard-rail glance 100 km/h', crash('guardrail-glance30', 100));
  row('sideways into a post 60 km/h', crash('lamp-side', 60));
  for (const kmh of [60, 100]) { runTraffic({ tag: 'r', car, kmh, mode: 'rear', trafficKind: 'sedan' }); row(`rear-end a sedan at ${kmh} km/h`, lastVehicle); }
  runTraffic({ tag: 't', car, kmh: 60, mode: 'tbone', trafficKind: 'sedan' }); row('T-bone a crossing car at 60 km/h', lastVehicle);
  const taps = new Vehicle(spec(car), flatRoute()); for (let i = 0; i < 10; i++) taps.addDamage('front', 20 / 3.6, { kind: 'wall' }); row('ten 20 km/h taps (trading paint)', taps);
  const taps2 = new Vehicle(spec(car), flatRoute()); for (let i = 0; i < 4; i++) taps2.addDamage('front', 40 / 3.6, { kind: 'wall' }); row('four 40 km/h bumps', taps2);
  const side = new Vehicle(spec(car), flatRoute()); side.addDamage('left', 50 / 3.6, { kind: 'wall' }); row('one 50 km/h side hit', side);
  return rows;
}

// ---- driver
export function runBench({ speeds = KMH, cars = ['z4', 'panda'], only = '' } = {}) {
  const rows = [], want = (s) => !only || s.includes(only);
  for (const kmh of speeds) {
    for (const car of cars) {
      for (const [tag, make] of Object.entries(STATIC)) {
        if (!want(tag)) continue;
        const sc = make({ car, kmh });
        rows.push({ group: 'static', ...runStatic({ ...sc, seconds: tag === 'landing' ? 3 : 3.5 }) });
      }
      for (const [tag, angle] of [['athens-rail-glance30', 30], ['athens-rail-90', 90]]) if (want(tag)) rows.push({ group: 'static', ...runStatic({ ...athensRail({ car, kmh, angleDeg: angle, tag }) }) });
    }
    for (const car of ['z4']) for (const [tag, mode, tk] of [['traffic-rear', 'rear', 'sedan'], ['traffic-rear-bus', 'rear', 'bus'], ['traffic-tbone', 'tbone', 'sedan']]) if (want(tag)) rows.push({ group: 'traffic', ...runTraffic({ tag, car, kmh, mode, trafficKind: tk }) });
    for (const [carA, carB] of [['panda', 'sl500'], ['sl500', 'panda'], ['panda', 'bus'], ['sl500', 'sl500']]) for (const mode of ['headon', 'tbone']) {
      const tag = 'players-' + mode; if (want(tag)) rows.push({ group: 'players', ...runPlayers({ tag, carA, carB, kmh, mode, solver: mpSolver }) });
    }
  }
  return rows;
}
export { legacyRacerPair };
export const trafficRestitution = T.restitutionFor;

function table(rows) {
  const cols = {}; for (const r of rows) for (const k of Object.keys(r)) cols[k] = true;
  const groups = ['static', 'traffic', 'players']; let md = '';
  for (const g of groups) {
    const gr = rows.filter(r => r.group === g); if (!gr.length) continue;
    const keys = Object.keys(Object.assign({}, ...gr)).filter(k => k !== 'group');
    md += `\n### ${g}\n\n| ${keys.join(' | ')} |\n|${keys.map(() => '---').join('|')}|\n`;
    for (const r of gr) md += `| ${keys.map(k => r[k] === undefined || r[k] === null ? '' : r[k]).join(' | ')} |\n`;
  }
  return md;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1] ?? d;
  if (process.argv.includes('--damage')) { const rows = damageTrials({ car: arg('car', 'z4') }); const o = arg('out', ''); const keys = Object.keys(rows[0]).filter(k => k !== 'group'); const md = `| ${keys.join(' | ')} |\n|${keys.map(() => '---').join('|')}|\n` + rows.map(r => `| ${keys.map(k => r[k]).join(' | ')} |`).join('\n') + '\n'; if (o) { mkdirSync(dirname(o), { recursive: true }); writeFileSync(o, JSON.stringify(rows, null, 1)); writeFileSync(o.replace(/\.json$/, '.md'), md); } else console.log(md); process.exit(0); }
  const rows = runBench({ speeds: arg('speeds', KMH.join(',')).split(',').map(Number), cars: arg('cars', 'z4,panda').split(','), only: arg('only', '') });
  const out = arg('out', '');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(rows, null, 1)); if (process.argv.includes('--md')) writeFileSync(out.replace(/\.json$/, '.md'), table(rows)); }
  else console.log(table(rows));
}
