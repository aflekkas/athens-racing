// Catalogue-only contexts for setup screens. No terrain, geometry, map bundle or fetch.
import { MAPS, getMap } from './map-catalog.js';
import { getPlayableMaps } from './enabled-maps.js';
import { QUICK_RACE } from './events.js';

/** the track played last on this device (src/main.js saves it), if players can still drive it */
export function lastPlayedMap(storage = globalThis.localStorage) {
  try { const id = storage?.getItem('paraliaki.lastPlayedMap'); return getPlayableMaps(MAPS).some(m => m.id === id) ? id : null; } catch { return null; }
}

export function initialMapId(query) {
  if (query.has('map') && query.get('map') !== 'athens') return getMap(query.get('map')).id; // ?map=athens is the open world, not a catalogue map
  const event = query.get('event') || '';
  // With no map in the URL, Track select opens on the track you raced last (owner 2026-10-20: fewer steps to get anywhere).
  return MAPS.find(m => event && (m.eventIds?.includes(event) || event.endsWith(':' + m.id)))?.id || lastPlayedMap() || 'riviera';
}
export function quickMapEvent(id) {
  const map = getMap(id), closed = map.type === 'circuit';
  return { ...QUICK_RACE, mapId: id, id: map.eventIds?.find(id => id.endsWith('-race')) || 'quick',
    reverse: map.defaultReverse === true, traffic: id === 'riviera' ? 1 : 0, ...(closed ? { laps: map.raceLaps ?? 3 } : {}) };
}
export function menuMapContext(id) {
  const map = getMap(id), closed = map.type === 'circuit';
  const [from, to] = map.subtitle.split(' to ');
  return { mapId: id, marks: [], events: [quickMapEvent(id)],
    route: { start: map.routeStart ?? 0, finish: map.routeFinish ?? map.length, length: map.routeLength ?? map.length, closed,
      from: closed ? 'START / FINISH' : from, to: closed ? 'START / FINISH' : to || from } };
}
