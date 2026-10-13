#!/usr/bin/env node
// Shared speed-limit / speed-sign extraction for the three maps.
// Pure functions (no three.js, no DOM) so tools/*.test.mjs can import them.
// The per-map builders call the pure functions; `node tools/speed-signs.mjs
// inject <riviera|megara|penteli>` patches the checked-in map.json files
// additively (existing keys are preserved byte-for-byte in value).
//
// Data (c) OpenStreetMap contributors (ODbL).

const URBAN_AT = 0.3; // zones[].urban >= this counts as urban for defaults
const MIN_RUN = 40; // m — shorter tagged runs are junction flicker, smoothed out
const DEDUPE_M = 70; // an OSM sign node suppresses inferred signs this close

/** Parse an OSM maxspeed value to km/h, or null when it is not a plain limit. */
export function parseLimit(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).trim().match(/^(\d{2,3})\b/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return v >= 5 && v <= 140 ? v : null;
}

/** trunk/motorway carriageways are expressways under the Greek KOK. */
export function isExpressway(highway) {
  return highway === 'motorway' || highway === 'trunk';
}

/** Greek defaults used where OSM has no tag: 50 urban, 90 rural, 110 expressway. */
export function defaultLimit({ urban = 0, highway = '' } = {}) {
  if (isExpressway(highway)) return 110;
  return urban >= URBAN_AT ? 50 : 90;
}

/** Limit for one OSM way: its maxspeed tag, else the Greek default. */
export function limitForWay(tags = {}, urban = 0) {
  const v = parseLimit(tags.maxspeed);
  if (v) return { v, src: 'osm' };
  return { v: defaultLimit({ urban, highway: tags.highway }), src: 'inferred' };
}

/**
 * Stepwise limits from per-sample stations [{s, tag|null, urban, highway}].
 * Untagged samples take the Greek default; runs shorter than MIN_RUN m are
 * absorbed into their longest neighbour so junction ways don't flicker signs.
 */
export function buildRouteSpeeds(stations) {
  if (!stations.length) return [];
  const evaled = stations.map((st) => {
    const tagged = parseLimit(st.tag);
    return tagged
      ? { s: st.s, v: tagged, src: 'osm' }
      : { s: st.s, v: defaultLimit(st), src: 'inferred' };
  });
  // runs of equal value
  const runs = [];
  for (const e of evaled) {
    const r = runs[runs.length - 1];
    if (r && r.v === e.v && r.src === e.src) r.s1 = e.s;
    else runs.push({ s0: e.s, s1: e.s, v: e.v, src: e.src });
  }
  // absorb short runs into the longest adjacent run
  for (let i = 1; i < runs.length - 1; i++) {
    if (runs[i].s1 - runs[i].s0 >= MIN_RUN) continue;
    const keep = (runs[i - 1].s1 - runs[i - 1].s0) >= (runs[i + 1].s1 - runs[i + 1].s0) ? i - 1 : i + 1;
    runs[i].v = runs[keep].v; runs[i].src = runs[keep].src;
  }
  // merge again after absorption
  const merged = [];
  for (const r of runs) {
    const m = merged[merged.length - 1];
    if (m && m.v === r.v && m.src === r.src) m.s1 = r.s1;
    else merged.push({ ...r });
  }
  return merged.map((r) => ({ s: Math.round(r.s0), v: r.v, src: r.src }));
}

/**
 * Decode one OSM node's tags. Returns {v} for a numeric speed sign,
 * {camera:true} for an enforcement camera, or null for anything else
 * (direction signs, VMS, end-of-limit plates without a number, ...).
 */
export function parseSignTags(tags = {}) {
  const t = tags;
  if (t.highway === 'speed_camera') return { camera: true };
  const fields = [t.traffic_sign, t['traffic_sign:forward'], t['traffic_sign:backward']].filter(Boolean);
  if (!fields.length) return null;
  const joined = fields.join(';');
  if (!/(^|;)maxspeed($|;)/.test(joined)) return null;
  const v = parseLimit(t.maxspeed);
  if (!v) return null; // e.g. maxspeed=implicit (end-of-limit back plate)
  let facing = null;
  if (t['traffic_sign:forward'] && /maxspeed/.test(t['traffic_sign:forward'])) facing = 'forward';
  if (t['traffic_sign:backward'] && /maxspeed/.test(t['traffic_sign:backward'])) facing = facing ? 'both' : 'backward';
  if (!facing && t['traffic_sign:direction'] === 'forward') facing = 'forward';
  else if (!facing && t['traffic_sign:direction'] === 'backward') facing = 'backward';
  else if (!facing && t['traffic_sign:direction'] === 'both') facing = 'both';
  return { v, facing };
}

/**
 * Which travel direction (+1 = increasing s, -1 = decreasing s) a sign faces.
 * ctx: {tags, u (lateral m, + = right of travel), tx, tz (route tangent),
 *       wayDir (+1/-1 when the parent OSM way runs along/opposite s, else 0)}.
 * OSM `direction=*` is the sign's facing angle (clockwise from north); the
 * face points at oncoming traffic, so travel runs opposite to the facing.
 */
export function resolveSignDir({ tags = {}, u = 0, tx = 1, tz = 0, wayDir = 0 }) {
  const both = tags['traffic_sign:direction'] === 'both';
  const deg = parseFloat(tags.direction);
  if (Number.isFinite(deg)) {
    const r = deg * Math.PI / 180;
    const fx = Math.sin(r), fz = -Math.cos(r); // facing unit vector in x-east/z-south
    const dirs = [(fx * tx + fz * tz) < 0 ? 1 : -1];
    return both ? [1, -1] : dirs;
  }
  const fb = tags['traffic_sign:direction'];
  if ((fb === 'forward' || fb === 'backward') && wayDir !== 0) {
    const d = fb === 'forward' ? wayDir : -wayDir;
    return both ? [1, -1] : [d];
  }
  if (both) return [1, -1];
  if (Math.abs(u) >= 1.2) return [u > 0 ? 1 : -1]; // right-hand traffic: right side serves that direction
  return [1];
}

/**
 * Turn raw OSM sign/cam nodes into route-space entries.
 * nodes: [{id, x, z, tags}]; project(x, z) -> {s, u, d} | null (null = too far);
 * tangentAt(s) -> {tx, tz}; wayDirAt(node, s, u) -> -1|0|1. maxS = route length.
 */
export function matchSigns(nodes, { project, tangentAt, wayDirAt, maxS }) {
  const signs = [], cameras = [];
  for (const n of nodes) {
    const parsed = parseSignTags(n.tags || {});
    if (!parsed) continue;
    const q = project(n.x, n.z);
    if (!q || q.s < -20 || q.s > maxS + 20) continue;
    const s = Math.round(Math.max(0, Math.min(maxS, q.s)));
    if (parsed.camera) {
      cameras.push({ s, u: Math.round(q.u * 10) / 10, dir: q.u >= 0 ? 1 : -1 });
      continue;
    }
    const t = tangentAt(s);
    const dirs = resolveSignDir({ tags: n.tags, u: q.u, tx: t.tx, tz: t.tz, wayDir: wayDirAt(n, s, q.u) });
    for (const dir of dirs) signs.push({ s, u: Math.round(q.u * 10) / 10, v: parsed.v, dir, src: 'osm' });
  }
  signs.sort((a, b) => a.s - b.s);
  cameras.sort((a, b) => a.s - b.s);
  return { signs, cameras };
}

/**
 * One sign per travel direction at every limit change point, on the correct
 * (right-hand) side of the road facing traffic. Closed circuits need none.
 */
export function inferSigns(speeds, { edgeAt, closed = false }) {
  if (closed || speeds.length < 2) return [];
  const out = [];
  for (let i = 1; i < speeds.length; i++) {
    if (speeds[i].v === speeds[i - 1].v) continue; // src-only transitions need no sign
    const s = speeds[i].s, v = speeds[i].v, e = edgeAt(s);
    for (const dir of [1, -1]) {
      out.push({ s, u: Math.round(dir * (e + 2.2) * 10) / 10, v, dir, src: 'inferred' });
    }
  }
  return out;
}

/** Inferred signs lose to a real mapped node nearby serving the same direction. */
export function mergeSigns(osm, inferred, dedupeM = DEDUPE_M) {
  const kept = inferred.filter((g) => !osm.some((o) => o.dir === g.dir && Math.abs(o.s - g.s) < dedupeM));
  return [...osm, ...kept].sort((a, b) => a.s - b.s || a.dir - b.dir);
}
