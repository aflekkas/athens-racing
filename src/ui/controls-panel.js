// CONTROLS TAB (settings): steering response sliders, racing wheel setup, and the key / controller rebinding list, built
// from the UI kit over the input system's API (src/input.js: bindings, settings, configure(), capture, resetBindings()).
// A binding row has two chips (keyboard, controller): left / right picks one, confirm (or a click) waits for the new key /
// button / axis; Esc cancels. While a capture runs the input system holds back every action, so the menu stays put.
import { input } from '../input.js';
import { CALIBRATION_STEPS, CALIBRATION_TEXT, WHEEL_LIMITS } from '../steering-wheel.js';
import * as C from './components.js';

const { icon, esc } = C;
const GROUPS = [
  ['DRIVING', 'circle-gauge', { throttle: 'ACCELERATE', brake: 'BRAKE / REVERSE', left: 'STEER LEFT', right: 'STEER RIGHT', handbrake: 'HANDBRAKE', tractionControl: 'TOGGLE TC / ESC', nitro: 'NITRO', shiftUp: 'SHIFT UP', shiftDown: 'SHIFT DOWN', transmission: 'MANUAL / AUTO', map: 'BIG MAP' }],
  ['CAMERA', 'camera', { camera: 'CHANGE CAMERA', lookBack: 'LOOK BACK', lookLeft: 'LOOK LEFT', lookRight: 'LOOK RIGHT', lookUp: 'LOOK UP', lookDown: 'LOOK DOWN' }],
  ['RACE', 'flag', { restart: 'RESTART', pause: 'PAUSE', tow: 'TOW TO THE ROAD', garage: 'GARAGE' }],
  ['MENUS', 'menu', { up: 'UP', down: 'DOWN', menuLeft: 'LEFT', menuRight: 'RIGHT', confirm: 'CONFIRM', back: 'BACK' }],
];
const KEYS = { Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC', Backspace: 'BKSP', Tab: 'TAB', ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', ControlLeft: 'L CTRL', ControlRight: 'R CTRL', AltLeft: 'L ALT', AltRight: 'R ALT', CapsLock: 'CAPS', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\' };
const keyLabel = (c) => c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c.startsWith('Numpad') ? 'NUM ' + c.slice(6) : c.startsWith('Arrow') ? icon('chevron-' + c.slice(5).toLowerCase()) : KEYS[c] || esc(c.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase());
const PAD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'LS', 'RS', 'D ' + icon('chevron-up'), 'D ' + icon('chevron-down'), 'D ' + icon('chevron-left'), 'D ' + icon('chevron-right'), 'HOME'];
const PADCLS = ['pa', 'pb', 'px', 'py'];
const STICK = ['LS', 'LS', 'RS', 'RS'];
function padLabel(b) {
  let m = /^b(\d+)$/.exec(b); if (m) return [PAD[+m[1]] || 'B' + m[1], PADCLS[+m[1]] || ''];
  m = /^a(\d+)([+-])$/.exec(b); if (!m) return [esc(b), ''];
  const ax = +m[1], dir = ax % 2 ? (m[2] === '+' ? 'down' : 'up') : (m[2] === '+' ? 'right' : 'left');
  return [`${STICK[ax] || 'AX' + ax} ${icon('chevron-' + dir)}`, ''];
}
const chips = (kind, codes) => {
  if (!codes.length) return C.kbd('NONE', kind === 'gamepad', 'kbd--empty');
  return codes.slice(0, 2).map((c) => { if (kind === 'keyboard') return C.kbd(keyLabel(c)); const [l, cls] = padLabel(c); return C.kbd(l, true, cls); }).join('');
};
function bindRow(action, label) {
  const b = input.bindings, cap = input.capture?.action === action ? input.capture.kind : null;
  const cell = (kind) => !(action in b[kind]) ? `<span class="bind__chip na">${C.kbd('—', kind === 'gamepad', 'kbd--empty')}</span>`
    : `<span class="bind__chip ${cap === kind ? 'wait' : ''}" data-bind="${kind}" role="button" aria-label="Rebind ${esc(label)} ${kind}">${cap === kind ? `<em>${kind === 'keyboard' ? 'PRESS A KEY' : 'PRESS A BUTTON'}</em>` : chips(kind, b[kind][action])}</span>`;
  return C.field(esc(label), `<div class="bind__cols">${cell('keyboard')}${cell('gamepad')}</div>`, { kind: 'bind', cls: 'bind', attrs: { 'data-action': action } });
}
// ---- racing wheel (src/steering-wheel.js): detection, live axes, calibration, mapping, range, deadzone, force feedback
const WHEEL_MAP = { wheelSteerAxis: ['steer', 'axis'], wheelThrottleAxis: ['throttle', 'axis'], wheelBrakeAxis: ['brake', 'axis'],
  wheelSteerInvert: ['steer', 'invert'], wheelThrottleInvert: ['throttle', 'invert'], wheelBrakeInvert: ['brake', 'invert'] };
const pct = (v) => Math.round(v * 100) + '%';
const live = (role, label, ic) => `<div class="wheel-live" data-wheel-live="${role}"><span class="wheel-live__k">${icon(ic)}${label}</span><b class="wheel-live__v">0%</b>${C.progress(role === 'steer' ? 0.5 : 0, 'wheel-live__bar')}</div>`;
const liveRows = () => `<div class="wheel-meters">${live('steer', 'STEERING', 'circle-dot')}${live('throttle', 'THROTTLE', 'gauge')}${live('brake', 'BRAKE', 'circle-gauge')}</div>`;
/** refresh the live axis readouts while the controls tab shows them; stops itself once they are gone */
let liveTimer = null;
function ensureLive() {
  if (liveTimer || typeof document === 'undefined') return;
  liveTimer = setInterval(() => {
    const rows = document.querySelectorAll('[data-wheel-live]');
    if (!rows.length) { clearInterval(liveTimer); liveTimer = null; return; }
    const v = input.wheel?.values; if (!v) return;
    for (const row of rows) {
      const role = row.dataset.wheelLive, value = v[role] || 0;
      row.querySelector('.wheel-live__v').textContent = role === 'steer' ? (value > 0.005 ? 'R ' : value < -0.005 ? 'L ' : '') + pct(Math.abs(value)) : pct(value);
      C.setProgress(row.querySelector('.progress'), role === 'steer' ? (value + 1) / 2 : value);
    }
  }, 80);
}
function wheelGroup(A) {
  const w = input.wheel, s = input.settings, cal = input.wheelCal;
  const mode = C.segmented({ key: 'wheelMode', label: 'RACING WHEEL', value: s.wheelMode, options: [['auto', 'AUTO'], ['gamepad', 'OFF'], ['wheel', 'ON']], attrs: A,
    note: 'Auto finds Logitech, Thrustmaster and Fanatec wheels. On treats any unusual device as a wheel.' });
  let body = '';
  if (!w) body = `<p class="group__note">No wheel found. Plug it in, then turn it or press a pedal.</p>`;
  else if (cal) {
    const step = cal.name, n = CALIBRATION_STEPS.indexOf(step) + 1, [title, text] = CALIBRATION_TEXT[step];
    body = `<p class="group__note">${icon('circle-dot')} ${C.esc(w.name)} · STEP ${n} OF ${CALIBRATION_STEPS.length}: <b>${title}</b></p>
      <p class="group__note wheel-step">${C.esc(text)}${cal.error ? `<br><b class="wheel-error">${C.esc(cal.error)}</b>` : ''}</p>${liveRows()}
      <div class="field-actions">${C.button({ label: n === CALIBRATION_STEPS.length ? 'FINISH' : 'NEXT', icon: 'check', variant: 'primary', act: 'wheelNext', size: 'sm' })}${C.button({ label: 'CANCEL', variant: 'ghost', act: 'wheelCancel', size: 'sm' })}</div>`;
  } else {
    const p = w.profile, axes = Array.from({ length: Math.max(1, w.axisCount) }, (_, i) => [String(i), 'AXIS ' + i]);
    const mapRow = (role, label, key, invKey) => { const m = p[role]; return m ? C.select({ key, label, value: String(m.axis), options: axes, attrs: A })
      + C.toggle({ key: invKey, label: label + ' INVERTED', value: role === 'steer' ? !!m.invert : m.max < m.min, attrs: A }) : ''; };
    body = `<p class="group__note">${icon('circle-dot')} ${C.esc(w.name)} · ${w.saved ? 'CALIBRATED' : 'DEFAULT MAPPING, CALIBRATE FOR BEST RESULTS'}</p>${liveRows()}
      <div class="field-actions">${C.button({ label: 'CALIBRATE', icon: 'refresh-cw', variant: 'secondary', act: 'wheelCalibrate', size: 'sm' })}${w.saved ? C.button({ label: 'RESET WHEEL', icon: 'rotate-ccw', variant: 'ghost', act: 'wheelReset', size: 'sm' }) : ''}</div>
      ${C.slider({ key: 'wheelRange', label: 'STEERING RANGE', value: s.wheelRange, min: WHEEL_LIMITS.range[0], max: WHEEL_LIMITS.range[1], step: 0.05, format: 'pct', attrs: A, note: 'How far you turn the wheel for full lock. Lower is quicker.' })}
      ${C.slider({ key: 'wheelDeadzone', label: 'STEERING DEADZONE', value: s.wheelDeadzone, min: 0, max: WHEEL_LIMITS.deadzone[1], step: 0.01, format: 'pct', attrs: A })}
      ${C.slider({ key: 'wheelLinearity', label: 'STEERING CURVE', value: s.wheelLinearity, min: WHEEL_LIMITS.linearity[0], max: WHEEL_LIMITS.linearity[1], step: 0.05, format: 'f2', attrs: A, note: '1.00 is linear. Higher is gentler near centre.' })}
      ${C.slider({ key: 'wheelPedalDeadzone', label: 'PEDAL DEADZONE', value: s.wheelPedalDeadzone, min: 0, max: WHEEL_LIMITS.pedalDeadzone[1], step: 0.01, format: 'pct', attrs: A, note: 'Travel ignored at each end of the pedal.' })}
      ${mapRow('steer', 'STEERING AXIS', 'wheelSteerAxis', 'wheelSteerInvert')}${mapRow('throttle', 'THROTTLE AXIS', 'wheelThrottleAxis', 'wheelThrottleInvert')}${mapRow('brake', 'BRAKE AXIS', 'wheelBrakeAxis', 'wheelBrakeInvert')}
      ${C.slider({ key: 'wheelForce', label: 'FORCE FEEDBACK', value: s.wheelForce, min: 0, max: 1, step: 0.05, format: 'pct', icon: 'zap', attrs: A, note: w.canRumble ? 'Rumble at the grip limit and over kerbs. 0% is off.' : 'This wheel has no force feedback in the browser.' })}`;
  }
  ensureLive();
  return `<div class="group"><h3 class="group__title">${icon('circle-dot')}STEERING WHEEL</h3>${mode}${body}</div>`;
}
export function renderControls(menu) {
  const s = input.settings, A = { 'data-scope': 'input' };
  const known = new Set(GROUPS.flatMap(([, , g]) => Object.keys(g)));
  const all = [...new Set([...Object.keys(input.bindings.keyboard), ...Object.keys(input.bindings.gamepad)])].filter(a => a !== 'nitro' || input.nitrousEnabled);
  const other = all.filter(a => !known.has(a));
  const groups = [...GROUPS, ...(other.length ? [['OTHER', 'wrench', Object.fromEntries(other.map((a) => [a, a.replace(/([A-Z])/g, ' $1').toUpperCase()]))]] : [])];
  menu.bindCol = menu.bindCol || 0; paintCol(menu);
  return `<div class="group"><h3 class="group__title">${icon('gamepad-2')}STEERING RESPONSE</h3>
      ${C.slider({ key: 'deadzone', label: 'STICK DEADZONE', value: s.deadzone, min: 0, max: 0.45, step: 0.01, format: 'f2', attrs: A })}
      ${C.slider({ key: 'sensitivity', label: 'STEERING SENSITIVITY', value: s.sensitivity, min: 0.25, max: 2, step: 0.05, format: 'x', attrs: A })}
      ${C.slider({ key: 'linearity', label: 'STEERING CURVE', value: s.linearity, min: 0.25, max: 3, step: 0.05, format: 'f2', attrs: A, note: '1.00 is linear. Higher is gentler near centre.' })}</div>
    ${wheelGroup(A)}
    <div class="bind-head"><span></span><span>${icon('keyboard')}KEYBOARD</span><span>${icon('gamepad-2')}CONTROLLER</span></div>
    ${groups.map(([title, ic, g]) => `<div class="group"><h3 class="group__title">${icon(ic)}${title}</h3>${Object.entries(g).filter(([a]) => all.includes(a)).map(([a, l]) => bindRow(a, l)).join('')}</div>`).join('')}
    <div class="field-actions">${C.button({ label: 'RESET CONTROLS', icon: 'rotate-ccw', variant: 'ghost', act: 'controlsReset', size: 'sm' })}</div>`;
}
/** the selected chip column (keyboard / controller) is drawn by CSS from #ui[data-bindcol] */
function paintCol(menu) { menu.root.dataset.bindcol = menu.bindCol; }
function rerenderRow(menu, action) {
  const row = menu.root.querySelector(`.bind[data-action="${action}"]`); if (!row) return;
  const label = row.querySelector('.field__label span')?.textContent || action, focused = row.classList.contains('focus');
  const t = document.createElement('template'); t.innerHTML = bindRow(action, label); const next = t.content.firstChild;
  next.classList.toggle('focus', focused); row.replaceWith(next);
}
function capture(menu, action, kind) {
  if (!(action in input.bindings[kind])) return;
  input.cancelCapture(); input.clear();
  input.capture = { kind, action, ready: false, done: () => { rerenderRow(menu, action); } };
  rerenderRow(menu, action);
}
async function confirmReset(menu) {
  const ok = await C.ui.prompt({ title: 'RESET CONTROLS?', body: 'Every key and controller binding and the steering response go back to the defaults.', icon: 'rotate-ccw',
    actions: [{ id: 'reset', label: 'RESET', icon: 'rotate-ccw', variant: 'primary' }, { id: 'cancel', label: 'CANCEL', variant: 'secondary', default: true }] });
  if (ok === 'reset') { input.resetBindings(); menu.refresh(); C.ui.toast('CONTROLS RESET', { icon: 'check', tone: 'good' }); }
}
/** the wheel calibration buttons: start, advance a step (the last one saves), cancel, and forget this wheel's calibration */
function wheelButton(menu, act) {
  if (act === 'wheelCalibrate') input.startWheelCalibration();
  else if (act === 'wheelCancel') input.cancelWheelCalibration();
  else if (act === 'wheelReset') { input.resetWheelProfile(); C.ui.toast('WHEEL RESET', { icon: 'check', tone: 'good' }); }
  else if (act === 'wheelNext') { const r = input.nextWheelCalibration(); if (r.done) C.ui.toast('WHEEL CALIBRATED', { icon: 'check', tone: 'good' }); }
  else return false;
  menu.refresh(); return true;
}
/** a named action on the controls tab; true = handled here */
export function controlsAction(menu, name, cur) {
  if (name === 'confirm' && /^wheel/.test(cur?.dataset.act || '') && wheelButton(menu, cur.dataset.act)) return true;
  if (cur?.dataset.kind !== 'bind') { if (name === 'confirm' && cur?.dataset.act === 'controlsReset') { confirmReset(menu); return true; } return false; }
  if (name === 'left' || name === 'right') { menu.bindCol = name === 'right' ? 1 : 0; paintCol(menu); menu.h.ui?.(name === 'right'); return true; }
  if (name === 'confirm') { capture(menu, cur.dataset.action, ['keyboard', 'gamepad'][menu.bindCol]); menu.h.ui?.(true); return true; }
  return false;
}
export function controlsClick(menu, e) {
  if (e.target.closest?.('[data-act=controlsReset]')) { confirmReset(menu); return true; }
  const wheel = e.target.closest?.('[data-act^=wheel]'); if (wheel && wheelButton(menu, wheel.dataset.act)) return true;
  const chip = e.target.closest?.('[data-bind]'); if (!chip) return false;
  const row = chip.closest('.bind'), it = menu.items(); if (it.includes(row)) menu.setFocus(it.indexOf(row), false);
  menu.bindCol = chip.dataset.bind === 'gamepad' ? 1 : 0;
  capture(menu, row.dataset.action, chip.dataset.bind); return true;
}
export function controlsChange(menu, key, value) {
  if (key in WHEEL_MAP) { const [role, prop] = WHEEL_MAP[key]; input.setWheelMapping(role, { [prop]: prop === 'axis' ? Number(value) : value === true || value === 'true' }); menu.refresh(); return; }
  input.configure({ [key]: value });
}
