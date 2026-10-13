// Shared weather state and pure grip hooks. Ground, the tyre solver and AI capability queries use one wetness.
export const WEATHER = { gripScale: 1, wet: 0, rain: 0, ambient: 1 };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sensitivity = { asphalt: 1, pavement: 1, rock: 1, verge: .4, gravel: .4, dirt: .5, scrub: .4, sand: .2, deepsand: .2, water: 0 };
export function advanceRoadWetness(dt, rain = WEATHER.rain, daylight = 1) {
  WEATHER.rain = clamp(rain);
  const target = WEATHER.rain;
  const tau = target > WEATHER.wet ? 18 : 110 + 100 * (1 - clamp(daylight));
  WEATHER.wet += (target - WEATHER.wet) * -Math.expm1(-Math.max(0, dt) / tau);
  if (WEATHER.wet < .0001) WEATHER.wet = 0;
  WEATHER.gripScale = 1 - .24 * WEATHER.wet;
  return WEATHER.wet;
}
export const wetBaseGrip = surface => 1 - (1 - WEATHER.gripScale) * (sensitivity[surface] ?? .5);
const fract = x => x - Math.floor(x);
function hash(x, z) {
  let a = fract(x * .1031), b = fract(z * .1031), c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d; return fract((a + b) * c);
}
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = fract(x), fz = fract(z), u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) + (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v;
}
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Same world-space noise as weather.js puddle shader. Paint/kerbs lose more grip than plain tarmac. */
export function wetGripAt(surface = 'asphalt', { x = 0, z = 0, paint = false, puddle } = {}) {
  const wet = WEATHER.wet, base = wetBaseGrip(surface);
  if (!wet || !['asphalt', 'pavement', 'rock'].includes(surface)) return base;
  const standing = puddle ?? smooth(.6, .7, noise(x * .21, z * .21) * .62 + noise(x * .83 + 7, z * .83 + 7) * .38) * smooth(.3, .8, wet);
  return base * (1 - .18 * standing * wet) * (1 - (paint ? .24 : surface === 'pavement' ? .14 : 0) * wet);
}
export const wetPeakScale = surface => ['asphalt', 'pavement', 'rock'].includes(surface || 'asphalt') ? 1 + .12 * WEATHER.wet : 1;
/** Separate hook for the surface-friction owner: wheelMu already includes ground's wetBaseGrip; only add local
 * puddles/paint here. Legacy/headless grounds get the full wet factor. Never replace their dry surface curves. */
export function wetTyreScale(vehicle, i) {
  if (!WEATHER.wet) return 1; // dry physics stays byte-for-byte in force and avoids contact/noise work
  const surf = vehicle._wsurf?.[i] || vehicle.surf || 'asphalt';
  const f = { x: -Math.sin(vehicle.yaw || 0), z: -Math.cos(vehicle.yaw || 0) };
  const cx = vehicle.cx?.[i] || 0, cy = vehicle.cy?.[i] || 0;
  const x = vehicle.x + f.x * cx + Math.cos(vehicle.yaw) * cy, z = vehicle.z + f.z * cx - Math.sin(vehicle.yaw) * cy;
  // Main-road lane separators/centre paint. Side-road contact still shares world-space puddles.
  const u = (vehicle.u || 0) + cy, route = vehicle.route;
  const paint = !vehicle._network && (Math.abs(u) < .09 || Math.abs(Math.abs(u) - (route?.edge?.(vehicle.s) || 1e6) + .2) < .09);
  const grip = wetGripAt(surf, { x, z, paint });
  return vehicle.wheelMu ? grip / wetBaseGrip(surf) : grip;
}
