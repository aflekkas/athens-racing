// MENUS: title, mode select, map select, race setup, car select, settings, pause and results.
// Plain DOM in #ui (index.html), built from the UI kit (src/ui/components.js + ui.css) and styled by src/menu.css.
// Navigation: mouse / touch, or the named input actions main.js routes here (up / down / left / right / confirm / back,
// shiftUp / shiftDown switch tabs) from keyboard, gamepad and touch. Up / down / left / right move focus spatially
// (lists, grids and card rails alike); on an adjustable row (slider, toggle, segmented, stepper, select) left / right
// change its value. Menu items are not native <button>s on purpose: the input system ignores key events aimed at
// focused form controls, so focus is drawn with a class and the keys keep flowing through flowAction().
import { getEvents, QUICK_RACE, TYPES, resolve, rivalCount, SP_RIVALS, MAX_RIVALS } from './events.js';
import * as S from './settings.js';
import { renderMapSelect, selectMap, mountMapSelect } from './map-select.js';
import { CARS } from './cars.js';
import { GARAGE_CARS } from './car-catalog.js';
import { renderCarSelect, mountCarSelect, mountCarGrid } from './car-select.js';
import * as C from './ui/components.js';
import { mountGraphicsOnboarding } from './ui/graphics-onboarding.js';
import { resolveGraphics, PRESETS, PRESET_IDS, PRESET_LABELS, LEVEL_IDS } from './graphics.js';
import { installSettingsAccess } from './ui/settings-access.js';
import { renderControls, controlsClick, controlsAction, controlsChange } from './ui/controls-panel.js';
import { setupFields, loadSetup, saveSetup, applySetup, resolveSetup, isCustom, TIMES, WEATHERS, POLICE_LEVELS } from './race-setup.js';
import { MAPS } from './map-catalog.js';
import { mapTagline } from './menu-copy.js';
import { lobbyConfigToRaceSetup } from './mp-setup.js';
import * as MP from './ui/mp-screens.js';
import { personalBestLabel } from './personal-bests.js';
import './ui/hosts.js';
import { driverName } from './driver-name.js';
import { controlsStrip, drivingHints } from './ui/driving-hints.js';
import * as Release from './ui/release-screens.js';

const { settings, setSetting, steeringAssistChoice, fmtDist } = S;
const { esc, icon } = C;
const TRAFFIC = (d) => (d <= 0 ? 'CLOSED ROAD' : d < 0.6 ? 'LIGHT TRAFFIC' : d < 1.2 ? 'NORMAL TRAFFIC' : d < 1.8 ? 'HEAVY TRAFFIC' : 'EXTREME TRAFFIC');
const arrow = (rev) => icon(rev ? 'arrow-left' : 'arrow-right', 'ico--route');
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const count = (n) => NUM[n] || String(n);
/** the Quick Race card line, from the real default and cap */
const quickBlurb = () => SP_RIVALS >= MAX_RIVALS ? `Pick a map and go against ${count(SP_RIVALS)} locals, or fewer if you like.` : `Pick a map and go. ${count(SP_RIVALS)[0].toUpperCase() + count(SP_RIVALS).slice(1)} locals by default, up to ${count(MAX_RIVALS)}.`;
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
   *   cancelBindings() (drop a half-done key capture), graphicsControl (the hidden graphics <ui-select>), inputDevice()
   */
  constructor(root, h) {
    this.root = root; this.h = h; this.screen = null; this.data = {}; this.focus = 0; this.stack = [];
    this.filter = 'all'; this.participants = 'solo';
    C.bindRoot(root); root.tabIndex = -1; installSettingsAccess(this); mountGraphicsOnboarding(this); MP.installMpScreens(this); Release.install(this);
    root.addEventListener('focusin', e => { const row = e.target.closest('.mi'); const i = this.items().indexOf(row); if(i >= 0) this.setFocus(i, false); });
    root.addEventListener('keydown', e => { if(e.code !== 'Escape' || !e.target.closest('input, textarea, [contenteditable]')) return; e.preventDefault(); e.stopPropagation(); e.target.blur(); root.focus({preventScroll:true}); }, true);
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('pointermove', (e) => { const it = e.target.closest?.('.mi'); if (it && !it.classList.contains('focus')) { const i = this.items().indexOf(it); if (i >= 0) this.setFocus(i, false); } });
    root.addEventListener('ui:change', (e) => this.onChange(e.detail));
    root.addEventListener('input', e => { if (!e.target.matches('[data-car-search]')) return; const value = e.target.value, pos = e.target.selectionStart; this.data.filters = { ...this.data.filters, search: value }; this.render({ morph: true }); const search = root.querySelector('[data-car-search]'); search.focus(); search.setSelectionRange?.(pos, pos); });
  }
  get open() { return !!this.screen; }

  // ---------------------------------------------------------------- show / hide
  show(screen, data = {}, push = false) {
    if (screen === 'events') screen = 'mode'; // Legacy results return to the two-mode picker.
    this.leaving();
    if (push && this.screen) this.stack.push({ screen: this.screen, data: this.data, focus: this.focus });
    if (!push) this.stack.length = 0;
    this.screen = screen; this.data = data; this.focus = data.focus ?? null;
    document.body.classList.add('ui-open'); // before render: focus needs laid-out items
    document.body.dataset.ui = screen;
    this.render(); MP.syncFlag(screen);
    MP.afterShow(this, screen);
    if (screen === 'title' && this.mpBooting) { this.mpBooting = false; MP.openEntry(this, 'join'); } // an invite link waits for the title
  }
  pop() {
    const prev = this.stack.pop(); if (!prev) return false;
    this.leaving();
    this.screen = prev.screen; this.data = prev.data; this.focus = prev.focus; this.render(); document.body.dataset.ui = this.screen; MP.syncFlag(this.screen);
    return true;
  }
  hide() {
    this.leaving(); this.mapView?.dispose(); this.mapView = null;
    this.screen = this.shown = null; this.stack.length = 0; MP.afterRender(this); this.root.innerHTML = '';
    document.body.classList.remove('ui-open'); delete document.body.dataset.ui; MP.syncFlag(null);
  }
  /** morph: patch the current screen in place (refresh, tab switch, search) instead of rebuilding it */
  render({ morph = false } = {}) {
    const entering = this.screen !== this.shown;
    if (morph && !entering && this.root.firstElementChild && this.screen !== 'maps' && !(this.screen === 'car' && this.data.detail)) return this.patch();
    const keepCar = this.screen === 'car' && this.data.detail && this.carView?.index === (this.data.index || 0);
    const stage = keepCar ? this.root.querySelector('#carStage') : null;
    if (!keepCar) { this.carView?.dispose(); this.carView = null; } this.mapView?.dispose(); this.mapView = null;
    C.closeListbox();
    const keep = this.root.querySelector('.scr__body .scroll-y, .scr__body')?.scrollTop;
    // Only a real screen change slides in; refreshes (a toggle, a tab) swap in place. Transitions stay off until the
    // new DOM has its focus state, so nothing visibly animates from an unfocused, unstyled first frame.
    this.shown = this.screen;
    const mpStage = MP.detachStage(this); // the multiplayer showroom's live car carries over between its screens
    const fn = this['r_' + this.screen]; this.root.innerHTML = fn ? fn.call(this, this.data) : '';
    MP.afterRender(this, mpStage);
    this.root.className = 's-' + this.screen + ' is-settling' + (entering ? ' is-entering' : '');
    cancelAnimationFrame(this.settling); this.settling = requestAnimationFrame(() => { this.settling = requestAnimationFrame(() => this.root.classList.remove('is-settling')); });
    if (stage) this.root.querySelector('#carStage')?.replaceWith(stage);
    else if (this.screen === 'car') this.carView = this.data.detail ? mountCarSelect(this.root, this.data.index || 0) : mountCarGrid(this.root);
    if (this.screen === 'maps') this.mapView = mountMapSelect(this.root);
    for (const t of this.root.querySelectorAll('.tabs')) { const on = t.querySelector('.tab.on'); if (on && t.scrollWidth > t.clientWidth) t.scrollLeft = on.offsetLeft - (t.clientWidth - on.offsetWidth) / 2; }
    if (this.screen === 'settings' && this.data.tab === 'controls') this.h.cancelBindings?.();
    const it = this.items();
    let f = this.focus;
    if (f == null) { f = it.findIndex((el) => el.dataset.default != null); if (f < 0) f = it.findIndex((el) => el.dataset.kind !== 'tabs'); }
    if (this.data.keepScroll && keep != null) { const b = this.root.querySelector('.scr__body .scroll-y, .scr__body'); if (b) b.scrollTop = keep; }
    this.setFocus(Math.min(Math.max(0, f), Math.max(0, it.length - 1)), !this.data.keepScroll && !(this.screen === 'car' && this.data.detail));
    this.data.keepScroll = false; C.indicators(this.root);
  }
  /** the morph path of render(): only nodes whose markup changed are touched, so focus, scroll and the garage
   *  thumbnails survive and nothing flashes */
  patch() {
    C.closeListbox();
    const fn = this['r_' + this.screen]; C.morph(this.root, fn ? fn.call(this, this.data) : '');
    if (this.screen === 'car') { this.carView?.dispose(); this.carView = mountCarGrid(this.root); } // observe new thumbnails
    MP.afterRender(this);
    if (this.screen === 'settings' && this.data.tab === 'controls') this.h.cancelBindings?.();
    const it = this.items(); this.setFocus(Math.min(Math.max(0, this.focus ?? 0), Math.max(0, it.length - 1)), false);
    this.data.keepScroll = false; C.indicators(this.root); // selection glides to its new item
  }
  /** re-render in place (a value changed that other rows depend on); focus stays on the same item even when others
   *  appear or disappear (e.g. DEFAULTS becomes available) */
  refresh() {
    const id = (el) => el && ['fid', 'key', 'act', 'ev', 'mapId', 'action', 'color'].map((k) => el.dataset[k]).find((v) => v != null);
    const want = id(this.items()[this.focus]);
    this.data.keepScroll = true; this.render({ morph: true });
    if (want != null) { const i = this.items().findIndex((el) => id(el) === want); if (i >= 0 && i !== this.focus) this.setFocus(i, false); }
  }
  items() { return [...this.root.querySelectorAll('.mi:not(.off)')].filter((el) => el.offsetParent !== null || el.getClientRects().length); }
  setFocus(i, scroll = true) {
    const it = this.items(); if (!it.length) return;
    this.focus = (i + it.length) % it.length;
    for (const [k, el] of it.entries()) el.classList.toggle('focus', k === this.focus);
    const el = it[this.focus];
    if (scroll) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
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
    if (C.ui.action(name)) return true;
    if (this.screen === 'maps' && this.mapView?.action(name)) return true;
    const cur = this.items()[this.focus];
    if (this.screen === 'settings' && this.data.tab === 'controls' && controlsAction(this, name, cur)) return true;
    if (name === 'shiftUp' || name === 'shiftDown') {
      const t = this.root.querySelector('.mi[data-kind=tabs]'); if (t) { C.step(t, name === 'shiftUp' ? 1 : -1); this.h.ui?.(name === 'shiftUp'); }
      return true;
    }
    // a vertical tab rail (Settings): up / down change section, right enters the list
    if (cur?.dataset.kind === 'tabs' && getComputedStyle(cur).flexDirection === 'column') {
      if (name === 'up' || name === 'down') { if (C.step(cur, name === 'down' ? 1 : -1)) this.h.ui?.(name === 'down'); return true; }
      if (name === 'left' || name === 'right') { this.move(name); return true; }
    }
    if (name === 'up' || name === 'down') { this.move(name); return true; }
    if (name === 'left' || name === 'right') {
      const d = name === 'right' ? 1 : -1;
      if (cur?.dataset.kind && C.step(cur, d)) { if (cur.dataset.kind !== 'slider') this.h.ui?.(d > 0); return true; }
      this.move(name); return true;
    }
    if (name === 'confirm') { if (cur) this.activate(cur); return true; }
    if (name === 'back' || name === 'pause') { this.back(); return true; }
    return true; // menus swallow everything else (camera, tow, restart keys...)
  }
  back() {
    this.h.ui?.(false);
    if (MP.isMpScreen(this.screen)) { MP.back(this); return; }
    if (this.screen === 'pause') { this.h.resume(); return; }
    if (this.screen === 'results') { this.h.quit('title'); return; }
    const cancel = this.screen === 'car' ? this.data.onCancel : null;
    if (this.pop()) { if(this.screen!=='car')cancel?.(); return; }
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
    if (el.dataset.landmark) { window.__flow.teleportLandmark(el.dataset.landmark); this.back(); return; }
    const a = el.dataset.act;
    this.h.ui?.(true);
    if (Release.act(this, el)) return;
    if (a?.startsWith('mp') && MP.act(this, el)) return;
    switch (a) {
      case 'mapPrev': case 'mapNext': case 'mapZoomIn': case 'mapZoomOut': case 'mapReset': this.mapView?.action(a); break;
      case 'saveDriverName': { const input = this.root.querySelector('[data-driver-name]'); try { driverName.set(input.value); input.value = driverName.get(); C.ui.toast('DRIVER NAME SAVED'); } catch (error) { C.ui.toast(error.message, { icon: 'warning', tone: 'bad' }); input.focus(); } break; }
      case 'drivingHints': drivingHints.toggle(); this.refresh(); break;
      case 'play': this.show('mode', {}, true); break;
      case 'quick': this.filter = 'sprint'; this.show('maps', { filter: 'sprint', mode: 'quick' }, true); break;
      case 'free': this.filter = 'free'; this.show('maps', { filter: 'free', mode: 'free' }, true); break;
      case 'roamCar': this.h.freeRoamCar?.(); break;
      case 'roamConditions': this.h.roamConditions?.(); break;
      case 'roamLandmarks': this.h.roamLandmarks?.(); break;
      case 'roamTow': this.h.roamTow?.(); break;
      case 'carDetail': this.show('car', { ...this.data, index: +el.dataset.carIndex, detail: true }, true); break;
      case 'carConfirm': this.confirmCar(); break;
      case 'paint': this.carView?.paint(el.dataset.color); for (const paint of this.root.querySelectorAll('.paint')) paint.classList.toggle('selected', paint === el); this.root.querySelector('.car-paint-name').textContent = el.title; break;
      case 'setupAdvanced': this.data.advanced = !this.data.advanced; this.refresh(); break;
      case 'setupGo': this.startSetup(); break;
      case 'setupReset': saveSetup(this.setupKey(), {}); this.refresh(); C.ui.toast('DEFAULTS RESTORED', { icon: 'arrow-counter-clockwise' }); break;
      case 'mp': case 'mpJoin': MP.openEntry(this, 'join'); break;
      case 'mpHost': MP.openEntry(this, 'host'); break;
      case 'garage': this.h.garage(); break;
      case 'settings': this.show('settings', { from: this.screen, tab: 'audio' }, true); break;
      case 'back': this.back(); break;
      case 'resume': this.h.resume(); break;
      case 'retire': { const mp=window.__multiplayer;C.ui.prompt({title:'RETIRE FROM THIS RACE?',body:'This records a DNF. You can watch the remaining drivers.',actions:[{id:'retire',label:'RETIRE · DNF',variant:'primary'},{id:'cancel',label:'KEEP RACING'}]}).then(choice=>{if(choice==='retire'){mp?.retire();this.h.resume();}});break;}
      case 'reset': window.__flow?.resetCar?.(); break;
      case 'onlineLobby': MP.openRoom(this); break;
      case 'restart': this.h.restart(); break;
      case 'quit': this.h.quit('title'); break;
      case 'retry': this.h.restart(); break;
      case 'next': this.h.next(this.data.next); break;
      case 'list': this.h.quit('title'); break;
      case 'menu': this.h.quit('title'); break;
      case 'shareResult': this.h.shareResult?.(); break;
    }
  }
  /** a component value changed (keyboard, gamepad, mouse or touch) */
  onChange({ key, value, el }) {
    const scope = el.dataset.scope;
    if (MP.isMpScreen(this.screen) && MP.change(this, { key, value, el })) return;
    if (scope === 'participants') { this.participants = value; this.refresh(); return; }
    if (scope === 'catalog') { this.data.filters = { ...this.data.filters, [key]: value }; this.refresh(); return; }
    if (el.dataset.kind === 'tabs') {
      if (key === 'settingsTab') { this.h.cancelBindings?.(); this.data.tab = value; this.render({ morph: true }); const scroll = this.root.querySelector('.set-panel'); if (scroll) scroll.scrollTop = 0; }
      return;
    }
    if (scope === 'roam') { window.__flow.setRoamConditions({ [key]: value }); return; }
    if (scope === 'setting') {
      if (key === 'swearing') { setSetting('mildLanguage', !value); return; }
      if (key === 'graphics') { setSetting(key,value);const g=this.h.graphicsControl;if(g)g.value=value;if(this.root)this.refresh();return; }
      if(key==='renderScale'||key==='pixelRatioCap'){setSetting(key,key==='renderScale'&&value==='auto'?'auto':Number(value));if(this.root)this.refresh();return;}
      if(key==='drawDistance'){setSetting(key,value==='auto'?'auto':Number(value));return;}
      setSetting(key, value);
      return;
    }
    if (scope === 'input') { controlsChange(this, key, value, el); return; }
    if (scope === 'setup') {
      const id = this.setupKey(), s = loadSetup(id), fields = setupFields(this.setupDef(), { closed: this.isClosed() }), f = fields.find((x) => x.key === key);
      if (key === 'police') { // one row: OFF / RELAXED / NORMAL / TOUGH
        const on = value !== 'off', lf = fields.find((x) => x.key === 'policeLevel');
        s.police = on === f?.dflt ? null : on;
        if (on) s.policeLevel = value === lf?.dflt ? null : value;
        saveSetup(id, s); this.refresh(); return;
      }
      s[key] = f && value === f.dflt ? null : value;
      saveSetup(id, s); this.refresh(); return;
    }
  }
  valueFor(key) { if (key === 'swearing') return !settings.mildLanguage; return key === 'steeringAssist' ? steeringAssistChoice(settings.steeringAssist, this.h.inputDevice?.() || 'keyboard') : settings[key]; }
  /** settings changed elsewhere (e.g. the steering assist following the active device) */
  refreshValues() { for (const el of this.root.querySelectorAll('[data-scope=setting][data-key]')) C.setValue(el, String(this.valueFor(el.dataset.key)), false); }

  // ---------------------------------------------------------------- title / mode
  r_title() {
    return `<div class="scr scr--title">${C.statusBar({ back: false, kick: 'GREEK ROADS <span class="acc">/</span> PURE TIME' })}<div class="home">
      <div class="home__brand"><h1 class="title__mark">${C.brandMark()}${C.wordmark()}</h1>
      <p class="title__tag">${esc(mapTagline(MAPS))}</p></div>
      <div class="title__menu home__tiles">${C.option({ icon: 'flag-checkered', title: 'PLAY', desc: 'Quick Race or Free Roam · solo or multiplayer', act: 'play', attrs: { 'data-default': '' } })}
        ${C.option({ icon: 'users-three', title: 'JOIN GAME', desc: 'Enter a lobby code or browse open lobbies', act: 'mpJoin' })}
        ${C.option({ icon: 'plus', title: 'HOST / CREATE GAME', desc: 'Create a multiplayer lobby and invite drivers', act: 'mpHost' })}
        ${C.option({ icon: 'car-profile', title: 'GARAGE', desc: `${GARAGE_CARS.length} cars · city to super`, act: 'garage' })}
        ${C.option({ icon: 'gear-six', title: 'SETTINGS', desc: 'Sound, graphics, driving and controls', act: 'settings' })}</div>
      </div>${Release.titleExtras(this)}<footer class="scr__foot">${C.keyHints([['select', 'SELECT'], ['confirm', 'OK'], ['garage', 'GARAGE']])}</footer></div>`;
  }
  participantChoice() { return C.segmented({ key: 'participants', label: 'PARTICIPANTS', value: this.participants, options: [['solo', 'SOLO', 'user'], ['multiplayer', 'MULTIPLAYER', 'users-three']], attrs: { 'data-scope': 'participants' } }); }
  r_mode() {
    const tile = (act, ic, title, desc) => `<div class="mi mode-tile" role="button" data-act="${act}"><span class="mode-tile__ico">${icon(ic)}</span><b class="mode-tile__title">${title}</b><span class="mode-tile__desc">${desc}</span></div>`;
    return C.screen({ cls: 'scr--mode', kick: 'CHOOSE YOUR MODE', title: 'RACE', hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'BACK']],
      body: `<div class="mode-select">${this.participantChoice()}<div class="mode-grid">${tile('quick', 'flag-checkered', 'QUICK RACE', quickBlurb())}${tile('free', 'car-profile', 'FREE ROAM', 'Explore any map in traffic. Change car, weather and time anytime.')}</div></div>`, foot: C.button({ label: 'JOIN GAME / BROWSE OPEN LOBBIES', icon: 'users-three', act: 'mp', variant: 'ghost', size: 'sm' }) });
  }

  // ---------------------------------------------------------------- multiplayer (src/ui/mp-screens.js)
  r_whatsNew() { return Release.renderWhatsNew(this); }
  r_credits() { return Release.renderCredits(this); }
  r_creditFile() { return Release.renderCreditFile(this); }
  r_mp(d) { return MP.renderMp(this, window.__multiplayer, d); }
  r_mpLobby() { return MP.renderLobby(this, window.__multiplayer); }
  r_mpCars() { return MP.renderCars(this, window.__multiplayer); }
  r_mpResults() { return MP.renderResults(this, window.__multiplayer); }

  // ---------------------------------------------------------------- maps
  r_maps() { return renderMapSelect(this.h.ctx?.().mapId, this.data.mode); }

  // ---------------------------------------------------------------- car
  r_car(d) { return renderCarSelect(d); }
  confirmCar() {
    const c = CARS[this.data.index || 0];
    if (this.data.allowedCars && !this.data.allowedCars.includes(c.id)) return;
    if (this.data.onPick) { const pick = this.data.onPick; const roaming = this.data.inFreeRoam; if (pick(c.id) === false) return; const origin = [...this.stack].reverse().find(x => x.screen !== 'car'); if (roaming) this.show('pause', origin?.data || { inFreeRoam: true }); else if (origin) this.show(origin.screen, origin.data); else this.hide(); return; }
    this.h.chooseCar?.(this.data.index || 0, this.data.def, this.data.garage);
  }

  // ---------------------------------------------------------------- events
  eventsHere() {
    const ctx = this.h.ctx();
    return this.data.mode === 'quick' ? [ctx.mapId === 'riviera' ? QUICK_RACE : (ctx.events || getEvents(ctx.mapId)).find((e) => e.type === 'sprint')].filter(Boolean) : getEvents(ctx.mapId || 'riviera');
  }
  /** Session facts; Quick Race has no event medals or event records. Best times show as one line, only once set. */
  eventSummary(e, r) {
    const n = rivalCount(e), free = e.type === 'free';
    const mapName = (MAPS.find((m) => m.id === this.h.ctx().mapId) || MAPS[0]).name;
    const facts = free ? [['MAP', esc(mapName), 'map-trifold'], ['ROAD', TRAFFIC(e.traffic ?? 1), 'traffic-cone']] :
      [['DISTANCE', fmtDist(r.len), 'path'], ['FIELD', n ? `${n + 1} CARS` : 'JUST YOU', 'users-three'], ['ROAD', r.closed ? 'CLOSED CIRCUIT' : TRAFFIC(e.traffic ?? 1), 'traffic-cone']];
    const pb = free ? null : this.h.personalBests?.(e, r), T = (x) => this.h.fmtTime(x.time);
    const best = [pb?.exact && `<span>BEST <b>${T(pb.exact)}</b></span>`,
      pb?.route && (!pb.exact || pb.route.time < pb.exact.time) && `<span>ROUTE BEST <b>${T(pb.route)}</b> · ANY CAR</span>`].filter(Boolean);
    return `<div class="evs__top"><span class="evs__kick">${free ? 'FREE ROAM' : 'QUICK RACE'}</span>${r.reverse ? C.badge('REVERSE', 'cyan', 'arrows-left-right') : ''}</div>
      <h3 class="evs__name">${esc(free ? 'Explore the map' : 'Your race')}</h3>${free ? '' : `<p class="evs__route">${icon(r.closed ? 'arrows-clockwise' : 'map-pin')}<span>${routeLine(r)}</span></p>`}
      ${C.stats(facts.map(([k, v, ic]) => [k, v, { icon: ic }]), 'evs__facts')}${best.length ? `<p class="evs__best">${icon('timer')}${best.join('')}</p>` : ''}`;
  }


  // ---------------------------------------------------------------- race setup (event detail)
  setupDef() { if (this.data.mode === 'free') return window.__flow.freeRoamDef(); return { ...(this.eventsHere()[0] || QUICK_RACE), mapId: this.h.ctx().mapId, quick: true, name: 'QUICK RACE' }; }
  setupKey() { const d = this.setupDef(); return d.quick ? 'quick:' + (this.h.ctx().mapId || 'riviera') : d.id; }
  isClosed() { return !!this.h.ctx().route?.closed; }
  r_setup() {
    const def = this.setupDef(), closed = this.isClosed(), ctx = this.h.ctx(), saved = loadSetup(this.setupKey());
    const cur = resolveSetup(def, saved, { closed }), runDef = applySetup(def, saved, { closed }), r = resolve(runDef, ctx), custom = isCustom(def, saved, { closed });
    const A = { 'data-scope': 'setup' }, rows = [];
    for (const f of setupFields(def, { closed })) {
      if (f.key === 'rivals') rows.push(C.stepper({ key: 'rivals', label: 'AI RIVALS', icon: 'users-three', value: cur.rivals, min: f.min, max: f.max, format: 'rivals', attrs: A,
        note: f.dflt === cur.rivals ? 'DEFAULT' : `DEFAULT: ${f.dflt}`, noteCls: '' }));
      if (f.key === 'police') rows.push(C.segmented({ key: 'police', label: 'POLICE & LAWS', icon: 'police-car', value: cur.police ? cur.policeLevel : 'off', attrs: A, options: [['off', 'OFF'], ...POLICE_LEVELS],
        note: !cur.police ? '' : cur.policeLevel === 'relaxed' ? 'LATE TO NOTICE, SLOW TO ESCALATE, FEW UNITS' : cur.policeLevel === 'tough' ? 'SHARP-EYED, LITTLE TOLERANCE, MORE UNITS' : 'A WARNING FROM +25 KM/H IN VIEW, A CHASE IF YOU KEEP GOING' }));
      if (f.key === 'busted' && cur.police) rows.push(C.segmented({ key: 'busted', label: 'CAN BE BUSTED', icon: 'siren', value: String(cur.busted), type: 'bool', dflt: String(f.dflt), attrs: A, options: [['true', 'ON'], ['false', 'OFF']],
        note: cur.busted ? 'STOP NEXT TO A UNIT IN A CHASE AND YOU ARE PULLED OVER' : 'THEY CHASE YOU, THEY NEVER ARREST YOU' }));
      if (f.key === 'traffic') rows.push(C.segmented({ key: 'traffic', label: 'TRAFFIC', icon: 'traffic-cone', value: cur.traffic, type: 'num', dflt: f.dflt, attrs: A, options: f.levels.map(([, v, l]) => [v, l]) }));
      if (f.key === 'laps') rows.push(C.stepper({ key: 'laps', label: 'LAPS', icon: 'arrows-clockwise', value: cur.laps, min: f.min, max: f.max, format: 'laps', attrs: A, note: `${fmtDist(r.len)} IN TOTAL` }));
      if (f.key === 'reverse') rows.push(C.segmented({ key: 'reverse', label: 'DIRECTION', icon: 'arrows-left-right', value: String(cur.reverse), type: 'bool', dflt: 'false', attrs: A, options: [['false', closed ? 'CLOCKWISE' : 'FORWARD'], ['true', closed ? 'ANTI-CLOCKWISE' : 'REVERSE']] }));
      if (f.key === 'time') rows.push(C.select({ key: 'time', label: 'TIME OF DAY', icon: cur.time === 'night' ? 'moon' : cur.time === 'sunset' || cur.time === 'dawn' ? 'sun-horizon' : 'sun', value: cur.time, attrs: A, options: TIMES.map(([v, l]) => [v, v === f.dflt ? `${l} · DEFAULT` : l]) }));
      if (f.key === 'weather') rows.push(C.segmented({ key: 'weather', label: 'WEATHER', icon: cur.weather === 'rain' ? 'cloud-rain' : cur.weather === 'overcast' ? 'cloud' : 'sun', value: cur.weather, dflt: f.dflt, attrs: A, options: WEATHERS.map(([v, l]) => [v, l, v === 'rain' ? 'cloud-rain' : v === 'overcast' ? 'cloud' : 'sun']) }));
    }
    if (rows[0]) rows[0] = rows[0].replace('<div class="mi field', '<div data-default="" class="mi field'); // open on the first choice
    const note = '';
    return C.screen({ cls: 'scr--setup', kick: def.quick ? 'QUICK RACE' : `${TYPES[def.type].label} · ${esc((MAPS.find((m) => m.id === ctx.mapId) || MAPS[0]).name)}`, title: def.objectiveMode || def.type === 'free' ? 'SESSION SETUP' : 'RACE SETUP',
      hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['confirm', 'OK'], ['back', 'BACK']],
      body: `<div class="setup-layout"><aside class="panel panel--notch setup__event scroll-y">${this.eventSummary(runDef, r, runDef.id)}</aside>
        <section class="panel setup__form"><header class="panel__head"><h3 class="panel__title">${icon('sliders-horizontal')}${def.type === 'free' ? 'YOUR SESSION' : 'YOUR RACE'}</h3>${C.button({ label: 'DEFAULTS', icon: 'arrow-counter-clockwise', variant: 'ghost', size: 'sm', act: 'setupReset', disabled: !custom })}</header>
          <div class="setup__fields scroll-y">${this.participantChoice()}${rows.filter(row => /data-key="(?:rivals|traffic|time|police|busted)"/.test(row)).join('')}${C.button({ label: this.data.advanced ? 'HIDE ADVANCED OPTIONS' : 'ADVANCED OPTIONS', icon: 'sliders-horizontal', act: 'setupAdvanced', variant: 'ghost', size: 'sm' })}${this.data.advanced ? rows.filter(row => !/data-key="(?:rivals|traffic|time|police|busted)"/.test(row)).join('') : ''}</div>${note}
          <div class="setup__go">${C.button({ label: this.participants === 'multiplayer' ? 'HOST / CREATE GAME' : 'CHOOSE CAR', icon: this.participants === 'multiplayer' ? 'users-three' : 'car-profile', iconRight: 'caret-right', variant: 'primary', size: 'lg', block: true, act: 'setupGo' })}</div></section></div>` });
  }
  startSetup() {
    const def = this.setupDef(), runDef = applySetup(def, loadSetup(this.setupKey()), { closed: this.isClosed() });
    if (this.participants === 'multiplayer') { MP.openEntry(this, 'host', { mapId: this.h.ctx().mapId, eventId: def.id, mode: def.type, config: lobbyConfigToRaceSetup(resolveSetup(def, loadSetup(this.setupKey()), { closed: this.isClosed() })) }); return; }
    this.h.openEvent(runDef);
  }

  // ---------------------------------------------------------------- settings
  r_settings(d) {
    const tab = d.tab || 'audio';
    const tabsList = [['driver', 'DRIVER', 'user'], ['audio', 'SOUND', 'speaker-high'], ['video', 'GRAPHICS', 'monitor'], ['driving', 'DRIVING', 'steering-wheel'], ...(has('chaseFov') || has('mouseSensitivity') ? [['camera', 'CAMERA', 'camera']] : []), ['controls', 'CONTROLS', 'game-controller'], ['about', 'ABOUT', 'info']];
    const v = (k) => String(this.valueFor(k));
    let body = '';
    if (tab === 'driver') {
      body = `<div class="group"><h3 class="group__title">${icon('user')}DRIVER NAME</h3><label class="group__note" for="driver-name">YOUR PLATE & ONLINE NAME</label><input id="driver-name" data-driver-name maxlength="16" value="${esc(driverName.get())}" aria-label="Driver name" autocomplete="off" autocapitalize="characters" spellcheck="false"><p class="group__note">3–16 LETTERS, NUMBERS OR HYPHENS. SAVED IN THIS BROWSER. NAMES CAN BE SHARED.</p>${C.option({ icon: 'check', title: 'SAVE DRIVER NAME', act: 'saveDriverName' })}</div>`;
    } else if (tab === 'audio') {
      const keys = (S.AUDIO_VOLUMES || ['master', 'music', 'sfx']).filter(has);
      body = `<div class="group"><h3 class="group__title">${icon('speaker-high')}VOLUME</h3>${keys.map((k) => C.slider({ key: k, label: VOLUMES[k] || k.toUpperCase(), value: settings[k], attrs: SET })).join('')}${C.toggle({ key: 'swearing', label: 'SWEARING', value: !settings.mildLanguage, attrs: SET })}</div>`;
    } else if (tab === 'video') {
      // Graphics: one preset, plus Lighting / Effects / Resolution / Draw distance overrides (src/graphics.js). All fixed, all live.
      const gfx=resolveGraphics(settings),P=PRESETS[gfx.preset],L=PRESET_LABELS,pct=r=>Math.round(r*100)+'%';
      const presetNote={potato:'NO SHADOWS · NO POST-PROCESSING · LOW RESOLUTION · SHORT DRAW DISTANCE',low:'NO SHADOWS · LIGHT POST-PROCESSING · REDUCED RESOLUTION',med:'SOFT SHADOWS · CORE EFFECTS · FOR LAPTOPS',high:'FULL SHADOWS · ALL EFFECTS · FOR GAMING PCS',ultra:'LONGEST SHADOWS AND DRAW DISTANCE · HIGH-END GPUS'}[gfx.preset];
      const level=(key,title,note)=>C.segmented({key,label:title,value:v(key),options:[['preset','PRESET · '+L[P[key]]],...LEVEL_IDS.map(id=>[id,id==='med'?'MED':L[id]])],note,attrs:SET});
      const screen=Math.min(globalThis.devicePixelRatio||1,2),presetRes=Math.min(screen,P.pixelRatio)/screen;
      body = `<div class="group graphics-quality"><h3 class="group__title">${icon('monitor')}PRESET</h3>${C.segmented({ key: 'graphics', label: 'GRAPHICS PRESET', value: gfx.preset, options: PRESET_IDS.map(id=>[id,L[id]]), note:presetNote+' · APPLIES LIVE', attrs: SET })}</div>
        <div class="group graphics-detail"><h3 class="group__title">${icon('sun')}LIGHTING & EFFECTS</h3>${level('lighting','LIGHTING','SHADOWS AND SHINY CAR REFLECTIONS · OFF IS FASTEST')}${level('effects','EFFECTS','SMOOTH EDGES, GLOW, MOTION BLUR, SOFT CORNER SHADING, MIRROR SHARPNESS, SEA REFLECTIONS, RAIN DETAIL · OFF IS FASTEST')}</div>
        <div class="group graphics-resolution"><h3 class="group__title">${icon('cube')}RESOLUTION</h3>${C.select({key:'renderScale',label:'RESOLUTION',value:v('renderScale'),options:[['auto','PRESET · '+pct(presetRes)],...Array.from({length:11},(_,i)=>[String((50+i*5)/100),(50+i*5)+'%'])],note:'HOW SHARP THE PICTURE IS · LOWER IS BLURRIER BUT FASTER · NOW '+pct(gfx.resolution)+' OF YOUR SCREEN · NEVER CHANGES BY ITSELF',attrs:SET})}${C.segmented({key:'frameCap',label:'FRAME RATE LIMIT',value:v('frameCap'),options:[['30','30 FPS'],['60','60 FPS'],['120','120 FPS'],['0','NO LIMIT']],note:'LOWER KEEPS LAPTOPS COOLER, QUIETER AND ON BATTERY LONGER',attrs:SET})}</div>
        <div class="group"><h3 class="group__title">${icon('mountains')}RENDER</h3>${C.segmented({ key: 'drawDistance', label: 'DRAW DISTANCE', value: v('drawDistance'), options: [['auto', 'PRESET · '+(P.drawDistance>=1000?P.drawDistance/1000+' KM':P.drawDistance+' M')], ['300', '300 M'], ['500', '500 M'], ['1000', '1 KM'], ['2000', '2 KM'], ['4000', '4 KM']], note: 'HOW FAR AWAY TREES, PROPS, CARS AND PEOPLE ARE DRAWN IN DETAIL · BEYOND IT THEY BECOME SIMPLE SHAPES · LOWER IS FASTER', attrs: SET })}
          ${C.toggle({ key: 'motionBlur', label: 'MOTION BLUR', value: settings.motionBlur !== false, attrs: SET })}
          ${C.toggle({ key: 'mirrors', label: 'MIRRORS', value: settings.mirrors !== false, note: 'SEE BEHIND YOU · ON AT EVERY PRESET · REAR-VIEW STRIP IN THE CHASE CAMERA', attrs: SET })}
          ${C.toggle({ key: 'perfOverlay', label: 'PERFORMANCE OVERLAY', value: settings.perfOverlay === true, note: 'FPS · FRAME MS · DRAW CALLS · F3 TOGGLES IT TOO', attrs: SET })}<p class="graphics-live-note">Changes apply immediately, including while online.</p></div>
        <div class="group"><h3 class="group__title">${icon('speedometer')}UNITS</h3>${C.segmented({ key: 'units', label: 'SPEED UNITS', value: v('units'), options: [['kmh', 'KM/H'], ['mph', 'MPH']], attrs: SET })}</div>`;
    } else if (tab === 'driving') {
      body = `<div class="group"><h3 class="group__title">${icon('steering-wheel')}ASSISTS</h3>${C.toggle({ key:'showTyreGrip',label:'SHOW TYRE GRIP',value:settings.showTyreGrip,attrs:SET })}${C.toggle({ key: 'aids', label: 'TRACTION / STABILITY · TC ESC', value: settings.aids, attrs: SET })}${C.toggle({ key: 'abs', label: 'BRAKING ASSIST · ABS', value: settings.abs, attrs: SET })}
          ${C.segmented({ key: 'steeringAssist', label: 'STEERING ASSIST', value: v('steeringAssist'), options: [['off', 'OFF'], ['light', 'LIGHT'], ['full', 'FULL']], attrs: SET, note: settings.steeringAssist === null ? 'FOLLOWS YOUR DEVICE UNTIL YOU CHOOSE' : '' })}
          ${C.segmented({ key: 'transmission', label: 'GEARBOX', value: v('transmission'), options: [['auto', 'AUTO'], ['manual', 'MANUAL']], attrs: SET, note: C.keyHints([['transmission', 'TOGGLE MODE'], ['shiftDown', 'SHIFT DOWN'], ['shiftUp', 'SHIFT UP']]) })}</div>`;
    } else if (tab === 'camera') {
      const sl = (k, label, min, max, step, format) => has(k) ? C.slider({ key: k, label, value: settings[k], min, max, step, format, attrs: SET }) : '';
      const tg = (k, label) => has(k) ? C.toggle({ key: k, label, value: settings[k], attrs: SET }) : '';
      body = `<div class="group"><h3 class="group__title">${icon('camera')}VIEW</h3>${sl('chaseFov', 'CHASE FIELD OF VIEW', 45, 75, 1, 'deg')}${sl('cockpitFov', 'COCKPIT FIELD OF VIEW', 45, 90, 1, 'deg')}${tg('speedFov', 'SPEED FOV EFFECT')}${has('hudMotion') ? C.segmented({ key: 'hudMotion', label: 'HUD MOTION', value: v('hudMotion'), options: [['off', 'OFF'], ['subtle', 'SUBTLE'], ['full', 'FULL']], attrs: SET }) : ''}</div>
        <div class="group"><h3 class="group__title">${icon('mouse')}FREE LOOK</h3>${sl('mouseSensitivity', 'LOOK SENSITIVITY', 0.25, 3, 0.05, 'x')}${tg('invertLookY', 'INVERT LOOK Y')}
          <p class="group__note">Click the racing view to look around. Hold and drag if the pointer cannot be locked. The right stick also looks.</p></div>
        <div class="group"><h3 class="group__title">${icon('map-pin')}TAGS</h3>${tg('playerMarkers', 'ONLINE PLAYER TAGS')}${tg('rivalMarkers', 'AI RIVAL TAGS')}</div>`;
    } else if (tab === 'controls') body = renderControls(this);
    else if (tab === 'about') body = Release.renderAbout(this);
    return C.screen({ cls: 'scr--settings', kick: d.from === 'pause' ? 'PAUSED' : 'OPTIONS', title: 'SETTINGS',
      head: C.tabs({ key: 'settingsTab', value: tab, options: tabsList }),
      hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['tabs', 'TAB'], ...(tab === 'controls' ? [['confirm', 'REBIND']] : []), ['back', 'BACK']],
      body: `<div class="set-panel panel scroll-y">${body}</div>` });
  }
  /** leaving the settings screen: drop any half-done key capture */
  leaving() { this.mapView?.dispose(); this.mapView = null; if (this.screen === 'settings') this.h.cancelBindings?.(); C.closeListbox(); this.carView?.dispose(); this.carView = null; }

  // ---------------------------------------------------------------- pause
  r_pause(d) {
    const r = d.r, def = d.def;
    const kick = def ? `${esc(def.name)} · ${r?.closed ? `${esc(d.mapName || '')} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'}` : r ? routeLine(r) : ''}` : esc(d.kick || '');
    return `<div class="scr scr--pause"><div class="pause-card panel panel--notch"><div class="kick">${kick}</div><h2 class="title-xl">PAUSED</h2>${d.sub ? `<div class="pause__sub">${icon('timer')}${esc(d.sub)}</div>` : ''}
      <div class="pause__list">${C.option({ icon: 'play', title: 'RESUME', act: 'resume', attrs: { 'data-default': '' } })}${d.inFreeRoam ? C.option({ icon: 'car-profile', title: 'CHANGE CAR', act: 'roamCar' }) + C.option({ icon: 'cloud-rain', title: 'TIME & WEATHER', act: 'roamConditions' }) + C.option({ icon: 'map-pin', title: 'TELEPORT TO LANDMARK', act: 'roamLandmarks' }) + C.option({ icon: 'truck', title: 'TOW TO ROAD', act: 'roamTow' }) : ''}${d.online || d.inFreeRoam ? '' : C.option({ icon: 'arrow-counter-clockwise', title: 'RESTART', act: 'restart' })}${window.__flow?.resetCar?C.option({icon:'truck',title:'RESET TO ROAD',act:'reset'}):''}${d.online?C.option({icon:'users-three',title:'LOBBY & HOST CONTROLS',act:'onlineLobby'}):''}${d.online&&window.__multiplayer?.lobby?.status==='race'&&!window.__multiplayer?.retired&&window.__multiplayer?.me?.finish==null?C.option({icon:'flag-checkered',title:'RETIRE · DNF',act:'retire'}):''}${C.option({ icon: 'gear-six', title: 'SETTINGS', act: 'settings' })}${C.option({ icon: 'sign-out', title: d.online ? 'BACK TO MENU' : 'QUIT TO MENU', act: 'quit' })}</div><div class="pause-controls">${C.button({ label: drivingHints.enabled ? 'HIDE DRIVING CONTROLS' : 'SHOW DRIVING CONTROLS', icon: 'game-controller', act: 'drivingHints', variant: 'ghost', size: 'sm' })}${drivingHints.enabled ? controlsStrip({ device: this.h.inputDevice?.() || 'keyboard', car: this.h.carSpec?.() || window.__game?.player?.spec, manual: this.h.manual?.() ?? true }) : ''}</div></div>
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
    const r = d.r, def = d.def;
    const kick = def && r ? (r.closed ? `${esc(d.mapName || def.name)} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'} · ${fmtDist(r.len)}` : `${esc(def.name)} · ${routeLine(r)} · ${fmtDist(r.len)}`) : esc(d.kick || '');
    const splits = d.splits?.length ? C.panel('SPLITS', `<table class="r-table">${d.splits.map((s) => `<tr><td>${esc(s.name)}</td><td class="tnum">${s.time}</td><td class="tnum ${s.cls || ''}">${s.delta || ''}</td></tr>`).join('')}</table>`, { icon: 'timer' }) : '';
    const field = d.field?.length ? C.panel('CLASSIFICATION', `<table class="r-table">${d.field.map((f) => `<tr class="${f.me ? 'me' : ''}"><td class="r-pos">P${f.pos}</td><td>${esc(f.name)}<small>${esc(f.car || '')}</small></td><td class="tnum ${f.running ? 'run' : ''}">${f.time}</td></tr>`).join('')}</table>`, { icon: 'flag-checkered' }) : '';
    const tiles = (d.rows || []).filter(([k]) => !/EVENT BEST|MEDAL|RECORD/i.test(k)).map(([k, v, hi]) => C.stat(esc(k), v, { tone: hi ? 'hi' : '' }));
    const act = (a, ic, label, v = 'secondary') => C.button({ label, icon: ic, act: a, variant: v, attrs: a === 'retry' ? { 'data-default': '' } : null });
    return C.screen({ cls: `scr--results ${d.win ? 'is-win' : 'is-lose'}`, back: false, kick, hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'MAIN MENU']],
      body: `<div class="res-layout"><div class="res-main">
        <h2 class="res-title">${esc(d.title || '')}</h2>${d.sub ? `<p class="res-sub">${d.sub}</p>` : ''}
        ${personalBestLabel(d.result?.personalBest) ? C.badge(esc(personalBestLabel(d.result.personalBest)), 'good', 'timer') : ''}
        <div class="stats res-stats">${tiles.join('')}</div>
        <div class="res-actions">${act('retry', 'arrow-counter-clockwise', 'RETRY', 'primary')}${d.result?.time != null ? act('shareResult', 'export', 'SHARE') : ''}${act('list', 'list', 'MAIN MENU')}</div>
      </div><div class="res-side scroll-y">${field}${splits}</div></div>` });
  }
}
