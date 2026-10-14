// Posted speed limits at any world position, for the HUD sign icon and the
// police chase logic (src/police.js). No three.js, no DOM: node can import it.
// Limits come from the OSM maxspeed tags baked into the map data
// (tools/speed-signs.mjs); entries carry src 'osm' (mapped) or 'inferred'
// (Greek defaults where OSM is untagged). Nothing here assigns points or
// penalties — speeding only matters when police mode is on.
const netIndex = new WeakMap();

/** stepwise route limit: the last entry at or before s (police.js limitAt shape). */
export function routeLimitAt(speeds, s) {
  if (!speeds || !speeds.length) return null;
  let cur = speeds[0];
  for (const q of speeds) {
    if (q.s <= s) cur = q;
    else break;
  }
  return cur ? { v: cur.v, src: cur.src || 'osm' } : null;
}

function roadIndex(data) {
  let idx = netIndex.get(data);
  if (idx) return idx;
  idx = [];
  for (const r of data.roadNetwork?.roads || []) {
    const p = r.p;
    if (!p || p.length < 4) continue;
    let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < z0) z0 = p[i + 1]; if (p[i + 1] > z1) z1 = p[i + 1];
    }
    idx.push({ r, x0, x1, z0, z1 });
  }
  netIndex.set(data, idx);
  return idx;
}

function networkLimitAt(data, x, z) {
  let best = null, bd = 1e18;
  for (const { r, x0, x1, z0, z1 } of roadIndex(data)) {
    const m = (r.w || 6) / 2 + 4;
    if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d < bd) { bd = d; best = { r, m }; }
    }
  }
  if (!best || Math.sqrt(bd) > best.m) return null;
  return { v: best.r.v ?? 50, src: best.r.vs || 'inferred' };
}

/**
 * Posted limit at a world position. map is the loaded bundle ({data, route}).
 * On the route corridor the route table wins; off-route the surrounding OSM
 * network (the side roads) answers; elsewhere null (no sign to show).
 */
export function speedLimitAt(map, x, z, hintS = null) {
  if (!map || !map.data || !map.route) return null;
  const { data, route } = map;
  try {
    const q = route.project(x, z, hintS, 60);
    if (q && Math.abs(q.u) < route.edge(q.s) + 6) {
      return routeLimitAt(data.route.speeds, route.closed ? route.wrap(q.s) : q.s);
    }
  } catch { /* fall through to the network */ }
  return networkLimitAt(data, x, z);
}
