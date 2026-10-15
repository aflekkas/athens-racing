import { triangleHeight } from './road-network-surface.js';
export const TERRAIN_SUBDIVISIONS = 4;
// Reconstruct the sparse contact grid (2.5 m on Megara; 2 m on Riviera; 1.25 m on Penteli)
// from the exact uploaded vertices.
// The same code installs worker/downloaded bakes, so no stale DEM-only path exists.
export function installTerrainRefinement(terrain, group) {
  let n = TERRAIN_SUBDIVISIONS;
  group.traverse(mesh => { if(mesh.userData.terrainRefinement)n=mesh.userData.terrainRefinement; });
  const cells = new Map(), stride = n + 1;
  group.traverse(mesh => {
    if (!mesh.userData.terrainRefinement) return;
    const p = mesh.geometry.attributes.position;
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
  terrain.refinedHeight = (x, z) => {
    const i = Math.floor((x - terrain.minX) / terrain.T), j = Math.floor((z - terrain.minZ) / terrain.T), h = cells.get(j * terrain.GX + i);
    if (!h) return null;
    const value = triangleHeight({ minX: terrain.minX + i * terrain.T, minZ: terrain.minZ + j * terrain.T, GX: stride, GZ: stride, T: terrain.T / n }, h, x, z);
    return Number.isFinite(value) ? value : null;
  };
}
