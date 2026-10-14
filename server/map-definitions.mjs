import { trackVersion } from '../src/network-track.js';
import { EVENTS, QUICK_RACE, resolve as resolveEvent } from '../src/events.js';
import { isDrivingMode, resolveDrivingMode, drivingModeDefinition, buildDrivingRoutes } from '../src/driving-objectives.js';

// Deterministic per-map objective itineraries (seed 1): both transports
// derive the same manifest from the same raw data. Null when the road
// cannot host missions (closed circuits, short test fixtures).
const drivingTrips = (data, mode) => {
  try { return buildDrivingRoutes(data, mode, { seed: 1 }); } catch { return null; }
};

// Enforcement site lists collected from raw map data (empty until verified
// site data lands; claims validate to reject meanwhile). Shape:
// data.enforcement = { cameras: [{ id, s, dir, limitKmh }], redLights: [{ id, s }] }.
const finiteNum = (v) => Number.isFinite(v) ? v : null;
export function collectCameras({ id: mapId, data } = {}) {
  // Raw map data names the lists speedCameras (or the enforcement envelope's cameras).
  const list = data?.enforcement?.cameras ?? data?.speedCameras;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 128).flatMap((c) => {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) return [];
    const s = finiteNum(c.s); if (s === null) return [];
    // Unverified until site research lands: claims validate to reject.
    return [{ id: c.id.slice(0, 64), s, dir: c.dir === -1 ? -1 : 1, limitKmh: finiteNum(c.limitKmh) ?? 50, mapId, verified: c.verified === true, active: c.active !== false }];
  });
}
export function collectRedLightSites({ id: mapId, data } = {}) {
  // Raw map data names the lists redLightSites (or the enforcement envelope's redLights).
  const list = data?.enforcement?.redLights ?? data?.redLightSites;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 128).flatMap((r) => {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return [];
    const s = finiteNum(r.s); if (s === null) return [];
    return [{ id: r.id.slice(0, 64), s, dir: [1, -1].includes(r.dir) ? r.dir : 0, mapId, verified: r.verified === true, active: r.active !== false }];
  });
}

// No filesystem, DOM or three.js: both transports validate exactly the loaded map.
export function resolveMap(meta, data) {
  const { route, marks = [] } = data;
  const track = { start: route.start, finish: route.finish, version: trackVersion(route) };
  const definitions = new Map();
  const defs = meta.id === 'riviera' ? [QUICK_RACE, ...EVENTS] : data.events || [];
  for (const def of defs) {
    try {
      const r = isDrivingMode(def.type) ? resolveDrivingMode(def, { route }) : resolveEvent(def, { route, marks });
      definitions.set(def.id, { id: def.id, mapId: meta.id, type: def.type, name: def.name, ...r, routeKey: `${r.s0}>${r.s1}`, traffic: def.traffic > 0, trafficLevel: def.traffic > 0 ? def.traffic : 0, conditions: def.conditions || null, police: def.rules?.police === true, rules: def.rules || null });
    } catch { /* Test fixtures can omit named marks. */ }
  }
  if (![...definitions.values()].some(e => ['sprint', 'timetrial'].includes(e.type))) throw new Error(`Map ${meta.id} has no online events`);
  const trips = { taxi: drivingTrips(data, 'taxi'), getaway: drivingTrips(data, 'getaway') };
  // Offered driving modes are registered when their manifest is valid, so
  // options can offer taxi/getaway and create accepts them. Closed circuits
  // and short fixtures yield null manifests and register nothing.
  for (const mode of ['taxi', 'getaway']) {
    if (!trips[mode] || [...definitions.values()].some(d => d.type === mode)) continue;
    try {
      const def = drivingModeDefinition(mode, meta.id);
      const r = resolveDrivingMode(def, { route });
      definitions.set(def.id, { id: def.id, mapId: meta.id, type: def.type, name: def.name, ...r, routeKey: `${r.s0}>${r.s1}`, traffic: def.traffic > 0, trafficLevel: def.traffic > 0 ? def.traffic : 0, conditions: def.conditions || null, police: def.rules?.police === true, rules: def.rules || null });
    } catch { /* Unresolvable road geometry hosts no missions. */ }
  }
  return { id: meta.id, name: meta.name, track, geometry: route, closed: route.closed === true, trips, enforcement: { cameras: collectCameras({ id: meta.id, data }), redSites: collectRedLightSites({ id: meta.id, data }) }, definitions };
}
