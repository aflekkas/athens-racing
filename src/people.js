// People of the Riviera: pavement walkers who cross at the real zebra crossings and at the green man,
// café terraces with seated customers, beach-goers, swimmers and sunbathers, people waiting at bus stops.
// Reactions use body language only: protective flinches, sideways evasive steps,
// a braced landing, a raised fist, and a wave when a driver yields.
import * as THREE from 'three';
import {assertWorldBudget} from './world-art-direction.js';
import { ImpactBodies } from './impact-ragdoll-view.js';
import { pedestrianThump } from './impact-ragdoll.js';
import { ROAD } from './road.js';
import { RNG, clamp, damp, wrapAngle, CellInstances } from './util.js';
import { Crowd, makeLook, newPose, poseWalk, poseCycle, poseStand, poseSit, poseLie, poseSwim, armsPanic, armsFist, armsWave, HIP_Y } from './human.js';

import { PeoplePolicy, peopleSchedule, villageResidents } from './people-policy.js';
import { COND, COND_STATE } from './env.js';
import { hourForTime } from './world-life.js';

// A light sprinkle: people are set dressing, so the pool, the walker target and the share of
// anchored spots (café seats, beach, bus stops) are kept small, and distant people tick slowly.
export const PEOPLE_BUDGET = Object.freeze({ max: 28, walkers: 8, initial: 6 });
const MAX = PEOPLE_BUDGET.max, WALKERS = PEOPLE_BUDGET.walkers, INITIAL_WALKERS = PEOPLE_BUDGET.initial;
const ANCHOR_SHARE = { cafe: .18, stop: .22, beach: .12, wander: .1, lie: .12, swim: .12, resident: .28 };
const FAR_TICK = 80 * 80, FAR_EVERY = 4; // beyond 80 m from the camera, update every 4th frame
const TAU = Math.PI * 2;
// ------------------------------------------------------------------ café furniture
export function chairGeo() {
  const parts = [];
  const add = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g.toNonIndexed()); };
  add(0.44, 0.035, 0.42, 0, 0.455, 0); add(0.44, 0.42, 0.03, 0, 0.68, -0.2);
  for (const x of [-0.19, 0.19]) for (const z of [-0.18, 0.18]) add(0.03, 0.455, 0.03, x, 0.228, z);
  return assertWorldBudget('streetProp',mergeList(parts));
}
export function tableGeo() {
  const top = new THREE.BoxGeometry((0.36)*2, 0.03, (0.36)*2); top.translate(0, 0.735, 0);
  const stem = new THREE.BoxGeometry((0.03)*2, 0.72, (0.03)*2); stem.translate(0, 0.36, 0);
  const base = new THREE.BoxGeometry((0.2)*2, 0.03, (0.22)*2); base.translate(0, 0.015, 0);
  const cup1 = new THREE.BoxGeometry((0.04)*2, 0.14, (0.03)*2); cup1.translate(0.14, 0.82, 0.05);
  const cup2 = new THREE.BoxGeometry((0.04)*2, 0.14, (0.03)*2); cup2.translate(-0.12, 0.82, -0.08);
  return assertWorldBudget('streetProp',mergeList([top, stem, base, cup1, cup2].map((g) => g.toNonIndexed())));
}
function mergeList(list) {
  const pos = [], nor = [];
  for (const g of list) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); o.computeBoundingSphere();
  return o;
}

// ------------------------------------------------------------------ the crowd
export class People {
  constructor(map, scene, assets, group) {
    this.map = map; this.route = map.route; this.terrain = map.terrain; this.assets = assets;
    this.rng = new RNG(2024);
    this.policy = new PeoplePolicy(map, ROAD.sidewalk);
    this.crowd = new Crowd(scene, MAX);
    this._impactFrame = {}; this._impactSurface = {};
    this._impactGround = (x, z, body) => {
      const r = this.route, f = this._impactFrame;
      const hint = body.groundS ?? r.project(x,z).s;
      r.frame(hint,f);
      const s = hint + (x-f.x)*f.tx + (z-f.z)*f.tz;
      r.frame(s,f); const u = (x-f.x)*f.rx + (z-f.z)*f.rz; body.groundS=s;
      return this.traffic?.ground ? this.traffic.ground.at(x,z,s,u,this._impactSurface).y + .015 : this.walkY(s,u);
    };
    this.bodies = new ImpactBodies(scene, this._impactGround);
    this.peds = Array.from({ length: MAX }, (_, i) => ({ slot: i, active: false, P: newPose() }));
    this.onRoad = []; this.events = []; this.t = 0;
    this.drawRadius = 175; // m (main.js: graphics tier)
    this.budgetMul = 1; // x the walkers a map wants (main.js: performance class)
    this.traffic = null;
    const J = assets.junctions || [];
    this.zebras = (assets.crossings || []).map((s) => ({ s, j: J.find((j) => Math.abs(j.zF - s) < 0.5 || Math.abs(j.zO - s) < 0.5) || null }));
    this.anchors = [];
    this.buildCafes(group);
    this.collectBeach();
    this.collectBusStops();
    this.anchors.push(...villageResidents(map, this.policy));
    this.anchors.sort((a, b) => a.s - b.s);
    this._f = {}; this._v = new THREE.Vector3();
    this.acts = [{}, {}];
  }

  // ---------------------------------------------------------------- static set-up
  buildCafes(group) {
    const r = this.route, data = this.map.data, rng = new RNG(808);
    const spots = [];
    const KINDS = /^(cafe|restaurant|bar|fast_food|ice_cream|pub|shop:pastry|shop:bakery|shop:confectionery)$/;
    for (const poi of data.pois) if (KINDS.test(poi.k) && Math.abs(poi.u) < 90 && poi.s > r.start - 80 && poi.s < r.finish && r.urban(poi.s) > 0.6) spots.push({ s: poi.s, side: Math.sign(poi.u) || 1 });
    for (let s = r.start + 230; s < r.finish; s += 410) if (r.seaR(s) < 150 && r.urban(s) > 0.7) spots.push({ s, side: 1 });
    spots.sort((a, b) => a.s - b.s);
    const J = this.assets.junctions || [], X = this.assets.crossings || [], B = this.assets.busStops || [];
    const clear = (s) => !J.some((j) => Math.abs(j.s - s) < 32) && !X.some((c) => Math.abs(c - s) < 13) && !B.some((b) => Math.abs(b - s) < 16);
    const chairs = new CellInstances(chairGeo(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), { colors: true, far: 420, shadow: true });
    const tables = new CellInstances(tableGeo(), new THREE.MeshStandardMaterial({ color: '#e9e5dc', roughness: 0.5 }), { far: 420, shadow: true });
    const CH = ['#2b2b2b', '#c9a27a', '#f2f2f2', '#1f4d7a', '#8a5a3c'], PA = ['#f4f1e8', '#e8452c', '#1f6fb4', '#f2c230', '#2fae8f', '#f4f1e8'];
    const taken = [];
    const pt = new THREE.Vector3(), f = {};
    this.cafes = [];
    for (const sp of spots) {
      const { s, side } = sp;
      const sw = ROAD.sidewalk(r, s, side);
      if (sw < 3.3 || !clear(s) || taken.some((q) => q.side === side && Math.abs(q.s - s) < 70)) continue;
      taken.push(sp);
      const n = sw > 5 ? 4 : 3, chC = rng.pick(CH), paC = rng.pick(PA);
      this.cafes.push({ s, side });
      for (let i = 0; i < n; i++) {
        const ts = s + (i - (n - 1) / 2) * 3.1;
        const eA = r.edge(ts) + ROAD.gutter, uo = sw * 0.68;
        const u = side * (eA + 0.18 + uo);
        r.point(ts, u, pt); r.frame(ts, f);
        const y = r.surfaceY(ts, side * eA) + ROAD.curbH(r, ts) + 0.015;
        const yawS = Math.atan2(f.tx, f.tz);
        tables.addTRS(pt.x, y, pt.z, yawS, 1);
        const seats = [[-0.66, 0, 0], [0.66, 0, Math.PI]];
        if (sw > 4.3) seats.push([0, -0.66, Math.PI / 2], [0, 0.66, -Math.PI / 2]);
        for (const [ds, du, ry] of seats) {
          const cx = pt.x + f.tx * ds + f.rx * du * side, cz = pt.z + f.tz * ds + f.rz * du * side;
          const yaw = yawS + (du === 0 ? ry : side > 0 ? ry : -ry);
          chairs.addTRS(cx, y, cz, yaw, 1, 1, 1, chC);
          if (rng.chance(0.72)) this.anchors.push({ kind: 'cafe', s: ts, x: cx + Math.sin(yaw) * 0.04, y, z: cz + Math.cos(yaw) * 0.04, yaw, ped: null });
        }
      }
    }
    chairs.build(group); tables.build(group);
  }

  collectBeach() {
    const r = this.route, ter = this.terrain, rng = new RNG(4711);
    for (const [x, h, z] of this.assets.beachPeople || []) {
      const q = r.project(x, z, null); if (Math.abs(q.u) > 260 || q.s < r.start - 150 || q.s > r.finish + 100) continue;
      const roll = rng.next();
      if (roll < 0.22) {
        // a swimmer offshore of this spot
        let best = null;
        for (let a = 0; a < TAU && !best; a += TAU / 12) {
          const dx = Math.sin(a), dz = Math.cos(a);
          for (let d = 4; d < 70; d += 4) { const hh = ter.height(x + dx * d, z + dz * d); if (hh < -1.2) { const e = d + rng.range(4, 16); if (ter.height(x + dx * e, z + dz * e) < -1) best = { x: x + dx * e, z: z + dz * e, yaw: a }; break; } }
        }
        if (best) this.anchors.push({ kind: 'swim', s: q.s, x: best.x, y: 0, z: best.z, yaw: best.yaw, ped: null });
      } else this.anchors.push({ kind: roll < 0.6 ? 'beach' : 'wander', s: q.s, x, y: h, z, yaw: rng.range(0, TAU), ped: null });
    }

  }

  collectBusStops() {
    const r = this.route, rng = new RNG(99), f = {}, pt = new THREE.Vector3();
    for (const s0 of this.assets.busStops || []) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const s = s0 + rng.range(-2.2, 2.2), eA = r.edge(s) + ROAD.gutter;
        r.point(s, eA + 0.18 + rng.range(0.5, 0.9), pt); r.frame(s, f);
        const y = r.surfaceY(s, eA) + ROAD.curbH(r, s) + 0.015;
        this.anchors.push({ kind: 'stop', s, x: pt.x, y, z: pt.z, yaw: Math.atan2(-f.rx, -f.rz) + rng.range(-0.8, 0.8), ped: null });
      }
    }
  }

  // ---------------------------------------------------------------- spawning
  dens(s) {
    return Math.max(this.policy.density(s, 1, this.hour(), COND_STATE.rain), this.policy.density(s, -1, this.hour(), COND_STATE.rain));
  }
  hour() { return Number.isFinite(COND.hour) ? COND.hour : hourForTime(COND.time); }
  free() { for (const p of this.peds) if (!p.active) return p; return null; }
  init(p, kind, look) {
    Object.assign(p, {
      active: true, kind, look, rs: false, mode: 'stand', variant: 'idle', sd: this.rng.next(), t: this.rng.range(0, 20), ph: this.rng.range(0, TAU),
      air: null, react: null, startleCool: 0, thanked: false, blockT: 0, wy: 0, home: null, drawn: false, hurry: false, zeb: null,
      yaw: undefined, hd: 0, moving: false, anchor: null, toSide: 0, zebI: -1, target: null, pause: 0, lag: 0,
    });
    return p;
  }
  despawn(p) { p.active = false; if (p.anchor) { p.anchor.ped = null; p.anchor = null; } }

  spawnWalker(ps, initial) {
    if (this.map.id === 'penteli') return;
    const r = this.route, rng = this.rng;
    const p = this.free(); if (!p) return;
    let s = null;
    let zeb = null;
    if (rng.chance(0.3)) {
      const lo = ps + (initial ? 25 : 170), hi = ps + 470;
      const cand = this.zebras.filter((z) => z.s > lo && z.s < hi && this.dens(z.s) > 0.2);
      if (cand.length) { zeb = rng.pick(cand); s = zeb.s + rng.range(-1.3, 1.3); }
    }
    if (s === null) for (let i = 0; i < 6; i++) { const c = initial ? ps + rng.range(-60, 470) : ps + rng.range(270, 470); if (rng.next() < this.dens(c)) { s = c; break; } }
    if (s === null || s < 30 || s > r.length - 30) return;
    const side = rng.chance(r.seaR(s) < 140 ? 0.62 : 0.5) ? 1 : -1;
    const sw = ROAD.sidewalk(r, s, side); if (sw < 1.4 || !this.policy.zone(s, side).allowed) return;
    // Keep bicycles on broad promenades; runners share the ordinary pavement.
    const activity = !zeb && sw > 4.5 && this.policy.zone(s, side).coastal && rng.chance(peopleSchedule('cyclist', this.hour(), COND_STATE.rain)) ? 'cyclist' : !zeb && rng.chance(peopleSchedule('jogger', this.hour(), COND_STATE.rain)) ? 'jogger' : 'street';
    const uo = rng.range(0.9, Math.max(1.0, sw * 0.4));
    if (!this.policy.safePoint(s, side * (r.edge(s) + ROAD.gutter + .18 + uo))) return;
    this.init(p, 'walker', makeLook(rng, activity));
    p.look.umbrella = COND_STATE.rain > .12 && p.look.role === 'street';
    Object.assign(p, { rs: true, s, side, u: side * (r.edge(s) + ROAD.gutter + .18 + uo), uo, dirS: rng.chance(0.5) ? 1 : -1, speed: p.look.speed, mode: 'walk' });
    p.uoT = p.uo;
    if (p.look.role === 'cyclist') { p.uo = Math.min(sw - 0.7, Math.max(1.7, sw * 0.5)); p.uoT = p.uo; }
    if (zeb) { p.mode = 'wait'; p.zeb = zeb; p.waitT = rng.range(0, 4); p.uo = 0.3; }
    this.nextZebra(p);
  }
  nextZebra(p) {
    p.zebI = -1;
    for (let i = 0; i < this.zebras.length; i++) {
      const k = p.dirS > 0 ? i : this.zebras.length - 1 - i, z = this.zebras[k];
      if ((z.s - p.s) * p.dirS > 0.6) { p.zebI = k; break; }
    }
    p.wantCross = p.look.role !== 'cyclist' && this.rng.chance(0.42);
  }
  spawnAnchor(a) {
    const p = this.free(); if (!p) return;
    const ctx = a.kind === 'cafe' || a.kind === 'stop' || a.kind === 'resident' ? (a.kind === 'cafe' ? 'cafe' : 'street') : 'beach';
    const look = makeLook(this.rng, ctx);
    if (a.kind === 'stop' || a.kind === 'resident') look.umbrella = COND_STATE.rain > .12;
    if (a.kind === 'swim' || a.kind === 'lie') { look.cup = false; look.towel = false; look.bag = false; look.umbrella = false; look.phone = false; look.glasses = a.kind === 'lie' && look.glasses; if (a.kind === 'swim') look.hat = null; }
    if (a.kind === 'stop' || a.kind === 'beach' || a.kind === 'wander') look.cup = look.cup && this.rng.chance(0.5);
    this.init(p, a.kind, look);
    a.ped = p; p.anchor = a;
    p.x = a.x; p.z = a.z; p.y = a.y; p.yaw = a.yaw; p.home = { x: a.x, z: a.z, y: a.y, yaw: a.yaw };
    p.mode = { cafe: 'sit', swim: 'swim', lie: 'lie', beach: 'stand', wander: 'wander', stop: 'stand', resident: 'stand' }[a.kind];
    p.variant = a.kind === 'stop' ? this.rng.pick(['idle', 'phone', 'look', 'cross']) : a.kind === 'beach' ? this.rng.pick(['chat', 'idle', 'hips', 'chat', 'phone']) : 'idle';
    look.phone = p.variant === 'phone';
    p.target = null; p.speed = p.look.speed * 0.7;
  }

  reset(ps) {
    for (const p of this.peds) if (p.active) this.despawn(p);
    for (const a of this.anchors) { a.ped = null; a.hitUntil = 0; }
    this.t = 0; this.bodies.clear();
    for (let i = 0, n = Math.round(INITIAL_WALKERS * this.budgetMul); i < n; i++) this.spawnWalker(ps, true);
    this.updateAnchors(ps);
  }

  updateAnchors(ps) {
    // Anchors are sorted by s: only the window around the player is evaluated, and the
    // schedule/policy answer is cached per anchor until the hour or the rain moves on.
    const A = this.anchors, hour = this.hour(), rain = COND_STATE.rain, key = Math.round(hour * 4) * 16 + Math.round(rain * 10);
    let lo = 0, hi = A.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (A[m].s < ps - 190) lo = m + 1; else hi = m; }
    for (let i = lo; i < A.length && A[i].s <= ps + 430; i++) {
      const a = A[i];
      if (a.availKey !== key) {
        a.rank ??= ((Math.imul(Math.round(a.s * 17 + a.x * 7), 2654435761) >>> 0) % 1000) / 1000;
        a.avail = a.rank < this.policy.anchor(a, hour, rain) * (ANCHOR_SHARE[a.kind] ?? .5); a.availKey = key;
      }
      const inW = a.avail && !(a.hitUntil > this.t) && a.s > ps - 150 && a.s < ps + 380;
      if (inW && !a.ped) this.spawnAnchor(a);
      else if (!inW && a.ped && (!a.avail || a.s < ps - 190 || a.s > ps + 430)) this.despawn(a.ped);
    }
  }

  // ---------------------------------------------------------------- per frame
  /** actors: [{veh, kind}] */
  update(dt, ps, actors, camPos) {
    const r = this.route, rng = this.rng;
    this.t += dt;
    // spawn / despawn
    let walkers = 0;
    for (const p of this.peds) {
      if (!p.active) continue;
      if (p.kind === 'walker') { if (p.s < ps - 130 || p.s > ps + 520 || !this.policy.zone(p.s, p.side).allowed || (p.mode === 'walk' && !this.policy.safePoint(p.s, p.u))) { this.despawn(p); continue; } p.look.umbrella = COND_STATE.rain > .12 && p.look.role === 'street'; walkers++; }
      else if (p.anchor && (p.anchor.s < ps - 190 || p.anchor.s > ps + 430)) this.despawn(p);
    }
    if ((this.frame = (this.frame || 0) + 1) % 10 === 0) this.updateAnchors(ps);
    const want = Math.round(WALKERS * this.budgetMul * Math.max(this.dens(ps + 120), this.dens(ps + 350)));
    if (walkers > want && this.frame % 10 === 0) { const p = this.peds.find(p => p.active && p.kind === 'walker' && p.mode === 'walk'); if (p) this.despawn(p); }
    if (walkers < want) this.spawnWalker(ps, false);
    // actors in world space
    const acts = this.acts;
    for (const a of acts) a.kind = undefined;
    actors.forEach((a, i) => {
      const v = a.veh, A = acts[i] ||= {};
      A.kind = a.kind; A.x = v.x; A.z = v.z; A.s = v.s; A.u = v.u; A.fx = -Math.sin(v.yaw); A.fz = -Math.cos(v.yaw); A.rx = Math.cos(v.yaw); A.rz = -Math.sin(v.yaw);
      A.v = Math.abs(v.vLong); A.halfL = v.halfL; A.halfW = v.halfW; A.veh = v;
    });
    for (const b of this.bodies.bodies) if (b.kind !== 'rider') this.bodies.advanceBody(b, dt);
    this.bodies.render();
    this.onRoad.length = 0;
    const f = this._f, cx = camPos.x, cz = camPos.z, frame = this.frame;
    for (const p of this.peds) {
      if (!p.active) continue;
      // Far from the camera and calm: catch up every few frames with the accumulated time.
      p.lag = (p.lag || 0) + dt;
      if (!p.air && !p.react && p.mode !== 'cross' && (p.x - cx) ** 2 + (p.z - cz) ** 2 > FAR_TICK && (frame + p.slot) % FAR_EVERY) continue;
      const pdt = p.lag; p.lag = 0;
      this.tickPed(p, pdt, actors, f);
    }
    this.draw(camPos);
  }

  tickPed(p, dt, actors, f) {
    const r = this.route;
    {
      p.t += dt; p.startleCool -= dt;
      if (p.react) { p.react.t += dt; if (p.react.t > p.react.dur) p.react = null; }
      if (p.rs) this.updateStreet(p, dt, actors, f); else this.updateAnchored(p, dt);
      // Short evasive bounds under ordinary gravity; no aerial flips.
      if (p.air) {
        const a = p.air;
        if (p.rs) { r.frame(p.s, f); p.s += (a.vx * f.tx + a.vz * f.tz) * dt; p.u += (a.vx * f.rx + a.vz * f.rz) * dt; }
        else { p.x += a.vx * dt; p.z += a.vz * dt; }
        a.vy -= 9.81 * dt; a.y += a.vy * dt; a.spin += a.spinV * dt;
        if (a.y <= 0 && a.vy < 0) this.land(p);
      }
      // world position
      if (p.rs) {
        r.frame(p.s, f);
        r.point(p.s, p.u, this._v); p.x = this._v.x; p.z = this._v.z;
        p.y = this.walkY(p.s, p.u);
        const ca = Math.cos(p.hd), sa = Math.sin(p.hd);
        const yt = Math.atan2(f.tx * ca + f.rx * sa, f.tz * ca + f.rz * sa);
        p.yaw = p.yaw === undefined ? yt : p.yaw + wrapAngle(yt - p.yaw) * Math.min(1, dt * 7);
        const eA = r.edge(p.s) + ROAD.gutter, au = Math.abs(p.u);
        const mh = r.div(p.s) > 0.45 ? r.medHalf(p.s) - 0.1 : -1; // standing on the median island is not "on the road"
        if (au < eA + 0.1 && au > mh) this.onRoad.push(p);
      }
      p.wy = p.y + (p.air ? p.air.y : 0);
      this.react(p, dt);
    }
  }

  draw(camPos) {
    const cx = camPos.x, cz = camPos.z;
    this.crowd.begin();
    for (const p of this.peds) {
      if (!p.active) continue;
      const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (d2 > this.drawRadius * this.drawRadius) continue;
      this.pose(p);
      this.crowd.draw(p.P, p.look, Math.sqrt(d2));
    }
    this.crowd.end();
  }

  walkY(s, u) {
    if (this.map.id === 'penteli' && Math.abs(u) > this.route.edge(s) + ROAD.gutter) { const p = this.route.point(s, u, this._v); return this.terrain.height(p.x, p.z) + .015; }
    const r = this.route, au = Math.abs(u), eA = r.edge(s) + ROAD.gutter, side = u >= 0 ? 1 : -1;
    if (au > eA + 0.12) return r.surfaceY(s, side * eA) + ROAD.curbH(r, s) + 0.015;
    if (r.div(s) > 0.45 && au < r.medHalf(s)) return r.surfaceY(s, u) + 0.2;
    return r.surfaceY(s, u);
  }

  updateStreet(p, dt, actors, f) {
    const r = this.route, rng = this.rng;
    const eA = r.edge(p.s) + ROAD.gutter;
    const busy = p.react && p.react.type !== 'wave';
    if (p.air) { p.hd = p.hd ?? 0; return; }
    if (p.mode === 'walk') {
      const nextS = p.s + p.dirS * p.speed * dt;
      if (!this.policy.safePoint(nextS, p.side * (r.edge(nextS) + ROAD.gutter + .18 + p.uo))) { p.dirS *= -1; this.nextZebra(p); }
      const v = busy ? 0 : p.speed;
      p.moving = v > 0;
      p.s += p.dirS * v * dt;
      p.uo = damp(p.uo, p.uoT, 1.2, dt);
      p.u = p.side * (eA + 0.18 + p.uo);
      p.ph += dt * v * TAU / (p.look.role === 'cyclist' ? 4.5 : p.look.role === 'jogger' ? 2.0 : 0.8 * p.look.h + 0.15);
      p.hd = p.dirS > 0 ? 0 : Math.PI;
      const z = this.zebras[p.zebI];
      if (z && (z.s - p.s) * p.dirS < 0.4) {
        if (p.wantCross && this.dens(z.s) > 0.05) { p.mode = 'wait'; p.zeb = z; p.waitT = 0; p.s = z.s + rng.range(-1.2, 1.2); }
        else this.nextZebra(p);
      }
    } else if (p.mode === 'wait') {
      p.moving = false;
      p.uo = damp(p.uo, 0.3, 2.5, dt); p.u = p.side * (eA + 0.18 + p.uo);
      p.hd = p.side > 0 ? -Math.PI / 2 : Math.PI / 2;
      p.waitT += dt;
      if (!busy && this.canCross(p, actors)) { p.mode = 'cross'; p.toSide = -p.side; p.hurry = false; p.crossV = p.look.speed * (p.zeb && p.zeb.j ? 1.3 : 1.1); p.blockT = 0; }
    } else if (p.mode === 'cross') {
      // stop if a car is sitting on the crossing right in front of us
      const nu = p.u + p.toSide * 0.75;
      let block = null;
      for (const a of actors) if (Math.abs(a.veh.s - p.s) < a.veh.halfL + 0.45 && Math.abs(a.veh.u - nu) < a.veh.halfW + 0.3) block = a;
      if (!block && this.traffic) for (const c of this.traffic.cars) if (c.active && Math.abs(c.s - p.s) < c.hs + 0.4 && Math.abs(c.u - nu) < c.hu + 0.3) { block = c; break; }
      if (block) { p.blockT += dt; if (block.kind === 'player' && p.blockT > 1.0 && !p.react) { p.react = { type: 'fist', t: 0, dur: 2 }; } }
      if (p.blockT > 7) block = null; // give up waiting and squeeze past
      const j = p.zeb && p.zeb.j;
      // wide divided avenue: if the green man ends, finish the half we're on and wait on the median
      const mh = r.div(p.s) > 0.45 ? r.medHalf(p.s) : 0;
      let refuge = false;
      if (j && !j.ped && mh > 0.7) {
        const past = p.toSide * p.u; // < 0: still on the first carriageway
        if (past < -mh) p.hurry = true;
        else if (past < 0 && !p.hurryAll) { refuge = true; p.hurry = false; p.u = damp(p.u, -p.toSide * Math.min(mh * 0.5, 0.8), 3, dt); }
        else p.hurry = true;
      } else if (j && !j.ped && Math.abs(p.u) < eA) p.hurry = true;
      if (j && j.ped) { p.hurryAll = false; }
      const v = block || busy || refuge ? 0 : p.crossV * (p.hurry ? 1.9 : 1);
      p.moving = v > 0;
      p.u += p.toSide * v * dt;
      p.ph += dt * v * TAU / (0.8 * p.look.h + (p.hurry ? 0.6 : 0.15));
      p.hd = p.toSide > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (p.toSide * p.u > eA + 0.18 + 0.5) {
        const sw = ROAD.sidewalk(r, p.s, p.toSide);
        p.mode = 'walk'; p.side = p.toSide; p.uo = Math.abs(p.u) - eA - 0.18; p.uoT = rng.range(0.9, Math.max(1.0, sw * 0.4)); p.dirS = rng.chance(0.5) ? 1 : -1; p.hurry = false; p.zeb = null; p.thanked = false;
        this.nextZebra(p); p.wantCross = rng.chance(0.15);
      }
    }
  }

  canCross(p, actors) {
    const z = p.zeb; if (!z) return true;
    if (z.j) return z.j.ped && z.j.pedLeft > 3.2;
    const impatient = p.waitT > 13;
    const s = z.s;
    const danger = (d, v) => impatient ? d > -3 && d < 14 : d > -4 && d < 9 + v * 4.5;
    if (this.traffic) for (const c of this.traffic.cars) { if (!c.active || c.cross) continue; if (danger((s - c.s) * c.dir, c.crash ? 0 : c.v)) return false; }
    for (const a of actors) if (danger(s - a.veh.s, Math.max(0, a.veh.vLong))) return false;
    return p.waitT > 0.8;
  }

  updateAnchored(p, dt) {
    if (p.air) return;
    const h = p.home;
    const away = Math.hypot(p.x - h.x, p.z - h.z);
    p.moving = false;
    if (p.mode === 'swim') {
      // lazy breaststroke back and forth
      const a = p.yaw, v = 0.35;
      p.x += Math.sin(a) * v * dt; p.z += Math.cos(a) * v * dt;
      if (Math.hypot(p.x - h.x, p.z - h.z) > 9) p.yaw += Math.PI;
      p.y = -0.05 + 0.04 * Math.sin(p.t * 2.2);
      return;
    }
    if (p.mode === 'wander') {
      if (!p.target || Math.hypot(p.target.x - p.x, p.target.z - p.z) < 0.4) {
        if (!p.pause || p.pause <= 0) {
          const ang = this.rng.range(0, TAU), d = this.rng.range(2, 8);
          const tx = h.x + Math.sin(ang) * d, tz = h.z + Math.cos(ang) * d, th = this.terrain.height(tx, tz);
          if (th > 0.3 && th < 4) p.target = { x: tx, z: tz }; p.pause = this.rng.range(2, 6);
        } else { p.pause -= dt; return; }
      }
      if (p.target && !(p.react && p.react.type !== 'wave')) this.walkTo(p, p.target.x, p.target.z, dt, p.speed);
      p.y = Math.max(0.2, this.terrain.height(p.x, p.z));
      return;
    }
    // everyone else drifts back to their seat / sunbed / spot after a scare
    if (away > 0.15 && !(p.react && p.react.type !== 'wave')) { this.walkTo(p, h.x, h.z, dt, 1.3); p.y = h.y; if (Math.hypot(p.x - h.x, p.z - h.z) < 0.16) p.yaw = h.yaw; }
    else if (away <= 0.15) { p.x = h.x; p.z = h.z; p.y = h.y; p.yaw = p.yaw + wrapAngle(h.yaw - p.yaw) * Math.min(1, dt * 5); }
  }
  walkTo(p, tx, tz, dt, v) {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz); if (d < 1e-3) return;
    const st = Math.min(d, v * dt); p.x += dx / d * st; p.z += dz / d * st;
    p.yaw += wrapAngle(Math.atan2(dx, dz) - p.yaw) * Math.min(1, dt * 6);
    p.ph += dt * v * TAU / (p.look.role === 'cyclist' ? 4.5 : p.look.role === 'jogger' ? 2.0 : 0.8 * p.look.h + 0.15); p.moving = true;
  }

  // ---------------------------------------------------------------- reactions
  react(p, dt) {
    if (p.kind === 'swim') return;
    for (const A of this.acts) {
      if (A.kind === undefined) continue;
      const dx = p.x - A.x, dz = p.z - A.z;
      if (dx * dx + dz * dz > 4900) continue;
      // pavement / crossing people: measure along the road (the car follows its lane), others along the car's heading
      const al = p.rs ? p.s - A.s : dx * A.fx + dz * A.fz, lat = p.rs ? p.u - A.u : dx * A.rx + dz * A.rz;
      if (al < -A.halfL - 1 || al > 70) continue;
      // A stopped car must reach the yield/wave check before the moving-car guard.
      if (A.kind === 'player' && p.mode === 'cross' && !p.thanked && A.v < 0.8 && al > 0 && al < A.halfL + 9 && Math.abs(lat) < 5) {
        p.thanked = true; p.react = { type: 'wave', t: 0, dur: 1.8 }; this.events.push({ kind: 'thanks', p });
      }
      // Contact is classified before the anticipatory evasive/near-miss reaction.
      const along = dx * A.fx + dz * A.fz, across = dx * A.rx + dz * A.rz;
      const py = p.wy ?? p.y;
      if (A.v > .15 && Math.abs(along) < A.halfL + .24 && Math.abs(across) < A.halfW + .22 && Math.abs(py - (A.veh.y ?? py)) < 1.25) {
        this.hit(p, A); return;
      }
      if (A.v < 3) continue;
      const tt = (al - A.halfL) / A.v;
      const gy = Math.abs(p.wy - (A.veh.y ?? p.wy));
      if (gy > 3) continue;
      const inPath = Math.abs(lat) < A.halfW + 0.85 && al > -A.halfL + 0.3;
      if (inPath && (!p.air || p.air.hop) && tt < 0.62) { this.dive(p, A, lat); return; }
      if (!inPath && !p.air && !p.react && p.startleCool <= 0 && A.v > 11 && Math.abs(lat) < A.halfW + 1.5 + A.v * 0.035 && al > -1.5 && al < 3 + A.v * 0.3) { this.startle(p, A, lat); return; }
    }
    // slow players can still annoy someone on the zebra; handled in updateStreet
  }
  hit(p, A) {
    const v = A.veh, vx = A.fx * v.vLong + A.rx * (v.vLat || 0), vz = A.fz * v.vLong + A.rz * (v.vLat || 0);
    // Keep the vehicle reference: contact planes follow the live car as it brakes or turns.
    const car = { x: v.x, y: v.y || 0, z: v.z, yaw: v.yaw, halfL: v.halfL, halfW: v.halfW, height: v.spec?.height || 1.4, vx, vz, veh: v };
    // Transfer an already-built close rig, preserving clothes, face and hair without building on impact.
    const rig = this.crowd?.near.get(p.look); if (rig) this.crowd.near.delete(p.look);
    const b = this.bodies.spawn({rig,look:p.look,s:p.s,x:p.x,y:p.wy ?? p.y,z:p.z,yaw:p.yaw,scale:p.look.k,wH:p.look.wH,wT:p.look.wT,vx,vz,seed:p.slot,car,owner:p.slot});
    const dv = pedestrianThump(v, A.v, p.x - v.x, p.z - v.z);
    this.events.push({dv, kind:'hit', target:'pedestrian', who:A.kind, p, body:b, sev:A.v, x:p.x,y:p.wy ?? p.y,z:p.z});
    if (p.anchor) p.anchor.hitUntil = this.t + 12;
    this.despawn(p);
  }
  dive(p, A, lat) {
    const rng = this.rng, side = Math.sign(lat) || (rng.chance(0.5) ? 1 : -1);
    // Push sideways just beyond the vehicle envelope. Keep a low centre of mass,
    // a stable torso, and enough travel to clear the tyres without a cartoon somersault.
    const flight = 0.68, clearance = Math.max(0.9, A.halfW + 1.05 - Math.abs(lat));
    const out = Math.min(5.4, clearance / flight);
    p.air = { y: p.air ? p.air.y : 0, vy: 3.35, vx: A.rx * side * out, vz: A.rz * side * out,
      spin: side * 0.18, spinV: 0, flip: 0, hop: false };
    p.react = { type: 'evade', t: 0, dur: 1.8 };
    p.startleCool = 4;
    this.events.push({ kind: 'dive', target: 'pedestrian', who: A.kind, p });
  }
  startle(p, A, lat) {
    const rng = this.rng, side = Math.sign(lat) || 1;
    p.startleCool = 6;
    p.react = { type: rng.chance(0.55) ? 'panic' : 'fist', t: 0, dur: 1.7 };
    if (p.mode === 'sit') p.air = { y: 0, vy: 0.8, vx: 0, vz: 0, spin: 0, spinV: 0, flip: 0, hop: true };
    else if (p.mode !== 'lie') p.air = { y: 0, vy: 1.5, vx: A.rx * side * 1.7, vz: A.rz * side * 1.7, spin: 0, spinV: 0, flip: 0, hop: true };
    if (A.kind === 'player') this.events.push({ kind: 'startle', target: 'pedestrian', who: A.kind, p });
  }
  land(p) {
    const a = p.air, hop = a.hop;
    p.air = null;
    if (!hop) p.react = { type: 'recover', t: 0, dur: 1.8 };
    if (p.rs) {
      const r = this.route, eA = r.edge(p.s) + ROAD.gutter, au = Math.abs(p.u);
      if (au < eA + 0.1) { p.mode = 'cross'; p.toSide = p.u >= 0 ? 1 : -1; if (!p.zeb) p.zeb = null; p.crossV = p.look.speed * 1.2; p.hurry = true; }
      else {
        const side = p.u >= 0 ? 1 : -1, sw = ROAD.sidewalk(r, p.s, side);
        if (p.mode !== 'walk') { p.mode = 'walk'; p.dirS = this.rng.chance(0.5) ? 1 : -1; this.nextZebra(p); p.wantCross = false; }
        p.side = side; p.uo = clamp(au - eA - 0.18, 0.3, Math.max(0.4, sw - 0.3)); p.uoT = clamp(p.uo, 0.9, Math.max(1.0, sw * 0.4));
      }
    }
  }
  /** someone just ran the red at junction j: nearby pedestrians are outraged */
  redRun(j) {
    let n = 0;
    for (const p of this.peds) {
      if (!p.active || !p.rs || Math.abs(p.s - j.s) > 30 || n >= 3) continue;
      if (p.mode !== 'wait' && p.mode !== 'cross' && this.rng.next() > 0.5) continue;
      if (p.air) continue;
      n++; p.react = { type: 'fist', t: 0, dur: 2.2 };
    }
  }

  // ---------------------------------------------------------------- pose
  pose(p) {
    const P = p.P, t = p.t, L = p.look;
    P.pitch = 0; P.roll = 0; P.pivot = HIP_Y;
    const m = p.mode;
    if (p.air && !p.air.hop) {
      poseStand(P, t, p.sd);
      const progress = Math.min(1, (p.react?.t || 0) / 0.68);
      P.hipA[0] = 0.35; P.hipA[1] = 0.65; P.hipR[0] = P.hipR[1] = 0.12;
      P.knee[0] = 0.65 + 0.3 * Math.sin(progress * Math.PI); P.knee[1] = 0.85;
      P.foot[0] = 0.3; P.foot[1] = 0.2; P.pelY = HIP_Y - 0.1;
      armsPanic(P, Math.min(0.2, progress)); P.tPitch = 0.2;
      P.roll = p.air.spin * Math.sin(progress * Math.PI);
    } else if (L.role === 'cyclist' && p.moving) poseCycle(P, p.ph);
    else if (p.moving) poseWalk(P, p.ph, L.old ? 0.65 : 1, p.hurry || L.role === 'jogger');
    else if (m === 'sit' && !(p.home && Math.hypot(p.x - p.home.x, p.z - p.home.z) > 0.15)) poseSit(P, t, p.sd * 10, p.sd > 0.3);
    else if (m === 'lie' && !(p.home && Math.hypot(p.x - p.home.x, p.z - p.home.z) > 0.15)) { poseLie(P, t, p.sd); P.pitch = -Math.PI / 2; }
    else if (m === 'swim') { poseSwim(P, t); P.pitch = 1.2; }
    else poseStand(P, t, p.sd, m === 'wait' ? 'look' : p.variant);
    if (p.react && !(p.air && !p.air.hop)) {
      const rt = p.react.t;
      if (p.react.type === 'panic') armsPanic(P, rt);
      else if (p.react.type === 'fist') armsFist(P, rt);
      else if (p.react.type === 'wave') armsWave(P, rt);
      else if (p.react.type === 'recover') {
        const brace = Math.max(0, 1 - rt / 0.42);
        P.pelY -= 0.18 * brace; P.knee[0] += 0.35 * brace; P.knee[1] += 0.35 * brace; P.tPitch += 0.24 * brace;
        if (rt > 0.55) armsFist(P, rt - 0.55);
      }
    }
    if (L.old) { P.tPitch += 0.1; P.hPitch -= 0.06; }
    if (m === 'wait' && !p.react) P.hYaw = 0.75 * Math.sin(t * 0.9 + p.sd * 6);
    let y = p.wy;
    if (m === 'lie' && !p.air) y = p.y + 0.42 + 0.11 - HIP_Y * L.k;
    if (m === 'swim') y = p.y - HIP_Y * L.k - 0.05;
    P.x = p.x; P.y = y; P.z = p.z; P.yaw = p.yaw;
  }
}
