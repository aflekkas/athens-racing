// Sparse kerb parking derived from contact geometry. Cars need a whole asphalt bay outside the driving corridor;
// narrow streets keep their pavements clear. Rows are tile-local x,y,z,yaw,kind*8+paint.
import { CELL, hashN, inRing } from './world-tile-trees.js';
import { asphaltIndex } from './world-tile-asphalt.js';
import { groundIndex } from './world-tile-ground.js';

export const PARKING_LIMIT = 700;
/** Fraction of spaced kerb candidates occupied; the single density control for cars and scooters. */
export const PARKING_DENSITY = .18;
/** How far beyond a kerb a second stretch of asphalt still makes the strip between them a median (metres). */
const MEDIAN_REACH = 18;
/** A car-sized oriented rectangle: corners of the box centred on (x, z), `hl` long along (sin yaw, cos yaw), `hw` wide. */
export const boxCorners = (x, z, yaw, hl, hw) => { const tx = Math.sin(yaw), tz = Math.cos(yaw), nx = tz, nz = -tx; return [[x + tx * hl + nx * hw, z + tz * hl + nz * hw], [x + tx * hl - nx * hw, z + tz * hl - nz * hw], [x - tx * hl - nx * hw, z - tz * hl - nz * hw], [x - tx * hl + nx * hw, z - tz * hl + nz * hw]]; };
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], q = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / q)); return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz); };
const within = (p, r) => { let s = 0; for (let i = 0; i < 4; i++) { const a = r[i], b = r[(i + 1) % 4], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); s += c > 0 ? 1 : c < 0 ? -1 : 0; } return Math.abs(s) === 4; };
/** Gap in metres between two convex quadrilaterals (0 when they overlap). */
export function boxGap(r1, r2) {
  if (r1.some(p => within(p, r2)) || r2.some(p => within(p, r1))) return 0;
  let d = Infinity; for (const [A, B] of [[r1, r2], [r2, r1]]) for (const p of A) for (let i = 0; i < 4; i++) d = Math.min(d, segDist(p, B[i], B[(i + 1) % 4]));
  return d;
}
/** The player car and the traffic: 4.5 x 1.9 m. A parked car keeps at least this far from one standing on any tow anchor of the tile. */
export const PLAYER_HALF = [2.25, .95], ANCHOR_CLEAR = .7;
/** Paint indices of src/athens-props.js CAR_PAINT (0 white, 1 silver, 2 graphite, 3 black, 4 blue, 5 red, 6 beige, 7 dark green), weighted like the Athens fleet: mostly white, silver and dark, some blue and red. */
const PAINT = [0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 7];
export function deriveParking(t, rings, inQuarter = () => false, occupied = [], trees = []) {
  const out = [], n = t.edges.length / 10;
  if (!n) return new Float32Array(0);
  const grid = (g, x0, z0, x1, z1, item) => { for (let i = Math.floor(Math.min(x0, x1) / CELL); i <= Math.floor(Math.max(x0, x1) / CELL); i++) for (let j = Math.floor(Math.min(z0, z1) / CELL); j <= Math.floor(Math.max(z0, z1) / CELL); j++) { const k = i * 4096 + j; (g.get(k) || g.set(k, []).get(k)).push(item); } };
  const near = (g, x, z, pad) => { const r = []; for (let i = Math.floor((x - pad) / CELL); i <= Math.floor((x + pad) / CELL); i++) for (let j = Math.floor((z - pad) / CELL); j <= Math.floor((z + pad) / CELL); j++) { const l = g.get(i * 4096 + j); if (l) r.push(...l); } return r; };
  const bGrid = new Map(), sGrid = new Map(), oGrid = new Map(), cGrid = new Map(), carGrid = new Map(), ground = groundIndex(t), asphalt = asphaltIndex(t), measured = asphalt.count > 0;
  for (const ring of rings) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } grid(bGrid, x0, z0, x1, z1, ring); }
  const E = t.edges, P = t.edgePoints;
  for (let e = 0; e < n; e++) for (let k = E[e * 10 + 3]; k < E[e * 10 + 3] + E[e * 10 + 4] - 1; k++) grid(sGrid, P[k * 3], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 5], [e, P[k * 3], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 5]]);
  for (let i = 0; i < occupied.length; i += 2) grid(oGrid, occupied[i], occupied[i + 1], occupied[i], occupied[i + 1], [occupied[i], occupied[i + 1], 3.4]);
  for (let i = 0; i < trees.length; i += 5) grid(oGrid, trees[i], trees[i + 2], trees[i], trees[i + 2], [trees[i], trees[i + 2], 2.5]);
  const aGrid = new Map(), AT = t.anchorTransforms; if (AT) for (let a = 0; a < AT.length; a += 4) grid(aGrid, AT[a], AT[a + 2], AT[a], AT[a + 2], [AT[a], AT[a + 2], AT[a + 3]]);
  const twin = (a, b) => (E[a * 10 + 1] === E[b * 10 + 2] && E[a * 10 + 2] === E[b * 10 + 1]) || (E[a * 10 + 1] === E[b * 10 + 1] && E[a * 10 + 2] === E[b * 10 + 2]);
  /** Is a footprint centred on (x, z), `hl` long and `hw` wide along the street direction (tx, tz), clear of every building? */
  const clearOfBuildings = (x, z, tx, tz, hl, hw) => {
    const pts = []; for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) pts.push([x + tx * hl * a - tz * hw * b, z + tz * hl * a + tx * hw * b]);
    for (const ring of near(bGrid, x, z, hl + 1)) for (const [qx, qz] of pts) if (inRing(ring, qx, qz)) return false;
    return true;
  };
  /** Does the kerb on the right of edge `e` at (px, pz) border a median or the other carriageway of a divided road, not a pavement and buildings? Two tests: asphalt again within
   * MEDIAN_REACH metres beyond the kerb with no building in the gap (a central reservation, a traffic island), or a one-way twin running the other way on that side. */
  const medianSide = (e, px, pz, tx, tz, w) => {
    const nx = -tz, nz = tx;
    if (E[e * 10 + 8] & 1) for (const [oe, x0, z0, x1, z1] of near(sGrid, px + nx * 20, pz + nz * 20, 26)) {
      if (oe === e || !(E[oe * 10 + 8] & 1)) continue; const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1; if ((dx * tx + dz * tz) / l > -.8) continue;
      const lat = ((x0 + x1) / 2 - px) * nx + ((z0 + z1) / 2 - pz) * nz; if (lat > w + 1 && lat < 45) return true;
    }
    let gapStart = -1; for (let d = w + .75; d <= w + MEDIAN_REACH; d += .75) {
      if (asphalt.inside(px + nx * d, pz + nz * d)) { if (gapStart < 0) continue; const mid = (gapStart + d) / 2, mx = px + nx * mid, mz = pz + nz * mid; return !near(bGrid, mx, mz, 1).some(ring => inRing(ring, mx, mz)); }
      if (gapStart < 0) gapStart = d;
    }
    return false;
  };
  const free = (e, x, z, tx, tz, hl, hw, apart = 2.6) => {
    if (!clearOfBuildings(x, z, tx, tz, hl, hw)) return false;
    const me = boxCorners(x, z, Math.atan2(tx, tz), hl, hw);
    for (const [ax, az, ayaw] of near(aGrid, x, z, 7)) if (boxGap(boxCorners(ax, az, ayaw, PLAYER_HALF[0], PLAYER_HALF[1]), me) < ANCHOR_CLEAR) return false; // never on a tow anchor, where the player spawns and the traffic drives
    for (const [oe, x0, z0, x1, z1] of near(sGrid, x, z, 6)) { if (oe === e || twin(oe, e)) continue; const dx = x1 - x0, dz = z1 - z0, q = dx * dx + dz * dz, u = q ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / q)) : 0; if (Math.hypot(x - x0 - u * dx, z - z0 - u * dz) < 4) return false; }
    for (const [ox, oz, d] of near(oGrid, x, z, 4)) if (Math.hypot(x - ox, z - oz) < d) return false;
    for (const [cx, cz] of near(cGrid, x, z, 5)) if (Math.hypot(x - cx, z - cz) < apart) return false;
    return true;
  };
  for (let e = 0; e < n && out.length < PARKING_LIMIT * 5; e++) {
    const o = e * 10, lanes = E[o + 6], speed = E[o + 7], flags = E[o + 8], first = E[o + 3], count = E[o + 4], id = E[o];
    if ((flags & 6) || (t.edgeLayers && t.edgeLayers[e] !== 0) || lanes > 1 || speed >= 50 || count < 2) continue;
    const seg = []; let length = 0; for (let k = 0; k < count - 1; k++) { const l = Math.hypot(P[(first + k + 1) * 3] - P[(first + k) * 3], P[(first + k + 1) * 3 + 2] - P[(first + k) * 3 + 2]); seg.push(l); length += l; }
    if (length < 26) continue;
    // Candidates leave long empty kerb runs. Fit heading to both ends of the kerb and reject steps,
    // tight bends, medians and unsupported bays rather than squashing a model into the available gap.
    const at = sc => { let acc = 0, k = 0; while (k < seg.length - 1 && acc + seg[k] < sc) { acc += seg[k]; k++; } const a = first + k, l = seg[k] || 1, f = Math.min(1, Math.max(0, (sc - acc) / l)); return { x: P[a * 3] + (P[a * 3 + 3] - P[a * 3]) * f, y: P[a * 3 + 1] + (P[a * 3 + 4] - P[a * 3 + 1]) * f, z: P[a * 3 + 2] + (P[a * 3 + 5] - P[a * 3 + 2]) * f, tx: (P[a * 3 + 3] - P[a * 3]) / l, tz: (P[a * 3 + 5] - P[a * 3 + 2]) / l }; };
    const kerbAt = sc => { const p = at(sc); let w = -1; if (measured) w = asphalt.reach(p.x, p.z, -p.tz, p.tx, 9); else w = lanes >= 2 ? 3.2 : 2.5; return w < 1.6 || w > 8.5 ? null : { p, w, kx: p.x - p.tz * w, kz: p.z + p.tx * w }; };
    const wheelHeights = (x, z, tx, tz, hl, hw) => { const hs = []; for (const a of [-1, 1]) for (const b of [-1, 1]) hs.push(ground.count ? ground.heightAt(x + tx * hl * a - tz * hw * b, z + tz * hl * a + tx * hw * b) : NaN); return hs; }; // rear-left, rear-right, front-left, front-right
    let s = 16 + 2.3, run = 0, guard = 0, lastPaint = -1;
    while (s < length - 16 - 2.3 && guard++ < 300) {
      const h = hashN(id * 7919 + Math.floor(s * 2) * 131 + 17), p0 = at(s);
      if (run >= 4 + (h >>> 5) % 3) { s += 5 + (h >>> 9) % 6; run = 0; continue; }
      if ((h >>> 9) % 100 >= PARKING_DENSITY * 100) { s += 9; run = 0; continue; }
      const kf = kerbAt(s + 2.15), kb = kerbAt(s - 2.15), km = kerbAt(s);
      if (!kf || !kb || !km || Math.abs(kf.w - kb.w) > .45 || (measured && medianSide(e, p0.x, p0.z, p0.tx, p0.tz, km.w))) { s += 1.5; run = 0; continue; } // Athens does not park against a median
      const dx = kf.kx - kb.kx, dz = kf.kz - kb.kz, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl, nk = [-uz, ux], w = (kf.w + kb.w + km.w * 2) / 4, yaw = Math.atan2(ux, uz);
      const kmx = (kf.kx + kb.kx) / 2, kmz = (kf.kz + kb.kz) / 2;
      if ((h >>> 3) % 100 < 13) { // scooters: a group on the pavement, noses to the kerb
        const m = 2 + (h >>> 12) % 3, off = 1.1; let any = false;
        for (let q = 0; q < m; q++) { const sx = kmx + ux * (q - (m - 1) / 2) * .9 + nk[0] * off, sz = kmz + uz * (q - (m - 1) / 2) * .9 + nk[1] * off; if (!free(e, sx, sz, uz, -ux, .55, .3, .7)) continue; const sb = boxCorners(sx, sz, yaw + Math.PI / 2, .55, .3); if (near(carGrid, sx, sz, 5).some(b => boxGap(sb, b) < .3)) continue;
          const hs = [ground.count ? ground.heightAt(sx - uz * .0 + ux * .5, sz + uz * .5) : NaN, ground.count ? ground.heightAt(sx - ux * .5, sz - uz * .5) : NaN].filter(Number.isFinite), sy = hs.length ? Math.max(...hs) : p0.y;
          grid(cGrid, sx, sz, sx, sz, [sx, sz]); out.push(sx, sy, sz, yaw + Math.PI / 2 + ((h >>> (q * 3)) % 5 - 2) * .06, 8 + (h >>> (16 + q * 2)) % 6); any = true; }
        s += any ? 2.2 : 1.5; run = 0; continue;
      }
      // Keep the entire car on asphalt, with its inner flank at least 3.2 m from the driving axis.
      if (!measured || !ground.count || w < 5.6) { s += 9; run = 0; continue; }
      const off = -1.4, x = kmx + nk[0] * off, z = kmz + nk[1] * off;
      if (!free(e, x, z, ux, uz, 2.4, 1.2, 0)) { s += 1.5; run = 0; continue; }
      const me = boxCorners(x, z, yaw, 2.15, .9); let crowded = false; for (const box of near(carGrid, x, z, 7)) if (boxGap(me, box) < 2) { crowded = true; break; }
      if (crowded) { s += 1.2; run = 0; continue; }
      // Validate the complete body and its kerb clearance, including between corners on bends.
      let supported = true;
      for (const a of [-2.2, -1.1, 0, 1.1, 2.2]) for (const b of [-1.1, 0, 1.1]) {
        if (!asphalt.inside(x + ux*a - uz*b, z + uz*a + ux*b)) supported = false;
      }
      if (!supported) { s += 9; run = 0; continue; }
      const hs = wheelHeights(x, z, ux, uz, 1.35, .84); let sy = p0.y;
      if (ground.count) {
        if (hs.some(v => !Number.isFinite(v))) { s += 1.5; run = 0; continue; }
        if (Math.max(...hs) - Math.min(...hs) > .08) { s += 1.5; run = 0; continue; } // a kerb step under the wheels, or too steep
        sy = Math.max(...hs);
      }
      grid(carGrid, x, z, x, z, me); grid(cGrid, x, z, x, z, [x, z]); let paint = PAINT[(h >>> 14) % PAINT.length]; for (let k = 1; paint === lastPaint; k++) paint = k < 4 ? PAINT[((h >>> 14) + k * 7) % PAINT.length] : (paint + 1) % 8; // neighbours differ
      out.push(x, sy, z, yaw, paint); lastPaint = paint; run++;
      s += 9 + (h >>> 17) % 5;
    }
  }
  return Float32Array.from(out.slice(0, PARKING_LIMIT * 5));
}

/** Remove bus-stop/crossing bays before both instancing and obstacle generation, including old tile recipes. */
export function filterParkingStops(rows, propsRows = [], propsKinds = []) {
  const exclusions=[];
  for(let i=0;i<propsKinds.length;i++){const k=propsKinds[i],radius=k===1||k===2?17:k===12?11:0;if(radius)exclusions.push([propsRows[i*5],propsRows[i*5+2],radius]);}
  if(!exclusions.length)return rows;
  const out=[];for(let i=0;i<rows.length;i+=5)if(!exclusions.some(([x,z,r])=>Math.hypot(rows[i]-x,rows[i+2]-z)<r))out.push(...rows.subarray(i,i+5));
  return Float32Array.from(out);
}

/** The collision boxes of the derived rows (cars 4.3 x 1.8 x 1.4 m, scooters 1.1 x .6 x 1 m): [x, y, z, yaw, halfLength, halfWidth, height] per box, for the obstacle index. */
export function parkedBoxes(rows) {
  const out = new Float32Array(rows.length / 5 * 7);
  for (let i = 0, o = 0; i < rows.length; i += 5, o += 7) { const scooter = rows[i + 4] >> 3; out.set([rows[i], rows[i + 1], rows[i + 2], rows[i + 3], scooter ? .55 : 2.15, scooter ? .3 : .9, scooter ? 1 : 1.4], o); }
  return out;
}
