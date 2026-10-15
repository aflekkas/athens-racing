// Pure metadata: menus and network validation can import this without three.js.
export const MAPS = Object.freeze([
  Object.freeze({ id: 'riviera', routeStart: 241, routeFinish: 10548, routeLength: 10988, name: 'ATHENS RIVIERA', subtitle: 'Vouliagmeni → Lomvarda', length: 10307, type: 'point-to-point', coastal: true, preview: './assets/maps/riviera.svg', dataUrl: 'data/map.json', terrainUrl: 'data/terrain.bin' }),
  Object.freeze({ id: 'megara', routeStart: 0, routeFinish: 1999.5997991916397, routeLength: 1999.5997991916397, name: 'MEGARA CIRCUIT', subtitle: 'Πίστα Μεγάρων · West Attica', length: 1999.6, advertisedLength: 2100, type: 'circuit', coastal: false, preview: './assets/maps/megara.svg', dataUrl: 'data/maps/megara/map.json', terrainUrl: 'data/maps/megara/terrain.bin', eventIds: ['megara-tt', 'megara-race'] }),
  Object.freeze({ id: 'penteli', routeStart: 292, routeFinish: 10188, routeLength: 10480, name: 'PENTELI HILL CLIMB', subtitle: 'Dionysos → Karakanta', length: 9896, type: 'point-to-point', coastal: false, preview: './assets/maps/penteli.svg', dataUrl: 'data/maps/penteli/map.json', terrainUrl: 'data/maps/penteli/terrain.bin', eventIds: ['penteli-tt', 'penteli-race', 'penteli-descent-tt'] }),
  Object.freeze({ id: 'psychiko', routeStart: 0, routeFinish: 5960.933287659299, routeLength: 5960.933287659299, name: 'PSYCHIKO GARDEN CIRCUIT', subtitle: 'Palaio Psychiko · Leafy villa streets', length: 5960.933287659299, type: 'circuit', coastal: false, preview: './assets/maps/psychiko.svg', dataUrl: 'data/maps/psychiko/map.json', terrainUrl: 'data/maps/psychiko/terrain.bin', eventIds: ['psychiko-tt', 'psychiko-race'] }),
]);
export function getMap(id = 'riviera') {
  const def = MAPS.find(map => map.id === id);
  if (!def) throw new Error('Unknown map: ' + id);
  return def;
}
// Playable-map registry lives in src/enabled-maps.js (session owner);
export { PLAYABLE_MAPS, isMapEnabled, getPlayableMaps } from './enabled-maps.js';
