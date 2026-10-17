// Capture bounded display metadata and aids from the client, route/conditions from the server.
const safeText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f<>]/.test(v);
export function captureRecordMeta(raw, previous, raceId) {
  if (!raw || typeof raw.tc !== 'boolean' || typeof raw.abs !== 'boolean' || !['off', 'light', 'full'].includes(raw.steering) || !['auto', 'manual'].includes(raw.gearbox)) return previous ? { ...previous, changed: true } : null;
  const meta = Object.fromEntries(['tc', 'abs', 'steering', 'gearbox'].map(k => [k, raw[k]]));
  for (const [key, max] of [['carName', 100], ['carGeneration', 60], ['carTrim', 80]]) {
    if (raw[key] !== undefined && !safeText(raw[key], max)) return null;
    if (raw[key]) meta[key] = raw[key];
  }
  const before = previous?.raceId === raceId ? previous : null;
  return { ...meta, raceId, changed: !!before && (before.changed || Object.keys(meta).some(k => meta[k] !== before[k])) };
}
export function onlineLeaderboardResult(client, lobby, event) {
  const meta = client.state?.recordMeta;
  return { driverId: client.driverId || client.id, name: client.name, car: client.car, eventId: lobby.eventId, mapId: lobby.mapId, traffic: lobby.traffic, time: client.finish, source: 'online',
    ...(meta && !meta.changed ? { carName: meta.carName, carGeneration: meta.carGeneration, carTrim: meta.carTrim,
      setup: { map: lobby.mapId, event: lobby.eventId, car: client.car, type: event.type, from: event.s0, to: event.s1, direction: event.dir, laps: event.laps || 1,
        traffic: 0, rivals: 0, time: lobby.config?.time || 'afternoon', weather: lobby.config?.weather || 'clear', police: lobby.config?.police === true, tc: meta.tc, abs: meta.abs, steering: meta.steering, gearbox: meta.gearbox } } : {}) };
}
