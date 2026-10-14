// The garage lineup, grouped by class in display order. Catalogue cars left out of it (near-duplicates such as the
// extra Mercedes trims, the Corolla, Superb and the police Octavia) stay in CARS: traffic, AI rivals, remote players
// and old links still drive them, they just are not offered in the garage.
export const GARAGE_CLASSES = [
  ['city', 'CITY', ['panda', 'yaris', 'ibiza', 'golf', 'taxi']],
  ['hot hatch', 'HOT HATCH', ['mini', 'gr_yaris']],
  ['sports', 'SPORTS', ['z4', 'carrera', 'cle']],
  ['super', 'SUPER', ['huracan', 'gla45']],
  ['classic', 'CLASSIC', ['gtv', 'e36']],
];
export const CAR_CLASSES = GARAGE_CLASSES.map(([id]) => id);
const CLASS_OF = new Map(GARAGE_CLASSES.flatMap(([id, , cars]) => cars.map(car => [car, id])));
export const GARAGE_CARS = [...CLASS_OF.keys()];
export const inGarage = c => CLASS_OF.has(c?.id ?? c);
export function carCategory(c) {
  if (CLASS_OF.has(c.id)) return CLASS_OF.get(c.id);
  if (/police/.test(c.id)) return 'police';
  return CAR_CLASSES.includes(c.class || c.category) ? c.class || c.category : c.power >= 350 ? 'super' : c.power >= 150 ? 'sports' : 'city';
}
export const classLabel = id => GARAGE_CLASSES.find(([k]) => k === id)?.[1] || String(id).toUpperCase();
/** garage cars matching the filters, keeping their CARS index; sorted by class, then by the chosen key */
export function filterCars(cars, filters = {}) {
  const q = String(filters.search || '').trim().toLocaleLowerCase();
  const list = cars.map((car, index) => ({ car, index })).filter(({ car: c }) => inGarage(c) &&
    (!q || `${c.name} ${c.short} ${c.tag}`.toLocaleLowerCase().includes(q)) &&
    (!filters.category || filters.category === 'all' || carCategory(c) === filters.category) &&
    (!filters.drive || filters.drive === 'all' || c.drive.toUpperCase() === filters.drive) &&
    (!filters.power || filters.power === 'all' || (filters.power === 'low' ? c.power * 1.341 < 150 : filters.power === 'mid' ? c.power * 1.341 >= 150 && c.power * 1.341 <= 300 : c.power * 1.341 > 300)));
  const order = id => GARAGE_CARS.indexOf(id);
  return list.sort((a, b) => CAR_CLASSES.indexOf(carCategory(a.car)) - CAR_CLASSES.indexOf(carCategory(b.car)) ||
    (filters.sort === 'power' ? b.car.power - a.car.power : filters.sort === 'weight' ? a.car.mass - b.car.mass : order(a.car.id) - order(b.car.id)));
}
