// What is under the player's wheels once they leave the asphalt: the pavement (up the curb), gravel and dirt
// shoulders, the dirt lay-bys of the coves with their humps, the hillside (drivable until it gets steep; a
// cliff face or a building stops you), and the sea or the lake (splash, sink, back on the road where you left it).
// Heights follow exactly what road.js / terrain.js / buildRoad drew, so the car sits on what you see.
import * as THREE from 'three';
import { ROAD } from './road.js';
import { wheelGround } from './wheel-ground.js';
import { clamp, lerp, smoothstep } from './util.js';
import { TX } from './tex.js';

// grip and rolling drag per surface (drag in m/s^2 at speed, applied by physics as extra resistance)
// res: Coulomb resistance in m/s^2 (the tyres sinking in and bulldozing the surface; it holds a car at rest until the
// tyres push harder); soft: how readily spinning wheels dig ruts (physics.js: dig)
export const SURF = {
  asphalt: { mu: 1.0, drag: 0, rough: 0, res: 0, soft: 0 },
  pavement: { mu: 0.92, drag: 0.15, rough: 0.35, res: 0, soft: 0 },
  verge: { mu: 0.65, peak: 1.35, slide: 0.94, slideV: 0.025, drag: 0.6, rough: 0.6, res: 0.15, soft: 0.15 },
  gravel: { mu: 0.56, peak: 1.5, slide: 0.95, slideV: 0.02, drag: 0.6, rough: 0.7, res: 0.2, soft: 0.25 },
  dirt: { mu: 0.67, peak: 1.35, slide: 0.94, slideV: 0.025, drag: 0.8, rough: 0.9, res: 0.25, soft: 0.3 },
  scrub: { mu: 0.5, peak: 1.45, slide: 0.94, slideV: 0.025, drag: 1.4, rough: 1, res: 0.4, soft: 0.2 },
  sand: { mu: 0.6, traction: 0.78, drag: 0.7, rough: 0.6, res: 0.3, soft: 0.5 },
  deepsand: { mu: 0.56, traction: 0.74, drag: 0.9, rough: 0.5, res: 0.3, soft: 0.55, bow: 0.05 }, // slow runoff; a road car can still drive back out
  grass: { mu: 0.5, peak: 1.45, slide: 0.94, slideV: 0.025, drag: 0.9, rough: 0.7, res: 0.2, soft: 0.15 },
  rock: { mu: 0.75, drag: 0.5, rough: 1, res: 0, soft: 0 },
  water: { mu: 0.15, drag: 9, rough: 0, res: 0, soft: 0 },
};
// the weather's say in it (weather.js writes these; they stay at clear-day values without it): gripScale scales
// tarmac grip in the rain (soft ground much less, sand not at all), wet 0..1 (lighter skid marks, little tyre smoke),
// ambient 0..1 light level (night darkens the unlit smoke / dust sprites in fx.js)
import { WEATHER } from './wet-grip.js';
export { WEATHER } from './wet-grip.js';
const WET_K = { asphalt: 1, pavement: 1, rock: 1, verge: 0.4, gravel: 0.4, dirt: 0.5, scrub: 0.4, sand: 0.2, deepsand: 0.2, water: 0 }; // rain packs nothing here: sand only gets (a little) worse
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
    this.network = assets.network || null;
    this.circuit = data.circuit || {};
    this.pavedAreas = (this.circuit.pavedAreas || []).map(area => ({...area, p: Array.isArray(area.p[0]) ? area.p.flat() : area.p}));
    this.humps = data.humps || [];
    // spatial hashes: humps (5 m), building walls (20 m)
    this.HC = 20; this.hh = new Map();
    for (const h of this.humps) this._put(this.hh, h[0], h[1], h[2] + 1, h);
    this.bh = new Map();
    for (const b of data.buildings) {
      if (!this.network && Math.abs(b.u) > 160 || b.k === 'roof') continue;
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
      if (this.network?.sample(p.x, p.z)) continue;
      const q = [[-r, -r], [r, -r], [r, r], [-r, r]];
      for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; this._put(this.bh, p.x, p.z, 2, [p.x + a[0], p.z + a[1], p.x + b[0], p.z + b[1]]); }
    }
    // guard rails: hard u limits per side, per 2 m of route
    const N = Math.ceil(route.length / 2) + 1;
    this.railR = new Float32Array(N).fill(1e9); this.railL = new Float32Array(N).fill(1e9);
    for (const r of assets.rails || []) for (const q of r.pts) { const i = Math.round(q.s / 2); if (i >= 0 && i < N) (r.side > 0 ? this.railR : this.railL)[i] = q.u; }
    for (const b of data.barriers || []) for (let s = b.s0; s <= b.s1; s += 2) { const i = Math.round(s / 2); if (i >= 0 && i < N) (b.side > 0 ? this.railR : this.railL)[i] = Math.min((b.side > 0 ? this.railR : this.railL)[i], barrierU(route, s) - 0.3); }
    this.out = { y: 0, surf: 'asphalt', water: 0, nx: 0, nz: 0 };
    this.traps = []; if (!map.id || map.id === 'riviera') this._placeTraps(map.data);
  }
  _put(map, x, z, r, item) {
    const C = this.HC, x0 = Math.floor((x - r) / C), x1 = Math.floor((x + r) / C), z0 = Math.floor((z - r) / C), z1 = Math.floor((z + r) / C);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i * 100003 + j; let b = map.get(k); if (!b) map.set(k, b = []); if (!b.includes(item)) b.push(item); }
  }
  _cell(map, x, z) { return map.get(Math.floor(x / this.HC) * 100003 + Math.floor(z / this.HC)); }
  /**
   * Sand traps: soft, deep, dry sand ('deepsand') that you can drive into from the road and dig yourself into.
   * Ragged ellipses (x, z, half-length a along yaw, half-width b), a dune is also a steep mound of height h.
   * Placed from the map at load (_placeTraps): the seaward end of the dirt beach car parks at Limanakia, Varkiza and
   * Lomvarda, a soft run-off on the outside of the fastest open bend, a dune bank on a beach by the road.
   * Returns { t: trap, h: height added } or null.
   */
  trap(x, z) {
    for (const t of this.traps) {
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz > t.R2) continue;
      const lx = (dx * t.c + dz * t.s) / t.a, lz = (-dx * t.s + dz * t.c) / t.b, d = Math.hypot(lx, lz), th = Math.atan2(lz, lx);
      const R = 1 + 0.12 * Math.sin(3 * th + t.seed) + 0.06 * Math.sin(7 * th + t.seed * 2);
      if (d >= R) continue;
      const r = this._tr || (this._tr = { t: null, h: 0 });
      r.t = t; r.h = t.h ? t.h * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, d / (R * 0.85)))) : 0;
      return r;
    }
    return null;
  }
  _placeTraps(data) {
    const route = this.route, T = this.traps, L = route.length, lo = Math.max(30, route.start ?? 0), hi = Math.min(L - 30, route.finish ?? L);
    const lim = {}, w = {}, f = {};
    const add = (name, kind, x, z, a, b, yaw, h = 0) => {
      const t = { name, kind, x, z, a, b, c: Math.cos(yaw), s: Math.sin(yaw), h, seed: (x * 0.37 + z * 0.11) % 6.28, R2: (Math.max(a, b) * 1.2) ** 2, entry };
      t.sAt = route.project(x, z, null).s; T.push(t); return t;
    };
    // a spot is good if it's reachable from the road (no guard rail; not up a cliff, nor down in the sea; no building,
    // lamp post or parked car in it). dyMin: how far below the road it may lie (a beach down a bank)
    const spots = data.parkSpots || [];
    const reach = (s, u, half, dyMin = -2.2) => {
      if (s < lo || s > hi) return false;
      this.limits(s, 0.9, lim);
      if (u + half > lim.max || u - half < lim.min) return false;
      const ry = route.y(s);
      for (const k of [-1, -0.5, 0, 0.5, 1]) {
        const uu = u + k * half, p = route.point(s, uu), th = this.heightC(p.x, p.z);
        if (th < WATER_Y + 0.4 || th - ry > 2.2 || th - ry < dyMin || this.walls(p.x, p.z, 1.2, w)) return false;
        if (spots.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 4)) return false;
      }
      return true;
    };
    // ... and you can drive to it: a clear run across the pavement from the road (no parked row, post or wall), and
    // inside the drivable world (MAX_OFF)
    let entry = 0;
    const path = (s, u) => {
      const side = Math.sign(u) || 1, e = route.edge(s) + ROAD.gutter;
      if (Math.abs(u) - route.edge(s) > MAX_OFF - 14) return false;
      for (const ds of [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10, -12, 12]) {
        // a car-wide gap within 12 m either side (between the parked cars, round the lamp post): entry = where
        let ok = true;
        for (let uu = e + 0.5; ok && uu < Math.abs(u) - 2; uu += 1.2) {
          const p = route.point(s + ds, side * uu);
          if (this.walls(p.x, p.z, 1.0, w) || spots.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2.4)) ok = false;
        }
        if (ok) { entry = s + ds; return true; }
      }
      return false;
    };
    const near = (s, d) => T.some((t) => Math.abs(t.sAt - s) < d);
    const outer = (s, side) => route.edge(s) + ROAD.gutter + 0.18 + ROAD.sidewalk(route, s, side);
    const mark = (id) => (data.marks || []).find((q) => q.id === id);
    // the nearest reachable spot beside the road to s0, sea side first (the lower side): {s, uc, entry}
    const shoulder = (s0, range, gap, half) => {
      for (let k = 0; k <= range; k += 10) for (const sg of [1, -1]) {
        const s = s0 + sg * k; if (s < lo + 20 || s > hi - 20 || near(s, 300)) continue;
        const pl = route.point(s, -outer(s, -1) - 6), pr = route.point(s, outer(s, 1) + 6);
        const sea = this.heightC(pl.x, pl.z) < this.heightC(pr.x, pr.z) ? -1 : 1;
        for (const side of [sea, -sea]) {
          const uc = side * (outer(s, side) + gap);
          if (reach(s, uc, half) && path(s, uc)) return { s, uc, entry };
        }
      }
      return null;
    };
    // 1. the dirt beach car parks nearest each stretch of coast: sand drifted in past the parked cars, seaward
    const lots = (data.areas?.parking || []).filter((a) => a.sf === 'dirt' && a.p?.length >= 6).map((a) => {
      let cx = 0, cz = 0; const n = a.p.length / 2; for (let i = 0; i < n; i++) { cx += a.p[i * 2]; cz += a.p[i * 2 + 1]; }
      cx /= n; cz /= n; const pr = route.project(cx, cz, null); let ext = 0;
      for (let i = 0; i < n; i++) ext = Math.max(ext, Math.hypot(a.p[i * 2] - cx, a.p[i * 2 + 1] - cz));
      return { s: pr.s, u: pr.u, ext };
    });
    for (const id of ['limanakia', 'varkiza', 'coast', 'lomvarda']) {
      const m = mark(id); if (!m) continue;
      let best = null, bd = 1300;
      for (const q of lots) {
        if (Math.abs(q.s - m.s) >= bd || near(q.s, 300)) continue;
        const side = Math.sign(q.u) || 1, o = outer(q.s, side);
        for (const du of [2, 5, 8, 11]) {
          const uc = side * Math.max(Math.abs(q.u) + du, o + 4.5);
          if (reach(q.s, uc, 6.5) && path(q.s, uc)) { bd = Math.abs(q.s - m.s); best = { ...q, uc }; break; }
        }
      }
      const nm = m.name === 'ATHINON-SOUNIOU' ? 'Coast road' : m.name;
      if (best) {
        path(best.s, best.uc);
        const fr = route.frame(best.s, f), p = route.point(best.s, best.uc);
        add(nm + ' car park', 'lot', p.x, p.z, clamp(best.ext * 0.4, 8, 12), 6, Math.atan2(fr.tz, fr.tx));
        continue;
      }
      // no usable car park on this stretch: the sandy beach lay-by on the sea side of the road nearest the mark
      const sh = shoulder(m.s, 900, 7.5, 6.5);
      if (sh) { const fr = route.frame(sh.s, f), p = route.point(sh.s, sh.uc); entry = sh.entry; add(nm + ' beach lay-by', 'lot', p.x, p.z, 11, 6, Math.atan2(fr.tz, fr.tx)); }
    }
    // 2. a soft run-off on the outside of the fastest open bend (miss the braking point and you're in it)
    let run = null;
    for (let s = lo + 60; s < hi - 60; s += 5) {
      const a0 = route.frame(s - 30, f), t0x = a0.tx, t0z = a0.tz, a1 = route.frame(s + 30, f);
      const turn = Math.asin(clamp(t0x * a1.tz - t0z * a1.tx, -1, 1)); // > 0 bends right (u+), < 0 left
      const R = 60 / Math.max(1e-3, Math.abs(turn));
      if (R < 70 || R > 260 || route.urban(s) > 0.5 || near(s, 250)) continue;
      const side = turn > 0 ? -1 : 1, uc = side * (outer(s, side) + 1.6 + 10);
      if (!reach(s, uc, 10.5) || !reach(s - 15, uc, 10.5) || !path(s - 15, uc)) continue;
      if (!run || R > run.R) run = { s: s - 8, uc, R }; // the fastest bend that still needs braking
    }
    if (run) { const fr = route.frame(run.s, f), p = route.point(run.s, run.uc); add('Bend run-off', 'runoff', p.x, p.z, 26, 10, Math.atan2(fr.tz, fr.tx)); }
    // 3. a dune on the beach below the road, nearest Varkiza: drive down the bank onto it and the loose mound and the
    // climb back up keep you there (the way out is a tow)
    let dune = null; const mv = mark('varkiza') || mark('limanakia');
    for (let s = lo + 40; s < hi - 40; s += 10) for (const side of [1, -1]) {
      if (near(s, 250)) continue;
      for (let d = 3; d <= 20; d += 3) {
        const uc = side * (outer(s, side) + 1.6 + d + 7), p = route.point(s, uc);
        if (this.terrain.cls(p.x, p.z) !== 1 || !reach(s, uc, 7, -4.8) || !path(s, uc)) continue;
        let sandy = 0; for (const [ox, oz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) sandy += this.terrain.cls(p.x + ox, p.z + oz) === 1 ? 1 : 0;
        const score = sandy * 10 - d - (mv ? Math.abs(s - mv.s) / 100 : 0);
        if (sandy >= 3 && (!dune || score > dune.score)) dune = { s, uc, score };
        break;
      }
    }
    if (dune) path(dune.s, dune.uc);
    // no open beach by the road: a dune bank blown up against the shoulder of the cove nearest Varkiza instead
    else { const sh = shoulder(mv ? mv.s + 400 : (lo + hi) / 2, 3000, 8.5, 7); if (sh) { dune = sh; entry = sh.entry; } }
    if (dune) { const fr = route.frame(dune.s, f), p = route.point(dune.s, dune.uc); add('Beach dune', 'dune', p.x, p.z, 9, 7, Math.atan2(fr.tz, fr.tx), 2.1); }
  }
  /** dirt humps: smooth cosine mounds [x, z, radius, height] */
  hump(x, z) {
    const b = this._cell(this.hh, x, z); if (!b) return 0;
    let h = 0;
    for (const q of b) { const d = Math.hypot(x - q[0], z - q[1]) / q[2]; if (d < 1) h = Math.max(h, q[3] * (0.5 + 0.5 * Math.cos(d * Math.PI))); }
    return h;
  }
  /** ground under a world point; s/u its route coordinates */
  at(x, z, s, u, out = this.out) {
    const route = this.route;
    if (route.localLayout?.contains(s)) { const q=route.project(x,z,s,8); s=q.s; u=q.u; }
    const au = Math.abs(u), side = u >= 0 ? 1 : -1;
    const sc = route.closed ? route.wrap(s) : clamp(s, 0, route.length);
    out.network = false; out.networkStep = 0;
    // Race progress stays in s/u; only the physical contact surface changes off the race carriageway.
    if (au > route.edge(sc) + (route.closed ? 0 : ROAD.gutter) && this.network?.sample(x, z, this._net || (this._net = {}))) {
      const n = this._net;
      out.y = n.y; out.surf = n.surf; out.water = 0; out.hump = 0; out.trap = null;
      out.network = true; out.networkStep = n.step; return out;
    }
    if (route.closed) {
      const edge = route.edge(sc), beyond = au - edge;
      out.water = 0; out.hump = 0; out.trap = null;
      if (beyond <= 0) { out.y = route.surfaceY(sc, u); out.surf = 'asphalt'; return out; }
      const kerb = (route.kerbs || this.circuit.kerbs || []).find(k => k.side === side && sc >= k.s0 && sc <= k.s1);
      if (kerb && beyond < (kerb.width || .85)) {
        out.y = route.surfaceY(sc, u) + (kerb.height || .045) * Math.sin(Math.PI * beyond / (kerb.width || .85));
        out.surf = 'pavement'; return out;
      }
      for (const area of this.pavedAreas) {
        let inside = false; const p = area.p;
        for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
          if ((p[i + 1] > z) !== (p[j + 1] > z) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
        }
        if (inside) { out.y = area.y ?? this.heightC(x,z); out.surf = 'asphalt'; return out; }
      }
      out.y = lerp(route.surfaceY(sc, side * edge), this.heightC(x, z), smoothstep(0, 3, beyond));
      out.surf = beyond < 18 ? 'gravel' : 'dirt'; return out;
    }
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
    const tr = this.traps.length ? this.trap(x, z) : null;
    if (tr) { out.surf = 'deepsand'; y += tr.h; out.hump += tr.h; out.trap = tr.t; } else out.trap = null;
    if (y < WATER_Y) { out.water = WATER_Y - y; out.surf = cls === 1 ? 'sand' : 'water'; }
    out.y = y;
    return out;
  }
  /** hard u limits (car centre) from guard rails; elsewhere the edge of the drivable world */
  limits(s, halfW, out) {
    const i = clamp(Math.round((this.route.closed ? this.route.wrap(s) : s) / 2), 0, this.railR.length - 1);
    const maxOff = this.network ? 800 : 140;
    const mouthR = this.network?.mouth(s, 1, halfW), mouthL = this.network?.mouth(s, -1, halfW);
    out.max = Math.min(mouthR ? Infinity : this.railR[i] - 0.25 - halfW, maxOff); out.min = -Math.min(mouthL ? Infinity : this.railL[i] - 0.25 - halfW, maxOff);
    return out;
  }
  /** push a circle (x, z, r) out of building walls; returns the wall normal of the deepest contact or null */
  walls(x, z, r, out) {
    const b = this._cell(this.bh, x, z) || [];
    let best = 0, nx = 0, nz = 0, collider = null;
    for (const g of b) {
      const dx = g[2] - g[0], dz = g[3] - g[1], L2 = dx * dx + dz * dz || 1e-6;
      const t = clamp(((x - g[0]) * dx + (z - g[1]) * dz) / L2, 0, 1);
      const px = g[0] + dx * t, pz = g[1] + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < r && r - d > best) { best = r - d; nx = (x - px) / (d || 1); nz = (z - pz) / (d || 1); collider = g; }
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
      if (pen > best) { best = pen; nx = (ex * fx - er * fz) / d; nz = (ex * fz + er * fx) / d; collider = c; }
    }
    if (!best) return null;
    out.pen = best; out.nx = nx; out.nz = nz; out.collider = collider; return out;
  }
  /** is a step from height y0 to y1 over distance d too steep to drive? (cliff faces, retaining walls) */
  blocked(y0, y1, d) { return y1 - y0 > STEP_UP + MAX_CLIMB * d; }

  /**
   * stop the car's centre against a wall with outward normal (nx, nz): slide along it, lose some speed. k: where along
   * the body (m forward of the centre) the contact circle sits, when known; otherwise the body corner facing the wall.
   * The crash dents the body there: addDamage with the contact's closing speed, zone, local point and normal.
   */
  _hit(v, nx, nz, pen, k, collider = null) {
    const restitution = clamp(collider?.restitution ?? 0.15, 0, 1);
    // Soft barriers absorb crush energy; apply the square root to EBS, not a second delta-v.
    const damageScale = clamp(collider?.damageScale ?? 1, 0, 1);
    v.x += nx * pen; v.z += nz * pen;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    const wvx = fx * v.vLong + rx * v.vLat, wvz = fz * v.vLong + rz * v.vLat;
    const vn = -(wvx * nx + wvz * nz); // speed into the wall
    if (vn <= 0) return;
    if (v.addDamage) {
      // the direction from the car into the wall, in the body frame (forward / right)
      const dF = -(nx * fx + nz * fz), dR = -(nx * rx + nz * rz);
      const px = k !== undefined ? k + dF * v.halfW : Math.sign(dF) * v.halfL, py = k !== undefined ? dR * v.halfW : Math.sign(dR) * v.halfW;
      // closing speed at that point (yaw rate adds w x r; w > 0 yaws right)
      const vxp = v.vLong - v.w * py, vyp = v.vLat + v.w * px;
      const vc = Math.max(vn, -((fx * vxp + rx * vyp) * nx + (fz * vxp + rz * vyp) * nz));
      const zone = Math.abs(dF) > Math.abs(dR) * 0.8 ? (dF > 0 ? 'front' : 'rear') : (dR > 0 ? 'right' : 'left'); // a 45° corner hit is the nose / tail
      // local frame for the damage model: x right, y up, z backward (three.js, the car faces -z)
      v.addDamage(zone, vc * Math.sqrt(damageScale), { kind: collider?.kind === 'tyre' ? 'tyre' : 'wall', localPoint: { x: py, y: 0.45, z: -px }, localNormal: { x: nx * rx + nz * rz, y: 0, z: -(nx * fx + nz * fz) } });
    }
    const keep = 1 - Math.min(0.45, vn * 0.03);
    const tx = wvx + nx * vn, tz = wvz + nz * vn; // tangential part
    const nvx = tx * keep + nx * vn * restitution, nvz = tz * keep + nz * vn * restitution;
    v.vLong = nvx * fx + nvz * fz; v.vLat = nvx * rx + nvz * rz;
    v.w *= 1 - Math.min(0.6, vn * 0.05);
    if (vn > v.wallHit) { v.wallNx = nx; v.wallNz = nz; }
    v.wallHit = Math.max(v.wallHit, vn);
    if (v.bodyKick) v.bodyKick(vn * 0.04, 0, -vn * 0.2 * Math.sign(nx * rx + nz * rz)); else { v.pose.rollV += vn * 0.2 * Math.sign(nx * rx + nz * rz); v.pose.heaveV += vn * 0.04; }
    if (v.syncWheels) v.syncWheels(); else for (const W of v.corners || v.wheel) W.vw = v.vLong;
  }
  /**
   * Curbs: each wheel that crosses a kerb line (the pavement edge either side, the median island) takes a hit at its
   * contact point. Square on, the tyre climbs: it loses part of its speed into the kerb face (an impulse at the wheel,
   * so a front wheel clipping it also yaws the car), the body bounces and rolls, the steering kicks. A glancing touch
   * at speed can't climb a full-height kerb: the tyre wall rubs along it and bounces back off the face. Coming down
   * off a kerb is a drop. These wheel/ground contacts never consume the crash damage budget.
   */
  _curbs(v) {
    if (this.route.closed) return; // low, rounded circuit kerbs are sampled per wheel in at()
    const route = this.route, sc = (route.closed ? route.wrap(v.s) : clamp(v.s, 0, route.length));
    const f = route.contactFrame?.(sc, v.u, v._f || (v._f = {})) || route.frame(sc, v._f || (v._f = {}));
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
      let u = v.u + cx * fr + cy * rr;
      const wx = v.x + fx * cx + rx * cy, wz = v.z + fz * cx + rz * cy;
      if (route.localLayout?.contains(sc)) u=route.project(wx,wz,sc,8).u;
      const z = this.network?.sample(wx, wz)?.step === 0 && Math.abs(u) > eA ? 0 : zone(u), was = prev[i];
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
        // (a shallow rub: the closing speed scales with road speed, so the limit does too: ~7-8 deg at any speed)
        const glance = vn < (0.3 + 0.12 * vAlong) * sev && vAlong > 6 && sev > 0.6;
        // climbing takes ~35% (full kerb) of the speed into it at that corner; a glancing tyre bounces back off
        const J = meff * vn * (glance ? 1.35 : 0.3 * sev);
        // climbing, part of the blow goes up through the spring rather than round the car's centre
        v.vLong += J * jx / v.m; v.vLat += J * jy / v.m; v.w += J * arm / v.Iz * (glance ? 1 : 0.5);
        if (glance) { // stays on the road: put the wheel back on this side of the kerb line
          const pen = Math.abs(u - kerbU) + 0.02;
          v.x -= nx * pen; v.z -= nz * pen; v.u -= nside * pen; prev[i] = was;
        } else {
          // rolling up the step costs some of the forward speed too (the wheel has to lift the corner)
          v.vLong *= 1 - 0.012 * sev * Math.min(1, vAlong / 8);
          const k = sev * Math.min(1, (vAlong + vn * 2) / 14);
          // (the body's bounce comes from that wheel riding up the step through its tyre and spring: see resolve)
          if (!v.sus) { v.pose.heaveV += 0.5 * k; v.pose.pitchV += (cx > 0 ? -0.35 : 0.25) * k; v.pose.rollV += (cy > 0 ? 0.6 : -0.6) * k; }
          if (cx > 0) v.steer += (cy > 0 ? -1 : 1) * 0.04 * k; // the rack kicks against the hit wheel
        }
        const hit = clamp((glance ? 0.25 : 0.35) * sev + vn * 0.06 + vAlong * 0.008, 0, 1);
        v.bumpHit = Math.max(v.bumpHit, hit); v.curbHit = Math.max(v.curbHit || 0, hit);
        v.curbX = v.x + fx * cx + rx * cy; v.curbZ = v.z + fz * cx + rz * cy; v.curbScrape = glance;
      } else {
        // dropping off: the wheel falls the kerb's height, a thump through the spring
        const k = sev * Math.min(1, vAlong / 10);
        if (!v.sus) { v.pose.heaveV -= 0.3 * k; v.pose.rollV += (cy > 0 ? -0.35 : 0.35) * k; }
        v.bumpHit = Math.max(v.bumpHit, 0.3 * k); v.curbHit = Math.max(v.curbHit || 0, 0.25 * k);
      }
    }
  }
  /** everything after the integrator moved the player's car: route frame, walls, ground height, surface, water */
  resolve(v, dt) {
    const route = this.route;
    let pr = route.project(v.x, v.z, v.s, 6);
    if (Math.abs(pr.u) > 30) { const nearest = route.project(v.x, v.z, null); if (route.closed) nearest.s += Math.round((v.s - nearest.s) / route.length) * route.length; pr = nearest; } // far off the road: re-find the nearest stretch
    v.s = pr.s; v.u = pr.u;
    // guard rails (the only walls the road itself has)
    const lim = this.limits(v.s, v.halfW, v._lim || (v._lim = {}));
    const exploring = v._network && this.network?.sample(v.x, v.z);
    if (!exploring && (v.u > lim.max || v.u < lim.min)) {
      const f = route.contactFrame?.(v.s, v.u, v._f || (v._f = {})) || route.frame(v.s, v._f || (v._f = {})), side = v.u > lim.max ? 1 : -1;
      this._hit(v, -f.rx * side, -f.rz * side, side > 0 ? v.u - lim.max : lim.min - v.u);
      v.u = side > 0 ? lim.max : lim.min;
    }
    // buildings and parked cars: two circles along the body
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), r = v.halfW + 0.05, w = this._w || (this._w = {});
    for (const k of [v.halfL - r, -(v.halfL - r)]) {
      const c = this.walls(v.x + fx * k, v.z + fz * k, r, w);
      if (c) this._hit(v, c.nx, c.nz, c.pen, k, c.collider);
    }
    this._curbs(v);
    // the ground: too steep to climb (cliff face, retaining wall, a building's plinth) acts as a wall
    let g = this.at(v.x, v.z, v.s, v.u, this.out);
    const px = v._gx ?? v.x, pz = v._gz ?? v.z, py = v._gy ?? g.y, d = Math.hypot(v.x - px, v.z - pz);
    const gy = g.y - g.hump, pgy = v._gt ?? gy;
    const tooHigh = gy - route.y((route.closed ? route.wrap(v.s) : clamp(v.s, 0, route.length))) > MAX_ABOVE && gy > pgy;
    const tooFar = Math.abs(v.u) - route.edge((route.closed ? route.wrap(v.s) : clamp(v.s, 0, route.length))) > MAX_OFF && Math.abs(v.u) > Math.abs(v._gu ?? 0);
    if (d > 1e-4 && (this.blocked(pgy, gy, d) || !g.network && (tooHigh || tooFar))) {
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
    const wy = v._wy || (v._wy = [0, 0, 0, 0]), ws = v._wsurf || (v._wsurf = ['', '', '', '']); // per car: fx reads them later
    const fw = route.contactFrame?.(v.s, v.u, v._f || (v._f = {})) || route.frame((route.closed ? route.wrap(v.s) : clamp(v.s, 0, route.length)), v._f || (v._f = {}));
    const ft = fx * fw.tx + fz * fw.tz, fr = fx * fw.rx + fz * fw.rz, rt = rx * fw.tx + rz * fw.tz, rr = rx * fw.rx + rz * fw.rz;
    // Each wheel's ground splits into a smooth plane (the road surface carried on under a kerb, or the terrain) and a
    // step on top of it (kerb, median island, dirt hump, sand pile): the car is placed on the plane, and each step is
    // fed to that wheel's tyre and spring (v.wheelBump), so a kerb lifts that corner through its suspension instead
    // of tilting the whole car rigidly
    const wb = v._wb || (v._wb = [0, 0, 0, 0]), pl = v._wpl || (v._wpl = [0, 0, 0, 0]);
    let nPaved = 0;
    for (let i = 0; i < 4; i++) { // each wheel's own road coordinates: it can be on the kerb while the centre isn't
      const cx = i < 2 ? v.a : -v.b, cy = i & 1 ? t2 : -t2;
      let si = v.s + cx * ft + cy * rt, ui = v.u + cx * fr + cy * rr;
      if (route.localLayout?.contains(v.s)) { const p=route.project(v.x+fx*cx+rx*cy,v.z+fz*cx+rz*cy,si,8); si=p.s; ui=p.u; }
      const a = this.at(v.x + fx * cx + rx * cy, v.z + fz * cx + rz * cy, si, ui, q);
      wy[i] = a.y; ws[i] = a.surf;
      const wg = wheelGround(route, ROAD, a, si, ui, this._wg || (this._wg = {}));
      if (wg.paved) nPaved++;
      pl[i] = wg.plane; wb[i] = wg.input;
    }
    v.wheelBump = wb;
    const yF = (pl[0] + pl[1]) / 2, yB = (pl[2] + pl[3]) / 2, yR = (pl[1] + pl[3]) / 2, yL = (pl[0] + pl[2]) / 2;
    const astride = ws[0] !== ws[1] || ws[2] !== ws[3] || ws[0] !== ws[2] || ws[0] !== g.surf;
    // on the road's plane (kerbs and the median are steps under single wheels now, not a reason to leave it)
    const sv = route.closed ? route.wrap(v.s) : clamp(v.s, 0, route.length);
    const onRoad = nPaved === 4 && Math.abs(v.u) <= route.edge(sv) + ROAD.gutter;
    v.wheelSurf = ws;
    const mapped = !!route.localLayout?.contains(v.s);
    v.gradeG = onRoad && !mapped ? undefined : clamp((yF - yB) / v.wb, -0.8, 0.8);
    v.grade = onRoad && !mapped ? route.frame(v.s, v._f || (v._f = {})).grade : v.gradeG;
    v.bank = onRoad && !mapped ? route.bank(v.s) : clamp((yR - yL) / v.track, -0.6, 0.6);
    // crests launch you: off the tarmac, when the ground falls away under the car faster than gravity could follow
    // (vertical speed from the ground slope under the wheelbase, so curbs and steps don't count as ramps)
    // The centre sample must use the same plane/step split as the wheels: using its full pavement height here
    // would add the kerb twice once all four wheels have climbed onto the pavement.
    const centrePlane = wheelGround(route, ROAD, g, v.s, v.u, this._wg).plane;
    const yG = onRoad && !mapped ? route.surfaceY(sv, v.u) : astride ? (yF + yB) / 2 : Math.max(centrePlane, (yF + yB) / 2);
    if (v.air === undefined) { v.air = 0; v.vy = 0; v.yAir = yG; }
    const paved = onRoad || g.surf === 'pavement' || g.surf === 'asphalt' || g.surf === 'verge';
    const vyS = paved ? 0 : clamp((yF - yB) / v.wb * v.vLong, -20, 20);
    if (v.air) {
      v.vy -= 9.81 * dt; v.yAir += v.vy * dt;
      if (v.yAir <= yG) { v.bumpHit = Math.max(v.bumpHit, clamp((vyS - v.vy) * 0.12, 0, 1)); if (v.bodyKick) v.bodyKick(Math.min(0, v.vy - vyS) * 0.5); else v.pose.heaveV += Math.min(0, v.vy - vyS) * 0.05; v.air = 0; v.yAir = yG; }
      v.y = Math.max(v.yAir, yG);
    } else if (!paved && v.vy > vyS + 9.81 * dt * 1.3 && v.vy > 1.2) {
      v.air = 1; v.yAir = v._gy ?? yG; v.y = yG;
    } else v.y = yG;
    if (!v.air) v.vy = vyS;
    v._gx = v.x; v._gz = v.z; v._gy = v.y; v._gt = g.y - g.hump; v._gu = v.u;
    // grip / drag (airborne: no grip), water
    // Each tyre keeps its own grip and slip curve. Resistance remains a body-level average.
    let mu = 0, dr = 0, res = 0, soft = 0, bow = 0;
    v.wheelMu ||= [1, 1, 1, 1]; v.wheelPeak ||= [1, 1, 1, 1];
    v.wheelSlide ||= [null, null, null, null]; v.wheelSlideV ||= [null, null, null, null];
    for (let i = 0; i < 4; i++) {
      const W = SURF[ws[i]] || SURF.dirt;
      const surfaceGrip = W.mu, wetMultiplier = 1 - (1 - WEATHER.gripScale) * (WET_K[ws[i]] ?? 0.5);
      const softGroundMultiplier = W.traction ?? 1;
      const grip = surfaceGrip * wetMultiplier;
      mu += grip / 4; dr += W.drag / 4; res += (W.res || 0) / 4; soft += (W.soft || 0) / 4; bow += (W.bow || 0) / 4;
      v.wheelMu[i] = v.air ? 0.02 : grip * softGroundMultiplier;
      v.wheelPeak[i] = W.peak ?? 1; v.wheelSlide[i] = W.slide ?? null; v.wheelSlideV[i] = W.slideV ?? null;
    }
    v.surf = g.surf; v.surfMu = v.air ? 0.02 : mu; v.surfDrag = dr; v.surfRes = v.air ? 0 : res; v.surfSoft = v.air ? 0 : soft; v.surfBow = v.air ? 0 : bow;
    v._network = !!g.network;
    if (!paved) { // thick maquis up the hillside / far from the road
      const sc = (route.closed ? route.wrap(v.s) : clamp(v.s, 0, route.length));
      const ex = Math.max(0, gy - route.y(sc) - (MAX_ABOVE - 4)) + Math.max(0, (Math.abs(v.u) - route.edge(sc) - (MAX_OFF - 12)) / 3);
      if (ex > 0) { v.surfDrag += Math.min(5, ex * 2.2); v.surfMu *= Math.max(0.55, 1 - ex * 0.08); for (let i = 0; i < 4; i++) v.wheelMu[i] *= Math.max(0.55, 1 - ex * 0.08); if (g.surf === 'dirt') v.surf = 'scrub'; }
    }
    v.offroad = onRoad || g.surf === 'pavement' || g.surf === 'asphalt' ? 0 : 1;
    // dug in: the car settles into its ruts
    if (v.dig > 0 && !v.air) v.y -= 0.12 * v.dig;
    v.water = g.water;
    if (g.water > 0) { v.sink = Math.min(1, (v.sink || 0) + dt * 0.45); v.y = Math.max(g.y, WATER_Y - 0.35 - 1.2 * v.sink); v.surfDrag = SURF.water.drag; }
    else v.sink = 0;
    // last place you were safely on the road, for the respawn
    if (onRoad && Math.abs(v.u) < route.edge(v.s) && (route.closed || (v.s > 0 && v.s < route.length))) { if (!v.safe) v.safe = {}; v.safe.s = v.s; v.safe.u = v.u; }
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

// ------------------------------------------------------------------ sand traps (visual)
// each trap: a draped patch of pale loose sand on exactly the heights the physics uses (the dune's mound included),
// and the ruts of the last driver who got stuck there: two tracks wandering in from the road side, ending in dug holes
export function buildSandTraps(ground, scene) {
  if (!ground.traps.length) return null;
  const route = ground.route, q = {}, c = new THREE.Color();
  const pos = [], uv = [], idx = [], col = [], rp = [], rc = [], ri = [];
  const RINGS = 12, SEG = 48;
  const yAt = (x, z) => { const pr = route.project(x, z, null); return ground.at(x, z, pr.s, pr.u, q).y; };
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const t of ground.traps) {
    const base = pos.length / 3;
    for (let i = 0; i <= RINGS; i++) {
      for (let k = 0; k < SEG; k++) {
        const th = k / SEG * Math.PI * 2, R = 1 + 0.12 * Math.sin(3 * th + t.seed) + 0.06 * Math.sin(7 * th + t.seed * 2);
        const d = i / RINGS * R * (i === RINGS ? 1.04 : 0.999), lx = Math.cos(th) * d * t.a, lz = Math.sin(th) * d * t.b;
        const x = t.x + lx * t.c - lz * t.s, z = t.z + lx * t.s + lz * t.c;
        pos.push(x, yAt(x, z) + (i === RINGS ? -0.06 : 0.035), z); uv.push(x / 2.5, z / 2.5);
        // dry and pale in the middle, darker and damper where it thins out at the edge
        const n = 0.92 + 0.08 * Math.sin(x * 1.3 + z * 0.7) * Math.sin(z * 1.1 - x * 0.4);
        c.setRGB(0.98, 0.9, 0.74).multiplyScalar(n * (1 - 0.18 * Math.pow(i / RINGS, 3))); col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < RINGS; i++) for (let k = 0; k < SEG; k++) {
      const a = base + i * SEG + k, b = base + i * SEG + (k + 1) % SEG;
      idx.push(a, b, a + SEG, b, b + SEG, a + SEG);
    }
    // ruts: a car came in from the road edge of the patch and dug in short of the far side
    const roadSide = Math.sign(route.project(t.x, t.z, null).u) || 1; // the road is towards -u
    for (let r = 0; r < (t.kind === 'runoff' ? 3 : 2); r++) {
      const fr = route.frame(clamp(t.sAt, 0, route.length), {});
      const inX = -fr.rx * roadSide, inZ = -fr.rz * roadSide; // from the patch towards the road
      const along = (rnd() - 0.5) * 1.4 * t.a, len = t.b * (1.1 + rnd() * 0.6), bend = (rnd() - 0.5) * 3;
      for (const off of [-0.75, 0.75]) {
        const b0 = rp.length / 3; let n = 0;
        for (let j = 0; j <= 16; j++) {
          const f = j / 16, w = 0.13 + 0.05 * f;
          const ax = t.x + fr.tx * (along + bend * f * f) + inX * (t.b * 0.95 - len * f), az = t.z + fr.tz * (along + bend * f * f) + inZ * (t.b * 0.95 - len * f);
          const px = ax + fr.tx * off, pz = az + fr.tz * off;
          for (const sd of [-1, 1]) { const x = px + fr.tx * w * sd, z = pz + fr.tz * w * sd; rp.push(x, yAt(x, z) + 0.06, z); const k = 0.55 - 0.12 * f; rc.push(0.62 * k, 0.5 * k, 0.36 * k); }
          if (j) ri.push(b0 + (j - 1) * 2, b0 + (j - 1) * 2 + 1, b0 + j * 2, b0 + (j - 1) * 2 + 1, b0 + j * 2 + 1, b0 + j * 2);
          n++;
        }
        // the hole the wheel dug where it gave up
        const hb = rp.length / 3, hx = rp[rp.length - 6] * 0.5 + rp[rp.length - 3] * 0.5, hz = rp[rp.length - 4] * 0.5 + rp[rp.length - 1] * 0.5;
        rp.push(hx, yAt(hx, hz) + 0.065, hz); rc.push(0.24, 0.19, 0.13);
        for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, x = hx + Math.cos(a) * 0.45, z = hz + Math.sin(a) * 0.32; rp.push(x, yAt(x, z) + 0.06, z); rc.push(0.5, 0.41, 0.3); }
        for (let k = 0; k < 10; k++) ri.push(hb, hb + 1 + (k + 1) % 10, hb + 1 + k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TX.sand_diff || null, normalMap: TX.sand_nor || null, vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.receiveShadow = true; scene.add(m);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rg.setIndex(ri); rg.computeVertexNormals();
  const rm = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  rm.receiveShadow = true; scene.add(rm);
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
