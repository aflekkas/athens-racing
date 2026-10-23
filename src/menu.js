import { renderLeaderboards, renderBestRecord, renderTrackTimes, renderSetupRecords, leaderboardChange } from './leaderboards-screen.js';
import { seatPosition, setSeatPosition, resetSeatPosition } from './seat-position.js';
import { loadUnifiedRouteCatalogue } from './unified-routes.js';
import { importWithUpdate } from './client-release.js';
import { install as installAccounts } from './ui/account-loader.js';
// MENUS: title, mode select, map select, race setup, car select, settings, pause and results.
// Plain DOM in #ui (index.html), built from the UI kit (src/ui/components.js + ui.css) and styled by src/menu.css.
// Navigation: mouse, or the named input actions main.js routes here (up / down / left / right / confirm / back,
// shiftUp / shiftDown switch tabs) from keyboard and gamepad. Up / down / left / right move focus spatially
// (lists, grids and card rails alike); on an adjustable row (slider, toggle, segmented, stepper, select) left / right
// change its value. Menu items are not native <button>s on purpose: the input system ignores key events aimed at
// focused form controls, so focus is drawn with a class and the keys keep flowing through flowAction().
import { getEvents, QUICK_RACE, TYPES, resolve, SP_RIVALS, MAX_RIVALS } from './events.js';
import * as S from './settings.js';
import { renderMapSelect, selectMap, mountMapSelect } from './map-select.js';
import { renderSpawnSelect, mountSpawnSelect, driveFromSpawn } from './spawn-select.js';
import { CARS } from './cars.js';
import { GARAGE_CARS } from './car-catalog.js';
let garage;
const loadGarage = () => garage ? Promise.resolve(garage) : importWithUpdate(() => import('./car-select.js')).then(module => garage = module);
import * as C from './ui/components.js';
import { resolveGraphics } from './graphics.js';
import { installSettingsAccess } from './ui/settings-access.js';
import { renderControls, controlsClick, controlsAction, controlsChange } from './ui/controls-panel.js';
import { setupFields, loadSetup, saveSetup, applySetup, resolveSetup, isCustom, TIMES, WEATHERS, POLICE_LEVELS } from './race-setup.js';
import { MAPS } from './map-catalog.js';
import * as MP from './ui/mp-loader.js';
import { personalBestLabel } from './personal-bests.js';
import './ui/hosts.js';
import { driverName } from './driver-name.js';
import { controlsStrip, drivingHints } from './ui/driving-hints.js';
import * as Release from './ui/release-screens.js';
import { installArticleScroll, articleAction, clearArticleFocus } from './ui/article-scroll.js';

const { settings, setSetting, steeringAssistChoice, fmtDist } = S;
const { esc, icon } = C;
const arrow = (rev) => icon(rev ? 'arrow-left' : 'arrow-right', 'ico--route');
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const count = (n) => NUM[n] || String(n);
/** the Quick Race card line, from the real default and cap */
/** the RACE card played last (Quick Race or Free Roam), remembered on this device */
const lastMode = () => { try { return localStorage.getItem('paraliaki.lastMode') === 'free' ? 'free' : 'quick'; } catch { return 'quick'; } };
const rememberMode = mode => { try { localStorage.setItem('paraliaki.lastMode', mode); } catch {} };
const quickBlurb = () => `Pick a track and race ${count(SP_RIVALS)} locals against the clock.`;
const routeLine = (r) => r.closed ? `${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'}` : `${esc(r.fromName)} ${arrow(false)} ${esc(r.toName)}`;
// Race Setup header copy. The Penteli descent runs its map's road the other way; regions are what a player calls the place.
const PLACE = { 'penteli-descent': 'Karakanta to Dionysos' };
const REGION = { athens: 'ATHENS', riviera: 'ATHENS', psychiko: 'ATHENS', penteli: 'PENTELI', megara: 'MEGARA' };
/** a compiled world route as a small outline: plan view (x, z), north up, scaled into a fixed box; cached per geometry */
const outlines = new Map();
function routeOutline(compiled) {
  const key = compiled.geometryHash || compiled.id;
  if (outlines.has(key)) return outlines.get(key);
  const pts = compiled.points || [], step = Math.max(1, Math.floor(pts.length / 160)), xy = [];
  for (let i = 0; i < pts.length; i += step) xy.push([pts[i][0], pts[i][2]]);
  if (pts.length) xy.push([pts.at(-1)[0], pts.at(-1)[2]]);
  let svg = '';
  if (xy.length > 1) {
    const xs = xy.map((p) => p[0]), zs = xy.map((p) => p[1]), x0 = Math.min(...xs), z0 = Math.min(...zs), dx = Math.max(...xs) - x0 || 1, dz = Math.max(...zs) - z0 || 1;
    const W = 320, H = 120, k = Math.min((W - 12) / dx, (H - 12) / dz), ox = (W - dx * k) / 2, oz = (H - dz * k) / 2;
    const line = xy.map(([x, z]) => `${(ox + (x - x0) * k).toFixed(1)},${(oz + (z - z0) * k).toFixed(1)}`).join(' ');
    const [sx, sz] = line.split(' ')[0].split(',');
    svg = `<svg class="route-outline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><polyline class="route-outline__line" points="${line}"/><circle class="route-outline__start" cx="${sx}" cy="${sz}" r="3.2"/></svg>`;
  }
  outlines.set(key, svg);
  return svg;
}
C.registerFormat('seatCm',v=>(v>0?'+':'')+Math.round(v*100)+' cm');
C.registerFormat('rivals', (v) => (+v === 0 ? 'NONE · SOLO' : `${v} ${+v === 1 ? 'RIVAL' : 'RIVALS'}`));
C.registerFormat('laps', (v) => `${v} ${+v === 1 ? 'LAP' : 'LAPS'}`);
C.registerFormat('deg', (v) => Math.round(v) + '°');
const VOLUMES = { master: 'MASTER', sfx: 'EFFECTS', engine: 'ENGINE', tyres: 'TYRES', ambience: 'AMBIENCE', traffic: 'TRAFFIC', voice: 'VOICES', ui: 'MENU SOUNDS' };
const has = (k) => k in settings;
const SET = { 'data-scope': 'setting' };

export class Menu {
  /**
   * root: the #ui element. h: handlers from main.js
   *   quickRace(), openEvent(def | id), chooseCar(index, def, garage), multiplayer(), garage(), resume(), restart(), quit(), next(id)
   *   ctx() -> resolve context { route, marks, mapId }, carName() -> string, fmtTime(t), ui(forward) (click sound)
   *   cancelBindings() (drop a half-done key capture), inputDevice()
   */
  constructor(root, h) {
    this.root = root; this.h = h; this.screen = null; this.data = {}; this.focus = 0; this.stack = [];
    this.filter = 'all';
    C.bindRoot(root); root.tabIndex = -1; installSettingsAccess(this); MP.installMpScreens(this); Release.install(this); installAccounts(this); installArticleScroll(this);
    root.addEventListener('focusin', e => { const row = e.target.closest('.mi'); const i = this.items().indexOf(row); if(i >= 0) this.setFocus(i, false); });
    root.addEventListener('keydown', e => { if(e.code !== 'Escape' || !e.target.closest('input, textarea, [contenteditable]')) return; e.preventDefault(); e.stopPropagation(); e.target.blur(); root.focus({preventScroll:true}); }, true);
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('ui:change', (e) => this.onChange(e.detail));
    root.addEventListener('input', e => { if (!e.target.matches('[data-car-search]')) return; const value = e.target.value, pos = e.target.selectionStart; this.data.filters = { ...this.data.filters, search: value }; this.render({ morph: true }); const search = root.querySelector('[data-car-search]'); search.focus(); search.setSelectionRange?.(pos, pos); });
  }
  get open() { return !!this.screen; }

  // ---------------------------------------------------------------- show / hide
  /** A race's car picker, open on that car with the garage grid under it for Back (owner 2026-10-20: fewer steps). Both
   * screens go on once the garage module is in, so a cold start cannot drop the second. */
  pickCar(data) {
    const from = this.screen;
    void loadGarage().then(() => { if (this.screen !== from) return; this.show('car', data, true); this.show('car', { ...data, detail: true }, true); })
      .catch(error => C.ui.toast(error.message, { tone: 'bad' }));
  }
  show(screen, data = {}, push = false) {
    if (screen === 'car' && !garage) {
      const from = this.screen;
      void loadGarage().then(() => { if (this.screen === from) this.show(screen, data, push); }).catch(error => C.ui.toast(error.message, { tone: 'bad' }));
      return;
    }
    if (screen === 'routes') { screen = 'maps'; data = { ...data, mode: 'quick' }; }
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
    C.exitBackdrop(this.root);
    this.screen = this.shown = null; this.stack.length = 0; MP.afterRender(this); this.root.innerHTML = '';
    document.body.classList.remove('ui-open'); delete document.body.dataset.ui; MP.syncFlag(null);
  }
  /** morph: patch the current screen in place (refresh, tab switch, search) instead of rebuilding it */
  render({ morph = false } = {}) {
    const entering = this.screen !== this.shown;
    if (entering) C.exitBackdrop(this.root);
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
    else if (this.screen === 'car') this.carView = this.data.detail ? garage.mountCarSelect(this.root, this.data.index || 0) : garage.mountCarGrid(this.root);
    if (this.screen === 'maps') this.mapView = this.data.mode === 'free' ? mountSpawnSelect(this.root, this) : mountMapSelect(this.root, this.data.catalogue, id => selectMap(this, id));
    for (const t of this.root.querySelectorAll('.tabs')) { const on = t.querySelector('.tab.on'); if (on && t.scrollWidth > t.clientWidth) t.scrollLeft = on.offsetLeft - (t.clientWidth - on.offsetWidth) / 2; }
    if (this.screen === 'settings' && this.data.tab === 'controls') this.h.cancelBindings?.();
    const it = this.items();
    let f = this.focus;
    if (f == null) { f = it.findIndex((el) => el.dataset.default != null); if (f < 0) f = it.findIndex((el) => el.dataset.kind !== 'tabs' && el.dataset.act !== 'account'); }
    if (this.data.keepScroll && keep != null) { const b = this.root.querySelector('.scr__body .scroll-y, .scr__body'); if (b) b.scrollTop = keep; }
    this.setFocus(Math.min(Math.max(0, f), Math.max(0, it.length - 1)), !this.data.keepScroll && !(this.screen === 'car' && this.data.detail));
    clearArticleFocus(this); this.data.keepScroll = false; C.indicators(this.root);
  }
  /** the morph path of render(): only nodes whose markup changed are touched, so focus, scroll and the garage
   *  thumbnails survive and nothing flashes */
  patch() {
    C.closeListbox();
    const fn = this['r_' + this.screen]; C.morph(this.root, fn ? fn.call(this, this.data) : '');
    if (this.screen === 'car') { this.carView?.dispose(); this.carView = garage.mountCarGrid(this.root); } // observe new thumbnails
    MP.afterRender(this);
    if (this.screen === 'settings' && this.data.tab === 'controls') this.h.cancelBindings?.();
    const it = this.items(); this.setFocus(Math.min(Math.max(0, this.focus ?? 0), Math.max(0, it.length - 1)), false);
    clearArticleFocus(this); this.data.keepScroll = false; C.indicators(this.root); // selection glides to its new item
  }
  /** re-render in place (a value changed that other rows depend on); focus stays on the same item even when others
   *  appear or disappear (e.g. DEFAULTS becomes available) */
  refresh() {
    const id = (el) => el && ['fid', 'key', 'act', 'ev', 'mapId', 'action', 'color'].map((k) => el.dataset[k]).find((v) => v != null);
    const want = id(this.items()[this.focus]);
    this.data.keepScroll = true; this.render({ morph: true });
    if (want != null) { const i = this.items().findIndex((el) => id(el) === want); if (i >= 0 && i !== this.focus) this.setFocus(i, false); }
  }
  items() { const scope = this.root.querySelector('[data-dialog]') || this.root; return [...scope.querySelectorAll('.mi:not(.off)')].filter((el) => el.offsetParent !== null || el.getClientRects().length); }
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
    if (this.mapLoading) return true;
    C.navigationFocus();
    if (C.ui.action(name)) return true;
    if (this.screen === 'maps' && this.mapView?.action(name)) return true;
    if (articleAction(this, name)) return true; // Credits, What's new: smooth page scrolling; left / right step between links
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
    // Deep-linked Race Setup (Athens route URL, reload, version update): nothing to pop to, so Back opens the
    // track picker it came from instead of the title screen.
    if (this.screen === 'setup' && this.data.catalogue?.length) { this.show('maps', { catalogue: this.data.catalogue, mode: this.data.mode || 'quick' }); return; }
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
      case 'unifiedRoute': void Promise.resolve().then(() => this.h.selectUnifiedRoute(el.dataset.route,el.dataset.event)).catch(error => C.ui.toast(error.message, { tone: 'bad' })); break;
      case 'seatReset': { resetSeatPosition(this.h.carSpec?.()?.id); for(const key of ['height','position']){const el=this.root.querySelector('[data-key=seat-'+key+']');if(el)C.setValue(el,0,false);} break; }
      case 'mapPrev': case 'mapNext': case 'mapZoomIn': case 'mapZoomOut': this.mapView?.action(a); break;
      case 'spawnDrive': driveFromSpawn(this); break;
      case 'spawnCar': this.h.garage?.(); break;
      case 'saveDriverName': { const input = this.root.querySelector('[data-driver-name]'); try { driverName.set(input.value); input.value = driverName.get(); C.ui.toast('DRIVER NAME SAVED'); } catch (error) { C.ui.toast(error.message, { icon: 'triangle-alert', tone: 'bad' }); input.focus(); } break; }
      case 'drivingHints': drivingHints.toggle(); this.refresh(); break;
      case 'account': this.show('account', {}, true); break;
      case 'leaderboards': this.show('leaderboards', { tab: 'global', filters: { mapId: this.data.mapId, eventId: this.data.eventId } }, true); break;
      case 'trackTimesRetry': this.data.trackTimes = null; this.refresh(); break;
      case 'mapContinue': this.show('setup', { eventId: this.data.eventId, mode: 'quick' }, true); break;
      case 'leaderboardAdvanced': this.data.advanced = !this.data.advanced; this.refresh(); break;
      case 'leaderboardReset': this.data.filters = { mapId: this.data.filters.mapId }; this.refresh(); break;
      case 'leaderboardRetry': this.data.requestKey = null; this.refresh(); break;
      case 'play': this.show('mode', {}, true); break;
      case 'quick': void this.openQuickRace(); rememberMode('quick'); break;
      case 'free': this.filter = 'free'; this.show('maps', { filter: 'free', mode: 'free' }, true); rememberMode('free'); break;
      case 'raceAgain': (this.h.raceAgain || this.h.restart)(); break;
      case 'changeCar': (this.h.changeCar || this.h.restart)(); break;
      case 'roamCar': this.h.freeRoamCar?.(); break;
      case 'roamConditions': this.h.roamConditions?.(); break;
      case 'roamLandmarks': this.h.roamLandmarks?.(); break;
      case 'roamTow': this.h.roamTow?.(); break;
      case 'carDetail': this.show('car', { ...this.data, index: +el.dataset.carIndex, detail: true }, true); break;
      case 'carConfirm': this.confirmCar(); break;
      case 'paint': this.carView?.paint(el.dataset.color); for (const paint of this.root.querySelectorAll('.paint')) paint.classList.toggle('selected', paint === el); this.root.querySelector('.car-paint-name').textContent = el.title; break;
      case 'setupAdvanced': this.data.advanced = !this.data.advanced; this.refresh(); break;
      case 'setupHistory': this.data.showHistory = !this.data.showHistory; this.refresh(); break;
      case 'setupGo': this.startSetup(); break;
      case 'setupReset': saveSetup(this.setupKey(), {}); this.refresh(); C.ui.toast('DEFAULTS RESTORED', { icon: 'rotate-ccw' }); break;
      case 'multiplayer': case 'mp': case 'mpJoin': MP.openEntry(this, 'join'); break;
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
  /** a component value changed (keyboard, gamepad or mouse) */
  onChange({ key, value, el }) {
    const scope = el.dataset.scope;
    if (scope === 'leaderboard' || key === 'leaderboardTab') { leaderboardChange(this, key, value); return; }
    if (MP.isMpScreen(this.screen) && MP.change(this, { key, value, el })) return;
    if (scope === 'catalog') { this.data.filters = { ...this.data.filters, [key]: value }; this.refresh(); return; }
    if (el.dataset.kind === 'tabs') {
      if (key === 'settingsTab') { this.h.cancelBindings?.(); this.data.tab = value; this.render({ morph: true }); const scroll = this.root.querySelector('.set-panel'); if (scroll) scroll.scrollTop = 0; }
      return;
    }
    if (scope === 'roam') { window.__flow.setRoamConditions({ [key]: value }); return; }
    if (scope === 'setting') {
      if(key.startsWith('seat-')){setSeatPosition(this.h.carSpec?.()?.id,key.slice(5),value);return;}
      if (key === 'swearing') { setSetting('mildLanguage', !value); return; }
      if(key==='renderScale'||key==='pixelRatioCap'){setSetting(key,key==='renderScale'&&value==='auto'?'auto':Number(value));if(this.root)this.refresh();return;}
      if(key==='drawDistance'){setSetting(key,value==='auto'?'auto':Number(value));return;}
      setSetting(key, value);
      return;
    }
    if (scope === 'input') { controlsChange(this, key, value, el); return; }
    if (scope === 'setup' && key === 'event') { // its own saved setup and records; the screen stays, so Back still leads to the map
      const e = this.setupEvents().find((x) => x.id === value);
      if (e) { this.data.def = e; this.data.eventId = e.id; this.data.trackTimes = null; this.data.showHistory = false; this.refresh(); }
      return;
    }
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
  valueFor(key) { if(key.startsWith('seat-'))return seatPosition(this.h.carSpec?.()?.id)[key.slice(5)]; if (key === 'swearing') return !settings.mildLanguage; return key === 'steeringAssist' ? steeringAssistChoice(settings.steeringAssist, this.h.inputDevice?.() || 'keyboard') : settings[key]; }
  /** settings changed elsewhere (e.g. the steering assist following the active device) */
  refreshValues() { for (const el of this.root.querySelectorAll('[data-scope=setting][data-key]')) C.setValue(el, String(this.valueFor(el.dataset.key)), false); }

  // ---------------------------------------------------------------- title / mode
  // Account integration hook: replace r_account or supply h.account(menu) to render the full account route.
  r_account() {
    return this.h.account?.(this) || C.sheetList({ variant: 'flow', title: 'Account', kick: 'YOUR DRIVER', rows: '<p class="group__note">Sign-in, friends and invites are coming here.</p>', hints: [['back', 'BACK']] });
  }
  r_title() {
    return C.heroTiles({ variant: 'title', kick: 'GREEK ROADS <span class="acc">/</span> PURE TIME', intro: `<h1 class="title__mark">${C.brandMark()}${C.wordmark()}</h1>
      <p class="title__tag">Real roads of Attica: the Athens Riviera and the Penteli hill climb.</p>`, tiles: `${C.option({ icon: 'flag', title: 'PLAY', desc: 'Quick Race or Free Roam against the clock', act: 'play', cls: 'option--tile option--hero', attrs: { 'data-default': '' } })}
        ${C.option({ icon: 'users', title: 'MULTIPLAYER', desc: 'Browse open lobbies, join with a code or host your own', act: 'multiplayer', cls: 'option--tile' })}
        ${C.option({ icon: 'car', title: 'GARAGE', desc: `${GARAGE_CARS.length} cars · city to super`, act: 'garage', cls: 'option--tile' })}
        ${C.option({ icon: 'settings', title: 'SETTINGS', desc: 'Sound, graphics, driving and controls', act: 'settings', cls: 'option--tile' })}`, foot: Release.titleExtras(this), hints: [['select', 'SELECT'], ['confirm', 'OK'], ['garage', 'GARAGE']] });
  }
  async openQuickRace() {
    if (this.loadingRoutes) return;
    const screen = this.screen, data = this.data;
    this.loadingRoutes = true;
    try {
      const catalogue = await loadUnifiedRouteCatalogue({ allowEmpty: true });
      if (this.screen !== screen || this.data !== data) return;
      this.filter = 'sprint'; this.show('maps', { catalogue, filter: 'sprint', mode: 'quick' }, true);
    } catch (error) {
      if (this.screen === screen && this.data === data) C.ui.toast(error.message, { tone: 'bad' });
    } finally { this.loadingRoutes = false; }
  }
  r_routes(d) { return renderMapSelect(undefined, d.catalogue); }
  r_leaderboards(d) { return renderLeaderboards(this, d); }
  // RACE is solo (owner 2026-10-18): two artwork-led cards fill the screen; multiplayer lives behind the title's MULTIPLAYER tile.
  r_mode() {
    const art = (src) => `<img src="${esc(src)}" alt="" decoding="async">`;
    // The card you played last is focused, so Enter repeats it (owner 2026-10-20: fewer steps to get anywhere).
    const last = lastMode(), tile = (act, ic, title, desc, src, cta) => C.option({ icon: ic, title, desc, act, cls: 'option--tile option--feature', media: art(src), cta, attrs: act === last ? { 'data-default': '' } : undefined });
    return C.heroTiles({ variant: 'choices', cls: 'scr--mode', title: 'RACE', hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'BACK']],
      tiles: `${tile('quick', 'flag', 'QUICK RACE', quickBlurb(), MAPS.find((m) => m.id === 'penteli')?.preview || MAPS[0].preview, 'CHOOSE TRACK')}${tile('free', 'car', 'FREE ROAM', 'Pick where to start on the map and just drive.', './assets/maps/attica.svg', 'CHOOSE SPAWN')}` });
  }

  // ---------------------------------------------------------------- multiplayer (src/ui/mp-screens.js)
  r_releaseImage() { return Release.renderImage(this); }
  r_whatsNew() { return Release.renderWhatsNew(this); }
  r_credits() { return Release.renderCredits(this); }
  r_creditFile() { return Release.renderCreditFile(this); }
  r_mp(d) { return MP.renderMp(this, window.__multiplayer, d); }
  r_mpHost() { return MP.renderHost(this, window.__multiplayer); }
  r_mpLobby() { return MP.renderLobby(this, window.__multiplayer); }
  r_mpCars() { return MP.renderCars(this, window.__multiplayer); }
  r_mpResults() { return MP.renderResults(this, window.__multiplayer); }

  // ---------------------------------------------------------------- maps
  r_maps() { return this.data.mode === 'free' ? renderSpawnSelect(this) : renderMapSelect(this.h.ctx?.().route?.compiled?.id || this.h.ctx?.().mapId, this.data.catalogue); }
  r_mapConfirm(d) {
    const map = MAPS.find(m => m.id === d.mapId) || MAPS[0], def = this.setupDef();
    d.eventId = (def.baseId || def.id).split('~')[0];
    return C.stageInspector({ variant: 'overview', cls: 'scr--track', kick: 'QUICK RACE', title: esc(map.name),
      hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'BACK']],
      stage: C.panel('',
        `${map.preview ? `<img class="setup__map" src="${esc(map.preview)}" alt="Route preview: ${esc(map.name)}">` : ''}<p>${esc(map.subtitle)}</p>${C.stats([['LENGTH', fmtDist(map.length)], ['ROUTE', map.type === 'circuit' ? 'CIRCUIT' : 'POINT TO POINT']])}`), inspector: renderTrackTimes(this, d, { mapId: map.id, eventId: d.eventId }),
      actions: `${C.button({ label: 'LEADERBOARD', icon: 'timer', act: 'leaderboards' })}${C.button({ label: 'RACE SETUP', icon: 'sliders-horizontal', iconRight: 'chevron-right', variant: 'primary', act: 'mapContinue', attrs: { 'data-default': '' } })}` });
  }

  // ---------------------------------------------------------------- car
  r_car(d) { return garage.renderCarSelect(d); }
  confirmCar() {
    const c = CARS[this.data.index || 0];
    if (this.data.allowedCars && !this.data.allowedCars.includes(c.id)) return;
    if (this.data.onPick) { const pick = this.data.onPick; const roaming = this.data.inFreeRoam; if (pick(c.id) === false) return; const origin = [...this.stack].reverse().find(x => x.screen !== 'car'); if (roaming) this.show('pause', origin?.data || { inFreeRoam: true }); else if (origin) this.show(origin.screen, origin.data); else this.hide(); return; }
    this.h.chooseCar?.(this.data.index || 0, this.data.def, this.data.garage);
  }

  // ---------------------------------------------------------------- events
  eventsHere() {
    const ctx = this.h.ctx();
    if(ctx.route?.isWorldRoute)return (ctx.events||[]).filter(e=>e.id===(this.data.eventId||ctx.eventId||ctx.events?.[0]?.id));
    return this.data.mode === 'quick' ? [ctx.mapId === 'riviera' ? QUICK_RACE : (ctx.events || getEvents(ctx.mapId)).find((e) => e.type === 'sprint')].filter(Boolean) : getEvents(ctx.mapId || 'riviera');
  }
  /** Race Setup's track header (owner 2026-10-21, "this is the ui that is chopped"): the name, one quiet place line, a route
   *  outline and three facts. Rivals and traffic are settings on the right, so the header repeats neither. */
  setupSummary(e, r, map) {
    const free = e.type === 'free', compiled = e.routeId && this.h.ctx().route?.compiled, home = compiled ? MAPS.find((m) => m.id === e.routeId.split('-')[0]) : map;
    const name = compiled ? compiled.definition.name : map.name;
    const where = PLACE[e.routeId] || home?.subtitle || '';
    const format = free ? 'FREE ROAM' : `${r.closed ? (e.type === 'timetrial' ? 'TIME TRIAL' : 'CIRCUIT') : TYPES[e.type]?.label || 'SPRINT'}${r.closed ? ` · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'}` : ''}${r.reverse ? ' · REVERSE' : ''}`;
    const region = REGION[compiled?.regionId === 'basin' ? 'athens' : compiled?.regionId || home?.id] || 'ATTICA';
    const outline = compiled ? routeOutline(compiled) : map.preview ? `<img class="setup-head__art" src="${esc(map.preview)}" alt="">` : '';
    const facts = free ? [['REGION', region]] : [['DISTANCE', fmtDist(r.len)], ['FORMAT', format], ['REGION', region]];
    return `<header class="setup-head">${outline ? `<div class="setup-head__map" aria-hidden="true">${outline}</div>` : ''}<h3 class="setup-head__name">${esc(name)}</h3>${where ? `<p class="setup-head__where">${esc(where)}</p>` : ''}</header>${C.stats(facts, 'setup-head__facts')}`;
  }

  // ---------------------------------------------------------------- race setup (event detail)
  setupDef() { if (this.data.mode === 'free') return window.__flow.freeRoamDef(); if (this.data.def) return this.data.def; return { ...(this.eventsHere()[0] || QUICK_RACE), mapId: this.h.ctx().mapId, quick: true, name: 'QUICK RACE' }; }
  /** the loaded route's other full-route events (race / time trial) a Quick Race can switch between on Race Setup */
  setupEvents(def = this.setupDef()) {
    if (!def?.routeId || def.pilot) return [];
    return (this.h.ctx().events || []).filter((e) => e.routeId === def.routeId && ['sprint', 'timetrial'].includes(e.type) && !e.reverse);
  }
  setupKey() { const d = this.setupDef(); if(d.routeId)return d.id;return d.quick ? 'quick:' + (this.h.ctx().mapId || 'riviera') : d.id; }
  isClosed() { return !!this.h.ctx().route?.closed; }
  r_setup() {
    const def = this.setupDef(), closed = this.isClosed(), ctx = this.h.ctx(), saved = loadSetup(this.setupKey());
    const cur = resolveSetup(def, saved, { closed }), runDef = applySetup(def, saved, { closed }), r = resolve(runDef, ctx), custom = isCustom(def, saved, { closed });
    const A = { 'data-scope': 'setup' }, rows = [], events = this.setupEvents(def);
    // EVENT (race or time trial on this road) leads the options when the route offers more than one.
    const eventName = (e) => (e.type === 'timetrial' ? 'TIME TRIAL' : 'RACE') + (events.filter((x) => x.type === e.type).length > 1 && e.laps ? ` · ${e.laps} ${e.laps === 1 ? 'LAP' : 'LAPS'}` : '');
    const eventRow = events.length > 1 ? C.segmented({ key: 'event', label: 'EVENT', icon: def.type === 'timetrial' ? 'timer' : 'flag', value: def.baseId || def.id, attrs: A,
      options: events.map((e) => [e.id, eventName(e), e.type === 'timetrial' ? 'timer' : 'flag']), note: def.type === 'timetrial' ? 'You, the road and the clock. No rivals.' : 'Race the AI rivals to the line.' }) : '';
    for (const f of setupFields(def, { closed })) {
      if (f.key === 'rivals') rows.push(C.stepper({ key: 'rivals', label: 'AI RIVALS', icon: 'users', value: cur.rivals, min: f.min, max: f.max, format: 'rivals', attrs: A,
        note: f.dflt === cur.rivals ? '' : `Default: ${f.dflt}`, noteCls: '' }));
      if (f.key === 'police') rows.push(C.segmented({ key: 'police', label: 'POLICE & LAWS', icon: 'siren', value: cur.police ? cur.policeLevel : 'off', attrs: A, options: [['off', 'OFF'], ...POLICE_LEVELS],
        note: !cur.police ? '' : cur.policeLevel === 'relaxed' ? 'Slow to notice, few units.' : cur.policeLevel === 'tough' ? 'Sharp-eyed, more units.' : 'A warning at +25 km/h in view, a chase if you keep going.' }));
      if (f.key === 'busted' && cur.police) rows.push(C.segmented({ key: 'busted', label: 'CAN BE BUSTED', icon: 'siren', value: String(cur.busted), type: 'bool', dflt: String(f.dflt), attrs: A, options: [['true', 'ON'], ['false', 'OFF']],
        note: cur.busted ? 'Stop next to a unit in a chase and you are pulled over.' : 'They chase you but never arrest you.' }));
      if (f.key === 'traffic') rows.push(C.segmented({ key: 'traffic', label: 'TRAFFIC', icon: 'traffic-cone', value: cur.traffic, type: 'num', dflt: f.dflt, attrs: A, options: f.levels.map(([, v, l]) => [v, l]) }));
      if (f.key === 'laps') rows.push(C.stepper({ key: 'laps', label: 'LAPS', icon: 'refresh-cw', value: cur.laps, min: f.min, max: f.max, format: 'laps', attrs: A, note: `${fmtDist(r.len).toLowerCase()} in total` }));
      if (f.key === 'reverse') rows.push(C.segmented({ key: 'reverse', label: 'DIRECTION', icon: 'arrow-left-right', value: String(cur.reverse), type: 'bool', dflt: 'false', attrs: A, options: [['false', closed ? 'CLOCKWISE' : 'FORWARD'], ['true', closed ? 'ANTI-CLOCKWISE' : 'REVERSE']] }));
      // A list stepper like AI RIVALS (owner 2026-10-21): left / right cycle it, no dropdown to open.
      if (f.key === 'time') rows.push(C.stepper({ key: 'time', label: 'TIME OF DAY', icon: cur.time === 'night' ? 'moon' : cur.time === 'sunset' || cur.time === 'dawn' ? 'sunrise' : 'sun', value: cur.time, attrs: A, options: TIMES.map(([v, l]) => [v, l]),
        note: f.dflt === cur.time ? '' : `Default: ${(TIMES.find(([v]) => v === f.dflt)?.[1] || f.dflt).toLowerCase()}` }));
      if (f.key === 'weather') rows.push(C.segmented({ key: 'weather', label: 'WEATHER', icon: cur.weather === 'rain' ? 'cloud-rain' : cur.weather === 'overcast' ? 'cloud' : 'sun', value: cur.weather, dflt: f.dflt, attrs: A, options: WEATHERS.map(([v, l]) => [v, l, v === 'rain' ? 'cloud-rain' : v === 'overcast' ? 'cloud' : 'sun']) }));
    }
    // Fewer steps (owner 2026-10-20): the screen opens on CHOOSE CAR, so Enter goes straight on; the options are one press up.
    const note = def.pilot?'Staging pilot: rivals, traffic, police and alternate conditions are unavailable.':'';
    const map = def.routeId ? { name: ctx.route.compiled.definition.name } : MAPS.find((m) => m.id === ctx.mapId) || MAPS[0];
    return C.stageInspector({ variant: 'setup', cls: 'scr--setup', kick: def.quick ? 'QUICK RACE' : `${TYPES[def.type].label} · ${esc(map.name)}`, title: def.objectiveMode || def.type === 'free' ? 'SESSION SETUP' : 'RACE SETUP',
      hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['confirm', 'OK'], ['back', 'BACK']],
      stage: `${this.setupSummary(runDef, r, map)}${def.type === 'free' ? '' : renderSetupRecords(this, this.data, def.routeId ? { mapId: 'athens', routeId: def.routeId, eventId: def.baseId || def.id } : { mapId: ctx.mapId || 'riviera', eventId: (def.baseId || def.id).split('~')[0] })}`, inspectorTitle: '', inspector: `${eventRow}${rows.filter(row => /data-key="(?:rivals|traffic|time|police|busted)"/.test(row)).join('')}${C.button({ label: this.data.advanced ? 'HIDE ADVANCED OPTIONS' : 'ADVANCED OPTIONS', icon: 'sliders-horizontal', act: 'setupAdvanced', variant: 'ghost', size: 'sm', block: true, cls: 'setup__more' })}${this.data.advanced ? rows.filter(row => !/data-key="(?:rivals|traffic|time|police|busted)"/.test(row)).join('') : ''}`, note, actions: C.button({ label: 'CHOOSE CAR', icon: 'car', iconRight: 'chevron-right', variant: 'primary', act: 'setupGo', attrs: { 'data-default': '' } }), inspectorHead: C.button({ label: 'DEFAULTS', icon: 'rotate-ccw', variant: 'ghost', size: 'sm', act: 'setupReset', disabled: !custom }) });
  }
  startSetup() {
    const def = this.setupDef(), runDef = applySetup(def, loadSetup(this.setupKey()), { closed: this.isClosed() });
    this.h.openEvent(runDef);
  }

  // ---------------------------------------------------------------- settings
  r_settings(d) {
    const tab = d.tab || 'audio';
    const tabsList = [['driver', 'DRIVER', 'user'], ['audio', 'SOUND', 'volume-2'], ['video', 'GRAPHICS', 'monitor'], ['driving', 'DRIVING', 'circle-gauge'], ...(has('chaseFov') || has('mouseSensitivity') ? [['camera', 'CAMERA', 'camera']] : []), ['controls', 'CONTROLS', 'gamepad-2'], ['about', 'ABOUT', 'info']];
    const v = (k) => String(this.valueFor(k));
    let body = '';
    if (tab === 'driver') {
      body = `<div class="group"><h3 class="group__title">DRIVER NAME</h3>${C.textField({ name: 'driver-name', label: 'YOUR PLATE & ONLINE NAME', value: driverName.get(), inputCls: 'plate-input', inputAttrs: { id: 'driver-name', 'data-driver-name': '', maxlength: 16, autocapitalize: 'characters' }, note: '3–16 letters, numbers or hyphens. Other drivers can see it.' })}<div class="field-actions">${C.button({ label: 'SAVE DRIVER NAME', icon: 'check', act: 'saveDriverName', variant: 'primary', size: 'sm' })}</div></div>`;
    } else if (tab === 'audio') {
      const keys = (S.AUDIO_VOLUMES || ['master', 'sfx']).filter(has);
      body = `<div class="group"><h3 class="group__title">VOLUME</h3>${keys.map((k) => C.slider({ key: k, label: VOLUMES[k] || k.toUpperCase(), value: settings[k], attrs: SET })).join('')}${C.toggle({ key: 'swearing', label: 'SWEARING', value: !settings.mildLanguage, attrs: SET })}</div>`;
    } else if (tab === 'video') {
      // Graphics: ONE fixed look (src/graphics.js RENDER, owner-locked: docs/OWNER-DECISIONS.md). Only performance
      // controls that never change the look live here: resolution, frame rate limit, draw distance. All live.
      const gfx=resolveGraphics(settings),pct=r=>Math.round(r*100)+'%';
      const screen=Math.min(globalThis.devicePixelRatio||1,2),autoRes=Math.min(screen,gfx.P.pixelRatio)/screen;
      body = `<div class="group graphics-resolution"><h3 class="group__title">RESOLUTION</h3>${C.select({key:'renderScale',label:'RESOLUTION',value:v('renderScale'),options:[['auto','AUTO · '+pct(autoRes)],...Array.from({length:11},(_,i)=>[String((50+i*5)/100),(50+i*5)+'%'])],note:'Lower is softer but faster. Now '+pct(gfx.resolution)+' of your screen.',attrs:SET})}${C.toggle({key:'dynamicResolution',label:'Dynamic resolution',value:v('dynamicResolution'),note:'Drops resolution briefly under load. The HUD stays sharp.',attrs:SET})}${C.segmented({key:'frameCap',label:'FRAME RATE LIMIT',value:v('frameCap'),options:[['30','30 FPS'],['60','60 FPS'],['120','120 FPS'],['0','NO LIMIT']],note:'Lower keeps laptops cooler and quieter.',attrs:SET})}</div>
        <div class="group"><h3 class="group__title">RENDER</h3>${C.segmented({ key: 'drawDistance', label: 'DRAW DISTANCE', value: v('drawDistance'), options: [['auto', 'AUTO · '+(gfx.P.drawDistance>=1000?gfx.P.drawDistance/1000+' KM':gfx.P.drawDistance+' M')], ['300', '300 M'], ['500', '500 M'], ['1000', '1 KM'], ['2000', '2 KM'], ['4000', '4 KM']], note: 'How far trees, cars and people are drawn in detail. Lower is faster.', attrs: SET })}
          ${C.toggle({ key: 'worldDetail', label: 'WORLD DETAIL', value: settings.worldDetail !== false, note: 'Facades, rooftops, street details and trees.', attrs: SET })}
          ${C.segmented({ key: 'mirrors', label: 'MIRROR', value: v('mirrors'), options: [['off', 'OFF'], ['low', 'LOW'], ['high', 'HIGH']], note: 'In-car mirrors only. Low is softer and faster; low classes use Low.', attrs: SET })}
          ${C.toggle({ key: 'perfOverlay', label: 'PERFORMANCE OVERLAY', value: settings.perfOverlay === true, note: 'Frame rate and draw calls. F3 toggles it too.', attrs: SET })}</div>
        <div class="group"><h3 class="group__title">UNITS</h3>${C.segmented({ key: 'units', label: 'SPEED UNITS', value: v('units'), options: [['kmh', 'KM/H'], ['mph', 'MPH']], attrs: SET })}</div>`;
    } else if (tab === 'driving') {
      body = `<div class="group"><h3 class="group__title">ASSISTS</h3>${C.toggle({ key: 'aids', label: 'TRACTION / STABILITY · TC ESC', value: settings.aids, attrs: SET })}${C.toggle({ key: 'abs', label: 'BRAKING ASSIST · ABS', value: settings.abs, attrs: SET })}
          ${C.segmented({ key: 'steeringAssist', label: 'STEERING ASSIST', value: v('steeringAssist'), options: [['off', 'OFF'], ['light', 'LIGHT'], ['full', 'FULL']], attrs: SET, note: settings.steeringAssist === null ? 'Follows your device until you choose.' : '' })}
          ${C.segmented({ key: 'transmission', label: 'GEARBOX', value: v('transmission'), options: [['auto', 'AUTO'], ['manual', 'MANUAL']], attrs: SET, note: C.keyHints([['transmission', 'TOGGLE MODE'], ['shiftDown', 'SHIFT DOWN'], ['shiftUp', 'SHIFT UP']]) })}</div>`;
    } else if (tab === 'camera') {
      const sl = (k, label, min, max, step, format) => has(k) ? C.slider({ key: k, label, value: settings[k], min, max, step, format, attrs: SET }) : '';
      const tg = (k, label) => has(k) ? C.toggle({ key: k, label, value: settings[k], attrs: SET }) : '';
      body = `<div class="group"><h3 class="group__title">SEAT · ${esc(this.h.carSpec?.()?.name||'CURRENT CAR')}</h3>${[['height','SEAT HEIGHT'],['position','SEAT POSITION']].map(([key,label])=>C.slider({key:'seat-'+key,label,value:seatPosition(this.h.carSpec?.()?.id)[key],min:-.08,max:.08,step:.01,format:'seatCm',note:'Saved for this car.',attrs:SET})).join('')}${C.button({label:'RESET SEAT',act:'seatReset',variant:'ghost',icon:'rotate-ccw'})}</div><div class="group"><h3 class="group__title">VIEW</h3>${sl('chaseFov', 'CHASE FIELD OF VIEW', 45, 75, 1, 'deg')}${sl('cockpitFov', 'COCKPIT FIELD OF VIEW', 45, 90, 1, 'deg')}${tg('speedFov', 'SPEED FOV EFFECT')}${has('hudMotion') ? C.segmented({ key: 'hudMotion', label: 'HUD MOTION', value: v('hudMotion'), options: [['off', 'OFF'], ['subtle', 'SUBTLE'], ['full', 'FULL']], attrs: SET }) : ''}</div>
        <div class="group"><h3 class="group__title">LOOK AROUND</h3>${has('mouseLook') ? C.toggle({ key: 'mouseLook', label: 'MOUSE FREE LOOK', value: settings.mouseLook === true, note: settings.mouseLook === true ? 'Move the mouse to look around.' : 'Hold the left or right button and drag to look.', attrs: SET }) : ''}${sl('mouseSensitivity', 'LOOK SENSITIVITY', 0.25, 3, 0.05, 'x')}${tg('invertLookY', 'INVERT LOOK Y')}
          <p class="group__note">${C.keyHints([['camera', 'POV / OUTSIDE'], ['cameraPosition', 'VIEW POSITION'], ['lookBack', 'LOOK BACK (HOLD)']])} The right stick also looks and returns to the road when released.</p></div>
        <div class="group"><h3 class="group__title">TAGS</h3>${tg('playerMarkers', 'ONLINE PLAYER TAGS')}${tg('rivalMarkers', 'AI RIVAL TAGS')}</div>`;
    } else if (tab === 'controls') body = renderControls(this);
    else if (tab === 'about') body = Release.renderAbout(this);
    return C.sidebarContent({ variant: 'rail', cls: 'scr--settings', kick: d.from === 'pause' ? 'PAUSED' : 'OPTIONS', title: 'SETTINGS',
      nav: C.nav({ key: 'settingsTab', value: tab, options: tabsList, label: 'Settings sections' }),
      hints: [['updown', 'SELECT'], ['leftright', 'CHANGE'], ['tabs', 'TAB'], ...(tab === 'controls' ? [['confirm', 'REBIND']] : []), ['back', 'BACK']],
      content: body });
  }
  /** leaving the settings screen: drop any half-done key capture */
  leaving() { this.mapView?.dispose(); this.mapView = null; if (this.screen === 'settings') this.h.cancelBindings?.(); C.closeListbox(); this.carView?.dispose(); this.carView = null; }

  // ---------------------------------------------------------------- pause
  r_pause(d) {
    const r = d.r, def = d.def;
    const kick = def ? `${esc(def.name)} · ${r?.closed ? `${esc(d.mapName || '')} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'}` : r ? routeLine(r) : ''}` : esc(d.kick || '');
    // THE REFERENCE STYLE (owner, 2026-10-16, docs/OWNER-DECISIONS.md): every other screen is derived from this sheet.
    const rows = [C.option({ icon: 'play', title: 'RESUME', act: 'resume', attrs: { 'data-default': '' } }),
      ...(d.inFreeRoam && d.roamActions !== false ? [C.option({ icon: 'car', title: 'CHANGE CAR', act: 'roamCar' }), C.option({ icon: 'cloud-rain', title: 'TIME & WEATHER', act: 'roamConditions' }), C.option({ icon: 'map-pin', title: 'TELEPORT TO LANDMARK', act: 'roamLandmarks' }), C.option({ icon: 'truck', title: 'TOW TO ROAD', act: 'roamTow' })] : []),
      d.online || d.inFreeRoam ? '' : C.option({ icon: 'rotate-ccw', title: 'RESTART', act: 'restart' }),
      window.__flow?.resetCar ? C.option({ icon: 'truck', title: 'RESET TO ROAD', act: 'reset' }) : '',
      d.online ? C.option({ icon: 'users', title: 'LOBBY & HOST CONTROLS', act: 'onlineLobby' }) : '',
      d.online && window.__multiplayer?.lobby?.status === 'race' && !window.__multiplayer?.retired && window.__multiplayer?.me?.finish == null ? C.option({ icon: 'flag', title: 'RETIRE · DNF', act: 'retire' }) : '',
      C.option({ icon: 'settings', title: 'SETTINGS', act: 'settings' }), C.option({ icon: 'log-out', title: d.online ? 'BACK TO MENU' : 'QUIT TO MENU', act: 'quit' })];
    const controls = `${C.button({ label: drivingHints.enabled ? 'HIDE DRIVING CONTROLS' : 'SHOW DRIVING CONTROLS', icon: 'gamepad-2', act: 'drivingHints', variant: 'ghost', size: 'sm' })}${drivingHints.enabled ? controlsStrip({ device: this.h.inputDevice?.() || 'keyboard', car: this.h.carSpec?.() || window.__game?.player?.spec, manual: this.h.manual?.() ?? true }) : ''}`;
    return C.sheetList({ variant: 'pause', kick, title: 'PAUSED', status: d.sub ? esc(d.sub) : '', rows: rows.join(''), actions: controls,
      hints: [['updown', 'SELECT'], ['confirm', 'OK'], ['back', 'RESUME']] });
  }

  // Mode owner handlers; UI owner can restyle these with the rest of the pause menu.
  r_roamConditions() {
    const c = window.__conditions(), attrs = { 'data-scope': 'roam' };
    return C.sheetList({ variant: 'flow', title: 'TIME & WEATHER', rows: C.select({ key: 'time', label: 'TIME OF DAY', value: c.time, attrs, options: TIMES }) + C.segmented({ key: 'weather', label: 'WEATHER', value: c.weather, attrs, options: WEATHERS }), hints: [['back', 'BACK']] });
  }
  r_roamLandmarks(d) {
    return C.sheetList({ variant: 'flow', title: 'TELEPORT TO LANDMARK', rows: d.landmarks.map(m => C.option({ icon: 'map-pin', title: esc(m.name), attrs: { 'data-landmark': m.id } })).join(''), hints: [['back', 'BACK']] });
  }

  // ---------------------------------------------------------------- results
  /** d = { result, def, r, mapName, title, sub, win, rows: [[k, v, hi]], splits: [{name, time, delta}], field: [{pos, name, car, time, me}] } */
  r_results(d) {
    const r = d.r, def = d.def;
    const kick = def && r ? (r.closed ? `${esc(d.mapName || def.name)} · ${r.laps} ${r.laps === 1 ? 'LAP' : 'LAPS'} · ${fmtDist(r.len)}` : `${esc(def.name)} · ${routeLine(r)} · ${fmtDist(r.len)}`) : esc(d.kick || '');
    const splits = d.splits?.length ? C.panel('SPLITS', `<table class="r-table">${d.splits.map((s) => `<tr><td>${esc(s.name)}</td><td class="tnum">${s.time}</td><td class="tnum ${s.cls || ''}">${s.delta || ''}</td></tr>`).join('')}</table>`, { icon: 'timer' }) : '';
    const field = d.field?.length ? C.panel('CLASSIFICATION', `<table class="r-table">${d.field.map((f) => `<tr class="${f.me ? 'me' : ''}"><td class="r-pos">P${f.pos}</td><td>${esc(f.name)}<small>${esc(f.car || '')}</small></td><td class="tnum ${f.running ? 'run' : ''}">${f.time}</td></tr>`).join('')}</table>`, { icon: 'flag' }) : '';
    const tiles = (d.rows || []).filter(([k]) => !/EVENT BEST|MEDAL|RECORD/i.test(k)).map(([k, v, hi]) => C.stat(esc(k), v, { tone: hi ? 'hi' : '' }));
    const act = (a, ic, label, v = 'secondary') => C.button({ label, icon: ic, act: a, variant: v, attrs: a === 'raceAgain' ? { 'data-default': '' } : null });
    return C.sheetList({ variant: 'split', cls: `scr--results ${d.win ? 'is-win' : 'is-lose'}`, back: false, kick, title: esc(d.title || ''), hints: [['select', 'SELECT'], ['confirm', 'OK'], ['back', 'MAIN MENU']],
      rows: `
        ${d.sub ? `<p class="res-sub">${d.sub}</p>` : ''}
        ${personalBestLabel(d.result?.personalBest) ? C.badge(esc(personalBestLabel(d.result.personalBest)), 'good', 'timer') : ''}
        <div class="stats res-stats">${tiles.join('')}</div>
      `, actions: `${act('raceAgain', 'rotate-ccw', 'RACE AGAIN', 'primary')}${act('changeCar', 'car', 'CHANGE CAR')}${d.result?.time != null ? act('shareResult', 'share', 'SHARE') : ''}${act('list', 'menu', 'MAIN MENU')}`,
      aside: `${d.result?.personalBest?.exact ? renderBestRecord(d.result.personalBest.exact, { title: `${d.result.personalBest.newBest ? 'NEW ' : ''}PERSONAL BEST · ${this.h.fmtTime(d.result.personalBest.exact.time)}` }) : ''}${field}${splits}` });
  }
}
