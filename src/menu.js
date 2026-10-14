// MENUS: title, mode select, map select, the event list, race setup, car select, settings, pause and results.
// Plain DOM in #ui (index.html), built from the UI kit (src/ui/components.js + ui.css) and styled by src/menu.css.
// Navigation: mouse / touch, or the named input actions main.js routes here (up / down / left / right / confirm / back,
// shiftUp / shiftDown switch tabs) from keyboard, gamepad and touch. Up / down / left / right move focus spatially
// (lists, grids and card rails alike); on an adjustable row (slider, toggle, segmented, stepper, select) left / right
// change its value. Menu items are not native <button>s on purpose: the input system ignores key events aimed at
// focused form controls, so focus is drawn with a class and the keys keep flowing through flowAction().
import { getEvents, QUICK_RACE, TYPES, getEvent, resolve, loadRecord, targetLabels, MEDALS, rivalCount } from './events.js';
import * as S from './settings.js';
import { renderMapSelect, selectMap, mountMapSelect } from './map-select.js';
import { CARS } from './cars.js';
import { renderCarSelect, mountCarSelect, mountCarGrid, getCarDecals, setCarDecals } from './car-select.js';
import * as C from './ui/components.js';
import { renderControls, controlsClick, controlsAction, controlsChange } from './ui/controls-panel.js';
import { setupFields, loadSetup, saveSetup, applySetup, resolveSetup, isCustom, TIMES, WEATHERS, PERF_RIVALS } from './race-setup.js';
import { MAPS } from './map-catalog.js';
import { lobbyConfigToRaceSetup } from './mp-setup.js';
import './ui/hosts.js';
import { account } from './account.js';
import { friends } from './friends.js';
import { renderDriver, renderSocial, mountSocial, loadSocial } from './ui/social-screen.js';
import { controlsStrip, drivingHints } from './ui/driving-hints.js';

const { settings, setSetting, steeringAssistChoice, fmtDist } = S;
const { esc, icon } = C;
const TRAFFIC = (d) => (d <= 0 ? 'CLOSED ROAD' : d < 0.6 ? 'LIGHT TRAFFIC' : d < 1.2 ? 'TRAFFIC' : d < 1.8 ? 'HEAVY TRAFFIC' : 'EXTREME TRAFFIC');
const arrow = (rev) => icon(rev ? 'arrow-left' : 'arrow-right', 'ico--route');
const routeLine = (r) => r.closed ? `${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'}` : `${esc(r.fromName)} ${arrow(false)} ${esc(r.toName)}`;
C.registerFormat('rivals', (v) => (+v === 0 ? 'NONE · SOLO' : `${v} ${+v === 1 ? 'RIVAL' : 'RIVALS'}`));
C.registerFormat('laps', (v) => `${v} ${+v === 1 ? 'LAP' : 'LAPS'}`);
C.registerFormat('deg', (v) => Math.round(v) + '°');
const VOLUMES = { master: 'MASTER', music: 'MUSIC', sfx: 'EFFECTS', engine: 'ENGINE', tyres: 'TYRES', ambience: 'AMBIENCE', traffic: 'TRAFFIC', voice: 'VOICES', ui: 'MENU SOUNDS' };
const has = (k) => k in settings;
const SET = { 'data-scope': 'setting' };

export class Menu {
  /**
   * root: the #ui element. h: handlers from main.js
   *   quickRace(), openEvent(def | id), chooseCar(index, def, garage), multiplayer(), garage(), resume(), restart(), quit(), next(id)
   *   ctx() -> resolve context { route, marks, mapId }, carName() -> string, fmtTime(t), ui(forward) (click sound)
   *   cancelBindings() (drop a half-done key capture), graphicsControl (the hidden graphics <select>), inputDevice()
   */
  constructor(root, h) {
    this.root = root; this.h = h; this.screen = null; this.data = {}; this.focus = 0; this.stack = [];
    this.filter = 'all'; this.participants = 'solo';
    this.accountUnsub = account.onChange(profile => { if (this.screen === 'title' && profile && !profile.guest && !profile.username) this.show('account', {}, true); else if (['account','friends'].includes(this.screen)) this.refresh(); });
    this.friendsUnsub = friends.onChange(() => { if (this.screen === 'friends') this.refresh(); });
    C.bindRoot(root); root.tabIndex = -1;
    root.addEventListener('focusin', e => { const row = e.target.closest('.mi'); const i = this.items().indexOf(row); if(i >= 0) this.setFocus(i, false); });
    root.addEventListener('keydown', e => { if(e.code !== 'Escape' || !e.target.closest('input, textarea, [contenteditable]')) return; e.preventDefault(); e.stopPropagation(); e.target.blur(); root.focus({preventScroll:true}); }, true);
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('pointermove', (e) => { const it = e.target.closest?.('.mi'); if (it && !it.classList.contains('focus')) { const i = this.items().indexOf(it); if (i >= 0) this.setFocus(i, false); } });
    root.addEventListener('ui:change', (e) => this.onChange(e.detail));
    root.addEventListener('input', e => { if (!e.target.matches('[data-car-search]')) return; const value = e.target.value, pos = e.target.selectionStart; this.data.filters = { ...this.data.filters, search: value }; this.render(); const search = root.querySelector('[data-car-search]'); search.focus(); search.setSelectionRange?.(pos, pos); });
  }
  get open() { return !!this.screen; }

  // ---------------------------------------------------------------- show / hide
  show(screen, data = {}, push = false) {
    const profile = account.cached();
    if (screen === 'title' && profile && !profile.guest && !profile.username) screen = 'account';
    if (screen === 'events' && this.screen === 'maps') data = { ...data, mode: this.data.mode };
    this.leaving();
    if (push && this.screen) this.stack.push({ screen: this.screen, data: this.data, focus: this.focus });
    if (!push) this.stack.length = 0;
    this.screen = screen; this.data = data; this.focus = data.focus ?? null;
    document.body.classList.add('ui-open'); // before render: focus needs laid-out items
    document.body.dataset.ui = screen;
    this.render();
    if (screen === 'account' || screen === 'friends') loadSocial(this, screen);
  }
  pop() {
    const prev = this.stack.pop(); if (!prev) return false;
    this.leaving();
    this.screen = prev.screen; this.data = prev.data; this.focus = prev.focus; this.render(); document.body.dataset.ui = this.screen;
    return true;
  }
  hide() {
    this.leaving(); this.socialView?.dispose(); this.socialView = null; this.mapView?.dispose(); this.mapView = null;
    this.screen = null; this.stack.length = 0; this.root.innerHTML = '';
    document.body.classList.remove('ui-open'); delete document.body.dataset.ui;
  }
  render() {
    const keepCar = this.screen === 'car' && this.data.detail && this.carView?.index === (this.data.index || 0);
    const stage = keepCar ? this.root.querySelector('#carStage') : null;
    if (!keepCar) { this.carView?.dispose(); this.carView = null; } this.mapView?.dispose(); this.mapView = null;
    C.closeListbox(); this.socialView?.dispose(); this.socialView = null;
    const keep = this.root.querySelector('.scr__body .scroll-y, .scr__body')?.scrollTop;
    const fn = this['r_' + this.screen]; this.root.innerHTML = fn ? fn.call(this, this.data) : '';
    this.root.className = 's-' + this.screen;
    if (stage) this.root.querySelector('#carStage')?.replaceWith(stage);
    else if (this.screen === 'car') this.carView = this.data.detail ? mountCarSelect(this.root, this.data.index || 0) : mountCarGrid(this.root);
    if (this.screen === 'maps') this.mapView = mountMapSelect(this.root);
    if (['account','friends'].includes(this.screen)) this.socialView = mountSocial(this);
    for (const t of this.root.querySelectorAll('.tabs')) { const on = t.querySelector('.tab.on'); if (on && t.scrollWidth > t.clientWidth) t.scrollLeft = on.offsetLeft - (t.clientWidth - on.offsetWidth) / 2; }
    if (this.screen === 'settings' && this.data.tab === 'controls') this.h.cancelBindings?.();
    const it = this.items();
    let f = this.focus;
    if (f == null) { f = it.findIndex((el) => el.dataset.default != null); if (f < 0) f = it.findIndex((el) => el.dataset.kind !== 'tabs'); }
    if (this.data.keepScroll && keep != null) { const b = this.root.querySelector('.scr__body .scroll-y, .scr__body'); if (b) b.scrollTop = keep; }
    this.setFocus(Math.min(Math.max(0, f), Math.max(0, it.length - 1)), !this.data.keepScroll && !(this.screen === 'car' && this.data.detail));
    this.data.keepScroll = false;
  }
  /** re-render in place (a value changed that other rows depend on); focus stays on the same item even when others
   *  appear or disappear (e.g. DEFAULTS becomes available) */
  refresh() {
    const id = (el) => el && ['key', 'act', 'ev', 'mapId', 'action', 'color'].map((k) => el.dataset[k]).find((v) => v != null);
    const want = id(this.items()[this.focus]);
    this.data.keepScroll = true; this.render();
    if (want != null) { const i = this.items().findIndex((el) => id(el) === want); if (i >= 0 && i !== this.focus) this.setFocus(i, false); }
  }
  items() { return [...this.root.querySelectorAll('.mi:not(.off)')].filter((el) => el.offsetParent !== null || el.getClientRects().length); }
  setFocus(i, scroll = true) {
    const it = this.items(); if (!it.length) return;
    this.focus = (i + it.length) % it.length;
    for (const [k, el] of it.entries()) el.classList.toggle('focus', k === this.focus);
    const el = it[this.focus];
    if (scroll) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (this.screen === 'events' && el.dataset.ev) this.showDetail(el.dataset.ev);
    if (this.screen === 'maps' && el.dataset.mapId) this.mapView?.preview(el.dataset.mapId);
  }
  /** spatial focus movement: the nearest item in that direction; up / down wrap at the ends of a column */
  move(dir) {
    const it = this.items(); if (!it.length) return false;
    const cur = it[this.focus]; if (!cur) { this.setFocus(0); return true; }
    const a = cur.getBoundingClientRect(), [vx, vy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    const ac = [(a.left + a.right) / 2, (a.top + a.bottom) / 2];
    let best = -1, bs = Infinity;
    it.forEach((el, i) => {
      if (i === this.focus) return;
      const b = el.getBoundingClientRect(); if (!b.width && !b.height) return;
      const bc = [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
      const dc = vx ? (bc[0] - ac[0]) * vx : (bc[1] - ac[1]) * vy; if (dc <= 2) return;
      const along = Math.max(0, vx ? (vx > 0 ? b.left - a.right : a.left - b.right) : (vy > 0 ? b.top - a.bottom : a.top - b.bottom));
      const gap = vx ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const off = Math.abs(vx ? bc[1] - ac[1] : bc[0] - ac[0]);
      const score = along + gap * 3 + off * 0.15;
      if (score < bs) { bs = score; best = i; }
    });
    if (best < 0 && vy) best = vy > 0 ? 0 : it.length - 1;
    if (best < 0 || best === this.focus) return false;
    this.setFocus(best); this.h.ui?.(vx > 0 || vy > 0);
    return true;
  }

  // ---------------------------------------------------------------- input
  /** a named input action; true if the menu used it */
  action(name) {
    if (!this.screen) return false;
    if (document.body.dataset.customizer === 'open') return true;
    if (C.ui.action(name)) return true;
    const cur = this.items()[this.focus];
    if (this.screen === 'settings' && this.data.tab === 'controls' && controlsAction(this, name, cur)) return true;
    if (name === 'shiftUp' || name === 'shiftDown') {
      const t = this.root.querySelector('.mi[data-kind=tabs]'); if (t) { C.step(t, name === 'shiftUp' ? 1 : -1); this.h.ui?.(name === 'shiftUp'); }
      return true;
    }
    if (name === 'up' || name === 'down') { this.move(name); return true; }
    if (name === 'left' || name === 'right') {
      const d = name === 'right' ? 1 : -1;
      if (cur?.dataset.kind && C.step(cur, d)) { if (cur.dataset.kind !== 'slider') this.h.ui?.(d > 0); return true; }
      if (this.screen === 'events' && !this.move(name)) { const t = this.root.querySelector('.mi[data-kind=tabs]'); if (t) { C.step(t, d); this.h.ui?.(d > 0); } return true; }
      this.move(name); return true;
    }
    if (name === 'confirm') { if (cur) { if (['account','friends'].includes(this.screen) && (cur.closest('[data-account]') || cur.closest('[data-friends]'))) { const input = cur.querySelector('input'); if(input) input.focus(); else cur.click(); } else this.activate(cur); } return true; }
    if (name === 'back' || name === 'pause') { this.back(); return true; }
    return true; // menus swallow everything else (camera, tow, restart keys...)
  }
  back() {
    this.h.ui?.(false);
    if (this.screen === 'pause') { this.h.resume(); return; }
    if (this.screen === 'results') { this.h.quit('events'); return; }
    const cancel = this.screen === 'car' && !this.data.detail ? this.data.onCancel : null;
    if (this.pop()) { cancel?.(); return; }
    if (this.screen !== 'title') this.show('title');
    cancel?.();
  }
  onClick(e) {
    const it = this.items();
    if (this.screen === 'settings' && this.data.tab === 'controls' && controlsClick(this, e)) return;
    const row = e.target.closest?.('[data-kind]');
    if (row && this.root.contains(row) && C.handleClick(e)) { if (it.includes(row)) this.setFocus(it.indexOf(row), false); return; }
    const el = e.target.closest?.('[data-act], [data-ev], [data-map-id]'); if (!el || !this.root.contains(el)) return;
    if (it.includes(el)) this.setFocus(it.indexOf(el), false);
    this.activate(el);
  }
  activate(el) {
    if (el.classList.contains('off') || el.getAttribute('aria-disabled') === 'true') return;
    if (el.dataset.kind && C.activate(el)) { this.h.ui?.(true); return; }
    if (el.dataset.mapId) { this.h.ui?.(true); selectMap(this, el.dataset.mapId); return; }
    if (el.dataset.ev) { this.h.ui?.(true); this.show('setup', { eventId: el.dataset.ev }, true); return; }
    if (el.dataset.landmark) { window.__flow.teleportLandmark(el.dataset.landmark); this.back(); return; }
    const a = el.dataset.act;
    this.h.ui?.(true);
    switch (a) {
      case 'mapZoomIn': case 'mapZoomOut': case 'mapReset': this.mapView?.action(a); break;
      case 'drivingHints': drivingHints.toggle(); this.refresh(); break;
      case 'play': this.show('mode', {}, true); break;
      case 'quick': this.filter = 'sprint'; this.show('maps', { filter: 'sprint', mode: 'quick' }, true); break;
      case 'events': this.filter = 'all'; this.show('maps', { filter: 'all' }, true); break;
      case 'taxi': case 'getaway': this.filter = a; this.show('maps', { filter: a, mode: a }, true); break;
      case 'free': this.filter = 'free'; this.show('maps', { filter: 'free', mode: 'free' }, true); break;
      case 'roamCar': this.h.freeRoamCar?.(); break;
      case 'roamConditions': this.h.roamConditions?.(); break;
      case 'roamLandmarks': this.h.roamLandmarks?.(); break;
      case 'roamTow': this.h.roamTow?.(); break;
      case 'tt': this.filter = 'timetrial'; this.show('maps', { filter: 'timetrial', mode: 'tt' }, true); break;
      case 'carDetail': this.show('car', { ...this.data, index: +el.dataset.carIndex, detail: true }, true); break;
      case 'decalColor': this.data.decal = { ...this.data.decal, color: el.dataset.color }; this.refresh(); break;
      case 'decalAdd': { const id = CARS[this.data.index || 0].id; const list = getCarDecals(id); if (list.length < 8) setCarDecals(id, [...list, { id: 'stripes', position: 'bonnet', color: '#ffffff', number: 7, ...this.data.decal }]); this.refresh(); break; }
      case 'decalClear': setCarDecals(CARS[this.data.index || 0].id, []); this.refresh(); break;
      case 'decalRemove': { const id = CARS[this.data.index || 0].id; setCarDecals(id, getCarDecals(id).filter((_, i) => i !== +el.dataset.layer)); this.refresh(); break; }
      case 'carCustomize': { const spec = CARS[this.data.index || 0]; import('./customization-editor.js').then(({ openCustomizationEditor }) => openCustomizationEditor({ spec, onChange: preset => { if (preset.paint) this.carView?.paint(preset.paint); this.refresh(); } })).catch(error => C.ui.toast(error.message || 'CUSTOMIZATION UNAVAILABLE', { icon: 'warning', tone: 'bad' })); break; }
      case 'carConfirm': this.confirmCar(); break;
      case 'paint': this.carView?.paint(el.dataset.color); for (const paint of this.root.querySelectorAll('.paint')) paint.classList.toggle('selected', paint === el); this.root.querySelector('.car-paint-name').textContent = el.title; break;
      case 'setupAdvanced': this.data.advanced = !this.data.advanced; this.refresh(); break;
      case 'setupGo': this.startSetup(); break;
      case 'setupReset': saveSetup(this.setupKey(), {}); this.refresh(); C.ui.toast('EVENT DEFAULTS RESTORED', { icon: 'arrow-counter-clockwise' }); break;
      case 'mp': this.h.multiplayer(); break;
      case 'account': this.show('account', {}, true); break;
      case 'friends': this.show('friends', {}, true); break;
      case 'garage': this.h.garage(); break;
      case 'settings': this.show('settings', { from: this.screen, tab: 'audio' }, true); break;
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
      case 'ghostImport': Promise.resolve(window.__replay?.importGhost?.()).then(() => this.refresh()).catch((err) => console.warn(err)); break;
      case 'ghostExport': window.__replay?.exportGhost?.(this.data.eventId); break;
    }
  }
  /** a component value changed (keyboard, gamepad, mouse or touch) */
  onChange({ key, value, el }) {
    const scope = el.dataset.scope;
    if (scope === 'participants') { this.participants = value; this.refresh(); return; }
    if (scope === 'catalog') { this.data.filters = { ...this.data.filters, [key]: value }; this.refresh(); return; }
    if (scope === 'decal') { this.data.decal = { ...this.data.decal, [key]: value }; this.refresh(); return; }
    if (el.dataset.kind === 'tabs') {
      if (key === 'settingsTab') { this.h.cancelBindings?.(); this.data.tab = value; this.focus = 0; this.render(); }
      else if (key === 'eventFilter') { this.filter = value; this.focus = null; this.render(); }
      return;
    }
    if (scope === 'roam') { window.__flow.setRoamConditions({ [key]: value }); return; }
    if (scope === 'setting') {
      if (key === 'graphics') { const g = this.h.graphicsControl; if (!g || g.disabled) return; if (g.value !== value) { g.value = value; setSetting('graphics', value); g.onchange?.(); } return; }
      setSetting(key, value);
      if (key === 'ghostEnabled') this.refresh();
      return;
    }
    if (scope === 'input') { controlsChange(this, key, value, el); return; }
    if (scope === 'setup') {
      const id = this.setupKey(), s = loadSetup(id), f = setupFields(this.setupDef(), { closed: this.isClosed() }).find((x) => x.key === key);
      s[key] = f && value === f.dflt ? null : value;
      saveSetup(id, s); this.refresh(); return;
    }
    if (scope === 'ghost') { try { window.__replay?.selectGhost?.(this.setupDef().id, value === 'off' ? null : value); } catch (err) { console.warn(err); } }
  }
  valueFor(key) { return key === 'steeringAssist' ? steeringAssistChoice(settings.steeringAssist, this.h.inputDevice?.() || 'keyboard') : settings[key]; }
  /** settings changed elsewhere (e.g. the steering assist following the active device) */
  refreshValues() { for (const el of this.root.querySelectorAll('[data-scope=setting][data-key]')) C.setValue(el, String(this.valueFor(el.dataset.key)), false); }

  // ---------------------------------------------------------------- title / mode
  r_title() {
    return `<div class="scr scr--title"><div class="title__col">
      <div class="kick">GREEK ROADS <span class="acc">/</span> PURE TIME</div>
      <h1 class="title__mark">${C.brandMark()}${C.wordmark()}</h1>
      <p class="title__tag">Real roads of Attica: the Athens Riviera and the Penteli hill climb.</p>
      <div class="title__menu">${C.option({ icon: 'flag-checkered', title: 'RACE', desc: 'Quick race, events, time trials and online', act: 'play', attrs: { 'data-default': '' } })}
        ${C.option({ icon: 'car-profile', title: 'GARAGE', desc: `${CARS.length} cars · paint, vinyls and specs`, act: 'garage' })}
        ${C.option({ icon: 'user', title: account.cached()?.username ? 'DRIVER PROFILE' : 'CREATE YOUR DRIVER', desc: 'Your plate, stats and friends', act: 'account' })}
        ${C.option({ icon: 'users-three', title: 'FRIENDS', desc: 'Online drivers, requests and recent opponents', act: 'friends' })}
        ${C.option({ icon: 'gear-six', title: 'SETTINGS', desc: 'Sound, graphics, driving and controls', act: 'settings' })}</div>
      </div><footer class="scr__foot">${C.keyHints([['updown', 'SELECT'], ['confirm', 'OK'], ['garage', 'GARAGE']])}</footer></div>`;
  }
  r_account(d) { return renderDriver(d); }
  r_friends(d) { return renderSocial(d); }
  participantChoice() { return C.segmented({ key: 'participants', label: 'PARTICIPANTS', value: this.participants, options: [['solo', 'SOLO', 'user'], ['multiplayer', 'MULTIPLAYER', 'users-three']], attrs: { 'data-scope': 'participants' } }); }
  r_mode() {
    const tile = (act, ic, title, desc) => `<div class="mi mode-tile" role="button" data-act="${act}"><span class="mode-tile__ico">${icon(ic)}</span><b class="mode-tile__title">${title}</b><span class="mode-tile__desc">${desc}</span></div>`;
    return C.screen({ cls: 'scr--mode', kick: 'CHOOSE YOUR MODE', title: 'RACE', hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'BACK']],
      body: `<div class="mode-select">${this.participantChoice()}<div class="mode-grid">${tile('quick', 'flag-checkered', 'QUICK RACE', 'Pick a map and go. Three locals by default, as many as you like.')}${tile('events', 'trophy', 'EVENTS', 'Sprints, time trials and police pursuits. Medals for time and position.')}${tile('free', 'car-profile', 'FREE ROAM', 'Explore any map in traffic. Change car, weather and time anytime.')}${tile('taxi', 'car', 'TAXI', 'Five minutes of pickups and drop-offs. Any car; taxi suggested.')}${tile('getaway', 'siren', 'GETAWAY DRIVER', 'Pick up a bank crew, escape and stop at the drop-off. Five minutes; no combat.')}${tile('tt', 'timer', 'TIME TRIAL', 'You, the road and the clock. Race your best ghost.')}</div></div>`, foot: C.button({ label: 'FIND A LOBBY / JOIN BY CODE', icon: 'users-three', act: 'mp', variant: 'ghost', size: 'sm' }) });
  }

  // ---------------------------------------------------------------- maps
  r_maps() { return renderMapSelect(this.h.ctx?.().mapId, this.data.mode); }

  // ---------------------------------------------------------------- car
  r_car(d) { return renderCarSelect(d); }
  browseCar(delta) {
    if (this.data.def?.car) return;
    this.h.ui?.(delta > 0);
    const data = { ...this.data, index: ((this.data.index || 0) + delta + CARS.length) % CARS.length };
    this.leaving(); this.data = data; this.focus = null; this.render();
  }
  confirmCar() {
    const c = CARS[this.data.index || 0];
    if (this.data.allowedCars && !this.data.allowedCars.includes(c.id)) return;
    if (this.data.onPick) { const pick = this.data.onPick; const roaming = this.data.inFreeRoam; if (pick(c.id) === false) return; const origin = [...this.stack].reverse().find(x => x.screen !== 'car'); if (roaming) this.show('pause', origin?.data || { inFreeRoam: true }); else if (origin) this.show(origin.screen, origin.data); else this.hide(); return; }
    this.h.chooseCar?.(this.data.index || 0, this.data.def, this.data.garage);
  }

  // ---------------------------------------------------------------- events
  eventsHere() {
    const ctx = this.h.ctx();
    return this.data.mode === 'quick' ? [ctx.mapId === 'riviera' ? QUICK_RACE : getEvents(ctx.mapId).find((e) => e.type === 'sprint')].filter(Boolean) : getEvents(ctx.mapId || 'riviera');
  }
  r_events() {
    const ctx = this.h.ctx(), fmt = this.h.fmtTime, map = MAPS.find((m) => m.id === ctx.mapId) || MAPS[0];
    const all = this.eventsHere().filter((e) => this.filter === 'all' || e.type === this.filter);
    const types = ['all', ...Object.keys(TYPES).filter((t) => this.eventsHere().some((e) => e.type === t))];
    if (!types.includes(this.filter)) this.filter = 'all';
    const tabs = C.tabs({ key: 'eventFilter', value: this.filter, options: types.map((f) => [f, f === 'all' ? 'ALL' : TYPES[f].label, f === 'all' ? 'list' : f === 'sprint' ? 'flag-checkered' : f === 'timetrial' ? 'timer' : 'siren']) });
    const rows = all.map((e) => {
      const r = resolve(e, ctx), rec = loadRecord(e.id);
      return `<div class="mi ev-row" role="button" data-ev="${e.id}">${C.medal(rec.medal)}<div class="ev-row__main"><b>${esc(e.name)}</b><span>${routeLine(r)} · ${fmtDist(r.len)}${r.reverse ? ' · REVERSE' : ''}</span></div>${C.badge(TYPES[e.type].short, '', null).replace('class="badge', `class="badge t-${e.type}`)}<b class="ev-row__best tnum">${rec.bestTime != null ? fmt(rec.bestTime) : ''}</b></div>`;
    }).join('');
    return C.screen({ cls: 'scr--events', kick: `${esc(map.name)} · ${map.type === 'circuit' ? 'CIRCUIT' : 'POINT TO POINT'}`, title: this.filter === 'timetrial' && this.data.mode === 'tt' ? 'TIME TRIAL' : 'EVENTS',
      head: types.length > 2 ? tabs : '',
      hints: [['updown', 'SELECT'], ...(types.length > 2 ? [['tabs', 'FILTER']] : []), ['confirm', 'RACE SETUP'], ['back', 'BACK']],
      body: `<div class="ev-layout"><div class="ev-list scroll-y">${rows || '<div class="empty">NO EVENTS ON THIS MAP</div>'}</div><aside class="ev-detail panel panel--notch scroll-y" id="evDetail"></aside></div>` });
  }
  showDetail(id) {
    const el = this.root.querySelector('#evDetail'); if (!el) return;
    const e = getEvent(id); if (!e) { el.innerHTML = ''; return; }
    el.innerHTML = this.eventSummary(e, resolve(e, this.h.ctx())) + `<div class="ev-detail__go">${C.kbd('ENTER')} RACE SETUP ${icon('caret-right')} CHOOSE CAR</div>`;
  }
  /** the event card: type, name, blurb, facts, medal targets and your records */
  eventSummary(e, r, recId = e.id) {
    if (e.objectiveMode) return `<div class="evs__top">${C.badge(TYPES[e.type]?.label || e.name)}</div><h3 class="evs__name">${esc(e.name)}</h3><p class="evs__blurb">${esc(e.blurb || 'Stop at each pickup and drop-off. Complete as many jobs as you can in five minutes.')}</p>${C.stats([['SESSION', '5:00', { icon: 'timer' }], ['OBJECTIVES', 'PICKUP / DROP-OFF', { icon: 'map-pin' }], ['ROAD', TRAFFIC(e.traffic ?? 1), { icon: 'traffic-cone' }]])}<p class="group__note">ALL CARS AVAILABLE${e.type === 'taxi' ? ' · OCTAVIA TAXI SUGGESTED' : ''}</p>`;
    const rec = loadRecord(recId), fmt = this.h.fmtTime, n = rivalCount(e);
    const tg = targetLabels(e, r, fmt, settings.units);
    const facts = [['DISTANCE', fmtDist(r.len), 'path'], [r.closed ? 'LAPS' : 'ROUTE', r.closed ? r.laps : `${esc(r.fromName)} ${arrow(false)} ${esc(r.toName)}`, r.closed ? 'arrows-clockwise' : 'map-pin'],
      ['FIELD', e.type === 'sprint' ? `${n + 1} CARS` : 'SOLO', 'users-three'], ['ROAD', r.closed ? 'CLOSED CIRCUIT' : TRAFFIC(e.traffic ?? 1), 'traffic-cone']];
    if (e.conditions?.time || e.conditions?.weather) facts.push(['CONDITIONS', [e.conditions.time, e.conditions.weather].filter(Boolean).join(' · ').toUpperCase(), e.conditions.time === 'night' ? 'moon' : 'sun']);
    const best = [];
    if (rec.bestTime != null) best.push(['BEST TIME', fmt(rec.bestTime), 'timer']);
    if (rec.bestPos != null) best.push(['BEST FINISH', 'P' + rec.bestPos, 'trophy']);
    return `<div class="evs__top"><span class="badge t-${e.type}">${TYPES[e.type].label}</span>${r.reverse ? C.badge('REVERSE', 'cyan', 'arrows-left-right') : ''}</div>
      <h3 class="evs__name">${esc(e.name)}</h3><p class="evs__blurb">${esc(e.blurb || TYPES[e.type].desc)}</p>
      ${C.stats(facts.map(([k, v, ic]) => [k, v, { icon: ic }]), 'evs__facts')}
      <div class="evs__targets">${tg.map(([m, v]) => `<div class="tg ${rec.medal && MEDALS.indexOf(rec.medal) >= MEDALS.indexOf(m) ? 'got' : ''}">${C.medal(m)}<b>${v}</b></div>`).join('')}</div>
      ${best.length ? C.stats(best.map(([k, v, ic]) => [k, v, { icon: ic, tone: 'hi' }]), 'evs__best') : '<div class="evs__none">NOT RACED YET</div>'}`;
  }

  // ---------------------------------------------------------------- race setup (event detail)
  setupDef() { if (['taxi', 'getaway'].includes(this.data.mode)) return window.__flow.drivingModeDef(this.data.mode); if (this.data.mode === 'free') return window.__flow.freeRoamDef(); return this.data.eventId === 'quick' || !this.data.eventId ? this.eventsHere()[0] || QUICK_RACE : getEvent(this.data.eventId) || QUICK_RACE; }
  setupKey() { const d = this.setupDef(); return d.quick ? 'quick:' + (this.h.ctx().mapId || 'riviera') : d.id; }
  isClosed() { return !!this.h.ctx().route?.closed; }
  r_setup() {
    const def = this.setupDef(), closed = this.isClosed(), ctx = this.h.ctx(), saved = loadSetup(this.setupKey());
    const cur = resolveSetup(def, saved, { closed }), runDef = applySetup(def, saved, { closed }), r = resolve(runDef, ctx), custom = isCustom(def, saved, { closed });
    const A = { 'data-scope': 'setup' }, rows = [];
    for (const f of setupFields(def, { closed })) {
      if (f.key === 'rivals') rows.push(C.stepper({ key: 'rivals', label: 'AI RIVALS', icon: 'users-three', value: cur.rivals, min: f.min, max: f.max, format: 'rivals', attrs: A,
        note: cur.rivals > PERF_RIVALS ? `${icon('warning')} MORE THAN ${PERF_RIVALS} RIVALS CAN LOWER THE FRAME RATE` : f.dflt === cur.rivals ? 'EVENT DEFAULT' : `EVENT DEFAULT: ${f.dflt}`, noteCls: cur.rivals > PERF_RIVALS ? 'warn' : '' }));
      if (f.key === 'police') rows.push(C.segmented({ key: 'police', label: 'POLICE & LAWS', icon: 'shield', value: String(cur.police), type: 'bool', dflt: String(f.dflt), attrs: A, options: [['false', 'OFF'], ['true', 'ON']] }));
      if (f.key === 'traffic') rows.push(C.segmented({ key: 'traffic', label: 'TRAFFIC', icon: 'traffic-cone', value: cur.traffic, type: 'num', dflt: f.dflt, attrs: A, options: f.levels.map(([, v, l]) => [v, l]) }));
      if (f.key === 'laps') rows.push(C.stepper({ key: 'laps', label: 'LAPS', icon: 'arrows-clockwise', value: cur.laps, min: f.min, max: f.max, format: 'laps', attrs: A, note: `${fmtDist(r.len)} IN TOTAL` }));
      if (f.key === 'reverse') rows.push(C.segmented({ key: 'reverse', label: 'DIRECTION', icon: 'arrows-left-right', value: String(cur.reverse), type: 'bool', dflt: 'false', attrs: A, options: [['false', closed ? 'CLOCKWISE' : 'FORWARD'], ['true', closed ? 'ANTI-CLOCKWISE' : 'REVERSE']] }));
      if (f.key === 'time') rows.push(C.select({ key: 'time', label: 'TIME OF DAY', icon: cur.time === 'night' ? 'moon' : cur.time === 'sunset' || cur.time === 'dawn' ? 'sun-horizon' : 'sun', value: cur.time, attrs: A, options: TIMES.map(([v, l]) => [v, v === f.dflt ? `${l} · DEFAULT` : l]) }));
      if (f.key === 'weather') rows.push(C.segmented({ key: 'weather', label: 'WEATHER', icon: cur.weather === 'rain' ? 'cloud-rain' : cur.weather === 'overcast' ? 'cloud' : 'sun', value: cur.weather, dflt: f.dflt, attrs: A, options: WEATHERS.map(([v, l]) => [v, l, v === 'rain' ? 'cloud-rain' : v === 'overcast' ? 'cloud' : 'sun']) }));
    }
    if (rows[0]) rows[0] = rows[0].replace('<div class="mi field', '<div data-default="" class="mi field'); // open on the first choice
    const R = window.__replay;
    if (def.type === 'timetrial' && settings.ghostEnabled && R?.listGhosts) {
      let list = []; try { list = R.listGhosts(runDef.id) || []; } catch (err) { console.warn(err); }
      let sel = null; try { sel = R.selectedGhost?.(runDef.id) ?? null; } catch {}
      const opts = [['off', 'NO GHOST'], ...list.map((g) => [g.id, `${esc(g.name || 'GHOST')}${g.time != null ? ' · ' + this.h.fmtTime(g.time) : ''}`])];
      rows.push(C.select({ key: 'ghost', label: 'GHOST', icon: 'ghost', value: String(sel ?? list[0]?.id ?? 'off'), options: opts, attrs: { 'data-scope': 'ghost' }, note: list.length ? '' : 'FINISH A RUN TO RACE YOUR GHOST' }));
    }
    const note = custom ? `<div class="setup__custom">${icon('sliders-horizontal')}<span>CUSTOM SETUP · ${runDef.custom ? 'RECORDS AND GHOSTS KEPT APART FROM THE EVENT, OFF THE ONLINE BOARD' : 'CONDITIONS ONLY · STILL COUNTS FOR THE EVENT'}</span></div>` : '';
    return C.screen({ cls: 'scr--setup', kick: def.quick ? 'QUICK RACE' : `${TYPES[def.type].label} · ${esc((MAPS.find((m) => m.id === ctx.mapId) || MAPS[0]).name)}`, title: def.objectiveMode ? 'SESSION SETUP' : 'RACE SETUP',
      hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['confirm', 'OK'], ['back', 'BACK']],
      body: `<div class="setup-layout"><aside class="panel panel--notch setup__event scroll-y">${this.eventSummary(runDef, r, runDef.id)}</aside>
        <section class="panel setup__form"><header class="panel__head"><h3 class="panel__title">${icon('sliders-horizontal')}YOUR RACE</h3>${C.button({ label: 'DEFAULTS', icon: 'arrow-counter-clockwise', variant: 'ghost', size: 'sm', act: 'setupReset', disabled: !custom })}</header>
          <div class="setup__fields scroll-y">${this.participantChoice()}${rows.filter(row => /data-key="(?:rivals|traffic|time|police)"/.test(row)).join('')}${C.button({ label: this.data.advanced ? 'HIDE ADVANCED OPTIONS' : 'ADVANCED OPTIONS', icon: 'sliders-horizontal', act: 'setupAdvanced', variant: 'ghost', size: 'sm' })}${this.data.advanced ? rows.filter(row => !/data-key="(?:rivals|traffic|time|police)"/.test(row)).join('') : ''}</div>${note}
          <div class="setup__go">${C.button({ label: this.participants === 'multiplayer' ? 'OPEN MULTIPLAYER LOBBY' : 'CHOOSE CAR', icon: this.participants === 'multiplayer' ? 'users-three' : 'car-profile', iconRight: 'caret-right', variant: 'primary', size: 'lg', block: true, act: 'setupGo' })}</div></section></div>` });
  }
  startSetup() {
    const def = this.setupDef(), runDef = applySetup(def, loadSetup(this.setupKey()), { closed: this.isClosed() });
    if (this.participants === 'multiplayer') { window.__multiplayer.open({ mapId: this.h.ctx().mapId, eventId: def.id, mode: def.type, config: lobbyConfigToRaceSetup(resolveSetup(def, loadSetup(this.setupKey()), { closed: this.isClosed() })) }); return; }
    this.h.openEvent(runDef);
  }

  // ---------------------------------------------------------------- settings
  r_settings(d) {
    const tab = d.tab || 'audio', g = this.h.graphicsControl, locked = g?.disabled;
    const tabsList = [['audio', 'SOUND', 'speaker-high'], ['video', 'GRAPHICS', 'monitor'], ['driving', 'DRIVING', 'steering-wheel'], ...(has('chaseFov') || has('mouseSensitivity') ? [['camera', 'CAMERA', 'camera']] : []), ['controls', 'CONTROLS', 'game-controller']];
    const v = (k) => String(this.valueFor(k));
    let body = '';
    if (tab === 'audio') {
      const keys = (S.AUDIO_VOLUMES || ['master', 'music', 'sfx']).filter(has);
      body = `<div class="group"><h3 class="group__title">${icon('speaker-high')}VOLUME</h3>${keys.map((k) => C.slider({ key: k, label: VOLUMES[k] || k.toUpperCase(), value: settings[k], attrs: SET })).join('')}${C.toggle({ key: 'mildLanguage', label: 'MILD LANGUAGE', value: settings.mildLanguage, attrs: SET })}</div>`;
    } else if (tab === 'video') {
      body = `<div class="group"><h3 class="group__title">${icon('monitor')}QUALITY</h3>${C.segmented({ key: 'graphics', label: 'GRAPHICS', value: v('graphics'), options: [['auto', 'AUTO'], ['ultra', 'ULTRA'], ['high', 'HIGH'], ['med', 'MED'], ['low', 'LOW']], note: locked ? 'LOCKED WHILE ONLINE' : 'CHANGING IT RELOADS THE GAME', attrs: SET, cls: locked ? 'locked' : '' })}</div>
        <div class="group"><h3 class="group__title">${icon('mountains')}RENDER</h3>${C.segmented({ key: 'drawDistance', label: 'DRAW DISTANCE', value: v('drawDistance'), options: [['auto', 'AUTO'], ['500', '500 M'], ['1000', '1 KM'], ['2000', '2 KM'], ['4000', '4 KM']], note: 'FULL DETAIL RANGE · LOW-DETAIL SCENERY STAYS VISIBLE TO THE HORIZON', attrs: SET })}
          ${C.toggle({ key: 'motionBlur', label: 'MOTION BLUR', value: settings.motionBlur !== false, attrs: SET })}</div>
        <div class="group"><h3 class="group__title">${icon('speedometer')}UNITS</h3>${C.segmented({ key: 'units', label: 'SPEED UNITS', value: v('units'), options: [['kmh', 'KM/H'], ['mph', 'MPH']], attrs: SET })}</div>`;
    } else if (tab === 'driving') {
      body = `<div class="group"><h3 class="group__title">${icon('steering-wheel')}ASSISTS</h3>${C.toggle({ key: 'aids', label: 'DRIVER AIDS · TC ABS ESC', value: settings.aids, attrs: SET })}
          ${C.segmented({ key: 'steeringAssist', label: 'STEERING ASSIST', value: v('steeringAssist'), options: [['off', 'OFF'], ['light', 'LIGHT'], ['full', 'FULL']], attrs: SET, note: settings.steeringAssist === null ? 'FOLLOWS YOUR DEVICE UNTIL YOU CHOOSE' : '' })}
          ${C.segmented({ key: 'transmission', label: 'GEARBOX', value: v('transmission'), options: [['auto', 'AUTO'], ['manual', 'MANUAL']], attrs: SET, note: C.keyHints([['tabs', 'SHIFT DOWN / UP']]) })}</div>
        <div class="group"><h3 class="group__title">${icon('police-car')}WORLD</h3>${C.toggle({ key: 'police', label: 'POLICE & LAWS', value: settings.police, attrs: SET })}</div>
        <div class="group"><h3 class="group__title">${icon('ghost')}GHOSTS</h3>${C.toggle({ key: 'ghostEnabled', label: 'RACE YOUR BEST GHOST', value: settings.ghostEnabled, attrs: SET })}
          ${window.__replay ? `<div class="field-actions">${C.button({ label: 'IMPORT GHOST', icon: 'download-simple', act: 'ghostImport', size: 'sm' })}${C.button({ label: 'EXPORT LAST GHOST', icon: 'export', act: 'ghostExport', size: 'sm' })}</div>` : ''}</div>`;
    } else if (tab === 'camera') {
      const sl = (k, label, min, max, step, format) => has(k) ? C.slider({ key: k, label, value: settings[k], min, max, step, format, attrs: SET }) : '';
      const tg = (k, label) => has(k) ? C.toggle({ key: k, label, value: settings[k], attrs: SET }) : '';
      body = `<div class="group"><h3 class="group__title">${icon('camera')}VIEW</h3>${sl('chaseFov', 'CHASE FIELD OF VIEW', 45, 75, 1, 'deg')}${sl('cockpitFov', 'COCKPIT FIELD OF VIEW', 45, 90, 1, 'deg')}${tg('speedFov', 'SPEED FOV EFFECT')}</div>
        <div class="group"><h3 class="group__title">${icon('mouse')}FREE LOOK</h3>${sl('mouseSensitivity', 'LOOK SENSITIVITY', 0.25, 3, 0.05, 'x')}${tg('invertLookY', 'INVERT LOOK Y')}
          <p class="group__note">Click the racing view to look around. Hold and drag if the pointer cannot be locked. The right stick also looks.</p></div>
        <div class="group"><h3 class="group__title">${icon('map-pin')}TAGS</h3>${tg('playerMarkers', 'ONLINE PLAYER TAGS')}${tg('rivalMarkers', 'AI RIVAL TAGS')}</div>`;
    } else if (tab === 'controls') body = renderControls(this);
    return C.screen({ cls: 'scr--settings', kick: d.from === 'pause' ? 'PAUSED' : 'OPTIONS', title: 'SETTINGS',
      head: C.tabs({ key: 'settingsTab', value: tab, options: tabsList }),
      hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['tabs', 'TAB'], ...(tab === 'controls' ? [['confirm', 'REBIND']] : []), ['back', 'BACK']],
      body: `<div class="set-panel panel scroll-y">${body}</div>` });
  }
  /** leaving the settings screen: drop any half-done key capture */
  leaving() { this.mapView?.dispose(); this.mapView = null; this.socialView?.dispose(); this.socialView = null; if (this.screen === 'settings') this.h.cancelBindings?.(); C.closeListbox(); this.carView?.dispose(); this.carView = null; }

  // ---------------------------------------------------------------- pause
  r_pause(d) {
    const r = d.r, def = d.def;
    const kick = def ? `${esc(def.name)} · ${r?.closed ? `${esc(d.mapName || '')} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'}` : r ? routeLine(r) : ''}` : esc(d.kick || '');
    return `<div class="scr scr--pause"><div class="pause-card panel panel--notch"><div class="kick">${kick}</div><h2 class="title-xl">PAUSED</h2>${d.sub ? `<div class="pause__sub">${icon('timer')}${esc(d.sub)}</div>` : ''}
      <div class="pause__list">${C.option({ icon: 'play', title: 'RESUME', act: 'resume', attrs: { 'data-default': '' } })}${d.inFreeRoam ? C.option({ icon: 'car-profile', title: 'CHANGE CAR', act: 'roamCar' }) + C.option({ icon: 'cloud-rain', title: 'TIME & WEATHER', act: 'roamConditions' }) + C.option({ icon: 'map-pin', title: 'TELEPORT TO LANDMARK', act: 'roamLandmarks' }) + C.option({ icon: 'truck', title: 'TOW TO ROAD', act: 'roamTow' }) : ''}${d.online || d.inFreeRoam ? '' : C.option({ icon: 'arrow-counter-clockwise', title: 'RESTART', act: 'restart' })}${d.online || !window.__replay?.photo ? '' : C.option({ icon: 'camera', title: 'PHOTO MODE', act: 'photo' })}${C.option({ icon: 'gear-six', title: 'SETTINGS', act: 'settings' })}${C.option({ icon: 'sign-out', title: d.online ? 'BACK TO MENU' : 'QUIT TO MENU', act: 'quit' })}</div><div class="pause-controls">${C.button({ label: drivingHints.enabled ? 'HIDE DRIVING CONTROLS' : 'SHOW DRIVING CONTROLS', icon: 'game-controller', act: 'drivingHints', variant: 'ghost', size: 'sm' })}${drivingHints.enabled ? controlsStrip({ device: this.h.inputDevice?.() || 'keyboard', car: this.h.carSpec?.() || window.__game?.player?.spec, manual: this.h.manual?.() ?? true }) : ''}</div></div>
      <footer class="scr__foot">${C.keyHints([['updown', 'SELECT'], ['confirm', 'OK'], ['back', 'RESUME']])}</footer></div>`;
  }

  // Mode owner handlers; UI owner can restyle these with the rest of the pause menu.
  r_roamConditions() {
    const c = window.__conditions(), attrs = { 'data-scope': 'roam' };
    return C.screen({ title: 'TIME & WEATHER', body: C.select({ key: 'time', label: 'TIME OF DAY', value: c.time, attrs, options: TIMES }) + C.segmented({ key: 'weather', label: 'WEATHER', value: c.weather, attrs, options: WEATHERS }), hints: [['back', 'BACK']] });
  }
  r_roamLandmarks(d) {
    return C.screen({ title: 'TELEPORT TO LANDMARK', body: d.landmarks.map(m => C.option({ icon: 'map-pin', title: esc(m.name), attrs: { 'data-landmark': m.id } })).join(''), hints: [['back', 'BACK']] });
  }

  // ---------------------------------------------------------------- results
  /** d = { result, def, r, mapName, title, sub, win, rows: [[k, v, hi]], splits: [{name, time, delta}], field: [{pos, name, car, time, me}] } */
  r_results(d) {
    const res = d.result || {}, m = res.medal, r = d.r, def = d.def;
    const kick = def && r ? (r.closed ? `${esc(d.mapName || def.name)} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'} · ${fmtDist(r.len)}` : `${esc(def.name)} · ${routeLine(r)} · ${fmtDist(r.len)}`) : esc(d.kick || '');
    const splits = d.splits?.length ? C.panel('SPLITS', `<table class="r-table">${d.splits.map((s) => `<tr><td>${esc(s.name)}</td><td class="tnum">${s.time}</td><td class="tnum ${s.cls || ''}">${s.delta || ''}</td></tr>`).join('')}</table>`, { icon: 'timer' }) : '';
    const field = d.field?.length ? C.panel('CLASSIFICATION', `<table class="r-table">${d.field.map((f) => `<tr class="${f.me ? 'me' : ''}"><td class="r-pos">P${f.pos}</td><td>${esc(f.name)}<small>${esc(f.car || '')}</small></td><td class="tnum ${f.running ? 'run' : ''}">${f.time}</td></tr>`).join('')}</table>`, { icon: 'flag-checkered' }) : '';
    const tiles = (d.rows || []).map(([k, v, hi]) => C.stat(esc(k), v, { tone: hi ? 'hi' : '' }));
    const act = (a, ic, label, v = 'secondary') => C.button({ label, icon: ic, act: a, variant: v, attrs: a === 'retry' ? { 'data-default': '' } : null });
    return C.screen({ cls: `scr--results ${d.win ? 'is-win' : 'is-lose'}`, back: false, kick, hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'EVENT LIST']],
      body: `<div class="res-layout"><div class="res-main">
        <div class="res-medal">${C.medal(m, 'big')}<span>${m ? m.toUpperCase() + ' MEDAL' : 'NO MEDAL'}</span>${res.newBest ? C.badge('NEW BEST', 'gold', 'trophy') : ''}</div>
        <h2 class="res-title">${esc(d.title || '')}</h2>${d.sub ? `<p class="res-sub">${d.sub}</p>` : ''}
        <div class="stats res-stats">${tiles.join('')}</div>
        <div class="res-actions">${act('retry', 'arrow-counter-clockwise', 'RETRY', 'primary')}${window.__replay?.watch ? act('replay', 'film-strip', 'WATCH REPLAY') : ''}${act('list', 'list', 'EVENT LIST')}</div>
      </div><div class="res-side scroll-y">${field}${splits}</div></div>` });
  }
}
