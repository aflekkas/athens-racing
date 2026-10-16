// Direction defaults changed without changing OSM geometry. Old times remain
// stored, in their previous board version, on both native and Worker backends.
export const leaderboardVersion = (mapId, version, reverse = false) => mapId === 'psychiko' && !reverse ? `${version}:reverse-default-v1` : version;
export function resultContext(r, definitions, version, maps) {
  if (!maps) return { event: definitions.get(r.eventId), version, mapId: 'riviera' };
  const mapId = r.mapId || 'riviera', map = maps.get(mapId);
  return { event: map?.definitions.get(r.eventId), version: leaderboardVersion(mapId, map?.track.version), mapId };
}
export function validResult(r, event, cars) {
  return !!event && cars.has(r.car) && /^[a-zA-Z0-9_-]{8,64}$/.test(r.driverId || '') && Number.isFinite(r.time) && r.time >= Math.max(0.05, event.len / 150) && r.time <= 7200;
}
export function resultEntry(r, event, version, mapId) {
  return { driverId: r.driverId, name: String(r.name || 'DRIVER').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 28) || 'DRIVER', eventId: r.eventId, mapId, car: r.car, time: r.time, traffic: r.traffic === undefined ? event.traffic : r.traffic === true, routeKey: event.routeKey, distance: event.len, version, source: r.source === 'online' ? 'online' : 'solo', at: Date.now() };
}
