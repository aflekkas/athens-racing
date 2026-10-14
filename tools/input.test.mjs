import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, axisValue, DEFAULT_BINDINGS } from '../src/input.js';

function setup() {
  const target = new EventTarget(), saved = new Map();
  const storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
  let pads = [];
  const input = new Input({ target, navigator: { getGamepads: () => pads }, storage, document: null });
  const key = (type, code, repeat = false, editing = false) => {
    const e = new Event(type, { cancelable: true }); Object.assign(e, { code, repeat });
    Object.defineProperty(e, 'target', { value: editing ? { closest: () => true } : target }); target.dispatchEvent(e); return e;
  };
  return { input, storage, target, key, pads: value => { pads = value; } };
}
const gamepad = () => ({ id: 'test standard', index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });

test('quick TC/ESC has its own keyboard binding and one edge per key or pad press', () => {
  const { input, key, pads } = setup(), pad = gamepad();
  try {
    assert.equal(Object.entries(DEFAULT_BINDINGS.keyboard).filter(([, codes]) => codes.includes('KeyV')).length, 1);
    key('keydown', 'KeyV'); key('keyup', 'KeyV'); input.update(1/60);
    assert.equal(input.state.tractionControl, true); assert.equal(input.state.tow, false);
    input.update(1/60); assert.equal(input.state.tractionControl, false);
    pads([pad]); pad.buttons[14].value = 1; input.update(1/60); assert.equal(input.state.tractionControl, true);
    for (let i=0;i<60;i++) { input.update(1/60); assert.equal(input.state.tractionControl, false); }
    pad.buttons[14].value = 0; input.update(1/60); pad.buttons[14].value = 1; input.update(1/60); assert.equal(input.state.tractionControl, true);
    key('keydown','KeyV',false,true); input.update(1/60); assert.equal(input.state.tractionControl,false,'editing never toggles');
  } finally { input.destroy(); }
});

test('standard pad analog pedals, steering deadzone/curve and camera axes', () => {
  const { input, pads } = setup(), pad = gamepad(); pads([pad]);
  pad.buttons[7].value = 0.7; pad.buttons[6].value = 0.25; pad.axes[0] = 0.14;
  input.update(1 / 60); assert.equal(input.state.throttle, 0.7); assert.equal(input.state.brake, 0.25); assert.equal(input.state.steer, 0);
  pad.axes[0] = -0.575; pad.axes[2] = 1; pad.axes[3] = -1; input.update(1 / 60);
  assert.ok(Math.abs(input.state.steer + 0.5) < 1e-12); assert.deepEqual(input.cameraLook, { x: 1, y: -1 });
  input.configure({ linearity: 2, sensitivity: 1.5 }); input.update(1 / 60); assert.ok(Math.abs(input.state.steer + 0.375) < 1e-12);
  assert.equal(axisValue(0.15), 0); assert.equal(axisValue(1), 1); assert.equal(axisValue(-1), -1); input.destroy();
});

test('keyboard pedals preserve their ramps while steering turns in, reverses and recentres', () => {
  for (const speed of [0, 22, 50]) {
    const { input, key } = setup(); let throttle = 0, brake = 0;
    for (let i = 0; i < 120; i++) {
      if (i === 0) { key('keydown', 'KeyD'); key('keydown', 'KeyW'); }
      if (i === 30) { key('keyup', 'KeyD'); key('keydown', 'KeyA'); }
      if (i === 60) { key('keyup', 'KeyA'); key('keyup', 'KeyW'); key('keydown', 'KeyS'); }
      if (i === 90) key('keyup', 'KeyS');
      const dt = 1 / 60;
      throttle = i < 60 ? Math.min(1, throttle + dt * (throttle < 0.6 ? 6 : 3)) : Math.max(0, throttle - dt * 10);
      brake = i >= 60 && i < 90 ? Math.min(1, brake + dt * (brake < 0.7 ? 7 : 3.5)) : Math.max(0, brake - dt * 12);
      input.update(dt, { speed }); assert.equal(input.state.throttle, throttle); assert.equal(input.state.brake, brake);
      if (i === 11) assert.equal(input.state.steer, 1, 'full lock by 200 ms');
      if (i === 47) assert.equal(input.state.steer, -1, 'opposite lock within 300 ms');
      if (i === 68) assert.equal(input.state.steer, 0, 'release centres within 150 ms');
    }
    input.destroy();
  }
});

test('keyboard and controller action edges fire once, including short key taps and reconnects', () => {
  const { input, key, pads, target } = setup(), pad = gamepad();
  key('keydown', 'KeyC'); key('keyup', 'KeyC'); input.update(1 / 60); assert.equal(input.state.camera, true);
  input.update(1 / 60); assert.equal(input.state.camera, false);
  key('keydown', 'Enter'); input.update(1 / 60); assert.equal(input.state.restart, true);
  key('keydown', 'Enter', true); input.update(1 / 60); assert.equal(input.state.restart, false);
  key('keyup', 'Enter'); input.update(1 / 60); pads([pad]); pad.buttons[9].value = 1;
  input.update(1 / 60); assert.equal(input.state.pause, true); input.update(1 / 60); assert.equal(input.state.pause, false);
  pad.buttons[9].value = 0; input.update(1 / 60); pad.buttons[9].value = 1; input.update(1 / 60); assert.equal(input.state.pause, true);
  pads([]); input.update(1 / 60); assert.equal(input.connected.size, 0); assert.equal(input.state.throttle, 0);
  pads([pad]); input.update(1 / 60); assert.equal(input.connected.size, 1);
  target.dispatchEvent(new Event('blur')); assert.equal(input.state.pause, false); input.destroy();
});

test('standard face buttons, shoulders, D-pad and held look-back expose the expected actions', () => {
  const { input, pads } = setup(), pad = gamepad(); pads([pad]); input.setNitrousEnabled(true);
  for (const [button, action] of [[0, 'handbrake'], [1, 'nitro'], [2, 'nitro'], [3, 'camera'], [4, 'shiftDown'], [5, 'shiftUp'], [8, 'restart'], [9, 'pause'], [11, 'lookBack'], [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']]) {
    pad.buttons[button].value = 1; input.update(1 / 60); assert.equal(input.state[action], true, action);
    input.update(1 / 60); if (['handbrake', 'nitro', 'lookBack'].includes(action)) assert.equal(input.state[action], true); else assert.equal(input.state[action], false);
    if (action === 'lookBack') assert.ok(!input.actions.includes('lookBack'));
    pad.buttons[button].value = 0; input.update(1 / 60);
  }
  pad.axes[0] = -0.8; input.update(1 / 60, { inMenu: true }); assert.equal(input.state.left, true); assert.equal(input.state.steer, 0);
  input.update(1 / 60, { inMenu: true }); assert.equal(input.state.left, false); input.destroy();
});

test('gamepad rebinding waits for neutral and does not dispatch the captured press', () => {
  const { input, pads, key } = setup(), pad = gamepad(); pads([pad]);
  input.capture = { kind: 'gamepad', action: 'restart', ready: false }; pad.buttons[0].value = 1;
  input.update(1 / 60); assert.deepEqual(input.bindings.gamepad.restart, ['b8']); assert.equal(input.actions.length, 0);
  pad.buttons[0].value = 0; input.update(1 / 60); pad.buttons[3].value = 1; input.update(1 / 60);
  assert.deepEqual(input.bindings.gamepad.restart, ['b3']); assert.equal(input.actions.length, 0);
  input.update(1 / 60); assert.equal(input.state.restart, false);
  pad.buttons[3].value = 0; input.update(1 / 60); pad.buttons[3].value = 1; input.update(1 / 60); assert.equal(input.state.restart, true);
  input.capture = { kind: 'gamepad', action: 'camera', ready: false }; key('keydown', 'Escape'); assert.equal(input.capture, null); input.destroy();
});

test('photo/replay edges preserve Space handbrake and menu confirm defaults', () => {
  const { input, key } = setup(); key('keydown', 'KeyP'); input.update(1 / 60); assert.ok(input.actions.includes('photo'));
  input.update(1 / 60); assert.equal(input.state.photo, false);
  key('keydown', 'Space'); input.update(1 / 60); assert.equal(input.state.handbrake, true); assert.equal(input.state.confirm, true); assert.equal(input.state.replayPlay, true);
  input.update(1 / 60); assert.equal(input.state.handbrake, true); assert.equal(input.state.replayPlay, false); input.destroy();
});

test('clearing drive input on pause does not retrigger held pad buttons or keyboard repeats', () => {
  const { input, pads, key } = setup(), pad = gamepad(); pads([pad]); pad.buttons[9].value = 1;
  input.update(1 / 60); assert.equal(input.state.pause, true); input.clear();
  input.update(1 / 60, { inMenu: true }); assert.equal(input.state.pause, false);
  pad.buttons[9].value = 0; input.update(1 / 60, { inMenu: true }); pad.buttons[9].value = 1; input.update(1 / 60, { inMenu: true }); assert.equal(input.state.pause, true);
  pads([]); input.clear(); key('keydown', 'KeyW'); input.update(1 / 60); input.clear(); key('keydown', 'KeyW', true); input.update(1 / 60); assert.equal(input.state.throttle, 0);
  key('keyup', 'KeyW'); key('keydown', 'KeyW'); input.update(1 / 60); assert.ok(input.state.throttle > 0); input.destroy();
});

test('bindings and tuning persist, defaults reset, invalid saved data is ignored', () => {
  const { input, storage, key } = setup();
  assert.equal(input.bind('keyboard', 'throttle', ['KeyZ']), true); input.bind('gamepad', 'nitro', ['b10']); input.configure({ deadzone: 0.2, linearity: 2 });
  const next = new Input({ target: null, navigator: null, storage, document: null });
  assert.deepEqual(next.bindings.keyboard.throttle, ['KeyZ']); assert.deepEqual(next.bindings.gamepad.nitro, ['b10']); assert.equal(next.settings.deadzone, 0.2);
  key('keydown', 'KeyW'); input.update(1 / 60); assert.equal(input.state.throttle, 0); key('keydown', 'KeyZ'); input.update(1 / 60); assert.ok(input.state.throttle > 0);
  next.resetBindings(); assert.deepEqual(next.bindings.keyboard.throttle, ['KeyW', 'ArrowUp']); assert.equal(next.settings.linearity, 1);
  storage.setItem('paraliaki.input.gamepad', '{invalid'); const recovered = new Input({ target: null, navigator: null, storage, document: null }); assert.deepEqual(recovered.bindings.gamepad.throttle, ['b7']);
  input.destroy(); next.destroy(); recovered.destroy();
});

test('menu/panel gating, focused forms and blur cannot leave driving latched', () => {
  const { input, key, pads, target } = setup(), pad = gamepad(); pads([pad]); pad.buttons[7].value = 1; pad.axes[0] = 1;
  key('keydown', 'KeyC', false, true); input.update(1 / 60, { inMenu: true }); assert.equal(input.state.camera, false); assert.equal(input.state.throttle, 0); assert.equal(input.state.steer, 0);
  pad.buttons[9].value = 1; input.update(1 / 60, { blocked: true }); assert.equal(input.actions.length, 0); assert.equal(input.state.pause, false);
  pads([]); key('keydown', 'KeyW'); input.update(1 / 60); target.dispatchEvent(new Event('blur')); input.update(1 / 60); assert.equal(input.state.throttle, 0); input.destroy();
});

test('rumble clamps dual-rumble impact values and tolerates unavailable devices', async () => {
  const { input, pads } = setup(), pad = gamepad(); let effect;
  pad.vibrationActuator = { playEffect: async (kind, opts) => { effect = { kind, ...opts }; } }; pads([pad]); input.update(0);
  assert.equal(await input.rumble(2, -1, 2000), true); assert.deepEqual(effect, { kind: 'dual-rumble', startDelay: 0, duration: 1000, strongMagnitude: 1, weakMagnitude: 0 });
  pad.vibrationActuator.playEffect = async () => { throw Error('unsupported'); }; assert.equal(await input.rumble(1, 1, 100), false); input.destroy();
});

test('nitrous controls are inactive until the selected car permits them', () => {
  const { input, pads, key } = setup(), pad = gamepad(); pads([pad]);
  key('keydown', 'ShiftLeft'); pad.buttons[1].value = 1;
  input.update(1 / 60); assert.equal(input.state.nitro, false);
  input.setNitrousEnabled(true); input.update(1 / 60); assert.equal(input.state.nitro, true);
  input.setNitrousEnabled(false); input.update(1 / 60); assert.equal(input.state.nitro, false);
  input.destroy();
});

test('M selects gearbox mode, J selects music, and E/Q remain edge-triggered shifts', () => {
  const { input, key } = setup();
  for (const [code, action] of [['KeyM', 'transmission'], ['KeyJ', 'music'], ['KeyE', 'shiftUp'], ['KeyQ', 'shiftDown']]) {
    key('keydown', code); input.update(1 / 60); assert.equal(input.state[action], true);
    if (code === 'KeyM') assert.equal(input.state.music, false);
    input.update(1 / 60); assert.equal(input.state[action], false);
    key('keyup', code); input.update(1 / 60);
  }
  input.destroy();
});


test('R tap tows once; R hold resets once without restarting or towing; Backspace resets', () => {
  const { input, key } = setup();
  key('keydown', 'KeyR'); input.update(.2); assert.equal(input.state.tow, false); assert.equal(input.state.restart, false);
  key('keyup', 'KeyR'); input.update(.01); assert.equal(input.state.tow, true);
  input.update(.01); assert.equal(input.state.tow, false);
  key('keydown', 'KeyR'); input.update(.5); input.update(.3); assert.equal(input.state.reset, true);
  input.update(.5); assert.equal(input.state.reset, false); key('keyup', 'KeyR'); input.update(.01); assert.equal(input.state.tow, false);
  key('keydown', 'Backspace'); key('keyup', 'Backspace'); input.update(.01); assert.equal(input.state.reset, true);
  input.update(.01); input.clear(); key('keydown', 'KeyR'); input.update(.5, { inMenu: true }); input.update(.5, { inMenu: true }); assert.equal(input.state.reset, false); input.destroy();
});
