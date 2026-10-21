// One Quick Race destination per road: enabled routes replace their legacy twins.
import { MAPS } from './map-catalog.js';
import { getPlayableMaps } from './enabled-maps.js';
import { LEGACY_ROUTE_DESTINATIONS } from './unified-routes.js';
import { TRACK_ROUTES, MAP_VIEW } from './attica-map-data.js';
import { atticaFromAthens } from './spawn-spots.js';

function routeShape(route) {
  const points = route.preview.map(([x, z]) => atticaFromAthens(x, z));
  return { path: 'M' + points.map(p => p.map(v => v.toFixed(2)).join(',')).join('L'),
    start: points[0], end: points.at(-1), loop: Math.hypot(...points[0].map((v, i) => v - points.at(-1)[i])) < 1,
    bounds: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))],
    length: route.lengthM / MAP_VIEW.metersPerUnit };
}
export function quickRaceTracks(catalogue = []) {
  const routes = [...new Map(catalogue.map(r => [r.id, r])).values()];
  const legacy = getPlayableMaps(MAPS).filter(m => !routes.some(r => r.id === LEGACY_ROUTE_DESTINATIONS[m.id]));
  return [...legacy.map(m => ({ ...m, shape: TRACK_ROUTES[m.id] })), ...routes.map(r => {
    const event = r.events.find(e => e.type === 'sprint') || r.events[0];
    const twin = MAPS.find(m => LEGACY_ROUTE_DESTINATIONS[m.id] === r.id), shape = routeShape(r);
    return { id: r.id, legacyId: twin?.id, routeId: r.id, eventId: event.id, name: r.name, subtitle: twin?.subtitle || (r.id === 'penteli-descent' ? 'Karakanta to Dionysos' : 'Athens'),
      length: r.lengthM, type: shape.loop ? 'circuit' : 'point-to-point', shape };
  })];
}
