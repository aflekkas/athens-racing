import { RIVIERA_TUNNELS } from '../src/maps/riviera-tunnels.js';
import { trackVersion } from '../src/network-track.js';
import { QUICK_RACE, freeRoam, resolve as resolveEvent } from '../src/events.js';
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
  return { id: meta.id, name: meta.name, track, geometry: { ...route, corridors: meta.id === 'riviera' ? RIVIERA_TUNNELS : [] }, closed: route.closed === true, trips, definitions };
}
