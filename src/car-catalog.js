// Presentation categories for the represented cars. Future entries may supply class/category.
export const CAR_CLASSES = ['shitbox', 'normal', 'hot hatch', 'sports', 'super', 'SUV', 'police'];
export function carCategory(c) {
  if (/police/.test(c.id)) return 'police';
  if (['ibiza', 'panda', 'yaris', 'a160'].includes(c.id)) return 'shitbox';
  if (['gla', 'gla45'].includes(c.id)) return 'SUV';
  if (['mini', 'mini_jcw', 'gr_yaris'].includes(c.id)) return 'hot hatch';
  if (c.id === 'huracan' || c.power >= 350) return 'super';
  if (['z4', 'carrera', 'gtv', 'e36', 'f348', 'p928'].includes(c.id)) return 'sports';
  return CAR_CLASSES.includes(c.class || c.category) ? c.class || c.category : 'normal';
}
export function filterCars(cars, filters = {}) {
  const q = String(filters.search || '').trim().toLocaleLowerCase();
  const list = cars.map((car, index) => ({ car, index })).filter(({ car: c }) =>
    (!q || `${c.name} ${c.short} ${c.tag}`.toLocaleLowerCase().includes(q)) &&
    (!filters.category || filters.category === 'all' || carCategory(c) === filters.category) &&
    (!filters.drive || filters.drive === 'all' || c.drive.toUpperCase() === filters.drive) &&
    (!filters.power || filters.power === 'all' || (filters.power === 'low' ? c.power * 1.341 < 150 : filters.power === 'mid' ? c.power * 1.341 >= 150 && c.power * 1.341 <= 300 : c.power * 1.341 > 300)));
  return list.sort((a, b) => filters.sort === 'power' ? b.car.power - a.car.power : filters.sort === 'weight' ? a.car.mass - b.car.mass : a.car.name.localeCompare(b.car.name));
}
