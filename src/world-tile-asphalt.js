// The carriageway of a tile, measured from its drivable-asphalt ground triangles (contact flag bit 0), so things that stand beside a street (parked cars, scooters)
// can sit against the real kerb instead of a guessed lane count. Works on compact tiles (fineTriangles + fineFlags) and classic ones (contactTriangles rows).
const CELL = 8;
import {tileSurfaceIndex} from './world-tile-surface-cache.js';
export function asphaltIndex(t) {
  const fine=!!(t.fineFlags&&t.fineTriangles);
  return tileSurfaceIndex(fine?'asphalt-fine':'asphalt-contact',fine?[t.finePositions,t.fineTriangles,t.fineFlags]:[t.contactPositions,t.contactTriangles,t.contactLayers],()=>buildAsphaltIndex(t));
}
function buildAsphaltIndex(t) {
  const tris = [], grid = new Map();
  const add = (P, a, b, c) => {
    const ax = P[a * 3], az = P[a * 3 + 2], bx = P[b * 3], bz = P[b * 3 + 2], cx = P[c * 3], cz = P[c * 3 + 2], i = tris.length / 6;
    tris.push(ax, az, bx, bz, cx, cz);
    for (let gx = Math.floor(Math.min(ax, bx, cx) / CELL); gx <= Math.floor(Math.max(ax, bx, cx) / CELL); gx++) for (let gz = Math.floor(Math.min(az, bz, cz) / CELL); gz <= Math.floor(Math.max(az, bz, cz) / CELL); gz++) { const k = gx * 4096 + gz; (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  };
  if (t.fineFlags && t.fineTriangles) { const F = t.fineFlags, T = t.fineTriangles; for (let i = 0; i < F.length; i++) if (F[i] & 1) add(t.finePositions, T[i * 3], T[i * 3 + 1], T[i * 3 + 2]); }
  else if (t.contactTriangles) { const T = t.contactTriangles; for (let i = 0; i < T.length; i += 5) if ((T[i + 4] & 1) && (!t.contactLayers || t.contactLayers[i / 5] === 0)) add(t.contactPositions, T[i], T[i + 1], T[i + 2]); }
  const inside = (x, z) => {
    for (const i of grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL)) || []) {
      const o = i * 6, ax = tris[o], az = tris[o + 1], bx = tris[o + 2], bz = tris[o + 3], cx = tris[o + 4], cz = tris[o + 5];
      const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  };
  return {
    count: tris.length / 6, inside,
    /** Distance from (x, z) to the edge of the asphalt along the unit direction (nx, nz), or -1 if the point is not on asphalt or the edge is farther than `max`. */
    reach(x, z, nx, nz, max = 9) { if (!inside(x, z)) return -1; let d = 0; while (d < max && inside(x + nx * (d + .25), z + nz * (d + .25))) d += .25; return d >= max ? -1 : d + .125; },
  };
}
