// RACING WHEELS over the Gamepad API (owner playtest 2026-10-18, item 5). A wheel and its pedals appear to the browser as
// one gamepad: the wheel is one axis, the pedals are others (separate throttle and brake axes, usually resting at +1 or -1
// and often inverted), and the buttons are paddles and wheel buttons. This module is pure (no DOM, timers or storage): it
// recognises a wheel, maps and calibrates its axes, and shapes force-feedback. src/input.js owns the device state and the
// settings; src/ui/controls-panel.js draws the calibration controls from the shared kit.
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));

// Wheel makers and models seen through the Gamepad API (Logitech G29/G920/G923/G27/DFGT, Thrustmaster T150/T248/T300/TMX/
// T-GT, Fanatec CSL/ClubSport/Podium, Simagic, Moza, Simucube) plus the generic word "wheel".
const FAMILIES = [
  ['logitech', /logitech|g29|g920|g923|g27|g25|dfgt|driving force|momo|formula force/i],
  ['thrustmaster', /thrustmaster|t300|t150|t248|tmx|t-gt|t500|ts-xw|tx racing|tx\b|t80|t16000/i],
  ['fanatec', /fanatec|csl|clubsport|podium|gt dd|cs dd/i],
];
const OTHER_WHEELS = /simagic|moza|simucube|heusinkveld|racing wheel|steering wheel|\bwheel\b|vrs|cammus|asetek/i;
const NOT_A_WHEEL = /xbox|xinput|dualshock|dualsense|playstation|wireless controller|switch pro|joy-con|stadia|8bitdo|gamepad/i;
const HAT_AXIS = 9; // a d-pad hat reads as axis 9 on a non-standard mapping; it is never a pedal or the wheel

export const WHEEL_MODES = ['auto', 'gamepad', 'wheel'];
export const WHEEL_DEFAULTS = Object.freeze({
  mode: 'auto',        // auto: a recognised wheel is a wheel; gamepad: never; wheel: the first non-standard device is one
  range: 1,            // share of the wheel's travel, either side of centre, that reaches full steering lock (0.3..1)
  deadzone: 0.02,      // steering deadzone (0..0.2)
  linearity: 1,        // steering curve (0.5..2.5)
  pedalDeadzone: 0.03, // pedal travel ignored at the top and bottom (0..0.3)
  force: 0.6,          // force feedback strength (0 = off)
});
export const WHEEL_LIMITS = Object.freeze({ range: [0.3, 1], deadzone: [0, 0.2], linearity: [0.5, 2.5], pedalDeadzone: [0, 0.3], force: [0, 1] });
/** clean wheel settings: unknown keys dropped, numbers clamped */
export function wheelSettings(raw = {}) {
  const out = { ...WHEEL_DEFAULTS };
  if (WHEEL_MODES.includes(raw.mode)) out.mode = raw.mode;
  for (const [key, [lo, hi]] of Object.entries(WHEEL_LIMITS)) if (Number.isFinite(+raw[key]) && raw[key] !== null && raw[key] !== '') out[key] = clamp(+raw[key], lo, hi);
  return out;
}

export function wheelFamily(id = '') {
  for (const [family, pattern] of FAMILIES) if (pattern.test(id)) return family;
  return OTHER_WHEELS.test(id) ? 'other' : null;
}
/** Is this gamepad a racing wheel? `mode` is the player's choice (wheel settings); `auto` goes by the device name. */
export function isWheel(pad, mode = 'auto') {
  if (!pad || mode === 'gamepad') return false;
  const id = String(pad.id || '');
  if (mode === 'wheel') return pad.mapping !== 'standard' || !!wheelFamily(id);
  if (pad.mapping === 'standard' && !wheelFamily(id)) return false;
  return !!wheelFamily(id) && !(NOT_A_WHEEL.test(id) && !/wheel/i.test(id));
}
/** a stable key for a device's saved calibration: the id with its per-session numbers and port text removed */
export const deviceKey = (pad) => String(pad?.id || 'wheel').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase().slice(0, 64) || 'wheel';
export const deviceName = (pad) => String(pad?.id || 'Racing wheel').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Racing wheel';

// ---------------------------------------------------------------- profile (which axis is what)
// steer { axis, center, lock, invert }: raw reading at centre and the distance to full lock.
// throttle / brake { axis, min, max }: raw reading released and fully pressed (max < min is an inverted pedal).
// combined { axis, center, sign }: one axis for both pedals (some wheels): one way throttle, the other brake.
export const axisCount = (pad) => Math.max(0, Math.min(16, (pad?.axes?.length || 0)));
const isPedalRest = (v) => Math.abs(v) > 0.9 && Math.abs(v) <= 1.05;
/**
 * A first guess from the device alone: the steering wheel is axis 0, and a pedal is an axis resting at +1 or -1. A wheel
 * with clutch, throttle and brake lists them in that order, so throttle and brake are the last two. One resting axis is a
 * combined pedal pair. The calibration steps replace this guess with what the player actually pressed.
 */
export function inferProfile(pad) {
  const n = axisCount(pad), axes = pad?.axes || [];
  const pedals = [];
  for (let i = 1; i < n; i++) if (i !== HAT_AXIS && isPedalRest(axes[i])) pedals.push(i);
  const profile = { steer: { axis: 0, center: 0, lock: 1, invert: false } };
  if (pedals.length >= 2) {
    const [t, b] = pedals.slice(-2);
    profile.throttle = { axis: t, min: axes[t], max: -axes[t] };
    profile.brake = { axis: b, min: axes[b], max: -axes[b] };
  } else if (pedals.length === 1 || n >= 2 && n <= 3) {
    const axis = pedals[0] ?? 1;
    profile.combined = { axis, center: pedals.length ? 0 : axes[axis] || 0, sign: pedals.length && axes[axis] > 0 ? -1 : 1 };
  }
  return profile;
}
const validAxis = (axis, pad) => Number.isInteger(axis) && axis >= 0 && axis < axisCount(pad);
/** a saved profile checked against the device in front of us; anything unusable falls back to `guess` (inferred when the device first appeared) */
export function resolveProfile(saved, pad, guess = inferProfile(pad)) {
  const out = { steer: guess.steer, throttle: guess.throttle, brake: guess.brake, combined: guess.combined };
  if (saved?.steer && validAxis(saved.steer.axis, pad) && Number.isFinite(saved.steer.center) && saved.steer.lock > 0.05) out.steer = { axis: saved.steer.axis, center: saved.steer.center, lock: saved.steer.lock, invert: !!saved.steer.invert };
  for (const key of ['throttle', 'brake']) {
    const p = saved?.[key];
    if (p && validAxis(p.axis, pad) && Number.isFinite(p.min) && Number.isFinite(p.max) && Math.abs(p.max - p.min) > 0.1) { out[key] = { axis: p.axis, min: p.min, max: p.max }; out.combined = undefined; }
  }
  if (saved?.throttle && saved?.brake && out.throttle && out.brake) out.combined = undefined;
  return out;
}
/** pedal position 0..1: travel between the calibrated released / pressed readings, minus the deadzone (and any saturation) */
export function pedalValue(raw, cal, deadzone = WHEEL_DEFAULTS.pedalDeadzone) {
  if (!cal) return 0;
  const span = cal.max - cal.min;
  if (!Number.isFinite(raw) || Math.abs(span) < 1e-6) return 0;
  const v = clamp((raw - cal.min) / span, 0, 1), dz = clamp(deadzone, 0, 0.3);
  return clamp((v - dz) / (1 - 2 * dz), 0, 1);
}
/** steering -1..1 (right positive): centred, scaled to the chosen share of travel, with deadzone and curve */
export function steerValue(raw, cal, { range = 1, deadzone = 0.02, linearity = 1 } = {}) {
  if (!cal || !Number.isFinite(raw)) return 0;
  const turned = (raw - cal.center) / Math.max(0.05, cal.lock) * (cal.invert ? -1 : 1);
  const v = clamp(turned / clamp(range, 0.3, 1), -1, 1), a = Math.abs(v), dz = clamp(deadzone, 0, 0.2);
  return a <= dz ? 0 : Math.sign(v) * Math.pow((a - dz) / (1 - dz), clamp(linearity, 0.5, 2.5));
}
/** the three driving axes of a wheel, from its pad, saved profile and settings */
export function wheelAxes(pad, profile, settings = WHEEL_DEFAULTS) {
  const axes = pad?.axes || [], out = { steer: 0, throttle: 0, brake: 0, raw: axes.slice(0, 16) };
  if (!profile) return out;
  out.steer = steerValue(axes[profile.steer.axis], profile.steer, settings);
  if (profile.throttle && profile.brake) {
    out.throttle = pedalValue(axes[profile.throttle.axis], profile.throttle, settings.pedalDeadzone);
    out.brake = pedalValue(axes[profile.brake.axis], profile.brake, settings.pedalDeadzone);
  } else if (profile.combined) {
    const v = ((axes[profile.combined.axis] ?? 0) - profile.combined.center) * profile.combined.sign, dz = clamp(settings.pedalDeadzone, 0, 0.3);
    out.throttle = clamp((v - dz) / (1 - dz), 0, 1); out.brake = clamp((-v - dz) / (1 - dz), 0, 1);
  }
  return out;
}

// ---------------------------------------------------------------- calibration: turn the wheel, press each pedal
export const CALIBRATION_STEPS = ['steer', 'throttle', 'brake'];
export const CALIBRATION_TEXT = {
  steer: ['STEERING', 'Turn the wheel fully to the RIGHT, then fully to the LEFT, then let it centre.'],
  throttle: ['THROTTLE', 'Press the THROTTLE pedal all the way down, then release it.'],
  brake: ['BRAKE', 'Press the BRAKE pedal all the way down, then release it.'],
};
/** one calibration run: start(pad), feed(pad) every frame, finish(step) to read a step's result, as many steps as the player takes */
export class WheelCalibration {
  constructor(pad) { this.pad = null; this.step = 0; this.result = {}; this.error = ''; this.begin(pad); }
  get name() { return CALIBRATION_STEPS[this.step] || null; }
  get done() { return this.step >= CALIBRATION_STEPS.length; }
  begin(pad) {
    const axes = Array.from(pad?.axes || []).slice(0, 16);
    this.rest = axes.slice(); this.min = axes.slice(); this.max = axes.slice(); this.first = axes.map(() => 0); this.live = axes.slice();
  }
  /** record this frame's readings (call every frame while a step is open) */
  feed(pad) {
    const axes = pad?.axes || [];
    for (let i = 0; i < this.rest.length; i++) {
      const v = Number.isFinite(axes[i]) ? axes[i] : this.rest[i];
      this.live[i] = v; this.min[i] = Math.min(this.min[i], v); this.max[i] = Math.max(this.max[i], v);
      if (!this.first[i] && Math.abs(v - this.rest[i]) > 0.3) this.first[i] = Math.sign(v - this.rest[i]);
    }
  }
  travel(i) { return Math.max(this.max[i] - this.rest[i], this.rest[i] - this.min[i]); }
  /** the axis that moved most this step, outside `skip`; null when nothing moved enough to trust */
  moved(skip = []) {
    let best = -1, span = 0.4;
    for (let i = 0; i < this.rest.length; i++) if (i !== HAT_AXIS && !skip.includes(i) && this.travel(i) > span) { best = i; span = this.travel(i); }
    return best;
  }
  /** close the open step: true when it was understood, else `error` says why and the step can be tried again */
  next(pad) {
    this.feed(pad); this.error = '';
    const name = this.name; if (!name) return true;
    const used = ['steer', 'throttle', 'brake'].map(k => this.result[k]?.axis).filter(a => a !== undefined);
    const axis = this.moved(used);
    if (axis < 0) { this.error = `NOTHING MOVED · ${name === 'steer' ? 'TURN THE WHEEL' : 'PRESS THE PEDAL'} FULLY AND TRY AGAIN`; this.begin(pad); return false; }
    if (name === 'steer') {
      const lock = Math.max(this.travel(axis), 0.05);
      // turning right first must read positive: a wheel whose right turn lowers the reading is inverted
      this.result.steer = { axis, center: this.rest[axis], lock, invert: this.first[axis] < 0 };
    } else {
      // released reading is where it rested; pressed is the extreme furthest from it
      const pressed = this.max[axis] - this.rest[axis] >= this.rest[axis] - this.min[axis] ? this.max[axis] : this.min[axis];
      this.result[name] = { axis, min: this.rest[axis], max: pressed };
    }
    this.step++; this.begin(pad);
    return true;
  }
  /** a saved profile can be drawn from the result once steering and throttle exist (brake alone may be skipped) */
  profile() { return this.result.steer ? { ...this.result } : null; }
}

// ---------------------------------------------------------------- force feedback
/**
 * Wheel force feedback through what the Gamepad API offers: vibrationActuator (dual-rumble, e.g. XInput wheels such as the
 * Logitech G920) or the older hapticActuators. The API has no steering torque, so the wheel gets what it can render: a
 * growing rumble as the front tyres near and pass their grip limit, and a rougher one over kerbs and bumps.
 * telemetry: { frontSlip (1 = at the peak), kerb (0..1), speed (m/s) }. Returns { strong, weak } 0..1, or zeros when off.
 */
export function wheelRumble({ frontSlip = 0, kerb = 0, speed = 0 } = {}, strength = WHEEL_DEFAULTS.force) {
  const k = clamp(strength, 0, 1);
  if (k <= 0 || speed < 2) return { strong: 0, weak: 0 };
  const grip = clamp((frontSlip - 0.75) / 0.9, 0, 1), road = clamp(kerb, 0, 1) * clamp(speed / 15, 0, 1);
  return { strong: clamp(k * (0.8 * grip + 0.5 * road), 0, 1), weak: clamp(k * (0.25 * grip + 0.6 * road + 0.03 * clamp(speed / 40, 0, 1)), 0, 1) };
}
/** can this pad rumble at all? ('vibrationActuator' with playEffect, or legacy 'hapticActuators') */
export function canRumble(pad) { return !!(pad?.vibrationActuator?.playEffect || pad?.hapticActuators?.[0]?.pulse); }
export async function playRumble(pad, { strong, weak }, ms = 120) {
  if (!pad || (strong < 0.02 && weak < 0.02)) return false;
  try {
    if (pad.vibrationActuator?.playEffect) { await pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }); return true; }
    if (pad.hapticActuators?.[0]?.pulse) { await pad.hapticActuators[0].pulse(clamp(Math.max(strong, weak), 0, 1), ms); return true; }
  } catch { /* unsupported or revoked: force feedback is optional */ }
  return false;
}
