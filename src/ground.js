// What is under the player's wheels once they leave the asphalt: the pavement (up the curb), gravel and dirt
// shoulders, the dirt lay-bys of the coves with their humps, the hillside (drivable until it gets steep; a
// cliff face or a building stops you), and the sea or the lake (splash, sink, back on the road where you left it).
// Heights follow exactly what road.js / terrain.js / buildRoad drew, so the car sits on what you see.
import * as THREE from 'three';
import { ROAD } from './road.js';
import { clamp, lerp, smoothstep } from './util.js';
import { TX } from './tex.js';

// grip and rolling drag per surface (drag in m/s^2 at speed, applied by physics as extra resistance)
// res: Coulomb resistance in m/s^2 (the tyres sinking in and bulldozing the surface; it holds a car at rest until the
// tyres push harder); soft: how readily spinning wheels dig ruts (physics.js: dig)
export const SURF = {
  asphalt: { mu: 1.0, drag: 0, rough: 0, res: 0, soft: 0 },
  pavement: { mu: 0.92, drag: 0.15, rough: 0.35, res: 0, soft: 0 },
  verge: { mu: 0.7, drag: 0.6, rough: 0.6, res: 0.15, soft: 0.15 },
  gravel: { mu: 0.72, drag: 0.6, rough: 0.7, res: 0.2, soft: 0.25 },
  dirt: { mu: 0.68, drag: 0.8, rough: 0.9, res: 0.25, soft: 0.3 },
  scrub: { mu: 0.6, drag: 1.4, rough: 1, res: 0.4, soft: 0.2 },
  sand: { mu: 0.6, drag: 0.8, rough: 0.6, res: 0.45, soft: 1 },
  rock: { mu: 0.75, drag: 0.5, rough: 1, res: 0, soft: 0 },
  water: { mu: 0.15, drag: 9, rough: 0, res: 0, soft: 0 },
};
const MAX_CLIMB = 0.5;    // steepest hillside a road car will drive up (~27 deg); steeper is a wall
const MAX_ABOVE = 9;      // the hillside stops being drivable this far above the road (scrub, boulders, terraces);
                          // the brush gets thicker (drag) for the last few metres so you feel it coming
const MAX_OFF = 45;       // ... or this far out from the road edge
const STEP_UP = 0.32;     // a ledge higher than this between two substeps is a wall (curbs are 0.16 m)
const WATER_Y = -0.05;    // sea level as the water mesh draws it
const CURB_REF = 0.16;    // a full-height town curb; lower kerbs (out of town, the median's edge) hit softer

export class Ground {
  constructor(map, heightC, assets) {
    const { route, data, terrain } = map;
    this.route = route; this.terrain = terrain; this.heightC = heightC;
    this.humps = data.humps || [];
    // spatial hashes: humps (5 m), building walls (20 m)
    this.HC = 20; this.hh = new Map();
    for (const h of this.humps) this._put(this.hh, h[0], h[1], h[2] + 1, h);
    this.bh = new Map();
    for (const b of data.buildings) {
      if (Math.abs(b.u) > 160 || b.k === 'roof') continue;
      const p = b.p, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, seg = [p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]];
        this._put(this.bh, (seg[0] + seg[2]) / 2, (seg[1] + seg[3]) / 2, Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) / 2 + 2, seg);
      }
    }
    // street-lamp posts (road.js plants one every 36 m in town: on the median where the avenue divides, else on the
    // right-hand kerb): 0.3 m steel squares, so they stop a car like the buildings do
    for (let s = 10; s < route.length; s += 36) {
      if (route.urban(s) < 0.4) continue;
      const u = route.div(s) > 0.6 && route.medHalf(s) > 1.2 ? 0 : route.edge(s) + ROAD.gutter + 0.6;
      const p = route.point(s, u), r = 0.15;
      const q = [[-r, -r], [r, -r], [r, r], [-r, r]];
      for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; this._put(this.bh, p.x, p.z, 2, [p.x + a[0], p.z + a[1], p.x + b[0], p.z + b[1]]); }
    }
    // guard rails: hard u limits per side, per 2 m of route
    const N = Math.ceil(route.length / 2) + 1;
    this.railR = new Float32Array(N).fill(1e9); this.railL = new Float32Array(N).fill(1e9);
    for (const r of assets.rails || []) for (const q of r.pts) { const i = Math.round(q.s / 2); if (i >= 0 && i < N) (r.side > 0 ? this.railR : this.railL)[i] = q.u; }
    for (const b of data.barriers || []) for (let s = b.s0; s <= b.s1; s += 2) { const i = Math.round(s / 2); if (i >= 0 && i < N) (b.side > 0 ? this.railR : this.railL)[i] = Math.min((b.side > 0 ? this.railR : this.railL)[i], barrierU(route, s) - 0.3); }
    this.out = { y: 0, surf: 'asphalt', water: 0, nx: 0, nz: 0 };
  }
  _put(map, x, z, r, item) {
    const C = this.HC, x0 = Math.floor((x - r) / C), x1 = Math.floor((x + r) / C), z0 = Math.floor((z - r) / C), z1 = Math.floor((z + r) / C);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i * 100003 + j; let b = map.get(k); if (!b) map.set(k, b = []); if (!b.includes(item)) b.push(item); }
  }
  _cell(map, x, z) { return map.get(Math.floor(x / this.HC) * 100003 + Math.floor(z / this.HC)); }
  /** dirt humps: smooth cosine mounds [x, z, radius, height] */
  hump(x, z) {
    const b = this._cell(this.hh, x, z); if (!b) return 0;
    let h = 0;
    for (const q of b) { const d = Math.hypot(x - q[0], z - q[1]) / q[2]; if (d < 1) h = Math.max(h, q[3] * (0.5 + 0.5 * Math.cos(d * Math.PI))); }
    return h;
  }
  /** ground under a world point; s/u its route coordinates */
  at(x, z, s, u, out = this.out) {
    const route = this.route, au = Math.abs(u), side = u >= 0 ? 1 : -1;
    const sc = clamp(s, 0, route.length);
    const e = route.edge(sc), eA = e + ROAD.gutter;
    out.water = 0; out.hump = 0;
    if (au <= eA) {
      out.y = route.surfaceY(sc, u); out.surf = 'asphalt';
      // the raised median island where the avenue divides (road.js draws it 0.2 m high, planted)
      const mh = route.medHalf(sc), mhH = 0.2 * smoothstep(0.25, 0.6, route.div(sc));
      if (au < mh && mhH > 0.03) { out.y += mhH; out.surf = mh > 0.6 ? 'verge' : 'pavement'; }
      return out;
    }
    const ch = ROAD.curbH(route, sc), sw = ROAD.sidewalk(route, sc, side);
    const yTop = route.surfaceY(sc, side * eA) + ch, uo = eA + 0.18 + sw;
    const urb = route.urban(sc);
    if (au <= uo) { out.y = yTop + 0.02 * (au - eA) / (uo - eA); out.surf = urb > 0.5 ? 'pavement' : 'gravel'; return out; }
    let th = this.heightC(x, z);
    const hp = this.hump(x, z);
    // the skirt road.js draws from the pavement edge down (or up) to the terrain
    const yb = Math.min(yTop - 0.1, th - 0.25), skirt = 1.0 + Math.max(0, yTop - yb) * 0.6;
    let y = au < uo + skirt ? lerp(yTop, Math.max(yb, th), smoothstep(0, 1, (au - uo) / skirt)) : th;
    y += hp; out.hump = hp;
    const cls = this.terrain.cls(x, z);
    out.surf = hp > 0.02 ? 'dirt' : cls === 1 ? 'sand' : cls === 2 ? 'rock' : cls === 3 || cls === 6 ? 'scrub' : cls === 4 || cls === 5 ? 'gravel' : 'dirt';
    if (y < WATER_Y) { out.water = WATER_Y - y; out.surf = cls === 1 ? 'sand' : 'water'; }
    out.y = y;
    return out;
  }
  /** hard u limits (car centre) from guard rails; elsewhere the edge of the drivable world */
  limits(s, halfW, out) {
    const i = clamp(Math.round(s / 2), 0, this.railR.length - 1);
    out.max = Math.min(this.railR[i] - 0.25 - halfW, 140); out.min = -Math.min(this.railL[i] - 0.25 - halfW, 140);
    return out;
  }
  /** push a circle (x, z, r) out of building walls; returns the wall normal of the deepest contact or null */
  walls(x, z, r, out) {
    const b = this._cell(this.bh, x, z) || [];
    let best = 0, nx = 0, nz = 0;
    for (const g of b) {
      const dx = g[2] - g[0], dz = g[3] - g[1], L2 = dx * dx + dz * dz || 1e-6;
      const t = clamp(((x - g[0]) * dx + (z - g[1]) * dz) / L2, 0, 1);
      const px = g[0] + dx * t, pz = g[1] + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < r && r - d > best) { best = r - d; nx = (x - px) / (d || 1); nz = (z - pz) / (d || 1); }
    }
    // parked cars: oriented boxes
    if (this.parked && !this._ph) { this._ph = new Map(); for (const c of this.parked) this._put(this._ph, c.x, c.z, c.hl + 1, c); }
    const pc = this._ph && this._cell(this._ph, x, z);
    if (pc) for (const c of pc) {
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), dx = x - c.x, dz = z - c.z;
      const lf = dx * fx + dz * fz, lr = dx * -fz + dz * fx; // along / across the car
      const cf = clamp(lf, -c.hl, c.hl), cr = clamp(lr, -c.hw, c.hw);
      let ex = lf - cf, er = lr - cr, d = Math.hypot(ex, er), pen;
      if (d < 1e-4) { // centre inside the box: out through the nearer side
        if (c.hl - Math.abs(lf) < c.hw - Math.abs(lr)) { ex = Math.sign(lf) || 1; er = 0; pen = c.hl - Math.abs(lf) + r; } else { ex = 0; er = Math.sign(lr) || 1; pen = c.hw - Math.abs(lr) + r; }
        d = 1;
      } else pen = r - d;
      if (pen > best) { best = pen; nx = (ex * fx - er * fz) / d; nz = (ex * fz + er * fx) / d; }
    }
    if (!best) return null;
    out.pen = best; out.nx = nx; out.nz = nz; return out;
  }
  /** is a step from height y0 to y1 over distance d too steep to drive? (cliff faces, retaining walls) */
  blocked(y0, y1, d) { return y1 - y0 > STEP_UP + MAX_CLIMB * d; }

  /** stop the car's centre against a wall with outward normal (nx, nz): slide along it, lose some speed */
  _hit(v, nx, nz, pen) {
    v.x += nx * pen; v.z += nz * pen;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const wvx = fx * v.vLong + rx * v.vLat, wvz = fz * v.vLong + rz * v.vLat;
    const vn = -(wvx * nx + wvz * nz); // speed into the wall
    if (vn <= 0) return;
    const keep = 1 - Math.min(0.45, vn * 0.03);
    const tx = wvx + nx * vn, tz = wvz + nz * vn; // tangential part
    const nvx = tx * keep + nx * vn * 0.15, nvz = tz * keep + nz * vn * 0.15;
    v.vLong = nvx * fx + nvz * fz; v.vLat = nvx * rx + nvz * rz;
    v.w *= 1 - Math.min(0.6, vn * 0.05);
    if (vn > v.wallHit) { v.wallNx = nx; v.wallNz = nz; }
    v.wallHit = Math.max(v.wallHit, vn);
    v.pose.rollV += vn * 0.2 * Math.sign(nx * rx + nz * rz); v.pose.heaveV += vn * 0.04;
    if (v.syncWheels) v.syncWheels(); else for (const W of v.corners || v.wheel) W.vw = v.vLong;
  }
  /**
   * Curbs: each wheel that crosses a kerb line (the pavement edge either side, the median island) takes a hit at its
   * contact point. Square on, the tyre climbs: it loses part of its speed into the kerb face (an impulse at the wheel,
   * so a front wheel clipping it also yaws the car), the body bounces and rolls, the steering kicks. A glancing touch
   * at speed can't climb a full-height kerb: the tyre wall rubs along it and bounces back off the face. Coming down
   * off a kerb is a drop. Hard hits bend the suspension on that side (side damage -> toe pull).
   */
  _curbs(v) {
    const route = this.route, sc = clamp(v.s, 0, route.length);
    const f = route.frame(sc, v._f || (v._f = {}));
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const fr = fx * f.rx + fz * f.rz, rr = rx * f.rx + rz * f.rz; // the car's axes across the road
    const eA = route.edge(sc) + ROAD.gutter, chE = ROAD.curbH(route, sc);
    const mh = route.medHalf(sc), chM = 0.2 * smoothstep(0.25, 0.6, route.div(sc));
    // zone of each wheel: 0 roadway, 2 / -2 pavement right / left, 1 median island
    const zone = (u) => Math.abs(u) > eA ? (chE > 0.03 ? 2 * Math.sign(u) : 0) : Math.abs(u) < mh && chM > 0.03 ? 1 : 0;
    const prev = v._curbZ || (v._curbZ = [9, 9, 9, 9]);
    const t2 = v.track / 2;
    for (let i = 0; i < 4; i++) {
      const cx = i < 2 ? v.a : -v.b, cy = i & 1 ? t2 : -t2;
      const u = v.u + cx * fr + cy * rr, z = zone(u), was = prev[i];
      prev[i] = z;
      if (z === was || was === 9 || v.air) continue;
      const up = Math.abs(z) > Math.abs(was) || (z === 1 && was === 0); // onto the raised side
      const h = (z === 1 || was === 1 ? chM : chE), sev = Math.min(1.3, h / CURB_REF);
      // the kerb face's normal (world), pointing from the road onto the raised side
      const kerbU = z === 1 || was === 1 ? Math.sign(u) * mh : Math.sign(u) * eA;
      const nside = z === 1 || was === 1 ? -Math.sign(u) : Math.sign(u);
      const nx = f.rx * nside, nz = f.rz * nside;
      // contact-point velocity (body: x forward, y right; yaw rate w > 0 turns right) and its part into the kerb
      const vxp = v.vLong - v.w * cy, vyp = v.vLat + v.w * cx;
      const pvx = fx * vxp + rx * vyp, pvz = fz * vxp + rz * vyp;
      const vn = (pvx * nx + pvz * nz) * (up ? 1 : -1); // > 0: moving onto / off the raised side
      const vAlong = Math.abs(v.vLong);
      if (vn <= 0.02) continue;
      // impulse along the normal at the wheel: body-frame components, effective mass at that point
      const jx = (nx * fx + nz * fz) * (up ? -1 : 1), jy = (nx * rx + nz * rz) * (up ? -1 : 1); // direction opposing the motion
      const arm = cx * jy - cy * jx;
      const meff = 1 / (1 / v.m + arm * arm / v.Iz);
      if (up) {
        const glance = vn < 0.9 * sev && vAlong > 6 && sev > 0.6;
        // climbing takes ~35% (full kerb) of the speed into it at that corner; a glancing tyre bounces back off
        const J = meff * vn * (glance ? 1.35 : 0.35 * sev);
        v.vLong += J * jx / v.m; v.vLat += J * jy / v.m; v.w += J * arm / v.Iz;
        if (glance) { // stays on the road: put the wheel back on this side of the kerb line
          const pen = Math.abs(u - kerbU) + 0.02;
          v.x -= nx * pen; v.z -= nz * pen; v.u -= nside * pen; prev[i] = was;
        } else {
          // rolling up the step costs some of the forward speed too (the wheel has to lift the corner)
          v.vLong *= 1 - 0.012 * sev * Math.min(1, vAlong / 8);
          const k = sev * Math.min(1, (vAlong + vn * 2) / 14);
          v.pose.heaveV += 0.5 * k; v.pose.pitchV += (cx > 0 ? -0.35 : 0.25) * k; v.pose.rollV += (cy > 0 ? 0.6 : -0.6) * k;
          if (cx > 0) v.steer += (cy > 0 ? -1 : 1) * 0.04 * k; // the rack kicks against the hit wheel
          if (vn > 7) v.addDamage?.(cy > 0 ? 'right' : 'left', (vn - 7) * 0.9 + 2.2, { kind: 'wall' });
        }
        const hit = clamp((glance ? 0.25 : 0.35) * sev + vn * 0.06 + vAlong * 0.008, 0, 1);
        v.bumpHit = Math.max(v.bumpHit, hit); v.curbHit = Math.max(v.curbHit || 0, hit);
        v.curbX = v.x + fx * cx + rx * cy; v.curbZ = v.z + fz * cx + rz * cy; v.curbScrape = glance;
      } else {
        // dropping off: the wheel falls the kerb's height, a thump through the spring
        const k = sev * Math.min(1, vAlong / 10);
        v.pose.heaveV -= 0.3 * k; v.pose.rollV += (cy > 0 ? -0.35 : 0.35) * k;
        v.bumpHit = Math.max(v.bumpHit, 0.3 * k); v.curbHit = Math.max(v.curbHit || 0, 0.25 * k);
      }
    }
  }
  /** everything after the integrator moved the player's car: route frame, walls, ground height, surface, water */
  resolve(v, dt) {
    const route = this.route;
    let pr = route.project(v.x, v.z, v.s, 6);
    if (Math.abs(pr.u) > 30) pr = route.project(v.x, v.z, null); // far off the road: re-find the nearest stretch
    v.s = pr.s; v.u = pr.u;
    // guard rails (the only walls the road itself has)
    const lim = this.limits(v.s, v.halfW, v._lim || (v._lim = {}));
    if (v.u > lim.max || v.u < lim.min) {
      const f = route.frame(v.s, v._f || (v._f = {})), side = v.u > lim.max ? 1 : -1;
      this._hit(v, -f.rx * side, -f.rz * side, side > 0 ? v.u - lim.max : lim.min - v.u);
      v.u = side > 0 ? lim.max : lim.min;
    }
    // buildings and parked cars: two circles along the body
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), r = v.halfW + 0.05, w = this._w || (this._w = {});
    for (const k of [v.halfL - r, -(v.halfL - r)]) {
      const c = this.walls(v.x + fx * k, v.z + fz * k, r, w);
      if (c) this._hit(v, c.nx, c.nz, c.pen);
    }
    this._curbs(v);
    // the ground: too steep to climb (cliff face, retaining wall, a building's plinth) acts as a wall
    let g = this.at(v.x, v.z, v.s, v.u, this.out);
    const px = v._gx ?? v.x, pz = v._gz ?? v.z, py = v._gy ?? g.y, d = Math.hypot(v.x - px, v.z - pz);
    const gy = g.y - g.hump, pgy = v._gt ?? gy;
    const tooHigh = gy - route.y(clamp(v.s, 0, route.length)) > MAX_ABOVE && gy > pgy;
    const tooFar = Math.abs(v.u) - route.edge(clamp(v.s, 0, route.length)) > MAX_OFF && Math.abs(v.u) > Math.abs(v._gu ?? 0);
    if (d > 1e-4 && (this.blocked(pgy, gy, d) || tooHigh || tooFar)) {
      // wall normal from the terrain gradient
      const e = 0.8, q = this._q || (this._q = {});
      const hx = this.at(v.x + e, v.z, v.s, v.u, q).y - this.at(v.x - e, v.z, v.s, v.u, q).y;
      const hz = this.at(v.x, v.z + e, v.s, v.u, q).y - this.at(v.x, v.z - e, v.s, v.u, q).y;
      const L = Math.hypot(hx, hz) || 1;
      v.x = px; v.z = pz;
      this._hit(v, -hx / L, -hz / L, 0.02);
      pr = route.project(v.x, v.z, v.s, 6); v.s = pr.s; v.u = pr.u;
      g = this.at(v.x, v.z, v.s, v.u, this.out);
    }
    const S = SURF[g.surf] || SURF.dirt;
    // height, and the attitude of the ground under the wheelbase (grade along the car, bank across it)
    // the ground under each wheel: a car astride a kerb sits on all four, tilted
    const q = this._q || (this._q = {}), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw), t2 = v.track / 2;
    const wy = this._wy || (this._wy = [0, 0, 0, 0]), ws = this._ws || (this._ws = ['', '', '', '']);
    for (let i = 0; i < 4; i++) {
      const cx = i < 2 ? v.a : -v.b, cy = i & 1 ? t2 : -t2, a = this.at(v.x + fx * cx + rx * cy, v.z + fz * cx + rz * cy, v.s, v.u, q);
      wy[i] = a.y; ws[i] = a.surf;
    }
    const yF = (wy[0] + wy[1]) / 2, yB = (wy[2] + wy[3]) / 2, yR = (wy[1] + wy[3]) / 2, yL = (wy[0] + wy[2]) / 2;
    const astride = ws[0] !== ws[1] || ws[2] !== ws[3] || ws[0] !== ws[2] || ws[0] !== g.surf;
    const onRoad = g.surf === 'asphalt' && !astride;
    v.wheelSurf = ws;
    v.gradeG = onRoad ? undefined : clamp((yF - yB) / v.wb, -0.8, 0.8);
    v.grade = onRoad ? route.frame(v.s, v._f || (v._f = {})).grade : v.gradeG;
    v.bank = onRoad ? route.bank(v.s) : clamp((yR - yL) / v.track, -0.6, 0.6);
    // crests launch you: off the tarmac, when the ground falls away under the car faster than gravity could follow
    // (vertical speed from the ground slope under the wheelbase, so curbs and steps don't count as ramps)
    const yG = onRoad ? g.y : astride ? (yF + yB) / 2 : Math.max(g.y, (yF + yB) / 2);
    if (v.air === undefined) { v.air = 0; v.vy = 0; v.yAir = yG; }
    const paved = onRoad || g.surf === 'pavement' || g.surf === 'asphalt' || g.surf === 'verge';
    const vyS = paved ? 0 : clamp((yF - yB) / v.wb * v.vLong, -20, 20);
    if (v.air) {
      v.vy -= 9.81 * dt; v.yAir += v.vy * dt;
      if (v.yAir <= yG) { v.bumpHit = Math.max(v.bumpHit, clamp((vyS - v.vy) * 0.12, 0, 1)); v.pose.heaveV += Math.min(0, v.vy - vyS) * 0.05; v.air = 0; v.yAir = yG; }
      v.y = Math.max(v.yAir, yG);
    } else if (!paved && v.vy > vyS + 9.81 * dt * 1.3 && v.vy > 1.2) {
      v.air = 1; v.yAir = v._gy ?? yG; v.y = yG;
    } else v.y = yG;
    if (!v.air) v.vy = vyS;
    v._gx = v.x; v._gz = v.z; v._gy = v.y; v._gt = g.y - g.hump; v._gu = v.u;
    // grip / drag (airborne: no grip), water
    // grip and resistance: the average over the four contact patches (a car with two wheels in the sand feels it)
    let mu = 0, dr = 0, res = 0, soft = 0;
    for (let i = 0; i < 4; i++) { const W = SURF[ws[i]] || SURF.dirt; mu += W.mu / 4; dr += W.drag / 4; res += (W.res || 0) / 4; soft += (W.soft || 0) / 4; }
    v.surf = g.surf; v.surfMu = v.air ? 0.02 : mu; v.surfDrag = dr; v.surfRes = v.air ? 0 : res; v.surfSoft = v.air ? 0 : soft;
    if (!paved) { // thick maquis up the hillside / far from the road
      const sc = clamp(v.s, 0, route.length);
      const ex = Math.max(0, gy - route.y(sc) - (MAX_ABOVE - 4)) + Math.max(0, (Math.abs(v.u) - route.edge(sc) - (MAX_OFF - 12)) / 3);
      if (ex > 0) { v.surfDrag += Math.min(5, ex * 2.2); v.surfMu *= Math.max(0.55, 1 - ex * 0.08); if (g.surf === 'dirt') v.surf = 'scrub'; }
    }
    v.offroad = onRoad || g.surf === 'pavement' || g.surf === 'asphalt' ? 0 : 1;
    // dug in: the car settles into its ruts
    if (v.dig > 0 && !v.air) v.y -= 0.12 * v.dig;
    v.water = g.water;
    if (g.water > 0) { v.sink = Math.min(1, (v.sink || 0) + dt * 0.45); v.y = Math.max(g.y, WATER_Y - 0.35 - 1.2 * v.sink); v.surfDrag = SURF.water.drag; }
    else v.sink = 0;
    // last place you were safely on the road, for the respawn
    if (onRoad && Math.abs(v.u) < route.edge(v.s) && v.s > 0 && v.s < route.length) { if (!v.safe) v.safe = {}; v.safe.s = v.s; v.safe.u = v.u; }
  }
}

// lateral position of a concrete barrier's face: on the outer edge of the shoulder
export const barrierU = (route, s) => route.edge(s) + ROAD.gutter + 0.9;

// ------------------------------------------------------------------ New Jersey concrete barriers (visual)
export function buildBarriers(map, scene) {
  const list = map.data.barriers || [];
  if (!list.length) return null;
  const route = map.route;
  // NJ profile (u across from the road-side face, y up): 0.81 m tall, 0.61 m base, 0.15 m top
  const prof = [[0, 0], [0, 0.075], [0.05, 0.33], [0.23, 0.81], [0.38, 0.81], [0.56, 0.33], [0.61, 0.075], [0.61, 0]];
  const pos = [], idx = [], col = [], uv = [];
  const c = new THREE.Color(), pt = new THREE.Vector3();
  for (const b of list) {
    let row = 0;
    for (let s = b.s0; s <= b.s1 + 0.01; s += 1) {
      const u0 = barrierU(route, s), base = route.surfaceY(s, b.side * u0);
      const seg = Math.floor((s - b.s0) / 6); // 6 m precast units: a dark joint every unit
      for (const [du, h] of prof) {
        route.point(s, b.side * (u0 + du), pt);
        pos.push(pt.x, base + h, pt.z); uv.push((s - b.s0) / 1.5, (du + h) / 1.5);
        const joint = (s - b.s0) % 6 < 1 ? 0.7 : 1, dirt = 0.82 + 0.18 * Math.min(1, h * 2.5) - 0.05 * ((seg * 7) % 3);
        c.set('#f2efe8').multiplyScalar(joint * dirt); col.push(c.r, c.g, c.b);
      }
      if (row > 0) {
        const n = prof.length, a0 = (pos.length / 3) - 2 * n;
        for (let k = 0; k + 1 < n; k++) { const a = a0 + k, bb = a + 1, d = a + n, e = d + 1; if (b.side > 0) idx.push(a, d, bb, bb, d, e); else idx.push(a, bb, d, bb, e, d); }
      }
      row++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // make the faces point outwards: the road-side slope (profile vertex 2) must face back towards the road
  {
    const b = list[0], nrm = g.attributes.normal, f = route.frame(b.s0 + 2, {});
    const k = 2 * prof.length + 2; // second row, vertex 2
    if ((nrm.getX(k) * f.rx + nrm.getZ(k) * f.rz) * b.side > 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map: TX.concrete_diff || null, normalMap: TX.concrete_nor || null });
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; scene.add(m);
  return m;
}

// ------------------------------------------------------------------ dirt humps (visual)
// the same cosine mounds the physics drives over, as meshes of dry packed earth with tyre ruts
export function buildHumps(map, scene, heightC) {
  const humps = map.data.humps || [];
  if (!humps.length) return null;
  const pos = [], uv = [], idx = [], col = [];
  const RINGS = 9, SEG = 22, c = new THREE.Color();
  for (const [x, z, r, h, seed] of humps) {
    const base = pos.length / 3;
    for (let i = 0; i <= RINGS; i++) {
      const d = i / RINGS;
      for (let k = 0; k < SEG; k++) {
        const a = k / SEG * Math.PI * 2 + seed;
        // slightly irregular outline (bulldozed spoil, not a dome)
        const wob = 1 + 0.12 * Math.sin(a * 3 + seed * 5) + 0.06 * Math.sin(a * 7 + seed);
        const rr = d * r * (i === RINGS ? wob : lerp(1, wob, d));
        const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
        const y = heightC(px, pz) + h * (0.5 + 0.5 * Math.cos(Math.min(1, rr / r) * Math.PI)) + (i === RINGS ? -0.08 : 0.02);
        pos.push(px, y, pz); uv.push(px / 3.2, pz / 3.2);
        const t = 0.85 + 0.15 * Math.sin(px * 1.7 + pz * 2.3) * (1 - d);
        c.set('#9a8565').multiplyScalar(t); col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < RINGS; i++) for (let k = 0; k < SEG; k++) {
      const a = base + i * SEG + k, b = base + i * SEG + (k + 1) % SEG, cc = a + SEG, dd = b + SEG;
      idx.push(a, cc, b, b, cc, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: TX.ground_diff || null, normalMap: TX.ground_nor || null, vertexColors: true, roughness: 0.97 });
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true;
  scene.add(m);
  return m;
}

// ------------------------------------------------------------------ splash: spray, foam ring, droplets
export class Splash {
  constructor(scene) {
    const N = this.N = 420;
    const g = new THREE.BufferGeometry();
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.life = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const c = dot.getContext('2d'), gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(240,248,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false, color: '#eef6fa' }));
    this.pts.frustumCulled = false; this.pts.visible = false; scene.add(this.pts);
    const ringGeo = new THREE.RingGeometry(0.8, 1.6, 40); ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#f4fbff', transparent: true, opacity: 0, depthWrite: false }));
    this.ring.visible = false; scene.add(this.ring);
    this.t = 9; this.k = 0;
  }
  burst(x, z, vx, vz, power = 1) {
    const n = Math.round(clamp(power, 0.3, 1) * this.N);
    for (let i = 0; i < n; i++) {
      const k = (this.k++) % this.N, a = Math.random() * Math.PI * 2, r = Math.random() * 1.6;
      this.p[k * 3] = x + Math.cos(a) * r; this.p[k * 3 + 1] = WATER_Y + 0.1; this.p[k * 3 + 2] = z + Math.sin(a) * r;
      const out = 1.5 + Math.random() * 4 * power, up = 2 + Math.random() * 7 * power;
      this.v[k * 3] = Math.cos(a) * out + vx * 0.35; this.v[k * 3 + 1] = up; this.v[k * 3 + 2] = Math.sin(a) * out + vz * 0.35;
      this.life[k] = 0.8 + Math.random() * 1.2;
    }
    this.ring.position.set(x, WATER_Y + 0.04, z); this.ring.scale.setScalar(1); this.ring.visible = true; this.pts.visible = true; this.t = 0;
  }
  update(dt) {
    if (this.t > 4) return;
    this.t += dt;
    for (let k = 0; k < this.N; k++) {
      if (this.life[k] <= 0) { this.p[k * 3 + 1] = -999; continue; }
      this.life[k] -= dt; this.v[k * 3 + 1] -= 9.81 * dt;
      for (let a = 0; a < 3; a++) this.p[k * 3 + a] += this.v[k * 3 + a] * dt;
      if (this.p[k * 3 + 1] < WATER_Y) this.life[k] = 0;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.ring.scale.setScalar(1 + this.t * 3.5); this.ring.material.opacity = Math.max(0, 0.75 - this.t * 0.3);
    if (this.t > 4) { this.pts.visible = false; this.ring.visible = false; }
  }
}
