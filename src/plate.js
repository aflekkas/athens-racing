// Pure plate + lobby car-class helpers. No dependencies: safe in browsers,
// the Node server, the Cloudflare Worker and plain node --test runs.
//
// formatPlate(text): normalize any string (a username or a default) to what
// fits on the Greek plate texture: uppercase, letters/digits/space/hyphen,
// collapsed whitespace, at most 16 characters. Returns '' when nothing fits.
// makePlateMaterial() additionally shrinks the canvas font so the text fits.
//
// carClass(car): 'supercar' when the catalogue entry makes >= 200 power,
// else 'normal'. The lobby presets build on this single rule so the client
// picker and any future catalogue entry agree without a hardcoded car list.
// presetCars(cars, preset): id list for 'all' | 'normal' | 'supercar'.
// Unknown presets fall back to 'all'; unknown cars fall back to 'normal'.
export function formatPlate(text) {
  const s = String(text ?? '')
    .toUpperCase()
    .replace(/[^\p{L}0-9 \-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, 16);
}

export function carClass(car) {
  return (Number(car?.power) || 0) >= 200 ? 'supercar' : 'normal';
}

export const CAR_PRESETS = {
  all: 'All cars',
  normal: 'Normal cars only',
  supercar: 'Supercars only',
};

export function presetCars(cars, preset) {
  const list = Array.isArray(cars) ? cars : [];
  if (preset === 'normal') return list.filter((c) => carClass(c) === 'normal').map((c) => c.id);
  if (preset === 'supercar') return list.filter((c) => carClass(c) === 'supercar').map((c) => c.id);
  return list.map((c) => c.id);
}
