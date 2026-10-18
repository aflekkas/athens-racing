// Catalogue-only contexts for setup screens. No terrain, geometry, map bundle or fetch.
import { MAPS, getMap } from './map-catalog.js';
import { QUICK_RACE } from './events.js';

export function initialMapId(query) {
  if (query.has('map')) return getMap(query.get('map')).id;
  const event = query.get('event') || '';
  return MAPS.find(m => m.eventIds?.includes(event) || event.endsWith(':' + m.id))?.id || 'riviera';
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
