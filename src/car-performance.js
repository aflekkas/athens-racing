// Performance index (PI) and pace classes for every drivable trim.
//
// Pure and dependency-free: the browser garage, the multiplayer lobby UI, the
// Node server and the Cloudflare worker share this module, so a new trim is
// classified automatically from its physics data the moment it lands in CARS.
//
// PI runs 100 (slowest city cars) to ~900 (hyper-lean supercars) and blends:
//   * power-to-weight (40%): the dominant pace factor on straights and exits
//   * 0-100 km/h (27%): launch + traction as actually specified per trim
//   * top speed (12%): aero-limited pace on fast sections
//   * grip (14%): catalogue cornering factor, averaged across axles
//   * braking (5%): catalogue brake factor
//   * torque-to-weight (2%): mid-range pull on top of peak power
// plus a small drivetrain bonus (AWD launches hardest, RWD next, FWD last).
// Missing fields degrade gracefully (catalogue averages), never NaN.
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (v, fallback) => Number.isFinite(+v) && +v > 0 ? +v : fallback;

export const PI_CLASSES = ['D', 'C', 'B', 'A', 'S'];
// Upper-exclusive bands; performanceClass() clamps into them.
export const PI_BANDS = { D: 300, C: 430, B: 550, A: 670, S: 901 };

export function sprintSeconds(car = {}) {
  if (num(car.zeroTo100, 0)) return num(car.zeroTo100, 0);
  // No quoted figure (e.g. service vehicles): estimate from power-to-weight
  // on the catalogue curve so the trim still classifies instead of dropping out.
  return clamp(2.1 * Math.pow(num(car.mass, 1300) / Math.max(20, num(car.power, 100)), 0.55), 2.5, 20);
}

export function carPerformanceIndex(car = {}) {
  const power = Math.max(20, num(car.power, 100));
  const mass = Math.max(500, num(car.mass, 1300));
  const pw = (power * 1000) / mass; // W/kg
  const pwScore = clamp(pw / 305, 0, 1);
  const sprintScore = clamp((14 - sprintSeconds(car)) / 11.5, 0, 1);
  const topScore = clamp((num(car.vmax, 200) - 150) / 175, 0, 1);
  const grip = num(car.grip, 1);
  const gripAvg = (grip + num(car.gripRear, grip)) / 2;
  const gripScore = clamp((gripAvg - 0.9) / 0.35, 0, 1);
  const brakeScore = clamp((num(car.brake, 1) - 0.9) / 0.35, 0, 1);
  const torqueScore = clamp((num(car.torque, 200) / mass - 0.1) / 0.3, 0, 1);
  const driveBonus = car.drive === 'awd' ? 0.012 : car.drive === 'rwd' ? 0.004 : 0;
  const raw = 0.4 * pwScore + 0.27 * sprintScore + 0.12 * topScore +
    0.14 * gripScore + 0.05 * brakeScore + 0.02 * torqueScore + driveBonus;
  return Math.round(100 + 800 * clamp(raw, 0, 1));
}

export function performanceClass(pi) {
  const v = num(pi, 0);
  if (v < PI_BANDS.D) return 'D';
  if (v < PI_BANDS.C) return 'C';
  if (v < PI_BANDS.B) return 'B';
  if (v < PI_BANDS.A) return 'A';
  return 'S';
}

/** PI + class for a catalogue entry in one call (used by lobby lists and the garage). */
export function classifyCar(car = {}) {
  const pi = carPerformanceIndex(car);
  return { pi, class: performanceClass(pi) };
}
