import { trackVersion } from '../src/network-track.js';
import { EVENTS, QUICK_RACE, resolve as resolveEvent } from '../src/events.js';

// No filesystem, DOM or three.js: both transports validate exactly the loaded map.
export function resolveMap(meta, data) {
  const { route, marks = [] } = data;
  const track = { start: route.start, finish: route.finish, version: trackVersion(route) };
  const definitions = new Map();
  const defs = meta.id === 'riviera' ? [QUICK_RACE, ...EVENTS] : data.events || [];
  for (const def of defs) {
    try {
      const r = resolveEvent(def, { route, marks });
      definitions.set(def.id, { id: def.id, mapId: meta.id, type: def.type, name: def.name, ...r, routeKey: `${r.s0}>${r.s1}`, traffic: def.traffic > 0 });
    } catch { /* Test fixtures can omit named marks. */ }
  }
  if (![...definitions.values()].some(e => ['sprint', 'timetrial'].includes(e.type))) throw new Error(`Map ${meta.id} has no online events`);
  return { id: meta.id, name: meta.name, track, definitions };
}
