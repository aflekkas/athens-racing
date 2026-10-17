import { buildBadge } from '../build-environment.js';
import { notifications, raceNotificationsActive } from './notifications.js';
// UI COMPONENTS: the ATHENS RACING kit. Plain JS, no dependencies; styles in src/ui/ui.css (design tokens at the top).
//
// Two ways to use it:
//   1. HTML builders (menus render strings):  button({ label, icon, variant, act }), slider({ key, value, ... }), toggle(),
//      segmented(), stepper(), select({ compact }), tabs({ vertical }), option(), listRow(), textField(), searchField(), card(),
//      carCard(), panel(), sheetHead(), dialog() (sign-in only), plate(), stat(), chip(), table(), keyHints(), progress(), spinner(),
//      medal(), icon(name). Interactive builders emit a `.mi` row (the menu's focus item) carrying data-kind / data-key.
//      Inside src/menu.js the named input actions drive them: left / right -> step(el, ±1), confirm -> activate(el).
//      Mouse, touch and pen work through handleClick(event) / pointer drag on sliders (bindRoot(root) once).
//      Every value change dispatches a bubbling CustomEvent 'ui:change' { key, value, el } from the row.
//   2. enhance(root) / autoEnhance(root): swaps native <input type=range> and <input type=checkbox> in DOM
//      owned by other modules (multiplayer lobby) for the custom Select / Slider / Toggle. The native
//      element stays in the DOM, hidden, as the source of truth: its value / checked setters are mirrored, and user
//      changes fire its normal 'input' / 'change' events, so the owning code needs no changes.
//
// MODAL PROMPT (for gameplay, e.g. the off-track "Tow / Reset?" prompt):
//   import { ui } from './ui/components.js';
//   const choice = await ui.prompt({
//     title: 'OFF TRACK', body: 'Tow back to the road?', icon: 'truck',
//     actions: [{ id: 'tow', label: 'TOW', icon: 'truck', variant: 'primary' }, { id: 'stay', label: 'KEEP DRIVING' }],
//     dismissible: true,        // back / Esc / B resolves null (default true)
//     timeout: 0,               // ms; > 0 auto-resolves with `timeoutId` (default null) when it runs out
//   });                         // -> the chosen action id, or null when dismissed
//   ui.closePrompt(result)      closes the open prompt programmatically
//   ui.modalOpen                true while a prompt is up. main.js flowAction() hands every named input action to
//                               ui.action(name) first (up/down/left/right move, confirm picks, back dismisses) and
//                               window.__flow.inMenu() reports true, so driving input is zeroed while it is open.
//   ui.toast(text, { icon, tone: 'good' | 'bad', ms })   a short notice at the top of the screen
//
// Icons: Phosphor Icons (bold, MIT), vendored in assets/icons/ (sprite.svg via tools/build-icon-sprite.mjs).

import { bindingLabel } from '../input-labels.js';
import { driverName } from '../driver-name.js';
export let hintBindings = null;
export const setHintBindings = fn => { hintBindings = fn; };

export const SPRITE = new URL('../../assets/icons/sprite.svg', import.meta.url).href;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const attrStr = (o = {}) => Object.entries(o).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? ` ${k}` : ` ${k}="${esc(v)}"`).join('');

// Chromium resolves an external <use href="sprite.svg#…"> asynchronously for every newly inserted icon, so each freshly
// rendered screen showed blank icons for a frame or two. The sprite is inlined into the page once (ids prefixed ico-)
// and icons rendered after that reference it in-document.
let spriteInline = false;
if (typeof document !== 'undefined' && typeof fetch === 'function') fetch(SPRITE).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status)))).then((text) => {
  const put = () => { const t = document.createElement('template'); t.innerHTML = text.replace(/<symbol id="/g, '<symbol id="ico-'); const svg = t.content.querySelector('svg'); if (!svg) return;
    svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; document.body.prepend(svg); spriteInline = true; };
  if (document.body) put(); else document.addEventListener('DOMContentLoaded', put, { once: true });
}).catch(() => {});
export const icon = (name, cls = '') => name ? `<svg class="ico ${cls}" aria-hidden="true" focusable="false"><use href="${spriteInline ? '#ico-' : SPRITE + '#'}${name}"/></svg>` : '';
export function iconEl(name, cls = '') { const t = document.createElement('template'); t.innerHTML = icon(name, cls); return t.content.firstChild; }

// ------------------------------------------------------------------ value formats (sliders / steppers)
const FORMATS = {
  pct: (v) => Math.round(v * 100) + '%', int: (v) => String(Math.round(v)), f1: (v) => (+v).toFixed(1), f2: (v) => (+v).toFixed(2),
  x: (v) => (+v).toFixed(2).replace(/\.?0+$/, '') + '×', raw: (v) => String(v),
};
export function registerFormat(name, fn) { FORMATS[name] = fn; }
const fmt = (name, v) => (FORMATS[name] || FORMATS.raw)(v);

// ------------------------------------------------------------------ static builders
export function button({ label = '', icon: ic, iconRight, logo = '', variant = 'secondary', size, act, block, focusable = true, attrs, sub, cls = '', title, disabled } = {}) {
  const c = ['btn', 'btn--' + variant, size && 'btn--' + size, block && 'btn--block', !label && !logo && 'btn--icon', focusable && 'mi', disabled && 'off', cls].filter(Boolean).join(' ');
  return `<div class="${c}" role="button"${attrStr({ 'data-act': act, title, 'aria-label': !label ? title : null, 'aria-disabled': disabled ? 'true' : null, ...attrs })}>${logo}${icon(ic)}${label ? `<span>${label}</span>` : ''}${sub ? `<span class="btn__sub">${sub}</span>` : ''}${icon(iconRight)}</div>`;
}
export function option({ icon: ic, title, desc = '', act, attrs, cls = '', disabled } = {}) {
  return `<div class="mi option ${disabled ? 'off' : ''} ${cls}" role="button"${attrStr({ 'data-act': act, ...attrs })}><span class="option__ico">${icon(ic)}</span><span><b class="option__title">${title}</b>${desc ? `<span class="option__desc">${desc}</span>` : ''}</span><span class="option__go">${icon('caret-right')}</span></div>`;
}
export function panel(title, body, { icon: ic, cls = '', notch = false, right = '', attrs } = {}) {
  return `<section class="panel ${notch ? 'panel--notch' : ''} ${cls}"${attrStr(attrs)}>${title ? `<header class="panel__head"><h3 class="panel__title">${icon(ic)}${title}</h3>${right}</header>` : ''}${body}</section>`;
}
export function card({ media = '', badge = '', title = '', text = '', body = '', foot = '', act, attrs, cls = '', selected } = {}) {
  return `<div class="mi card ${selected ? 'selected' : ''} ${cls}" role="button"${attrStr({ 'data-act': act, ...attrs })}>${media ? `<div class="card__media">${media}${badge ? `<span class="card__badge">${badge}</span>` : ''}</div>` : ''}<div class="card__body"><h3 class="card__title">${title}</h3>${text ? `<p class="card__text">${text}</p>` : ''}${body}${foot ? `<div class="card__foot">${foot}</div>` : ''}</div></div>`;
}
export function stat(label, value, { icon: ic, tone, cls = '' } = {}) {
  return `<div class="stat-tile ${tone ? 'stat-tile--' + tone : ''} ${cls}"><span class="stat-tile__k">${icon(ic)}${label}</span><b class="stat-tile__v">${value}</b></div>`;
}
export const stats = (tiles, cls = '') => `<div class="stats ${cls}">${tiles.map((t) => Array.isArray(t) ? stat(...t) : t).join('')}</div>`;
/** a focusable list row (lobbies, landmarks, any pick-one list): icon, title + one line, right-side meta, chevron */
export function listRow({ icon: ic, title = '', desc = '', meta = '', act, fid, attrs, cls = '', disabled, selected, go = true, focusable = true } = {}) {
  // focusable: false = an information row whose meta holds its own buttons (friends, invites)
  return `<div class="${focusable ? 'mi ' : ''}list-row${focusable ? '' : ' list-row--static'} ${disabled ? 'off' : ''} ${selected ? 'selected' : ''} ${cls}"${focusable ? ' role="button"' : ''}${attrStr({ 'data-act': act, 'data-fid': fid, 'aria-disabled': disabled ? 'true' : null, ...attrs })}>${ic ? `<span class="list-row__ico">${icon(ic)}</span>` : ''}<span class="list-row__main"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</span>${meta ? `<span class="list-row__meta">${meta}</span>` : ''}${go ? icon('caret-right', 'list-row__go') : ''}</div>`;
}
/** a small status pill: tone '' | 'accent' | 'good' | 'warn' | 'bad' | 'gold' */
export const chip = (text, { tone = '', icon: ic, cls = '', attrs } = {}) => `<span class="chip ${tone ? 'chip--' + tone : ''} ${cls}"${attrStr(attrs)}>${icon(ic)}<span>${text}</span></span>`;
/** a classification / splits table: rows [{ pos, name, sub, value, me, tone, chip }] */
export function table(rows, { cls = '' } = {}) {
  return `<table class="r-table ${cls}">${rows.map((r) => `<tr class="${r.me ? 'me' : ''}">${r.pos != null ? `<td class="r-pos">${r.pos}</td>` : ''}<td>${r.name ?? ''}${r.sub ? `<small>${r.sub}</small>` : ''}${r.chip || ''}</td><td class="tnum ${r.tone || ''}">${r.value ?? ''}</td></tr>`).join('')}</table>`;
}
/** a text field in a normal focus row: OK puts the caret in it; Esc / Enter leave (the owner listens for 'input' on [data-field]) */
export function textField({ name, label, value = '', placeholder = '', maxlength, fid, icon: ic, note, cls = '', inputCls = '', inputAttrs, attrs } = {}) {
  const input = `<input class="text-field__input ${inputCls}"${attrStr({ 'data-field': name, value, placeholder, maxlength, 'aria-label': label, autocomplete: 'off', spellcheck: 'false', ...inputAttrs })}>`;
  return field(label, input, { icon: ic, note, cls: 'text-field ' + cls, kind: 'text', attrs: { 'data-fid': fid || name, ...attrs } });
}
export const badge = (text, tone = '', ic) => `<span class="badge ${tone ? 'badge--' + tone : ''}">${icon(ic)}${text}</span>`;
export const medal = (m, cls = '') => `<i class="medal ${m || 'none'} ${cls}" title="${m ? m.toUpperCase() : 'NO MEDAL'}"></i>`;
export const progress = (value = 0, cls = '') => `<div class="progress ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value * 100)}" style="--p:${value}"><i class="progress__fill"></i></div>`;
export const spinner = () => '<span class="spinner" role="status" aria-label="Loading"></span>';
export function setProgress(el, v) { if (!el) return; v = clamp(+v || 0, 0, 1); el.style.setProperty('--p', v); el.setAttribute('aria-valuenow', Math.round(v * 100)); }

// key hints (the soft-key bar): purely informational. Never focusable, clickable or in the .mi
// focus order; the named input actions (keys / gamepad / touch buttons) drive everything they describe.
const KB = (k) => `<kbd class="kbd">${k}</kbd>`, PAD = (k, c = '') => `<kbd class="kbd kbd--pad ${c}">${k}</kbd>`;
const HINT_KEYS = {
  confirm: [KB('ENTER'), PAD('A', 'pa')], back: [KB('ESC'), PAD('B', 'pb')], select: [KB(icon('caret-up')) + KB(icon('caret-down')), PAD('D-PAD')],
  updown: [KB(icon('caret-up')) + KB(icon('caret-down')), PAD(icon('caret-up')) + PAD(icon('caret-down'))],
  leftright: [KB(icon('caret-left')) + KB(icon('caret-right')), PAD(icon('caret-left')) + PAD(icon('caret-right'))],
  tabs: [KB('Q') + KB('E'), PAD('LB') + PAD('RB')], restart: [KB('R'), PAD('VIEW')], garage: [KB('G'), null],
};
export function keyHints(list, cls = '') {
  return `<div class="hints ${cls}" aria-hidden="true">${list.map(([k, label, padKey]) => {
    let [kb, pad] = HINT_KEYS[k] || [KB(k), padKey ? PAD(padKey) : null];
    const actions = ({ transmission:['transmission'], shiftUp:['shiftUp'], shiftDown:['shiftDown'], confirm:['confirm'], back:['back'], select:['up','down'], updown:['up','down'], leftright:['menuLeft','menuRight'], tabs:['shiftDown','shiftUp'], restart:['restart'], garage:['garage'] })[k];
    const bindings = hintBindings?.();
    if (bindings && actions) {
      kb = actions.map(a => KB(esc(bindingLabel(bindings, a === 'menuLeft' ? 'left' : a === 'menuRight' ? 'right' : a, 'keyboard')))).join('');
      const labels = actions.map(a => bindingLabel(bindings, a, 'gamepad')).filter(x => x !== 'UNBOUND');
      pad = labels.length ? labels.map(l => PAD(esc(l))).join('') : null;
    }
    return `<span class="hint ${pad ? '' : 'no-pad'}"><span class="hint__keys on-key">${kb}</span>${pad ? `<span class="hint__keys on-pad">${pad}</span>` : ''}${label}</span>`;
  }).join('')}</div>`;
}
export const kbd = (text, pad = false, cls = '') => `<kbd class="kbd ${pad ? 'kbd--pad' : ''} ${cls}">${text}</kbd>`;

/** the head-unit status bar: a fixed Back slot, breadcrumbs (the kicker), and the driver chip + clock at the right.
 *  Back never shares a row with the page title, so every title lines up with the content grid below it. */
export function statusBar({ back = true, kick = '' } = {}) {
  return `<div class="hu-status">${back ? button({ icon: 'caret-left', label: 'BACK', variant: 'ghost', size: 'sm', act: 'back', focusable: false, cls: 'scr__back' }) : ''}${kick ? `<div class="hu-crumb kick">${kick}</div>` : ''}<div class="hu-status__r">${buildBadge() ? `<span class="build-badge">${esc(buildBadge())}</span>` : ''}<button type="button" class="mi hu-driver" data-act="account" aria-label="Account" data-hu-driver>${icon('user')}<span>${esc(driverName.get())}</span></button><time class="hu-clock" data-hu-clock>${clockText()}</time></div></div>`;
}
const clockText = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
if (typeof window !== 'undefined' && typeof document !== 'undefined') setInterval(() => { const t = clockText(); for (const el of document.querySelectorAll('[data-hu-clock]')) if (el.textContent !== t) el.textContent = t; }, 15000);
driverName.onChange?.(name => { if (typeof document !== 'undefined') for (const el of document.querySelectorAll('[data-hu-driver] span')) el.textContent = name; });
/** the standard menu screen: the status bar, the screen header (title + right slot), a body that scrolls, a footer of
 *  key hints. Every menu screen is built with this one frame (docs/OWNER-DECISIONS.md: one shared component set). */
export function screen({ cls = '', kick = '', title = '', back = true, head = '', body = '', hints = [], foot = '' } = {}) {
  return `<div class="scr ${cls}">${statusBar({ back, kick })}<header class="scr__head"><div class="scr__titles">${title ? `<h2 class="scr__title">${title}</h2>` : ''}</div>${head ? `<div class="scr__headr">${head}</div>` : ''}</header>
    <div class="scr__body">${body}</div><footer class="scr__foot">${foot}${hints.length ? keyHints(hints) : ''}</footer></div>`;
}
/** the reference sheet header (the pause menu, owner-chosen 2026-10-16): a spaced-caps breadcrumb, a large light spaced
 *  title and an optional accent status line (the amber timer). Used by pause, the sign-in dialog and every panel that
 *  introduces a destination. */
export function sheetHead({ kick = '', title = '', status = '', statusIcon = 'timer', cls = '', id } = {}) {
  return `<header class="sheet-head ${cls}">${kick ? `<div class="kick">${kick}</div>` : ''}<h2 class="sheet-head__title"${attrStr({ id })}>${title}</h2>${status ? `<div class="sheet-head__status">${icon(statusIcon)}<span>${status}</span></div>` : ''}</header>`;
}
/** the ONE dialog (owner-approved exception to "menus are full screens": sign-in only, docs/OWNER-DECISIONS.md).
 *  A compact panel on a scrim that dims the screen rendered under it (`under`, made inert). Focus stays inside: the
 *  menu only walks focus items within [data-dialog] while it is open. */
export function dialog({ under = '', kick = '', title = '', body = '', actions = '', foot = '', cls = '', label } = {}) {
  return `<div class="dialog-host">${under ? `<div class="dialog-under" inert aria-hidden="true">${under}</div>` : ''}<div class="dialog-scrim" data-dialog><section class="dialog panel ${cls}" role="dialog" aria-modal="true" aria-labelledby="ui-dialog-title"${attrStr({ 'aria-label': label })}>
    ${sheetHead({ kick, title, id: 'ui-dialog-title' })}${body ? `<div class="dialog__body">${body}</div>` : ''}${actions ? `<div class="dialog__actions">${actions}</div>` : ''}${foot ? `<footer class="dialog__foot">${foot}</footer>` : ''}</section></div></div>`;
}
/** a car tile for every car grid (garage, lobby car picks): thumbnail, name, class / trims line, HP + weight, drive badge */
export function carCard({ id, name = '', line = '', hp, kg, drive = '', locked = false, lockLabel = '', act = 'carDetail', selected, attrs, cls = '' } = {}) {
  return card({ cls: `card--car car-card ${locked ? 'off' : ''} ${cls}`, act, selected, attrs,
    media: `<img data-car-thumb="${esc(id)}" alt="${esc(name)}" />`, badge: drive ? badge(esc(drive)) : '', title: name, text: line,
    foot: `<span class="car-card__spec"><b>${hp} HP</b><span>${kg} KG</span></span>${locked && lockLabel ? badge(esc(lockLabel), '', 'lock-simple') : ''}` });
}
/** an inline search box (a text focus row without a label): the magnifier, the input, the kit's pill shape */
export function searchField({ name, label = 'Search', value = '', placeholder = 'SEARCH', icon: ic = 'magnifying-glass', inputAttrs, cls = '' } = {}) {
  const input = `<input class="search__input"${attrStr({ 'data-field': name, value, placeholder, type: 'search', 'aria-label': label, autocomplete: 'off', spellcheck: 'false', ...inputAttrs })}>`;
  return `<div class="mi search ${cls}" data-kind="text" data-fid="${esc(name)}">${icon(ic)}${input}</div>`;
}
/** a number plate: the driver's plate drawn as a plate (EU style: blue GR band, black on white) */
export const plate = (text, cls = '') => `<span class="plate ${cls}"><i class="plate__band" aria-hidden="true">GR</i><b class="plate__text">${esc(text)}</b></span>`;
/** the ASR mark (assets/icon.svg, also the favicon) */
export const brandMark = (cls = '') => `<img class="brand-mark ${cls}" src="${new URL('../../assets/icon.svg', import.meta.url).href}" alt="" draggable="false"/>`;
export const wordmark = (cls = '') => `<span class="wordmark ${cls}"><b>ATHENS</b><b>RACING</b></span>`;

// ------------------------------------------------------------------ interactive builders (menu rows)
/** a labelled row: field('MASTER', control, { icon, note, kind, key, attrs }) */
export function field(label, control, { icon: ic, note = '', noteCls = '', kind, key, attrs, cls = '', type } = {}) {
  return `<div class="mi field ${cls}"${attrStr({ 'data-kind': kind, 'data-key': key, 'data-type': type, ...attrs })}><span class="field__label">${icon(ic)}<span>${label}</span></span><div class="field__ctl">${control}</div>${note ? `<small class="field__note ${noteCls}">${note}</small>` : ''}</div>`;
}
function sliderInner({ value, min, max, format, showValue = true }) {
  const t = max > min ? (value - min) / (max - min) : 0;
  return `<div class="slider" role="slider" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" style="--v:${clamp(t, 0, 1)}"><div class="slider__track"><i class="slider__fill"></i><i class="slider__thumb"></i></div>${showValue ? `<output class="slider__val">${fmt(format, value)}</output>` : ''}</div>`;
}
export function slider({ key, label, value = 0, min = 0, max = 1, step = 0.05, format = 'pct', icon: ic, note, attrs, cls } = {}) {
  return field(label, sliderInner({ value, min, max, format }), { icon: ic, note, cls, kind: 'slider', key, type: 'num', attrs: { 'data-value': value, 'data-min': min, 'data-max': max, 'data-step': step, 'data-fmt': format, ...attrs } });
}
export function toggle({ key, label, value = false, on = 'ON', off = 'OFF', icon: ic, note, attrs, cls } = {}) {
  return field(label, `<div class="switch ${value ? 'on' : ''}" role="switch" aria-checked="${!!value}"><span class="switch__track"><i class="switch__knob"></i></span><span class="switch__txt" data-on="${esc(on)}" data-off="${esc(off)}">${value ? on : off}</span></div>`,
    { icon: ic, note, cls, kind: 'toggle', key, type: 'bool', attrs: { 'data-value': String(!!value), ...attrs } });
}
/** the one "selected" surface of a tab bar / sidebar / segmented control: it slides to the chosen item (indicators()) */
const IND = '<i class="sel-ind" data-ui-keep="ind" aria-hidden="true"></i>';
const segOpts = (options, value, dflt) => options.map(([v, l, ic]) => `<span class="seg__opt ${String(v) === String(value) ? 'on' : ''} ${dflt != null && String(v) === String(dflt) ? 'dflt' : ''}" data-v="${esc(v)}">${icon(ic)}${l}</span>`).join('');
/** options: [[value, label, icon?]]; dflt marks the event / factory default with a dot */
export function segmented({ key, label, value, options, icon: ic, note, noteCls, dflt, type, attrs, cls } = {}) {
  return field(label, `<div class="seg" role="radiogroup">${IND}${segOpts(options, value, dflt)}</div>`, { icon: ic, note, noteCls, cls, kind: 'choice', key, type, attrs: { 'data-value': value, ...attrs } });
}
/** numeric (min / max / step / format) or a list (options: [[value, label]]) */
export function stepper({ key, label, value, min, max, step = 1, format = 'int', options, icon: ic, note, noteCls, type, attrs } = {}) {
  const list = options ? JSON.stringify(options) : null;
  const shown = options ? (options.find(([v]) => String(v) === String(value))?.[1] ?? value) : fmt(format, value);
  const i = options ? options.findIndex(([v]) => String(v) === String(value)) : -1;
  const atMin = options ? i <= 0 : value <= min, atMax = options ? i >= options.length - 1 : value >= max;
  return field(label, `<div class="stepper"><span class="stepper__btn ${atMin ? 'off' : ''}" data-step="-1" role="button" aria-label="Decrease">${icon('caret-left')}</span><b class="stepper__val">${shown}</b><span class="stepper__btn ${atMax ? 'off' : ''}" data-step="1" role="button" aria-label="Increase">${icon('caret-right')}</span></div>`,
    { icon: ic, note, noteCls, kind: 'stepper', key, type: type || (options ? null : 'num'), attrs: { 'data-value': value, 'data-min': min, 'data-max': max, 'data-step': step, 'data-fmt': format, 'data-options': list, ...attrs } });
}
/** a custom dropdown: confirm / click opens the list; left / right cycles it closed */
export function select({ key, label, value, options, icon: ic, note, type, attrs, compact = false } = {}) {
  const cur = options.find(([v]) => String(v) === String(value));
  // compact: no row, just the select pill with its label inside (toolbars: the garage filters)
  return field(label, `<div class="select" role="combobox" aria-haspopup="listbox" aria-expanded="false">${compact ? `<span class="select__k">${label}</span>` : ''}<span class="select__val">${cur ? cur[1] : ''}</span>${icon('caret-down')}</div>`,
    { icon: ic, note, kind: 'select', key, type, cls: compact ? 'field--bare' : '', attrs: { 'data-value': value, 'data-options': JSON.stringify(options), ...attrs } });
}
/** a tab bar: one focus item; left / right (and Q / E · LB / RB in the menus) switch */
export function tabs({ key, value, options, cls = '', hint = true, vertical = false } = {}) {
  if (vertical) cls += ' tabs--rail';
  const h = hint ? `<span class="tabs__hint on-key" aria-hidden="true">${kbd('Q')}</span><span class="tabs__hint on-pad" aria-hidden="true">${kbd('LB', true)}</span>` : '';
  const h2 = hint ? `<span class="tabs__hint on-key" aria-hidden="true">${kbd('E')}</span><span class="tabs__hint on-pad" aria-hidden="true">${kbd('RB', true)}</span>` : '';
  return `<div class="mi tabs ${cls}" data-kind="tabs" data-key="${esc(key)}" data-value="${esc(value)}" role="tablist">${IND}${h}${options.map(([v, l, ic]) => `<span class="tab ${String(v) === String(value) ? 'on' : ''}" data-v="${esc(v)}" role="tab" aria-selected="${String(v) === String(value)}">${icon(ic)}${l}</span>`).join('')}${h2}</div>`;
}

// ------------------------------------------------------------------ values
const parse = (el, v) => {
  const t = el.dataset.type;
  if (v === 'null') return null;
  if (t === 'num') return +v;
  if (t === 'bool') return v === true || v === 'true';
  return v;
};
export function getValue(el) { return parse(el, el.dataset.value); }
function optionsOf(el) {
  if (el.dataset.options) { try { return JSON.parse(el.dataset.options); } catch { return []; } }
  return [...el.querySelectorAll('[data-v]')].map((o) => [o.dataset.v, o.textContent]);
}
function emit(el, value) { el.dispatchEvent(new CustomEvent('ui:change', { bubbles: true, detail: { key: el.dataset.key, value, el } })); }
/** set a row's value and refresh its visuals; emit = fire 'ui:change' */
export function setValue(el, v, doEmit = true) {
  const kind = el.dataset.kind;
  if (kind === 'slider') {
    const min = +el.dataset.min, max = +el.dataset.max, step = +el.dataset.step || 0;
    v = clamp(+v, min, max); if (step) v = Math.round((v - min) / step) * step + min; v = +v.toFixed(6);
    const s = el.querySelector('.slider'); s?.style.setProperty('--v', max > min ? (v - min) / (max - min) : 0); s?.setAttribute('aria-valuenow', v);
    const o = el.querySelector('.slider__val'); if (o) o.textContent = fmt(el.dataset.fmt, v);
  } else if (kind === 'toggle') {
    v = v === true || v === 'true';
    const s = el.querySelector('.switch'); s?.classList.toggle('on', v); s?.setAttribute('aria-checked', v);
    const t = el.querySelector('.switch__txt'); if (t) t.textContent = v ? t.dataset.on : t.dataset.off;
  } else if (kind === 'choice' || kind === 'tabs') {
    for (const o of el.querySelectorAll('[data-v]')) { const on = o.dataset.v === String(v); o.classList.toggle('on', on); if (kind === 'tabs') o.setAttribute('aria-selected', on); }
    indicators(el);
  } else if (kind === 'stepper') {
    const list = el.dataset.options ? optionsOf(el) : null, val = el.querySelector('.stepper__val');
    let atMin, atMax;
    if (list) { const i = list.findIndex(([x]) => String(x) === String(v)); if (val) val.textContent = list[i]?.[1] ?? v; atMin = i <= 0; atMax = i >= list.length - 1; }
    else { v = clamp(+v, +el.dataset.min, +el.dataset.max); if (val) val.textContent = fmt(el.dataset.fmt, v); atMin = v <= +el.dataset.min; atMax = v >= +el.dataset.max; }
    const [a, b] = el.querySelectorAll('.stepper__btn'); a?.classList.toggle('off', atMin); b?.classList.toggle('off', atMax);
  } else if (kind === 'select') {
    const cur = optionsOf(el).find(([x]) => String(x) === String(v)); const val = el.querySelector('.select__val'); if (val && cur) val.textContent = cur[1];
  }
  const changed = el.dataset.value !== String(v);
  el.dataset.value = String(v);
  if (doEmit && changed) emit(el, parse(el, String(v)));
  return changed;
}
/** left / right on a row. Returns true if the row is adjustable */
export function step(el, d) {
  if (el?.localName === 'ui-select') return el.step(d);
  const kind = el?.dataset.kind; if (!kind || kind === 'text') return false;
  if (kind === 'slider') { setValue(el, +el.dataset.value + d * (+el.dataset.step || 0.05)); return true; }
  if (kind === 'toggle') { setValue(el, !(el.dataset.value === 'true')); return true; }
  if (kind === 'stepper' && !el.dataset.options) { setValue(el, +el.dataset.value + d * (+el.dataset.step || 1)); return true; }
  if (kind === 'stepper' && el.dataset.options) { // lists stop at the ends, like the numeric stepper
    const opts = optionsOf(el).map(([v]) => String(v)), i = opts.indexOf(el.dataset.value);
    const j = clamp(i + d, 0, opts.length - 1); if (j !== i) setValue(el, opts[j]); return true;
  }
  if (kind === 'choice' || kind === 'select' || kind === 'tabs') {
    const opts = (kind === 'select' ? optionsOf(el).filter((o) => !o[2]?.disabled) : optionsOf(el)).map(([v]) => String(v));
    const i = opts.indexOf(el.dataset.value); setValue(el, opts[(i + d + opts.length) % opts.length]); return true;
  }
  return false;
}
/** confirm on a row */
export function activate(el) {
  if (el?.localName === 'ui-select') { el.open(); return true; }
  const kind = el?.dataset.kind; if (!kind) return false;
  if (kind === 'text') { const input = el.querySelector('input'); if (input && document.activeElement !== input) { input.focus(); input.select?.(); } return true; }
  if (kind === 'select') { openListbox(el); return true; }
  if (kind === 'slider') return true;
  return step(el, 1);
}

// ------------------------------------------------------------------ pointer: clicks on segment / stepper / switch / tab / select, slider drags
/** route a click inside a component row; true if it was handled */
export function handleClick(e) {
  const row = e.target.closest?.('[data-kind]'); if (!row) return false;
  const kind = row.dataset.kind;
  if (kind === 'choice' || kind === 'tabs') { const o = e.target.closest('[data-v]'); if (o) setValue(row, o.dataset.v); return true; }
  if (kind === 'stepper') { const b = e.target.closest('.stepper__btn'); if (b) step(row, +b.dataset.step); return true; }
  if (kind === 'toggle') { step(row, 1); return true; }
  if (kind === 'select') { openListbox(row); return true; }
  if (kind === 'slider') return true; // pointerdown handles it
  if (kind === 'text') { if (e.target.localName !== 'input') activate(row); return true; }
  return false;
}
function dragSlider(e, el, track, onValue, onDone) {
  if (e.button > 0) return;
  e.preventDefault();
  const min = +el.dataset.min, max = +el.dataset.max;
  const at = (ev) => { const r = track.getBoundingClientRect(); return min + clamp((ev.clientX - r.left) / Math.max(1, r.width), 0, 1) * (max - min); };
  const slider = track.closest('.slider'); slider?.classList.add('dragging');
  try { track.setPointerCapture(e.pointerId); } catch {}
  onValue(at(e));
  const move = (ev) => { if (ev.pointerId === e.pointerId) onValue(at(ev)); };
  const up = (ev) => { if (ev.pointerId !== e.pointerId) return; track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); slider?.classList.remove('dragging'); onDone?.(); };
  track.addEventListener('pointermove', move); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
}
/** once per container that renders builder markup (the menu root) */
// ------------------------------------------------------------------ morph (in-place re-render)
/** Patch `root`'s children to match `html` without rebuilding unchanged nodes, so a value change only touches the
 *  rows that differ: focus, scroll, running transitions and loaded images stay put. Kept as they are: the `focus`
 *  class (Menu.setFocus owns it), an <img> src set at runtime, and any subtree marked data-ui-keep (mounted by
 *  another module). */
export function morph(root, html) {
  const t = document.createElement('template'); t.innerHTML = html; patchChildren(root, t.content);
}
function patchChildren(from, to) {
  const keep = [...from.childNodes].filter((n) => n.nodeType === 1 && n.hasAttribute('data-ui-keep'));
  // a keyed keep node (data-ui-keep="ind") in the new markup stands for the live one already here, which keeps its state
  const keys = new Set(keep.map((n) => n.getAttribute('data-ui-keep')).filter(Boolean));
  const next = [...to.childNodes].filter((n) => !(n.nodeType === 1 && keys.has(n.getAttribute('data-ui-keep'))));
  let cur = [...from.childNodes].filter((n) => !keep.includes(n));
  next.forEach((n, i) => {
    const old = cur[i];
    if (!old) { from.append(n); return; }
    if (old.nodeType !== n.nodeType || old.nodeName !== n.nodeName || (old.nodeType === 1 && (old.id !== n.id || old.getAttribute('data-car-thumb') !== n.getAttribute('data-car-thumb')))) { from.replaceChild(n, old); return; }
    if (old.nodeType === 3 || old.nodeType === 8) { if (old.nodeValue !== n.nodeValue) old.nodeValue = n.nodeValue; return; }
    patchAttrs(old, n); patchChildren(old, n);
  });
  for (const n of cur.slice(next.length)) n.remove();
}
function patchAttrs(old, n) {
  for (const { name } of [...old.attributes]) if (!n.hasAttribute(name) && !(name === 'src' && old.nodeName === 'IMG')) old.removeAttribute(name);
  for (const { name, value } of [...n.attributes]) {
    if (name === 'class') { const v = old.classList.contains('focus') && !n.classList.contains('focus') ? value + ' focus' : value; if (old.getAttribute('class') !== v) old.setAttribute('class', v); }
    else if (old.getAttribute(name) !== value) old.setAttribute(name, value);
  }
  if (old.nodeName === 'INPUT' && old !== document.activeElement && old.value !== (n.getAttribute('value') ?? '')) old.value = n.getAttribute('value') ?? '';
}

/** slide every selection indicator under root to its chosen item. The first placement does not animate; later ones
 *  glide (ui.css .sel-ind), because the indicator node survives in-place refreshes (morph keeps data-ui-keep="ind"). */
export function indicators(root) {
  if (!root?.querySelectorAll) return;
  const bars = root.matches?.('.tabs, .seg') ? [root] : root.querySelectorAll('.tabs, .seg');
  for (const bar of bars) {
    const ind = bar.querySelector(':scope > .sel-ind'); if (!ind) continue;
    const on = bar.querySelector(':scope > .on, :scope > [data-v].on');
    if (!on || !on.offsetParent) { ind.style.opacity = '0'; continue; }
    const x = on.offsetLeft, y = on.offsetTop, w = on.offsetWidth, h = on.offsetHeight;
    const first = !ind.dataset.placed;
    if (first) ind.style.transition = 'none';
    ind.style.transform = `translate(${x}px, ${y}px)`; ind.style.width = w + 'px'; ind.style.height = h + 'px'; ind.style.opacity = '1';
    if (first) { void ind.offsetWidth; ind.style.transition = ''; ind.dataset.placed = '1'; }
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let raf = 0; const all = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => indicators(document)); };
  addEventListener('resize', all); document.fonts?.ready?.then(all);
}
export function bindRoot(root) {
  if (root.__uiBound) return; root.__uiBound = true;
  root.addEventListener('pointerdown', (e) => {
    const track = e.target.closest?.('.field[data-kind=slider] .slider'); if (!track) return;
    const el = track.closest('[data-kind=slider]');
    dragSlider(e, el, track.querySelector('.slider__track') || track, (v) => setValue(el, v));
  });
}

// ------------------------------------------------------------------ listbox (the open state of a select)
let lb = null; // { el (row or enhanced select), box, opts, hi, onPick, onClose }
function layer() {
  let l = document.getElementById('ui-layer');
  if (!l) { l = document.createElement('div'); l.id = 'ui-layer'; document.body.append(l); }
  return l;
}
function openListbox(anchorEl, { options, value, onPick, anchor } = {}) {
  closeListbox();
  const opts = options || optionsOf(anchorEl), cur = String(value ?? anchorEl.dataset.value);
  const box = document.createElement('div'); box.className = 'listbox'; box.setAttribute('role', 'listbox');
  box.innerHTML = opts.map(([v, l, o], i) => `<div class="listbox__opt ${String(v) === cur ? 'sel' : ''} ${o?.disabled ? 'dis' : ''}" role="option" data-i="${i}" aria-selected="${String(v) === cur}"><span>${l}</span>${icon('check')}</div>`).join('');
  const scrim = document.createElement('div'); scrim.style.cssText = 'position:fixed;inset:0;pointer-events:auto';
  scrim.addEventListener('pointerdown', (e) => { if (!box.contains(e.target)) { e.preventDefault(); closeListbox(); } });
  scrim.append(box); layer().append(scrim);
  const a = (anchor || anchorEl.querySelector('.select') || anchorEl).getBoundingClientRect();
  const w = Math.max(a.width, box.offsetWidth), vh = innerHeight, below = vh - a.bottom - 8, above = a.top - 8;
  box.style.minWidth = a.width + 'px';
  box.style.left = clamp(a.right - w, 8, innerWidth - w - 8) + 'px';
  if (below >= Math.min(box.offsetHeight, 240) || below >= above) { box.style.top = (a.bottom + 4) + 'px'; box.style.maxHeight = Math.max(120, below) + 'px'; }
  else { box.style.bottom = (vh - a.top + 4) + 'px'; box.style.maxHeight = Math.max(120, above) + 'px'; }
  const sel = anchorEl.querySelector('.select') || anchorEl; sel.classList.add('open'); sel.setAttribute('aria-expanded', 'true');
  lb = { el: anchorEl, sel, scrim, box, opts, hi: Math.max(0, opts.findIndex(([v]) => String(v) === cur)), onPick: onPick || ((v) => setValue(anchorEl, v)) };
  box.addEventListener('pointermove', (e) => { const o = e.target.closest('.listbox__opt'); if (o) hilite(+o.dataset.i); });
  box.addEventListener('click', (e) => { const o = e.target.closest('.listbox__opt'); if (o) pick(+o.dataset.i); });
  hilite(lb.hi);
}
function hilite(i) {
  if (!lb) return; const n = lb.opts.length; if (!n) return;
  lb.hi = (i + n) % n;
  [...lb.box.children].forEach((c, k) => c.classList.toggle('hi', k === lb.hi));
  lb.box.children[lb.hi]?.scrollIntoView({ block: 'nearest' });
}
function pick(i) { if (!lb) return; const o = lb.opts[i]; if (!o || o[2]?.disabled) return; const fn = lb.onPick; closeListbox(); fn(o[0]); }
export function closeListbox() {
  if (!lb) return; lb.sel.classList.remove('open'); lb.sel.setAttribute('aria-expanded', 'false');
  const { scrim, box } = lb; scrim.style.pointerEvents = 'none'; box.classList.add('is-closing'); setTimeout(() => scrim.remove(), 140); // the list folds away (ui.css)
  const done = lb.onClose; lb = null; done?.();
}
export const listboxOpen = () => !!lb;

// ------------------------------------------------------------------ <ui-select>: the dropdown for DOM other modules own
// There are no native select elements in the game. Code that builds its own DOM (the standings' spectator pick,
// multiplayer transport state) uses <ui-select>: the same API as a native select
// (value, selectedIndex, options, disabled, <option> children, 'input' / 'change' events, onchange) drawn as the kit's
// Select with the animated listbox, keyboard / gamepad / touch alike. Menu screens use the select() row builder.
// With class "mi" it is also a menu focus item: OK opens it, left / right cycle it.
if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined' && !customElements.get('ui-select')) {
  class UISelect extends HTMLElement {
    static get observedAttributes() { return ['disabled']; }
    constructor() { super(); this._sel = null; this._init = false; }
    connectedCallback() {
      if (!this._init) {
        this._init = true;
        for (const p of ['value', 'selectedIndex', 'disabled']) if (Object.prototype.hasOwnProperty.call(this, p)) { const v = this[p]; delete this[p]; this[p] = v; }
        this.classList.add('select'); if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
        if (this.classList.contains('mi') && !this.dataset.kind) this.dataset.kind = 'uiselect'; // a menu row: activate / step route here
        this.setAttribute('role', 'combobox'); this.setAttribute('aria-haspopup', 'listbox'); this.setAttribute('aria-expanded', 'false');
        this.addEventListener('click', (e) => { e.preventDefault(); this.open(); });
        this.addEventListener('keydown', (e) => {
          if (lb?.el === this) {
            if (e.key === 'ArrowDown') hilite(lb.hi + 1); else if (e.key === 'ArrowUp') hilite(lb.hi - 1);
            else if (e.key === 'Enter' || e.key === ' ') pick(lb.hi); else if (e.key === 'Escape' || e.key === 'Tab') closeListbox(); else return;
            e.preventDefault(); e.stopPropagation(); return;
          }
          if (this.classList.contains('mi')) return; // a menu item: the menu routes its keys
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.open(); }
        });
        new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['selected', 'value', 'label', 'disabled'] });
      }
      this.sync();
    }
    attributeChangedCallback() { if (this._init) this.sync(); }
    get options() { return [...this.children].filter((n) => n.localName === 'option'); }
    current() { const o = this.options; return (this._sel && this._sel.parentNode === this && this._sel) || o.find((x) => x.hasAttribute('selected')) || o[0] || null; }
    get value() { return this.current()?.value ?? ''; }
    set value(v) { this._sel = this.options.find((o) => o.value === String(v)) || null; this.sync(); }
    get selectedIndex() { return this.options.indexOf(this.current()); }
    set selectedIndex(i) { this._sel = this.options[i] || null; this.sync(); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { this.toggleAttribute('disabled', !!v); }
    sync() {
      if (!this._init) return;
      let val = this.querySelector(':scope > .select__val');
      if (!val) { // the visible parts; data-ui-keep so an in-place patch of the owner's markup leaves them alone
        const t = document.createElement('template'); t.innerHTML = `<span class="select__val" data-ui-keep></span>${icon('caret-down')}`;
        t.content.lastChild.setAttribute('data-ui-keep', ''); this.prepend(...t.content.childNodes); val = this.querySelector(':scope > .select__val');
      }
      const text = this.current()?.textContent || ''; if (val.textContent !== text) val.textContent = text;
      const off = this.disabled; if (this.classList.contains('off') !== off) this.classList.toggle('off', off);
      if (this.getAttribute('aria-disabled') !== String(off)) this.setAttribute('aria-disabled', String(off));
    }
    choose(v) { if (String(v) === this.value) return; this.value = v; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); }
    open() {
      if (this.disabled || lb?.el === this) return; const opts = this.options; if (!opts.length) return;
      openListbox(this, { anchor: this, options: opts.map((o) => [o.value, esc(o.textContent), { disabled: o.disabled }]), value: this.value, onPick: (v) => this.choose(v) });
      lb.onClose = () => { if (!this.classList.contains('mi')) this.focus({ preventScroll: true }); };
    }
    step(d) { const opts = this.options.filter((o) => !o.disabled), i = opts.indexOf(this.current()), o = opts[clamp(i + d, 0, opts.length - 1)]; if (o) this.choose(o.value); return true; }
  }
  customElements.define('ui-select', UISelect);
}

// ------------------------------------------------------------------ modal prompt + toasts
let modal = null; // { root, actions, focus, resolve, dismissible, timer }
function renderModalFocus() { modal?.buttons.forEach((b, i) => b.classList.toggle('focus', i === modal.focus)); }
function closePrompt(result = null) {
  if (!modal) return; const m = modal; modal = null;
  clearTimeout(m.timer); m.root.remove(); m.resolve(result);
}
function prompt({ title = '', body = '', icon: ic = 'info', actions = [{ id: 'ok', label: 'OK', variant: 'primary' }], dismissible = true, timeout = 0, timeoutId = null, hints = true } = {}) {
  if (modal) closePrompt(null);
  closeListbox();
  return new Promise((resolve) => {
    const root = document.createElement('div'); root.className = 'modal-scrim';
    root.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal__head">${ic ? `<span class="modal__ico">${icon(ic)}</span>` : ''}<h2 class="modal__title">${esc(title)}</h2></div>${body ? `<p class="modal__body">${body}</p>` : ''}
      <div class="modal__actions">${actions.map((a, i) => button({ label: esc(a.label), icon: a.icon, variant: a.variant || (i === 0 ? 'primary' : 'secondary'), focusable: false, attrs: { 'data-i': i } })).join('')}</div>
      ${hints ? `<div class="modal__foot">${keyHints([['leftright', 'CHOOSE'], ['confirm', 'OK'], ...(dismissible ? [['back', 'CANCEL']] : [])])}</div>` : ''}</div>`;
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) closePrompt(actions[+b.dataset.i].id); else if (dismissible && e.target === root) closePrompt(null); });
    root.addEventListener('pointermove', (e) => { const b = e.target.closest('[data-i]'); if (b && modal) { modal.focus = +b.dataset.i; renderModalFocus(); } });
    layer().append(root);
    const buttons = [...root.querySelectorAll('[data-i]')];
    modal = { root, buttons, actions, focus: Math.max(0, actions.findIndex((a) => a.default)), resolve, dismissible };
    if (timeout > 0) modal.timer = setTimeout(() => closePrompt(timeoutId), timeout);
    renderModalFocus();
  });
}
function toast(text, options = {}) {
  return raceNotificationsActive()?notifications.toast(text,options):notifications.menuFeedback(text,options);
}
/** a named input action (main.js flowAction / src/menu.js). true = an overlay used it */
function action(name) {
  if (lb) {
    if (name === 'up' || name === 'left') hilite(lb.hi - 1);
    else if (name === 'down' || name === 'right') hilite(lb.hi + 1);
    else if (name === 'confirm') pick(lb.hi);
    else if (name === 'back' || name === 'pause') closeListbox();
    return true;
  }
  if (!modal) return false;
  const n = modal.actions.length;
  if (name === 'left' || name === 'up') { modal.focus = (modal.focus - 1 + n) % n; renderModalFocus(); }
  else if (name === 'right' || name === 'down') { modal.focus = (modal.focus + 1) % n; renderModalFocus(); }
  else if (name === 'confirm') closePrompt(modal.actions[modal.focus].id);
  else if ((name === 'back' || name === 'pause') && modal.dismissible) closePrompt(null);
  return true; // a modal swallows everything else
}
// which hints to show: a touch tap since the last key press means touch (main.js passes the gamepad / keyboard device)
let lastPointer = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches ? 'touch' : null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType === 'touch' ? 'touch' : null; }, true);
  window.addEventListener('keydown', () => { lastPointer = null; }, true);
}
/** the device the key hints should be drawn for: 'gamepad' wins, then a recent touch, else the given device */
const hintDevice = (device = 'keyboard') => device === 'gamepad' ? 'gamepad' : lastPointer || device;
export const ui = {
  prompt, closePrompt, toast, action, closeListbox, hintDevice,
  get modalOpen() { return !!modal; }, get overlayOpen() { return !!modal || !!lb; },
};
if (typeof window !== 'undefined') window.__ui = ui;

// ------------------------------------------------------------------ enhance native controls in DOM owned by other modules
function mirror(el, prop, after) {
  const proto = Object.getPrototypeOf(el), d = Object.getOwnPropertyDescriptor(proto, prop) || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop);
  if (!d?.set) return;
  Object.defineProperty(el, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); after(); } });
  return (v) => d.set.call(el, v);
}
const keyStop = (e) => { e.stopPropagation(); };
function enhanceRange(input) {
  const el = document.createElement('div'); el.className = 'slider slider--bare'; el.tabIndex = 0; el.setAttribute('role', 'slider');
  if (input.getAttribute('aria-label')) el.setAttribute('aria-label', input.getAttribute('aria-label'));
  el.innerHTML = '<div class="slider__track"><i class="slider__fill"></i><i class="slider__thumb"></i></div>';
  const lim = () => ({ min: +input.min || 0, max: input.max === '' ? 100 : +input.max, step: input.step === 'any' ? 0 : (+input.step || 1) });
  const sync = () => { const { min, max } = lim(), v = +input.value; el.style.setProperty('--v', max > min ? clamp((v - min) / (max - min), 0, 1) : 0); el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max); };
  const set = mirror(input, 'value', sync) || ((v) => { input.value = v; });
  const put = (v, done) => { const { min, max, step } = lim(); v = clamp(v, min, max); if (step) v = Math.round((v - min) / step) * step + min; const s = String(+v.toFixed(6)); if (s !== input.value) { set(s); sync(); input.dispatchEvent(new Event('input', { bubbles: true })); } if (done) input.dispatchEvent(new Event('change', { bubbles: true })); };
  el.dataset.min = 0; el.dataset.max = 1;
  el.addEventListener('pointerdown', (e) => {
    const track = el.querySelector('.slider__track'), { min, max } = lim();
    el.dataset.min = min; el.dataset.max = max;
    dragSlider(e, el, track, (v) => put(v), () => put(+input.value, true));
    el.focus({ preventScroll: true });
  });
  el.addEventListener('keydown', (e) => {
    keyStop(e); const { min, max, step } = lim(), s = step || (max - min) / 100;
    const k = { ArrowRight: s, ArrowUp: s, ArrowLeft: -s, ArrowDown: -s, PageUp: s * 10, PageDown: -s * 10 }[e.key];
    if (k) put(+input.value + k, true); else if (e.key === 'Home') put(min, true); else if (e.key === 'End') put(max, true); else return;
    e.preventDefault();
  });
  input.classList.add('ui-native'); input.tabIndex = -1; input.before(el); sync();
}
function enhanceCheckbox(input) {
  const sw = document.createElement('span'); sw.className = 'switch'; sw.tabIndex = 0; sw.setAttribute('role', 'switch');
  sw.innerHTML = '<span class="switch__track"><i class="switch__knob"></i></span>';
  const sync = () => { sw.classList.toggle('on', input.checked); sw.setAttribute('aria-checked', input.checked); sw.classList.toggle('off', input.disabled); };
  mirror(input, 'checked', sync); input.addEventListener('change', sync);
  // inside a <label> the label already forwards the click to the checkbox
  sw.addEventListener('click', (e) => { if (!input.closest('label')) { e.preventDefault(); input.click(); } });
  sw.addEventListener('keydown', (e) => { keyStop(e); if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); input.click(); } });
  input.classList.add('ui-native'); input.tabIndex = -1; input.after(sw); sync();
}
/** replace the native controls under root with the custom components (idempotent) */
export function enhance(root) {
  for (const el of root.querySelectorAll('input[type=range]:not([data-ui])')) { el.dataset.ui = '1'; enhanceRange(el); }
  for (const el of root.querySelectorAll('input[type=checkbox]:not([data-ui])')) { el.dataset.ui = '1'; enhanceCheckbox(el); }
  for (const el of root.querySelectorAll('input:not([type]):not([data-ui]), input[type=text]:not([data-ui]), input[type=search]:not([data-ui])')) { el.dataset.ui = '1'; el.classList.add('ui-text'); }
}
/** enhance now and whenever the owner re-renders */
export function autoEnhance(root) {
  if (!root || root.__uiAuto) return; root.__uiAuto = true;
  enhance(root);
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; enhance(root); }); }).observe(root, { childList: true, subtree: true });
}

// the stylesheet travels with the module
if (typeof document !== 'undefined' && !document.getElementById('ui-kit-css')) {
  const link = document.createElement('link'); link.id = 'ui-kit-css'; link.rel = 'stylesheet'; link.href = new URL('./ui.css', import.meta.url).href;
  document.head.prepend(link);
}
