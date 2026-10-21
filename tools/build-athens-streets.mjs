import {loadWorldDefinition} from '../src/world-manifest.js';
// The free roam picker's view of the streamed Athens open world (owner 2026-10-20: "I can't click on the map anywhere" in
// the Athens world). Reads every cell of one published world manifest, keeps each drivable road edge the game installs
// (contact-eligible cells, restricted ways dropped, the reverse twin of a two-way road dropped) and writes them in the
// spawn-roads format (src/spawn-spots.js decodeSpawnRoads) under maps.athens, with the manifest key it came from.
//   node tools/build-athens-streets.mjs [manifest URL]     default: staging's ATHENS_WORLD_MANIFEST (wrangler.jsonc env.staging)
// Writes assets/athens/streets.json. tools/athens-streets.test.mjs fails when wrangler's staging pointer moves on
// without this file being rebuilt.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { decodeTilePack } from '../src/world-tile-codec.js';
import { tileTables } from '../src/world-tile-format.js';
import { atticaFromAthens } from '../src/spawn-spots.js';

export const UNIT = 100;      // stored integers are 1/100 of an Attica map unit (about 0.9 m), as in spawn-roads.json
const SIMPLIFY_M = 1.5;       // a polyline keeps every bend that moves it more than this
const MAJOR_LANES = 3;        // avenues: three or more lanes are drawn as the major class
const RESTRICTED = 1 << 3;    // edge flag bit 3 (docs/world-tiles-format.md): not a public road
const ROOT = new URL('../', import.meta.url);

/** wrangler.jsonc env.staging ATHENS_WORLD_MANIFEST, e.g. "manifests/<sha256>.json" */
export function stagingManifestKey(text = readFileSync(new URL('wrangler.jsonc', ROOT), 'utf8')) {
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
  return config.env?.staging?.vars?.ATHENS_WORLD_MANIFEST || null;
}

function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const n = pts.length / 2, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = tol * tol;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], dx = pts[b * 2] - ax, dy = pts[b * 2 + 1] - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax, py = pts[i * 2 + 1] - ay, t = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0;
      const d = (px - t * dx) ** 2 + (py - t * dy) ** 2; if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** the drivable edges of one decoded cell, in world metres: [{ id, name, major, pts: [x0, z0, x1, z1, ...] }] */
export function cellStreets(pack) {
  const t = tileTables(pack), md = pack.metadata, [ox, , oz] = md.origin, out = [];
  for (let i = 0; i < t.edges.length; i += 10) {
    if (t.edges[i + 8] & RESTRICTED) continue;
    const first = t.edges[i + 3], count = t.edges[i + 4], pts = [];
    for (let p = 0; p < count; p++) { const k = (first + p) * 3; pts.push(ox + t.edgePoints[k], oz + t.edgePoints[k + 2]); }
    if (pts.length < 4) continue;
    out.push({ id: md.ids[t.edges[i]], name: md.strings[t.edges[i + 5]] || '', major: t.edges[i + 6] >= MAJOR_LANES, pts });
  }
  return out;
}

/** Edges split at every junction and cell border; edges of one street (same name and class) that meet end to end become one line. */
export function chainStreets(list) {
  const end = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`, at = new Map(), used = new Set(), out = [];
  const tag = s => `${s.name}|${s.major}`;
  list.forEach((s, i) => { for (const k of [end(s.pts[0], s.pts[1]), end(s.pts.at(-2), s.pts.at(-1))]) { const key = tag(s) + '@' + k; if (!at.has(key)) at.set(key, []); at.get(key).push(i); } });
  const other = (s, key) => (at.get(tag(s) + '@' + key) || []).find(j => !used.has(j));
  const rev = p => { const r = []; for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]); return r; };
  list.forEach((s, i) => {
    if (used.has(i)) return; used.add(i); let pts = s.pts.slice();
    for (const forward of [true, false]) for (;;) {
      const k = forward ? end(pts.at(-2), pts.at(-1)) : end(pts[0], pts[1]), j = other(s, k); if (j === undefined) break; used.add(j);
      let q = list[j].pts; const qStart = end(q[0], q[1]) === k;
      if (forward) { if (!qStart) q = rev(q); pts = pts.concat(q.slice(2)); } else { if (qStart) q = rev(q); pts = q.slice(0, -2).concat(pts); }
    }
    out.push({ name: s.name, major: s.major, pts });
  });
  return out;
}

/** every cell's streets -> the spawn-roads JSON (one entry per street line, the reverse twin of a two-way road dropped) */
export function packStreets(cells, { manifest, revision, world }) {
  const names = [], nameIndex = new Map(), seen = new Set(), roads = [], all = [];
  const nameOf = n => { if (!n) return -1; if (!nameIndex.has(n)) { nameIndex.set(n, names.length); names.push(n); } return nameIndex.get(n); };
  for (const key of [...cells.keys()].sort()) for (const s of cells.get(key)) {
    const twin = s.id.replace(/:[fr]:(-?\d+):(-?\d+)$/, ':$1:$2').replace(/^(penteli:e:.*):[fr]$/, '$1'); if (seen.has(twin)) continue; seen.add(twin); all.push(s);
  }
  for (const s of chainStreets(all)) {
    const pts = simplify(s.pts, SIMPLIFY_M), row = [nameOf(s.name), s.major ? 0 : 1]; let px = 0, py = 0;
    for (let i = 0; i < pts.length; i += 2) { const [ax, ay] = atticaFromAthens(pts[i], pts[i + 1]), ix = Math.round(ax * UNIT), iy = Math.round(ay * UNIT); row.push(ix - px, iy - py); px = ix; py = iy; }
    roads.push(row);
  }
  return { v: 1, unit: UNIT, manifest, revision, world, cells: [...cells.keys()].sort(), maps: { athens: { names, roads } } };
}

async function fetchCell(url, sha256, decodedBytes, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`);
      const body = Buffer.from(await r.arrayBuffer());
      if (createHash('sha256').update(body).digest('hex') !== sha256) throw new Error('hash mismatch ' + url);
      const raw = gunzipSync(body, { maxOutputLength: decodedBytes });
      return await decodeTilePack(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), decodedBytes);
    } catch (e) { if (attempt >= tries) throw e; await new Promise(r => setTimeout(r, 500 * attempt)); }
  }
}

export async function buildAthensStreets(manifestURL, { concurrency = 8, log = () => {} } = {}) {
  const r = await fetch(manifestURL); if (!r.ok) throw new Error(`manifest ${r.status} ${manifestURL}`);
  const document = await r.json(), manifest=document.regions&&document.tileVersion!==1?(await loadWorldDefinition(r.url)).manifest:document, keys = Object.keys(manifest.tiles).filter(k => manifest.tiles[k].contactEligible !== false);
  const cells = new Map(); let next = 0, done = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < keys.length) {
      const key = keys[next++], e = manifest.tiles[key];
      cells.set(key, cellStreets(await fetchCell(new URL(e.url, r.url), e.sha256, e.decodedBytes)));
      if (++done % 100 === 0) log(`${done}/${keys.length} cells`);
    }
  }));
  return packStreets(cells, { manifest: new URL(r.url).pathname.replace(/^\/world\//, ''), revision: manifest.revision, world: manifest.world });
}

if (process.argv[1] === import.meta.filename) {
  const url = process.argv[2] || `https://staging.athensracing.com/world/${stagingManifestKey()}`;
  const out = await buildAthensStreets(url, { log: console.log });
  const json = JSON.stringify(out); writeFileSync(new URL('assets/athens/streets.json', ROOT), json + '\n');
  console.log(`assets/athens/streets.json: ${out.cells.length} cells, ${out.maps.athens.roads.length} roads, ${out.maps.athens.names.length} names, ${json.length} bytes`);
}
