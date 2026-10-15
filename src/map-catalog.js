// Pure metadata: menus and network validation can import this without three.js.
export const MAPS = Object.freeze([
  Object.freeze({ id: 'riviera', name: 'ATHENS RIVIERA', subtitle: 'Vouliagmeni → Lomvarda', length: 10307, type: 'point-to-point', coastal: true, preview: './assets/maps/riviera.svg', dataUrl: 'data/map.json', terrainUrl: 'data/terrain.bin' }),
  Object.freeze({ id: 'megara', name: 'MEGARA CIRCUIT', subtitle: 'Πίστα Μεγάρων · West Attica', length: 1999.6, advertisedLength: 2100, type: 'circuit', coastal: false, preview: './assets/maps/megara.svg', dataUrl: 'data/maps/megara/map.json', terrainUrl: 'data/maps/megara/terrain.bin', eventIds: ['megara-tt', 'megara-race'] }),
  Object.freeze({ id: 'penteli', name: 'PENTELI HILL CLIMB', subtitle: 'Dionysos → Karakanta', length: 9896, type: 'point-to-point', coastal: false, preview: './assets/maps/penteli.svg', dataUrl: 'data/maps/penteli/map.json', terrainUrl: 'data/maps/penteli/terrain.bin', eventIds: ['penteli-tt', 'penteli-race', 'penteli-descent-tt'] }),
  Object.freeze({ id: 'psychiko', name: 'PSYCHIKO GARDEN CIRCUIT', subtitle: 'Palaio Psychiko · Leafy villa streets', length: 4285.748891011167, type: 'circuit', coastal: false, preview: './assets/maps/psychiko.svg', dataUrl: 'data/maps/psychiko/map.json', terrainUrl: 'data/maps/psychiko/terrain.bin', eventIds: ['psychiko-tt', 'psychiko-race'] }),
]);
export function getMap(id = 'riviera') {
  const def = MAPS.find(map => map.id === id);
  if (!def) throw new Error('Unknown map: ' + id);
  return def;
}
// Playable-map registry lives in src/enabled-maps.js (session owner);
export { PLAYABLE_MAPS, isMapEnabled, getPlayableMaps } from './enabled-maps.js';
