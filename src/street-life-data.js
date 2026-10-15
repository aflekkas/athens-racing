// Pure deterministic selection/placement helpers, also used by verification tools.
export const STREET_LIFE_MAPS = Object.freeze(['riviera', 'penteli', 'psychiko']);
export function graffitiSeed(id) { return Math.imul(Number(id) | 0, 2654435761) >>> 0; }
export function buildingGraffiti(id) {
  const seed = graffitiSeed(id);
  return { selected: seed / 4294967296 < .28, count: 1 + seed % 3, style: seed % 4, color: (seed >>> 5) % 4, seed };
}
export function selectGraffitiBuildings(buildings) {
  return [...buildings].sort((a, b) => graffitiSeed(a.id) - graffitiSeed(b.id)).slice(0, Math.round(buildings.length * .28));
}
export function streetLifeTown(map, s) {
  if (map.id === 'penteli') {
    const zone = map.data.zones?.findLast(z => z.s <= s);
    return zone?.zone === 'town' || (zone?.zone === 'chapel' && (map.data.buildings || []).some(b => String(b.id) !== '368804380' && Math.abs(b.s - s) < 140));
  }
  return map.route.urban(s) > .48;
}
export function townBinStations(map) {
  if (!STREET_LIFE_MAPS.includes(map.id)) return [];
  const r = map.route, stations = [];
  for (let s = map.id === 'penteli' ? 35 : 95; s < r.length - 30; s += map.id === 'penteli' ? 70 : 125) if (streetLifeTown(map, s)) stations.push(s);
  // Lomvarda's coastal cove is a settlement even where land-cover is beach.
  if (map.id === 'riviera') { const mark = map.data.marks?.find(m => m.id === 'lomvarda');
    if (mark) for (const ds of [-150, -25, 100]) if (mark.s + ds < r.length - 30) stations.push(mark.s + ds); }
  return [...new Set(stations)].sort((a, b) => a - b);
}
export function paintProgress(elapsed) { return Math.max(0, Math.min(1, elapsed / 9)); }
