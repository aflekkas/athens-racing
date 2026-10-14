// far is authored at the scenery system's 2 km reference draw distance.
// Default MEDIUM scales 500 m to 297 m; HIGH retains a 320 m cutoff.
const PROFILES = Object.freeze({
  low: Object.freeze({ density: 0, cell: 400, far: 500 }),
  med: Object.freeze({ density: .35, cell: 400, far: 500 }),
  high: Object.freeze({ density: 1, cell: 400, far: 320 }),
});
export function hillsideCoverProfile(quality = 'high') {
  return PROFILES[quality === 'medium' ? 'med' : quality === 'ultra' ? 'high' : quality] || PROFILES.med;
}
// A stable spatial mask keeps the same clusters when changing quality, without
// consuming the placement RNG or moving the remaining plants.
export function hillsideClusterSelected(x, z, density) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ 91831;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296 < density;
}
