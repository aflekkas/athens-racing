#!/usr/bin/env node
// Builds assets/maps/spawn-roads.json: every drivable road of every playable map (the race route and its surrounding
// OSM street network: exactly what the tow planner can put a car on), in Attica map units, for the free roam spawn picker
// (src/spawn-select.js). The picker snaps a click to these lines; the game then places the car with src/tow-placement.js
// on the map's own road data. Run after the shipped map data or tools/build-attica-map.py change.
//   node tools/build-spawn-roads.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { atticaFromLocal, MAP_PROJECTIONS } from '../src/spawn-spots.js';

export const UNIT = 100;      // stored integers are 1/100 of an Attica map unit (about 0.9 m)
const MIN_GAP = 4;            // metres between kept points: close-up detail the click never needs
const FILES = { riviera: 'data/map.json', megara: 'data/maps/megara/map.json', penteli: 'data/maps/penteli/map.json', psychiko: 'data/maps/psychiko/map.json' };
const ARTERIAL = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const root = new URL('../', import.meta.url);

function encode(mapId, points) {
  const out = []; let px = 0, py = 0, last = null;
  points.forEach(([x, z], i) => {
    if (last && i < points.length - 1 && Math.hypot(x - last[0], z - last[1]) < MIN_GAP) return;
    last = [x, z];
    const [ax, ay] = atticaFromLocal(mapId, x, z), ix = Math.round(ax * UNIT), iy = Math.round(ay * UNIT);
    out.push(ix - px, iy - py); px = ix; py = iy;
  });
  return out;
}
const pairs = flat => { const out = []; for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };

export function buildSpawnRoads() {
  const maps = {};
  for (const [mapId, file] of Object.entries(FILES)) {
    const data = JSON.parse(readFileSync(new URL(file, root), 'utf8')), names = [], roads = [];
    if (JSON.stringify(data.proj) !== JSON.stringify(MAP_PROJECTIONS[mapId])) throw new Error(`${mapId}: projection changed, update MAP_PROJECTIONS in src/spawn-spots.js`);
    const nameIndex = name => { if (!name) return -1; let i = names.indexOf(name); if (i < 0) i = names.push(name) - 1; return i; };
    roads.push([-1, 0, ...encode(mapId, data.route.x.map((x, i) => [x, data.route.z[i]]))]);
    for (const road of data.roadNetwork?.roads || []) roads.push([nameIndex(road.n), ARTERIAL.has(road.h) ? 0 : 1, ...encode(mapId, pairs(road.p))]);
    maps[mapId] = { names, roads };
  }
  return { v: 1, unit: UNIT, maps };
}
const text = JSON.stringify(buildSpawnRoads());
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const target = new URL('assets/maps/spawn-roads.json', root);
  if (process.argv.includes('--check')) { if (readFileSync(target, 'utf8') !== text) { console.error('assets/maps/spawn-roads.json is stale: run node tools/build-spawn-roads.mjs'); process.exit(1); } }
  else { writeFileSync(target, text); console.log(`assets/maps/spawn-roads.json ${text.length} bytes`); }
}
