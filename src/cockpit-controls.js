// Gear lever and paddle motion only. Vehicles have no visible occupants.
const SHIFT_X_TRAVEL = .022, SHIFT_X_EXTRA = .034, SHIFT_Z_TRAVEL = .026;
/** H-pattern gate for a target gear: lateral x and fore/aft z lever offsets. R is far-right back. */
export function shiftGateOffset(gear, gears = 6, out = null) {
  const r = out || { x: 0, z: 0 };
  const n = Math.max(4, Math.min(9, gears | 0 || 6));
  if (gear === 'R' || gear === 0 || gear === -1) {
    r.x = n <= 5 ? SHIFT_X_TRAVEL : SHIFT_X_EXTRA; r.z = SHIFT_Z_TRAVEL; return r;
  }
  const g = Math.max(1, Math.min(n, gear | 0 || 1));
  const pairs = Math.ceil(n / 2), pair = (g - 1) >> 1;
  r.x = pairs <= 2 ? (pair === 0 ? -SHIFT_X_TRAVEL : 0)
    : pairs === 3 ? [-SHIFT_X_TRAVEL, 0, SHIFT_X_TRAVEL][pair]
    : [-SHIFT_X_TRAVEL, 0, SHIFT_X_TRAVEL, SHIFT_X_EXTRA][Math.min(3, pair)];
  r.z = (g % 2 === 1) ? -SHIFT_Z_TRAVEL : SHIFT_Z_TRAVEL;
  return r;
}
// Cars with a physical H-stick, and the dual 911 that offers PDK paddles or the stick.
const STICK_FALLBACK = new Set(['e36', 'e36_318i', 'e36_m3', 'gtv', 'gtv1750']);
const DUAL_FALLBACK = new Set(['carrera', 'carrera_s', 'carrera_gts']);
/** Which shift hardware a cockpit should build. Explicit Sol-era gearbox fields win; ids cover the rest. */
export function cockpitShiftHardware(spec = {}) {
  const t = spec.transmission ?? spec.gearboxType ?? spec.shiftType;
  if (t != null) {
    const s = String(t).toLowerCase();
    if (/(^|[^a-z])manual([^a-z]|$)/.test(s)) return { stick: true, paddles: DUAL_FALLBACK.has(spec.id) || /(pdk|dct)/.test(s) };
    return { stick: false, paddles: true };
  }
  if (DUAL_FALLBACK.has(spec.id)) return { stick: true, paddles: true };
  if (STICK_FALLBACK.has(spec.id) || spec.body === 'e36' || spec.body === 'gtv') return { stick: true, paddles: false };
  return { stick: false, paddles: true };
}
/** 'lever' | 'paddle' | 'none'. Automatics stay still in D; manual selections flick a paddle when fitted. */
export function selectShiftKind({ manual = false, stick = false, paddles = true, autoOverride = 0, shiftType = null, direction = 0 } = {}) {
  if (!direction) return 'none';
  const t = shiftType == null ? null : String(shiftType).toLowerCase();
  if (t) {
    if (/manual|stick|h.pattern|h_pattern/.test(t)) return stick ? 'lever' : 'none';
    if (/dct|pdk|paddle|auto|torque/.test(t)) return paddles ? 'paddle' : 'none';
    return 'none';
  }
  if (manual && stick) return 'lever';
  if (manual && paddles && !stick) return 'paddle';
  if (!manual && autoOverride > 0 && paddles) return 'paddle';
  return 'none';
}
/** Control motion follows the gearbox: a lever stroke reads at 300-450 ms, a paddle flick is quicker. */
export function shiftAnimDuration(kind, seconds) {
  const s = Number.isFinite(seconds) ? seconds : kind === 'paddle' ? .16 : .35;
  if (kind === 'paddle') return Math.min(.25, Math.max(.12, s));
  if (kind === 'lever') return Math.min(.45, Math.max(.30, s + .06));
  return 0;
}
export function smootherstep(p) { const t = Math.min(1, Math.max(0, p)); return t * t * t * (t * (t * 6 - 15) + 10); }
/** 0 at both ends, 1 mid-travel: the control has settled when the envelope closes. */
export function shiftEnvelope(p) {
  if (p <= 0 || p >= 1) return 0;
  return Math.min(smootherstep(p / .38), 1 - smootherstep((p - .62) / .38));
}
