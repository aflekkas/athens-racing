// Conservative road-bed envelope for mountain DEM cells. Every touched cell's
// four corners are capped, so neither choice of render diagonal can cross the
// protected carriageway/verge. Nearby hairpin legs contribute by minimum, never
// by nearest-leg projection. Road elevations themselves remain unchanged.
export function cutMountainRoads(terrain, route, heights, network) {
  const { GX, GZ, T, minX, minZ } = terrain;
  const ceiling = new Float32Array(heights.length).fill(Infinity);
  const protect = (x, z, y) => {
    const i = Math.floor((x - minX) / T), j = Math.floor((z - minZ) / T);
    if (i < 0 || j < 0 || i >= GX - 1 || j >= GZ - 1) return;
    for (const k of [j * GX + i, j * GX + i + 1, (j + 1) * GX + i, (j + 1) * GX + i + 1]) ceiling[k] = Math.min(ceiling[k], y - .24);
  };
  // Include the apron, gravel shoulder and 3 m verge, with a one metre safety
  // margin between sampling lines. This also covers the road's run-in/out.
  for (let s = -64; s <= route.length + 64; s += 1) {
    const edge = route.edge(s) + 4;
    for (let u = -edge; u <= edge + .01; u += .5) {
      const p = route.point(s, u); protect(p.x, p.z, p.y);
    }
  }
  // Freeze network heights before carving: using the changed grid here would
  // lower the road and its bed recursively. The shared network source supplies
  // the exact same surface used by the drivable side-road meshes.
  for (const seg of network?.segments || []) {
    const steps = Math.max(1, Math.ceil(seg.L));
    for (let k = 0; k <= steps; k++) for (let u = -seg.hw - seg.sw - 3; u <= seg.hw + seg.sw + 3; u += .5) {
      const x = seg.ax + seg.dx * k / steps - seg.dz / seg.L * u;
      const z = seg.az + seg.dz * k / steps + seg.dx / seg.L * u;
      protect(x, z, network.height(x, z));
    }
  }
  // Blend both cuts and fills into the source relief over three grid cells.
  // A bounded slope from each protected cell gives exposed uphill cuts and
  // downhill embankments without a cliff immediately beside the shoulder.
  const blended = heights.slice();
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const id = j * GX + i, cap = ceiling[id]; if (!Number.isFinite(cap)) continue;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const a = i + dx, b = j + dz, distance = Math.hypot(dx, dz) * T;
      if (a < 0 || b < 0 || a >= GX || b >= GZ || distance > 3 * T) continue;
      const k = b * GX + a, weight = 1 - distance / (3 * T);
      const target = Math.max(cap - distance * .65, Math.min(heights[k], cap + distance * .8));
      // Multiple corridors may meet; the lower cutting wins at their overlap.
      const value = heights[k] + (target - heights[k]) * weight;
      if (value < heights[k]) blended[k] = Math.min(blended[k], value);
      else if (blended[k] >= heights[k]) blended[k] = Math.max(blended[k], value);
    }
  }
  for (let k = 0; k < heights.length; k++) heights[k] = Math.min(blended[k], ceiling[k]);
}
