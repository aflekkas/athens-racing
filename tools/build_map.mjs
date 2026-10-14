#!/usr/bin/env node
// Builds the game's map data from the raw OpenStreetMap extracts in data/raw/.
//   node tools/build_map.mjs
// Outputs:
//   data/map.json     route centreline (projected metres), lanes, elevation, coastline, buildings,
//                     land-use areas, trees, shops, road furniture, side streets, place markers
//   data/terrain.bin  10 m height grid (Int16, decimetres) + land-cover class grid (Uint8)
// Map data (c) OpenStreetMap contributors (ODbL). Elevation: EU-DEM v1.1 via OpenTopoData.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRoadNetwork } from './build-road-network.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const load = (n) => JSON.parse(fs.readFileSync(path.join(RAW, n + '.json'), 'utf8')).elements;

// ------------------------------------------------------------------ projection (local tangent plane)
const LAT0 = 37.835, LON0 = 23.77;
const PHI = LAT0 * Math.PI / 180;
const MLAT = 111132.92 - 559.82 * Math.cos(2 * PHI) + 1.175 * Math.cos(4 * PHI);
const MLON = 111412.84 * Math.cos(PHI) - 93.5 * Math.cos(3 * PHI);
const P = (lat, lon) => [(lon - LON0) * MLON, -(lat - LAT0) * MLAT]; // x east, z south
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;

// route: Vouliagmeni -> Astir -> the lake -> Limanakia -> Varkiza -> the bends past Lomvarda (Athinon-Souniou, EO91)
const FROM = 'Vouliagmeni', TO = 'Lomvarda';
const PRE_LL = [37.8137, 23.7800];      // a little run-up behind the grid (Poseidonos, Vouliagmeni)
const START_LL = [37.8126, 23.7822];    // start line: Vouliagmeni, above Astir
const FINISH_LL = [37.8196, 23.8372];   // Lomvarda cove
const END_LL = [37.8184, 23.8417];      // run-out towards Agia Marina

// ------------------------------------------------------------------ helpers
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return a / 2; }
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function dp(points, eps) { // Douglas-Peucker
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = -1, mi = -1;
    const A = points[a], B = points[b]; const dx = B[0] - A[0], dz = B[1] - A[1]; const L = Math.hypot(dx, dz);
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-6 ? Math.hypot(points[i][0] - A[0], points[i][1] - A[1]) : Math.abs((points[i][0] - A[0]) * dz - (points[i][1] - A[1]) * dx) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }

// Greek -> Latin (ELOT 743 style) so no Greek text ever reaches the screen
const GR = { 'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o' };
function translit(s) {
  if (!s) return s;
  let t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/ου/g, 'ou').replace(/αυ(?=[θκξπστφχψ]|$)/g, 'af').replace(/αυ/g, 'av').replace(/ευ(?=[θκξπστφχψ]|$)/g, 'ef').replace(/ευ/g, 'ev')
    .replace(/(^|\s)μπ/g, '$1b').replace(/μπ/g, 'mp').replace(/(^|\s)ντ/g, '$1d').replace(/γκ/g, 'gk').replace(/γγ/g, 'ng').replace(/γχ/g, 'nch');
  t = [...t].map((c) => GR[c] ?? c).join('');
  return t.replace(/(^|[\s\-'"(&.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}
const hasGreek = (s) => /[Ͱ-Ͽἀ-῿]/.test(s || '');
const latinName = (t) => {
  const en = t['name:en'];
  if (en && !hasGreek(en)) return en;
  const n = t.name; if (!n) return null;
  return hasGreek(n) ? translit(n) : n;
};

// ------------------------------------------------------------------ 0. coastline (needed first: the route is chosen to hug it)
const coastWays = load('coast');
const coast = [];
const coastSegs = [];
for (const w of coastWays) {
  const pts = dp(w.geometry.map((g) => P(g.lat, g.lon)), 1.2);
  coast.push(pts.flatMap((p) => [r1(p[0]), r1(p[1])]));
  const closed = dist(pts[0], pts[pts.length - 1]) < 0.5;
  const base = coastSegs.length, cnt = pts.length - 1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const prev = i > 0 ? base + i - 1 : (closed ? base + cnt - 1 : -1), next = i + 1 < cnt ? base + i + 1 : (closed ? base : -1);
    coastSegs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], prev, next]);
  }
}
// segment hash for signed distance
const SC = 60, segHash = new Map();
const key = (cx, cz) => cx * 100003 + cz;
coastSegs.forEach((s, idx) => {
  const x0 = Math.floor(Math.min(s[0], s[2]) / SC), x1 = Math.floor(Math.max(s[0], s[2]) / SC);
  const z0 = Math.floor(Math.min(s[1], s[3]) / SC), z1 = Math.floor(Math.max(s[1], s[3]) / SC);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = key(i, j); if (!segHash.has(k)) segHash.set(k, []); segHash.get(k).push(idx); }
});
function coastDist(x, z, maxR = 1500) {
  const cx = Math.floor(x / SC), cz = Math.floor(z / SC); let bd = 1e18, side = 1;
  for (let r = 0; r * SC <= maxR; r++) {
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const b = segHash.get(key(cx + i, cz + j)); if (!b) continue;
      for (const k of b) {
        const s = coastSegs[k]; const dx = s[2] - s[0], dz = s[3] - s[1]; const L2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - s[0]) * dx + (z - s[1]) * dz) / L2; t = Math.max(0, Math.min(1, t));
        const px = s[0] + dx * t, pz = s[1] + dz * t; const d = (x - px) ** 2 + (z - pz) ** 2;
        if (d < bd - 1e-9) {
          bd = d;
          const L = Math.sqrt(L2);
          let cr = (dx * (z - s[1]) - dz * (x - s[0])) / L;
          // at a vertex use the pseudo-normal (sum with the neighbouring segment) so corners get the right side
          const nb = t <= 0 ? s[4] : t >= 1 ? s[5] : -1;
          if (nb >= 0) { const q = coastSegs[nb]; const qx = q[2] - q[0], qz = q[3] - q[1]; const QL = Math.hypot(qx, qz) || 1e-9; cr += (qx * (z - q[1]) - qz * (x - q[0])) / QL; }
          side = cr < 0 ? 1 : -1;
        }
      }
    }
    if (bd < 1e17 && Math.sqrt(bd) < (r - 0.5) * SC) break;
  }
  if (bd > 1e17) return maxR; // far inland or far at sea - decide by DEM later
  // coastline: land on the LEFT of the way direction. With x east / z south, "left" = cross < 0
  return Math.sqrt(bd) * side;
}
// sanity: Vari inland must be land
{
  const inland = coastDist(...P(37.8230, 23.8100)), sea = coastDist(...P(37.8000, 23.8200));
  console.log('coast sign check (inland +, sea -):', inland.toFixed(0), sea.toFixed(0));
  if (inland < 0) throw new Error('coast sign inverted');
}

// ------------------------------------------------------------------ 1. route through the OSM road graph
const roads = load('roads');
const nodePos = new Map(), adj = new Map(), wayTags = new Map();
const MAIN = new Set(['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link']);
// the race follows the seafront: any proper street is allowed, but every metre is priced by how far it
// strays from the Saronic Gulf shoreline, so the cheapest path is the coast road itself (Aktis / Iliou
// round the Vouliagmeni bay, the cliff-side Athinon-Souniou road and Varkiza beach)
const ROUTE_OK = new Set([...MAIN, 'tertiary', 'tertiary_link', 'secondary_link', 'unclassified']);
const TYPE_PEN = { trunk: 1, primary: 1, secondary: 1.05, trunk_link: 1.2, primary_link: 1.2, secondary_link: 1.2, tertiary: 1.3, tertiary_link: 1.3, unclassified: 1.6 };
const coastPen = (x, z) => { const d = Math.abs(coastDist(x, z, 1500)); return 1 + (Math.max(0, d - 220) / 80) ** 2; };
for (const w of roads) {
  const t = w.tags || {};
  w.nodes.forEach((n, i) => nodePos.set(n, P(w.geometry[i].lat, w.geometry[i].lon)));
  if (!ROUTE_OK.has(t.highway)) continue;
  if (t.access === 'private' || t.access === 'no' || t.area === 'yes') continue;
  wayTags.set(w.id, t);
  const ow = t.oneway, pen = TYPE_PEN[t.highway] || 1.5;
  for (let i = 0; i + 1 < w.nodes.length; i++) {
    const a = w.nodes[i], b = w.nodes[i + 1], pa = nodePos.get(a), pb = nodePos.get(b);
    const L = dist(pa, pb) * pen * coastPen((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
    if (ow !== '-1') { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, L, w.id]); }
    if (ow !== 'yes') { if (!adj.has(b)) adj.set(b, []); adj.get(b).push([a, L, w.id]); }
  }
}
function nearestNode(ll) { const p = P(...ll); let best = null, bd = 1e18; for (const n of adj.keys()) { const d = dist(nodePos.get(n), p); if (d < bd) { bd = d; best = n; } } return best; }
function dijkstra(s, e) {
  const D = new Map([[s, 0]]), prev = new Map(); const heap = [[0, s]];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [c, u] = pop(); if (u === e) break; if (c > D.get(u)) continue;
    for (const [v, L, wid] of adj.get(u) || []) if (c + L < (D.get(v) ?? 1e18)) { D.set(v, c + L); prev.set(v, [u, wid]); push([c + L, v]); }
  }
  const nodes = [e], ways = []; while (nodes[nodes.length - 1] !== s) { const [u, w] = prev.get(nodes[nodes.length - 1]); nodes.push(u); ways.push(w); }
  return { nodes: nodes.reverse(), ways: ways.reverse() };
}
const { nodes: pathNodes, ways: pathWays } = dijkstra(nearestNode(PRE_LL), nearestNode(END_LL));
const raw = pathNodes.map((n) => nodePos.get(n));
const routeWays = new Set(pathWays);
console.log('route nodes', raw.length);

// resample at 1 m keeping the source way for lane attributes
function resample(pts, step, attrs) {
  const out = [], oat = [];
  let acc = 0; out.push(pts[0]); if (attrs) oat.push(attrs[0]);
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = dist(a, b);
    let t = step - carry;
    while (t <= L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); if (attrs) oat.push(attrs[i]); t += step; }
    carry = L - (t - step);
    acc += L;
  }
  return { pts: out, attrs: oat, length: acc };
}
function gaussSmooth(arr, sigma, dims = 2) {
  const R = Math.ceil(sigma * 3), K = []; let ks = 0;
  for (let i = -R; i <= R; i++) { const k = Math.exp(-i * i / (2 * sigma * sigma)); K.push(k); ks += k; }
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const acc = new Array(dims).fill(0);
    for (let j = -R; j <= R; j++) {
      let q = i + j;
      // reflect about the endpoint so the ends stay put
      let v;
      if (q < 0) { const a = arr[0], b = arr[Math.min(n - 1, -q)]; v = dims === 1 ? 2 * a - b : a.map((x, d) => 2 * x - b[d]); }
      else if (q >= n) { const a = arr[n - 1], b = arr[Math.max(0, 2 * (n - 1) - q)]; v = dims === 1 ? 2 * a - b : a.map((x, d) => 2 * x - b[d]); }
      else v = arr[q];
      if (dims === 1) acc[0] += v * K[j + R]; else for (let d = 0; d < dims; d++) acc[d] += v[d] * K[j + R];
    }
    out[i] = dims === 1 ? acc[0] / ks : acc.map((x) => x / ks);
  }
  return out;
}
let rs = resample(raw, 1, pathWays);
let sm = gaussSmooth(gaussSmooth(rs.pts, 9), 5);
const wayAt = rs.attrs;

// lanes per metre from OSM tags (median filter over ~300 m; junction flare lanes ignored)
// one-way carriageways of the trunk/primary avenue are halves of a divided road; one-way seafront streets
// (Aktis, Iliou) are drawn as a narrow two-way street (their return lane runs a block inland)
const lanesRaw = wayAt.map((w) => {
  const t = wayTags.get(w) || {}; const l = parseInt(t.lanes || '0', 10);
  const big = MAIN.has(t.highway);
  if (!big) return { div: false, lanes: 2, minor: true };
  return { div: t.oneway === 'yes', lanes: l };
});
const N1 = sm.length;
const divided = new Float32Array(N1), nR = new Float32Array(N1);
for (let i = 0; i < N1; i++) {
  const c = {}; let dv = 0, cnt = 0;
  for (let j = Math.max(0, i - 150); j < Math.min(N1, i + 150); j += 5) { const q = lanesRaw[j]; dv += q.div ? 1 : 0; cnt++; if (q.lanes) { const k = q.div ? Math.min(3, Math.max(2, q.lanes)) : Math.max(1, Math.round(q.lanes / 2)); c[k] = (c[k] || 0) + 1; } }
  divided[i] = dv / cnt > 0.5 ? 1 : 0;
  let best = 2, bc = -1; for (const k in c) if (c[k] > bc) { bc = c[k]; best = +k; }
  nR[i] = best;
}
// smooth step transitions (tapers ~150 m)
const divS = gaussSmooth(Array.from(divided), 40, 1), nRS = gaussSmooth(Array.from(nR), 40, 1);
const LANE_W = 3.3;
const medHalfAt = (i) => 0.12 + divS[i] * 1.2; // ~2.6 m raised island where the avenue splits, double line otherwise
// shift from the carriageway (way) centre to the median line
const median = sm.map((p, i) => {
  const a = sm[Math.max(0, i - 2)], b = sm[Math.min(N1 - 1, i + 2)];
  let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
  const lx = tz, lz = -tx; // left normal (x east, z south): rotate tangent +90 about up
  const off = divS[i] * (nRS[i] * LANE_W / 2 + medHalfAt(i));
  return [p[0] + lx * off, p[1] + lz * off];
});
const med2 = gaussSmooth(median, 4);
rs = resample(med2, 2, med2.map((_, i) => i));
const RX = [], RZ = [], RI = rs.attrs;
for (const p of rs.pts) { RX.push(p[0]); RZ.push(p[1]); }
const NS = RX.length, STEP = 2;
const routeLen = (NS - 1) * STEP;
console.log('route length', routeLen.toFixed(0), 'm, samples', NS);

// heading / left normal per sample
const TX = new Float32Array(NS), TZ = new Float32Array(NS);
for (let i = 0; i < NS; i++) { const a = Math.max(0, i - 1), b = Math.min(NS - 1, i + 1); const dx = RX[b] - RX[a], dz = RZ[b] - RZ[a]; const L = Math.hypot(dx, dz) || 1; TX[i] = dx / L; TZ[i] = dz / L; }

// spatial hash of route samples for (s,u) projection
const CELL = 50, bucket = new Map();
for (let i = 0; i < NS; i++) { const k = key(Math.floor(RX[i] / CELL), Math.floor(RZ[i] / CELL)); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(i); }
function project(x, z, maxR = 600) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); let best = -1, bd = 1e18;
  for (let r = 0; r * CELL <= maxR + CELL; r++) {
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const b = bucket.get(key(cx + i, cz + j)); if (!b) continue;
      for (const k of b) { const d = (RX[k] - x) ** 2 + (RZ[k] - z) ** 2; if (d < bd) { bd = d; best = k; } }
    }
    if (best >= 0 && Math.sqrt(bd) < (r - 0.5) * CELL) break;
  }
  if (best < 0) return null;
  // refine on the segment
  let k = best; const dx = x - RX[k], dz = z - RZ[k];
  const along = dx * TX[k] + dz * TZ[k];
  const u = dx * (-TZ[k]) + dz * TX[k]; // + = right of travel direction (x east, z south)
  return { s: k * STEP + along, u, i: k, d: Math.sqrt(bd) };
}
const sOf = (ll) => project(...P(...ll)).s;
const S_START = Math.round(sOf(START_LL)), S_FINISH = Math.round(sOf(FINISH_LL));
console.log('start s', S_START, 'finish s', S_FINISH, 'race length', S_FINISH - S_START);

// key places along the route for banners (s positions)
const MARKS = [
  { id: 'astir', name: 'ASTIR', sub: 'Astir Beach · Astir Palace across the bay', ll: [37.8092, 23.7790] },
  { id: 'lake', name: 'LAKE VOULIAGMENI', sub: 'Thermal lake under the limestone cliff', ll: [37.8077, 23.7854] },
  { id: 'limanakia', name: 'LIMANAKIA', sub: 'Rocky coves · Athinon-Souniou Avenue', ll: [37.8015, 23.7905] },
  { id: 'varkiza', name: 'VARKIZA', sub: 'Varkiza Beach · the fishing harbour', ll: [37.8150, 23.8008] },
  { id: 'coast', name: 'ATHINON-SOUNIOU', sub: 'The bends along the Saronic shore', ll: [37.8140, 23.8150] },
  { id: 'lomvarda', name: 'LOMVARDA', sub: 'The cove below Agia Marina', ll: [37.8196, 23.8372] },
];
const marks = MARKS.map((m) => ({ ...m, s: Math.round(sOf(m.ll)) })).map(({ ll, ...r }) => r);
// character of each stretch from where it begins: town / beach (summer crowd) / cliff (open coast road) / cove (cars on the dirt shoulders)
const ZONES = [
  { zone: 'beach', urban: 1, ll: START_LL },                 // Vouliagmeni, Astir, the lake
  { zone: 'cliff', urban: 0, ll: [37.8045, 23.7867] }, // round the headland below the lake
  { zone: 'cove', urban: 0, ll: [37.8017, 23.7895] },        // Limanakia A/B: parking on the dirt, steps down to the rocks
  { zone: 'cliff', urban: 0, ll: [37.8045, 23.7978] },
  { zone: 'town', urban: 1, ll: [37.8095, 23.8004] },        // Varkiza
  { zone: 'cliff', urban: 0, ll: [37.8210, 23.8060] },
  { zone: 'cove', urban: 0, ll: [37.8178, 23.8330] },        // Lomvarda
  { zone: 'cliff', urban: 0, ll: [37.8212, 23.8420] },
];
const zones = ZONES.map((z) => ({ zone: z.zone, urban: z.urban, s: z.ll === START_LL ? 0 : Math.round(sOf(z.ll)) })).sort((a, b) => a.s - b.s);
console.log('zones', zones.map((z) => z.zone + '@' + z.s).join(' '));
const zoneAt = (s) => { let z = zones[0]; for (const q of zones) if (s >= q.s) z = q; return z.zone; };

// lanes / median per 2 m sample
const lanesOut = [], divOut = [];
for (let i = 0; i < NS; i++) { const j = Math.min(N1 - 1, Math.round(RI[i])); lanesOut.push(r2(nRS[j])); divOut.push(r2(divS[j])); }

// road names along the route (Latin)
const roadNames = [];
{
  let last = null;
  for (let i = 0; i < NS; i += 10) {
    const j = Math.min(N1 - 1, Math.round(RI[i]));
    const t = wayTags.get(wayAt[j]) || {};
    let n = latinName(t) || last;
    if (n === last) continue;
    roadNames.push({ s: i * STEP, name: n }); last = n;
  }
}

// posted speed limits (OSM maxspeed), smoothed over ~120 m so a short junction way doesn't flicker a sign
const speeds = [];
{
  const raw = [];
  for (let i = 0; i < NS; i += 5) { const j = Math.min(N1 - 1, Math.round(RI[i])); const v = parseInt((wayTags.get(wayAt[j]) || {}).maxspeed || '0', 10); raw.push(v || null); }
  let last = null;
  for (let k = 0; k < raw.length; k++) {
    const c = {}; for (let q = Math.max(0, k - 6); q <= Math.min(raw.length - 1, k + 6); q++) if (raw[q]) c[raw[q]] = (c[raw[q]] || 0) + 1;
    let v = last, bc = 0; for (const key in c) if (c[key] > bc) { bc = c[key]; v = +key; }
    if (v && v !== last) { speeds.push({ s: k * 5 * STEP, v }); last = v; }
  }
}
console.log('speed limits', speeds.map((q) => q.v + '@' + q.s).join(' '));

// ------------------------------------------------------------------ 2. elevation (DEM) along the route
let dem = null;
const demPath = path.join(RAW, 'dem.json');
if (fs.existsSync(demPath)) dem = JSON.parse(fs.readFileSync(demPath, 'utf8'));
function demAt(x, z) {
  if (!dem) return 5;
  const fx = (x - dem.x0) / dem.step, fz = (z - dem.z0) / dem.step;
  const i = Math.max(0, Math.min(dem.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(dem.nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
  const h = (a, b) => dem.h[b * dem.nx + a];
  return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz;
}

// route elevation: DEM smoothed hard, kept above the sea where the road runs on the waterfront
const yRaw = [];
for (let i = 0; i < NS; i++) {
  const x = RX[i], z = RZ[i];
  let h = demAt(x, z);
  const cd = coastDist(x, z, 400);
  h = Math.max(h, 1.6 + Math.max(0, Math.min(cd, 60)) * 0.04);
  yRaw.push(h);
}
let RY = gaussSmooth(gaussSmooth(yRaw, 45, 1), 25, 1);
// limit the grade to 7 %
for (let pass = 0; pass < 4; pass++) for (let i = 1; i < NS; i++) { const g = (RY[i] - RY[i - 1]) / STEP; if (Math.abs(g) > 0.07) RY[i] = RY[i - 1] + Math.sign(g) * 0.07 * STEP; }
RY = gaussSmooth(RY, 10, 1);

// ------------------------------------------------------------------ 4. buildings
const bEls = load('buildings');
const ASTIR = { s: 37.7955, n: 37.8125, w: 23.7630, e: 23.7800 };
const buildings = [];
const roadHalfAt = (s) => { const i = Math.max(0, Math.min(NS - 1, Math.round(s / STEP))); const mh = 0.12 + divOut[i] * 1.2; return mh + lanesOut[i] * LANE_W + 1.2; };
const routeYAt = (s) => RY[Math.max(0, Math.min(NS - 1, Math.round(s / STEP)))];
const districtOf = (s) => (zoneAt(s) === 'town' ? 'voula' : 'riviera'); // Varkiza: low apartment blocks; elsewhere villas
for (const b of bEls) {
  if (!b.geometry || b.geometry.length < 4) continue;
  let pts = b.geometry.map((g) => P(g.lat, g.lon));
  if (dist(pts[0], pts[pts.length - 1]) < 0.01) pts.pop();
  const lat = b.geometry[0].lat, lon = b.geometry[0].lon;
  const inAstir = lat > ASTIR.s && lat < ASTIR.n && lon > ASTIR.w && lon < ASTIR.e;
  const c = centroid(pts);
  const pr = project(c[0], c[1], 700);
  if (!pr) continue;
  if (pr.s < 0 || pr.s > routeLen) continue;
  const lim = inAstir ? 2000 : 520;
  if (Math.abs(pr.u) > lim || pr.d > lim) continue;
  // drop footprints that overlap the carriageway (canopies / mapping errors)
  let bad = false;
  for (const q of pts) { const pq = project(q[0], q[1], 200); if (pq && Math.abs(pq.u) < roadHalfAt(pq.s) + 1.5 && pq.d < 60) { bad = true; break; } }
  if (bad) continue;
  pts = dp(pts.concat([pts[0]]), 0.35); pts.pop();
  if (pts.length < 3) continue;
  const area = Math.abs(polyArea(pts));
  if (area < 12) continue;
  const t = b.tags || {};
  const kind = t.building;
  const id = b.id;
  const rnd = hash(id % 2147483647);
  const dis = districtOf(pr.s);
  let lv = parseInt(t['building:levels'] || '0', 10);
  let roofOnly = kind === 'roof' || kind === 'carport';
  if (!lv) {
    if (roofOnly) lv = 1;
    else if (kind === 'garage' || kind === 'shed' || kind === 'garages' || area < 35) lv = 1;
    else if (kind === 'house' || kind === 'detached' || kind === 'villa') lv = 2;
    else if (kind === 'hotel' || t.tourism === 'hotel') lv = inAstir ? 3 + Math.floor(rnd * 4) : 5 + Math.floor(rnd * 3);
    else if (kind === 'church') lv = 2;
    else if (dis === 'glyfada') lv = area > 900 ? 6 + Math.floor(rnd * 2) : area > 260 ? 4 + Math.floor(rnd * 3) : area > 110 ? 3 + Math.floor(rnd * 2) : 2;
    else if (dis === 'voula') lv = area > 600 ? 4 + Math.floor(rnd * 2) : area > 200 ? 3 + Math.floor(rnd * 2) : 2 + Math.floor(rnd * 1.5);
    else if (inAstir) lv = area > 1500 ? 4 + Math.floor(rnd * 3) : 2;
    else lv = area > 400 ? 3 + Math.floor(rnd * 1.6) : 2 + Math.floor(rnd * 1.3);
  }
  lv = Math.max(1, Math.min(12, lv));
  let k = 'apt';
  if (kind === 'house' || kind === 'detached' || kind === 'villa' || (dis !== 'glyfada' && dis !== 'voula' && area < 400 && !inAstir)) k = 'villa';
  if (kind === 'hotel' || (inAstir && area > 600)) k = 'hotel';
  if (kind === 'church') k = 'church';
  if (roofOnly) k = 'roof';
  if (kind === 'garage' || kind === 'shed' || kind === 'garages') k = 'shed';
  if (kind === 'retail' || kind === 'commercial' || kind === 'supermarket') k = 'shop';
  let ht = parseFloat(t.height || '0') || (lv * 3.15 + (k === 'roof' ? 0 : 0.5));
  // elevation of the ground under the building (lowest DEM corner, near-road buildings sit at road level)
  const flat = pts.flatMap((p) => [r1(p[0]), r1(p[1])]);
  buildings.push({ p: flat, h: r1(ht), lv, k, s: Math.round(pr.s), u: Math.round(pr.u), id: id % 100000, name: latinName(t) || undefined });
}
console.log('buildings kept', buildings.length);

// ------------------------------------------------------------------ 5. features
const fEls = load('features');
const areas = { beach: [], lake: [], pool: [], scrub: [], rock: [], cliff: [], wood: [], park: [], marina: [], pier: [], breakwater: [], parking: [], golf: [], pitch: [], residential: [], fuel: [] };
const trees = [], pois = [], furniture = [], places = [];
const wayToPts = (e) => e.geometry ? e.geometry.map((g) => P(g.lat, g.lon)) : null;
function near(pts, lim) { for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 12))) { const q = project(pts[i][0], pts[i][1], lim + 100); if (q && q.d < lim) return true; } return false; }
const flat = (pts) => pts.flatMap((p) => [r1(p[0]), r1(p[1])]);
for (const e of fEls) {
  const t = e.tags || {};
  if (e.type === 'way') {
    let pts = wayToPts(e); if (!pts || pts.length < 2) continue;
    let cls = null, lim = 1200;
    if (t.natural === 'water' && /Βουλιαγμ|Vouliagm/.test(t.name || '') ) cls = 'lake';
    else if (t.leisure === 'swimming_pool' || (t.natural === 'water' && Math.abs(polyArea(pts)) < 800)) { cls = 'pool'; lim = 700; }
    else if (t.natural === 'beach' || t.natural === 'sand') cls = 'beach';
    else if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'grassland' || t.landuse === 'meadow') cls = 'scrub';
    else if (t.natural === 'bare_rock' || t.natural === 'rock') cls = 'rock';
    else if (t.natural === 'cliff') cls = 'cliff';
    else if (t.natural === 'wood' || t.landuse === 'forest') cls = 'wood';
    else if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'recreation_ground') cls = 'park';
    else if (t.leisure === 'marina') cls = 'marina';
    else if (t.man_made === 'pier') cls = 'pier';
    else if (t.man_made === 'breakwater' || t.man_made === 'groyne') cls = 'breakwater';
    else if (t.amenity === 'parking') { cls = 'parking'; lim = 300; }
    else if (t.leisure === 'golf_course') cls = 'golf';
    else if (t.leisure === 'pitch') { cls = 'pitch'; lim = 600; }
    else if (t.landuse === 'residential' || t.landuse === 'commercial' || t.landuse === 'retail') cls = 'residential';
    else if (t.amenity === 'fuel') { cls = 'fuel'; lim = 200; }
    if (!cls) {
      if (t.tourism && t.name) { const c = centroid(pts); const q = project(c[0], c[1]); if (q && q.d < 800) places.push({ x: r1(c[0]), z: r1(c[1]), s: Math.round(q.s), u: Math.round(q.u), name: latinName(t), kind: t.tourism }); }
      continue;
    }
    if (!near(pts, lim)) continue;
    const closed = dist(pts[0], pts[pts.length - 1]) < 0.5;
    pts = dp(pts, cls === 'lake' ? 0.5 : 1.0);
    if (closed && pts.length > 3) pts.pop();
    const rec = { p: flat(pts), c: closed ? 1 : 0 };
    if (t.name) rec.n = latinName(t);
    if (cls === 'parking') rec.sf = /^(unpaved|dirt|ground|gravel|compacted|fine_gravel|sand|grass|earth)$/.test(t.surface || '') ? 'dirt' : t.surface ? 'paved' : undefined;
    areas[cls].push(rec);
  } else if (e.type === 'node') {
    const p = P(e.lat, e.lon);
    const q = project(p[0], p[1], 900); if (!q) continue;
    if (t.natural === 'tree') { if (q.d < 700) trees.push([r1(p[0]), r1(p[1]), /palm|Phoenix|φοίνικ/i.test((t.species || '') + (t.name || '') + (t.genus || '') + (t.taxon || '')) ? 1 : 0]); continue; }
    if (t.highway && ['traffic_signals', 'crossing', 'bus_stop', 'street_lamp'].includes(t.highway)) {
      if (q.d < 40 && q.s > 0 && q.s < routeLen) furniture.push({ t: t.highway, s: Math.round(q.s), u: r1(q.u), n: t.highway === 'bus_stop' ? latinName(t) : undefined });
      continue;
    }
    const name = latinName(t);
    if ((t.shop || t.amenity) && name && q.d < 160 && q.s > 0 && q.s < routeLen) {
      pois.push({ x: r1(p[0]), z: r1(p[1]), s: Math.round(q.s), u: Math.round(q.u), k: t.shop ? 'shop:' + t.shop : t.amenity, n: name.slice(0, 26) });
      continue;
    }
    if ((t.place || t.natural === 'bay' || t.natural === 'beach' || t.natural === 'cape' || t.natural === 'peak') && name) places.push({ x: r1(p[0]), z: r1(p[1]), s: Math.round(q.s), u: Math.round(q.u), name, kind: t.place || t.natural });
  }
}
// relations (multipolygon outer rings) for big scrub/wood areas
for (const e of fEls) if (e.type === 'relation' && e.members) {
  const t = e.tags || {};
  const cls = t.natural === 'scrub' ? 'scrub' : t.natural === 'wood' ? 'wood' : t.natural === 'beach' ? 'beach' : t.natural === 'bare_rock' ? 'rock' : null;
  if (!cls) continue;
  for (const m of e.members) if (m.role === 'outer' && m.geometry) { let pts = m.geometry.map((g) => P(g.lat, g.lon)); if (!near(pts, 1200)) continue; pts = dp(pts, 1.5); areas[cls].push({ p: flat(pts), c: 1 }); }
}
console.log('areas', Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, v.length])), 'trees', trees.length, 'pois', pois.length, 'furniture', furniture.length);

// ------------------------------------------------------------------ 6. side streets
const sideRoads = [];
const SIDE = { secondary: 7.5, tertiary: 7, unclassified: 6, residential: 5.6, living_street: 4.5, service: 4, primary: 9, trunk: 10, primary_link: 6, trunk_link: 6.5, pedestrian: 4, footway: 2.2, cycleway: 2.2, path: 1.6, track: 3, steps: 2 };
for (const w of roads) {
  const t = w.tags || {}; const wdt = SIDE[t.highway]; if (!wdt) continue;
  if (t.service === 'parking_aisle' || t.service === 'drive-through') continue;
  if (t.tunnel === 'yes' || t.layer && +t.layer < 0) continue;
  const pts = w.geometry.map((g) => P(g.lat, g.lon));
  // skip the route's own carriageways
  if (routeWays.has(w.id)) continue;
  let keep = false, onRoad = 0;
  for (const q of pts) { const pq = project(q[0], q[1], 500); if (pq && pq.d < 460) keep = true; if (pq && Math.abs(pq.u) < roadHalfAt(pq.s) + 4) onRoad++; }
  if (!keep) continue;
  if (onRoad > pts.length * 0.6 && pts.length > 2) continue; // parallel duplicate of the main road
  const foot = ['footway', 'cycleway', 'path', 'steps', 'pedestrian'].includes(t.highway);
  sideRoads.push({ p: flat(dp(pts, 0.6)), w: wdt, f: foot ? 1 : 0, n: (!foot && latinName(t)) || undefined });
}
console.log('side roads', sideRoads.length);

// concrete New Jersey barriers documented on the sea side at the second Limanaki (replaced the steel rail)
const BARRIERS = [{ from: [37.8019, 23.7915], to: [37.8016, 23.7945], side: 1 }];
const barriers = BARRIERS.map((b) => { const a = Math.round(sOf(b.from)), c = Math.round(sOf(b.to)); return { s0: Math.min(a, c), s1: Math.max(a, c), side: b.side }; });
console.log('barriers', JSON.stringify(barriers));

// ------------------------------------------------------------------ 6b. where cars park, and the dirt humps
// The coves (Limanakia, Lomvarda) have no marked bays: in summer cars line the dirt shoulder and fill the
// unpaved lay-bys, which are bulldozed flat with spoil heaped round the edges. OSM parking polygons are used as
// they are (rows of bays along their long side); untagged lots out of town are dirt, as they are on the ground.
const parkSpots = [], humps = [];
{
  let seed = 1;
  const rnd = () => hash(seed++);
  const landFlat = (x, z, y0, tol) => coastDist(x, z, 300) > 5 && Math.abs(demAt(x, z) - y0) < tol;
  const free = (x, z, r) => !parkSpots.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < r * r) && !humps.some((h) => (h[0] - x) ** 2 + (h[1] - z) ** 2 < (h[2] + r) ** 2);
  // 1. parking polygons near the route
  for (const a of areas.parking) {
    if (!a.c) continue;
    const pts = []; for (let i = 0; i < a.p.length; i += 2) pts.push([a.p[i], a.p[i + 1]]);
    const c = centroid(pts), q = project(c[0], c[1], 300); if (!q || q.d > 120 || q.s < 0 || q.s > routeLen) continue;
    const dirt = a.sf === 'dirt' || (!a.sf && zoneAt(q.s) !== 'town');
    a.sf = dirt ? 'dirt' : 'paved';
    // long axis
    let bi = 0, bl = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length, l = dist(pts[i], pts[j]); if (l > bl) { bl = l; bi = i; } }
    const A = pts[bi], B = pts[(bi + 1) % pts.length], ax = (B[0] - A[0]) / bl, az = (B[1] - A[1]) / bl;
    const inside = (x, z) => { let k = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) k = !k; } return k; };
    const yaw = Math.atan2(az, -ax); // nose across the rows (forward = (-sin yaw, -cos yaw))
    let ext = 0; for (const p of pts) ext = Math.max(ext, dist(p, c));
    let lotN = 0;
    for (let v = -ext; v <= ext; v += 6.2) for (let w = -ext; w <= ext; w += 2.7) {
      const x = c[0] + ax * w - az * v, z = c[1] + az * w + ax * v;
      if (!inside(x, z) || !inside(x + ax * 1.3, z + az * 1.3) || !inside(x - ax * 1.3, z - az * 1.3)) continue;
      if (rnd() > (dirt ? 0.5 : 0.4) || lotN >= 28) continue;
      { const qs = project(x, z, 100); if (qs && Math.abs(qs.u) < roadHalfAt(qs.s) + (zoneAt(qs.s) === 'town' ? 6.5 : 1.4)) continue; } // OSM lots overlap the verge; in town that's the pavement (kerbside bays are parked by traffic.js)
      lotN++;
      parkSpots.push({ x: r1(x), z: r1(z), yaw: r2(yaw + (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * (dirt ? 0.3 : 0.06)), d: dirt ? 1 : 0 });
    }
    // spoil heaps round the edge of a dirt lot
    if (dirt) for (let i = 0; i < pts.length; i++) {
      const P0 = pts[i], P1 = pts[(i + 1) % pts.length], L = dist(P0, P1);
      for (let t = 4; t < L - 4; t += 9 + rnd() * 10) {
        const x = P0[0] + (P1[0] - P0[0]) * t / L, z = P0[1] + (P1[1] - P0[1]) * t / L;
        const qq = project(x, z, 200); if (!qq || Math.abs(qq.u) < roadHalfAt(qq.s) + 5) continue; // not on the road side
        const r = 2.2 + rnd() * 2.6;
        if (free(x, z, r * 0.6)) humps.push([r1(x), r1(z), r2(r), r2(0.35 + rnd() * 0.75), r2(rnd() * 6)]);
      }
    }
  }
  // 2. the cove shoulders: a row of cars on the dirt, and a lay-by with humps every so often
  for (let i = 0; i < NS; i += 1) {
    const sAt = i * STEP;
    if (zoneAt(sAt) !== 'cove' || i % 3) continue;
    const half = roadHalfAt(sAt), y0 = RY[i];
    for (const side of [1, -1]) {
      const rx = -TZ[i] * side, rz = TX[i] * side;  // right normal * side
      const u = half + 1.7;
      const x = RX[i] + rx * u, z = RZ[i] + rz * u;
      if (!landFlat(x, z, y0, 2.2)) continue;
      if (rnd() < (side > 0 ? 0.62 : 0.4) && free(x, z, 4.6)) parkSpots.push({ x: r1(x), z: r1(z), yaw: r2(Math.atan2(-TX[i], -TZ[i]) + (side > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.12), d: 1 });
      // lay-by humps further out, where the ground is flat enough to pull off
      if (rnd() < 0.05) {
        const uu = half + 7 + rnd() * 9, hx = RX[i] + rx * uu, hz = RZ[i] + rz * uu;
        if (landFlat(hx, hz, y0, 1.6)) { const r = 2.4 + rnd() * 2.8; if (free(hx, hz, r)) humps.push([r1(hx), r1(hz), r2(r), r2(0.4 + rnd() * 0.8), r2(rnd() * 6)]); }
      }
    }
  }
}
// nobody parks (or heaps spoil) on the far side of a concrete barrier
for (const b of barriers) for (const arr of [parkSpots, humps]) for (let k = arr.length - 1; k >= 0; k--) {
  const it = arr[k], q = project(it.x ?? it[0], it.z ?? it[1], 80);
  if (q && q.s > b.s0 - 10 && q.s < b.s1 + 10 && Math.sign(q.u) === b.side && Math.abs(q.u) < 30) arr.splice(k, 1);
}
console.log('park spots', parkSpots.length, 'humps', humps.length);

// ------------------------------------------------------------------ 7. terrain grid
const TG = 10;
const allX = RX.slice(), allZ = RZ.slice();
const minX = Math.min(...allX) - 1400, maxX = Math.max(...allX) + 1600, minZ = Math.min(...allZ) - 1400, maxZ = Math.max(...allZ) + 1400;
const GX = Math.ceil((maxX - minX) / TG) + 1, GZ = Math.ceil((maxZ - minZ) / TG) + 1;
console.log('terrain grid', GX, 'x', GZ);
const H = new Float32Array(GX * GZ), CLS = new Uint8Array(GX * GZ);
// land-cover classes: 0 sea, 1 sand, 2 rock, 3 scrub, 4 urban, 5 park/grass, 6 wood/pine, 7 lake, 8 dry earth (default)
function raster(polyFlat, val, target, onlyIf) {
  const n = polyFlat.length / 2; if (n < 3) return;
  let z0 = 1e9, z1 = -1e9; for (let i = 0; i < n; i++) { z0 = Math.min(z0, polyFlat[i * 2 + 1]); z1 = Math.max(z1, polyFlat[i * 2 + 1]); }
  const j0 = Math.max(0, Math.ceil((z0 - minZ) / TG)), j1 = Math.min(GZ - 1, Math.floor((z1 - minZ) / TG));
  for (let j = j0; j <= j1; j++) {
    const z = minZ + j * TG; const xs = [];
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const ax = polyFlat[k * 2], az = polyFlat[k * 2 + 1], bx = polyFlat[i * 2], bz = polyFlat[i * 2 + 1];
      if ((az <= z && bz > z) || (bz <= z && az > z)) xs.push(ax + (z - az) / (bz - az) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - minX) / TG)), i1 = Math.min(GX - 1, Math.floor((xs[q + 1] - minX) / TG));
      for (let i = i0; i <= i1; i++) { const id = j * GX + i; if (!onlyIf || onlyIf(target[id])) target[id] = val; }
    }
  }
}
CLS.fill(8);
for (const a of areas.residential) if (a.c) raster(a.p, 4, CLS);
for (const a of areas.park) if (a.c) raster(a.p, 5, CLS);
for (const a of areas.golf) if (a.c) raster(a.p, 5, CLS);
for (const a of areas.scrub) if (a.c) raster(a.p, 3, CLS);
for (const a of areas.wood) if (a.c) raster(a.p, 6, CLS);
for (const a of areas.rock) if (a.c) raster(a.p, 2, CLS);
for (const a of areas.beach) if (a.c) raster(a.p, 1, CLS);
for (const b of buildings) raster(b.p, 4, CLS, (v) => v !== 1);
const LAKE = new Uint8Array(GX * GZ);
for (const a of areas.lake) if (a.c) raster(a.p, 1, LAKE);
// urban density: dilate building footprints so streets between blocks read as town
{
  const U = new Uint8Array(CLS.length); for (let i = 0; i < CLS.length; i++) U[i] = CLS[i] === 4 ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) { const c = U.slice(); for (let j = 1; j < GZ - 1; j++) for (let i = 1; i < GX - 1; i++) { const id = j * GX + i; if (c[id - 1] || c[id + 1] || c[id - GX] || c[id + GX]) U[id] = 1; } }
  for (let i = 0; i < CLS.length; i++) if (U[i] && CLS[i] === 8) CLS[i] = 4;
}
let t0 = Date.now();
for (let j = 0; j < GZ; j++) {
  const z = minZ + j * TG;
  for (let i = 0; i < GX; i++) {
    const x = minX + i * TG, id = j * GX + i;
    let d = coastDist(x, z, 700);
    const base = demAt(x, z);
    if (Math.abs(d) >= 700) d = base > 0.5 ? 700 : -700;
    const cls = CLS[id];
    let h;
    if (d > 0) {
      const sandy = cls === 1;
      // shoreline profile: gentle sandy beaches, steep limestone where it's rocky
      const rise = sandy ? 0.35 + d * 0.05 : 0.6 + d * 0.9;
      h = Math.min(Math.max(base, 0.6 + d * 0.02), rise);
      if (sandy) h = Math.min(h, 0.35 + d * 0.06);
      h = Math.max(h, 0.25 + Math.min(d, 8) * 0.04);
    } else {
      const ad = -d;
      const sandy = cls === 1;
      h = -Math.min(45, 0.25 + ad * (sandy ? 0.045 : 0.16) + ad * ad * 0.00004);
      CLS[id] = 0;
    }
    if (LAKE[id]) { h = -4; CLS[id] = 7; }
    H[id] = h;
  }
}
console.log('terrain base', (Date.now() - t0) / 1000, 's');
// carve the road corridor: terrain meets the road edges and slopes away naturally
t0 = Date.now();
for (let j = 0; j < GZ; j++) {
  const z = minZ + j * TG;
  for (let i = 0; i < GX; i++) {
    const x = minX + i * TG, id = j * GX + i;
    const q = project(x, z, 120); if (!q || q.d > 110) continue;
    if (q.s < -200 || q.s > routeLen + 200) continue;
    const half = roadHalfAt(q.s) + 3.2;
    const ry = routeYAt(Math.max(0, Math.min(routeLen, q.s))) - 0.25;
    const au = Math.abs(q.u);
    const nat = H[id];
    const width = nat < ry ? (nat < 0 ? 9 : 22) : 30;
    const k = smoothstep(half, half + width, au);
    H[id] = ry + (nat - ry) * k;
    if (au < half + 2 && CLS[id] === 0) CLS[id] = 8;
  }
}
console.log('terrain carve', (Date.now() - t0) / 1000, 's');
// light smoothing of land heights (keeps coast), preserves the road bed
{
  const H2 = H.slice();
  for (let j = 1; j < GZ - 1; j++) for (let i = 1; i < GX - 1; i++) {
    const id = j * GX + i; if (H[id] < 0) continue;
    H2[id] = (H[id] * 4 + H[id - 1] + H[id + 1] + H[id - GX] + H[id + GX]) / 8;
  }
  H.set(H2);
}
const Hi = new Int16Array(GX * GZ); for (let i = 0; i < H.length; i++) Hi[i] = Math.max(-32000, Math.min(32000, Math.round(H[i] * 10)));
const header = Buffer.alloc(32);
header.writeInt32LE(GX, 0); header.writeInt32LE(GZ, 4); header.writeFloatLE(minX, 8); header.writeFloatLE(minZ, 12); header.writeFloatLE(TG, 16);
fs.writeFileSync(path.join(ROOT, 'data', 'terrain.bin'), Buffer.concat([header, Buffer.from(Hi.buffer), Buffer.from(CLS.buffer)]));

// ------------------------------------------------------------------ write
const out = {
  attribution: 'Map data © OpenStreetMap contributors (ODbL) · Elevation: EU-DEM v1.1 via OpenTopoData',
  proj: { lat0: LAT0, lon0: LON0, mlat: MLAT, mlon: MLON },
  route: {
    step: STEP, x: RX.map(r2), z: RZ.map(r2), y: RY.map(r2), lanes: lanesOut, div: divOut,
    start: S_START, finish: S_FINISH, length: routeLen, names: roadNames, from: FROM, to: TO, speeds,
  },
  marks, zones, parkSpots, humps, barriers, coast, buildings, areas, trees, pois, furniture, places, sideRoads,
};
out.roadNetwork = extractRoadNetwork(out, roads, { excludeWays: [...routeWays] });
fs.writeFileSync(path.join(ROOT, 'data', 'map.json'), JSON.stringify(out));
console.log('map.json', (fs.statSync(path.join(ROOT, 'data', 'map.json')).size / 1e6).toFixed(2), 'MB; terrain.bin', (fs.statSync(path.join(ROOT, 'data', 'terrain.bin')).size / 1e6).toFixed(2), 'MB');
console.log('marks', marks.map((m) => m.id + '@' + m.s).join(' '));
console.log('names', roadNames.map((n) => n.s + ':' + n.name).join(' | '));
