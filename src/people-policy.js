// Settlement evidence and activity schedules. No Riviera station bands on other maps.
const clamp = v => Math.max(0, Math.min(1, v));
const inside = (x, z, p) => { let yes = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) yes = !yes; return yes; };
const polygonDistance = (x, z, p) => {
  if (inside(x, z, p)) return 0;
  let best = Infinity;
  for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, dx = p[j] - p[i], dz = p[j + 1] - p[i + 1], t = clamp(((x - p[i]) * dx + (z - p[i + 1]) * dz) / (dx * dx + dz * dz || 1)); best = Math.min(best, Math.hypot(x - p[i] - t * dx, z - p[i + 1] - t * dz)); }
  return best;
};
const VENUE = /^(cafe|restaurant|bar|pub|nightclub|fast_food|ice_cream|kiosk|shop:)/;
const NIGHTLIFE = /^(bar|pub|nightclub)$/;
const forecourtBounds = new WeakMap();
/** A small access court beside a mapped town building, shared with scenery planting. */
export function villageForecourtBuffer(map, x, z, margin = 5) {
  let bounds = forecourtBounds.get(map);
  if (!bounds) {
    bounds = (map.data.buildings || []).filter(b => b.p?.length >= 6 && map.route.district(b.s) === 'town' && (b.name || b.n || b.k === 'villa')).map(b => {
      const xs = b.p.filter((_, i) => !(i % 2)), zs = b.p.filter((_, i) => i % 2);
      return { p: b.p, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    });
    forecourtBounds.set(map, bounds);
  }
  if (!bounds.some(b => x >= b.x0 - margin && x <= b.x1 + margin && z >= b.z0 - margin && z <= b.z1 + margin && polygonDistance(x, z, b.p) <= margin)) return false;
  const q = map.route.project(x, z, null);
  return q.s >= 0 && q.s <= map.route.length && map.route.district(q.s) === 'town';
}
export function peopleSchedule(kind, hour = 17, rain = 0, nightlife = false) {
  hour = ((hour % 24) + 24) % 24; rain = clamp(rain);
  if (['beach', 'swim', 'lie', 'wander'].includes(kind)) return hour >= 8 && hour < 19.5 && rain < .08 ? Math.min(1, .15 + (hour - 8) * .425, (19.5 - hour) / 1.5) : 0;
  if (kind === 'artist') return (hour >= 19 || hour < 5 ? .95 : hour < 8 ? .12 : .04) * (1 - rain);
  if (kind === 'jogger' || kind === 'cyclist') return (hour >= 6 && hour < 10 ? .13 : hour >= 17 && hour < 20 ? .08 : hour >= 10 && hour < 17 ? .025 : 0) * (1 - rain);
  const knots = [[0, nightlife ? .45 : .12], [3, nightlife ? .22 : .025], [5, .035], [8, .45], [14, .65], [18, .85], [21, 1], [24, nightlife ? .45 : .12]];
  let i = 0; while (i < knots.length - 2 && hour > knots[i + 1][0]) i++;
  const [a, av] = knots[i], [b, bv] = knots[i + 1], density = av + (bv - av) * (hour - a) / (b - a);
  return density * (1 - rain * (kind === 'stop' ? .4 : kind === 'cafe' ? .85 : .72));
}
export class PeoplePolicy {
  constructor(map, sidewalk) { this.map = map; this.sidewalk = sidewalk; this.cache = new Map(); this.safe = new Map(); }
  zone(s, side = 1) {
    const { map } = this, r = map.route; s = r.wrap ? r.wrap(s) : s;
    const key = Math.round(s / 10) * 2 + (side > 0 ? 1 : 0), hit = this.cache.get(key); if (hit) return hit;
    const zone = map.data.zones?.findLast(z => z.s <= s)?.zone || r.district?.(s) || 'rural';
    const district = zone === 'chapel' ? 'village' : zone === 'town' ? 'town' : zone;
    const denied = ['mountain', 'cliff', 'forest', 'circuit'].includes(zone);
    const sw = this.sidewalk(r, s, side), u = side * (r.edge(s) + .55 + .18 + Math.min(1.2, sw * .4)), p = r.point(s, u);
    const buildings = (map.data.buildings || []).filter(b => Math.abs(b.s - s) < 160 && Math.abs(b.u) < 130 && b.p?.length >= 6 && String(b.id) !== '368804380');
    const buildingDistance = buildings.reduce((d, b) => Math.min(d, polygonDistance(p.x, p.z, b.p)), Infinity);
    const pois = (map.data.pois || []).filter(q => Math.abs(q.s - s) < 100 && Math.hypot(p.x - q.x, p.z - q.z) < 90);
    const venue = pois.some(q => VENUE.test(q.k)), nightlife = pois.some(q => NIGHTLIFE.test(q.k));
    const busStop = (map.data.furniture || []).some(q => q.t === 'bus_stop' && Math.abs(q.s - s) < 20);
    const urbanLand = ['residential', 'commercial', 'retail'].some(k => (map.data.areas?.[k] || []).some(a => a.p && inside(p.x, p.z, a.p)));
    const forest = ['forest', 'wood'].some(k => (map.data.areas?.[k] || []).some(a => a.p && inside(p.x, p.z, a.p)));
    const coastal = map.id === 'riviera' && (side > 0 ? r.seaR(s) : r.seaL(s)) < 140 && ['town', 'beach', 'cove'].includes(zone);
    const settlement = buildingDistance < 65 || venue || (urbanLand && (buildingDistance < 100 || map.id === 'penteli' && zone === 'town'));
    // Bus shelters out on a mountain connector do not turn its shoulder into a pavement.
    const allowed = !denied && !forest && sw >= 1.4 && (settlement || coastal || busStop && r.urban(s) > .5);
    const result = { allowed, zone: denied ? 'mountain/forest' : district, coastal, nightlife, buildingDistance, pavement: allowed && map.id !== 'penteli', base: allowed && map.id !== 'penteli' ? (venue ? .9 : coastal ? .75 : .6) : 0 };
    this.cache.set(key, result); return result;
  }
  density(s, side, hour, rain) { const z = this.zone(s, side); return z.base * peopleSchedule('walker', hour, rain, z.nightlife); }
  anchor(a, hour, rain) {
    const beach = ['beach', 'swim', 'lie', 'wander'].includes(a.kind);
    if (beach) return this.map.id === 'riviera' ? peopleSchedule(a.kind, hour, rain) : 0;
    if (this.map.id === 'penteli') return a.kind === 'resident' && this.forecourt(a.x, a.z) ? peopleSchedule('resident', hour, rain) : 0;
    const q = this.map.route.project(a.x, a.z, a.s), z = this.zone(a.s, Math.sign(q.u) || 1);
    return z.allowed ? peopleSchedule(a.kind, hour, rain, z.nightlife) : 0;
  }
  /** Walkers ask this every frame: cached on a 0.5 m x 0.25 m grid (the answer is geometry, not time). */
  safePoint(s, u) {
    if (this.map.id === 'penteli') return false; // its mapped road has gravel shoulders, no continuous pavement
    const key = Math.round(s * 2) * 128 + Math.min(63, Math.round(Math.abs(u) * 4)) * 2 + (u >= 0 ? 1 : 0);
    let hit = this.safe.get(key);
    if (hit === undefined) { if (this.safe.size > 40000) this.safe.clear(); this.safe.set(key, hit = this.safeAt(s, u)); }
    return hit;
  }
  safeAt(s, u) {
    const r = this.map.route, side = Math.sign(u) || 1, z = this.zone(s, side);
    if (!z.allowed || Math.abs(u) < r.edge(s) + .55 + .3) return false;
    const p = r.point(s, u);
    if (this.map.roadNetwork?.sample(p.x, p.z)) return false;
    if ((this.map.data.buildings || []).some(b => Math.abs(b.s - s) < 80 && b.p && inside(p.x, p.z, b.p))) return false;
    if (this.map.id === 'penteli' && this.map.terrain) {
      const h = this.map.terrain.height(p.x, p.z), f = r.frame(s, {});
      if (Math.abs(h - this.map.terrain.height(p.x + f.rx * .7, p.z + f.rz * .7)) > .35) return false;
    }
    return true;
  }
  forecourt(x, z) {
    const map = this.map, q = map.route.project(x, z, null);
    if (q.s < 0 || q.s > map.route.length || map.route.district(q.s) !== 'town' || Math.abs(q.u) < map.route.edge(q.s) + 2 || map.roadNetwork?.sample(x, z)) return false;
    const bs = (map.data.buildings || []).filter(b => b.p?.length >= 6);
    if (bs.some(b => inside(x, z, b.p))) return false;
    const distance = bs.reduce((d, b) => Math.min(d, polygonDistance(x, z, b.p)), Infinity);
    if (distance < 1 || distance > 12) return false;
    const residential = ['residential', 'commercial', 'retail'].some(k => (map.data.areas?.[k] || []).some(a => a.p && inside(x, z, a.p)));
    const civic = bs.some(b => (b.n || b.name) && polygonDistance(x, z, b.p) < 12);
    if (!residential && !civic) return false;
    if (['forest', 'wood', 'cliff'].some(k => (map.data.areas?.[k] || []).some(a => a.p && inside(x, z, a.p)))) return false;
    const h = map.terrain.height(x, z);
    return [[.8, 0], [-.8, 0], [0, .8], [0, -.8]].every(([dx, dz]) => Math.abs(map.terrain.height(x + dx, z + dz) - h) < .35);
  }
}

export function villageResidents(map, policy) {
  if (map.id !== 'penteli') return [];
  const anchors = [];
  for (const b of map.data.buildings || []) {
    if (map.route.district(b.s) !== 'town' || !b.p?.length || Math.abs(b.u) > 260) continue;
    const p = b.p;
    for (let i = 0; i < p.length && anchors.filter(a => a.building === b.id).length < 2; i += 2) {
      const j = (i + 2) % p.length, mx = (p[i] + p[j]) / 2, mz = (p[i + 1] + p[j + 1]) / 2, length = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]);
      if (length < 3) continue;
      for (const sign of [-1, 1]) {
        const x = mx + (p[j + 1] - p[i + 1]) / length * sign * 2.2, z = mz - (p[j] - p[i]) / length * sign * 2.2;
        if (!policy.forecourt(x, z) || anchors.some(a => Math.hypot(a.x - x, a.z - z) < 3)) continue;
        const q = map.route.project(x, z, b.s);
        anchors.push({ kind: 'resident', building: b.id, s: q.s, x, y: map.terrain.height(x, z) + .015, z, yaw: Math.atan2(mx - x, mz - z), ped: null }); break;
      }
    }
  }
  return anchors;
}
