import { triangleHeight } from './road-network-surface.js';

// The distant mesh has 40 m triangles, not the 10 m DEM used to build it.
// Keep only its emitted cells (including lowered seam vertices), so prop/contact
// queries cannot silently sample a different surface or fill an omitted cell.
export function coarseTerrainSampler(terrain, group) {
  const cells = new Map(), step = terrain.T * 4, width = Math.ceil((terrain.GX - 1) / 4);
  group.traverse(mesh => {
    if (!mesh.userData.coarseTerrain) return;
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let t = 0; t < index.count; t += 3) {
      const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      const i = Math.round((Math.min(...ids.map(k => p.getX(k))) - terrain.minX) / step);
      const j = Math.round((Math.min(...ids.map(k => p.getZ(k))) - terrain.minZ) / step);
      const key = j * width + i;
      let h = cells.get(key); if (!h) cells.set(key, h = new Float32Array(4).fill(NaN));
      for (const k of ids) {
        const x = Math.round((p.getX(k) - terrain.minX) / step) - i;
        const z = Math.round((p.getZ(k) - terrain.minZ) / step) - j;
        h[z * 2 + x] = p.getY(k);
      }
    }
  });
  return (x, z) => {
    const i = Math.floor((x - terrain.minX) / step), j = Math.floor((z - terrain.minZ) / step);
    if (i < 0 || j < 0 || i >= width || j >= Math.ceil((terrain.GZ - 1) / 4)) return null;
    const h = cells.get(j * width + i); if (!h) return null;
    const y = triangleHeight({ minX: terrain.minX + i * step, minZ: terrain.minZ + j * step, T: step, GX: 2, GZ: 2 }, h, x, z);
    return Number.isFinite(y) ? y : null;
  };
}
