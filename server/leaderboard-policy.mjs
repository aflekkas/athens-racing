import { MAX_RIVALS } from '../src/events.js';
import { matchesRecord } from '../src/leaderboard-records.js';
// The Psychiko Garden Circuit was redesigned on 2026-10-18 (new streets, new start/finish). Its board
// version always carries this suffix, so earlier Psychiko times stay stored under their old version and
// never mix with the new route, on both native and Worker backends.
export const leaderboardVersion = (mapId, version) => mapId === 'psychiko' ? `${version}:garden-v2` : version;
export function resultContext(r, definitions, version, maps) {
  r = r && typeof r === 'object' ? r : {};
  if (!maps) return { event: definitions.get(r.eventId), version, mapId: 'riviera' };
  const mapId = r.mapId || 'riviera', map = maps.get(mapId);
  return { event: map?.definitions.get(r.eventId), version: leaderboardVersion(mapId, map?.track.version), mapId };
}
const text = (v, max) => v === undefined || (typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f<>]/.test(v));
export function validSetup(s, r, event) {
  if (s === undefined) return true; // Older clients/online runs remain readable; missing aids are never invented.
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (s.type !== undefined && !['sprint', 'timetrial', 'pursuit'].includes(s.type)) return false;
  if (s.map !== (r.mapId || 'riviera') || s.event !== r.eventId || s.car !== r.car) return false;
  if (!['dawn', 'day', 'afternoon', 'sunset', 'night', 'dynamic'].includes(s.time) || !['clear', 'overcast', 'rain', 'dynamic'].includes(s.weather)) return false;
  if (!Number.isFinite(s.traffic) || s.traffic < 0 || s.traffic > 2 || !Number.isInteger(s.rivals) || s.rivals < 0 || s.rivals > MAX_RIVALS) return false;
  if (!['police', 'tc', 'abs'].every(k => typeof s[k] === 'boolean') || !['off', 'light', 'full'].includes(s.steering) || !['auto', 'manual'].includes(s.gearbox)) return false;
  if (!Number.isInteger(s.laps) || s.laps < 1 || s.laps > 20 || ![1, -1].includes(s.direction) || !Number.isFinite(s.from) || !Number.isFinite(s.to)) return false;
  // Only the known route, or its reverse, may be submitted. Circuit lap counts are bounded above.
  if (event.s0 != null && event.s1 != null) {
    const near = (a, b) => Math.abs(a - b) <= 0.002;
    if (event.closed) {
      if (!near(s.from, event.s0) || !near(s.to, s.from + s.direction * (event.lapLength || event.len / (event.laps || 1)) * s.laps)) return false;
    } else if (!(near(s.from, event.s0) && near(s.to, event.s1) && s.direction === event.dir || near(s.from, event.s1) && near(s.to, event.s0) && s.direction === -event.dir)) return false;
    if (!event.closed && s.laps !== (event.laps || 1)) return false;
  }
  return text(s.carName, 100) && text(s.carGeneration, 60) && text(s.carTrim, 80);
}
export function validResult(r, event, cars) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const distance = event?.len * (r.setup && event.closed ? r.setup.laps / (event.laps || 1) : 1);
  return !!event && event.type !== 'free' && cars.has(r.car) && /^[a-zA-Z0-9_-]{8,64}$/.test(r.driverId || '') && Number.isFinite(r.time) && r.time >= Math.max(0.05, distance / 150) && r.time <= 7200 &&
    (r.traffic === undefined || typeof r.traffic === 'boolean') && text(r.carName, 100) && text(r.carGeneration, 60) && text(r.carTrim, 80) && validSetup(r.setup, r, event);
}
export function resultEntry(r, event, version, mapId) {
  return { driverId: r.driverId, name: String(r.name || 'DRIVER').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 28) || 'DRIVER', eventId: r.eventId, mapId, car: r.car, time: r.time,
    traffic: r.setup ? r.setup.traffic > 0 : r.traffic === undefined ? event.traffic : r.traffic,
    ...(r.setup ? { setup: Object.fromEntries(['map', 'event', 'type', 'from', 'to', 'direction', 'laps', 'car', 'time', 'weather', 'traffic', 'rivals', 'police', 'tc', 'abs', 'steering', 'gearbox'].filter(k => r.setup[k] !== undefined).map(k => [k, r.setup[k]])) } : {}),
    ...Object.fromEntries(['carName', 'carGeneration', 'carTrim'].map(k => [k, r[k] || r.setup?.[k]]).filter(([, v]) => v)),
    routeKey: r.setup ? `${r.setup.from}>${r.setup.to}` : event.routeKey, distance: r.setup && event.closed ? event.len * r.setup.laps / (event.laps || 1) : event.len, version, source: r.source === 'online' ? 'online' : 'solo', at: Date.now() };
}
// Settings form independent boards: a clear/day run must not erase a rain/night PB.
export const boardKey = e => JSON.stringify([e.mapId || 'riviera', e.version, e.eventId, e.car, e.traffic, ...(e.setup || e.carGeneration || e.carTrim ? [e.carGeneration || null, e.carTrim || null, e.setup || null] : [])]);
export const filterEntries = (entries, filters = {}) => entries.filter(e => matchesRecord(e, filters)).sort((a, b) => a.time - b.time || a.at - b.at).slice(0, Math.max(1, Math.min(100, Number(filters.limit) || 50))).map(({ driverId, ...e }) => e);
export function leaderboardFilters(params) {
  const out = Object.fromEntries(['mapId', 'eventId', 'route', 'car', 'weather', 'tc', 'abs', 'steering', 'gearbox', 'limit'].filter(k => params.has(k)).map(k => [k, params.get(k)]));
  if (params.has('traffic')) out.traffic = params.get('traffic') === 'true';
  if (params.has('reverse')) out.reverse = params.get('reverse') === 'true';
  return out;
}
