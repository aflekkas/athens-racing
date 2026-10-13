// MENUS: title / mode select, the event list, settings, the pause menu and the per-event results screen.
// Plain DOM in #ui (index.html), styled by src/menu.css. Navigation: mouse, or the named input actions that
// main.js routes here (up / down / left / right / confirm / back) from keyboard, gamepad and touch.
// Menu items are not native <button>s on purpose: the input system ignores key events aimed at focused form
// controls, so focus is drawn with a class and the keys keep flowing through flowAction().
import { getEvents, QUICK_RACE, TYPES, getEvent, resolve, loadRecord, targetLabels, MEDALS } from './events.js';
import { settings, setSetting, fmtDist } from './settings.js';

import { renderMapSelect, selectMap } from './map-select.js';
import { CARS } from './cars.js';
import { renderCarSelect, mountCarSelect } from './car-select.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MEDAL_ICON = (m, cls = '') => `<i class="medal ${m || 'none'} ${cls}" title="${m ? m.toUpperCase() : 'NO MEDAL'}"></i>`;
const pct = (v) => Math.round(v * 100) + '%';
const TRAFFIC = (d) => (d <= 0 ? 'CLOSED ROAD' : d < 0.6 ? 'LIGHT TRAFFIC' : d < 1.2 ? 'TRAFFIC' : 'HEAVY TRAFFIC');

export class Menu {
  /**
   * root: the #ui element. h: handlers from main.js
   *   quickRace(), openEvent(id), chooseCar(index, def, garage), multiplayer(), garage(), resume(), restart(), quit(), next(id)
   *   ctx() -> resolve context { route, marks }, carName() -> string, fmtTime(t), ui(forward) (click sound)
   *   bindings(containerEl) (mount the input agent's rebinding table), graphicsControl (the existing <select>)
   */
  constructor(root, h) {
    this.root = root; this.h = h; this.screen = null; this.data = {}; this.focus = 0; this.stack = [];
    this.filter = 'all'; this.evFocus = 0;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('pointermove', (e) => { const it = e.target.closest?.('.mi'); if (it && this.items().includes(it)) this.setFocus(this.items().indexOf(it), false); });
    root.addEventListener('input', (e) => { const r = e.target.closest?.('input[type=range][data-set]'); if (r) setSetting(r.dataset.set, +r.value / 100); this.refreshValues(); });
    root.addEventListener('change', (e) => { if (e.target.matches?.('input[type=range]')) e.target.blur(); });
  }
  get open() { return !!this.screen; }

  // ---------------------------------------------------------------- show / hide
  show(screen, data = {}, push = false) {
    if (screen === 'events' && this.screen === 'maps') data = { ...data, mode: this.data.mode };
    this.leaving();
    if (push && this.screen) this.stack.push({ screen: this.screen, data: this.data, focus: this.focus });
    if (!push) this.stack.length = 0;
    this.screen = screen; this.data = data; this.focus = data.focus ?? 0;
    this.render();
    document.body.classList.add('ui-open');
    document.body.dataset.ui = screen;
  }
  pop() {
    const prev = this.stack.pop(); if (!prev) return false;
    this.leaving();
    this.screen = prev.screen; this.data = prev.data; this.focus = prev.focus; this.render(); document.body.dataset.ui = this.screen;
    return true;
  }
  hide() {
    this.leaving();
    this.screen = null; this.stack.length = 0; this.root.innerHTML = '';
    document.body.classList.remove('ui-open'); delete document.body.dataset.ui;
  }
  render() {
    this.carView?.dispose(); this.carView = null;
    const fn = this['r_' + this.screen]; this.root.innerHTML = fn ? fn.call(this, this.data) : '';
    this.root.className = 's-' + this.screen;
    if (this.screen === 'settings') this.mountSettings();
    if (this.screen === 'car') this.carView = mountCarSelect(this.root, this.data.index || 0);
    this.setFocus(this.screen === 'car' ? this.items().findIndex(el => el.dataset.act === 'carConfirm') : Math.min(this.focus, Math.max(0, this.items().length - 1)), false);
  }
  items() { return [...this.root.querySelectorAll('.mi:not(.off)')]; }
  setFocus(i, scroll = true) {
    const it = this.items(); if (!it.length) return;
    this.focus = (i + it.length) % it.length;
    for (const [k, el] of it.entries()) el.classList.toggle('focus', k === this.focus);
    const el = it[this.focus];
    if (scroll) el.scrollIntoView?.({ block: 'nearest' });
    if (this.screen === 'events' && el.dataset.ev) this.showDetail(el.dataset.ev);
  }

  // ---------------------------------------------------------------- input
  /** a named input action; true if the menu used it */
  action(name) {
    if (!this.screen) return false;
    const it = this.items(), cur = it[this.focus];
    if (name === 'up' || name === 'down') {
      // the event list is a grid of tabs on top + rows: up/down walk the rows
      this.setFocus(this.focus + (name === 'down' ? 1 : -1)); this.h.ui?.(name === 'down'); return true;
    }
    if (this.screen === 'car' && (name === 'left' || name === 'right')) { this.browseCar(name === 'right' ? 1 : -1); return true; }
    if (this.screen === 'car' && name === 'confirm' && !cur?.classList.contains('paint') && cur?.dataset.act !== 'back') { this.confirmCar(); return true; }
    if (name === 'left' || name === 'right') {
      const d = name === 'right' ? 1 : -1;
      if (cur?.dataset.kind) { this.adjust(cur, d); return true; }
      if (this.screen === 'events') { this.cycleFilter(d); return true; }
      return true;
    }
    if (name === 'confirm') { if (cur) this.activate(cur); return true; }
    if (name === 'back' || name === 'pause') { this.back(); return true; }
    return true; // menus swallow everything else (camera, tow, restart keys...)
  }
  back() {
    this.h.ui?.(false);
    if (this.screen === 'pause') { this.h.resume(); return; }
    if (this.screen === 'results') { this.h.quit('events'); return; }
    if (this.pop()) return;
    if (this.screen !== 'title') this.show('title');
  }
  onClick(e) {
    const g = e.target.closest?.('.gopt');
    if (g) { const ev = g.closest('[data-ghost-ev]').dataset.ghostEv; try { window.__replay?.selectGhost?.(ev, g.dataset.g === 'off' ? null : g.dataset.g); } catch (err) { console.warn(err); } this.showDetail(ev); return; }
    const el = e.target.closest?.('[data-act], [data-ev], [data-filter], [data-kind]'); if (!el || !this.root.contains(el)) return;
    const it = this.items(); if (it.includes(el)) this.setFocus(it.indexOf(el), false);
    if (el.dataset.kind && e.target.closest('.opt')) { const o = e.target.closest('.opt'); this.choose(el, o.dataset.v); return; }
    if (el.dataset.kind === 'range') return;
    this.activate(el);
  }
  activate(el) {
    if (el.dataset.mapId) { selectMap(this, el.dataset.mapId); return; }
    const a = el.dataset.act;
    this.h.ui?.(true);
    if (el.dataset.filter) { this.filter = el.dataset.filter; this.render(); return; }
    if (el.dataset.ev) { this.h.openEvent(el.dataset.ev); return; }
    if (el.dataset.kind) { this.adjust(el, 1); return; }
    switch (a) {
      case 'play': this.show('mode', {}, true); break;
      case 'quick': this.filter = 'sprint'; this.show('maps', { filter: 'sprint', mode: 'quick' }, true); break;
      case 'events': this.filter = 'all'; this.show('maps', { filter: 'all' }, true); break;
      case 'tt': this.filter = 'timetrial'; this.show('maps', { filter: 'timetrial' }, true); break;
      case 'carPrev': this.browseCar(-1); break;
      case 'carNext': this.browseCar(1); break;
      case 'carConfirm': this.confirmCar(); break;
      case 'paint': this.carView?.paint(el.dataset.color); for (const paint of this.root.querySelectorAll('.paint')) paint.classList.toggle('selected', paint === el); this.root.querySelector('.car-paint-name').textContent = el.title; break;
      case 'mp': this.h.multiplayer(); break;
      case 'garage': this.h.garage(); break;
      case 'settings': this.show('settings', {}, true); break;
      case 'back': this.back(); break;
      case 'resume': this.h.resume(); break;
      case 'restart': this.h.restart(); break;
      case 'quit': this.h.quit('title'); break;
      case 'retry': this.h.restart(); break;
      case 'next': this.h.next(this.data.next); break;
      case 'list': this.h.quit('events'); break;
      case 'menu': this.h.quit('title'); break;
      case 'replay': window.__replay?.watch?.(); break;
      case 'photo': window.__replay?.photo?.(); break;
      case 'ghostImport': Promise.resolve(window.__replay?.importGhost?.()).then(() => this.render()).catch((e) => console.warn(e)); break;
      case 'ghostExport': window.__replay?.exportGhost?.(this.data.eventId); break;
    }
  }
  cycleFilter(d) {
    if (this.data.mode === 'quick') return;
    const f = ['all', ...Object.keys(TYPES)]; const i = f.indexOf(this.filter);
    this.filter = f[(i + d + f.length) % f.length]; this.h.ui?.(d > 0);
    this.focus = 0; this.render();
  }
  /** left / right (or click) on a setting row */
  adjust(el, d) {
    const k = el.dataset.set;
    if (el.dataset.kind === 'range') { const v = Math.max(0, Math.min(1, Math.round((settings[k] + d * 0.05) * 20) / 20)); setSetting(k, v); this.h.ui?.(d > 0); this.refreshValues(); return; }
    const opts = [...el.querySelectorAll('.opt')].map((o) => o.dataset.v);
    const cur = String(settings[k]); const i = opts.indexOf(cur);
    this.choose(el, opts[(i + d + opts.length) % opts.length]);
  }
  choose(el, v) {
    const k = el.dataset.set;
    if (k === 'graphics') { const g = this.h.graphicsControl; if (!g || g.disabled) return; if (g.value !== v) { g.value = v; setSetting('graphics', v); g.onchange?.(); } return; }
    const val = v === 'true' ? true : v === 'false' ? false : v;
    setSetting(k, val); this.h.ui?.(true); this.refreshValues();
  }
  refreshValues() {
    for (const el of this.root.querySelectorAll('[data-set]')) {
      const k = el.dataset.set;
      if (el.dataset.kind === 'range') { const r = el.querySelector('input'); if (r && document.activeElement !== r) r.value = Math.round(settings[k] * 100); const o = el.querySelector('.val'); if (o) o.textContent = pct(settings[k]); }
      else for (const o of el.querySelectorAll('.opt')) o.classList.toggle('on', o.dataset.v === String(settings[k]));
    }
  }

  /** ghost picker in the event detail (src/replay.js): OFF / each saved ghost for this event */
  ghostRow(e) {
    const R = window.__replay; if (!R?.listGhosts || !settings.ghostEnabled) return '';
    let list = []; try { list = R.listGhosts(e.id) || []; } catch (err) { console.warn(err); }
    const sel = (() => { try { return R.selectedGhost?.(e.id) ?? null; } catch { return null; } })();
    const opts = [['off', 'OFF'], ...list.map((g) => [g.id, `${esc(g.name || 'GHOST')}${g.time != null ? ' · ' + this.h.fmtTime(g.time) : ''}`])];
    return `<div class="d-ghost" data-ghost-ev="${e.id}"><span>GHOST</span><div class="opts">${opts.map(([v, l]) => `<span class="opt gopt ${String(sel ?? (list[0]?.id ?? 'off')) === String(v) ? 'on' : ''}" data-g="${esc(v)}">${l}</span>`).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- screens
  r_maps() { return renderMapSelect(this.h.ctx?.().mapId); }

  r_title() {
    return `<div class="t-wrap"><div class="t-head"><div class="kick">GREEK ROADS · PURE TIME</div><h1>PARALIAKI</h1></div><div class="t-list"><div class="mi big" data-act="play"><b>RACE</b></div><div class="mi small" data-act="settings">SETTINGS</div></div></div>`;
  }
  r_mode() {
    const item = (act,label) => `<div class="mi big" data-act="${act}"><b>${label}</b></div>`;
    return `<div class="p-wrap"><div class="kick">CHOOSE YOUR MODE</div><h2>RACE</h2><div class="p-list">${item('quick','QUICK RACE')}${item('events','EVENTS')}${item('tt','TIME TRIAL')}${item('mp','MULTIPLAYER')}<div class="mi small" data-act="back">BACK</div></div></div>`;
  }
  r_car(d) { return renderCarSelect(d); }
  browseCar(delta) {
    if (this.data.def?.car) return;
    this.h.ui?.(delta > 0);
    const data = { ...this.data, index: ((this.data.index || 0) + delta + CARS.length) % CARS.length };
    this.leaving(); this.data = data; this.focus = 0; this.render();
  }
  confirmCar() { this.h.chooseCar?.(this.data.index || 0, this.data.def, this.data.garage); }

  r_events() {
    const ctx = this.h.ctx(), fmt = this.h.fmtTime;
    const available = this.data.mode === 'quick' ? [ctx.mapId === 'riviera' ? QUICK_RACE : getEvents(ctx.mapId).find(e => e.type === 'sprint')].filter(Boolean) : getEvents(ctx.mapId || 'riviera');
    const all = available.filter((e) => this.filter === 'all' || e.type === this.filter);
    const tabs = (this.data.mode === 'quick' ? [] : ['all', ...Object.keys(TYPES)]).map((f) => `<div class="tab ${f === this.filter ? 'on' : ''}" data-filter="${f}">${f === 'all' ? 'ALL' : TYPES[f].label}</div>`).join('');
    const rows = all.map((e) => {
      const r = resolve(e, ctx), rec = loadRecord(e.id);
      const best = rec.bestTime != null ? fmt(rec.bestTime) : '';
      return `<div class="mi ev" data-ev="${e.id}">${MEDAL_ICON(rec.medal)}<div class="ev-main"><b>${esc(e.name)}</b><span>${esc(r.fromName)} ${r.reverse ? '◀' : '▶'} ${esc(r.toName)} · ${fmtDist(r.len)}${r.reverse ? ' · REVERSE' : ''}</span></div><div class="ev-type t-${e.type}">${TYPES[e.type].short}</div><div class="ev-best">${best}</div></div>`;
    }).join('');
    return `<div class="ev-wrap"><div class="ev-left"><div class="kick">${this.data.mode === 'quick' ? 'QUICK RACE' : this.filter === 'timetrial' ? 'TIME TRIAL' : 'EVENTS'}</div><div class="tabs">${tabs}</div><div class="ev-list">${rows || '<div class="empty">NO EVENTS</div>'}</div>
      <div class="mi small" data-act="back"><b>◀ BACK</b></div></div><div class="ev-detail" id="evDetail"></div></div>
      <div class="ui-keys"><span><i>↑ ↓</i> SELECT</span><span><i>← →</i> FILTER</span><span><i>ENTER</i> START</span><span><i>ESC</i> BACK</span></div>`;
  }
  showDetail(id) {
    const el = this.root.querySelector('#evDetail'); if (!el) return;
    const e = getEvent(id); if (!e) { el.innerHTML = ''; return; }
    const r = resolve(e, this.h.ctx()), rec = loadRecord(e.id), fmt = this.h.fmtTime;
    const tg = targetLabels(e, r, fmt, settings.units);
    const facts = [
      ['ROUTE', `${esc(r.fromName)} ${r.reverse ? '◀' : '▶'} ${esc(r.toName)}`], ['DISTANCE', fmtDist(r.len)],
      ['FIELD', e.type === 'sprint' ? `${(Array.isArray(e.rivals) ? e.rivals.length : e.rivals) + 1} CARS` : 'SOLO'], ['ROAD', TRAFFIC(e.traffic ?? 1)],
    ];
    if (r.closed) facts.push(['LAPS', r.laps]);
    if (e.conditions?.time) facts.push(['TIME', String(e.conditions.time).toUpperCase()]);
    const best = [];
    if (rec.bestTime != null) best.push(['BEST TIME', fmt(rec.bestTime)]);
    if (rec.bestPos != null) best.push(['BEST FINISH', 'P' + rec.bestPos]);

    el.innerHTML = `<div class="d-type t-${e.type}">${TYPES[e.type].label}${r.reverse ? ' · REVERSE' : ''}</div><div class="d-name">${esc(e.name)}</div><div class="d-blurb">${esc(e.blurb)}</div>
      <div class="d-facts">${facts.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="d-targets">${tg.map(([m, v]) => `<div class="tg ${m} ${rec.medal && MEDALS.indexOf(rec.medal) >= MEDALS.indexOf(m) ? 'got' : ''}">${MEDAL_ICON(m)}<b>${v}</b></div>`).join('')}</div>
      ${best.length ? `<div class="d-best">${best.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : '<div class="d-best none">NOT RACED YET</div>'}
      ${this.ghostRow(e)}
      <div class="d-go">CHOOSE EVENT → CHOOSE CAR</div>`;
  }

  r_settings(d) {
    const range = (k, label) => `<div class="mi set" data-set="${k}" data-kind="range"><span class="k">${label}</span><input type="range" min="0" max="100" step="1" value="${Math.round(settings[k] * 100)}" data-set="${k}" tabindex="-1"><b class="val">${pct(settings[k])}</b></div>`;
    const choice = (k, label, opts, note = '') => `<div class="mi set" data-set="${k}" data-kind="choice"><span class="k">${label}</span><div class="opts">${opts.map(([v, l]) => `<span class="opt ${String(settings[k]) === v ? 'on' : ''}" data-v="${v}">${l}</span>`).join('')}</div>${note ? `<small>${note}</small>` : ''}</div>`;
    const g = this.h.graphicsControl, locked = g?.disabled;
    return `<div class="set-wrap"><div class="kick">${d.from === 'pause' ? 'PAUSED · ' : ''}SETTINGS</div>
      <div class="set-group"><h3>SOUND</h3>${range('master', 'MASTER VOLUME')}${range('music', 'MUSIC')}${range('sfx', 'EFFECTS')}</div>
      <div class="set-group"><h3>DISPLAY</h3>${choice('units', 'SPEED UNITS', [['kmh', 'KM/H'], ['mph', 'MPH']])}
        ${choice('graphics', 'GRAPHICS', [['auto', 'AUTO'], ['high', 'HIGH'], ['med', 'MED'], ['low', 'LOW']], locked ? 'LOCKED WHILE ONLINE' : 'RELOADS THE GAME')}</div>
      <div class="set-group"><h3>DRIVING</h3>${choice('aids', 'DRIVER AIDS (TC · ABS · ESC)', [['true', 'ON'], ['false', 'OFF']])}${choice('police', 'POLICE IN QUICK RACE / FREE ROAM', [['false', 'OFF'], ['true', 'ON']])}${choice('transmission', 'GEARBOX', [['auto', 'AUTOMATIC'], ['manual', 'MANUAL']], 'MANUAL: SHIFT WITH E / Q · PAD RB / LB')}</div>
      <div class="set-group"><h3>GHOST</h3>${choice('ghostEnabled', 'RACE YOUR BEST GHOST', [['true', 'ON'], ['false', 'OFF']])}
        ${window.__replay ? `<div class="mi set" data-act="ghostImport"><span class="k">IMPORT A GHOST FILE</span><b>▶</b></div><div class="mi set" data-act="ghostExport"><span class="k">EXPORT LAST GHOST</span><b>▶</b></div>` : ''}</div>
      <div class="set-group"><h3>CONTROLS</h3><div id="bindings" class="bindings"></div></div>
      <div class="mi small" data-act="back"><b>◀ BACK</b></div></div>
      <div class="ui-keys"><span><i>↑ ↓</i> SELECT</span><span><i>← →</i> CHANGE</span><span><i>ESC</i> BACK</span></div>`;
  }
  mountSettings() {
    if (this.h.graphicsControl?.disabled) this.root.querySelector('[data-set=graphics]')?.classList.add('locked');
    const b = this.root.querySelector('#bindings');
    if (b && this.h.bindings) { try { this.h.bindings(b); } catch (e) { b.textContent = 'Controls unavailable'; console.warn(e); } }
  }
  /** leaving the settings screen: drop any half-done key capture in the bindings table */
  leaving() { if (this.screen === 'settings') this.h.cancelBindings?.(); this.carView?.dispose(); this.carView = null; }

  r_pause(d) {
    const item = (act, label) => `<div class="mi big" data-act="${act}"><b>${label}</b></div>`;
    return `<div class="p-wrap"><div class="kick">${esc(d.kick || '')}</div><h2>PAUSED</h2><div class="p-sub">${esc(d.sub || '')}</div>
      <div class="p-list">${item('resume', 'RESUME')}${d.online ? '' : item('restart', 'RESTART')}${d.online || !window.__replay?.photo ? '' : item('photo', 'PHOTO MODE')}${item('settings', 'SETTINGS')}${item('quit', d.online ? 'BACK TO MENU' : 'QUIT TO MENU')}</div></div>
      <div class="ui-keys"><span><i>↑ ↓</i> SELECT</span><span><i>ENTER</i> OK</span><span><i>ESC</i> RESUME</span></div>`;
  }

  /** d = { result, def, r, title, sub, win, rows: [[k, v, hi]], splits: [{name, time, delta}], breakdown: [[k, v]], next } */
  r_results(d) {
    const res = d.result || {}, m = res.medal;
    const item = (act, label) => `<div class="mi big" data-act="${act}"><b>${label}</b></div>`;
    const splits = d.splits?.length ? `<div class="r-block"><h3>SPLITS</h3><table class="r-splits">${d.splits.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.time}</td><td class="${s.cls || ''}">${s.delta || ''}</td></tr>`).join('')}</table></div>` : '';

    const field = d.field?.length ? `<div class="r-block"><h3>CLASSIFICATION</h3><table class="r-splits">${d.field.map((f) => `<tr class="${f.me ? 'me' : ''}"><td>P${f.pos} · ${esc(f.name)}</td><td>${esc(f.car || '')}</td><td>${f.time}</td></tr>`).join('')}</table></div>` : '';
    return `<div class="r-wrap ${d.win ? 'win' : 'lose'}"><div class="r-left">
        <div class="kick">${esc(d.kick || '')}</div>
        <div class="r-medal">${MEDAL_ICON(m, 'big')}<span>${m ? m.toUpperCase() + ' MEDAL' : 'NO MEDAL'}${res.newBest ? ' · <em>NEW BEST</em>' : ''}</span></div>
        <h2>${esc(d.title || '')}</h2><div class="r-sub">${d.sub || ''}</div>
        <div class="r-table">${(d.rows || []).map(([k, v, hi]) => `<div><span>${esc(k)}</span><b class="${hi ? 'nb' : ''}">${v}</b></div>`).join('')}</div>
        <div class="r-actions">${item('retry', 'RETRY')}${window.__replay?.watch ? item('replay', 'WATCH REPLAY') : ''}${item('list', 'EVENT LIST')}</div>
      </div><div class="r-right">${field}${splits}</div></div>`;
  }
}
