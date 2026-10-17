// CONTROLS TAB (settings): steering response sliders, touch steering, and the key / controller rebinding list, built
// from the UI kit over the input system's API (src/input.js: bindings, settings, configure(), capture, resetBindings()).
// A binding row has two chips (keyboard, controller): left / right picks one, confirm (or a click) waits for the new key /
// button / axis; Esc cancels. While a capture runs the input system holds back every action, so the menu stays put.
import { input } from '../input.js';
import * as C from './components.js';

const { icon, esc } = C;
const GROUPS = [
  ['DRIVING', 'steering-wheel', { throttle: 'ACCELERATE', brake: 'BRAKE / REVERSE', left: 'STEER LEFT', right: 'STEER RIGHT', handbrake: 'HANDBRAKE', tractionControl: 'TOGGLE TC / ESC', nitro: 'NITRO', shiftUp: 'SHIFT UP', shiftDown: 'SHIFT DOWN', transmission: 'MANUAL / AUTO', map: 'BIG MAP' }],
  ['CAMERA', 'camera', { camera: 'CHANGE CAMERA', lookBack: 'LOOK BACK', lookLeft: 'LOOK LEFT', lookRight: 'LOOK RIGHT', lookUp: 'LOOK UP', lookDown: 'LOOK DOWN' }],
  ['RACE', 'flag-checkered', { restart: 'RESTART', pause: 'PAUSE', tow: 'TOW TO THE ROAD', garage: 'GARAGE' }],
  ['MENUS', 'list', { up: 'UP', down: 'DOWN', menuLeft: 'LEFT', menuRight: 'RIGHT', confirm: 'CONFIRM', back: 'BACK' }],
];
const KEYS = { Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC', Backspace: 'BKSP', Tab: 'TAB', ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', ControlLeft: 'L CTRL', ControlRight: 'R CTRL', AltLeft: 'L ALT', AltRight: 'R ALT', CapsLock: 'CAPS', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\' };
const keyLabel = (c) => c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c.startsWith('Numpad') ? 'NUM ' + c.slice(6) : c.startsWith('Arrow') ? icon('caret-' + c.slice(5).toLowerCase()) : KEYS[c] || esc(c.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase());
const PAD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'LS', 'RS', 'D ' + icon('caret-up'), 'D ' + icon('caret-down'), 'D ' + icon('caret-left'), 'D ' + icon('caret-right'), 'HOME'];
const PADCLS = ['pa', 'pb', 'px', 'py'];
const STICK = ['LS', 'LS', 'RS', 'RS'];
function padLabel(b) {
  let m = /^b(\d+)$/.exec(b); if (m) return [PAD[+m[1]] || 'B' + m[1], PADCLS[+m[1]] || ''];
  m = /^a(\d+)([+-])$/.exec(b); if (!m) return [esc(b), ''];
  const ax = +m[1], dir = ax % 2 ? (m[2] === '+' ? 'down' : 'up') : (m[2] === '+' ? 'right' : 'left');
  return [`${STICK[ax] || 'AX' + ax} ${icon('caret-' + dir)}`, ''];
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
export function renderControls(menu) {
  const s = input.settings, A = { 'data-scope': 'input' };
  const known = new Set(GROUPS.flatMap(([, , g]) => Object.keys(g)));
  const all = [...new Set([...Object.keys(input.bindings.keyboard), ...Object.keys(input.bindings.gamepad)])].filter(a => a !== 'nitro' || input.nitrousEnabled);
  const other = all.filter(a => !known.has(a));
  const groups = [...GROUPS, ...(other.length ? [['OTHER', 'wrench', Object.fromEntries(other.map((a) => [a, a.replace(/([A-Z])/g, ' $1').toUpperCase()]))]] : [])];
  menu.bindCol = menu.bindCol || 0; paintCol(menu);
  return `<div class="group"><h3 class="group__title">${icon('game-controller')}STEERING RESPONSE</h3>
      ${C.slider({ key: 'deadzone', label: 'STICK DEADZONE', value: s.deadzone, min: 0, max: 0.45, step: 0.01, format: 'f2', attrs: A })}
      ${C.slider({ key: 'sensitivity', label: 'STEERING SENSITIVITY', value: s.sensitivity, min: 0.25, max: 2, step: 0.05, format: 'x', attrs: A })}
      ${C.slider({ key: 'linearity', label: 'STEERING CURVE', value: s.linearity, min: 0.25, max: 3, step: 0.05, format: 'f2', attrs: A, note: '1.00 IS LINEAR · HIGHER IS GENTLER NEAR CENTRE' })}
      ${C.segmented({ key: 'touchSteering', label: 'TOUCH STEERING', value: s.touchSteering, options: [['screen', 'ON-SCREEN', 'hand-tap'], ['tilt', 'TILT', 'device-mobile']], attrs: A })}</div>
    <div class="bind-head"><span></span><span>${icon('keyboard')}KEYBOARD</span><span>${icon('game-controller')}CONTROLLER</span></div>
    ${groups.map(([title, ic, g]) => `<div class="group"><h3 class="group__title">${icon(ic)}${title}</h3>${Object.entries(g).filter(([a]) => all.includes(a)).map(([a, l]) => bindRow(a, l)).join('')}</div>`).join('')}
    <div class="field-actions">${C.button({ label: 'RESET CONTROLS', icon: 'arrow-counter-clockwise', variant: 'ghost', act: 'controlsReset', size: 'sm' })}</div>`;
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
  const ok = await C.ui.prompt({ title: 'RESET CONTROLS?', body: 'Every key and controller binding and the steering response go back to the defaults.', icon: 'arrow-counter-clockwise',
    actions: [{ id: 'reset', label: 'RESET', icon: 'arrow-counter-clockwise', variant: 'primary' }, { id: 'cancel', label: 'CANCEL', variant: 'secondary', default: true }] });
  if (ok === 'reset') { input.resetBindings(); menu.refresh(); C.ui.toast('CONTROLS RESET', { icon: 'check', tone: 'good' }); }
}
/** a named action on the controls tab; true = handled here */
export function controlsAction(menu, name, cur) {
  if (cur?.dataset.kind !== 'bind') { if (name === 'confirm' && cur?.dataset.act === 'controlsReset') { confirmReset(menu); return true; } return false; }
  if (name === 'left' || name === 'right') { menu.bindCol = name === 'right' ? 1 : 0; paintCol(menu); menu.h.ui?.(name === 'right'); return true; }
  if (name === 'confirm') { capture(menu, cur.dataset.action, ['keyboard', 'gamepad'][menu.bindCol]); menu.h.ui?.(true); return true; }
  return false;
}
export function controlsClick(menu, e) {
  if (e.target.closest?.('[data-act=controlsReset]')) { confirmReset(menu); return true; }
  const chip = e.target.closest?.('[data-bind]'); if (!chip) return false;
  const row = chip.closest('.bind'), it = menu.items(); if (it.includes(row)) menu.setFocus(it.indexOf(row), false);
  menu.bindCol = chip.dataset.bind === 'gamepad' ? 1 : 0;
  capture(menu, row.dataset.action, chip.dataset.bind); return true;
}
export async function controlsChange(menu, key, value, el) {
  if (key === 'touchSteering' && value === 'tilt') {
    const D = globalThis.DeviceOrientationEvent;
    try { if (D?.requestPermission && await D.requestPermission() !== 'granted') { C.ui.toast('TILT PERMISSION UNAVAILABLE', { icon: 'warning', tone: 'bad' }); C.setValue(el, 'screen', false); return; } }
    catch { C.ui.toast('TILT UNAVAILABLE ON THIS DEVICE', { icon: 'warning', tone: 'bad' }); C.setValue(el, 'screen', false); return; }
  }
  input.configure({ [key]: value });
}
