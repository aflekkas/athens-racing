import { notifications } from './ui/notifications.js';
// Unified input. No rendering/physics dependencies; injectable browser APIs make mapping testable in Node.
import { settings as preferences, setSetting } from './settings.js';
import { WHEEL_DEFAULTS, WHEEL_LIMITS, WHEEL_MODES, isWheel, inferProfile, resolveProfile, wheelAxes, wheelSettings, WheelCalibration, deviceKey, deviceName, canRumble, playRumble, wheelRumble, axisCount } from './steering-wheel.js';
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));
const copy = x => JSON.parse(JSON.stringify(x));
export const DEFAULT_BINDINGS = {
  keyboard: {
    throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    handbrake: ['Space'], nitro: ['ShiftLeft', 'ShiftRight'], camera: ['KeyC'], cameraPosition: ['KeyP'], restart: ['Enter'], pause: ['Escape'],
    garage: ['KeyG'], shiftUp: ['KeyE'], shiftDown: ['KeyQ'], lookBack: ['KeyB'], tow: ['KeyR', 'KeyT'], reset: ['Backspace', 'KeyR'], transmission: ['KeyL'], tractionControl: ['KeyX'], map: ['KeyM'],
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], confirm: ['Enter', 'Space'], back: ['Escape', 'Backspace'],
  },
  gamepad: {
    throttle: ['b7'], brake: ['b6'], left: ['a0-'], right: ['a0+'], handbrake: ['b0'], nitro: ['b1', 'b2'], camera: ['b3'], cameraPosition: ['b8'],
    restart: [], pause: ['b9'], garage: [], shiftUp: ['b5'], shiftDown: ['b4'], lookBack: ['b11'], tow: [], reset: [], tractionControl: ['b14'], transmission: ['b10'], map: [],
    up: ['b12', 'a1-'], down: ['b13', 'a1+'], confirm: ['b0'], back: ['b1'],
    menuLeft: ['b14', 'a0-'], menuRight: ['b15', 'a0+'], lookLeft: ['a2-'], lookRight: ['a2+'], lookUp: ['a3-'], lookDown: ['a3+'],
  },
};
export const EDGE_ACTIONS = ['camera', 'cameraPosition', 'restart', 'pause', 'garage', 'shiftUp', 'shiftDown', 'lookBack', 'tow', 'reset', 'transmission', 'tractionControl', 'map',
  'up', 'down', 'left', 'right', 'confirm', 'back'];
// Racing wheel choices live beside the stick ones (wheelMode, wheelRange, wheelDeadzone, wheelLinearity, wheelPedalDeadzone, wheelForce);
// each wheel's calibrated axes are saved apart, per device.
const DEFAULT_SETTINGS = { deadzone: 0.15, sensitivity: 1, linearity: 1, wheelMode: WHEEL_DEFAULTS.mode, wheelRange: WHEEL_DEFAULTS.range, wheelDeadzone: WHEEL_DEFAULTS.deadzone, wheelLinearity: WHEEL_DEFAULTS.linearity, wheelPedalDeadzone: WHEEL_DEFAULTS.pedalDeadzone, wheelForce: WHEEL_DEFAULTS.force };
const WHEEL_SETTING_KEYS = { wheelMode: 'mode', wheelRange: 'range', wheelDeadzone: 'deadzone', wheelLinearity: 'linearity', wheelPedalDeadzone: 'pedalDeadzone', wheelForce: 'force' };
const editable = e => !!e.target?.closest?.('input, select, textarea, button, [contenteditable]');
export function axisValue(value, deadzone = 0.15, sensitivity = 1, linearity = 1) {
  const v = clamp(value, -1, 1), a = Math.abs(v);
  return a <= deadzone ? 0 : Math.sign(v) * clamp(Math.pow((a - deadzone) / (1 - deadzone), linearity) * sensitivity, 0, 1);
}
function padValue(pad, binding) {
  if (/^b\d+$/.test(binding)) { const b = pad.buttons?.[+binding.slice(1)]; return clamp(typeof b === 'number' ? b : b?.value ?? (b?.pressed ? 1 : 0), 0, 1); }
  const m = /^a(\d+)([+-])$/.exec(binding);
  return m ? clamp((pad.axes?.[+m[1]] || 0) * (m[2] === '+' ? 1 : -1), 0, 1) : 0;
}

export class Input {
  constructor({ target = globalThis.window, navigator = globalThis.navigator, storage, document = globalThis.document } = {}) {
    this.target = target; this.navigator = navigator; this.document = document;
    try { this.storage = storage ?? globalThis.localStorage; } catch {}
    this.bindings = copy(DEFAULT_BINDINGS); this.settings = { ...DEFAULT_SETTINGS };
    this.keys = new Set(); this.pending = new Set(); this.previous = {}; this.actions = [];
    this.state = { throttle: 0, brake: 0, steer: 0, steerRaw: 0, handbrake: false, nitro: false, lookBack: false,
      ...Object.fromEntries(EDGE_ACTIONS.map(a => [a, false])) };
    this.cameraLook = { x: 0, y: 0 }; this.connected = new Map(); this.listeners = [];
    this.nitrousEnabled = false; this.drivingSource = 'keyboard'; this.padSignature = ''; this.localRevision = 0; this.lastLocalRevision = 0;
    this.wheelProfiles = {}; this.wheel = null; this.wheelCal = null; this.wheelRumbleAt = 0;
    this.load();
    this.listen('keydown', e => this.keyDown(e)); this.listen('keyup', e => { if (e.code === 'KeyR' && this.keys.has('KeyR') && !this.inMenu && !this.resetHeld) this.pending.add('tow'); this.keys.delete(e.code); this.localRevision++; this.drivingSource = 'keyboard'; });
    this.listen('blur', () => this.clear());
    this.listen('gamepadconnected', e => this.connect(e.gamepad));
    this.listen('gamepaddisconnected', e => { this.connected.delete(e.gamepad.index); this.pad = null; if (this.wheelGuess) for (const k of Object.keys(this.wheelGuess)) if (k.startsWith(e.gamepad.index + ':')) delete this.wheelGuess[k]; });
    // A touchscreen laptop's synthesised mouse events must not look around: remember when a finger last touched.
    this.listen('pointerdown', e => {
      if (e.pointerType === 'touch') this.lastTouchAt = Date.now();
    });
    if (document) this.mountStyles();
  }
  setNitrousEnabled(enabled) {
    this.nitrousEnabled = enabled === true;
    if (!this.nitrousEnabled) this.state.nitro = false;
    for (const hint of this.document?.querySelectorAll?.('[data-nitrous]') || []) if (hint.hidden !== !this.nitrousEnabled) hint.hidden = !this.nitrousEnabled;
  }
  // Production polls the selected spec every frame, including car switches and menu resumes.
  setCarSpec(spec) {
    // Polled every frame, but it only touches the DOM (querySelectorAll) when the car's nitrous flag changed, and once a
    // second to catch hints rendered later by a menu.
    const nitrous = spec?.nitrous === true;
    if (nitrous === this._specNitrous && (this._specPoll = (this._specPoll || 0) + 1) < 60) return;
    this._specPoll = 0; this._specNitrous = nitrous;
    this.setNitrousEnabled(nitrous);
  }
  listen(name, cb) { this.target?.addEventListener(name, cb); this.listeners.push([name, cb]); }
  destroy() { this.releaseMouseLook(); this.document?.removeEventListener?.('pointerlockchange', this.lookLockChange); for (const [name, cb] of this.listeners) this.target?.removeEventListener(name, cb); for(const id of this.toastIds||[])notifications.dismiss(id);this.toastIds?.clear(); this.cancelCapture(); }
  load() {
    for (const kind of ['keyboard', 'gamepad']) {
      try {
        const saved = JSON.parse(this.storage?.getItem('paraliaki.input.' + kind) || 'null');
        // M selects gearbox mode; R taps tow and holds reset instead of restarting.
        if (kind === 'keyboard' && saved?.restart?.join(',') === 'KeyR,Enter') saved.restart = ['Enter'];
        // M is the big map now; migrate the old gearbox binding to L.
        if (kind === 'keyboard' && saved?.transmission?.join(',') === 'KeyM') saved.transmission = [...DEFAULT_BINDINGS.keyboard.transmission];
        // B looks back and X toggles TC / ESC now; a saved set that still has the old V (TC) and B (look back) follows the current defaults.
        if (kind === 'keyboard' && saved?.tractionControl?.join(',') === 'KeyV' && saved?.lookBack?.join(',') === 'KeyB') { saved.tractionControl = [...DEFAULT_BINDINGS.keyboard.tractionControl]; saved.lookBack = [...DEFAULT_BINDINGS.keyboard.lookBack]; }
        // B is hold-to-look-back now and P cycles the view position; a saved set with the previous shipped
        // defaults (B = position, V = look back) follows. Customised sets stay untouched.
        if (kind === 'keyboard' && saved?.cameraPosition?.join(',') === 'KeyB' && saved?.lookBack?.join(',') === 'KeyV') {
          const taken = new Set(Object.values(saved).flatMap(keys => Array.isArray(keys) ? keys : []));
          taken.delete('KeyB');
          const spare = ['KeyP', 'KeyN', 'KeyH'].find(key => !taken.has(key));
          saved.cameraPosition = spare ? [spare] : [];
          if (!Object.values(saved).some(keys => Array.isArray(keys) && keys.includes('KeyB'))) saved.lookBack = ['KeyB'];
        }
        // A set from before view-position cycling (saved V look-back, no cameraPosition) takes the new B
        // default when no custom action owns B.
        if (kind === 'keyboard' && saved?.lookBack?.join(',') === 'KeyV' && saved?.cameraPosition == null) {
          if (!Object.values(saved).some(keys => Array.isArray(keys) && keys.includes('KeyB'))) saved.lookBack = ['KeyB'];
        }
        // A custom camera on B keeps working alone: when lookBack only inherits the new B default, it takes
        // a free fallback (V first), or stays unbound when none is free, instead of doubling B's function.
        // Explicit double binds are left alone.
        if (kind === 'keyboard' && saved?.lookBack == null) {
          const bOwned = Object.entries(saved || {}).some(([a, keys]) => a !== 'lookBack' && Array.isArray(keys) && keys.includes('KeyB'));
          if (bOwned) {
            const taken = new Set(Object.values(saved).flatMap(keys => Array.isArray(keys) ? keys : []));
            const spare = ['KeyV', 'KeyN', 'KeyH'].find(key => !taken.has(key));
            saved.lookBack = spare ? [spare] : [];
          }
        }

        if (kind === 'keyboard' && saved && !saved.cameraPosition && Object.values(saved).some(keys => Array.isArray(keys) && keys.includes('KeyB')))
          saved.cameraPosition = [['KeyP', 'KeyN', 'KeyH'].find(key => !Object.values(saved).some(keys => Array.isArray(keys) && keys.includes(key))) || 'KeyP'];
        if (kind === 'gamepad' && saved?.restart?.join(',') === 'b8' && !saved.cameraPosition) saved.restart = [];
        if (kind === 'gamepad' && saved && !saved.cameraPosition && Object.entries(saved).some(([action, keys]) => action !== 'restart' && Array.isArray(keys) && keys.includes('b8'))) saved.cameraPosition = ['b16'];
        for (const [a, bs] of Object.entries(saved || {})) if (a in this.bindings[kind] && Array.isArray(bs) && bs.every(b => typeof b === 'string' && (kind === 'keyboard' ? /^[A-Za-z0-9]+$/.test(b) : /^(b\d+|a\d+[+-])$/.test(b)))) this.bindings[kind][a] = bs;
      } catch {}
    }
    try { this.configure(JSON.parse(this.storage?.getItem('paraliaki.input.settings') || 'null') || {}, false); } catch {}
    try { const saved = JSON.parse(this.storage?.getItem('paraliaki.input.wheel') || 'null'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) this.wheelProfiles = saved; } catch {}
  }
  save(key, value) { try { this.storage?.setItem('paraliaki.input.' + key, JSON.stringify(value)); } catch {} }
  configure(settings, persist = true) {
    for (const [key, lo, hi] of [['deadzone', 0, 0.45], ['sensitivity', 0.25, 2], ['linearity', 0.25, 3]]) if (Number.isFinite(+settings[key])) this.settings[key] = clamp(+settings[key], lo, hi);
    const wheel = wheelSettings(Object.fromEntries(Object.entries(WHEEL_SETTING_KEYS).map(([key, short]) => [short, key in settings ? settings[key] : this.settings[key]])));
    for (const [key, short] of Object.entries(WHEEL_SETTING_KEYS)) this.settings[key] = wheel[short];
    if (persist) this.save('settings', this.settings);
  }
  bind(kind, action, bindings) {
    if (!(action in this.bindings[kind]) || !bindings.every(b => kind === 'keyboard' ? /^[A-Za-z0-9]+$/.test(b) : /^(b\d+|a\d+[+-])$/.test(b))) return false;
    // These pairs must remain distinct even after rebinding: B never both cycles the view and looks back.
    const groups = [['transmission', 'map'], ['camera', 'cameraPosition'], ['camera', 'lookBack'], ['cameraPosition', 'lookBack']].filter(pair => pair.includes(action));
    if (groups.some(group => group.some(other => other !== action && bindings.some(key => this.bindings[kind][other].includes(key))))) return false;
    this.bindings[kind][action] = [...bindings]; this.save(kind, this.bindings[kind]); this.clear(); return true;
  }
  resetBindings() {
    this.bindings = copy(DEFAULT_BINDINGS); this.settings = { ...DEFAULT_SETTINGS };
    for (const kind of ['keyboard', 'gamepad']) this.save(kind, this.bindings[kind]);
    this.wheelProfiles = {}; this.wheelCal = null; this.saveWheelProfiles();
    this.save('settings', this.settings); this.cancelCapture(); this.clear();
  }
  keyDown(e) {
    if (this.capture && e.code === 'Escape') { e.preventDefault?.(); this.cancelCapture(); return; }
    if (this.capture?.kind === 'keyboard') {
      e.preventDefault?.(); e.stopPropagation?.();
      if (e.code === 'Escape') this.cancelCapture();
      else { const { action, done } = this.capture; this.capture = null; this.bind('keyboard', action, [e.code]); done?.(); }
      return;
    }
    const menuButton = this.inMenu && e.target?.closest?.('#ui') && e.target?.closest?.('button') && !e.target?.closest?.('.input-bindings');
    if ((editable(e) && !menuButton) || this.capture) return;
    const matched = Object.entries(this.bindings.keyboard).filter(([a, codes]) => (a !== 'nitro' || this.nitrousEnabled) && codes.includes(e.code));
    if (!matched.length) return;
    e.preventDefault?.(); e.stopPropagation?.();
    // A menu/blur may clear a held key; OS repeats must not press it again until a real release/press.
    if (e.repeat && !this.keys.has(e.code)) return;
    if (!e.repeat && !this.keys.has(e.code)) for (const [a] of matched) if (EDGE_ACTIONS.includes(a) && !(e.code === 'KeyR' && (a === 'reset' || a === 'tow'))) this.pending.add(a);
    this.keys.add(e.code); this.drivingSource = 'keyboard'; this.localRevision++;
  }
  clear() {
    // Preserve edge latches for a held controller button when pause/menu code clears driving.
    this.keys.clear(); this.pending.clear(); this.resetHoldT = 0; this.resetHeld = false;
    this.actions = [];
    this.keyThrottle = this.keyBrake = 0;
    Object.assign(this.state, { throttle: 0, brake: 0, steer: 0, steerRaw: 0, handbrake: false, nitro: false, lookBack: false });
    for (const a of EDGE_ACTIONS) this.state[a] = false;
    this.cameraLook.x = this.cameraLook.y = 0;
    if (this.lookDragging) { this.lookDragging = false; this.lookDragCb?.(false); }
    this.releaseMouseLook();
  }
  // Mouse look is opt-in. By default the mouse never moves the camera, so cursor movement while driving on the keyboard
  // cannot pan it: only holding the left or right button and dragging looks around, and the view returns when it is released.
  // With free look on (`free()`), raw movement looks around under pointer lock; if the lock is unavailable the left or right
  // button must be held, never the cursor's position. `drag(true|false)` reports the hold so the view can re-centre quickly.
  mountMouseLook(canvas, { enabled, free = () => false, move, drag, unlock }) {
    this.lookCanvas = canvas; this.lookEnabled = enabled; this.lookFree = free; this.lookDragCb = drag;
    const setDrag = on => { if (this.lookDragging === on) return; this.lookDragging = on; drag?.(on); };
    this.listen('mousedown', e => { if ((e.button === 0 || e.button === 2) && enabled() && e.target === canvas && !e.sourceCapabilities?.firesTouchEvents) setDrag(true); });
    for (const name of ['mouseup', 'blur']) this.listen(name, e => { if (name === 'blur' || e.button === 0 || e.button === 2) setDrag(false); });
    this.listen('pointercancel', () => setDrag(false));
    // The press-time context menu (Linux/GTK) must not cancel the drag it belongs to; a menu with no
    // button held still ends the hold. This keeps drag working on Mac (Arc/Chrome), Linux and Windows.
    this.listen('contextmenu', e => { if (!(e.buttons & 3)) setDrag(false); });
    this.listen('mousemove', e => {
      if (!enabled() || e.sourceCapabilities?.firesTouchEvents || editable(e)) return;
      if (Date.now() - (this.lastTouchAt || 0) < 1000) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (!dx && !dy) return;
      if (this.lookDragging && (e.buttons & 3)) { move(dx, dy); return; }
      if (this.lookDragging) setDrag(false);
      if (!free()) return;
      if (this.document?.pointerLockElement === canvas || (e.buttons & 3)) move(dx, dy);
    });
    this.lookLockChange = () => {
      const locked = this.document?.pointerLockElement === canvas;
      if (locked && !this.lookLockWanted) { this.mouseWasLocked = false; this.releaseMouseLook(); return; }
      if (this.mouseWasLocked && !locked && !this.lookReleaseExpected) unlock?.();
      this.mouseWasLocked = locked; this.lookReleaseExpected = false;
    };
    this.document?.addEventListener?.('pointerlockchange', this.lookLockChange);
  }
  requestMouseLock() {
    if (!this.lookCanvas || !this.lookFree?.() || this.lookRequestPending || this.document?.pointerLockElement === this.lookCanvas || this.navigator?.userActivation?.isActive === false) return;
    try {
      this.lookLockWanted = true; this.lookRequestPending = true;
      const request = this.lookCanvas.requestPointerLock?.();
      if (request?.then) request.then(() => { this.lookRequestPending = false; if (!this.lookLockWanted) this.releaseMouseLook(); }, () => { this.lookRequestPending = false; });
      else this.lookRequestPending = false;
    } catch { this.lookRequestPending = false; }
  }
  releaseMouseLook() {
    this.lookLockWanted = false;
    if (this.lookCanvas && this.document?.pointerLockElement === this.lookCanvas) { this.lookReleaseExpected = true; this.document.exitPointerLock?.(); }
  }
  connect(pad) {
    if (!pad || this.connected.get(pad.index) === pad.id) return;
    this.connected.set(pad.index, pad.id); this.toast('Controller connected');
  }
  toast(message, options = {}) {
    this.toastIds ||= new Set();this.toastIds.add(notifications.toast(message,{priority:options.tone==='bad'?75:40,...options}));
  }
  updateToast() { notifications.update(); }
  update(dt, { speed = 0, inMenu = false, blocked = false, retainMouseLock = false } = {}) {
    this.inMenu = inMenu; this.blocked = blocked; this.updateToast();
    const capturing = !!this.capture;
    dt = clamp(dt, 0, 0.5);
    let pads = [];
    try { pads = Array.from(this.navigator?.getGamepads?.() || []).filter(p => p && p.connected !== false); } catch {}
    for (const pad of pads) this.connect(pad);
    for (const index of this.connected.keys()) if (!pads.some(p => p.index === index)) this.connected.delete(index);
    this.pad = pads.find(p => p.buttons?.some(b => (b.value || 0) > 0.05) || p.axes?.some(a => Math.abs(a) > this.settings.deadzone)) || pads[0];
    // A racing wheel is a gamepad whose axes are the wheel and the pedals: those come from its calibrated profile, never from
    // the stick bindings (a pedal resting at -1 would otherwise hold a menu direction), while its buttons bind as usual.
    const wheelPad = pads.find(p => isWheel(p, this.settings.wheelMode)) || null;
    this.updateWheel(wheelPad);
    const wheelAxesNow = this.wheel?.values || { steer: 0, throttle: 0, brake: 0 };
    const gp = a => Math.max(0, ...(this.bindings.gamepad[a] || []).flatMap(b => pads.map(p => p === wheelPad && b[0] === 'a' ? 0 : padValue(p, b))));
    if (this.capture?.kind === 'gamepad') {
      const active = pads.flatMap(p => [...(p.buttons || []).map((b, i) => (b.value ?? +b.pressed) > 0.6 ? 'b' + i : null), ...(p.axes || []).map((a, i) => Math.abs(a) > 0.65 ? 'a' + i + (a > 0 ? '+' : '-') : null)]).filter(Boolean);
      if (!active.length) this.capture.ready = true;
      else if (this.capture.ready) { const { action, done } = this.capture; this.capture = null; this.bind('gamepad', action, [active[0]]); done?.(); }
    }
    const k = a => (this.bindings.keyboard[a] || []).some(c => this.keys.has(c));
    const localHeld = a => (this.bindings.keyboard[a] || []).some(c => this.keys.has(c) && !(c === 'KeyR' && (a === 'reset' || a === 'tow'))) || gp(a) > 0.55;
    // Only changes claim an active input source.
    if (this.localRevision !== this.lastLocalRevision) { this.lastLocalRevision = this.localRevision; this.drivingSource = 'keyboard'; }
    const padValues = ['throttle','brake','left','right','handbrake',...EDGE_ACTIONS].map(a => Math.round((a === 'left' || a === 'right' ? axisValue(gp(a),this.settings.deadzone) : gp(a)) * 100));
    if (wheelPad) padValues.push(Math.round(wheelAxesNow.steer * 100), Math.round(wheelAxesNow.throttle * 100), Math.round(wheelAxesNow.brake * 100));
    const padSignature = JSON.stringify(padValues);
    if (padSignature !== this.padSignature && (this.padSignature || padValues.some(Boolean))) this.drivingSource = 'gamepad';
    this.padSignature = padSignature;
    const held = localHeld;
    if (!inMenu && !blocked && !capturing && this.keys.has('KeyR')) {
      this.resetHoldT = (this.resetHoldT || 0) + dt;
      if (this.resetHoldT >= 0.75 && !this.resetHeld) { this.pending.add('reset'); this.resetHeld = true; }
    } else { this.resetHoldT = 0; this.resetHeld = false; }
    for (const a of EDGE_ACTIONS) {
      const down = a === 'left' || a === 'right' ? k(a) || gp('menu' + (a === 'left' ? 'Left' : 'Right')) > 0.55 || (inMenu && wheelAxesNow.steer * (a === 'left' ? -1 : 1) > 0.6) : held(a);
      this.state[a] = !capturing && !blocked && (this.pending.has(a) || (down && !this.previous[a]));
      this.previous[a] = down;
    }
    this.pending.clear(); this.actions = EDGE_ACTIONS.filter(a => this.state[a]);
    // Pedal ramps are independent of the steering ramp; analog devices bypass both.
    const s = this.state, up = k('throttle'), dn = k('brake'), lf = k('left'), rt = k('right');
    this.keyThrottle = up ? Math.min(1, (this.keyThrottle || 0) + dt * ((this.keyThrottle || 0) < 0.6 ? 6 : 3)) : Math.max(0, (this.keyThrottle || 0) - dt * 10);
    this.keyBrake = dn ? Math.min(1, (this.keyBrake || 0) + dt * ((this.keyBrake || 0) < 0.7 ? 7 : 3.5)) : Math.max(0, (this.keyBrake || 0) - dt * 12);
    const target = (rt ? 1 : 0) - (lf ? 1 : 0), base = 1 / (1 + Math.abs(speed) / 22);
    // Full keyboard lock should arrive in ~0.18 s at road speeds. The former
    // slow ramp followed by a 1.4 power curve swallowed short turn-in taps.
    const rate = target === 0 ? 8 : s.steerRaw !== 0 && Math.sign(target) !== Math.sign(s.steerRaw) ? 10 : 5 + 2 * base;
    s.steerRaw += clamp(target - s.steerRaw, -rate * dt, rate * dt);
    const stick = axisValue(gp('right') - gp('left'), this.settings.deadzone, this.settings.sensitivity, this.settings.linearity);
    const analog = Math.abs(wheelAxesNow.steer) > Math.abs(stick) ? wheelAxesNow.steer : stick;
    const padThrottle = Math.max(gp('throttle'), wheelAxesNow.throttle), padBrake = Math.max(gp('brake'), wheelAxesNow.brake);
    const keyboardSteer = Math.sign(s.steerRaw) * Math.pow(Math.abs(s.steerRaw), 1.1);
    s.steer = lf || rt || Math.abs(keyboardSteer) > Math.abs(analog) ? keyboardSteer : analog;
    s.throttle = Math.max(this.keyThrottle, padThrottle);
    s.brake = Math.max(this.keyBrake, padBrake);
    s.handbrake = held('handbrake'); s.nitro = this.nitrousEnabled && held('nitro'); s.lookBack = held('lookBack');
    if (this.drivingSource === 'keyboard') { s.steer = keyboardSteer; s.throttle = this.keyThrottle; s.brake = this.keyBrake; s.handbrake = k('handbrake'); s.nitro = this.nitrousEnabled && k('nitro'); s.lookBack = k('lookBack'); }
    if (this.drivingSource === 'gamepad') { s.steer = analog; s.throttle = padThrottle; s.brake = padBrake; s.handbrake = gp('handbrake') > .55; s.nitro = this.nitrousEnabled && gp('nitro') > .55; s.lookBack = gp('lookBack') > .55; }
    this.cameraLook.x = axisValue(gp('lookRight') - gp('lookLeft'), this.settings.deadzone);
    this.cameraLook.y = axisValue(gp('lookDown') - gp('lookUp'), this.settings.deadzone);
    if (blocked || inMenu || capturing) {
      s.throttle = s.brake = s.steer = s.steerRaw = this.keyThrottle = this.keyBrake = 0; s.handbrake = s.nitro = s.lookBack = false;
      this.cameraLook.x = this.cameraLook.y = 0;
      if (!retainMouseLock) this.releaseMouseLook();
    }
    return s;
  }
  // ---- racing wheel: the device in front of us, its calibration, and force feedback (src/steering-wheel.js)
  updateWheel(pad) {
    if (!pad) { this.wheel = null; if (this.wheelCal) this.wheelCal = null; return; }
    // the first guess is taken when the device appears (pedals at rest), then kept: pressing a pedal must not change the mapping
    const key = deviceKey(pad), guess = (this.wheelGuess ||= {})[pad.index + ':' + key] ||= inferProfile(pad), profile = resolveProfile(this.wheelProfiles[key], pad, guess);
    this.wheel = { pad, key, name: deviceName(pad), profile, saved: !!this.wheelProfiles[key], axisCount: axisCount(pad), canRumble: canRumble(pad), values: wheelAxes(pad, profile, { ...WHEEL_DEFAULTS, range: this.settings.wheelRange, deadzone: this.settings.wheelDeadzone, linearity: this.settings.wheelLinearity, pedalDeadzone: this.settings.wheelPedalDeadzone }) };
    this.wheelCal?.feed(pad);
  }
  get wheelActive() { return !!this.wheel; }
  saveWheelProfiles() { this.save('wheel', this.wheelProfiles); }
  /** steps of the guided calibration: turn the wheel, press each pedal. Returns false without a wheel. */
  startWheelCalibration() { if (!this.wheel) return false; this.wheelCal = new WheelCalibration(this.wheel.pad); return true; }
  cancelWheelCalibration() { this.wheelCal = null; }
  /** finish the open step; after the last one the result is saved for this device. { ok, done, error } */
  nextWheelCalibration() {
    const cal = this.wheelCal; if (!cal || !this.wheel) return { ok: false, done: false, error: 'NO WHEEL' };
    const ok = cal.next(this.wheel.pad);
    if (!ok) return { ok: false, done: false, error: cal.error };
    if (cal.done) { this.wheelProfiles[this.wheel.key] = cal.profile(); this.saveWheelProfiles(); this.wheelCal = null; this.updateWheel(this.wheel.pad); return { ok: true, done: true, error: '' }; }
    return { ok: true, done: false, error: '' };
  }
  /** change one thing about this wheel's mapping: role 'steer' | 'throttle' | 'brake', patch e.g. { axis: 2 } or { invert: true } */
  setWheelMapping(role, patch) {
    if (!this.wheel || !['steer', 'throttle', 'brake'].includes(role)) return false;
    const pad = this.wheel.pad, base = JSON.parse(JSON.stringify(this.wheel.profile)), cur = base[role] || (role === 'steer' ? { axis: 0, center: 0, lock: 1, invert: false } : { axis: 1, min: 1, max: -1 });
    if (patch.axis !== undefined) {
      if (!Number.isInteger(patch.axis) || patch.axis < 0 || patch.axis >= axisCount(pad)) return false;
      cur.axis = patch.axis; const rest = pad.axes[patch.axis] || 0;
      // a new axis starts from how it reads now (released / centred), spanning the usual full travel
      if (role === 'steer') { cur.center = rest; cur.lock = 1; } else { cur.min = rest; cur.max = Math.abs(rest) > 0.9 ? -rest : 1; }
    }
    if (patch.invert !== undefined) {
      if (role === 'steer') cur.invert = !!patch.invert;
      else if ((cur.max < cur.min) !== !!patch.invert) [cur.min, cur.max] = [cur.max, cur.min];
    }
    base[role] = cur; delete base.combined;
    if (role !== 'steer' && !base.throttle) base.throttle = { axis: cur.axis, min: cur.min, max: cur.max };
    this.wheelProfiles[this.wheel.key] = base; this.saveWheelProfiles(); this.updateWheel(pad); return true;
  }
  resetWheelProfile() { if (!this.wheel) return false; delete this.wheelProfiles[this.wheel.key]; this.saveWheelProfiles(); this.wheelCal = null; this.updateWheel(this.wheel.pad); return true; }
  /** Force feedback, at most ~8 times a second, from `telemetry()` (called only when due): see wheelRumble */
  wheelFeedback(telemetry, now = Date.now()) {
    if (!this.wheel?.canRumble || this.settings.wheelForce <= 0 || this.document?.hidden || now - this.wheelRumbleAt < 120) return false;
    this.wheelRumbleAt = now;
    void playRumble(this.wheel.pad, wheelRumble(telemetry(), this.settings.wheelForce), 160);
    return true;
  }
  async rumble(strong = 0, weak = 0, ms = 100) {
    const actuator = this.pad?.vibrationActuator;
    if (!actuator?.playEffect || this.document?.hidden) return false;
    try { await actuator.playEffect('dual-rumble', { startDelay: 0, duration: clamp(ms, 0, 1000), strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }); return true; } catch { return false; }
  }
  cancelCapture() { const done = this.capture?.done; this.capture = null; done?.(); }
  openBindings(containerEl) {
    this.cancelCapture(); this.clear();
    const doc = containerEl.ownerDocument, panel = doc.createElement('div'); panel.className = 'input-bindings';
    const help = doc.createElement('p'); help.textContent = 'Choose a binding, then press a key or controller button / move an axis. Escape cancels. E / Q selects manual and shifts. M returns to auto.'; panel.append(help);
    const cameraTitle = doc.createElement('h3'); cameraTitle.textContent = 'CAMERA & PLAYER TAGS'; panel.append(cameraTitle);
    for (const [key, label, min, max, step] of [['mouseSensitivity', 'Look sensitivity', 0.25, 3, 0.05], ['chaseFov', 'Chase FOV (vertical degrees)', 45, 75, 1], ['cockpitFov', 'Cockpit FOV (vertical degrees)', 45, 90, 1]]) {
      const row = doc.createElement('label'), slider = doc.createElement('input'), value = doc.createElement('output'); row.textContent = label;
      slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = preferences[key]; value.textContent = slider.value;
      slider.dataset.preference = key; slider.setAttribute('aria-label', label);
      slider.addEventListener('input', () => { setSetting(key, +slider.value); value.textContent = slider.value; }); row.append(slider, value); panel.append(row);
    }
    for (const [key, label] of [['invertLookY', 'Invert look Y'], ['speedFov', 'Subtle speed FOV (+3° maximum)'], ['playerMarkers', 'Online player tags & edge arrows'], ['rivalMarkers', 'AI rival tags']]) {
      const row = doc.createElement('label'), toggle = doc.createElement('input'); row.textContent = label; toggle.type = 'checkbox'; toggle.checked = preferences[key]; toggle.dataset.preference = key;
      toggle.addEventListener('change', () => setSetting(key, toggle.checked)); row.append(toggle); panel.append(row);
    }
    const lookHelp = doc.createElement('p'); lookHelp.textContent = 'Move the mouse to look around while racing. If pointer lock is unavailable, cursor position controls the view. Right stick also looks; the view centres after 1.5 seconds idle.'; panel.append(lookHelp);
    for (const [key, label, min, max, step] of [['deadzone', 'Stick deadzone', 0, 0.45, 0.01], ['sensitivity', 'Steering sensitivity', 0.25, 2, 0.05], ['linearity', 'Steering curve (1 = linear)', 0.25, 3, 0.05]]) {
      const row = doc.createElement('label'), slider = doc.createElement('input'), value = doc.createElement('output'); row.textContent = label;
      slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = this.settings[key]; value.textContent = slider.value;
      slider.addEventListener('input', () => { this.configure({ [key]: +slider.value }); value.textContent = slider.value; }); row.append(slider, value); panel.append(row);
    }
    const table = doc.createElement('table');
    const head = doc.createElement('tr'); for (const title of ['Action', 'Keyboard', 'Controller']) { const th = doc.createElement('th'); th.textContent = title; head.append(th); } table.append(head);
    const rows = [...new Set([...Object.keys(this.bindings.keyboard), ...Object.keys(this.bindings.gamepad)])].filter(a => a !== 'nitro' || this.nitrousEnabled);
    for (const action of rows) {
      const row = doc.createElement('tr'), label = doc.createElement('td'); label.textContent = action.replace(/([A-Z])/g, ' $1'); row.append(label);
      for (const kind of ['keyboard', 'gamepad']) {
        const cell = doc.createElement('td');
        if (action in this.bindings[kind]) {
          const button = doc.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', 'Rebind ' + action + ' ' + kind);
          const render = () => { button.textContent = this.bindings[kind][action].join(' / ') || 'Unbound'; };
          render(); button.addEventListener('click', () => { this.cancelCapture(); this.clear(); this.capture = { kind, action, ready: false, done: render }; button.textContent = 'Press ' + (kind === 'keyboard' ? 'a key…' : 'a button / axis…'); }); cell.append(button);
        }
        row.append(cell);
      }
      table.append(row);
    }
    panel.append(table);
    const reset = doc.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset controls to defaults'; reset.addEventListener('click', () => { this.resetBindings(); this.openBindings(containerEl); }); panel.append(reset);
    containerEl.replaceChildren(panel); return panel;
  }
  // The shared styles of the input toast and the key-binding panel (src/input.css).
  mountStyles() {
    const doc = this.document;
    if (!doc.body) { doc.addEventListener('DOMContentLoaded', () => this.mountStyles(), { once: true }); return; }
    if (!doc.getElementById('input-css')) { const link = doc.createElement('link'); link.id = 'input-css'; link.rel = 'stylesheet'; link.href = new URL('./input.css', import.meta.url).href; doc.head.append(link); }
  }
}
export const input = new Input();
export const cameraLook = input.cameraLook;
export default input;
