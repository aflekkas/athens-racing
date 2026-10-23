// Startup-only map selection metadata. Keep race event/course imports outside this graph.
import { MAPS, getMap } from './map-catalog.js';
import { getPlayableMaps } from './enabled-maps.js';

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
