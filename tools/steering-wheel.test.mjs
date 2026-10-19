// Racing wheels through the Gamepad API (owner playtest 2026-10-18): detection, axis mapping with calibration, pedals that rest
// at +1 or -1 and are often inverted, separate or combined pedal axes, and force feedback only where the API allows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/input.js';
import { isWheel, wheelFamily, deviceKey, inferProfile, resolveProfile, pedalValue, steerValue, wheelAxes, WheelCalibration, wheelRumble, wheelSettings, WHEEL_DEFAULTS } from '../src/steering-wheel.js';

const IDS = {
  g29: 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', g920: 'Logitech G920 Driving Force Racing Wheel for Xbox One (STANDARD GAMEPAD Vendor: 046d Product: c262)',
  t300: 'Thrustmaster T300RS GT Edition (Vendor: 044f Product: b66e)', fanatec: 'Fanatec CSL DD (Vendor: 0eb7 Product: 0020)',
  xbox: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', ps: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
};
const pad = (id, axes, extra = {}) => ({ id, index: 0, connected: true, mapping: '', axes, buttons: Array.from({ length: 24 }, () => ({ value: 0, pressed: false })), ...extra });

test('common wheels are recognised by name, controllers are not, and the player can override', () => {
  for (const id of [IDS.g29, IDS.g920, IDS.t300, IDS.fanatec]) assert.ok(isWheel(pad(id, [0, 1, 1, 1]), 'auto'), id);
  assert.ok(isWheel(pad(IDS.g920, [0, 0, 0, 0], { mapping: 'standard' }), 'auto'), 'a wheel exposing the standard mapping is still a wheel');
  for (const id of [IDS.xbox, IDS.ps]) assert.equal(isWheel(pad(id, [0, 0, 0, 0], { mapping: 'standard' }), 'auto'), false, id);
  assert.equal(isWheel(pad(IDS.g29, [0, 1, 1, 1]), 'gamepad'), false);
  assert.equal(isWheel(pad('Some DirectInput Device', [0, 1, 1, 1]), 'auto'), false);
  assert.equal(isWheel(pad('Some DirectInput Device', [0, 1, 1, 1]), 'wheel'), true);
  assert.equal(isWheel(pad(IDS.xbox, [0, 0, 0, 0], { mapping: 'standard' }), 'wheel'), false);
  assert.equal(wheelFamily(IDS.g29), 'logitech'); assert.equal(wheelFamily(IDS.t300), 'thrustmaster'); assert.equal(wheelFamily(IDS.fanatec), 'fanatec');
  assert.equal(deviceKey(pad(IDS.g29, [])), 'logitech g29 driving force racing wheel');
});
test('the default mapping reads steering from axis 0 and takes throttle and brake from the last two resting pedal axes', () => {
  const logitech = inferProfile(pad(IDS.g29, [0, 1, 1, 1])); // clutch, throttle, brake all rest at +1
  assert.deepEqual(logitech.throttle, { axis: 2, min: 1, max: -1 }); assert.deepEqual(logitech.brake, { axis: 3, min: 1, max: -1 });
  const fanatec = inferProfile(pad(IDS.fanatec, [0, -1, -1])); // pedals rest at -1
  assert.deepEqual(fanatec.throttle, { axis: 1, min: -1, max: 1 }); assert.deepEqual(fanatec.brake, { axis: 2, min: -1, max: 1 });
  const combined = inferProfile(pad('Logitech Driving Force', [0, 0])); assert.ok(combined.combined && !combined.throttle);
  const hat = inferProfile(pad(IDS.g29, [0, 1, 1, 1, 0, 0, 0, 0, 0, 1.2857])); assert.equal(hat.brake.axis, 3, 'the d-pad hat axis is not a pedal');
});
test('pedals: inverted (+1 released) and normal, deadzone at both ends, and the axes of a wheel come out as steer / throttle / brake', () => {
  const inverted = { axis: 2, min: 1, max: -1 }, normal = { axis: 2, min: -1, max: 1 };
  assert.equal(pedalValue(1, inverted), 0); assert.equal(pedalValue(-1, inverted), 1); assert.ok(Math.abs(pedalValue(0, inverted) - 0.5) < 1e-9);
  assert.equal(pedalValue(-1, normal), 0); assert.equal(pedalValue(1, normal), 1);
  assert.equal(pedalValue(0.97, inverted, 0.05), 0, 'inside the bottom deadzone'); assert.equal(pedalValue(-0.97, inverted, 0.05), 1, 'inside the top deadzone');
  assert.equal(pedalValue(5, { axis: 0, min: 1, max: 1 }), 0, 'a degenerate calibration yields nothing, never NaN');
  const p = pad(IDS.g29, [0.5, 1, -1, 0.5]), v = wheelAxes(p, inferProfile(pad(IDS.g29, [0, 1, 1, 1])), WHEEL_DEFAULTS);
  assert.ok(v.steer > 0.4 && v.steer < 0.5); assert.equal(v.throttle, 1); assert.ok(Math.abs(v.brake - 0.25) < 0.03);
});
test('steering range, deadzone, curve and inversion', () => {
  const cal = { center: 0, lock: 1, invert: false };
  assert.equal(steerValue(0.01, cal, { deadzone: 0.02 }), 0);
  assert.ok(Math.abs(steerValue(0.5, cal, { range: 0.5, deadzone: 0 }) - 1) < 1e-9, 'half the travel at 50% range is full lock');
  assert.ok(Math.abs(steerValue(0.25, cal, { range: 0.5, deadzone: 0 }) - 0.5) < 1e-9);
  assert.equal(steerValue(-1, { ...cal, invert: true }, { deadzone: 0 }), 1);
  assert.ok(Math.abs(steerValue(0.5, cal, { deadzone: 0, linearity: 2 }) - 0.25) < 1e-9);
  assert.ok(Math.abs(steerValue(1.2, { center: 0.2, lock: 0.8, invert: false }, { deadzone: 0 }) - 1) < 1e-9, 'an off-centre wheel is centred by its calibration');
  assert.equal(steerValue(NaN, cal), 0);
});
test('calibration: turn right then left, press each pedal; an inverted wheel and +1-rest pedals are worked out from what was done', () => {
  const frames = [];
  let axes = [0, 1, 1, 1];
  const cal = new WheelCalibration(pad(IDS.g29, axes));
  const hold = (a) => { axes = a; cal.feed(pad(IDS.g29, axes)); };
  // right turn reads negative on this wheel: it is inverted
  hold([-0.5, 1, 1, 1]); hold([-1, 1, 1, 1]); hold([1, 1, 1, 1]); hold([0, 1, 1, 1]);
  assert.equal(cal.name, 'steer'); assert.ok(cal.next(pad(IDS.g29, axes)));
  hold([0, 1, 0, 1]); hold([0, 1, -1, 1]); hold([0, 1, 1, 1]); assert.equal(cal.name, 'throttle'); assert.ok(cal.next(pad(IDS.g29, axes)));
  hold([0, 1, 1, 0]); hold([0, 1, 1, -1]); hold([0, 1, 1, 1]); assert.equal(cal.name, 'brake'); assert.ok(cal.next(pad(IDS.g29, axes)));
  assert.ok(cal.done);
  const profile = cal.profile();
  assert.deepEqual(profile.steer, { axis: 0, center: 0, lock: 1, invert: true });
  assert.deepEqual(profile.throttle, { axis: 2, min: 1, max: -1 }); assert.deepEqual(profile.brake, { axis: 3, min: 1, max: -1 });
  const p = pad(IDS.g29, [-1, 1, -1, 1]), v = wheelAxes(p, resolveProfile(profile, p), WHEEL_DEFAULTS);
  assert.ok(v.steer > 0.95, 'right is positive after the calibration'); assert.equal(v.throttle, 1); assert.equal(v.brake, 0);
  void frames;
});
test('calibration refuses a step where nothing moved, and a pedal cannot reuse the steering axis', () => {
  const cal = new WheelCalibration(pad(IDS.g29, [0, 1, 1, 1]));
  assert.equal(cal.next(pad(IDS.g29, [0, 1, 1, 1])), false); assert.match(cal.error, /NOTHING MOVED/); assert.equal(cal.name, 'steer');
  cal.feed(pad(IDS.g29, [1, 1, 1, 1])); assert.ok(cal.next(pad(IDS.g29, [0, 1, 1, 1])));
  cal.feed(pad(IDS.g29, [1, 1, 1, 1])); assert.equal(cal.next(pad(IDS.g29, [0, 1, 1, 1])), false, 'only the (already used) steering axis moved');
});
test('a saved profile that does not fit the device in front of us is ignored', () => {
  const p = pad(IDS.g29, [0, 1, 1, 1]), good = { steer: { axis: 0, center: 0, lock: 0.9, invert: false }, throttle: { axis: 2, min: 1, max: -1 }, brake: { axis: 3, min: 1, max: -1 } };
  assert.equal(resolveProfile(good, p).steer.lock, 0.9);
  assert.equal(resolveProfile({ ...good, throttle: { axis: 12, min: 1, max: -1 } }, p).throttle.axis, 2, 'axis 12 does not exist');
  assert.equal(resolveProfile({ steer: { axis: 0, center: NaN, lock: 1 } }, p).steer.lock, 1);
  assert.deepEqual(wheelSettings({ range: 9, deadzone: -1, force: 'x', mode: 'nope' }), { ...WHEEL_DEFAULTS, range: 1, deadzone: 0 });
});

// ---- the input system with a wheel plugged in
function rig(id = IDS.g29, axes = [0, 1, 1, 1]) {
  const target = new EventTarget(), saved = new Map(), storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
  const wheel = pad(id, axes); let pads = [wheel], hidden = false;
  const input = new Input({ target, navigator: { getGamepads: () => pads }, storage, document: null });
  Object.defineProperty(input, 'document', { get: () => ({ get hidden() { return hidden; } }), set() {}, configurable: true });
  return { input, wheel, storage, saved, setPads: p => { pads = p; }, hide: v => { hidden = v; } };
}
test('a wheel drives: steering, separate throttle and brake axes, and the stick bindings are not read from it', () => {
  const { input, wheel } = rig();
  try {
    input.update(1 / 60); assert.equal(input.state.throttle, 0); assert.equal(input.state.brake, 0); assert.equal(input.state.steer, 0);
    assert.equal(input.wheelActive, true); assert.match(input.wheel.name, /Logitech G29/);
    assert.equal(input.actions.length, 0, 'pedals resting at +1 trigger no menu direction or action');
    wheel.axes[0] = 0.5; wheel.axes[2] = -1; wheel.axes[3] = 0; input.update(1 / 60);
    assert.ok(input.state.steer > 0.4 && input.state.steer < 0.5, String(input.state.steer)); assert.equal(input.state.throttle, 1); assert.ok(Math.abs(input.state.brake - 0.5) < 0.05);
    assert.equal(input.drivingSource, 'gamepad');
    wheel.axes[0] = -1; input.update(1 / 60); assert.ok(input.state.steer < -0.95);
    input.configure({ wheelRange: 0.5 }); wheel.axes[0] = 0.5; input.update(1 / 60); assert.ok(input.state.steer > 0.95, 'a half turn is full lock at 50% range');
  } finally { input.destroy(); }
});
test('a wheel steers a menu left and right, and the Controller mode OFF treats it as a plain pad', () => {
  const { input, wheel } = rig();
  try {
    wheel.axes[0] = 0.8; input.update(1 / 60, { inMenu: true }); assert.equal(input.state.right, true); input.update(1 / 60, { inMenu: true }); assert.equal(input.state.right, false, 'an edge, not a hold');
    wheel.axes[0] = 0; input.update(1 / 60, { inMenu: true });
    input.configure({ wheelMode: 'gamepad' }); input.update(1 / 60); assert.equal(input.wheelActive, false);
  } finally { input.destroy(); }
});
test('calibration through the input system saves per device and survives a reload; reset forgets it', () => {
  const r = rig(IDS.g29, [0, 1, 1, 1]);
  try {
    r.input.update(1 / 60); assert.equal(r.input.wheel.saved, false);
    r.wheel.axes = [0.2, 1, 1, 1]; r.input.update(1 / 60); assert.equal(r.input.startWheelCalibration(), true); r.input.update(1 / 60); r.wheel.axes = [1, 1, 1, 1]; r.input.update(1 / 60); r.wheel.axes = [-1, 1, 1, 1]; r.input.update(1 / 60); r.wheel.axes = [0.2, 1, 1, 1];
    assert.equal(r.input.nextWheelCalibration().ok, true);
    r.wheel.axes = [0.2, 1, -1, 1]; r.input.update(1 / 60); r.wheel.axes = [0.2, 1, 1, 1]; assert.equal(r.input.nextWheelCalibration().ok, true);
    r.wheel.axes = [0.2, 1, 1, -1]; r.input.update(1 / 60); r.wheel.axes = [0.2, 1, 1, 1]; const last = r.input.nextWheelCalibration(); assert.equal(last.done, true);
    r.input.update(1 / 60); assert.equal(r.input.wheel.saved, true); assert.equal(r.input.wheel.profile.steer.center, 0.2); assert.equal(r.input.wheelCal, null);
    const again = new Input({ target: new EventTarget(), navigator: { getGamepads: () => [r.wheel] }, storage: { getItem: k => r.saved.get(k), setItem: () => {} }, document: null });
    again.update(1 / 60); assert.equal(again.wheel.saved, true); assert.equal(again.wheel.profile.brake.axis, 3); again.destroy();
    assert.equal(r.input.resetWheelProfile(), true); assert.equal(r.input.wheel.saved, false);
  } finally { r.input.destroy(); }
});
test('mapping can be edited by hand: pick an axis, invert it', () => {
  const { input, wheel } = rig(IDS.t300, [0, 1, 1, 1]);
  try {
    input.update(1 / 60);
    assert.equal(input.setWheelMapping('throttle', { axis: 3 }), true); assert.equal(input.wheel.profile.throttle.axis, 3);
    assert.equal(input.setWheelMapping('throttle', { axis: 9 }), false, 'there is no axis 9 on this device');
    const before = input.wheel.profile.brake.min < input.wheel.profile.brake.max;
    input.setWheelMapping('brake', { invert: before }); assert.equal(input.wheel.profile.brake.min < input.wheel.profile.brake.max, !before);
    input.setWheelMapping('steer', { invert: true }); wheel.axes[0] = 1; input.update(1 / 60); assert.ok(input.state.steer < -0.9);
  } finally { input.destroy(); }
});
test('force feedback uses a rumble actuator when the browser offers one and does nothing otherwise', async () => {
  const played = [];
  const r = rig(); r.wheel.vibrationActuator = { playEffect: async (type, o) => { played.push([type, o]); } };
  try {
    r.input.update(1 / 60); assert.equal(r.input.wheel.canRumble, true);
    assert.equal(r.input.wheelFeedback(() => ({ frontSlip: 1.6, kerb: 0, speed: 30 }), 1000), true); await Promise.resolve();
    assert.equal(played.length, 1); assert.equal(played[0][0], 'dual-rumble'); assert.ok(played[0][1].strongMagnitude > 0.3);
    assert.equal(r.input.wheelFeedback(() => ({ frontSlip: 1.6, speed: 30 }), 1050), false, 'at most about 8 times a second');
    r.input.configure({ wheelForce: 0 }); assert.equal(r.input.wheelFeedback(() => ({ frontSlip: 1.6, speed: 30 }), 5000), false, 'off at 0%');
    r.input.configure({ wheelForce: 0.6 }); r.hide(true); assert.equal(r.input.wheelFeedback(() => ({ frontSlip: 1.6, speed: 30 }), 9000), false, 'not while the tab is hidden');
  } finally { r.input.destroy(); }
  const none = rig(); try { none.input.update(1 / 60); assert.equal(none.input.wheel.canRumble, false); assert.equal(none.input.wheelFeedback(() => ({ frontSlip: 2, speed: 30 }), 1000), false); } finally { none.input.destroy(); }
  const legacy = rig(); const pulses = []; legacy.wheel.hapticActuators = [{ pulse: async (v, ms) => { pulses.push([v, ms]); } }];
  try { legacy.input.update(1 / 60); assert.equal(legacy.input.wheelFeedback(() => ({ frontSlip: 1.6, speed: 30 }), 1000), true); await Promise.resolve(); assert.equal(pulses.length, 1); } finally { legacy.input.destroy(); }
});
test('rumble shaping: quiet while grip holds or the car is slow, growing past the limit and over kerbs', () => {
  assert.deepEqual(wheelRumble({ frontSlip: 2, speed: 1 }, 1), { strong: 0, weak: 0 });
  assert.equal(wheelRumble({ frontSlip: 0.4, kerb: 0, speed: 30 }, 1).strong, 0);
  const near = wheelRumble({ frontSlip: 1.1, speed: 30 }, 1), over = wheelRumble({ frontSlip: 1.8, speed: 30 }, 1);
  assert.ok(over.strong > near.strong && near.strong > 0);
  assert.ok(wheelRumble({ frontSlip: 0, kerb: 1, speed: 30 }, 1).weak > 0.3);
  assert.equal(wheelRumble({ frontSlip: 2, speed: 30 }, 0).strong, 0);
  assert.ok(wheelRumble({ frontSlip: 2, speed: 30 }, 0.3).strong < over.strong);
});
