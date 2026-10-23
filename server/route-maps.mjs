import { routeSurfaceAllowed } from '../src/route-surface.js';
import { RouteRuntime } from '../src/route-runtime.js';
import { routeEvent } from '../src/route-events.js';
import { resolve as resolveEvent } from '../src/events.js';
import { routeNetworkIdentity, sameRouteIdentity, ROUTE_HASH } from '../src/route-network.js';
import { validateOnlineGrid, onlineGridPose } from '../src/online-grid.js';
import { validateRouteRoads, routeRoadAuthority } from './route-roads.mjs';
const sameRelease = (entry, c) => entry?.id === c.id && ['routeHash', 'geometryHash', 'worldSetRevision'].every(k => ROUTE_HASH.test(c[k] || '') && entry[k] === c[k]);
const immutableURL = (id, kind, hash) => `/data/routes/${id}.${kind}.${hash}.json`;
// Only artifacts in the trusted build catalogue can become multiplayer maps or
// leaderboard courses. Public JSON is derived from that same allow-list.
export async function installRouteMaps(maps, catalogue, { carSpecs = {} } = {}) {
  const config = catalogue?.routeConfig || {}, release = ['staging', 'production'].includes(config.environment);
  const routes = new Map(), publicRoutes = [], issues = new Map();
  for (const entry of release && Array.isArray(config.routes) ? config.routes : []) {
    const c = catalogue.routes?.find(c => c.id === entry.id);
    if (!c || !sameRelease(entry, c) || c.worldId !== 'athens') continue;
    routes.set(c.id, c);
    const exposed = { id: c.id, routeHash: c.routeHash, geometryHash: c.geometryHash, worldSetRevision: c.worldSetRevision };
    // Legacy maps remain online until parity proves the streamed route release.
    // A configured route without all eight certified slots stays unavailable.
    if (config.online === true) {
      try {
        const descriptor = entry.onlineGrid, grid = catalogue.routeGrids?.find(g => g.hash === descriptor?.hash);
        if (descriptor?.schemaVersion !== 1 || descriptor.capacity !== 8 || descriptor.url !== immutableURL(c.id, 'online-grid', descriptor.hash) || !grid) throw Error('Unsupported online capacity: eight certified grid slots unavailable');
        const onlineGrid = await validateOnlineGrid(grid.body, c, { expectedHash: descriptor.hash });
        const recovery = entry.recovery, roads = catalogue.routeRoads?.find(r => r.hash === recovery?.hash);
        if (recovery?.schemaVersion !== 1 || recovery.url !== immutableURL(c.id, 'recovery', recovery.hash) || !roads) throw Error('Authoritative recovery roads unavailable');
        const roadBody = await validateRouteRoads(roads.body, { expectedHash: recovery.hash, worldSetRevision: c.worldSetRevision });
        const authority = routeRoadAuthority(roadBody), geometry = new RouteRuntime(c), identity = routeNetworkIdentity(c, descriptor.hash);
        const definitions = new Map();
        for (const e of c.definition.events.filter(e => e.enabled && e.type === 'sprint' && !e.reverse)) {
          const def = routeEvent(c, e.id), resolved = resolveEvent(def, { route: geometry, marks: [] });
          definitions.set(e.id, { ...def, ...resolved, mapId: c.id, routeKey: `${resolved.s0}>${resolved.s1}`, traffic: e.trafficLevel > 0, trafficLevel: e.trafficLevel });
        }
        if (!definitions.size) throw Error('No supported online race');
        const spec = car => carSpecs instanceof Map ? carSpecs.get(car) : carSpecs[car];
        const footprint = driver => { const car = spec(driver.car); return { halfWidth: (car?.width || 2.2) / 2, halfLength: (car?.length || 5.6) / 2 }; };
        const graph = { edges: new Map(roadBody.edges.map(e => [e.id, { value: e }])) };
        geometry.contactAllowed = (q, pose) => {
          const station = geometry.closed ? geometry.wrap(q.s) : q.s;
          if (c.occurrences.some(o => o.layer === pose.layer && o.surfaceId === pose.surfaceId && station >= o.s0 - 4 && station <= o.s1 + 4)) return true;
          const edge = graph.edges.get(q.edgeId)?.value;
          return !!edge && routeSurfaceAllowed(edge, pose, graph);
        };
        geometry.recoveryFootprint = footprint;
        geometry.recoveryCandidates = (pose, driver) => authority.candidates(pose, footprint(driver)).filter(a => a.layer === pose.layer && Math.abs(a.y - pose.y) < 8).filter(a => ![...(driver.lobby?.players?.values() || [])].some(p => p !== driver && p.connected && p.state && Math.abs(p.state.y - a.y) < 3 && Math.hypot(p.state.x - a.x, p.state.z - a.z) < a.halfLength + footprint(p).halfLength + 1));
        geometry.contactAt = authority.contactAt;
        const track = { start: 0, finish: c.lengthM, version: `${c.routeHash}:${descriptor.hash}`, routeIdentity: identity };
        const map = { id: c.id, name: c.definition.name, track, routeIdentity: identity, geometry, closed: geometry.closed, definitions, onlineGrid, supportsCar: car => { const f = footprint({ car }); return roadBody.anchors.every(a => a.halfWidth >= f.halfWidth && a.halfLength >= f.halfLength); }, gridPose: (slot, car) => onlineGridPose(onlineGrid, slot, spec(car)), trips: { taxi: null, getaway: null } };
        maps.set(c.id, map); exposed.onlineGrid = descriptor; exposed.recovery = recovery;
      } catch (error) { issues.set(c.id, error.message); exposed.onlineUnsupported = error.message; }
    }
    publicRoutes.push(exposed);
  }
  maps.routes = routes; maps.routeIssues = issues;
  maps.routeConfig = { environment: release ? config.environment : 'production', world: config.world === true, online: config.online === true, routes: publicRoutes };
  return maps.routeConfig;
}
export function routePacketMatches(map, message) {
  return !map?.routeIdentity || message.mapId === map.id && sameRouteIdentity(message.routeIdentity, map.routeIdentity);
}
