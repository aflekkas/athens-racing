import { routeSurfaceAllowed } from '../src/route-surface.js';
import { RouteNetworkRuntime } from '../src/route-network-runtime.js';
import { routeEvent } from '../src/route-events.js';
import { resolve as resolveEvent, freeRoam } from '../src/events.js';
import { routeNetworkIdentity, sameRouteIdentity, ROUTE_HASH } from '../src/route-network.js';
import { validateOnlineGrid, onlineGridPose } from '../src/online-grid.js';
import { validateRecoveryManifest, createStreamedRoadAuthority } from './route-road-stream.mjs';
const sameRelease = (entry, c) => entry?.id === c.id && ['routeHash', 'geometryHash', 'worldSetRevision'].every(k => ROUTE_HASH.test(c[k] || '') && entry[k] === c[k]);
const immutableURL = (id, kind, hash) => `/data/routes/${id}.${kind}.${hash}.json`;
// Only artifacts in the trusted build catalogue can become multiplayer maps or
// leaderboard courses. Public JSON is derived from that same allow-list.
export async function installRouteMaps(maps, catalogue, { carSpecs = {}, loadRoadArtifact = null } = {}) {
  const config = catalogue?.routeConfig || {}, release = ['staging', 'production'].includes(config.environment);
  const routes = new Map(), publicRoutes = [], issues = new Map(), roadAuthorities = new Map(), onlineMaps = new Map();
  let activeWorldRevision = null;
  for (const entry of release && Array.isArray(config.routes) ? config.routes : []) {
    const c = catalogue.routes?.find(c => c.id === entry.id);
    if (!c || !sameRelease(entry, c) || c.worldId !== 'athens') continue;
    if (activeWorldRevision !== null && activeWorldRevision !== c.worldSetRevision) { issues.set(c.id, 'Route world release differs from the active catalogue'); continue; }
    activeWorldRevision = c.worldSetRevision;
    const url = `/data/routes/${c.id}.${c.routeHash}.json`;
    if (entry.url !== undefined && entry.url !== url) continue;
    routes.set(c.id, c);
    const exposed = { id: c.id, url, routeHash: c.routeHash, geometryHash: c.geometryHash, worldSetRevision: c.worldSetRevision };
    // Legacy maps remain online until parity proves the streamed route release.
    // A configured route without all eight certified slots stays unavailable.
    if (config.online === true) {
      try {
        const descriptor = entry.onlineGrid, grid = catalogue.routeGrids?.find(g => g.hash === descriptor?.hash);
        if (descriptor?.schemaVersion !== 1 || descriptor.capacity !== 8 || descriptor.url !== immutableURL(c.id, 'online-grid', descriptor.hash) || !grid) throw Error('Unsupported online capacity: eight certified grid slots unavailable');
        const onlineGrid = await validateOnlineGrid(grid.body, c, { expectedHash: descriptor.hash });
        const recovery = entry.recovery, roads = catalogue.routeRoads?.find(r => r.hash === recovery?.hash);
        if (recovery?.schemaVersion !== 1 || ![immutableURL(c.id, 'recovery', recovery.hash), `/world/recovery/manifest.${recovery.hash}.json`].includes(recovery.url) || !roads) throw Error('Authoritative recovery roads unavailable');
        if (recovery.streamed !== true) throw Error('Full-domain streamed recovery authority required for online racing');
        if (typeof loadRoadArtifact !== 'function') throw Error('Authoritative recovery loader unavailable');
        if (!roadAuthorities.has(recovery.hash)) {
          if (roadAuthorities.size) throw Error('Recovery authority must share one full-domain world manifest');
          if (catalogue.recoveryWorld?.worldSetRevision !== c.worldSetRevision || !Array.isArray(catalogue.recoveryWorld.sourceHashes)) throw Error('Published world recovery coverage binding unavailable');
          const body = await validateRecoveryManifest(roads.body, { expectedHash: recovery.hash, worldSetRevision: c.worldSetRevision, sourceHashes: catalogue.recoveryWorld.sourceHashes });
          roadAuthorities.set(recovery.hash, { body, authority: createStreamedRoadAuthority(body, loadRoadArtifact) });
        }
        const { body: roadBody, authority } = roadAuthorities.get(recovery.hash);
        if (roadBody.worldSetRevision !== c.worldSetRevision) throw Error('Recovery world release mismatch');
        const geometry = new RouteNetworkRuntime(c, onlineGrid), identity = routeNetworkIdentity(c, descriptor.hash);
        const definitions = new Map();
        for (const e of c.definition.events.filter(e => e.enabled && ['sprint', 'timetrial'].includes(e.type) && !e.reverse)) {
          const def = routeEvent(c, e.id), resolved = resolveEvent(def, { route: geometry, marks: [] });
          definitions.set(e.id, { ...def, ...resolved, ...(e.type === 'timetrial' ? { rivals: 0, rivalCount: 0 } : {}), mapId: c.id, routeKey: `${resolved.s0}>${resolved.s1}`, traffic: e.trafficLevel > 0, trafficLevel: e.trafficLevel });
        }
        if (!definitions.size) throw Error('No supported online timed event');
        const free = { ...freeRoam(c.id), worldId: 'athens', routeId: c.id, routeHash: c.routeHash, geometryHash: c.geometryHash, worldSetRevision: c.worldSetRevision, s0: 0, s1: c.lengthM, dir: 1, len: c.lengthM, laps: 1, closed: geometry.closed, sectors: [], routeKey: null, free: true, save: false, traffic: c.definition.trafficLevel > 0, trafficLevel: c.definition.trafficLevel, conditions: { time: c.definition.timeOfDay, weather: c.definition.weather } };
        definitions.set(free.id, free);
        const spec = car => carSpecs instanceof Map ? carSpecs.get(car) : carSpecs[car];
        const footprint = driver => { const car = spec(driver.car); return { halfWidth: car?.width > 0 ? car.width / 2 : Infinity, halfLength: car?.length > 0 ? car.length / 2 : Infinity }; };
        const preparedRecovery = new WeakMap(); let activeRecovery = null;
        const releaseRecovery = driver => { const context = preparedRecovery.get(driver); if (context) { context.release(); preparedRecovery.delete(driver); if (activeRecovery === context) activeRecovery = null; } };
        geometry.contactAllowed = (q, pose) => {
          const station = geometry.closed && q.s >= 0 ? geometry.wrap(q.s) : q.s;
          if (q.s < 0 && onlineGrid.approach.occurrences.some(o => o.layer === pose.layer && o.surfaceId === pose.surfaceId && q.s >= o.s0 && q.s <= o.s1)) return true;
          if (c.occurrences.some(o => o.layer === pose.layer && o.surfaceId === pose.surfaceId && station >= o.s0 - 4 && station <= o.s1 + 4)) return true;
          const localGraph = { edges: new Map((activeRecovery?.edges || authority.edgesFor(pose)).map(e => [e.id, { value: e }])) };
          const edge = localGraph.edges.get(q.edgeId)?.value;
          return !!edge && routeSurfaceAllowed(edge, pose, localGraph);
        };
        geometry.recoveryFootprint = footprint;
        geometry.recoveryCandidates = (pose, driver) => { activeRecovery = preparedRecovery.get(driver) || null; if (activeRecovery?.pose !== JSON.stringify(pose)) activeRecovery = null; return (activeRecovery?.candidates || []).filter(a => a.layer === pose.layer && Math.abs(a.y - pose.y) < 8).filter(a => ![...(driver.lobby?.players?.values() || [])].some(p => p !== driver && p.connected && p.state && Math.abs(p.state.y - a.y) < 3 && Math.hypot(p.state.x - a.x, p.state.z - a.z) < footprint(driver).halfLength + footprint(p).halfLength + 1)); };
        geometry.contactAt = authority.contactAt;
        const track = { start: 0, finish: c.lengthM, version: `${c.routeHash}:${descriptor.hash}`, routeIdentity: identity };
        const map = { id: c.id, name: c.definition.name, track, routeIdentity: identity, geometry, closed: geometry.closed, definitions, onlineGrid, prepareRecovery: async driver => { releaseRecovery(driver); const context = await authority.prepare(driver.state, footprint(driver)); preparedRecovery.set(driver, context); return true; }, releaseRecovery, supportsCar: car => { const f = footprint({ car }); try { onlineGridPose(onlineGrid, 0, spec(car)); } catch { return false; } return roadBody.footprints.some(p => p.halfWidth >= f.halfWidth && p.halfLength >= f.halfLength); }, gridPose: (slot, car) => onlineGridPose(onlineGrid, slot, spec(car)), trips: { taxi: null, getaway: null } };
        onlineMaps.set(c.id, map); exposed.onlineGrid = descriptor; exposed.recovery = recovery;
      } catch (error) { issues.set(c.id, error.message); exposed.onlineUnsupported = error.message; }
    }
    publicRoutes.push(exposed);
  }
  // Activation is atomic: one missing tuple/grid/world proof prevents every
  // streamed offering. Legacy geometry remains only for historical records.
  const requestedOnline = config.online === true;
  const onlineAvailable = requestedOnline && release && onlineMaps.size > 0 && onlineMaps.size === config.routes.length && issues.size === 0;
  maps.onlineMapIds = requestedOnline ? new Set() : null;
  if (onlineAvailable) for (const [id, map] of onlineMaps) { maps.set(id, map); maps.onlineMapIds.add(id); }
  else if (requestedOnline) for (const entry of config.routes || []) if (!issues.has(entry.id)) issues.set(entry.id, 'Online release incomplete: every enabled route needs matching world, recovery and eight-slot grid proofs');
  maps.routes = routes; maps.routeIssues = issues;
  maps.routeConfig = { environment: release ? config.environment : 'production', world: config.world === true, online: requestedOnline, onlineAvailable, routes: publicRoutes };
  return maps.routeConfig;
}
export function routePacketMatches(map, message) {
  return !map?.routeIdentity || message.mapId === map.id && sameRouteIdentity(message.routeIdentity, map.routeIdentity);
}
