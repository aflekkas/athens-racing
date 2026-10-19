// Free roam spawn picker data (owner decision 2026-10-19: "free roam should have no tracks, it should be more of like i
// just pick where to be spawned"): the named spawn spots, the Attica <-> map-local projections, and the road snapper the
// picker uses to turn a click on the map into a drivable point. Pure: no DOM, no three.js (node tests import it).
import { MAPS } from './map-catalog.js';
import { getPlayableMaps } from './enabled-maps.js';

// ---------------------------------------------------------------- projections
// The Attica selector map (tools/build-attica-map.py): Web-Mercator, 1500 units wide.
const WEST = 23.00, EAST = 24.50, NORTH = 38.24, SOUTH = 37.70, WIDTH = 1500;
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const SPAN = (EAST - WEST) * Math.PI / 180;
export const atticaFromLonLat = (lon, lat) => [(lon - WEST) / (EAST - WEST) * WIDTH, (merc(NORTH) - merc(lat)) / SPAN * WIDTH];
export const lonLatFromAttica = (x, y) => [WEST + x / WIDTH * (EAST - WEST), (2 * Math.atan(Math.exp(merc(NORTH) - y / WIDTH * SPAN)) - Math.PI / 2) * 180 / Math.PI];
// Each shipped map has its own local metre projection (data/**/map.json `proj`: x east, z south); tools/build-spawn-roads.mjs checks them.
export const MAP_PROJECTIONS = Object.freeze({
  riviera: { lat0: 37.835, lon0: 23.77, mlat: 110993.3299523195, mlon: 88028.97469710135 },
  megara: { lat0: 37.987, lon0: 23.364, mlat: 110996.20384377062, mlon: 87848.04864181542 },
  penteli: { lat0: 38.08, lon0: 23.9, mlat: 110997.96415769357, mlon: 87737.04446643248 },
  psychiko: { lat0: 38.009, lon0: 23.775, mlat: 110996.62012974123, mlon: 87821.81055088619 },
});
export const atticaFromLocal = (mapId, x, z) => { const p = MAP_PROJECTIONS[mapId]; return atticaFromLonLat(p.lon0 + x / p.mlon, p.lat0 - z / p.mlat); };
export const localFromAttica = (mapId, ax, ay) => { const p = MAP_PROJECTIONS[mapId], [lon, lat] = lonLatFromAttica(ax, ay); return [(lon - p.lon0) * p.mlon, (p.lat0 - lat) * p.mlat]; };
export const localFromLonLat = (mapId, lon, lat) => { const p = MAP_PROJECTIONS[mapId]; return [(lon - p.lon0) * p.mlon, (p.lat0 - lat) * p.mlat]; };

// The whole-Athens open world (tools/world-gen/model.py PROJECTION, 512 m cells). Dev-flagged: see athensEnabled.
export const ATHENS_PROJECTION = Object.freeze({ lat0: 37.98, lon0: 23.73, mlat: 111320, mlon: 111320 * Math.cos(37.98 * Math.PI / 180) });
export const ATHENS_CELL = 512;
export const athensFromLonLat = (lon, lat) => [(lon - ATHENS_PROJECTION.lon0) * ATHENS_PROJECTION.mlon, -(lat - ATHENS_PROJECTION.lat0) * ATHENS_PROJECTION.mlat];
export const athensFromAttica = (ax, ay) => athensFromLonLat(...lonLatFromAttica(ax, ay));
export const athensCell = (x, z) => `${Math.floor(x / ATHENS_CELL)},${Math.floor(z / ATHENS_CELL)}`;
/** The open world joins the picker only under ?map=athens (owner: players do not see it until the owner activates it). */
export const athensEnabled = (search = typeof location === 'undefined' ? '' : location.search) => new URLSearchParams(search).get('map') === 'athens';

// What the panel calls the place a spot is in: an area, never a track.
export const AREA_NAMES = Object.freeze({ riviera: 'ATHENS RIVIERA', penteli: 'MOUNT PENTELI', psychiko: 'PALAIO PSYCHIKO', megara: 'MEGARA', athens: 'ATHENS OPEN WORLD · DEV' });

// ---------------------------------------------------------------- named spots
// Real places on each map's own road network (checked against it by tools/owner-locked-free-roam-spawn.test.mjs).
// lat/lon are the place; the game puts the car on the nearest drivable road to it, centred in a lane (src/tow-placement.js).
const spot = (mapId, id, name, lat, lon, note = '') => Object.freeze({ id: `${mapId}:${id}`, mapId, name, note, lat, lon });
export const SPAWN_SPOTS = Object.freeze([
  spot('riviera', 'kavouri', 'KAVOURI', 37.81657, 23.77487, 'Seaside lanes above the bay'),
  spot('riviera', 'vouliagmeni', 'VOULIAGMENI', 37.81348, 23.78291, 'The suburb above the marina'),
  spot('riviera', 'astir', 'ASTIR PENINSULA', 37.80982, 23.78226, 'The coast road round the cape'),
  spot('riviera', 'lake', 'LAKE VOULIAGMENI', 37.8075, 23.78426, 'Under the cliffs by the lake'),
  spot('riviera', 'limanakia', 'LIMANAKIA', 37.8018, 23.79045, 'The coves along the cliff road'),
  spot('riviera', 'varkiza', 'VARKIZA', 37.81501, 23.80073, 'The beach town on the Athens Riviera'),
  spot('riviera', 'athinon-souniou', 'ATHINON–SOUNIOU AVENUE', 37.8164, 23.82016, 'The fast coastal avenue'),
  spot('riviera', 'lomvarda', 'LOMVARDA', 37.82052, 23.83765, 'The far end of the coast road'),
  spot('penteli', 'dionysos', 'PENTELI START', 38.0959, 23.8913, 'Dionysos, at the foot of the mountain road'),
  spot('penteli', 'village', 'DIONYSOS VILLAGE', 38.09447, 23.894, 'Village streets below Penteli'),
  spot('penteli', 'rapentosa', 'RAPENTOSA SLOPES', 38.08296, 23.90852, 'The climb through the pines'),
  spot('penteli', 'agios-petros', 'AGIOS PETROS', 38.07197, 23.93454, 'High on the mountain road'),
  spot('penteli', 'ascent', 'PENTELI ASCENT', 38.0724, 23.92221, 'Hairpins up the mountain'),
  spot('penteli', 'karakanta', 'KARAKANTA PASS', 38.0669, 23.90099, 'The pass at the top'),
  spot('psychiko', 'faros', 'FAROS TRAFFIC LIGHT', 38.00512, 23.77551, 'At the lights on surface Kifisias'),
  spot('psychiko', 'elikonos', 'ELIKONOS LIGHT', 38.01009, 23.77978, 'Turn onto surface Kifisias'),
  spot('psychiko', 'diamantidou', 'DIAMANTIDOU', 38.01166, 23.77274, 'Where the garden streets begin'),
  spot('psychiko', 'benaki', 'EMMANOUIL BENAKI', 38.01399, 23.78042, 'The eastern edge of the neighbourhood'),
  spot('psychiko', 'drydon', 'DRYADON', 38.01955, 23.77113, 'The northern loop'),
  spot('psychiko', 'lytra', 'NIKIFOROU LYTRA', 38.01724, 23.76886, 'The western loop'),
  spot('psychiko', 'kifisias', 'KIFISIAS AVENUE', 38.01251, 23.78241, 'The long avenue on the east side'),
  spot('psychiko', 'venizelou', 'VENIZELOU AVENUE', 38.02226, 23.7707, 'The avenue past the northern roundabout'),
  spot('megara', 'start', 'MEGARA START STRAIGHT', 37.98707, 23.36316, 'The pit straight'),
  spot('megara', 'back', 'MEGARA BACK STRAIGHT', 37.9883, 23.36285, 'The long straight at the far side'),
  spot('megara', 'hairpin', 'MEGARA FINAL HAIRPIN', 37.98599, 23.36222, 'The tight hairpin at the far end'),
  spot('megara', 'service', 'MEGARA SERVICE ROAD', 37.98384, 23.36122, 'The service road to the south'),
]);
// The dev-flagged open world: real places of the streamed Athens basin. Only spots whose 512 m cell is hosted are offered.
export const ATHENS_SPOTS = Object.freeze([
  ['glyfada', 'GLYFADA', 37.8660, 23.7540, 'The seafront road'], ['elliniko', 'ELLINIKO', 37.8850, 23.7420, 'The old airport coast'],
  ['faliro', 'NEO FALIRO', 37.9440, 23.6650, 'Along the Faliro waterfront'], ['piraeus', 'PIRAEUS', 37.9420, 23.6470, 'The port streets'],
  ['syntagma', 'SYNTAGMA', 37.9755, 23.7348, 'Parliament and the avenues'], ['omonia', 'OMONIA', 37.9842, 23.7281, 'The central roundabout'],
  ['kypseli', 'KYPSELI', 38.0, 23.74, 'Dense neighbourhood grid'], ['patisia', 'PATISIA', 38.0170, 23.7250, 'North of the centre'],
].map(([id, name, lat, lon, note]) => Object.freeze({ id: `athens:${id}`, mapId: 'athens', name, note, lat, lon })));

const playableIds = () => new Set(getPlayableMaps(MAPS).map(m => m.id));
/** The spots players can pick: every playable map's, in menu order (the map catalogue), plus the dev-flagged Athens world's. */
export function spawnSpots({ athens = false, athensCells = null } = {}) {
  const playable = playableIds(), order = getPlayableMaps(MAPS).map(m => m.id);
  const spots = SPAWN_SPOTS.filter(s => playable.has(s.mapId)).sort((a, b) => order.indexOf(a.mapId) - order.indexOf(b.mapId));
  if (athens) spots.push(...ATHENS_SPOTS.filter(s => !athensCells || athensCells.has(athensCell(...athensFromLonLat(s.lon, s.lat)))));
  return spots.map(s => ({ ...s, at: atticaFromLonLat(s.lon, s.lat), local: s.mapId === 'athens' ? athensFromLonLat(s.lon, s.lat) : localFromLonLat(s.mapId, s.lon, s.lat) }));
}

// ---------------------------------------------------------------- roads and snapping
/** assets/maps/spawn-roads.json -> { [mapId]: { names, roads: [{ name, major, pts: Float32Array [x0, y0, x1, y1, ...] in Attica units }] } } */
export function decodeSpawnRoads(json) {
  const out = {};
  for (const [mapId, { names, roads }] of Object.entries(json.maps)) {
    out[mapId] = { names, roads: roads.map(([n, c, ...deltas]) => {
      const pts = new Float32Array(deltas.length); let x = 0, y = 0;
      for (let i = 0; i < deltas.length; i += 2) { x += deltas[i]; y += deltas[i + 1]; pts[i] = x / json.unit; pts[i + 1] = y / json.unit; }
      return { name: n < 0 ? '' : names[n], major: c === 0, pts };
    }) };
  }
  return out;
}
/** The nearest point of any drivable road within `radius` Attica units of (ax, ay), or null. */
export function snapToRoad(roads, ax, ay, radius) {
  let best = null, bd = radius * radius;
  for (const [mapId, { roads: list }] of Object.entries(roads)) for (const road of list) {
    const p = road.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], y0 = p[i + 1], dx = p[i + 2] - x0, dy = p[i + 3] - y0, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((ax - x0) * dx + (ay - y0) * dy) / L)) : 0, x = x0 + dx * t, y = y0 + dy * t, d = (ax - x) ** 2 + (ay - y) ** 2;
      if (d < bd) { bd = d; best = { mapId, at: [x, y], street: road.name, major: road.major, distance: Math.sqrt(d) }; }
    }
  }
  return best && { ...best, local: localFromAttica(best.mapId, ...best.at) };
}
/** The spawn spot nearest to a point of a map (for naming a clicked road "near ..."). */
export function nearestSpot(spots, mapId, ax, ay) {
  let best = null, bd = Infinity;
  for (const s of spots) if (s.mapId === mapId) { const d = Math.hypot(s.at[0] - ax, s.at[1] - ay); if (d < bd) { bd = d; best = s; } }
  return best;
}
