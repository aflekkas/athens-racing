// Athens traffic on the real lanes of the coast road. Every vehicle has a driver with a personality
// (desired speed, headway, patience, politeness, how much they bother to indicate) and runs:
//  - IDM car-following with jerk-limited acceleration (smooth speeding up, progressive braking, hard stops when needed)
//  - MOBIL-style lane changes on the multi-lane avenue (incentive vs. safety of the new follower), squeezing into gaps
//    when impatient, overtakes through the oncoming lane on the narrow seafront streets
//  - stopping at red lights, yielding to people on the carriageway
// plus the local colour: delivery scooters lane-splitting and riding the centre line, yellow taxis darting to the kerb
// for a fare, double-parked cars with hazards on, blue-and-white buses pulling into and out of stops, honking, and the
// summer beach crowd near Vouliagmeni and Limanakia (more cars, cruisers hunting for parking, cars parked along the road).
// Side-street cross traffic, crash physics, near-miss tracking and road-works cones are kept from the previous build.
import * as THREE from 'three';
import { TRAFFIC_TYPES, trafficModel } from './cars.js';
import { RNG, clamp, lerp, smoothstep } from './util.js';
import { ROAD } from './road.js';
import { LANE_W } from './map.js';
import { SURF } from './ground.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeParkedFleet } from './traffic-fleet.js';
import { damageIncrement, equivalentBarrierSpeed } from './damage-math.js';

const POOL = 66;
const MASS = { city: 980, hatch: 1150, sedan: 1400, taxi: 1460, taxi_superb: 1580, byd_dolphin: 1658, byd_atto3: 1750, suv: 1900, van: 2300, truck: 5500, bus: 12000, scooter: 190, delivery: 210, moto: 260 };
// type behaviour: max accel a, comfortable decel b, time headway T, standstill gap s0, speed factor vf, lateral speed latV
const BEHAV = {
  city: { a: 1.6, b: 2.8, T: 1.2, s0: 2.2, vf: 0.95, latV: 1.4 },
  hatch: { a: 1.8, b: 3.0, T: 1.15, s0: 2.2, vf: 1.0, latV: 1.5 },
  sedan: { a: 1.6, b: 3.0, T: 1.25, s0: 2.4, vf: 1.0, latV: 1.35 },
  taxi: { a: 2.2, b: 3.8, T: 0.85, s0: 1.6, vf: 1.06, latV: 2.0 },
  byd_dolphin: { a: 1.9, b: 3.0, T: 1.2, s0: 2.2, vf: 0.98, latV: 1.45 },
  byd_atto3: { a: 1.9, b: 3.0, T: 1.3, s0: 2.5, vf: 1.02, latV: 1.3 },
  suv: { a: 1.7, b: 3.0, T: 1.3, s0: 2.5, vf: 1.03, latV: 1.3 },
  van: { a: 1.2, b: 2.6, T: 1.45, s0: 2.6, vf: 0.9, latV: 1.1 },
  truck: { a: 0.85, b: 2.2, T: 1.65, s0: 3.0, vf: 0.82, latV: 0.8 }, // Isuzu NPR box truck, loaded
  bus: { a: 0.85, b: 1.9, T: 1.7, s0: 3.0, vf: 0.8, latV: 0.75 },
  delivery: { a: 2.6, b: 4.5, T: 0.7, s0: 1.0, vf: 1.05, latV: 2.6 },
  scooter: { a: 2.1, b: 4.0, T: 0.9, s0: 1.2, vf: 0.95, latV: 2.2 },
  moto: { a: 3.2, b: 5.0, T: 0.8, s0: 1.4, vf: 1.15, latV: 2.4 },
};
const _v = new THREE.Vector3();

// Racer snapshots and the player's actor wrapper are rebuilt every frame; the vehicle stays the same.
function racerKey(r) { return r.a.veh || r.a; }

/** route-frame velocity of a physics Vehicle */
export function routeVel(veh, route) {
  const f = route.frame(veh.s, {});
  const fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
  const wx = fx * veh.vLong + rx * veh.vLat, wz = fz * veh.vLong + rz * veh.vLat;
  return { f, vs: wx * f.tx + wz * f.tz, vu: wx * f.rx + wz * f.rz };
}
export function setRouteVel(veh, f, vs, vu) {
  const wx = f.tx * vs + f.rx * vu, wz = f.tz * vs + f.rz * vu;
  const fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
  veh.vLong = wx * fx + wz * fz; veh.vLat = wx * rx + wz * rz;
}
export function pushVeh(veh, f, ds, du) { veh.x += f.tx * ds + f.rx * du; veh.z += f.tz * ds + f.rz * du; veh.s += ds; veh.u += du; }
/** half extents of a (possibly yawed) vehicle in route (s,u) space */
export function extents(veh, route) {
  const ry = Math.atan2(-route.lin(route.TX, veh.s), -route.lin(route.TZ, veh.s));
  const d = wrapPi(veh.yaw - ry);
  const c = Math.abs(Math.cos(d)), s = Math.abs(Math.sin(d));
  return { hs: veh.halfL * c + veh.halfW * s, hu: veh.halfL * s + veh.halfW * c };
}

/** a stand-in roof light bar (blue, Greek police) + the strobe hook, for models that don't bring their own */
function lightBar(m, type) {
  m.root.updateMatrixWorld(true);
  const top = new THREE.Box3().setFromObject(m.body).max.y - m.root.position.y;
  const bar = new THREE.Group(), moto = !!type.scooter;
  const base = new THREE.Mesh(new THREE.BoxGeometry(moto ? 0.3 : type.wid * 0.62, 0.06, moto ? 0.12 : 0.24), new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.5 }));
  bar.add(base);
  const lamps = [];
  for (const sx of moto ? [-1, 1] : [-1, -0.33, 0.33, 1]) {
    const mat = new THREE.MeshStandardMaterial({ color: '#0b1a40', emissive: Math.abs(sx) < 0.5 && !moto ? '#ff2a2a' : '#1f6bff', emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.9 });
    const l = new THREE.Mesh(new THREE.BoxGeometry(moto ? 0.11 : type.wid * 0.14, 0.09, moto ? 0.1 : 0.2), mat);
    l.position.set(sx * (moto ? 0.1 : type.wid * 0.23), 0.07, 0); bar.add(l); lamps.push({ mat, sx });
  }
  bar.position.set(0, top + 0.02, moto ? 0.55 : 0.1);
  m.body.add(bar);
  m.setStrobe = (on, t) => {
    for (const L of lamps) {
      // double flash, left / right alternating, ~2.5 Hz
      const ph = (t * 2.5 + (L.sx < 0 ? 0 : 0.5)) % 1, f = ph < 0.12 || (ph > 0.2 && ph < 0.32);
      L.mat.emissiveIntensity = on && f ? 9 : on ? 0.4 : 0;
    }
  };
}
function indicatorMat() { return new THREE.MeshStandardMaterial({ color: '#4a2a00', emissive: '#ff9a00', emissiveIntensity: 0, roughness: 0.4 }); }

export class Traffic {
  constructor(scene, route, data) {
    this.scene = scene; this.route = route; this.data = data;
    this.rng = new RNG(4242);
    this.cars = [];
    const spawnTypes = TRAFFIC_TYPES.filter(t => t.w > 0);
    const totalW = spawnTypes.reduce((a, t) => a + t.w, 0);
    const indGeo = new THREE.BoxGeometry(0.12, 0.07, 0.05);
    const byId = Object.fromEntries(TRAFFIC_TYPES.map((t) => [t.id, t]));
    for (let i = 0; i < POOL; i++) {
      let r = this.rng.next() * totalW, type = spawnTypes[0];
      for (const t of spawnTypes) { r -= t.w; if (r <= 0) { type = t; break; } }
      // a guaranteed share of the special vehicles (types the model library may or may not provide)
      const fixed = ['bus', 'bus', 'bus', 'taxi', 'taxi', 'taxi', 'taxi', 'golf', 'corolla', 'golf', 'corolla', 'delivery', 'delivery', 'delivery', 'delivery'][i];
      if (fixed && byId[fixed]) type = byId[fixed];
      const m = trafficModel(type, this.rng.pick(type.colors), this.rng);
      const indL = indicatorMat(), indR = indicatorMat();
      // headlight flash (a driver warning you off): its own material per car, dark until used
      const flash = new THREE.MeshStandardMaterial({ color: '#202020', emissive: '#fff6e0', emissiveIntensity: 0, roughness: 0.3 });
      if (!type.scooter) for (const sx of [-1, 1]) { const h = new THREE.Mesh(indGeo, flash); h.scale.set(1.6, 1.3, 1); h.position.set(sx * type.wid * 0.34, type.bus ? 0.9 : 0.66, -type.len * 0.5 - 0.01); m.body.add(h); }
      if (!type.scooter) {
        for (const [mat, sx] of [[indL, -1], [indR, 1]]) for (const z of [-1, 1]) {
          const b = new THREE.Mesh(indGeo, mat); b.position.set(sx * type.wid * 0.47, type.bus ? 1.0 : 0.72, z * type.len * 0.5); m.body.add(b);
        }
      }
      m.root.visible = false;
      scene.add(m.root);
      // kind is the driving role (every taxi model drives like a taxi); type.id picks mass and manners
      const kind = type.taxi ? 'taxi' : type.id;
      const mass = type.catalogueCar?.mass || MASS[type.id] || (type.bus ? 12000 : type.scooter ? 220 : 1400);
      this.cars.push({ id: i, type, kind, m, indL, indR, flash, len: type.len, wid: type.wid, mass, I: mass * (type.len * type.len + type.wid * type.wid) / 12, active: false, crash: null, beh: BEHAV[type.id] || BEHAV[kind] || BEHAV.hatch, dmg: 0 });
    }
    // the police (src/police.js): a reserved pool the ordinary spawner never uses. Until the model library has the
    // ΕΛ.ΑΣ. types, a white sedan / motorbike stands in with a light bar of our own
    for (let k = 0; k < 8; k++) {
      const moto = k >= 6, type = byId[moto ? 'police_moto' : 'police'] || { ...(moto ? byId.moto : byId.taxi_superb || byId.sedan), id: moto ? 'police_moto' : 'police', police: true, taxi: false, colors: ['#f4f5f6'], w: 0 };
      const m = trafficModel(type, this.rng.pick(type.colors), this.rng);
      if (!m.setStrobe) lightBar(m, type);
      const indL = indicatorMat(), indR = indicatorMat(), flash = new THREE.MeshStandardMaterial({ color: '#202020', emissive: '#fff6e0', emissiveIntensity: 0, roughness: 0.3 });
      if (!type.scooter) for (const [mat, sx] of [[indL, -1], [indR, 1]]) for (const z of [-1, 1]) { const b = new THREE.Mesh(indGeo, mat); b.position.set(sx * type.wid * 0.47, 0.72, z * type.len * 0.5); m.body.add(b); }
      m.root.visible = false; scene.add(m.root);
      const mass = moto ? 320 : 1550;
      this.cars.push({ id: POOL + k, type, kind: type.id, police: true, m, indL, indR, flash, len: type.len, wid: type.wid, mass, I: mass * (type.len * type.len + type.wid * type.wid) / 12, active: false, crash: null, beh: BEHAV.sedan, dmg: 0 });
    }
    this.police = null; // set by Police
    // road works: cones + a sign, closing the kerb lane for ~45 m in town
    this.sites = []; this.cones = [];
    const coneGeo = new THREE.ConeGeometry(0.19, 0.72, 12); coneGeo.translate(0, 0.36, 0);
    const coneMat = new THREE.MeshStandardMaterial({ color: '#ff5a14', roughness: 0.55 });
    coneMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCy;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCy = position.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCy;').replace('#include <color_fragment>', '#include <color_fragment>\nif (vCy > 0.3 && vCy < 0.42 || vCy > 0.52 && vCy < 0.6) diffuseColor.rgb = vec3(0.92);');
    };
    const sitesS = [];
    if (!route.closed) for (let s = route.start + 900; s < route.finish - 400; s += 1100 + this.rng.range(0, 600)) if (route.lanes(s - 150) >= 3 && route.lanes(s + 100) >= 3 && route.urban(s) > 0.6) sitesS.push(s);
    for (const s0 of sitesS) {
      const n = route.lanes(s0);
      const lane = n - 1, uc = route.laneU(s0, lane);
      const site = { s: s0 + 22, u: uc, len: 48, wid: LANE_W * 0.9, lane, static: true };
      this.sites.push(site);
      for (let k = 0; k < 14; k++) {
        const s = s0 + k * 3.5, t = clamp(k / 4, 0, 1);
        const u = uc + lerp(LANE_W * 0.5, -LANE_W * 0.42, smoothstep(0, 1, t));
        this.cones.push({ s, u, s0: s, u0: u, y: 0, vs: 0, vu: 0, vy: 0, rx: 0, rz: 0, w: 0, hit: false });
      }
      for (let k = 2; k < 13; k += 3) this.cones.push({ s: s0 + k * 3.5 + 1.5, u: uc + LANE_W * 0.35, s0: s0 + k * 3.5 + 1.5, u0: uc + LANE_W * 0.35, y: 0, vs: 0, vu: 0, vy: 0, rx: 0, rz: 0, w: 0, hit: false });
    }
    this.coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, this.cones.length + 64); // + room for police roadblocks
    this.coneMesh.count = this.cones.length; this.coneBase = this.cones.length;
    this.coneMesh.castShadow = true; this.coneMesh.frustumCulled = false; scene.add(this.coneMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this.t = 0;
    this.dir = 1; // the racers' direction of travel along s (reverse events: -1); spawning / culling follow it
    this.signals = null; this.people = null; this.ground = null; this.racers = []; this.wrecks = []; this.honks = []; this.sounds = []; this.busStops = [];
    this.objs = [];
  }

  // ---------------------------------------------------------------- where we are
  // 'town' (Varkiza), 'beach' (Vouliagmeni bay, Astir, the lake: summer crowd), 'cliff' (open coast road),
  // 'cove' (Limanakia / Lomvarda: cars parked on the shoulders, swimmers crossing)
  zone(s) {
    // Mode/AI integration: map bundles use mountain/chapel/circuit districts; population tables use these four road classes.
    const zone = this.route.district(s);
    return zone === 'mountain' ? 'cliff' : zone === 'chapel' ? 'cove' : zone === 'circuit' && this.allowClosedRoam ? 'town' : zone;
  }
  /** Closed races default to no civilian population; free roam explicitly opts into traffic. */
  get disabled() { return this._disabled || (!!this.route.closed && !this.allowClosedRoam); // mode owner: free roam can populate the circuit }
  set disabled(v) { this._disabled = !!v; }
  /** vehicles per km per lane (each direction) */
  density(s) {
    return { town: 0.9, beach: 1.15, cliff: 0.7, cove: 1.0 }[this.zone(s)];
  }
  /** desired cruising speed of the road (m/s) before personal factors */
  roadSpeed(s) {
    const r = this.route, n = r.lanes(s), z = this.zone(s);
    let kmh = n >= 3 ? 74 : n === 2 ? (r.div(s) > 0.5 ? 66 : 70) : 44;
    if (z === 'beach') kmh *= 0.86; else if (z === 'cove') kmh *= 0.9;
    let k = 0; for (let d = -10; d <= 40; d += 10) k = Math.max(k, Math.abs(r.curv(s + d)));
    return Math.min(kmh / 3.6, Math.sqrt(2.6 / Math.max(1e-4, k)));
  }
  laneCount(s) { return Math.max(1, this.route.lanes(s)); }
  laneUOf(c, s, lane = c.lane) {
    const l = Math.min(lane, this.laneCount(s) - 1);
    const u = this.route.laneU(s, l) + (c.type.scooter ? LANE_W * 0.22 : 0);
    return c.dir > 0 ? u : -u;
  }
  kerbU(c, s, inset) { return c.dir * (this.route.edge(s) - inset); }

  // ---------------------------------------------------------------- spawning
  reset(ps) {
    for (const c of this.cars) { c.active = false; c.m.root.visible = false; c.crash = null; c.cross = null; }
    for (const k of this.cones) { k.s = k.s0; k.u = k.u0; k.y = 0; k.vs = k.vu = k.vy = 0; k.rx = k.rz = 0; k.w = 0; k.hit = false; }
    this.honks.length = 0; this.sounds.length = 0; this.lastBus = -1e9;
    if (!this.disabled) {
      for (let i = 0; i < 5; i++) this.spawnParked(ps, true);
      for (let i = 0; i < POOL - 14; i++) this.spawn(ps, true);
    }
    this.updateCones(0);
  }

  /** a pooled car comes back as a new one: straighten its panels */
  repair(c) {
    c.dmg = 0;
    if (c.dz) for (const z in c.dz) { if (c.dz[z]) c.m.setDamage?.(z, 0); c.dz[z] = 0; }
    c.flash.emissiveIntensity = 0;
  }
  pickFree(pred) {
    // a free vehicle of a fitting type; buses are rarer outside the avenue
    let best = null;
    for (const c of this.cars) if (!c.active && !c.police && (!pred || pred(c))) { if (!best || this.rng.chance(0.35)) best = c; }
    return best;
  }

  personality(c) {
    const rng = this.rng, b = c.beh;
    let agg = Math.pow(rng.next(), 1.4);
    if (c.kind === 'taxi' || c.kind === 'delivery') agg = Math.min(1, agg + 0.35);
    if (c.kind === 'bus') agg = 0.5 + rng.range(0, 0.3); // the bus driver owns the road
    c.drv = {
      agg,
      a: b.a * (0.85 + 0.4 * agg), b: b.b * (0.9 + 0.25 * agg), T: b.T * (1.25 - 0.5 * agg), s0: Math.max(0.8, b.s0 * (1.15 - 0.45 * agg)),
      vf: b.vf * (0.9 + 0.2 * agg + rng.range(-0.05, 0.05)), polite: 0.55 - 0.5 * agg, bsafe: 2.8 + 4.5 * agg,
      indicate: agg > 0.72 ? (rng.chance(0.5) ? 0 : 0.25) : rng.range(0.6, 1.4), patience: lerp(7, 1.6, agg), latV: b.latV * (0.85 + 0.45 * agg),
      cruiser: false,
    };
    // who is behind the wheel. Most are ordinary; some keep an eye on the mirror and make room for a fast car;
    // a few are slow and careful; a rare one is on the phone (late to react, turns and changes lanes without looking)
    const r = rng.next(), pro = c.kind === 'taxi' || c.kind === 'delivery' || c.kind === 'bus';
    const arch = r < 0.05 ? 'distracted' : agg > 0.8 ? 'aggressive' : r < (pro ? 0.12 : 0.33) ? 'courteous' : r < 0.45 ? 'cautious' : 'normal';
    const D = c.drv;
    D.arch = arch;
    // perception-reaction time (s) to a hazard such as a car coming at them on their side of the road
    D.rt = { normal: rng.range(0.75, 1.15), courteous: rng.range(0.6, 0.95), cautious: rng.range(0.85, 1.25), aggressive: rng.range(0.55, 0.85), distracted: rng.range(1.5, 2.6) }[arch];
    D.mirror = { normal: 0.35, courteous: 1, cautious: 0.6, aggressive: 0.15, distracted: 0 }[arch]; // how often they check behind
    D.freeze = arch === 'cautious' ? 0.3 : arch === 'distracted' ? 0.45 : 0.08; // brake in a straight line instead of swerving
    D.horn = arch === 'cautious' ? 0.5 : arch === 'distracted' ? 0.4 : 1;
    D.quirk = (arch === 'distracted' ? 6 : arch === 'cautious' ? 0.6 : 1) * (c.kind === 'bus' ? 0 : 1); // pull-overs and sudden turns
    if (arch === 'distracted') { D.indicate = rng.chance(0.5) ? 0 : 0.1; D.vf *= rng.range(0.85, 1); D.wander = rng.range(0.25, 0.5); D.T *= 0.9; }
    if (arch === 'cautious') { D.vf *= 0.9; D.T *= 1.2; D.indicate = Math.max(D.indicate, 1.2); }
    if (arch === 'courteous') D.indicate = Math.max(D.indicate, 0.9);
  }

  initDrive(c, keepDrv = true) {
    if (!keepDrv || !c.drv) this.personality(c);
    Object.assign(c, {
      mode: 'drive', uT: c.u, uv: 0, acc: 0, accT: 0, lcEval: this.rng.range(0.2, 1.2), lcT: 0, lcDelay: 0, blinkSide: 0, hazard: false,
      ovt: null, split: false, task: null, evade: null, yieldT: 0, yieldU: undefined, yieldFor: null, seeT: 0, flashT: 0, shakenT: 0, quirkT: this.rng.range(4, 30), lastJ: null, stuckT: 0, honkCool: this.rng.range(1, 3), waitT: 0, brakeT: 0, lastStop: -1e9, wheel: c.wheel || 0, yawLC: 0,
      hs: c.len * 0.5, hu: c.wid * 0.5, sigJ: -1, sigGo: false, cross: null, crash: null,
    });
  }

  spawn(ps, initial = false, behind = false) {
    const rng = this.rng, route = this.route;
    const oncoming = !behind && rng.chance(0.42);
    const D = this.dir, sAhead = behind ? ps - D * rng.range(160, 230) : initial ? ps + D * rng.range(oncoming ? 110 : 40, 950) : ps + D * rng.range(800, 1000);
    const s = sAhead;
    if (s > route.length - 30 || s < 20) return;
    const z = this.zone(s), n = this.laneCount(s);
    // vehicle mix by zone: scooters everywhere, buses on the bus routes, more SUVs and cruisers at the beaches
    const c = this.pickFree((q) => {
      if (q.kind === 'bus') return n >= 2 && (z === 'town' || z === 'beach' || z === 'cliff') && this.t - (this.lastBus || -1e9) > 8;
      if (q.kind === 'taxi') return z !== 'cliff' || rng.chance(0.3);
      return true;
    });
    if (!c) return;
    c.dir = (oncoming ? -1 : 1) * this.dir;
    let lane = rng.int(0, n - 1);
    if (c.kind === 'bus' || c.kind === 'van' || c.kind === 'truck') lane = n - 1;
    if (c.type.scooter && rng.chance(0.6)) lane = n - 1;
    c.lane = lane; c.s = s; c.len = c.type.len; c.wid = c.type.wid;
    c.u = this.laneUOf(c, s);
    // keep spawn spacing per lane, and never inside somebody
    for (const q of this.cars) if (q.active && q !== c && Math.abs(q.s - s) < (Math.abs(q.u - c.u) < 2 ? 30 : 6)) return;
    for (const st of this.sites) if (lane === st.lane && c.dir > 0 && Math.abs(st.s - s) < 60) { c.lane = Math.max(0, lane - 1); c.u = this.laneUOf(c, s); }
    this.personality(c);
    c.active = true; c.crash = null; c.cross = null; this.repair(c);
    this.initDrive(c);
    c.v0 = this.roadSpeed(s) * c.drv.vf; c.v = c.v0 * (behind ? 0.95 : rng.range(0.7, 1.0));
    if (c.kind === 'bus') this.lastBus = this.t;
    // beach cruisers: slow, looking for a parking spot, liable to stop anywhere
    if ((z === 'beach' || z === 'cove') && !c.type.scooter && c.kind !== 'bus' && rng.chance(0.28)) { c.drv.cruiser = true; c.drv.vf *= 0.62; c.drv.indicate = 0.3; }
    c.m.root.visible = true;
  }

  /** a double-parked car (hazards on) or, at the beaches, a car parked tight to the kerb */
  spawnParked(ps, initial = false) {
    const rng = this.rng, route = this.route;
    const s = ps + this.dir * (initial ? rng.range(120, 900) : rng.range(820, 1000));
    if (s > route.length - 40 || s < 40) return;
    const z = this.zone(s), n = this.laneCount(s);
    if (route.urban(s) < 0.5 && z !== 'cove') return;
    const J = this.signals ? this.signals.J : [];
    if (J.some((j) => Math.abs(j.s - s) < 35)) return;
    if (this.busStops.some((b) => Math.abs(b - s) < 30)) return;
    if (this.sites.some((st) => Math.abs(st.s - s) < 70)) return;
    const c = this.pickFree((q) => !q.type.scooter && q.kind !== 'bus' && q.kind !== 'taxi'); if (!c) return;
    c.dir = rng.chance(0.62) ? 1 : -1; c.s = s; c.lane = n - 1;
    for (const q of this.cars) if (q.active && q !== c && Math.abs(q.s - s) < 14) return;
    this.personality(c);
    c.active = true; c.crash = null; c.cross = null; this.repair(c);
    c.u = this.kerbU(c, s, n === 1 ? 1.05 : 1.0);
    this.initDrive(c);
    c.mode = 'parked'; c.v = 0; c.v0 = this.roadSpeed(s) * c.drv.vf;
    c.hazard = z !== 'beach' && z !== 'cove' ? true : rng.chance(0.3);
    c.parkT = rng.range(12, 60); // some of them eventually drive off
    c.m.root.visible = true;
  }

  // ---------------------------------------------------------------- neighbourhood
  /** flat list of everything on the carriageway this frame: {s,u,hs,hu,vs (signed along s),dir,ref,kind} */
  gather(actors) {
    const O = this.objs; O.length = 0;
    for (const c of this.cars) {
      if (!c.active || (c.crash && c.crash.y > 1.2)) continue;
      const vs = c.crash ? c.crash.vs : c.cross ? c.xvs : c.dir * c.v;
      O.push({ s: c.s, u: c.u, hs: c.hs, hu: c.hu, vs, dir: c.cross ? 0 : c.dir, ref: c, kind: 'car', stopped: c.mode === 'parked' || c.mode === 'stop' || !!c.crash });
    }
    for (const a of actors) {
      const v = a.veh; const vs = v.vLong * Math.cos(v.yaw - Math.atan2(-this.route.lin(this.route.TX, v.s), -this.route.lin(this.route.TZ, v.s)));
      O.push({ s: v.s, u: v.u, hs: v.halfL, hu: v.halfW, vs, dir: vs >= 0 ? 1 : -1, ref: a, kind: a.kind, stopped: false });
    }
    if (this.people) for (const p of this.people.onRoad) O.push({ s: p.s, u: p.u, hs: 0.5, hu: 0.5, vs: 0, dir: 0, ref: p, kind: 'ped', stopped: true });
    for (const st of this.sites) O.push({ s: st.s, u: st.u, hs: st.len / 2, hu: st.wid / 2, vs: 0, dir: 0, ref: st, kind: 'site', stopped: true });
    return O;
  }
  /** nearest thing ahead of c whose lateral extent overlaps [u-hw, u+hw]: {gap, lv (its speed along our direction), o} */
  lead(c, u, hw, range = 160, margin = 0.22) {
    let gap = 1e9, lv = 0, ob = null;
    for (const o of this.objs) {
      if (o.ref === c) continue;
      const d = (o.s - c.s) * c.dir; if (d <= 0 || d > range + o.hs) continue;
      if (Math.abs(o.u - u) > o.hu + hw + margin) continue;
      const g = d - o.hs - c.len * 0.5;
      if (g < gap) { gap = g; lv = o.vs * c.dir; ob = o; }
    }
    return { gap, lv, o: ob };
  }
  /** nearest same-direction follower behind c in a lateral band */
  follow(c, u, hw, range = 70) {
    let gap = 1e9, fv = 0, ob = null;
    for (const o of this.objs) {
      if (o.ref === c || o.kind === 'ped' || o.kind === 'site') continue;
      const d = (c.s - o.s) * c.dir; if (d <= -c.len * 0.5 || d > range) continue;
      if (o.vs * c.dir < -0.5) continue; // oncoming: handled as a leader
      if (Math.abs(o.u - u) > o.hu + hw + 0.25) continue;
      const g = d - o.hs - c.len * 0.5;
      if (g < gap) { gap = g; fv = o.vs * c.dir; ob = o; }
    }
    return { gap, fv, o: ob };
  }
  idm(c, v, v0, gap, lv, d = c.drv) {
    const a = d.a, b = d.b;
    const dv = v - lv;
    const sStar = d.s0 + Math.max(0, v * d.T + v * dv / (2 * Math.sqrt(a * b)));
    const free = v < v0 ? 1 - Math.pow(v / Math.max(0.1, v0), 4) : -(v - v0) * 0.6;
    return a * (free - Math.pow(sStar / Math.max(0.3, gap), 2));
  }
  /** what a generic follower would have to do if we cut in front of it */
  idmGeneric(v, gap, lv) {
    const a = 1.6, b = 3, T = 1.0, s0 = 1.8;
    const sStar = s0 + Math.max(0, v * T + v * (v - lv) / (2 * Math.sqrt(a * b)));
    return a * (1 - Math.pow(sStar / Math.max(0.3, gap), 2));
  }

  honk(c, reason, player = false) {
    if (c.honkCool > 0) return;
    c.honkCool = this.rng.range(2.5, 6) * (1.4 - c.drv.agg);
    this.honks.push({ c, reason, player, long: reason === 'cutoff' || reason === 'overtaker' || reason === 'shaken' || reason === 'angry', kind: c.kind });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, ps, actors) {
    const route = this.route, rng = this.rng;
    this.t += dt; this.dtLast = dt;
    let same = 0, onc = 0, parked = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      // Mode wiring: a free session shares one lap with its traffic; configured track patrols can follow race laps.
      if (route.closed && this.allowClosedRoam) c.s += Math.round((ps - c.s) / route.length) * route.length;
      const ahead = (c.s - ps) * this.dir;
      if (c.cop && c.cop.keep) { if (!(route.closed && (this.allowClosedRoam || this.allowClosedPolice)) && (c.s < 5 || c.s > route.length - 5)) { c.active = false; c.m.root.visible = false; } continue; }
      if (ahead < -260 || ahead > 1150 || !(route.closed && (this.allowClosedRoam || this.allowClosedPolice)) && (c.s < 5 || c.s > route.length - 5)) { c.active = false; c.m.root.visible = false; c.cross = null; continue; }
      if (c.mode === 'parked') parked++; else if (c.dir > 0) same++; else onc++;
    }
    if (!this.disabled) {
      const n = this.laneCount(ps + this.dir * 500), dens = this.density(ps + this.dir * 500);
      const wantSame = Math.round(n * 7 * dens), wantOnc = Math.round(n * 6 * dens);
      const z = this.zone(ps + this.dir * 500);
      const wantParked = { town: 3, beach: 4, cliff: 0, cove: 2 }[z];
      if (same < wantSame || onc < wantOnc) this.spawn(ps);
      if (parked < wantParked && rng.chance(dt * 2)) this.spawnParked(ps);
      // traffic also catches up from behind (so you get queued on and honked at when you sit at a green)
      const pl = actors.find((a) => a.kind === 'player');
      if (pl && pl.veh.vLong < 9 && rng.chance(dt * 0.35)) this.spawn(ps, false, true);
    }
    this.gather(actors);
    const pl = actors.find((a) => a.kind === 'player');
    // the racers in route space (what every driver watches for), and the wrecks people slow down to look at
    this.racers.length = 0;
    for (const a of actors) {
      const r = routeVel(a.veh, route), ex = extents(a.veh, route);
      this.racers.push({ a, kind: a.kind, s: a.veh.s, u: a.veh.u, vs: r.vs, vu: r.vu, hs: ex.hs, hu: ex.hu });
    }
    for (const c of this.cars) if (c.active && c.cop && c.cop.siren && !c.crash) this.racers.push({ a: c, kind: 'police', s: c.s, u: c.u, vs: c.dir * c.v, vu: c.uv || 0, hs: c.len * 0.5, hu: c.wid * 0.5 });
    this.wrecks.length = 0;
    for (const c of this.cars) if (c.active && c.crash && c.crash.wreck) this.wrecks.push(c);
    for (const c of this.cars) {
      if (!c.active) continue;
      c.honkCool -= dt;
      if (c.crash) { this.updateCrashed(c, dt); continue; }
      if (c.cross) continue; // side-street cars crossing the junction: see updateCross
      if (c.mode === 'parked') { if (!c.cop) this.updateParked(c, dt); continue; }
      if (c.cop && c.cop.chase && this.police) { this.police.driveCop(c, dt); this.bumpCheck(c); continue; }
      this.drive(c, dt, pl);
    }
    this.updateCross(dt, ps, actors);
    this.updateCones(dt);
  }

  updateParked(c, dt) {
    c.v = 0; c.acc = 0;
    c.parkT -= dt;
    if (c.parkT > 0) return;
    // pull out: indicate towards the traffic, wait for a gap, go
    const lu = this.laneUOf(c, c.s, this.laneCount(c.s) - 1);
    const f = this.follow(c, lu, c.wid * 0.5, 60);
    c.blinkSide = -1; c.hazard = false;
    c.waitT = (c.waitT || 0) + dt;
    const ok = f.gap > 14 + f.fv * 1.6 || (c.waitT > 6 && f.gap > 6 + f.fv * 0.8);
    if (ok) { c.mode = 'drive'; c.uT = lu; c.v = 0.5; c.lane = this.laneCount(c.s) - 1; c.lcT = 2.5; c.waitT = 0; }
  }

  /** one driver's decisions + motion */
  drive(c, dt, pl) {
    const route = this.route, rng = this.rng, d = c.drv;
    const n = this.laneCount(c.s), hw = c.wid * 0.5, scoot = c.type.scooter;
    if (c.lane > n - 1 && !c.task) { c.lane = n - 1; c.lcT = 2; }
    const laneU = this.laneUOf(c, c.s);
    let v0 = this.roadSpeed(c.s + c.dir * 25) * d.vf * (n >= 2 ? (c.lane === 0 ? 1.07 : c.lane === n - 1 ? 0.93 : 1) : 1);
    c.v0 = v0;
    // ---- leader in our current path (wide enough to cover a lane change in progress)
    const uLo = Math.min(c.u, c.uT), uHi = Math.max(c.u, c.uT);
    const L = this.lead(c, (uLo + uHi) / 2, hw + (uHi - uLo) / 2, 160, scoot ? 0.12 : 0.22);
    let gap = L.gap, lv = L.lv;
    // red lights (stop line), pedestrians are already in the obstacle list
    let sigGap = null;
    if (this.signals) { const sd = this.signals.stopFor(c.s + c.dir * c.len * 0.5, c.dir, c.v, c); if (sd !== null) sigGap = Math.max(0.2, sd); }
    if (sigGap !== null && sigGap < gap) { gap = sigGap; lv = 0; }
    // rubbernecking: everybody slows down past a wreck
    for (const w of this.wrecks) { const dd = (w.s - c.s) * c.dir; if (dd > -15 && dd < 60 && Math.sign(w.u || 1) === c.dir) { v0 *= 0.55; break; } }
    // ---- tasks: taxi fares, bus stops, cruisers grabbing a spot, pull-overs and turn-offs
    if (!c.task && c.mode === 'drive') this.maybeTask(c, n, dt);
    let acc;
    if (c.task) acc = this.runTask(c, dt, n, gap, lv);
    else {
      if (c.split) v0 = Math.min(v0, Math.max(7, (L.lv > 0 ? L.lv : 0) + 7));
      acc = this.idm(c, c.v, v0, gap, lv);
    }
    // ---- the racers: something coming at us on our side of the road, or closing fast from behind
    acc = this.watchRacers(c, dt, n, acc);
    // ---- lateral decisions (lane changes, overtakes, filtering)
    if (!c.task && !c.evade) {
      if (scoot) this.scooterLogic(c, dt, n, L);
      else if (n >= 2) this.laneChange(c, dt, n, L, acc);
      if (!scoot) this.overtakeLogic(c, dt, n, L, acc);
      if (!c.ovt && !c.split && c.lcDelay <= 0) c.uT = c.yieldT > 0 && c.yieldU !== undefined ? c.yieldU : this.laneUOf(c, c.s);
    }
    // ---- someone pulls out in front of a fast racer without a look in the mirror (the phone driver, now and then a
    // hothead who misjudges the closing speed): straight into the lane the racer is using
    if (pl && !scoot && c.dir > 0 && !c.task && !c.ovt && !c.evade && n >= 2 && c.lcT <= 0 && c.lcDelay <= 0) {
      const dd = c.s - pl.veh.s;
      const rate = d.arch === 'distracted' ? 0.5 : d.arch === 'aggressive' ? 0.07 : d.arch === 'normal' ? 0.02 : 0;
      if (dd > 22 && dd < 80 && pl.veh.vLong > c.v + 10 && rng.chance(dt * rate)) {
        const want = c.lane + (pl.veh.u < c.u ? -1 : 1);
        if (want >= 0 && want < n && Math.abs(this.laneUOf(c, c.s, want) - pl.veh.u) < LANE_W * 0.7) this.startLC(c, want, true);
      }
    }
    // ---- jerk-limited longitudinal motion
    acc = clamp(acc, -9, d.a * 1.05);
    const jerkUp = 3.5 + 3 * d.agg, jerkDn = acc < -4 ? 30 : 12;
    c.acc = acc > c.acc ? Math.min(acc, c.acc + jerkUp * dt) : Math.max(acc, c.acc - jerkDn * dt);
    if (c.v <= 0 && c.acc < 0) c.acc = 0;
    c.v = Math.max(0, c.v + c.acc * dt);
    c.s += c.dir * c.v * dt;
    // hard stops chirp the tyres (taxis grabbing a fare, someone cut in)
    if (c.acc < -5.5 && c.v > 5 && !c.chirp) { c.chirp = true; this.sounds.push({ kind: 'skid', c }); } else if (c.acc > -2) c.chirp = false;
    // ---- lateral: critically damped towards uT, lateral speed limited by forward speed (no crab-walking).
    // An emergency swerve is a yank of the wheel: much faster, up to what the tyres allow (~0.8 g)
    const ev = !!c.evade;
    const latMax = ev ? Math.min(4.5, 0.1 + c.v * 0.5) : Math.min(d.latV, 0.06 + c.v * 0.32);
    // the phone driver drifts about in the lane
    const uAim = c.uT + (d.wander && !c.task && !ev ? Math.sin(this.t * 0.37 + c.id * 1.7) * Math.sin(this.t * 0.11 + c.id) * d.wander : 0);
    const want = clamp((uAim - c.u) * (ev ? 3.2 : 2.4), -latMax, latMax);
    c.uv += clamp(want - c.uv, -(ev ? 7.5 : 4) * dt, (ev ? 7.5 : 4) * dt);
    // Stop at the committed escape line; a rate-limited velocity alone can
    // overshoot it and command a second, opposite swerve before the pass.
    if (ev && !c.evade.freeze) {
      const side = c.evade.side;
      c.uv = side * Math.max(0, Math.min(c.uv * side, (uAim - c.u) * side / dt));
    }
    c.u += c.uv * dt;
    if (c.lcT > 0) c.lcT -= dt;
    c.yawLC = Math.atan2(c.uv, Math.max(1.5, c.v)) * c.dir;
    c.wheel += c.v * dt;
    // ---- impatience
    const stoppedBehind = c.v < 0.8 && gap < 9 && (sigGap === null || gap < sigGap - 0.5);
    c.stuckT = stoppedBehind ? c.stuckT + dt : Math.max(0, c.stuckT - dt * 2);
    if (c.stuckT > d.patience && L.o) {
      const o = L.o, isPl = o.kind === 'player';
      if (o.kind !== 'ped') this.honk(c, isPl ? 'blocking' : 'stuck', isPl);
    }
    if (c.acc < -4.5 && L.o && L.gap < 18 && (L.o.kind === 'player' || L.o.kind === 'rival' || (L.o.ref && L.o.ref.lcT > 0))) this.honk(c, 'cutoff', L.o.kind === 'player');
    // an oncoming overtaker on our side of the road: lean on the horn (the racers are handled in watchRacers)
    if (L.o && L.lv < -3 && L.gap < 70 && L.o.ref && L.o.ref.ovt) this.honk(c, 'overtaker', false);
    // taxis tooting at people on the pavement ("need a taxi?")
    if (c.kind === 'taxi' && route.urban(c.s) > 0.7 && rng.chance(dt * 0.012)) this.honk(c, 'fare');
    // ---- lights
    const blinkOn = Math.sin(this.t * 9.4 + c.id) > 0;
    const sideL = c.dir > 0 ? -1 : 1; // which u-sign is "left" for this car
    let bL = false, bR = false;
    if (c.hazard) bL = bR = blinkOn;
    else if (c.blinkSide) { if (c.blinkSide < 0) bL = blinkOn; else bR = blinkOn; }
    c.indL.emissiveIntensity = bL ? 3.5 : 0; c.indR.emissiveIntensity = bR ? 3.5 : 0;
    // flashing the headlights at a racer: two or three quick blips
    if (c.flashT > 0) c.flashT -= dt;
    c.flash.emissiveIntensity = c.flashT > 0 && Math.sin(c.flashT * 22) > -0.2 ? 6 : 0;
    c.braking = c.acc < -0.9 || c.v < 0.3;
    // clear indicators once a manoeuvre settles
    if (c.blinkSide && !c.task && !c.ovt && !c.evade && c.yieldT <= 0 && c.lcDelay <= 0 && c.lcT <= 0 && Math.abs(c.u - c.uT) < 0.25 && c.mode === 'drive') c.blinkSide = 0;
    void sideL;
  }

  // ---- the racers as one driver sees them. Head-on: after their reaction time they brake hard, flash, lean on the horn
  // and swerve for whichever side leaves the most room (the kerb, the shoulder, or the middle of the road if you are
  // heading for the kerb); some freeze and just stand on the brakes. From behind: the courteous ones check the mirror and
  // move over or hug the kerb to let you by; most hold their line; the phone driver never looks.
  watchRacers(c, dt, n, acc) {
    const d = c.drv, hw = c.wid * 0.5, route = this.route, rng = this.rng;
    let head = null, rear = null;
    for (const R of this.racers) {
      if (R.a === c) continue;
      const dS = (R.s - c.s) * c.dir, rvs = R.vs * c.dir;
      if (dS > 0 && rvs < -1.5) {
        const close = c.v - rvs, gap = dS - R.hs - c.len * 0.5;
        const ttc = Math.max(0, gap) / Math.max(1, close);
        if (ttc < 4.5 && gap < 200) {
          const uR = R.u + R.vu * Math.min(ttc, 1.5); // where they'll be when they get here
          const lat = Math.min(Math.abs(uR - c.u), Math.abs(R.u - c.u)) - (R.hu + hw);
          if (lat < 0.8 && (!head || ttc < head.ttc)) head = { R, ttc, gap, uR, lat };
        }
      } else if (dS < 0 && dS > -150 && rvs > c.v + 5) {
        const rel = rvs - c.v, dist = -dS - R.hs - c.len * 0.5;
        if (Math.abs(R.u - c.u) < hw + R.hu + 0.9 && dist / rel < 7 && (!rear || dist < rear.dist)) rear = { R, dist, rel };
      }
    }
    // ---------------- head-on
    if (head) c.seeT += dt; else c.seeT = Math.max(0, c.seeT - dt * 3);
    if (c.evade) {
      const E = c.evade; E.t += dt;
      const observed = this.racers.find((r) => racerKey(r) === racerKey(E.R));
      const R = observed || E.R, dS = (R.s - c.s) * c.dir;
      E.R = R;
      // still coming at us (even if we're now clear of its line)? keep out of the way until it has gone by
      const coming = observed && dS > 0 && R.vs * c.dir < -1 && (dS - R.hs - c.len * 0.5) / Math.max(1, c.v - R.vs * c.dir) < 5.5 && Math.abs(R.u - c.u) < hw + R.hu + 3;
      if (coming || (head && head.R === R)) E.lost = 0; else E.lost += dt;
      if (dS < -R.hs - c.len * 0.5 || E.lost > 1.2 || E.t > 9) {
        // it went past: shaken, a long blast of the horn after it, then back into the lane
        if (dS < 0 && Math.abs(R.u - c.u) < hw + R.hu + 4) { c.honkCool = 0; this.honk(c, 'shaken', R.kind === 'player'); }
        c.evade = null; c.shakenT = 1.5 + rng.range(0, 2); c.lcT = 0.5; c.blinkSide = 0;
      } else {
        c.uT = E.uT;
        // brake as hard as they dare: harder the closer it is (and the phone driver panics)
        const ttc = head ? head.ttc : 3, clear = head ? clamp((head.lat + 0.2) / 1.2, 0, 1) : 1;
        const want = -lerp(lerp(3.5, d.arch === 'distracted' ? 9 : 8.2, clamp((3.6 - ttc) / 2.6, 0, 1)), 2.2, E.freeze ? 0 : clear);
        acc = Math.min(acc, c.v > (E.freeze ? 0.3 : 3) ? want : 0.3);
      }
    } else if (head && c.seeT > d.rt && !c.task && !c.type.bus) {
      const freeze = rng.chance(d.freeze);
      const uT = freeze ? c.u : this.escapeU(c, head);
      c.evade = { R: head.R, t: 0, lost: 0, freeze, uT, side: Math.sign(uT - c.u) || c.dir };
      c.uT = uT;
      c.ovt = null; c.split = false; c.lcDelay = 0; c.lcT = 0;
      if (rng.chance(d.horn)) { c.honkCool = 0; this.honk(c, 'overtaker', head.R.kind === 'player'); }
      if (d.arch !== 'distracted') c.flashT = 0.9;
      if (!freeze && c.v > 6) this.sounds.push({ kind: 'skid', c });
    } else if (head && c.type.bus && c.seeT > d.rt) {
      // a bus can't dodge: it stands on the brakes and the horn
      acc = Math.min(acc, -5); c.honkCool = Math.min(c.honkCool, 0); this.honk(c, 'overtaker', head.R.kind === 'player');
    }
    if (c.shakenT > 0) { c.shakenT -= dt; acc = Math.min(acc, 0.4); }
    // ---------------- fast car from behind
    if (c.yieldT > 0) {
      c.yieldT -= dt;
      if (c.yieldU !== undefined && !c.evade && !c.task) { c.uT = c.yieldU; acc = Math.min(acc, 0.2); }
      if (c.yieldT <= 0) { c.yieldU = undefined; c.blinkSide = 0; }
    } else if (rear && !c.evade && !c.task && !c.ovt && c.lcT <= 0 && c.lcDelay <= 0 && c.mode === 'drive' && !c.type.scooter) {
      if (c.yieldFor !== racerKey(rear.R)) {
        c.yieldFor = racerKey(rear.R);
        c.yieldWill = rear.R.kind === 'police' ? d.arch !== 'distracted' || rng.chance(0.3) : rng.chance(d.mirror * (d.arch === 'courteous' ? 0.85 : 0.5)); // a siren: everybody (nearly) pulls over
      }
      if (c.yieldWill && rear.dist < 20 + rear.rel * 3) {
        c.yieldWill = false;
        const kerbLane = n - 1;
        if (n >= 2 && c.lane < kerbLane) {
          // move one lane right if the lane is clear enough (they DID look)
          const u = this.laneUOf(c, c.s, c.lane + 1), F = this.follow(c, u, hw, 50), N = this.lead(c, u, hw, 60);
          if (F.gap > 8 + F.fv * 0.8 && N.gap > 8) { this.startLC(c, c.lane + 1, false); c.lcDelay = Math.min(c.lcDelay, 0.5); c.yieldT = 3; }
        } else if (route.div(c.s) < 0.45 || n >= 2) {
          // nowhere to go: hug the kerb, right indicator, lift off
          const uk = this.kerbU(c, c.s, hw + 0.25);
          c.yieldU = Math.abs(uk) < Math.abs(c.u) + 1.2 ? uk : c.u + c.dir * 1.2;
          if (this.lead(c, c.yieldU, hw, 40).gap > 10) { c.yieldT = 2.5 + rng.range(0, 2); c.blinkSide = 1; } else c.yieldU = undefined;
        }
      }
    } else if (!rear && c.yieldFor) c.yieldFor = null;
    return acc;
  }
  /** pick the escape line for a head-on: as far from where the threat is heading as the road (and the traffic) allows */
  escapeU(c, H) {
    const route = this.route, hw = c.wid * 0.5, rural = route.urban(c.s) < 0.5 && this.zone(c.s) !== 'cove'; // (cove shoulders are lined with parked cars)
    // kerb side: right up to the kerb, and in the country onto the gravel shoulder as well
    const kerb = c.dir * (route.edge(c.s) + (rural ? ROAD.gutter + 0.7 : ROAD.gutter * 0.4) - hw);
    const cand = [kerb, c.u];
    // the middle of the road / the other lane, only if they are coming at us along the kerb and nothing's there
    if ((H.uR - c.u) * c.dir > 0.4) cand.push(c.u - c.dir * LANE_W, c.u - c.dir * LANE_W * 0.6);
    if (route.div(c.s) > 0.45) for (let i = 0; i < cand.length; i++) { const mh = route.medHalf(c.s) + hw + 0.2; if (cand[i] * c.dir < mh) cand[i] = c.dir * mh; }
    let best = c.u, bs = -1e9;
    for (const u of cand) {
      let sc = Math.abs(u - H.uR) - Math.abs(u - c.u) * 0.12 + (u === kerb ? 0.8 : 0);
      const A = this.lead(c, u, hw, 30, 0.1); if (A.o && A.o.ref !== H.R.a && A.gap < 10) sc -= 3;
      const B = this.follow(c, u, hw, 12); if (B.o && Math.abs(u - c.u) > 1 && B.gap < 3) sc -= 2;
      if (sc > bs) { bs = sc; best = u; }
    }
    return best;
  }

  // ---- lane changes on the avenue (MOBIL-ish)
  laneChange(c, dt, n, L, accCur) {
    const d = c.drv;
    if (c.lcDelay > 0) { c.lcDelay -= dt; if (c.lcDelay <= 0) { c.uT = this.laneUOf(c, c.s); c.lcT = 3; } return; }
    if (c.lcT > 0 || c.ovt) return;
    c.lcEval -= dt; if (c.lcEval > 0) return;
    c.lcEval = this.rng.range(0.5, 1.1);
    const hw = c.wid * 0.5;
    let best = -1, bestGain = 0.25 - 0.18 * d.agg;
    // mandatory: lane closed / blocked by something stopped (double-parked car, bus at a stop, road works)
    const blocked = L.o && L.o.stopped && L.gap < 70;
    for (const tl of [c.lane - 1, c.lane + 1]) {
      if (tl < 0 || tl >= n) continue;
      const u = this.laneUOf(c, c.s, tl);
      const N = this.lead(c, u, hw, 160);
      const accNew = this.idm(c, c.v, c.v0, Math.min(N.gap, 1e4), N.lv);
      const F = this.follow(c, u, hw, 70);
      // safety: the new follower must not need to brake harder than this driver is willing to impose
      const squeeze = d.agg > 0.7 || (blocked && c.stuckT > 1.5);
      if (F.o) {
        const accF = this.idmGeneric(F.fv, F.gap, c.v);
        if (accF < -d.bsafe * (squeeze ? 1.5 : 1) || F.gap < (squeeze ? 1.0 : 3.5)) continue;
      }
      if (N.gap < (squeeze ? 2 : 6)) continue;
      let gain = accNew - accCur;
      if (F.o) gain -= d.polite * Math.max(0, -this.idmGeneric(F.fv, F.gap, c.v));
      if (blocked) gain += 3;
      if (tl > c.lane && (c.kind === 'bus' || c.kind === 'van' || c.kind === 'truck' || d.cruiser)) gain += 0.4; // slow vehicles keep to the kerb
      if (tl > c.lane && !blocked) gain -= 0.1; // nobody in Athens volunteers for the kerb lane
      for (const st of this.sites) if (st.lane === tl && c.dir > 0 && st.s - c.s > -20 && st.s - c.s < 200) gain -= 5;
      if (gain > bestGain) { bestGain = gain; best = tl; }
    }
    if (best >= 0) this.startLC(c, best, d.indicate < 0.3);
  }
  startLC(c, lane, sudden = false) {
    c.lane = lane;
    const toU = this.laneUOf(c, c.s, lane);
    c.blinkSide = Math.sign((toU - c.u) * c.dir) || 0; // + = to the right of travel
    c.lcDelay = sudden ? 0 : c.drv.indicate;
    if (c.lcDelay <= 0) { c.uT = toU; c.lcT = 3; }
  }

  // ---- passing a stopped / crawling obstacle through the oncoming lane (narrow streets, or a blocked kerb lane)
  overtakeLogic(c, dt, n, L, acc) {
    const d = c.drv, hw = c.wid * 0.5;
    if (c.ovt) {
      const o = c.ovt;
      // past it? come back in
      if ((c.s - o.s) * c.dir > o.hs + c.len * 0.5 + 3 + c.v * 0.3) { c.ovt = null; c.uT = this.laneUOf(c, c.s); c.blinkSide = c.drv.indicate > 0.3 ? 1 : 0; return; }
      // abort if something is coming the other way and we're not committed yet
      const A = this.lead(c, c.uT, hw, 120);
      if (A.o && A.lv < -1 && A.gap / Math.max(1, c.v - A.lv) < 3.2 && (c.s - o.s) * c.dir < -o.hs) { c.ovt = null; c.uT = this.laneUOf(c, c.s); c.blinkSide = 0; }
      return;
    }
    if (!L.o || L.o.kind === 'ped' || L.gap > 28 || c.lcT > 0 || c.lcDelay > 0) return;
    const o = L.o;
    const slow = o.stopped || L.lv < Math.min(4, c.v0 * 0.45);
    if (!slow) return;
    // multi-lane avenues: only when the neighbouring lane is not an option (lane changes handle that)
    if (n >= 2) return;
    if (c.stuckT < (o.stopped ? 0.4 : 1.5) && c.v < 1 && !o.stopped) return;
    // swing out just enough to clear it, into the oncoming lane if need be
    const clearU = (o.u - c.dir * (o.hu + hw + 0.55));
    const uT = c.dir > 0 ? Math.min(clearU, this.laneUOf(c, c.s)) : Math.max(clearU, this.laneUOf(c, c.s));
    // the other side must be free for the time it takes
    const passLen = L.gap + o.hs * 2 + c.len + 6;
    const tPass = passLen / Math.max(2.5, Math.min(c.v0, 12) - Math.max(0, L.lv) * 0.5);
    const need = 18 * tPass + 35 * (1.2 - d.agg);
    const A = this.lead(c, uT, hw, 260);
    const onc = A.o && A.lv < 0.5 ? A.gap : 1e9;
    if (onc < need) return;
    c.ovt = o; c.uT = uT; c.blinkSide = c.drv.indicate > 0.3 ? -1 : 0;
  }

  // ---- scooters: filter between lanes, ride the centre line, squeeze past at the lights
  scooterLogic(c, dt, n, L) {
    const route = this.route, hw = c.wid * 0.5;
    const jam = L.o && L.o.kind !== 'ped' && L.gap < 14 && L.lv < 6;
    if (!c.split && jam) {
      // pick a gap: between our lane and the next one in, or along the kerb, or the centre line on a narrow street
      const cand = [];
      if (n >= 2) { const l = Math.max(1, Math.min(c.lane, n - 1)); cand.push(c.dir * (route.medHalf(c.s) + l * LANE_W)); }
      cand.push(c.dir * (route.edge(c.s) - 0.45));
      if (n === 1 || route.div(c.s) < 0.4) cand.push(c.dir * (route.medHalf(c.s) + 0.1));
      let best = null, bg = L.gap + 4;
      for (const u of cand) { const A = this.lead(c, u, hw, 60, 0.1); if (A.gap > bg && !(A.o && A.lv < -0.5 && A.gap < 40)) { bg = A.gap; best = u; } }
      if (best !== null) { c.split = true; c.uT = best; c.blinkSide = 0; c.splitT = 0; }
    } else if (c.split) {
      c.splitT += dt;
      const back = this.lead(c, this.laneUOf(c, c.s), hw, 40, 0.12);
      const A = this.lead(c, c.uT, hw, 50, 0.1);
      if ((back.gap > 25 || back.lv > 9) && c.splitT > 1.5) { c.split = false; c.uT = this.laneUOf(c, c.s); }
      else if (A.o && A.lv < -1 && A.gap < 30) { c.split = false; c.uT = this.laneUOf(c, c.s); } // oncoming on the centre line: duck back in
    } else if (n >= 2 && c.lcT <= 0 && this.rng.chance(dt * 0.25)) {
      // weave: hop lanes into small gaps without much ceremony
      const tl = c.lane + (this.rng.chance(0.5) ? 1 : -1);
      if (tl >= 0 && tl < n) { const u = this.laneUOf(c, c.s, tl); const F = this.follow(c, u, hw, 30); const N = this.lead(c, u, hw, 40); if (F.gap > 2.5 && N.gap > 5) { c.lane = tl; c.uT = u; c.lcT = 1.2; } }
    }
  }

  // ---- taxi fares, bus stops, beach cruisers grabbing a parking spot; and now and then an ordinary driver pulls over
  // (a phone call, dropping someone off, checking the map) or turns off right into a side street or a driveway.
  // Most indicate first and check the lane; the phone driver just brakes and goes.
  maybeTask(c, n, dt = 0) {
    const rng = this.rng, route = this.route, z = this.zone(c.s), d = c.drv;
    if (!c.type.bus && !c.type.scooter && !c.evade && c.yieldT <= 0 && !c.ovt) {
      c.quirkT -= dt * d.quirk;
      if (c.quirkT <= 0) {
        c.quirkT = rng.range(35, 120);
        if (this.tryTurn(c, n)) return;
        if (rng.chance(0.5)) this.tryPull(c, n);
        if (c.task) return;
      }
    }
    if (this.t - c.lastStop < 25) return;
    const J = this.signals ? this.signals.J : [];
    const nearJ = (s) => J.some((j) => Math.abs(j.s - s) < 40);
    if (c.kind === 'bus' && c.dir > 0) {
      for (const b of this.busStops) {
        const dd = b - c.s;
        if (dd > 25 && dd < 140 && b > (c.lastStopS ?? -1e9) + 50) { c.task = { kind: 'bus', sStop: b - 4, phase: 'in', t: 0 }; c.lane = n - 1; c.blinkSide = 1; c.lastStopS = b; return; }
      }
      return;
    }
    const fare = c.kind === 'taxi' && route.urban(c.s) > 0.6 && rng.chance(0.004);
    const park = c.drv.cruiser && rng.chance(0.003);
    if (!fare && !park) return;
    const sStop = c.s + c.dir * (c.v * c.v / (2 * 3.6) + 8);
    if (nearJ(sStop) || this.busStops.some((b) => Math.abs(b - sStop) < 25)) return;
    if (this.sites.some((st) => Math.abs(st.s - sStop) < 60)) return;
    c.task = { kind: fare ? 'fare' : 'park', sStop, phase: 'in', t: 0 };
    c.lane = n - 1; c.ovt = null; c.split = false;
    c.blinkSide = c.drv.indicate > 0.2 || rng.chance(0.4) ? 1 : 0; // half of them don't bother
    void z;
  }
  /** sudden: the phone driver (no indicator, or only as they brake, and no look in the mirror) */
  quirkStart(c, n, task) {
    const d = c.drv, rude = d.arch === 'distracted';
    task.rude = rude; task.sig = rude ? 0 : Math.max(0.8, d.indicate + 0.5);
    task.blink = !rude || this.rng.chance(0.4);
    c.task = task; c.ovt = null; c.split = false; c.lcDelay = 0;
    c.blinkSide = task.blink ? 1 : 0;
    if (rude) c.lane = n - 1;
  }
  tryPull(c, n) {
    const route = this.route, J = this.signals ? this.signals.J : [];
    const b = c.drv.arch === 'distracted' ? 5 : 2.6;
    const sStop = c.s + c.dir * (c.v * c.v / (2 * b) + (c.drv.arch === 'distracted' ? 4 : 25));
    if (route.div(sStop) < 0.45 && n < 2 && route.edge(sStop) < 4.5) return false; // too narrow to stop without blocking it
    if (J.some((j) => Math.abs(j.s - sStop) < 40) || this.busStops.some((q) => Math.abs(q - sStop) < 25) || this.sites.some((st) => Math.abs(st.s - sStop) < 60)) return false;
    for (const q of this.cars) if (q.active && q !== c && q.mode === 'parked' && Math.abs(q.s - sStop) < 14 && Math.sign(q.u) === c.dir) return false;
    this.quirkStart(c, n, { kind: 'pull', sStop, phase: 'in', t: 0 });
    return true;
  }
  /** turn off right: a side street at the next junction, or (beach / town) a driveway, a petrol station, a car park */
  tryTurn(c, n) {
    const route = this.route, rng = this.rng, key = c.dir > 0 ? 'R' : 'L';
    const J = this.signals ? this.signals.J : [];
    for (const j of J) {
      const dd = (j.s - c.s) * c.dir;
      if (dd < 40 + c.v * 1.5 || dd > 160 || j.sides[key] === null || j === c.lastJ) continue;
      c.lastJ = j;
      const along = j.sides[key] || 0;
      this.quirkStart(c, n, { kind: 'turn', sTurn: j.s + along * 0.3 - c.dir * 9, j, along, phase: 'in', t: 0 });
      return true;
    }
    const z = this.zone(c.s), g = this.ground;
    if (!g || z === 'cliff' || !rng.chance(0.5)) return false;
    const sT = c.s + c.dir * (c.v * c.v / (2 * 2.4) + 30);
    if (J.some((j) => Math.abs(j.s - sT) < 50) || this.sites.some((st) => Math.abs(st.s - sT) < 60) || this.busStops.some((q) => Math.abs(q - sT) < 25)) return false;
    // somewhere off the road you can actually drive onto: no wall, no building, no sea, not a cliff, no guard rail
    const sE = sT + c.dir * 8, side = c.dir, out = route.edge(sE) + ROAD.gutter + ROAD.sidewalk(route, sE, side);
    const lim = g.limits(sE, 1, {});
    if ((side > 0 ? lim.max : -lim.min) < out + 6) return false;
    const yR = route.surfaceY(sE, side * out);
    for (const du of [2, 5, 8]) {
      const p = route.point(sE, side * (out + du), _v), q = g.at(p.x, p.z, sE, side * (out + du), {});
      if (q.water > 0 || Math.abs(q.y - yR) > 1.2 || g.walls(p.x, p.z, 2.4, {})) return false;
    }
    this.quirkStart(c, n, { kind: 'turn', sTurn: sT, j: null, along: 0, uEnd: side * (out + 8), phase: 'in', t: 0 });
    return true;
  }
  /** swing off the road along a quarter turn, then park up out of the way (re-uses the cross-traffic path follower) */
  startExit(c, k) {
    const route = this.route, R = k.j ? 8 : 7, s0 = c.s, u0 = c.u, sE = s0 + c.dir * R;
    const uE = k.uEnd ?? c.dir * (route.edge(sE) + ROAD.gutter + ROAD.sidewalk(route, sE, c.dir) + 22);
    const P = [s0, u0, sE, u0, sE, uE];
    let len = 0; for (let i = 1, ps = P[0], pu = P[1]; i <= 12; i++) { const t = i / 12, a0 = (1 - t) * (1 - t), a1 = 2 * (1 - t) * t, a2 = t * t; const s = a0 * P[0] + a1 * P[2] + a2 * P[4], u = a0 * P[1] + a1 * P[3] + a2 * P[5]; len += Math.hypot(s - ps, u - pu); ps = s; pu = u; }
    const xyaw = c.dir > 0 ? 0 : Math.PI;
    c.task = null; c.evade = null; c.mode = 'cross'; c.hazard = false;
    Object.assign(c, { dir: 1, xyaw, xvs: Math.cos(xyaw) * c.v, xvu: 0, yawLC: 0 });
    c.cross = { j: k.j, side: Math.sign(uE), P, t: 0, len, mode: 'exit', dirT: 0, lane: 0, vT: k.j ? 6 : 4, blink: k.blink ? 1 : 0, honkT: 0 };
  }
  runTask(c, dt, n, gap, lv) {
    const k = c.task, d = c.drv;
    k.t += dt;
    const kerb = this.kerbU(c, c.s, c.kind === 'bus' ? 1.35 : 1.05);
    if ((k.kind === 'pull' || k.kind === 'turn') && k.phase === 'in') {
      const sGoal = k.kind === 'turn' ? k.sTurn : k.sStop, dStop = (sGoal - c.s) * c.dir;
      let acc = this.idm(c, c.v, c.v0, gap, lv);
      // indicate first, then move over to the kerb lane once there's a gap (the phone driver doesn't wait for either)
      if (k.sig > 0) { k.sig -= dt; if (dStop < 8) { c.task = null; c.blinkSide = 0; } return acc; }
      if (c.lane !== n - 1) {
        const u = this.laneUOf(c, c.s, n - 1), F = this.follow(c, u, c.wid * 0.5, 60);
        if (!F.o || F.gap > 6 + Math.max(0, F.fv - c.v) * 1.5) c.lane = n - 1;
        else if (dStop < c.v * c.v / 5 + 5) { c.task = null; c.blinkSide = 0; return acc; } // missed it: carry on
        c.uT = this.laneUOf(c, c.s); return acc;
      }
      const bk = k.rude ? 5.5 : 2.6;
      if (k.kind === 'turn') {
        c.uT = this.laneUOf(c, c.s) + c.dir * 0.4;
        const vT = k.j ? 5 : 3.5;
        if (c.v > vT) acc = Math.min(acc, (vT * vT - c.v * c.v) / (2 * Math.max(0.8, dStop)) * 1.1);
        acc = Math.max(acc, -bk * 1.2);
        if (dStop < 0.8) this.startExit(c, k);
        return acc;
      }
      c.uT = kerb;
      if (dStop < c.v * c.v / (2 * bk) + 2) acc = Math.min(acc, -c.v * c.v / (2 * Math.max(0.6, dStop)));
      else acc = Math.min(acc, this.idm(c, c.v, c.v0 * 0.75, dStop + 2, 0));
      if ((dStop < 1.5 || (c.v < 0.4 && dStop < 8)) && Math.abs(c.u - kerb) < 0.7) { k.phase = 'wait'; k.t = 0; k.dur = this.rng.range(5, 25); c.hazard = this.rng.chance(0.6); }
      if (dStop < -8) { k.phase = 'out'; k.t = 0; }
      return acc;
    }
    if (k.phase === 'in') {
      c.uT = kerb;
      const dStop = (k.sStop - c.s) * c.dir;
      // brake for the stop point (taxis: late and hard)
      const b = c.kind === 'taxi' ? 4.2 : c.kind === 'bus' ? 1.8 : 3;
      let acc = this.idm(c, c.v, c.v0, gap, lv);
      if (dStop < c.v * c.v / (2 * b) + 2) acc = Math.min(acc, -c.v * c.v / (2 * Math.max(0.6, dStop)));
      else acc = Math.min(acc, this.idm(c, c.v, c.v0 * 0.85, dStop + 2, 0));
      if ((dStop < 1.5 || (c.v < 0.4 && dStop < 6)) && Math.abs(c.u - kerb) < 0.6) { if (c.kind === 'bus') this.sounds.push({ kind: 'air', c }); k.phase = 'wait'; k.t = 0; k.dur = c.kind === 'bus' ? this.rng.range(6, 11) : k.kind === 'park' ? 1e9 : this.rng.range(4, 9); }
      if (dStop < -8) { k.phase = 'out'; k.t = 0; } // overshot: just carry on
      return acc;
    }
    if (k.phase === 'wait') {
      c.uT = kerb; c.v = 0;
      if (k.kind !== 'pull') c.hazard = c.kind !== 'bus';
      c.blinkSide = c.kind === 'bus' || c.hazard ? 0 : c.blinkSide;
      if (k.kind === 'park') { c.task = null; c.mode = 'parked'; c.parkT = this.rng.range(20, 80); c.hazard = false; c.blinkSide = 0; c.lastStop = this.t; return 0; }
      if (k.t > k.dur) { k.phase = 'out'; k.t = 0; c.hazard = false; c.blinkSide = -1; if (c.kind === 'bus') this.sounds.push({ kind: 'air', c }); }
      return -3;
    }
    // out: wait for a gap in the lane (buses and impatient taxis push out anyway after a moment)
    const lu = this.laneUOf(c, c.s, n - 1);
    const F = this.follow(c, lu, c.wid * 0.5, 70);
    const pushy = c.kind === 'bus' ? 1.8 : c.kind === 'taxi' ? 2.5 + 3 * (1 - d.agg) : 4;
    const ok = !F.o || F.gap > 10 + F.fv * 1.5 || (k.t > pushy && F.gap > 4 + F.fv * 0.5);
    if (!ok && Math.abs(c.u - kerb) < 0.3) { c.uT = kerb; return -2; }
    c.uT = lu;
    if (Math.abs(c.u - lu) < 0.35) { c.task = null; c.blinkSide = 0; c.lastStop = this.t; c.lane = n - 1; }
    return this.idm(c, c.v, c.v0, gap, lv);
  }

  /** nearest obstacle in the lane at lateral position u between s0 and s1 (any direction): {gap, v} (used by the racers' AI) */
  laneInfo(u, s0, s1, halfW = 1) {
    let best = 1e9, bv = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      const d = c.s - s0; if (d < -c.hs || d > s1 - s0) continue;
      if (Math.abs(c.u - u) > c.hu + halfW + 0.35) continue;
      const g = d - c.hs;
      if (g < best) { best = g; bv = c.crash || c.cross || c.mode === 'parked' ? 0 : c.dir * c.v; }
    }
    if (this.people) for (const p of this.people.onRoad) {
      const d = p.s - s0; if (d < -0.6 || d > s1 - s0) continue;
      if (Math.abs(p.u - u) > halfW + 0.9) continue;
      if (d - 1 < best) { best = Math.max(0, d - 1); bv = 0; }
    }
    for (const st of this.sites) {
      const d = st.s - st.len / 2 - s0; if (d < -st.len || d > s1 - s0) continue;
      if (Math.abs(st.u - u) > st.wid * 0.5 + halfW) continue;
      if (Math.max(0, d) < best) { best = Math.max(0, d); bv = 0; }
    }
    return { gap: best, v: bv };
  }

  // ---------------------------------------------------------------- beach parking: static rows of parked cars on the shoulders at the coves (Limanakia, Lomvarda)
  // parked cars from the map (tools/build_map.mjs): rows in the OSM car parks, and the summer line of cars on the
  // dirt shoulders and lay-bys of the coves. Each is also a solid obstacle for anyone who leaves the road.
  buildParkedRows(scene, ground) {
    const rng = new RNG(77), spots = this.data.parkSpots || [];
    this.parkedCars = [];
    if (!spots.length || this.route.closed) return;
    const types = TRAFFIC_TYPES.filter((t) => !t.scooter && !t.bus && !t.police && t.w > 0 && t.id !== 'van' && t.id !== 'truck');
    const totalWeight = types.reduce((sum, t) => sum + t.w, 0);
    const roots = [];
    for (const sp of spots) {
      if (ground.network?.sample(sp.x, sp.z)) continue; // leave mapped street mouths and carriageways clear
      let draw = rng.next() * totalWeight, t = types[0];
      for (const candidate of types) { draw -= candidate.w; if (draw <= 0) { t = candidate; break; } }
      const m = trafficModel(t, rng.pick(t.colors), rng, { parked: true });
      const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw), hl = t.len * 0.38;
      const q = this.route.project(sp.x, sp.z, null);
      const yF = ground.at(sp.x + fx * hl, sp.z + fz * hl, q.s, q.u, {}).y, yB = ground.at(sp.x - fx * hl, sp.z - fz * hl, q.s, q.u, {}).y;
      m.root.position.set(sp.x, (yF + yB) / 2 - 0.03, sp.z);
      m.root.rotation.set(Math.atan2(yF - yB, 2 * hl), sp.yaw, (rng.next() - 0.5) * (sp.d ? 0.05 : 0.01), 'YXZ');
      roots.push(m);
      this.parkedCars.push({ x: sp.x, z: sp.z, yaw: sp.yaw, hl: t.len / 2, hw: t.wid / 2 });
    }
    // bake them into a few static meshes (one per material per 300 m cell) so a whole beach of cars costs ~a dozen draw calls
    // spatial LOD cells (src/traffic-fleet.js: cheap merged shells far, detailed near cells built lazily); models from
    // before the catalogue routing have no makeNear(): the old static bake for those
    this.parkedGroup = roots.length && roots.every((m) => typeof m.makeNear === 'function') ? bakeParkedFleet(roots, 40) : bakeModels(roots, 300);
    scene.add(this.parkedGroup);
  }

  // ---- side-street cross traffic: goes on the main road's red, straight over or turning into the avenue
  updateCross(dt, ps, actors) {
    const sig = this.signals; if (!sig) return;
    if (!this.disabled) for (const j of sig.J) {
      if (Math.abs(j.s - ps) > 320 || !j.cross || j.left < 5.5) continue;
      for (const k of ['L', 'R']) {
        if (j.sides[k] === null) continue;
        j.spawnT[k] -= dt; if (j.spawnT[k] > 0) continue;
        j.spawnT[k] = this.rng.range(2.2, 4.4);
        this.spawnCross(j, k === 'R' ? 1 : -1);
      }
    }
    for (const c of this.cars) if (c.active && c.cross && !c.crash) this.moveCross(c, dt, actors);
  }

  spawnCross(j, side) {
    const rng = this.rng, route = this.route;
    for (const q of this.cars) if (q.active && q.cross && q.cross.j === j && q.cross.side === side && q.cross.t < 0.4) return;
    const c = this.cars.find((q) => !q.active && !q.type.bus && !q.police); if (!c) return;
    c.mode = 'cross'; c.hazard = false; c.blinkSide = 0; c.task = null; c.ovt = null; c.split = false; c.acc = 0; c.uv = 0; c.braking = false; this.repair(c); if (!c.drv) this.personality(c);
    const along = j.sides[side > 0 ? 'R' : 'L'] || 0;
    const u0 = side * (route.edge(j.s) + ROAD.gutter + 14);
    const other = j.sides[side > 0 ? 'L' : 'R'] !== null;
    const mode = other && rng.chance(0.45) ? 'straight' : rng.chance(0.55) ? 'far' : 'near';
    let P, dirT = 0, lane = 0;
    if (mode === 'straight') { const sP = j.s + along * 0.4 + side * 2.2; P = [sP, u0, sP, 0, sP, -u0]; }
    else {
      dirT = mode === 'near' ? side : -side;
      const nl = this.laneCount(j.s);
      lane = mode === 'near' ? nl - 1 : rng.int(0, nl - 1);
      const uT = dirT * route.laneU(j.s, lane), R = mode === 'near' ? 6 : 9, sP = j.s - dirT * 3 + along * 0.3;
      P = [sP, u0, sP, uT, sP + dirT * R, uT];
    }
    let len = 0; for (let i = 1, ps = P[0], pu = P[1]; i <= 12; i++) { const t = i / 12, a0 = (1 - t) * (1 - t), a1 = 2 * (1 - t) * t, a2 = t * t; const s = a0 * P[0] + a1 * P[2] + a2 * P[4], u = a0 * P[1] + a1 * P[3] + a2 * P[5]; len += Math.hypot(s - ps, u - pu); ps = s; pu = u; }
    Object.assign(c, {
      active: true, s: P[0], u: P[1], dir: 1, lane, v0: 11, v: 6, lcT: 0, lcCool: 3, toLane: lane, crash: null, pRel: 0, pMin: 99, pHitT: -9, yawLC: 0, wheel: 0, honked: false, sigJ: -1, sigGo: false,
      cross: { j, side, P, t: 0, len, mode, dirT, lane, vT: mode === 'straight' ? 11.5 : 8, blink: mode === 'near' ? 1 : mode === 'far' ? -1 : 0, honkT: 0 },
      xyaw: -side * Math.PI / 2, xvs: 0, xvu: -side * 6, hs: c.wid * 0.5, hu: c.len * 0.5,
    });
    c.m.root.visible = true;
  }

  moveCross(c, dt, actors) {
    const k = c.cross, P = k.P, t = k.t;
    const ds = 2 * (1 - t) * (P[2] - P[0]) + 2 * t * (P[4] - P[2]), du = 2 * (1 - t) * (P[3] - P[1]) + 2 * t * (P[5] - P[3]);
    const sp = Math.hypot(ds, du) || 1, hs = ds / sp, hu = du / sp;
    // yield to whatever is right in front (racers stopped in the box, queued cars, people on the zebra)
    // anything in our path (in our own heading frame) within a few metres of the bumper?
    const reach = c.len * 0.5 + 3.0, halfW = c.wid * 0.5 + 0.3;
    const inPath = (qs, qu, ehs, ehu) => {
      const ds = qs - c.s, du = qu - c.u, al = ds * hs + du * hu, lt = -ds * hu + du * hs;
      const eAl = Math.abs(hs) * ehs + Math.abs(hu) * ehu, eLt = Math.abs(hu) * ehs + Math.abs(hs) * ehu;
      return al + eAl > 0.3 && al - eAl < reach && Math.abs(lt) < halfW + eLt;
    };
    let block = null;
    for (const a of actors) if (inPath(a.veh.s, a.veh.u, a.veh.halfL, a.veh.halfW)) block = a;
    if (!block) for (const q of this.cars) if (q !== c && q.active && inPath(q.s, q.u, q.hs, q.hu)) { block = q; break; }
    if (!block && this.people) for (const p of this.people.onRoad) if (inPath(p.s, p.u, 0.4, 0.4)) { block = p; break; }
    const vT = block ? 0 : k.vT;
    c.v = vT < c.v ? Math.max(vT, c.v - 8 * dt) : Math.min(vT, c.v + 2.4 * dt);
    k.honkT -= dt;
    if (block && block.kind === 'player' && k.honkT <= 0) { k.honkT = 2.5; this.honks.push({ c, reason: 'blocking', player: true, long: false, kind: c.kind }); }
    k.t = Math.min(1, t + c.v * dt / sp);
    const T = k.t, a0 = (1 - T) * (1 - T), a1 = 2 * (1 - T) * T, a2 = T * T;
    c.s = a0 * P[0] + a1 * P[2] + a2 * P[4]; c.u = a0 * P[1] + a1 * P[3] + a2 * P[5];
    c.xyaw = Math.atan2(hu, hs); c.xvs = hs * c.v; c.xvu = hu * c.v;
    const ac = Math.abs(hs), as = Math.abs(hu);
    c.hs = c.len * 0.5 * ac + c.wid * 0.5 * as; c.hu = c.len * 0.5 * as + c.wid * 0.5 * ac;
    c.wheel += c.v * dt;
    const on = k.blink && Math.sin(this.t * 9.5) > 0 ? 3.5 : 0;
    c.indL.emissiveIntensity = k.blink < 0 ? on : 0; c.indR.emissiveIntensity = k.blink > 0 ? on : 0;
    if (k.t >= 1) {
      c.cross = null; c.indL.emissiveIntensity = c.indR.emissiveIntensity = 0;
      if (k.mode === 'straight') { c.active = false; c.m.root.visible = false; return; }
      if (k.mode === 'exit') { Object.assign(c, { s: P[4], u: P[5], v: 0, acc: 0, uv: 0, mode: 'parked', parkT: 1e9, yawLC: c.xyaw, hazard: false, blinkSide: 0, lane: 0 }); return; }
      Object.assign(c, { dir: k.dirT, lane: k.lane, s: P[4], u: P[5] });
      this.initDrive(c, false); c.v0 = this.roadSpeed(c.s) * c.drv.vf;
    }
  }

  // ---------------------------------------------------------------- crashes
  // Rigid bodies in the road plane (s along, u across; heading phi with forward = (cos phi, sin phi)). Contacts come from a
  // separating-axis test between oriented boxes; the impulse acts at the contact point, so an off-centre hit spins both
  // cars, with restitution e ~0.15 (crumple zones absorb most of the energy) and Coulomb friction across the contact.
  // A hit car then slides on its tyres (driver on the brakes, locked or not), can be tripped over a kerb, leaves the road
  // onto the pavement / shoulder / dirt and stops at guard rails, walls and buildings. Anything above a parking knock
  // leaves it wrecked: it stays there with its hazards on and the traffic slows down to look and goes around it.

  /** a traffic car as a rigid body */
  carBody(c, B = {}) {
    const k = c.crash, a = k ? k.yaw : c.cross ? c.xyaw : c.yawLC || 0;
    B.s = c.s; B.u = c.u; B.phi = a + (c.dir < 0 ? Math.PI : 0); B.hl = c.len * 0.5; B.hw = c.wid * 0.5;
    B.vs = k ? k.vs : c.cross ? c.xvs : c.mode === 'parked' ? 0 : c.dir * c.v; B.vu = k ? k.vu : c.cross ? c.xvu : c.mode === 'parked' ? 0 : c.uv || 0;
    B.w = k ? k.w : 0; B.m = c.mass; B.I = c.I;
    return B;
  }
  /** the physics vehicle as a rigid body (physics integrates yaw -= w dt, so w is already d(phi)/dt) */
  vehBody(veh, rv, mScale = 1, B = {}) {
    const ry = Math.atan2(-this.route.lin(this.route.TX, veh.s), -this.route.lin(this.route.TZ, veh.s));
    B.s = veh.s; B.u = veh.u; B.phi = ry - veh.yaw; B.hl = veh.halfL; B.hw = veh.halfW;
    B.vs = rv.vs; B.vu = rv.vu; B.w = veh.w; B.m = veh.m * mScale; B.I = (veh.Iz || veh.m * 1.6) * 1.15 * mScale;
    return B;
  }
  /** apply a crash impulse to a traffic car: (re)enter the crash state; a real hit wrecks it */
  hitCar(c, B, dv, zone, now, impact = {}) {
    const big = dv > (c.type.scooter ? 1.2 : 2.4);
    if (!c.crash) {
      c.crash = { t: 0, vs: 0, vu: 0, w: 0, yaw: c.cross ? c.xyaw : c.yawLC || 0, y: 0, vy: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, brake: 0, wreck: false, gy: 0, onSide: false };
      if (c.cross) { c.cross = null; c.dir = 1; }
      c.mode = 'drive'; c.task = null; c.evade = null; c.ovt = null; c.lcT = 0; c.flash.emissiveIntensity = 0;
    }
    const k = c.crash;
    k.vs = B.vs; k.vu = B.vu; k.w = B.w; k.yaw = B.phi - (c.dir < 0 ? Math.PI : 0);
    k.t = Math.min(k.t, 0.5); k.rec = 0;
    c.dmg += dv;
    if (big || c.dmg > 4) k.wreck = true;
    // the car's own suspension takes a jolt (pitch from a front / rear hit, roll from a side hit)
    const sideHit = zone === 'left' || zone === 'right';
    if (sideHit) k.rollV += (zone === 'left' ? 1 : -1) * Math.min(2.5, dv * 0.25); else k.pitchV += (zone === 'front' ? -1 : 1) * Math.min(2, dv * 0.2);
    // a hard hit lifts the struck end a little; only a scooter really leaves the ground
    if (c.type.scooter) k.vy = Math.max(k.vy, Math.min(3, dv * 0.25));
    else if (dv > 9) k.vy = Math.max(k.vy, Math.min(1.6, (dv - 9) * 0.15));
    this.damageCar(c, zone, dv, impact);
    void now;
  }

  /** Cosmetic damage also applies when a police driver rides out an impact without entering crash mode. */
  damageCar(c, zone, dv, impact = {}) {
    if (!(dv > 0)) return;
    const ebs = impact.ebs ?? dv;
    const inc = damageIncrement(ebs, zone);
    if (!(inc > 0)) return;
    c.dz = c.dz || { front: 0, rear: 0, left: 0, right: 0 };
    if (!(zone in c.dz)) return;
    c.dz[zone] = Math.min(1, c.dz[zone] + inc);
    c.m.setDamage?.(zone, c.dz[zone], { ...impact, ebs, cheap: true });
  }

  /** collide a physics vehicle against all traffic and cones; returns events */
  collide(actor, events, now) {
    const veh = actor.veh, route = this.route;
    const ex = extents(veh, route);
    let rv = null;
    const A = this._A || (this._A = {}), B = this._B || (this._B = {});
    for (const c of this.cars) {
      if (!c.active) continue;
      const ds = c.s - veh.s; if (Math.abs(ds) > 14) { if (actor.kind === 'player') c.pRel = Math.sign(ds); continue; }
      const du = c.u - veh.u;
      const cyaw = c.crash ? c.crash.yaw : c.cross ? c.xyaw : 0, cc = Math.abs(Math.cos(cyaw)), cs = Math.abs(Math.sin(cyaw));
      const cvs = c.crash ? c.crash.vs : c.cross ? c.xvs : c.dir * c.v, cvu = c.crash ? c.crash.vu : c.cross ? c.xvu : 0;
      const chs = c.len * 0.5 * cc + c.wid * 0.5 * cs, chu = c.len * 0.5 * cs + c.wid * 0.5 * cc;
      const ox = ex.hs + chs - Math.abs(ds), oy = ex.hu + chu - Math.abs(du);
      // near-miss bookkeeping (player only)
      if (actor.kind === 'player') {
        if (ox > -1.5) c.pMin = Math.min(c.pMin, -oy);
        const rel = Math.sign(ds) || 1;
        if (c.pRel && rel !== c.pRel && !c.crash) {
          if (now - c.pHitT > 1.5 && c.pMin > 0 && c.pMin < 1.25) {
            if (!rv) rv = routeVel(veh, route);
            const relV = Math.hypot(rv.vs - cvs, rv.vu - cvu);
            if (relV > 8) events.push({ kind: 'near', car: c, clearance: c.pMin, oncoming: c.dir * this.dir < 0, rel: relV, side: Math.sign(du) });
          }
          c.pMin = 99;
        }
        if (Math.abs(ds) > ex.hs + chs + 1.5) c.pMin = 99;
        c.pRel = rel;
      }
      if (ox <= -0.3 || oy <= -0.3 || (c.crash && c.crash.y > 1.2)) continue;
      if (!rv) rv = routeVel(veh, route);
      this.vehBody(veh, rv, actor.kind === 'rival' ? 2.5 : 1, A); // the rival shoulders his way through
      this.carBody(c, B);
      const ct = obbContact(A, B); if (!ct) continue;
      const vs0 = A.vs, vu0 = A.vu;
      const r = impulse(A, B, ct, c.crash && c.crash.onSide ? 0.05 : 0.15, 0.45);
      const impactA = localImpact(A, ct, -1), impactB = localImpact(B, ct, 1);
      impactB.ebs = equivalentBarrierSpeed(r.vn, B.m, A.m);
      // separate them (by inverse mass), then write the bodies back
      const ia = 1 / A.m, ib = 1 / B.m, sh = (ct.ov + 0.01) / (ia + ib);
      pushVeh(veh, rv.f, -ct.ns * sh * ia, -ct.nu * sh * ia);
      rv.vs = A.vs; rv.vu = A.vu;
      setRouteVel(veh, rv.f, rv.vs, rv.vu);
      veh.w = A.w;
      c.s += ct.ns * sh * ib; c.u += ct.nu * sh * ib;
      if (r.j <= 0) continue; // touching or already separating: no impulse
      const dvA = Math.hypot(A.vs - vs0, A.vu - vu0), dvB = r.dvB;
      if (c.cop && c.cop.chase && !c.crash && dvB < 3) { c.v = Math.max(0, c.dir * B.vs); c.uv = B.vu; this.damageCar(c, zoneOf(B, ct.ps, ct.pu), dvB, impactB); } // a police driver rides out a PIT / ram contact
      else if (dvB > 0.35 || c.crash) this.hitCar(c, B, dvB, zoneOf(B, ct.ps, ct.pu), now, impactB);
      else if (c.mode !== 'parked') { c.v = Math.max(0, c.dir * B.vs); c.shakenT = 2; } // a nudge: brake, glare
      if (actor.kind === 'player') c.pHitT = now;
      const sev = r.vn;
      if (sev > 0.5) events.push({ kind: sev > 11 ? 'crash' : sev > 4 ? 'bump' : 'scrape', sev, car: c, who: actor.kind, side: Math.sign(du), heavy: c.mass > 3000 || sev > 16, oncoming: c.dir * this.dir < 0, zone: zoneOf(A, ct.ps, ct.pu), dv: dvA, dvCar: dvB, ...impactA });
    }
    // cones
    for (const k of this.cones) {
      const ds = k.s - veh.s; if (Math.abs(ds) > ex.hs + 0.3) continue;
      const du = k.u - veh.u; if (Math.abs(du) > ex.hu + 0.25 || k.y > 0.6) continue;
      if (!rv) rv = routeVel(veh, route);
      const sp = Math.max(4, rv.vs);
      k.vs = sp * (1.05 + Math.random() * 0.4); k.vu = rv.vu + Math.sign(du || 1) * (2 + Math.random() * sp * 0.25); k.vy = 2.5 + Math.random() * sp * 0.18;
      k.w = (Math.random() - 0.5) * 20; k.hit = true;
      rv.vs *= 0.985; setRouteVel(veh, rv.f, rv.vs, rv.vu);
      events.push({ kind: 'cone', who: actor.kind, sev: sp });
    }
  }

  /** a chasing police car driving into traffic (it is kinematic, like all drivers): a real impact, maybe a crash */
  bumpCheck(c) {
    const A = this.carBody(c, this._PA || (this._PA = {})), B = this._PB || (this._PB = {});
    for (const q of this.cars) {
      if (q === c || !q.active || Math.abs(q.s - c.s) > 10 || Math.abs(q.u - c.u) > 6) continue;
      this.carBody(q, B);
      const ct = obbContact(A, B); if (!ct) continue;
      const vA0s = A.vs, vA0u = A.vu;
      const r = impulse(A, B, ct, 0.15, 0.45);
      const zoneA = zoneOf(A, ct.ps, ct.pu), zoneB = zoneOf(B, ct.ps, ct.pu);
      const impactA = localImpact(A, ct, -1), impactB = localImpact(B, ct, 1);
      impactA.ebs = equivalentBarrierSpeed(r.vn, A.m, B.m); impactB.ebs = equivalentBarrierSpeed(r.vn, B.m, A.m);
      const ia = 1 / A.m, ib = 1 / B.m, sh = (ct.ov + 0.01) / (ia + ib);
      c.s -= ct.ns * sh * ia; c.u -= ct.nu * sh * ia; A.s = c.s; A.u = c.u;
      q.s += ct.ns * sh * ib; q.u += ct.nu * sh * ib;
      if (r.j <= 0) continue;
      const dvA = Math.hypot(A.vs - vA0s, A.vu - vA0u);
      if (r.dvB > 0.35 || q.crash) this.hitCar(q, B, r.dvB, zoneB, this.t, impactB);
      if (dvA > 4) { this.hitCar(c, A, dvA, zoneA, this.t, impactA); return; }
      this.damageCar(c, zoneA, dvA, impactA);
      c.v = Math.max(0, A.vs * c.dir); c.uv = A.vu;
      if (r.vn > 3) this.sounds.push({ kind: 'crunch', c: q, sev: r.vn });
    }
  }

  /** a crashed car sliding into other traffic: pile-ups */
  chainCollide(c) {
    const A = this.carBody(c, this._CA || (this._CA = {})), B = this._CB || (this._CB = {});
    if (Math.hypot(A.vs, A.vu) < 0.4 && Math.abs(A.w) < 0.2) return;
    for (const q of this.cars) {
      if (q === c || !q.active || Math.abs(q.s - c.s) > 10 || Math.abs(q.u - c.u) > 8) continue;
      this.carBody(q, B);
      const ct = obbContact(A, B); if (!ct) continue;
      const vA0s = A.vs, vA0u = A.vu;
      const r = impulse(A, B, ct, 0.15, 0.45);
      const zoneA = zoneOf(A, ct.ps, ct.pu), zoneB = zoneOf(B, ct.ps, ct.pu);
      const impactA = localImpact(A, ct, -1), impactB = localImpact(B, ct, 1);
      impactA.ebs = equivalentBarrierSpeed(r.vn, A.m, B.m); impactB.ebs = equivalentBarrierSpeed(r.vn, B.m, A.m);
      const ia = 1 / A.m, ib = 1 / B.m, sh = (ct.ov + 0.01) / (ia + ib);
      c.s -= ct.ns * sh * ia; c.u -= ct.nu * sh * ia; A.s = c.s; A.u = c.u;
      q.s += ct.ns * sh * ib; q.u += ct.nu * sh * ib;
      const k = c.crash; k.vs = A.vs; k.vu = A.vu; k.w = A.w;
      if (r.j > 0 && (r.dvB > 0.35 || q.crash)) {
        this.hitCar(q, B, r.dvB, zoneB, this.t, impactB);
        if (r.vn > 3) this.sounds.push({ kind: 'crunch', c: q, sev: r.vn });
      }
      if (r.j > 0) this.damageCar(c, zoneA, Math.hypot(A.vs - vA0s, A.vu - vA0u), impactA);
    }
  }

  updateCrashed(c, dt) {
    const k = c.crash, route = this.route, g = this.ground;
    k.t += dt;
    const phi = k.yaw + (c.dir < 0 ? Math.PI : 0), fs = Math.cos(phi), fu = Math.sin(phi), rs = -fu, ru = fs;
    const onSide = Math.abs(k.roll) > 1.1;
    // ---- ground under the car
    const au = Math.abs(c.u), eA = route.edge(c.s) + ROAD.gutter;
    let mu = 0.9, drag = 0, gy = 0, water = 0;
    if (g && au > eA - 0.2) {
      const p = route.point(c.s, c.u, _v), q = g.at(p.x, p.z, c.s, c.u, this._gq || (this._gq = {}));
      const S = SURF[q.surf] || SURF.asphalt; mu = 0.9 * S.mu; drag = S.drag; water = q.water;
      gy = q.y - route.surfaceY(c.s, c.u);
    } else if (au > eA) { mu = 0.7; drag = 0.6; }
    k.gy += (gy - k.gy) * Math.min(1, dt * 12);
    // ---- tyres: two axles; the driver is on the brakes after ~0.4 s (ABS: close to peak grip; scooters just slide)
    k.brake = Math.min(1, k.brake + dt * (k.t > 0.4 ? 3 : 0));
    const m = c.mass, gN = m * 9.81 * 0.5;
    let Fs = 0, Fu = 0, T = 0;
    if (k.y <= 0.02) {
      if (onSide || (c.type.scooter && Math.abs(k.roll) > 0.6)) {
        // sliding on the body: friction against the velocity of each end
        for (const x of [c.len * 0.3, -c.len * 0.3]) {
          const vs = k.vs - k.w * x * fu, vu = k.vu + k.w * x * fs, sp = Math.hypot(vs, vu);
          if (sp < 1e-3) continue;
          const F = Math.min(0.55 * gN, (m * 0.5) * sp / dt);
          const fx = -vs / sp * F, fy = -vu / sp * F;
          Fs += fx; Fu += fy; T += x * (fy * fs - fx * fu);
        }
      } else {
        for (const x of [c.len * 0.32, -c.len * 0.32]) {
          // contact-patch velocity in the car's frame
          const vs = k.vs - k.w * x * fu, vu = k.vu + k.w * x * fs;
          const vl = vs * fs + vu * fu, vt = vs * rs + vu * ru;
          const cap = mu * gN;
          let Fl = -Math.sign(vl) * Math.min(lerp(0.08, 0.8, k.brake) * cap + drag * m * 0.5, (m * 0.5) * Math.abs(vl) / dt);
          let Ft = -Math.sign(vt) * Math.min(cap * Math.min(1, Math.abs(vt) / 0.5), (m * 0.5) * Math.abs(vt) / dt);
          const F = Math.hypot(Fl, Ft); if (F > cap) { Fl *= cap / F; Ft *= cap / F; }
          const fx = Fl * fs + Ft * rs, fy = Fl * fu + Ft * ru;
          Fs += fx; Fu += fy; T += x * Ft;
          // sliding sideways into a kerb or soft ground trips the car over its wheels
          if (Math.abs(vt) > 6.5 && (drag > 0.5 || (au > eA - 0.3 && au < eA + 0.3))) k.rollV += -Math.sign(vt) * (Math.abs(vt) - 6.5) * 0.9 * dt * 4;
        }
      }
      if (water > 0) { Fs -= k.vs * m * 2; Fu -= k.vu * m * 2; T -= k.w * c.I * 2; }
    }
    k.vs += Fs / m * dt; k.vu += Fu / m * dt; k.w += T / c.I * dt;
    if (!Number.isFinite(k.vs + k.vu + k.w + k.yaw + c.s + c.u)) { k.vs = k.vu = k.w = 0; if (!Number.isFinite(k.yaw)) k.yaw = 0; if (!Number.isFinite(c.s + c.u)) { c.active = false; c.m.root.visible = false; return; } }
    if (Math.hypot(k.vs, k.vu) < 0.08 && Math.abs(k.w) < 0.08) { k.vs = k.vu = k.w = 0; }
    c.s += k.vs * dt; c.u += k.vu * dt; k.yaw += k.w * dt;
    // ---- vertical, pitch and roll: suspension near level; past ~10 deg the car pivots on its wheels' edge, and past the
    // tipping angle (track / 2 vs centre-of-gravity height) gravity takes it over onto its side
    k.vy -= 9.81 * dt; k.y += k.vy * dt;
    if (k.y < 0) { k.y = 0; if (k.vy < -1.6) { k.vy = -k.vy * 0.25; k.w *= 0.8; } else k.vy = 0; }
    const tip = c.type.scooter ? 0.08 : Math.atan2(c.wid * 0.5, c.type.bus ? 1.4 : 0.6), ar = Math.abs(k.roll), sg = Math.sign(k.roll) || 1;
    if (ar < 0.12) k.rollV += (-k.roll * 40 - k.rollV * 4) * dt;
    else if (ar < Math.PI / 2) k.rollV += (sg * 9.81 / Math.max(0.4, c.wid * 0.6) * Math.sin(ar - tip) - k.rollV * 0.6) * dt;
    k.roll += k.rollV * dt;
    if (Math.abs(k.roll) > Math.PI / 2) { k.roll = sg * Math.PI / 2; k.rollV = -k.rollV * 0.2; if (Math.abs(k.rollV) < 0.4) k.rollV = 0; this.sounds.push({ kind: 'crunch', c, sev: 6 }); }
    if (Math.abs(k.roll) > 1.1) { k.onSide = true; k.wreck = true; }
    k.pitchV += (-k.pitch * 40 - k.pitchV * 4) * dt; k.pitch += k.pitchV * dt;
    // ---- hard limits: guard rails, the median, walls and buildings (impulse at the corner that hits)
    const hu = Math.abs(Math.sin(k.yaw)) * c.len * 0.5 + Math.abs(Math.cos(k.yaw)) * c.wid * 0.5;
    let lo = -1e9, hi = 1e9;
    if (g) { const L = g.limits(c.s, 0, this._gl || (this._gl = {})); hi = L.max - hu; lo = L.min + hu; }
    else { const lim = route.edge(c.s) + ROAD.gutter - hu; hi = lim; lo = -lim; }
    if (route.div(c.s) > 0.45) { const mh = route.medHalf(c.s) + hu * 0.9; if (c.u > 0 && c.u < mh) lo = mh; else if (c.u < 0 && c.u > -mh) hi = -mh; }
    if (c.u > hi) { c.u = hi; this.wallHit(c, 0, -1); } else if (c.u < lo) { c.u = lo; this.wallHit(c, 0, 1); }
    if (g) {
      const p = route.point(c.s, c.u, _v), f = route.frame(c.s, this._cf || (this._cf = {}));
      for (const x of [c.len * 0.5 - c.wid * 0.5, -(c.len * 0.5 - c.wid * 0.5)]) {
        const wx = p.x + (f.tx * fs + f.rx * fu) * x, wz = p.z + (f.tz * fs + f.rz * fu) * x;
        const h = g.walls(wx, wz, c.wid * 0.5, this._gw || (this._gw = {}));
        if (h) {
          const ns = h.nx * f.tx + h.nz * f.tz, nu = h.nx * f.rx + h.nz * f.rz;
          c.s += ns * h.pen; c.u += nu * h.pen;
          this.wallHit(c, ns, nu, x);
        }
      }
    }
    if (Math.hypot(k.vs, k.vu) > 1 || Math.abs(k.w) > 0.5) this.chainCollide(c);
    c.v = 0; c.wheel += (k.vs * fs + k.vu * fu) * dt * (1 - k.brake * 0.9);
    // hazard lights once the driver collects themself
    const blink = Math.sin(this.t * 7) > 0 && k.t > 1.2 ? 3.5 : 0;
    c.indL.emissiveIntensity = blink; c.indR.emissiveIntensity = blink;
    c.braking = true;
    if (k.wreck) return; // stays where it ended up
    // a light knock: the driver stops, has a moment (and a go at you on the horn), then carries on
    if (k.t > 3 && k.y <= 0.01 && Math.hypot(k.vs, k.vu) < 0.6 && Math.abs(k.roll) < 0.15) {
      k.rec = (k.rec || 0) + dt;
      if (k.rec > 0.3 && !k.honked) { k.honked = true; c.honkCool = 0; this.honk(c, 'angry', true); }
      const dir = c.u >= 0 ? 1 : -1, n = this.laneCount(c.s);
      let lane = 0, bd = 1e9; for (let l = 0; l < n; l++) { const d = Math.abs(route.laneU(c.s, l) * dir - c.u); if (d < bd) { bd = d; lane = l; } }
      let yw = wrapPi(k.yaw);
      if (dir !== c.dir) { c.dir = dir; yw += Math.PI; if (yw > Math.PI) yw -= Math.PI * 2; } // turned around: just drive this way now
      if (Math.abs(yw) > 0.9 || Math.abs(c.u) > route.edge(c.s) + 0.5) { k.wreck = true; return; } // facing the wrong way / off the road: they're not going anywhere
      if (k.rec > 2.5) {
        k.yaw = yw * Math.exp(-2.5 * dt); c.u += (route.laneU(c.s, lane) * dir - c.u) * Math.min(1, dt * 1.2);
        if (Math.abs(k.yaw) < 0.06) { c.crash = null; c.lane = lane; this.initDrive(c); c.v = 1.5; c.indL.emissiveIntensity = c.indR.emissiveIntensity = 0; }
      } else k.yaw = yw;
    }
  }
  /** a crashed car against something immovable, outward normal (ns, nu), at body offset x along the car */
  wallHit(c, ns, nu, x = null) {
    const k = c.crash;
    if (!ns && !nu) return;
    const phi = k.yaw + (c.dir < 0 ? Math.PI : 0), fs = Math.cos(phi), fu = Math.sin(phi);
    // contact point: the given end, or the corner that reaches furthest against the normal
    let rs, ru;
    if (x !== null) { rs = fs * x; ru = fu * x; }
    else {
      const hl = c.len * 0.5, hw = c.wid * 0.5, a = Math.sign(-(fs * ns + fu * nu)) || 1, b = Math.sign(-(-fu * ns + fs * nu)) || 1;
      rs = fs * hl * a - fu * hw * b; ru = fu * hl * a + fs * hw * b;
    }
    const vps = k.vs - k.w * ru, vpu = k.vu + k.w * rs, vn = vps * ns + vpu * nu;
    if (vn >= 0) return;
    const rn = rs * nu - ru * ns, j = -(1 + 0.1) * vn / (1 / c.mass + rn * rn / c.I);
    k.vs += j * ns / c.mass; k.vu += j * nu / c.mass; k.w += rn * j / c.I;
    // scraping along it
    const ts = -nu, tu = ns, vt = vps * ts + vpu * tu, rt = rs * tu - ru * ts;
    const jt = clamp(-vt / (1 / c.mass + rt * rt / c.I), -0.4 * j, 0.4 * j);
    k.vs += jt * ts / c.mass; k.vu += jt * tu / c.mass; k.w += rt * jt / c.I;
    // Capsule wall tests report the end-cap centre; place the dent on its contacted skin.
    const contactRadius = x === null ? 0 : c.wid * 0.5;
    const B = this.carBody(c, {}), ct = { ps: c.s + rs - ns * contactRadius, pu: c.u + ru - nu * contactRadius, ns, nu };
    this.damageCar(c, zoneOf(B, ct.ps, ct.pu), -vn, { ...localImpact(B, ct, 1), ebs: -vn });
    if (-vn > 2) { c.dmg += -vn * 0.5; if (-vn > 4) k.wreck = true; this.sounds.push({ kind: 'crunch', c, sev: -vn }); }
  }

  launch(c, vs, vu, closing) { // kept for callers outside traffic.js: shove a car with a given velocity
    const B = this.carBody(c, {}); B.vs = vs; B.vu = vu;
    this.hitCar(c, B, closing * 0.5, 'front', this.t);
  }

  updateCones(dt) {
    const route = this.route, m = this.coneMesh;
    this.cones.forEach((k, i) => {
      if (k.hit) {
        k.vy -= 9.81 * dt; k.s += k.vs * dt; k.u += k.vu * dt; k.y += k.vy * dt; k.rx += k.w * dt; k.rz += k.w * 0.6 * dt;
        if (k.y < 0) { k.y = 0; k.vy = Math.abs(k.vy) > 1.5 ? -k.vy * 0.35 : 0; k.vs *= 0.6; k.vu *= 0.6; k.w *= 0.6; if (Math.abs(k.vs) < 0.3 && k.vy === 0) { k.rx = Math.PI / 2 * Math.sign(k.rx || 1); k.w = 0; } }
      }
      route.point(k.s, k.u, this._p); this._p.y += k.y;
      this._e.set(k.rx, route.heading(k.s), k.rz, 'YXZ'); this._q.setFromEuler(this._e);
      this._m.compose(this._p, this._q, this._s); m.setMatrixAt(i, this._m);
    });
    m.instanceMatrix.needsUpdate = true;
  }

  /** place the visual models */
  sync(ps) {
    const route = this.route, f = {};
    for (const c of this.cars) {
      if (!c.active) { c.m.updateDamage?.(this.dtLast || 0.016); continue; }
      const vis = Math.abs(c.s - ps) < (this.drawRange || 650); // main.js: from the render distance
      c.m.root.visible = vis; if (!vis) { c.m.updateDamage?.(this.dtLast || 0.016); continue; }
      c.m.setLOD?.(Math.abs(c.s - ps)); // detail by distance (src/cars.js)
      route.frame(c.s, f);
      route.point(c.s, c.u, _v);
      const k = c.crash;
      // a car on its side rests on the edge of the body: lift by half its width
      c.m.root.position.set(_v.x, _v.y + (k ? k.y + k.gy + c.wid * 0.5 * Math.max(0, Math.abs(Math.sin(k.roll)) - 0.1) : 0), _v.z);
      const ry = Math.atan2(-f.tx, -f.tz) + (c.dir < 0 ? Math.PI : 0);
      const yaw = ry - (k ? k.yaw : c.cross ? c.xyaw : c.yawLC);
      // brake dive / squat and a little lean on scooters
      const pitch = k ? k.pitch : clamp((c.acc || 0) * (c.type.scooter ? 0.004 : 0.006), -0.035, 0.02);
      const lean = c.type.scooter && !k ? clamp(-(c.uv || 0) * 0.12 * c.dir, -0.3, 0.3) : 0;
      c.m.root.rotation.set(Math.atan(f.grade) * c.dir + (k ? 0 : 0), yaw, Math.atan(f.bank) * c.dir + (k ? k.roll : lean), 'YXZ');
      c.m.body.rotation.x = pitch;
      // front wheels steer: wheelbase x path curvature (the road's plus our own lane-change arc)
      if (!k && !c.type.scooter) {
        const curv = c.cross ? 0 : route.curv(c.s) * c.dir + (c.v > 1 ? ((c.yawLC || 0) - (c.yawLCp ?? c.yawLC ?? 0)) / Math.max(1e-3, this.dtLast || 0.016) / c.v : 0);
        c.yawLCp = c.yawLC;
        c.steerA = lerp(c.steerA || 0, clamp(curv * c.len * 0.6, -0.55, 0.55), 0.2);
      } else if (k) c.steerA = (c.steerA || 0) * 0.98;
      for (const w of c.m.wheels) {
        w.spin.rotation.x = -c.wheel / (w.r || 0.3);
        if (w.front && w.pivot && w.pivot !== w.spin) w.pivot.rotation.y = -(c.steerA || 0);
      }
      c.m.tail.emissiveIntensity = !k && c.braking ? 7 : 1.4;
      c.m.updateDamage?.(this.dtLast || 0.016);
    }
  }
}

/** merge many traffic models into static meshes; paint goes to one vertex-coloured material */
function bakeModels(models, cell) {
  const buckets = new Map(), group = new THREE.Group();
  const msig = (m) => [m.type, m.color?.getHexString(), m.emissive?.getHexString(), m.emissiveIntensity, m.roughness, m.metalness, m.map?.uuid, m.transparent, m.opacity].join('|');
  const ctr = new THREE.Vector3();
  let paintMat = null;
  for (const md of models) {
    md.root.updateMatrixWorld(true);
    md.root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g = o.geometry;
      const groups = Array.isArray(o.material) ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const m = mats[gr.materialIndex];
        let sub = g.index ? new THREE.BufferGeometry() : g.clone();
        if (g.index) { for (const k in g.attributes) sub.setAttribute(k, g.attributes[k]); sub.setIndex(Array.from(g.index.array.slice(gr.start, gr.start + gr.count))); }
        sub = sub.toNonIndexed();
        sub.applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(sub.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'uv' && m.map)) sub.deleteAttribute(k);
        if (!sub.attributes.normal) sub.computeVertexNormals();
        const isPaint = m === md.paint;
        if (isPaint) {
          const c = m.color, n = sub.attributes.position.count, col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
          sub.setAttribute('color', new THREE.BufferAttribute(col, 3));
          if (!paintMat) { paintMat = m.clone(); paintMat.color.set('#ffffff'); paintMat.vertexColors = true; }
        }
        sub.computeBoundingSphere(); ctr.copy(sub.boundingSphere.center);
        const key = (isPaint ? 'paint' : msig(m)) + '#' + Object.keys(sub.attributes).sort().join(',') + '#' + Math.floor(ctr.x / cell) + ',' + Math.floor(ctr.z / cell);
        let b = buckets.get(key); if (!b) { b = { mat: isPaint ? paintMat : m, geos: [], shadow: !!o.castShadow }; buckets.set(key, b); }
        b.geos.push(sub);
      }
    });
  }
  for (const b of buckets.values()) {
    const g = mergeGeometries(b.geos, false); if (!g) continue;
    const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.shadow && !b.mat.transparent; mesh.receiveShadow = !b.mat.transparent;
    g.computeBoundingSphere(); mesh.userData.far = 900; group.add(mesh);
  }
  return group;
}

/** angle into (-pi, pi]; safe for huge / non-finite input (a while loop on Infinity never ends) */
function wrapPi(a) { if (!Number.isFinite(a)) return 0; a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }

// ---------------------------------------------------------------- rigid-body contact helpers (road plane: s, u)
/** Contact in model coordinates (x right, -z forward); sign selects the inward impulse, -1 for A, +1 for B. */
export function localImpact(B, ct, sign = 1) {
  const fs = Math.cos(B.phi), fu = Math.sin(B.phi), ds = ct.ps - B.s, du = ct.pu - B.u;
  return {
    localPoint: { x: -fu * ds + fs * du, y: 0.55, z: -fs * ds - fu * du },
    localNormal: { x: sign * (-fu * ct.ns + fs * ct.nu), y: 0, z: -sign * (fs * ct.ns + fu * ct.nu) },
  };
}

/** separating-axis contact between two oriented boxes {s,u,phi,hl,hw}: normal (A -> B), overlap, contact point */
function obbContact(A, B) {
  const ax = [Math.cos(A.phi), Math.sin(A.phi)], ay = [-ax[1], ax[0]], bx = [Math.cos(B.phi), Math.sin(B.phi)], by = [-bx[1], bx[0]];
  const ds = B.s - A.s, du = B.u - A.u;
  let best = 1e9, ns = 0, nu = 0, own = 0;
  const axes = [ax, ay, bx, by];
  for (let i = 0; i < 4; i++) {
    const n = axes[i];
    const ra = A.hl * Math.abs(ax[0] * n[0] + ax[1] * n[1]) + A.hw * Math.abs(ay[0] * n[0] + ay[1] * n[1]);
    const rb = B.hl * Math.abs(bx[0] * n[0] + bx[1] * n[1]) + B.hw * Math.abs(by[0] * n[0] + by[1] * n[1]);
    const d = ds * n[0] + du * n[1], ov = ra + rb - Math.abs(d);
    if (ov <= 0) return null;
    if (ov < best - 1e-4) { best = ov; const sg = d < 0 ? -1 : 1; ns = n[0] * sg; nu = n[1] * sg; own = i < 2 ? 0 : 1; }
  }
  // contact point: the deepest feature of the incident box (edges that are nearly parallel count as their middle),
  // clamped to the stretch where the two boxes overlap along the contact face
  const sup = (C, cx, cy, sgn) => {
    const px = cx[0] * ns + cx[1] * nu, py = cy[0] * ns + cy[1] * nu;
    const kx = Math.abs(px) < 0.2 ? 0 : Math.sign(px) * sgn, ky = Math.abs(py) < 0.2 ? 0 : Math.sign(py) * sgn;
    return [C.s + cx[0] * C.hl * kx + cy[0] * C.hw * ky, C.u + cx[1] * C.hl * kx + cy[1] * C.hw * ky];
  };
  const p = own === 0 ? sup(B, bx, by, -1) : sup(A, ax, ay, 1);
  const ts = -nu, tu = ns;
  const ext = (C, cx, cy) => C.hl * Math.abs(cx[0] * ts + cx[1] * tu) + C.hw * Math.abs(cy[0] * ts + cy[1] * tu);
  const at = A.s * ts + A.u * tu, bt = B.s * ts + B.u * tu, ea = ext(A, ax, ay), eb = ext(B, bx, by);
  const lo = Math.max(at - ea, bt - eb), hi = Math.min(at + ea, bt + eb);
  const pt = clamp(p[0] * ts + p[1] * tu, Math.min(lo, hi), Math.max(lo, hi));
  // along the normal: halfway between A's face and B's face
  const ra = A.hl * Math.abs(ax[0] * ns + ax[1] * nu) + A.hw * Math.abs(ay[0] * ns + ay[1] * nu);
  const pn = (A.s * ns + A.u * nu) + ra - best * 0.5;
  return { ns, nu, ov: best, ps: ns * pn + ts * pt, pu: nu * pn + tu * pt };
}
/** impulse at the contact point with restitution e and friction mu; updates A and B; returns {j, vn (closing), dvB} */
function impulse(A, B, ct, e, mu) {
  const ras = ct.ps - A.s, rau = ct.pu - A.u, rbs = ct.ps - B.s, rbu = ct.pu - B.u;
  // point velocities (w x r = w (-r_u, r_s))
  const vrs = (B.vs - B.w * rbu) - (A.vs - A.w * rau), vru = (B.vu + B.w * rbs) - (A.vu + A.w * ras);
  const vn = vrs * ct.ns + vru * ct.nu;
  if (vn >= 0) return { j: 0, vn: 0, dvB: 0 };
  const ia = 1 / A.m, ib = 1 / B.m, Ia = 1 / A.I, Ib = 1 / B.I;
  const ran = ras * ct.nu - rau * ct.ns, rbn = rbs * ct.nu - rbu * ct.ns;
  const j = -(1 + e) * vn / (ia + ib + ran * ran * Ia + rbn * rbn * Ib);
  const vbs = B.vs, vbu = B.vu;
  A.vs -= j * ct.ns * ia; A.vu -= j * ct.nu * ia; A.w -= ran * j * Ia;
  B.vs += j * ct.ns * ib; B.vu += j * ct.nu * ib; B.w += rbn * j * Ib;
  // friction along the contact face (bounded by mu * j)
  const ts = -ct.nu, tu = ct.ns, vt = vrs * ts + vru * tu;
  const rat = ras * tu - rau * ts, rbt = rbs * tu - rbu * ts;
  const jt = clamp(-vt / (ia + ib + rat * rat * Ia + rbt * rbt * Ib), -mu * j, mu * j);
  A.vs -= jt * ts * ia; A.vu -= jt * tu * ia; A.w -= rat * jt * Ia;
  B.vs += jt * ts * ib; B.vu += jt * tu * ib; B.w += rbt * jt * Ib;
  return { j, vn: -vn, dvB: Math.hypot(B.vs - vbs, B.vu - vbu) };
}
/** which side of a body a point is on */
function zoneOf(B, ps, pu) {
  const fx = Math.cos(B.phi), fy = Math.sin(B.phi), ds = ps - B.s, du = pu - B.u;
  const lf = ds * fx + du * fy, lr = -ds * fy + du * fx;
  return Math.abs(lf) / B.hl > Math.abs(lr) / B.hw * 0.92 ? (lf > 0 ? 'front' : 'rear') : lr > 0 ? 'right' : 'left';
}
