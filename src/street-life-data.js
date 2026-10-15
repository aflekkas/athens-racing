// Pure deterministic selection/placement helpers, also used by verification tools.
export const STREET_LIFE_MAPS = Object.freeze(['riviera', 'penteli', 'psychiko']);
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
