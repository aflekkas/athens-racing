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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const POOL = 62;
const MASS = { city: 980, hatch: 1150, sedan: 1400, taxi: 1450, suv: 1900, van: 2300, bus: 12000, scooter: 190, delivery: 210, moto: 260 };
// type behaviour: max accel a, comfortable decel b, time headway T, standstill gap s0, speed factor vf, lateral speed latV
const BEHAV = {
  city: { a: 1.6, b: 2.8, T: 1.2, s0: 2.2, vf: 0.95, latV: 1.4 },
  hatch: { a: 1.8, b: 3.0, T: 1.15, s0: 2.2, vf: 1.0, latV: 1.5 },
  sedan: { a: 1.6, b: 3.0, T: 1.25, s0: 2.4, vf: 1.0, latV: 1.35 },
  taxi: { a: 2.2, b: 3.8, T: 0.85, s0: 1.6, vf: 1.06, latV: 2.0 },
  suv: { a: 1.7, b: 3.0, T: 1.3, s0: 2.5, vf: 1.03, latV: 1.3 },
  van: { a: 1.2, b: 2.6, T: 1.45, s0: 2.6, vf: 0.9, latV: 1.1 },
  bus: { a: 0.85, b: 1.9, T: 1.7, s0: 3.0, vf: 0.8, latV: 0.75 },
  delivery: { a: 2.6, b: 4.5, T: 0.7, s0: 1.0, vf: 1.05, latV: 2.6 },
  scooter: { a: 2.1, b: 4.0, T: 0.9, s0: 1.2, vf: 0.95, latV: 2.2 },
  moto: { a: 3.2, b: 5.0, T: 0.8, s0: 1.4, vf: 1.15, latV: 2.4 },
};
const _v = new THREE.Vector3();

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
  let d = veh.yaw - ry; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const c = Math.abs(Math.cos(d)), s = Math.abs(Math.sin(d));
  return { hs: veh.halfL * c + veh.halfW * s, hu: veh.halfL * s + veh.halfW * c };
}

function indicatorMat() { return new THREE.MeshStandardMaterial({ color: '#4a2a00', emissive: '#ff9a00', emissiveIntensity: 0, roughness: 0.4 }); }

export class Traffic {
  constructor(scene, route, data) {
    this.scene = scene; this.route = route; this.data = data;
    this.rng = new RNG(4242);
    this.cars = [];
    const mk = Object.fromEntries(data.marks.map((m) => [m.id, m.s]));
    this.Z = { voula: mk.voula ?? 3700, kavouri: mk.kavouri ?? 6800, vouli: mk.vouliagmeni ?? 9500, astir: mk.astir ?? 9900, lake: mk.lake ?? 10270, lim: mk.limanakia ?? 11700 };
    const totalW = TRAFFIC_TYPES.reduce((a, t) => a + t.w, 0);
    const indGeo = new THREE.BoxGeometry(0.12, 0.07, 0.05);
    const byId = Object.fromEntries(TRAFFIC_TYPES.map((t) => [t.id, t]));
    for (let i = 0; i < POOL; i++) {
      let r = this.rng.next() * totalW, type = TRAFFIC_TYPES[0];
      for (const t of TRAFFIC_TYPES) { r -= t.w; if (r <= 0) { type = t; break; } }
      if (i < 3) type = byId.bus; else if (i < 7) type = byId.taxi; else if (i < 11) type = byId.delivery;
      const m = trafficModel(type, this.rng.pick(type.colors), this.rng);
      const indL = indicatorMat(), indR = indicatorMat();
      if (!type.scooter) {
        for (const [mat, sx] of [[indL, -1], [indR, 1]]) for (const z of [-1, 1]) {
          const b = new THREE.Mesh(indGeo, mat); b.position.set(sx * type.wid * 0.47, type.bus ? 1.0 : 0.72, z * type.len * 0.5); m.body.add(b);
        }
      }
      m.root.visible = false;
      scene.add(m.root);
      this.cars.push({ id: i, type, kind: type.id, m, indL, indR, len: type.len, wid: type.wid, mass: MASS[type.id] || 1400, active: false, crash: null, beh: BEHAV[type.id] || BEHAV.hatch });
    }
    // road works: cones + a sign, closing the kerb lane for ~45 m in town
    this.sites = []; this.cones = [];
    const coneGeo = new THREE.ConeGeometry(0.19, 0.72, 12); coneGeo.translate(0, 0.36, 0);
    const coneMat = new THREE.MeshStandardMaterial({ color: '#ff5a14', roughness: 0.55 });
    coneMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCy;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCy = position.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCy;').replace('#include <color_fragment>', '#include <color_fragment>\nif (vCy > 0.3 && vCy < 0.42 || vCy > 0.52 && vCy < 0.6) diffuseColor.rgb = vec3(0.92);');
    };
    const sitesS = [];
    for (let s = route.start + 900; s < route.finish - 400; s += 1100 + this.rng.range(0, 600)) if (route.lanes(s - 150) >= 3 && route.lanes(s + 100) >= 3 && route.urban(s) > 0.6) sitesS.push(s);
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
    this.coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, Math.max(1, this.cones.length));
    this.coneMesh.castShadow = true; this.coneMesh.frustumCulled = false; scene.add(this.coneMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this.t = 0;
    this.signals = null; this.people = null; this.honks = []; this.sounds = []; this.busStops = [];
    this.objs = [];
    this.buildParkedRows(scene);
  }

  // ---------------------------------------------------------------- where we are
  zone(s) {
    const Z = this.Z;
    if (s < Z.voula - 100) return 'glyfada';
    if (s < Z.kavouri - 500) return 'voula';
    if (s < Z.vouli - 150) return 'seafront';     // narrow Aktis / Iliou / Litous streets along Voula beach and Kavouri
    if (s < Z.lake + 250) return 'beach';          // Vouliagmeni bay, Astir, the lake: summer crowd
    if (s < Z.lim - 700) return 'cliff';
    return 'limanakia';
  }
  /** vehicles per km per lane (each direction) */
  density(s) {
    return { glyfada: 1.0, voula: 0.85, seafront: 0.7, beach: 1.15, cliff: 0.7, limanakia: 1.0 }[this.zone(s)];
  }
  /** desired cruising speed of the road (m/s) before personal factors */
  roadSpeed(s) {
    const r = this.route, n = r.lanes(s), z = this.zone(s);
    let kmh = n >= 3 ? 74 : n === 2 ? (r.div(s) > 0.5 ? 66 : 70) : 44;
    if (z === 'beach') kmh *= 0.86; else if (z === 'limanakia') kmh *= 0.9;
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

  pickFree(pred) {
    // a free vehicle of a fitting type; buses are rarer outside the avenue
    let best = null;
    for (const c of this.cars) if (!c.active && (!pred || pred(c))) { if (!best || this.rng.chance(0.35)) best = c; }
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
  }

  initDrive(c, keepDrv = true) {
    if (!keepDrv || !c.drv) this.personality(c);
    Object.assign(c, {
      mode: 'drive', uT: c.u, uv: 0, acc: 0, accT: 0, lcEval: this.rng.range(0.2, 1.2), lcT: 0, lcDelay: 0, blinkSide: 0, hazard: false,
      ovt: null, split: false, task: null, stuckT: 0, honkCool: this.rng.range(1, 3), waitT: 0, brakeT: 0, lastStop: -1e9, wheel: c.wheel || 0, yawLC: 0,
      hs: c.len * 0.5, hu: c.wid * 0.5, sigJ: -1, sigGo: false, cross: null, crash: null,
    });
  }

  spawn(ps, initial = false, behind = false) {
    const rng = this.rng, route = this.route;
    const oncoming = !behind && rng.chance(0.42);
    const sAhead = behind ? ps - rng.range(160, 230) : initial ? ps + rng.range(oncoming ? 110 : 40, 950) : ps + rng.range(800, 1000);
    const s = sAhead;
    if (s > route.length - 30 || s < 20) return;
    const z = this.zone(s), n = this.laneCount(s);
    // vehicle mix by zone: scooters everywhere, buses on the bus routes, more SUVs and cruisers at the beaches
    const c = this.pickFree((q) => {
      if (q.kind === 'bus') return n >= 2 && (z === 'glyfada' || z === 'voula' || z === 'beach' || z === 'cliff') && this.t - (this.lastBus || -1e9) > 8;
      if (q.kind === 'taxi') return z !== 'cliff' || rng.chance(0.3);
      return true;
    });
    if (!c) return;
    c.dir = oncoming ? -1 : 1;
    let lane = rng.int(0, n - 1);
    if (c.kind === 'bus' || c.kind === 'van') lane = n - 1;
    if (c.type.scooter && rng.chance(0.6)) lane = n - 1;
    c.lane = lane; c.s = s; c.len = c.type.len; c.wid = c.type.wid;
    c.u = this.laneUOf(c, s);
    // keep spawn spacing per lane, and never inside somebody
    for (const q of this.cars) if (q.active && q !== c && Math.abs(q.s - s) < (Math.abs(q.u - c.u) < 2 ? 30 : 6)) return;
    for (const st of this.sites) if (lane === st.lane && !oncoming && Math.abs(st.s - s) < 60) { c.lane = Math.max(0, lane - 1); c.u = this.laneUOf(c, s); }
    this.personality(c);
    c.active = true; c.crash = null; c.cross = null;
    this.initDrive(c);
    c.v0 = this.roadSpeed(s) * c.drv.vf; c.v = c.v0 * (behind ? 0.95 : rng.range(0.7, 1.0));
    if (c.kind === 'bus') this.lastBus = this.t;
    // beach cruisers: slow, looking for a parking spot, liable to stop anywhere
    if ((z === 'beach' || z === 'limanakia') && !c.type.scooter && c.kind !== 'bus' && rng.chance(0.28)) { c.drv.cruiser = true; c.drv.vf *= 0.62; c.drv.indicate = 0.3; }
    c.m.root.visible = true;
  }

  /** a double-parked car (hazards on) or, at the beaches, a car parked tight to the kerb */
  spawnParked(ps, initial = false) {
    const rng = this.rng, route = this.route;
    const s = initial ? ps + rng.range(120, 900) : ps + rng.range(820, 1000);
    if (s > route.length - 40) return;
    const z = this.zone(s), n = this.laneCount(s);
    if (route.urban(s) < 0.5 && z !== 'limanakia') return;
    const J = this.signals ? this.signals.J : [];
    if (J.some((j) => Math.abs(j.s - s) < 35)) return;
    if (this.busStops.some((b) => Math.abs(b - s) < 30)) return;
    if (this.sites.some((st) => Math.abs(st.s - s) < 70)) return;
    const c = this.pickFree((q) => !q.type.scooter && q.kind !== 'bus' && q.kind !== 'taxi'); if (!c) return;
    c.dir = rng.chance(0.62) ? 1 : -1; c.s = s; c.lane = n - 1;
    for (const q of this.cars) if (q.active && q !== c && Math.abs(q.s - s) < 14) return;
    this.personality(c);
    c.active = true; c.crash = null; c.cross = null;
    c.u = this.kerbU(c, s, n === 1 ? 1.05 : 1.0);
    this.initDrive(c);
    c.mode = 'parked'; c.v = 0; c.v0 = this.roadSpeed(s) * c.drv.vf;
    c.hazard = z !== 'beach' && z !== 'limanakia' ? true : rng.chance(0.3);
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
    this.honks.push({ c, reason, player, long: reason === 'cutoff' || reason === 'overtaker', kind: c.kind });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, ps, actors) {
    const route = this.route, rng = this.rng;
    this.t += dt;
    let same = 0, onc = 0, parked = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      if (c.s < ps - 260 || c.s > ps + 1150 || c.s < 5 || c.s > route.length - 5) { c.active = false; c.m.root.visible = false; c.cross = null; continue; }
      if (c.mode === 'parked') parked++; else if (c.dir > 0) same++; else onc++;
    }
    if (!this.disabled) {
      const n = this.laneCount(ps + 500), dens = this.density(ps + 500);
      const wantSame = Math.round(n * 7 * dens), wantOnc = Math.round(n * 6 * dens);
      const z = this.zone(ps + 500);
      const wantParked = { glyfada: 3, voula: 3, seafront: 3, beach: 4, cliff: 0, limanakia: 2 }[z];
      if (same < wantSame || onc < wantOnc) this.spawn(ps);
      if (parked < wantParked && rng.chance(dt * 2)) this.spawnParked(ps);
      // traffic also catches up from behind (so you get queued on and honked at when you sit at a green)
      const pl = actors.find((a) => a.kind === 'player');
      if (pl && pl.veh.vLong < 9 && rng.chance(dt * 0.35)) this.spawn(ps, false, true);
    }
    this.gather(actors);
    const pl = actors.find((a) => a.kind === 'player');
    for (const c of this.cars) {
      if (!c.active) continue;
      c.honkCool -= dt;
      if (c.crash) { this.updateCrashed(c, dt); continue; }
      if (c.cross) continue; // side-street cars crossing the junction: see updateCross
      if (c.mode === 'parked') { this.updateParked(c, dt); continue; }
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
    // ---- tasks: taxi fares, bus stops, cruisers grabbing a spot
    if (!c.task && c.mode === 'drive') this.maybeTask(c, n);
    let acc;
    if (c.task) acc = this.runTask(c, dt, n, gap, lv);
    else {
      if (c.split) v0 = Math.min(v0, Math.max(7, (L.lv > 0 ? L.lv : 0) + 7));
      acc = this.idm(c, c.v, v0, gap, lv);
    }
    // ---- lateral decisions (lane changes, overtakes, filtering)
    if (!c.task) {
      if (scoot) this.scooterLogic(c, dt, n, L);
      else if (n >= 2) this.laneChange(c, dt, n, L, acc);
      if (!scoot) this.overtakeLogic(c, dt, n, L, acc);
      if (!c.ovt && !c.split && c.lcT <= 0 && c.lcDelay <= 0) c.uT = this.laneUOf(c, c.s);
      else if (!c.ovt && !c.split && c.lcDelay <= 0) c.uT = this.laneUOf(c, c.s);
    }
    // ---- someone pulls out in front of a fast racer (they misjudge the closing speed: classic)
    if (pl && !scoot && c.dir > 0 && !c.task && !c.ovt && n >= 2 && c.lcT <= 0 && c.lcDelay <= 0) {
      const dd = c.s - pl.veh.s;
      if (dd > 28 && dd < 75 && pl.veh.vLong > c.v + 12 && rng.chance(dt * 0.18 * (0.5 + d.agg))) {
        const want = c.lane + (pl.veh.u < c.u ? -1 : 1);
        if (want >= 0 && want < n) this.startLC(c, want, true);
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
    // ---- lateral: critically damped towards uT, lateral speed limited by forward speed (no crab-walking)
    const latMax = Math.min(d.latV, 0.06 + c.v * 0.32);
    const want = clamp((c.uT - c.u) * 2.4, -latMax, latMax);
    c.uv += clamp(want - c.uv, -4 * dt, 4 * dt);
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
    // oncoming overtaker / racer on our side of the road: flash + lean on the horn
    if (L.o && L.lv < -3 && L.gap < 70 && (L.o.kind === 'player' || L.o.kind === 'rival' || (L.o.ref && L.o.ref.ovt))) this.honk(c, 'overtaker', L.o.kind === 'player');
    // taxis tooting at people on the pavement ("need a taxi?")
    if (c.kind === 'taxi' && route.urban(c.s) > 0.7 && rng.chance(dt * 0.012)) this.honk(c, 'fare');
    // ---- lights
    const blinkOn = Math.sin(this.t * 9.4 + c.id) > 0;
    const sideL = c.dir > 0 ? -1 : 1; // which u-sign is "left" for this car
    let bL = false, bR = false;
    if (c.hazard) bL = bR = blinkOn;
    else if (c.blinkSide) { if (c.blinkSide < 0) bL = blinkOn; else bR = blinkOn; }
    c.indL.emissiveIntensity = bL ? 3.5 : 0; c.indR.emissiveIntensity = bR ? 3.5 : 0;
    c.braking = c.acc < -0.9 || c.v < 0.3;
    // clear indicators once a manoeuvre settles
    if (c.blinkSide && !c.task && !c.ovt && c.lcDelay <= 0 && c.lcT <= 0 && Math.abs(c.u - c.uT) < 0.25 && c.mode === 'drive') c.blinkSide = 0;
    void sideL;
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
      if (tl > c.lane && (c.kind === 'bus' || c.kind === 'van' || d.cruiser)) gain += 0.4; // slow vehicles keep to the kerb
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

  // ---- taxi fares, bus stops, beach cruisers grabbing a parking spot
  maybeTask(c, n) {
    const rng = this.rng, route = this.route, z = this.zone(c.s);
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
  runTask(c, dt, n, gap, lv) {
    const k = c.task, d = c.drv;
    k.t += dt;
    const kerb = this.kerbU(c, c.s, c.kind === 'bus' ? 1.35 : 1.05);
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
      c.hazard = c.kind !== 'bus'; c.blinkSide = c.kind === 'bus' ? 0 : c.blinkSide;
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

  // ---------------------------------------------------------------- beach parking: static rows of parked cars on the shoulders at Limanakia
  buildParkedRows(scene) {
    const route = this.route, rng = new RNG(77), Z = this.Z;
    const spots = [];
    for (let s = Z.lake + 420; s < Math.min(route.length - 60, Z.lim + 650); s += rng.range(5.2, 7.5)) {
      const near = Math.abs(s - Z.lim) < 550 ? 0.85 : 0.35;
      if (!rng.chance(near)) { s += rng.range(4, 30); continue; }
      for (const side of [1, -1]) {
        if (!rng.chance(side > 0 ? 0.8 : 0.45)) continue;
        spots.push({ s, side, kind: rng.next() });
      }
    }
    this.parkedRows = spots;
    if (!spots.length) return;
    const types = TRAFFIC_TYPES.filter((t) => !t.scooter && !t.bus && t.id !== 'van');
    const models = types.map((t) => ({ t, list: [] }));
    for (const sp of spots) models[Math.floor(sp.kind * models.length)].list.push(sp);
    const f = {}, roots = [];
    for (const { t, list } of models) {
      for (const sp of list) {
        const m = trafficModel(t, rng.pick(t.colors), rng);
        route.frame(sp.s, f);
        const u = sp.side * (route.edge(sp.s) + ROAD.gutter + 1.45);
        route.point(sp.s, u, _v);
        m.root.position.set(_v.x, _v.y - 0.04, _v.z);
        m.root.rotation.set(0, Math.atan2(-f.tx, -f.tz) + (sp.side > 0 ? 0 : Math.PI) + rng.range(-0.06, 0.06), sp.side * 0.03, 'YXZ');
        roots.push(m);
      }
    }
    // bake them into a few static meshes (one per material per 300 m cell) so a whole beach of cars costs ~a dozen draw calls
    this.parkedGroup = bakeModels(roots, 300); scene.add(this.parkedGroup);
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
    const c = this.cars.find((q) => !q.active && !q.type.bus); if (!c) return;
    c.mode = 'cross'; c.hazard = false; c.blinkSide = 0; c.task = null; c.ovt = null; c.split = false; c.acc = 0; c.uv = 0; c.braking = false; if (!c.drv) this.personality(c);
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
      Object.assign(c, { dir: k.dirT, lane: k.lane, s: P[4], u: P[5] });
      this.initDrive(c, false); c.v0 = this.roadSpeed(c.s) * c.drv.vf;
    }
  }

  updateCrashed(c, dt) {
    const k = c.crash, route = this.route;
    k.t += dt;
    if (k.t > 6) { k.vs *= Math.exp(-4 * dt); k.vu *= Math.exp(-4 * dt); k.w *= Math.exp(-4 * dt); } // nudged about for too long: settle and get going
    const sp = Math.hypot(k.vs, k.vu);
    if (k.y <= 0.01) { const dec = Math.min(sp, 6.5 * dt); if (sp > 1e-3) { k.vs -= k.vs / sp * dec; k.vu -= k.vu / sp * dec; } }
    c.s += k.vs * dt; c.u += k.vu * dt;
    k.yaw += k.w * dt; k.w *= Math.exp(-(k.y > 0.01 ? 0.3 : 2.2) * dt);
    k.vy -= 9.81 * dt; k.y += k.vy * dt;
    if (k.y < 0) { k.y = 0; if (k.vy < -1.6) { k.vy = -k.vy * 0.32; k.w *= 0.8; } else k.vy = 0; }
    k.rollV += (-k.roll * 40 - k.rollV * 4) * dt; k.roll += k.rollV * dt;
    k.pitchV += (-k.pitch * 40 - k.pitchV * 4) * dt; k.pitch += k.pitchV * dt;
    // kerbs / median
    const lim = route.edge(c.s) + ROAD.gutter - c.wid * 0.45;
    if (c.u > lim) { c.u = lim; k.vu = -Math.abs(k.vu) * 0.3; k.w += k.vs * 0.02; }
    if (c.u < -lim) { c.u = -lim; k.vu = Math.abs(k.vu) * 0.3; k.w -= k.vs * 0.02; }
    if (route.div(c.s) > 0.45) {
      const mh = route.medHalf(c.s) + c.wid * 0.45;
      if (c.u > 0 && c.u < mh) { c.u = mh; k.vu = Math.abs(k.vu) * 0.3; }
      if (c.u < 0 && c.u > -mh) { c.u = -mh; k.vu = -Math.abs(k.vu) * 0.3; }
    }
    c.v = 0; c.wheel += k.vs * dt * 0.5;
    const blink = Math.sin(this.t * 7) > 0 && k.t > 1 ? 3.5 : 0; // hazard lights
    c.indL.emissiveIntensity = blink; c.indR.emissiveIntensity = blink;
    // shake it off: after a couple of seconds the driver straightens up and rejoins the traffic
    if (k.t > 2.2 && k.y <= 0.01 && Math.hypot(k.vs, k.vu) < 1.5) {
      k.rec = (k.rec || 0) + dt;
      // pick the nearest lane on whichever side of the road we ended up
      const dir = c.u >= 0 ? 1 : -1, n = this.laneCount(c.s);
      let lane = 0, bd = 1e9; for (let l = 0; l < n; l++) { const d = Math.abs(route.laneU(c.s, l) * dir - c.u); if (d < bd) { bd = d; lane = l; } }
      let yw = k.yaw % (Math.PI * 2); if (yw > Math.PI) yw -= Math.PI * 2; if (yw < -Math.PI) yw += Math.PI * 2;
      if (dir !== c.dir) { c.dir = dir; yw += Math.PI; if (yw > Math.PI) yw -= Math.PI * 2; } // turned around: just drive this way now
      k.yaw = yw * Math.exp(-2.5 * dt); k.vs = 0; k.vu = 0;
      c.u += (route.laneU(c.s, lane) * dir - c.u) * Math.min(1, dt * 1.5);
      k.roll *= 0.9; k.pitch *= 0.9;
      if (k.rec > 1.4 && Math.abs(k.yaw) < 0.08) { c.crash = null; c.lane = lane; this.initDrive(c); c.v = 2; c.indL.emissiveIntensity = c.indR.emissiveIntensity = 0; this.honk(c, 'angry', true); }
    }
  }

  /** collide a physics vehicle against all traffic and cones; returns events */
  collide(actor, events, now) {
    const veh = actor.veh, route = this.route;
    const ex = extents(veh, route);
    let rv = null;
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
            if (relV > 8) events.push({ kind: 'near', car: c, clearance: c.pMin, oncoming: c.dir < 0, rel: relV, side: Math.sign(du) });
          }
          c.pMin = 99;
        }
        if (Math.abs(ds) > ex.hs + chs + 1.5) c.pMin = 99;
        c.pRel = rel;
      }
      if (ox <= 0 || oy <= 0 || (c.crash && c.crash.y > 1.2)) continue;
      if (!rv) rv = routeVel(veh, route);
      const m1 = veh.m * (actor.kind === 'rival' ? 2.5 : 1), m2 = c.mass; // the rival shoulders his way through
      let sev = 0;
      if (ox < oy) {
        // longitudinal: rear-end or head-on
        const n = Math.sign(ds) || 1;
        const closing = (rv.vs - cvs) * n;
        pushVeh(veh, rv.f, -n * (ox + 0.02), 0);
        if (closing > 0) {
          const e = 0.22, J = (1 + e) * closing / (1 / m1 + 1 / m2);
          rv.vs -= n * J / m1;
          sev = closing;
          this.launch(c, cvs + n * J / m2, cvu + (Math.random() - 0.5) * closing * 0.35 + du * 0.6, closing);
          veh.w += (Math.random() - 0.5) * Math.min(1.6, closing * 0.05) * (m2 > 3000 ? 1.6 : 1);
          rv.vu += (Math.random() - 0.5) * closing * 0.12;
        }
      } else {
        const n = Math.sign(du) || 1;
        const closing = (rv.vu - cvu) * n;
        pushVeh(veh, rv.f, 0, -n * (oy + 0.02));
        if (closing > 0) {
          const e = 0.3, J = (1 + e) * closing / (1 / m1 + 1 / m2);
          rv.vu -= n * J / m1;
          rv.vs *= 0.94;
          sev = closing * 0.8 + Math.abs(rv.vs - cvs) * 0.05;
          this.launch(c, cvs * 0.7 + (rv.vs - cvs) * 0.3 * (m1 / (m1 + m2)), cvu + n * J / m2, closing * 0.6);
          veh.w += -n * Math.min(1, closing * 0.06);
        }
      }
      setRouteVel(veh, rv.f, rv.vs, rv.vu);
      if (actor.kind === 'player') c.pHitT = now;
      if (sev > 0.5) events.push({ kind: sev > 11 ? 'crash' : sev > 4 ? 'bump' : 'scrape', sev, car: c, who: actor.kind, side: Math.sign(du), heavy: m2 > 3000 || sev > 16, oncoming: c.dir < 0 });
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

  launch(c, vs, vu, closing) {
    const big = clamp(closing / 20, 0, 1.4) * (c.mass > 3000 ? 0.15 : c.mass < 400 ? 2.2 : 1);
    if (!c.crash) c.crash = { t: 0, vs: c.cross ? c.xvs : c.dir * c.v, vu: c.cross ? c.xvu : 0, w: 0, yaw: c.cross ? c.xyaw : 0, y: 0, vy: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
    if (c.cross) { c.cross = null; c.dir = 1; }
    const k = c.crash;
    if (c.mass > 3000) { k.vs = lerp(k.vs, vs, 0.15); k.vu = lerp(k.vu, vu, 0.1); return; } // buses barely notice
    k.vs = vs; k.vu = vu;
    k.w += (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 3) * big;
    k.vy = Math.max(k.vy, Math.min(5.5, closing * 0.13 * (c.mass < 400 ? 1.8 : 1)));
    k.rollV += (Math.random() - 0.5) * 6 * big; k.pitchV += (Math.random() - 0.5) * 4 * big;
    c.lcT = 0; c.indL.emissiveIntensity = 0; c.indR.emissiveIntensity = 0;
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
      if (!c.active) continue;
      const vis = Math.abs(c.s - ps) < 650;
      c.m.root.visible = vis; if (!vis) continue;
      route.frame(c.s, f);
      route.point(c.s, c.u, _v);
      const k = c.crash;
      c.m.root.position.set(_v.x, _v.y + (k ? k.y : 0), _v.z);
      const ry = Math.atan2(-f.tx, -f.tz) + (c.dir < 0 ? Math.PI : 0);
      const yaw = ry - (k ? k.yaw : c.cross ? c.xyaw : c.yawLC);
      // brake dive / squat and a little lean on scooters
      const pitch = k ? k.pitch : clamp((c.acc || 0) * (c.type.scooter ? 0.004 : 0.006), -0.035, 0.02);
      const lean = c.type.scooter && !k ? clamp(-(c.uv || 0) * 0.12 * c.dir, -0.3, 0.3) : 0;
      c.m.root.rotation.set(Math.atan(f.grade) * c.dir + (k ? 0 : 0), yaw, Math.atan(f.bank) * c.dir + (k ? k.roll : lean), 'YXZ');
      c.m.body.rotation.x = pitch;
      for (const w of c.m.wheels) w.spin.rotation.x = -c.wheel / (w.r || 0.3);
      c.m.tail.emissiveIntensity = !k && c.braking ? 7 : 1.4;
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
