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
      let cell = cells.get(key); if (!cell) cells.set(key, cell = { h: new Float32Array(4).fill(NaN), diagonal: false });
      const h = cell.h; let corners = 0;
      for (const k of ids) {
        const x = Math.round((p.getX(k) - terrain.minX) / step) - i;
        const z = Math.round((p.getZ(k) - terrain.minZ) / step) - j;
        h[z * 2 + x] = p.getY(k); corners |= 1 << (z * 2 + x);
      }
      // Seam lowering can change which height diagonal is shorter. Preserve
      // the emitted indices rather than guessing a new triangulation.
      cell.diagonal = !!((corners & 1) && (corners & 8));
    }
  });
  return (x, z) => {
    const i = Math.floor((x - terrain.minX) / step), j = Math.floor((z - terrain.minZ) / step);
    if (i < 0 || j < 0 || i >= width || j >= Math.ceil((terrain.GZ - 1) / 4)) return null;
    const cell = cells.get(j * width + i); if (!cell) return null;
    const [h00,h10,h01,h11] = cell.h, a=(x-terrain.minX-i*step)/step, b=(z-terrain.minZ-j*step)/step;
    const y = cell.diagonal
      ? (a>b ? h00+(h10-h00)*a+(h11-h10)*b : h00+(h11-h01)*a+(h01-h00)*b)
      : (a+b<1 ? h00+(h10-h00)*a+(h01-h00)*b : h11+(h01-h11)*(1-a)+(h10-h11)*(1-b));
    return Number.isFinite(y) ? y : null;
  };
}
