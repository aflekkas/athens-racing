// Free roam spawn picker data (owner decisions 2026-10-19 "free roam should have no tracks" and 2026-10-20 "click anywhere
// on the map"): the areas the arrows step through, the Attica <-> map-local projections, and the road snapper the picker
// uses to turn a click on the map into a drivable point. Pure: no DOM, no three.js (node tests import it).
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
export const AREA_NAMES = Object.freeze({ riviera: 'ATHENS RIVIERA', penteli: 'PENTELI', psychiko: 'PSYCHIKO', megara: 'MEGARA', athens: 'ATHENS OPEN WORLD · DEV' });

// ---------------------------------------------------------------- areas
// Owner 2026-10-20: "would it not make sense for free roam to just be click anywhere on the map" and "cycling through 40
// POIs rather than general areas". There are no named POIs: you click anywhere and the click snaps to the nearest drivable
// road. The arrows step through general areas, one per playable map. Each area has a start: a real point on that map's own
// road network (checked by tools/owner-locked-free-roam-spawn.test.mjs) that the picker pre-selects when you step to it.
const start = (mapId, lat, lon) => Object.freeze({ id: mapId, mapId, name: AREA_NAMES[mapId], lat, lon });
export const AREA_STARTS = Object.freeze([
  start('riviera', 37.81348, 23.78291), // Vouliagmeni, above the marina
  start('penteli', 38.0959, 23.8913), // Dionysos, at the foot of the mountain road
  start('psychiko', 38.01166, 23.77274), // Diamantidou, where the garden streets begin
  start('megara', 37.98707, 23.36316), // the start straight
]);
// The dev-flagged open world: its start is the first of these whose 512 m cell is hosted.
export const ATHENS_STARTS = Object.freeze([[37.8660, 23.7540], [37.9440, 23.6650], [37.9755, 23.7348], [38.0, 23.74]].map(([lat, lon]) => start('athens', lat, lon)));

const playableIds = () => new Set(getPlayableMaps(MAPS).map(m => m.id));
/** The areas the arrows step through: every playable map's, in menu order (the map catalogue), plus the dev-flagged Athens world. */
export function spawnAreas({ athens = false, athensCells = null } = {}) {
  const playable = playableIds(), order = getPlayableMaps(MAPS).map(m => m.id);
  const areas = AREA_STARTS.filter(s => playable.has(s.mapId)).sort((a, b) => order.indexOf(a.mapId) - order.indexOf(b.mapId));
  if (athens) { const hosted = ATHENS_STARTS.find(s => !athensCells || athensCells.has(athensCell(...athensFromLonLat(s.lon, s.lat)))); if (hosted) areas.push(hosted); }
  return areas.map(s => ({ ...s, at: atticaFromLonLat(s.lon, s.lat), local: s.mapId === 'athens' ? athensFromLonLat(s.lon, s.lat) : localFromLonLat(s.mapId, s.lon, s.lat) }));
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
