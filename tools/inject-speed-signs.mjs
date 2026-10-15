#!/usr/bin/env node
// Inject speed-limit data into the checked-in map.json files, additively:
// existing keys keep their values; only route.speeds is recomputed (same
// smoothing as tools/build_map.mjs, plus Greek defaults where OSM is
// untagged) and speedSigns / speedCameras / road `v` limits are added.
//   node tools/inject-speed-signs.mjs [riviera|megara|penteli]
// Data (c) OpenStreetMap contributors (ODbL).
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRouteSpeeds, limitForWay, matchSigns, inferSigns, mergeSigns, parseSignTags,
} from './speed-signs.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readMaybeGz = (p) => JSON.parse(
  fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : gunzipSync(fs.readFileSync(p + '.gz')).toString('utf8'));

// ------------------------------------------------------------------ geometry
function routeSampler(route) {
  const { step, x: X, z: Z } = route;
  const N = X.length, C = 60;
  const cells = new Map();
  for (let i = 0; i < N; i++) {
    const k = Math.floor(X[i] / C) * 100003 + Math.floor(Z[i] / C);
    let b = cells.get(k); if (!b) { b = []; cells.set(k, b); } b.push(i);
  }
  const TX = new Float64Array(N), TZ = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2);
    const dx = X[b] - X[a], dz = Z[b] - Z[a], L = Math.hypot(dx, dz) || 1;
    TX[i] = dx / L; TZ[i] = dz / L;
  }
  const length = (N - 1) * step;
  function project(x, z, maxD = 120) {
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    let best = -1, bd = maxD * maxD;
    const R = Math.ceil(maxD / C);
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const b = cells.get((cx + i) * 100003 + cz + j); if (!b) continue;
      for (const k of b) { const d = (X[k] - x) ** 2 + (Z[k] - z) ** 2; if (d < bd) { bd = d; best = k; } }
    }
    if (best < 0) return null;
    const along = (x - X[best]) * TX[best] + (z - Z[best]) * TZ[best];
    const s = best * step + along;
    const u = (x - X[best]) * -TZ[best] + (z - Z[best]) * TX[best];
    return { s, u, d: Math.sqrt(bd) };
  }
  const tangentAt = (s) => {
    const i = Math.max(0, Math.min(N - 1, Math.round(s / step)));
    return { tx: TX[i], tz: TZ[i] };
  };
  return { project, tangentAt, length, N };
}

// Nearest OSM way tags per route sample, via a segment grid hash.
function wayTagIndex(ways, proj) {
  const segs = [], C = 80, cells = new Map();
  const P = (lat, lon) => [(lon - proj.lon0) * proj.mlon, -(lat - proj.lat0) * proj.mlat];
  for (const w of ways) {
    const t = w.tags || {};
    if (!t.highway) continue;
    const geom = w.geometry || [];
    if (geom.length < 2) continue;
    const pts = geom.map((g) => P(g.lat, g.lon));
    for (let i = 0; i + 1 < pts.length; i++) {
      const idx = segs.length;
      segs.push({ a: pts[i], b: pts[i + 1], tags: t, id: w.id });
      const x0 = Math.floor(Math.min(pts[i][0], pts[i + 1][0]) / C), x1 = Math.floor(Math.max(pts[i][0], pts[i + 1][0]) / C);
      const z0 = Math.floor(Math.min(pts[i][1], pts[i + 1][1]) / C), z1 = Math.floor(Math.max(pts[i][1], pts[i + 1][1]) / C);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = cx * 100003 + cz;
        let b = cells.get(k); if (!b) { b = []; cells.set(k, b); } b.push(idx);
      }
    }
  }
  return function nearestWay(x, z, maxD = 60) {
    const cx = Math.floor(x / C), cz = Math.floor(z / C), R = Math.ceil(maxD / C);
    let best = null, bd = maxD * maxD;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const b = cells.get((cx + i) * 100003 + cz + j); if (!b) continue;
      for (const k of b) {
        const s = segs[k];
        const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2));
        const d = (x - s.a[0] - dx * t) ** 2 + (z - s.a[1] - dz * t) ** 2;
        if (d < bd) { bd = d; best = { tags: s.tags, id: s.id, dx: dx / Math.sqrt(L2), dz: dz / Math.sqrt(L2) }; }
      }
    }
    return best;
  };
}

function urbanAt(zones) {
  const zs = [...zones].sort((a, b) => a.s - b.s);
  return (s) => { let u = zs[0]?.urban ?? 0; for (const z of zs) if (s >= z.s) u = z.urban; return u; };
}

// ------------------------------------------------------------------ per map
const MAPS = {
  riviera: {
    mapPath: 'data/map.json',
    rawWays: () => readJSON(path.join(ROOT, 'data/raw/roads.json')).elements,
    rawNodes: () => readJSON(path.join(ROOT, 'data/raw/signs.json')).elements,
    edgeAt: (data) => (s) => {
      const r = data.route, i = Math.max(0, Math.min(r.x.length - 1, Math.round(s / r.step)));
      const div = r.div?.[i] ?? 0, lanes = r.lanes?.[i] ?? 2;
      return 0.12 + div * 1.2 + lanes * 3.3;
    },
  },
  penteli: {
    mapPath: 'data/maps/penteli/map.json',
    rawWays: () => readMaybeGz(path.join(ROOT, 'tools/maps/penteli/raw/osm.json')).elements,
    rawNodes: () => readMaybeGz(path.join(ROOT, 'tools/maps/penteli/raw/osm.json')).elements,
    edgeAt: () => () => 6.8 / 2,
  },
  megara: {
    mapPath: 'data/maps/megara/map.json',
    rawWays: () => readJSON(path.join(ROOT, 'tools/maps/megara/raw/context.json')),
    rawNodes: () => {
      const p = path.join(ROOT, 'tools/maps/megara/raw/signs.json');
      return fs.existsSync(p) ? readJSON(p).elements : [];
    },
    edgeAt: () => () => 11.5 / 2,
  },
};

function toXY(e, proj) {
  if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) {
    return [(e.lon - proj.lon0) * proj.mlon, -(e.lat - proj.lat0) * proj.mlat];
  }
  return null;
}

function inject(id) {
  const cfg = MAPS[id];
  const mapPath = path.join(ROOT, cfg.mapPath);
  const data = readJSON(mapPath);
  const route = data.route;
  const closed = !!route.closed;
  const { project, tangentAt, length } = routeSampler(route);
  const proj = data.proj;
  const urban = urbanAt(data.zones || [{ s: 0, urban: 0 }]);
  const edgeAt = cfg.edgeAt(data);

  const rawWays = cfg.rawWays();
  // node-ref fallback: OSM-API extracts (penteli) carry no Overpass geometry
  const nodeMap = new Map();
  for (const e of rawWays) if ((e.type === 'node' || (Number.isFinite(e.lat) && !e.nodes)) && Number.isFinite(e.lat)) nodeMap.set(e.id, e);
  const geomOf = (w) => {
    if (w.geometry?.length > 1) return w.geometry;
    if (Array.isArray(w.nodes) && w.nodes.length > 1) {
      const g = w.nodes.map((id) => nodeMap.get(id)).filter(Boolean);
      if (g.length > 1) return g;
    }
    return null;
  };
  const ways = rawWays.filter((e) => e.tags?.highway && geomOf(e));
  for (const w of ways) if (!w.geometry) w.geometry = geomOf(w);
  const nearestWay = wayTagIndex(ways, proj);
  const wayById = new Map(ways.map((w) => [w.id, w.tags || {}]));
  // node id -> member highway ways (for way-relative traffic_sign:direction)
  const memberWays = new Map();
  for (const w of ways) {
    if (!Array.isArray(w.nodes)) continue;
    const pts = (w.geometry || []).map((g) => [(g.lon - proj.lon0) * proj.mlon, -(g.lat - proj.lat0) * proj.mlat]);
    for (let i = 0; i < w.nodes.length; i++) {
      let l = memberWays.get(w.nodes[i]);
      if (!l) { l = []; memberWays.set(w.nodes[i], l); }
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      l.push({ id: w.id, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L, x: pts[Math.min(i, pts.length - 1)][0], z: pts[Math.min(i, pts.length - 1)][1] });
    }
  }

  // 1. route limits every 10 m from the nearest OSM way
  const stations = [];
  if (!closed) {
    for (let s = 0; s <= length; s += 10) {
      const i = Math.round(s / route.step);
      const q = nearestWay(route.x[i], route.z[i]);
      stations.push({ s, tag: q?.tags.maxspeed ?? null, urban: urban(s), highway: q?.tags.highway ?? '' });
    }
    route.speeds = buildRouteSpeeds(stations);
  } else {
    route.speeds = [];
  }

  // 2. sign + camera nodes near the route
  const rawNodes = cfg.rawNodes().filter((e) => e.type === 'node' || (Number.isFinite(e.lat) && !e.nodes));
  const nodes = [];
  for (const e of rawNodes) {
    if (!parseSignTags(e.tags || {})) continue;
    const xy = toXY(e, proj);
    if (!xy) continue;
    nodes.push({ id: e.id, x: xy[0], z: xy[1], tags: e.tags });
  }
  const wayDirAt = (n, s, u) => {
    const fb = n.tags['traffic_sign:direction'];
    if (fb !== 'forward' && fb !== 'backward') return 0;
    const t = tangentAt(s);
    // prefer a parent way the node is actually a member of (exact OSM semantics)
    const members = memberWays.get(n.id) || [];
    let best = null, bd = 30 * 30;
    for (const m of members) {
      const d = (m.x - n.x) ** 2 + (m.z - n.z) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    const dirOf = (dx, dz) => {
      const dot = dx * t.tx + dz * t.tz;
      return Math.abs(dot) < 0.3 ? 0 : Math.sign(dot);
    };
    if (best) return dirOf(best.dx, best.dz);
    // fallback: nearest way segment to the node itself
    const q = nearestWay(n.x, n.z, 25);
    return q ? dirOf(q.dx, q.dz) : 0;
  };
  const { signs: osm, cameras } = matchSigns(nodes, {
    project: (x, z) => {
      const q = project(x, z, 60);
      return q && q.d < 60 ? q : null;
    },
    tangentAt, wayDirAt, maxS: length,
  });
  // snap on-carriageway nodes (mapped as part of a way) to the roadside they serve
  for (const o of osm) {
    const e = edgeAt(o.s);
    if (Math.abs(o.u) < e + 0.6) o.u = Math.round(o.dir * (e + 2.2) * 10) / 10;
  }
  const inferred = closed ? [] : inferSigns(route.speeds, { edgeAt, closed });
  data.speedSigns = mergeSigns(osm, inferred);
  data.speedCameras = cameras;

  // 3. limits for the surrounding network + side roads that carry OSM way ids.
  // Canonical generator is extractRoadNetwork (tools/build-road-network.mjs),
  // which calls the same limitForWay: only fill in what a rebuild did not emit.
  let netTagged = 0, netInferred = 0;
  for (const road of data.roadNetwork?.roads || []) {
    if (road.v !== undefined) { if (road.vs === 'osm') netTagged++; else netInferred++; continue; }
    const tags = wayById.get(road.id);
    if (!tags) continue;
    const { v, src } = limitForWay(tags, road.urban ? 1 : 0);
    road.v = v; road.vs = src;
    if (src === 'osm') netTagged++; else netInferred++;
  }
  let sideTagged = 0, sideInferred = 0;
  for (const r of data.sideRoads || []) {
    if (r.id === undefined || r.v !== undefined) continue;
    const tags = wayById.get(r.id);
    if (!tags) continue;
    const { v, src } = limitForWay(tags, 0);
    r.v = v; r.vs = src;
    if (src === 'osm') sideTagged++; else sideInferred++;
  }

  fs.writeFileSync(mapPath, JSON.stringify(data));
  const nOsm = data.speedSigns.filter((s) => s.src === 'osm').length;
  console.log(`${id}: speeds=[${route.speeds.map((q) => q.v + '@' + q.s + (q.src === 'osm' ? '' : '~')).join(' ')}]`);
  console.log(`  signs: ${data.speedSigns.length} (${nOsm} mapped nodes, ${data.speedSigns.length - nOsm} inferred) cameras: ${cameras.length}`);
  console.log(`  network roads with limits: ${netTagged} tagged + ${netInferred} defaulted; side roads: ${sideTagged} + ${sideInferred}`);
  for (const o of osm) console.log(`  osm sign: s=${o.s} u=${o.u} v=${o.v} dir=${o.dir}`);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MAPS);
for (const id of ids) {
  if (!MAPS[id]) throw new Error('unknown map ' + id);
  inject(id);
}
