import { coarseTerrainSampler } from './terrain-surface.js';
import { triangleHeight } from './road-network-surface.js';
export const TERRAIN_SUBDIVISIONS = 4;
// Reconstruct the sparse contact grid (2.5 m on Megara; 2 m on Riviera; 1.25 m on Penteli)
// from the exact uploaded vertices.
// The same code installs worker/downloaded bakes, so no stale DEM-only path exists.
export function installTerrainRefinement(terrain, group) {
  let n = TERRAIN_SUBDIVISIONS;
  group.traverse(mesh => { if(mesh.userData.terrainRefinement)n=mesh.userData.terrainRefinement; });
  const cells = new Map(), emitted = new Set(), stride = n + 1;
  group.traverse(mesh => {
    if (!mesh.userData.terrainRefinement) return;
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let k = 0; k < index.count; k += 3) {
      const a=index.getX(k), b=index.getX(k+1), c=index.getX(k+2);
      const ix=Math.round((Math.min(p.getX(a),p.getX(b),p.getX(c))-terrain.minX)/terrain.T*n);
      const iz=Math.round((Math.min(p.getZ(a),p.getZ(b),p.getZ(c))-terrain.minZ)/terrain.T*n);
      emitted.add(Math.floor(iz/n)*terrain.GX+Math.floor(ix/n));
    }
    for (let k = 0; k < p.count; k++) {
      const ix = Math.round((p.getX(k) - terrain.minX) / terrain.T * n), iz = Math.round((p.getZ(k) - terrain.minZ) / terrain.T * n);
      const i = Math.floor(ix / n), j = Math.floor(iz / n);
      for (const a of ix % n === 0 ? [i - 1, i] : [i]) for (const b of iz % n === 0 ? [j - 1, j] : [j]) {
        if (a < 0 || b < 0 || a >= terrain.GX - 1 || b >= terrain.GZ - 1) continue;
        const id = b * terrain.GX + a;
        if (!cells.has(id)) cells.set(id, new Float32Array(stride * stride).fill(NaN));
        cells.get(id)[(iz - b * n) * stride + ix - a * n] = p.getY(k);
      }
    }
  });
  const coarseHeight = coarseTerrainSampler(terrain, group);
  terrain.refinedHeight = (x, z) => {
    // Uploaded positions are Float32. At a cut/fill boundary, choose the
    // same side as those vertices rather than the unrounded DEM coordinate.
    let i = Math.floor((x - terrain.minX) / terrain.T), j = Math.floor((z - terrain.minZ) / terrain.T);
    if (x < Math.fround(terrain.minX + i * terrain.T)) i--;
    else if (x >= Math.fround(terrain.minX + (i + 1) * terrain.T)) i++;
    if (z < Math.fround(terrain.minZ + j * terrain.T)) j--;
    else if (z >= Math.fround(terrain.minZ + (j + 1) * terrain.T)) j++;
    const h = cells.get(j * terrain.GX + i);
    if (!h || !emitted.has(j * terrain.GX + i)) return coarseHeight(x,z);
    const value = triangleHeight({ minX: terrain.minX + i * terrain.T, minZ: terrain.minZ + j * terrain.T, GX: stride, GZ: stride, T: terrain.T / n }, h, x, z);
    return Number.isFinite(value) ? value : coarseHeight(x,z);
  };
}
