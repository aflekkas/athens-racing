/** Map bundles (schema 1)
 * MAPS is the lightweight catalog in map-catalog.js. Existing Riviera URLs are unchanged.
 * Add data/maps/<id>/map.json + terrain.bin; register their URLs and menu metadata.
 * JSON: proj {lat0,lon0,mlat,mlon}; route {step,x[],z[],y[],lanes[],div[],start,finish,
 * from,to,closed?,width?[]}; marks [{id,name,s}], zones [{s,urban,zone}], events[];
 * scenery arrays: buildings, areas, trees, pois, furniture, places, sideRoads, coast,
 * parkSpots, humps, barriers. Events have globally unique id, mapId, type, from/to,
 * rivals, traffic; circuit events additionally laps. A closed route repeats its first
 * sample at its end, samples at equal arc distance, and starts at the timing line.
 * Terrain: 32-byte LE header (int32 GX,GZ; float32 minX,minZ,cellSize), then GX*GZ
 * int16 decimetre heights, then uint8 surface classes, row-major. World +X east,+Z south.
 * Optional src/maps/<id>.js buildScenery(scene,map,{heightC,assets}) returns {group,
 * obstacles?,assets?,road?:{group,asphalt},dispose?}; inland maps omit coastal effects.
 * loadMap(progress?,base='./',mapId='riviera') returns an independently owned bundle.
 * Geometry methods wrap on circuits; project(x,z,hint) keeps progress on hint's lap.
 * Call bundle.dispose() after releasing its scene. No cache retains unloaded bundles.
 */
// World space: metres, +x = east, +z = south, +y = up, origin at 37.835 N 23.770 E.
// Route space: s = distance along the route (Vouliagmeni -> Lomvarda), u = lateral offset, + = right.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';
import { getMap } from './map-catalog.js';
import { registerMapEvents, getEvents } from './events.js';
export { MAPS, getMap } from './map-catalog.js';

export const LANE_W = 3.3; // Greek urban/coastal arterial lanes run 3.0-3.5 m (EO91 bends design: 3.00 / 3.25)

export class Route {
  constructor(r) {
    this.step = r.step;
    this.closed = !!r.closed;
    const N = this.N = r.x.length;
    this.X = Float32Array.from(r.x); this.Z = Float32Array.from(r.z); this.Y = Float32Array.from(r.y);
    this.LN = Float32Array.from(r.lanes); this.DV = Float32Array.from(r.div);
    this.length = (N - 1) * this.step;
    this.W = r.width ? Float32Array.from(Array.isArray(r.width) ? r.width : new Array(N).fill(r.width)) : null;
    this.racingLine = r.racingLine ? Float32Array.from(r.racingLine) : null;
    this.start = r.start; this.finish = r.finish; this.names = r.names; this.from = r.from; this.to = r.to; this.speeds = r.speeds || [];
    const TX = this.TX = new Float32Array(N), TZ = this.TZ = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.closed ? (i - 2 + N - 1) % (N - 1) : Math.max(0, i - 2), b = this.closed ? (i + 2) % (N - 1) : Math.min(N - 1, i + 2);
      const dx = this.X[b] - this.X[a], dz = this.Z[b] - this.Z[a]; const L = Math.hypot(dx, dz) || 1;
      TX[i] = dx / L; TZ[i] = dz / L;
    }
    // signed curvature (+ = turning right), smoothed
    const K = new Float32Array(N);
    for (let i = 1; i < N - 1; i++) {
      const cr = TX[i - 1] * TZ[i + 1] - TZ[i - 1] * TX[i + 1];
      K[i] = cr / (2 * this.step);
    }
    if (this.closed) {
      for (let i = 0; i < N - 1; i++) {
        const a = (i - 1 + N - 1) % (N - 1), b = (i + 1) % (N - 1);
        K[i] = (TX[a] * TZ[b] - TZ[a] * TX[b]) / (2 * this.step);
      }
      K[N - 1] = K[0];
    }
    this.K = gauss1(K, this.closed ? Math.max(1, 3 / this.step) : 6, this.closed);
    // superelevation: outer edge higher, up to 4 %
    this.B = new Float32Array(N);
    for (let i = 0; i < N; i++) this.B[i] = -clamp(this.K[i] * 4.5, -0.04, 0.04);
    this.B = gauss1(this.B, 10, this.closed);
    if (this.closed) this.B.fill(0); // no surveyed banking: do not invent a 4% camber
    this.GR = new Float32Array(N); // grade dy/ds
    for (let i = 0; i < N; i++) { const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1); this.GR[i] = (this.Y[b] - this.Y[a]) / ((b - a) * this.step); }
    if (this.closed) for (let i = 0; i < N; i++) {
      const a = (i - 1 + N - 1) % (N - 1), b = (i + 1) % (N - 1);
      this.GR[i] = (this.Y[b] - this.Y[a]) / (2 * this.step);
    }
  }
  wrap(s) { return this.closed ? ((s % this.length) + this.length) % this.length : s; }
  _i(s) { const f = clamp(this.wrap(s) / this.step, 0, this.N - 1.0001); const i = Math.floor(f); return [i, f - i]; }
  lin(A, s) { const [i, t] = this._i(s); return A[i] + (A[i + 1] - A[i]) * t; }
  y(s) { // cubic Hermite for a C1 vertical profile
    const [i, t] = this._i(s);
    const y0 = this.Y[i], y1 = this.Y[i + 1];
    const m0 = this.GR[i] * this.step, m1 = this.GR[i + 1] * this.step;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
  }
  at(s, u = 0, out) { return this.point(s, u, out); }
  racingU(s) { return this.racingLine ? this.lin(this.racingLine, s) : 0; }
  lanes(s) { return Math.round(this.lin(this.LN, s)); }
  lanesF(s) { return this.lin(this.LN, s); }
  div(s) { return this.lin(this.DV, s); }
  medHalf(s) { return this.closed ? 0 : 0.12 + 1.2 * this.div(s); } // ~2.6 m raised island where the avenue splits
  edge(s) { return this.W ? this.lin(this.W, s) / 2 : this.medHalf(s) + this.lanesF(s) * LANE_W; }
  laneU(s, lane) { return this.medHalf(s) + (lane + 0.5) * LANE_W; } // lane 0 = fast lane (next to the median); negative u for oncoming via -laneU
  curv(s) { return this.lin(this.K, s); }
  bank(s) { return this.lin(this.B, s); }
  heading(s) { const tx = this.lin(this.TX, s), tz = this.lin(this.TZ, s); return Math.atan2(tx, -tz); }
  /** world point at (s,u) on the road surface */
  point(s, u, out = new THREE.Vector3()) {
    const [i, t] = this._i(s);
    let ex = 0; if (!this.closed && s < 0) ex = s; else if (!this.closed && s > this.length) ex = s - this.length;
    const x = this.X[i] + (this.X[i + 1] - this.X[i]) * t, z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t;
    const tx = this.TX[i] + (this.TX[i + 1] - this.TX[i]) * t, tz = this.TZ[i] + (this.TZ[i + 1] - this.TZ[i]) * t;
    const L = Math.hypot(tx, tz) || 1;
    const rx = -tz / L, rz = tx / L;
    out.set(x + rx * u + tx / L * ex, this.y(s) + u * this.bank(s), z + rz * u + tz / L * ex);
    return out;
  }
  frame(s, out) {
    const [i, t] = this._i(s);
    out.x = this.X[i] + (this.X[i + 1] - this.X[i]) * t; out.z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; out.y = this.y(s);
    let tx = this.TX[i] + (this.TX[i + 1] - this.TX[i]) * t, tz = this.TZ[i] + (this.TZ[i + 1] - this.TZ[i]) * t;
    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    out.tx = tx; out.tz = tz; out.rx = -tz; out.rz = tx; out.bank = this.bank(s); out.grade = this.lin(this.GR, s);
    return out;
  }
  surfaceY(s, u) { return this.y(s) + u * this.bank(s); }
  /** nearest (s,u) for a world point, searching around a hint */
  _hash() {
    if (this._h) return this._h;
    const h = this._h = new Map(); const C = 60;
    for (let i = 0; i < this.N; i++) { const k = Math.floor(this.X[i] / C) * 100003 + Math.floor(this.Z[i] / C); let b = h.get(k); if (!b) { b = []; h.set(k, b); } b.push(i); }
    return h;
  }
  project(x, z, hint = null, range = 40) {
    if (this.closed) return this._projectLoop(x, z, hint, range);
    if (hint === null) {
      // spatial-hash search, growing rings
      const h = this._hash(), C = 60, cx = Math.floor(x / C), cz = Math.floor(z / C);
      let best = -1, bd = Infinity;
      for (let r = 0; r < 40; r++) {
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const b = h.get((cx + i) * 100003 + cz + j); if (!b) continue;
          for (const k of b) { const d = (this.X[k] - x) ** 2 + (this.Z[k] - z) ** 2; if (d < bd) { bd = d; best = k; } }
        }
        if (best >= 0 && Math.sqrt(bd) < (r - 0.5) * C) break;
      }
      if (best < 0) best = 0;
      hint = best * this.step; range = 3;
    }
    let i0 = 0, i1 = this.N - 1;
    if (hint !== null) { const h = clamp(Math.round(hint / this.step), 0, this.N - 1); i0 = Math.max(0, h - range); i1 = Math.min(this.N - 1, h + range); }
    let best = i0, bd = Infinity;
    const stride = 1;
    for (let i = i0; i <= i1; i += stride) { const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    if (stride > 1) for (let i = Math.max(0, best - 4); i <= Math.min(this.N - 1, best + 4); i++) { const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    const dx = x - this.X[best], dz = z - this.Z[best];
    const along = dx * this.TX[best] + dz * this.TZ[best];
    const s = clamp(best * this.step + along, -500, this.length + 500);
    const f = this.frame(s, {});
    const u = (x - f.x) * f.rx + (z - f.z) * f.rz;
    return { s, u };
  }

  _projectLoop(x, z, hint, range) {
    const count = this.N - 1;
    const center = hint === null ? 0 : Math.floor(this.wrap(hint) / this.step);
    const n = hint === null ? count : Math.min(count, 2 * range + 1);
    let bestD = Infinity, bestS = 0;
    for (let k = 0; k < n; k++) {
      const i = hint === null ? k : ((center - range + k) % count + count) % count;
      const dx = this.X[i + 1] - this.X[i], dz = this.Z[i + 1] - this.Z[i];
      const t = clamp(((x - this.X[i]) * dx + (z - this.Z[i]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = (x - this.X[i] - t * dx) ** 2 + (z - this.Z[i] - t * dz) ** 2;
      if (d < bestD) { bestD = d; bestS = (i + t) * this.step; }
    }
    if (hint !== null) bestS += Math.round((hint - bestS) / this.length) * this.length;
    const f = this.frame(bestS, {});
    return { s: bestS, u: (x - f.x) * f.rx + (z - f.z) * f.rz };
  }
}

function gauss1(A, sigma, closed = false) {
  const R = Math.ceil(sigma * 3), K = []; let ks = 0;
  for (let i = -R; i <= R; i++) { const k = Math.exp(-i * i / (2 * sigma * sigma)); K.push(k); ks += k; }
  const out = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) { let a = 0; for (let j = -R; j <= R; j++) a += A[closed ? ((i + j) % (A.length - 1) + A.length - 1) % (A.length - 1) : clamp(i + j, 0, A.length - 1)] * K[j + R]; out[i] = a / ks; }
  return out;
}

export class Terrain {
  constructor(buf) {
    const dv = new DataView(buf);
    this.GX = dv.getInt32(0, true); this.GZ = dv.getInt32(4, true);
    this.minX = dv.getFloat32(8, true); this.minZ = dv.getFloat32(12, true); this.T = dv.getFloat32(16, true);
    const n = this.GX * this.GZ;
    const hi = new Int16Array(buf, 32, n);
    this.H = new Float32Array(n); for (let i = 0; i < n; i++) this.H[i] = hi[i] / 10;
    this.C = new Uint8Array(buf, 32 + n * 2, n);
    this.maxX = this.minX + (this.GX - 1) * this.T; this.maxZ = this.minZ + (this.GZ - 1) * this.T;
  }
  height(x, z) {
    const fx = (x - this.minX) / this.T, fz = (z - this.minZ) / this.T;
    if (fx < 0 || fz < 0 || fx >= this.GX - 1 || fz >= this.GZ - 1) return -30;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, G = this.GX, H = this.H;
    const a = H[j * G + i], b = H[j * G + i + 1], c = H[(j + 1) * G + i], d = H[(j + 1) * G + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  cls(x, z) {
    const i = Math.round((x - this.minX) / this.T), j = Math.round((z - this.minZ) / this.T);
    if (i < 0 || j < 0 || i >= this.GX || j >= this.GZ) return 0;
    return this.C[j * this.GX + i];
  }
  normal(x, z, out = new THREE.Vector3()) {
    const e = 2;
    out.set(this.height(x - e, z) - this.height(x + e, z), 2 * e, this.height(x, z - e) - this.height(x, z + e)).normalize();
    return out;
  }
}

export async function loadMap(onProgress, base = './', mapId = 'riviera') {
  const definition = getMap(mapId);
  const [mapRes, terRes] = await Promise.all([fetch(base + definition.dataUrl), fetch(base + definition.terrainUrl)]);
  if (!mapRes.ok || !terRes.ok) throw new Error('map data missing');
  const [data, buf] = await Promise.all([mapRes.json(), terRes.arrayBuffer()]);
  onProgress && onProgress('map');
  const route = new Route(data.route);
  const terrain = new Terrain(buf);
  // which side is the sea, how far, per 20 m of route (used for promenades, guard rails, barriers)
  const side = [];
  for (let s = 0; s <= route.length; s += 20) {
    const p = new THREE.Vector3();
    const look = (sgn) => { for (let d = 8; d <= 260; d += 6) { route.point(s, sgn * d, p); if (terrain.height(p.x, p.z) < 0) return d; } return 999; };
    side.push({ r: look(1), l: look(-1) });
  }
  route.seaR = (s) => { const i = clamp(Math.round(route.wrap(s) / 20), 0, side.length - 1); return side[i].r; };
  route.seaL = (s) => { const i = clamp(Math.round(route.wrap(s) / 20), 0, side.length - 1); return side[i].l; };
  // urban (town avenue) vs coastal cliff road, per stretch (data.zones), blended over ~250 m at each change
  const zones = data.zones?.length ? data.zones : [{s:0,urban:0,zone:definition.name}];
  route.urban = (s) => {
    s = route.wrap(s);
    let v = zones[0].urban;
    for (let i = 1; i < zones.length; i++) v += (zones[i].urban - zones[i - 1].urban) * smoothstep(zones[i].s - 120, zones[i].s + 130, s);
    return v;
  };
  route.district = (s) => { s = route.wrap(s); let z = zones[0]; for (const q of zones) if (s >= q.s) z = q; return z.zone; };
  route.zone = (s) => {
    s = route.wrap(s);
    let z = data.marks[0];
    for (const m of data.marks) if (s >= m.s - 60) z = m;
    return z;
  };
  if (data.events) registerMapEvents(mapId, data.events);
  let disposed = false;
  const bundle = { id: mapId, definition, data, route, terrain, events: getEvents(mapId),
    get disposed() { return disposed; },
    dispose() { if (disposed) return; disposed = true; route._h?.clear(); route._h = null; bundle.data = null; bundle.route = null; bundle.terrain = null; bundle.events = []; }
  };
  return bundle;
}
