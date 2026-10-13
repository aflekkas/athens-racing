// Unified input. No rendering/physics dependencies; injectable browser APIs make mapping testable in Node.
import { settings as preferences, setSetting } from './settings.js';
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));
const copy = x => JSON.parse(JSON.stringify(x));
export const DEFAULT_BINDINGS = {
  keyboard: {
    throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    handbrake: ['Space'], nitro: ['ShiftLeft', 'ShiftRight'], camera: ['KeyC'], restart: ['KeyR', 'Enter'], pause: ['Escape'],
    garage: ['KeyG'], shiftUp: ['KeyE'], shiftDown: ['KeyQ'], lookBack: ['KeyB'], tow: ['KeyT'], transmission: ['KeyM'], music: ['KeyJ'], nextTrack: ['KeyN'],
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], confirm: ['Enter', 'Space'], back: ['Escape', 'Backspace'], photo: ['KeyP'], replayPlay: ['Space'],
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['car' + (i + 1), ['Digit' + (i + 1)]])),
  },
  gamepad: {
    throttle: ['b7'], brake: ['b6'], left: ['a0-'], right: ['a0+'], handbrake: ['b0'], nitro: ['b1', 'b2'], camera: ['b3'],
    restart: ['b8'], pause: ['b9'], garage: [], shiftUp: ['b5'], shiftDown: ['b4'], lookBack: ['b11'], tow: [], music: [], nextTrack: [],
    up: ['b12', 'a1-'], down: ['b13', 'a1+'], confirm: ['b0'], back: ['b1'], photo: ['b10'], replayPlay: ['b0'],
    menuLeft: ['b14', 'a0-'], menuRight: ['b15', 'a0+'], lookLeft: ['a2-'], lookRight: ['a2+'], lookUp: ['a3-'], lookDown: ['a3+'],
  },
};
export const EDGE_ACTIONS = ['camera', 'restart', 'pause', 'garage', 'shiftUp', 'shiftDown', 'lookBack', 'tow', 'transmission', 'music', 'nextTrack', 'photo', 'replayPlay',
  'up', 'down', 'left', 'right', 'confirm', 'back', ...Array.from({ length: 9 }, (_, i) => 'car' + (i + 1))];
const DEFAULT_SETTINGS = { deadzone: 0.15, sensitivity: 1, linearity: 1, touchSteering: 'screen' };
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
    this.cameraLook = { x: 0, y: 0 }; this.touch = {}; this.connected = new Map(); this.listeners = [];
    this.nitrousEnabled = false;
    this.load();
    this.listen('keydown', e => this.keyDown(e)); this.listen('keyup', e => this.keys.delete(e.code));
    this.listen('blur', () => this.clear());
    this.listen('gamepadconnected', e => this.connect(e.gamepad));
    this.listen('gamepaddisconnected', e => { this.connected.delete(e.gamepad.index); this.pad = null; });
    this.listen('deviceorientation', e => { if (Number.isFinite(e.gamma)) this.tilt = clamp(e.gamma / 30, -1, 1); });
    if (document) this.mountTouch();
  }
  setNitrousEnabled(enabled) {
    this.nitrousEnabled = enabled === true;
    if (!this.nitrousEnabled) this.state.nitro = false;
    const button = this.touchUI?.querySelector('[data-action="nitro"]');
    if (button) button.hidden = !this.nitrousEnabled;
    for (const hint of this.document?.querySelectorAll?.('[data-nitrous]') || []) hint.hidden = !this.nitrousEnabled;
  }
  listen(name, cb) { this.target?.addEventListener(name, cb); this.listeners.push([name, cb]); }
  destroy() { this.releaseMouseLook(); this.document?.removeEventListener?.('pointerlockchange', this.lookLockChange); for (const [name, cb] of this.listeners) this.target?.removeEventListener(name, cb); clearTimeout(this.toastTimer); this.touchUI?.remove(); this.cancelCapture(); }
  load() {
    for (const kind of ['keyboard', 'gamepad']) {
      try {
        const saved = JSON.parse(this.storage?.getItem('paraliaki.input.' + kind) || 'null');
        // M now selects gearbox mode; migrate the old default music binding to J.
        if (kind === 'keyboard' && !saved?.transmission && saved?.music?.length === 1 && saved.music[0] === 'KeyM') saved.music = ['KeyJ'];
        for (const [a, bs] of Object.entries(saved || {})) if (a in this.bindings[kind] && Array.isArray(bs) && bs.every(b => typeof b === 'string' && (kind === 'keyboard' ? /^[A-Za-z0-9]+$/.test(b) : /^(b\d+|a\d+[+-])$/.test(b)))) this.bindings[kind][a] = bs;
      } catch {}
    }
    try { this.configure(JSON.parse(this.storage?.getItem('paraliaki.input.settings') || 'null') || {}, false); } catch {}
  }
  save(key, value) { try { this.storage?.setItem('paraliaki.input.' + key, JSON.stringify(value)); } catch {} }
  configure(settings, persist = true) {
    for (const [key, lo, hi] of [['deadzone', 0, 0.45], ['sensitivity', 0.25, 2], ['linearity', 0.25, 3]]) if (Number.isFinite(+settings[key])) this.settings[key] = clamp(+settings[key], lo, hi);
    if (['screen', 'tilt'].includes(settings.touchSteering)) this.settings.touchSteering = settings.touchSteering;
    if (persist) this.save('settings', this.settings);
  }
  bind(kind, action, bindings) {
    if (!(action in this.bindings[kind]) || !bindings.every(b => kind === 'keyboard' ? /^[A-Za-z0-9]+$/.test(b) : /^(b\d+|a\d+[+-])$/.test(b))) return false;
    this.bindings[kind][action] = [...bindings]; this.save(kind, this.bindings[kind]); this.clear(); return true;
  }
  resetBindings() {
    this.bindings = copy(DEFAULT_BINDINGS); this.settings = { ...DEFAULT_SETTINGS };
    for (const kind of ['keyboard', 'gamepad']) this.save(kind, this.bindings[kind]);
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
    const menuButton = this.inMenu && e.target?.closest?.('button') && !e.target?.closest?.('.input-bindings');
    if ((editable(e) && !menuButton) || this.capture) return;
    const matched = Object.entries(this.bindings.keyboard).filter(([a, codes]) => (a !== 'nitro' || this.nitrousEnabled) && codes.includes(e.code));
    if (!matched.length) return;
    e.preventDefault?.();
    // A menu/blur may clear a held key; OS repeats must not press it again until a real release/press.
    if (e.repeat && !this.keys.has(e.code)) return;
    if (!e.repeat && !this.keys.has(e.code)) for (const [a] of matched) if (EDGE_ACTIONS.includes(a)) this.pending.add(a);
    this.keys.add(e.code);
  }
  clear() {
    // Preserve edge latches for a held controller button when pause/menu code clears driving.
    this.keys.clear(); this.pending.clear(); this.touch = {};
    this.actions = [];
    this.keyThrottle = this.keyBrake = 0;
    Object.assign(this.state, { throttle: 0, brake: 0, steer: 0, steerRaw: 0, handbrake: false, nitro: false, lookBack: false });
    for (const a of EDGE_ACTIONS) this.state[a] = false;
    this.cameraLook.x = this.cameraLook.y = 0;
    this.releaseMouseLook();
  }
  // Race gestures request lock; denied/unavailable lock falls back to cursor position, without clicks.
  mountMouseLook(canvas, { enabled, move, position, unlock }) {
    this.lookCanvas = canvas; this.lookEnabled = enabled;
    this.listen('mousemove', e => {
      if (!enabled() || e.sourceCapabilities?.firesTouchEvents || editable(e)) return;
      if (this.document?.pointerLockElement === canvas) {
        if (e.movementX || e.movementY) move(e.movementX || 0, e.movementY || 0);
      } else {
        const width = this.target?.innerWidth || canvas.clientWidth || 1, height = this.target?.innerHeight || canvas.clientHeight || 1;
        position?.(clamp((e.clientX - width / 2) / (width / 2), -1, 1), clamp((e.clientY - height / 2) / (height / 2), -1, 1));
      }
    });
    this.lookLockChange = () => {
      const locked = this.document?.pointerLockElement === canvas;
      if (this.mouseWasLocked && !locked && !this.lookReleaseExpected) unlock?.();
      this.mouseWasLocked = locked; this.lookReleaseExpected = false;
    };
    this.document?.addEventListener?.('pointerlockchange', this.lookLockChange);
  }
  requestMouseLock() {
    if (!this.lookCanvas || this.lookRequestPending || this.document?.pointerLockElement === this.lookCanvas || this.navigator?.userActivation?.isActive === false) return;
    try {
      this.lookRequestPending = true;
      const request = this.lookCanvas.requestPointerLock?.();
      if (request?.then) request.then(() => { this.lookRequestPending = false; }, () => { this.lookRequestPending = false; });
      else this.lookRequestPending = false;
    } catch { this.lookRequestPending = false; }
  }
  releaseMouseLook() {
    if (this.lookCanvas && this.document?.pointerLockElement === this.lookCanvas) { this.lookReleaseExpected = true; this.document.exitPointerLock?.(); }
  }
  connect(pad) {
    if (!pad || this.connected.get(pad.index) === pad.id) return;
    this.connected.set(pad.index, pad.id); this.toast('Controller connected');
  }
  toast(message) {
    if (!this.document?.body) return;
    let el = this.document.getElementById('input-toast');
    if (!el) { el = this.document.createElement('div'); el.id = 'input-toast'; el.setAttribute('role', 'status'); this.document.body.append(el); }
    el.textContent = message; el.hidden = false; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
  }
  update(dt, { speed = 0, inMenu = false, blocked = false, retainMouseLock = false } = {}) {
    this.inMenu = inMenu;
    const capturing = !!this.capture;
    dt = clamp(dt, 0, 0.5);
    let pads = [];
    try { pads = Array.from(this.navigator?.getGamepads?.() || []).filter(p => p && p.connected !== false); } catch {}
    for (const pad of pads) this.connect(pad);
    for (const index of this.connected.keys()) if (!pads.some(p => p.index === index)) this.connected.delete(index);
    this.pad = pads.find(p => p.buttons?.some(b => (b.value || 0) > 0.05) || p.axes?.some(a => Math.abs(a) > this.settings.deadzone)) || pads[0];
    const gp = a => Math.max(0, ...(this.bindings.gamepad[a] || []).flatMap(b => pads.map(p => padValue(p, b))));
    if (this.capture?.kind === 'gamepad') {
      const active = pads.flatMap(p => [...(p.buttons || []).map((b, i) => (b.value ?? +b.pressed) > 0.6 ? 'b' + i : null), ...(p.axes || []).map((a, i) => Math.abs(a) > 0.65 ? 'a' + i + (a > 0 ? '+' : '-') : null)]).filter(Boolean);
      if (!active.length) this.capture.ready = true;
      else if (this.capture.ready) { const { action, done } = this.capture; this.capture = null; this.bind('gamepad', action, [active[0]]); done?.(); }
    }
    const k = a => (this.bindings.keyboard[a] || []).some(c => this.keys.has(c));
    const held = a => k(a) || gp(a) > 0.55 || !!this.touch[a];
    for (const a of EDGE_ACTIONS) {
      const down = a === 'left' || a === 'right' ? k(a) || gp('menu' + (a === 'left' ? 'Left' : 'Right')) > 0.55 : held(a);
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
    const analog = axisValue(gp('right') - gp('left'), this.settings.deadzone, this.settings.sensitivity, this.settings.linearity);
    const touchSteer = this.settings.touchSteering === 'tilt' && Number.isFinite(this.tilt) ? this.tilt : this.touch.steer || 0;
    const keyboardSteer = Math.sign(s.steerRaw) * Math.pow(Math.abs(s.steerRaw), 1.1);
    s.steer = lf || rt || Math.abs(keyboardSteer) > Math.max(Math.abs(analog), Math.abs(touchSteer)) ? keyboardSteer : Math.abs(touchSteer) > Math.abs(analog) ? touchSteer : analog;
    s.throttle = Math.max(this.keyThrottle, gp('throttle'), this.touch.throttle || 0);
    s.brake = Math.max(this.keyBrake, gp('brake'), this.touch.brake || 0);
    s.handbrake = held('handbrake'); s.nitro = this.nitrousEnabled && held('nitro'); s.lookBack = held('lookBack');
    this.cameraLook.x = axisValue(gp('lookRight') - gp('lookLeft'), this.settings.deadzone);
    this.cameraLook.y = axisValue(gp('lookDown') - gp('lookUp'), this.settings.deadzone);
    if (blocked || inMenu || capturing) {
      s.throttle = s.brake = s.steer = s.steerRaw = this.keyThrottle = this.keyBrake = 0; s.handbrake = s.nitro = s.lookBack = false;
      this.cameraLook.x = this.cameraLook.y = 0;
      if (!retainMouseLock) this.releaseMouseLook();
    }
    if (this.touchUI) this.touchUI.hidden = inMenu || blocked;
    return s;
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
    const help = doc.createElement('p'); help.textContent = 'Choose a binding, then press a key or controller button / move an axis. Escape cancels. E / Q shift in manual mode.'; panel.append(help);
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
    const tilt = doc.createElement('button'); tilt.type = 'button'; tilt.textContent = 'Touch steering: ' + this.settings.touchSteering;
    tilt.addEventListener('click', async () => {
      if (this.settings.touchSteering === 'screen') {
        try { if (this.target?.DeviceOrientationEvent?.requestPermission && await this.target.DeviceOrientationEvent.requestPermission() !== 'granted') { this.toast('Tilt permission unavailable; use on-screen steering'); return; } } catch { this.toast('Tilt unavailable; use on-screen steering'); return; }
      }
      this.configure({ touchSteering: this.settings.touchSteering === 'screen' ? 'tilt' : 'screen' }); tilt.textContent = 'Touch steering: ' + this.settings.touchSteering;
    }); panel.append(tilt);
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
  mountTouch() {
    const doc = this.document;
    if (!doc.body) { doc.addEventListener('DOMContentLoaded', () => this.mountTouch(), { once: true }); return; }
    if (!doc.getElementById('input-css')) { const link = doc.createElement('link'); link.id = 'input-css'; link.rel = 'stylesheet'; link.href = new URL('./input.css', import.meta.url).href; doc.head.append(link); }
    const enable = () => {
      if (this.touchUI) return;
      doc.body.classList.add('touch-driving');
      const root = doc.createElement('div'); root.id = 'touch-controls'; root.setAttribute('aria-label', 'Touch driving controls');
      const steer = doc.createElement('div'); steer.className = 'touch-steer'; steer.textContent = '◀  STEER  ▶'; steer.setAttribute('role', 'group'); steer.setAttribute('aria-label', 'Drag left or right to steer');
      let pointer;
      const move = e => { if (e.pointerId !== pointer) return; const r = steer.getBoundingClientRect(); this.touch.steer = clamp((e.clientX - r.left - r.width / 2) / (r.width * 0.4), -1, 1); };
      steer.addEventListener('pointerdown', e => { e.preventDefault(); if (pointer !== undefined) return; pointer = e.pointerId; steer.setPointerCapture(pointer); move(e); });
      steer.addEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) steer.addEventListener(name, e => { if (e.pointerId === pointer) { pointer = undefined; this.touch.steer = 0; } }); root.append(steer);
      const pedals = doc.createElement('div'); pedals.className = 'touch-pedals';
      const aux = doc.createElement('div'); aux.className = 'touch-buttons';
      for (const [action, label] of [['brake', 'BRAKE'], ['throttle', 'GAS'], ['handbrake', 'HB'], ['nitro', 'N₂O'], ['camera', 'CAM'], ['pause', 'Ⅱ']]) {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.action = action; button.setAttribute('aria-label', action); if (action === 'nitro') button.hidden = !this.nitrousEnabled;
        const pointers = new Set();
        button.addEventListener('pointerdown', e => { e.preventDefault(); pointers.add(e.pointerId); button.setPointerCapture(e.pointerId); this.touch[action] = 1; if (EDGE_ACTIONS.includes(action)) this.pending.add(action); button.classList.add('held'); });
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, e => { pointers.delete(e.pointerId); if (!pointers.size) { this.touch[action] = 0; button.classList.remove('held'); } });
        (action === 'throttle' || action === 'brake' ? pedals : aux).append(button);
      }
      root.append(pedals, aux); doc.body.append(root); this.touchUI = root;
    };
    if ((this.navigator?.maxTouchPoints || 0) > 0 || this.target?.matchMedia?.('(pointer: coarse)').matches) enable();
    else this.listen('touchstart', enable);
  }
}
export const input = new Input();
export const cameraLook = input.cameraLook;
export default input;
