// Catalogue-only contexts for setup screens. No terrain, geometry, map bundle or fetch.
import { getMap } from './map-catalog.js';
import { QUICK_RACE } from './events.js';

export { lastPlayedMap, initialMapId } from './map-entry.js';
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
