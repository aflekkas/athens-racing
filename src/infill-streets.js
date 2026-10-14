// Saved OSM highway classes establish access; unclassified legacy sideRoads still
// reserve their footprints, but cannot turn a path/track into a residential street.
const DRIVABLE = new Set(['residential', 'living_street', 'service', 'unclassified', 'tertiary', 'secondary', 'primary', 'tertiary_link', 'secondary_link', 'primary_link', 'trunk', 'trunk_link']);
const CELL = 40;

export function infillStreetIndex(data) {
  const cells = new Map();
  let maxHalfWidth = 0;
  for (const road of [...(data.sideRoads || []), ...(data.roadNetwork?.roads || [])]) {
    const p = road.p, halfWidth = road.w / 2;
    maxHalfWidth = Math.max(maxHalfWidth, halfWidth);
    for (let i = 0; i + 3 < p.length; i += 2) {
      const sg = [p[i], p[i + 1], p[i + 2], p[i + 3], halfWidth, DRIVABLE.has(road.h)];
      const length = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
      for (let t = 0; t <= length; t += CELL / 2) {
        const x = sg[0] + (sg[2] - sg[0]) * t / (length || 1), z = sg[1] + (sg[3] - sg[1]) * t / (length || 1);
        const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(sg);
      }
    }
  }
  return function nearest(x, z, radius, requireAccess = false) {
    let best = null, distance = radius;
    // Include segment sampling error and pavement width across cell boundaries.
    const reach = Math.ceil((radius + maxHalfWidth + CELL / 2) / CELL);
    for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) {
      for (const sg of cells.get(`${Math.floor(x / CELL) + di},${Math.floor(z / CELL) + dj}`) || []) {
        if (requireAccess && !sg[5]) continue;
        const dx = sg[2] - sg[0], dz = sg[3] - sg[1], length2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - sg[0]) * dx + (z - sg[1]) * dz) / length2));
        // Access is centreline distance; footprint exclusion includes the road width.
        const d = Math.hypot(sg[0] + dx * t - x, sg[1] + dz * t - z) - (requireAccess ? 0 : sg[4]);
        if (d < distance) { distance = d; best = sg; }
      }
    }
    return best ? { d: distance, sg: best } : null;
  };
}
