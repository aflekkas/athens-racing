// The ground surface of a tile as a height query, from its fine ground triangles (finePositions, fineTriangles; classic tiles: contactPositions, contactTriangles): `heightAt(x, z)` is
// the height of the surface under a point, interpolated across its triangle, or NaN where the tile has none. The tile worker uses it to stand parked cars on the ground under their
// wheels. One 8 m grid of triangle indices, built once per tile.
const CELL = 8;
import {tileSurfaceIndex} from './world-tile-surface-cache.js';
export function groundIndex(t) {
  const fine=!!(t.fineTriangles&&t.finePositions);
  return tileSurfaceIndex(fine?'ground-fine':'ground-contact',fine?[t.finePositions,t.fineTriangles]:[t.contactPositions,t.contactTriangles],()=>buildGroundIndex(t));
}
function buildGroundIndex(t) {
  const tris = [], grid = new Map();
  const add = (P, a, b, c) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2], i = tris.length / 9;
    tris.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let gx = Math.floor(Math.min(ax, bx, cx) / CELL); gx <= Math.floor(Math.max(ax, bx, cx) / CELL); gx++) for (let gz = Math.floor(Math.min(az, bz, cz) / CELL); gz <= Math.floor(Math.max(az, bz, cz) / CELL); gz++) { const k = gx * 4096 + gz; (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  };
  if (t.fineTriangles && t.finePositions) { const T = t.fineTriangles; for (let i = 0; i < T.length; i += 3) add(t.finePositions, T[i], T[i + 1], T[i + 2]); }
  else if (t.contactTriangles && t.contactPositions) { const T = t.contactTriangles; for (let i = 0; i < T.length; i += 5) add(t.contactPositions, T[i], T[i + 1], T[i + 2]); }
  const heightAt = (x, z) => {
    for (const i of grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL)) || []) {
      const o = i * 9, ax = tris[o], ay = tris[o + 1], az = tris[o + 2], bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5], cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
      if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) return u * ay + v * by + w * cy;
    }
    return NaN;
  };
  return { count: tris.length / 9, heightAt };
}
