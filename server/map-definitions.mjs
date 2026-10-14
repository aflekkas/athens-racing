import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { trackVersion } from '../src/network-track.js';
import { QUICK_RACE, freeRoam, resolve as resolveEvent } from '../src/events.js';
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
  const race = meta.id === 'riviera' ? QUICK_RACE : (data.events || []).find(e => e.type === 'sprint');
  const defs = [...(race ? [{ ...race, name: 'QUICK RACE', quick: true }] : []), freeRoam(meta.id)];
  for (const def of defs) {
    try {
      const r = resolveEvent(def, { route, marks });
      definitions.set(def.id, { id: def.id, mapId: meta.id, type: def.type, name: def.name, ...r, routeKey: `${r.s0}>${r.s1}`, traffic: def.traffic > 0, trafficLevel: def.traffic > 0 ? def.traffic : 0, conditions: def.conditions || null, police: def.rules?.police === true, rules: def.rules || null });
    } catch { /* Test fixtures can omit named marks. */ }
  }
  if (![...definitions.values()].some(e => e.type === 'sprint')) throw new Error(`Map ${meta.id} has no Quick Race route`);
  const trips = { taxi: null, getaway: null }; // Legacy storage shape; objective modes are dormant.
  return { id: meta.id, name: meta.name, track, geometry: { ...route, corridors: meta.id === 'riviera' ? RIVIERA_TUNNELS : [] }, closed: route.closed === true, trips, enforcement: { cameras: collectCameras({ id: meta.id, data }), redSites: collectRedLightSites({ id: meta.id, data }) }, definitions };
}
