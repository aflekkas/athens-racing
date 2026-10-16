// LOADING SCREEN: full-screen, shown when a committed session needs a map. The map's name and facts, its route outline
// (the map-select art, assets/maps/<id>.svg, inlined so the route draws itself as loading advances), a progress bar
// driven by the real load phases (main.js lstat(text, fraction): boot, buildMapWorld progress, textures, shader
// compile) and a rotating tip. The markup lives in index.html (#loading) so it paints before any module loads.
//   import { loading } from './ui/loading.js';
//   loading.show(mapId)      reset to 0 and fade in      loading.progress('BUILDING TERRAIN', .25)      loading.hide()
import { input } from '../input.js';
import { bindingLabel, gearboxMessage } from '../input-labels.js';
import { MAPS } from '../map-catalog.js';
import { button, setProgress, esc } from './components.js';

const TIPS = [
  'Running a red light adds a time penalty. The SEAT’s nitrous bottle refills while waiting at a red.',
  () => 'Stuck off the road? ' + bindingLabel(input.bindings, 'tow', document.body.dataset.input === 'gamepad' ? 'gamepad' : 'keyboard') + ' to be towed back onto it.',
  () => bindingLabel(input.bindings, 'camera') + ' switches between the cockpit and chase cameras.',
  'Change AI rivals, traffic, time of day and weather in the race setup before every Quick Race.',
  'Pavements and dirt lay-bys are drivable. Kerbs and humps will unsettle the car.',
  () => 'Manual gearbox: ' + gearboxMessage('manual', true, input.bindings, document.body.dataset.input === 'gamepad' ? 'gamepad' : 'keyboard'),
  'Multiplayer: share a six-character lobby code and race up to seven friends.',
  'Steering assist adapts to your device. Set it to OFF for full control.',
  'Choose JOIN GAME on the main menu to enter a code or browse open lobbies.',
];
const $ = (id) => document.getElementById(id);
const fmtKm = (m) => (m / 1000).toFixed(1) + ' KM';
const svgCache = new Map();

class LoadingScreen {
  constructor() { this.tipIdx = Math.floor(Math.random() * TIPS.length); this.p = 0; this.mapId = null; }
  get el() { return $('loading'); }
  show(mapId = 'riviera', context = 'QUICK RACE') {
    const el = this.el; if (!el) return;
    clearTimeout(this.hideTimer);
    this.setMap(mapId);
    const purpose = $('ldContext'); if (purpose) purpose.textContent = 'LOADING TRACK FOR ' + context;
    this.p = 0; this.progress('LOADING MAP DATA', 0);
    el.inert = false; el.style.pointerEvents = ''; el.removeAttribute('aria-hidden');
    el.classList.add('open'); el.setAttribute('aria-busy', 'true');
    this.started = performance.now();
    const recovery = $('ldRecovery'); if (recovery) recovery.hidden = true;
    const back = $('ldReturn');
    if (back) { back.innerHTML = button({ label: 'RETURN TO MENU', attrs: { tabindex: '0' } }); const control = back.querySelector('[role="button"]'); control.onclick = () => {
      // Replacing the document also stops outstanding workers/fetches safely.
      const url = new URL(location.href); url.searchParams.set('menu', '1'); url.searchParams.delete('lobby');
      location.assign(url.href);
    }; control.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); control.onclick(); } }; }
    clearInterval(this.waitTimer); this.waitTimer = setInterval(() => {
      const seconds = Math.floor((performance.now() - this.started) / 1000);
      if (recovery && seconds >= 8) { recovery.hidden = false; const wait = $('ldWait'); if (wait) wait.textContent = `Still loading · ${seconds}s. You can return to the menu and try again.`; }
    }, 1000);
    this.nextTip(); clearInterval(this.tipTimer); this.tipTimer = setInterval(() => this.nextTip(), 5200);
  }
  setMap(mapId) {
    if (this.mapId === mapId) return;
    const map = MAPS.find((m) => m.id === mapId) || MAPS[0]; this.mapId = map.id;
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('ldName', map.name); set('ldSub', map.subtitle);
    set('ldKind', map.type === 'circuit' ? 'CLOSED CIRCUIT' : map.id === 'penteli' ? 'HILL CLIMB' : 'POINT TO POINT');
    set('ldLen', fmtKm(map.length) + (map.type === 'circuit' ? ' / LAP' : ''));
    this.loadArt(map);
  }
  async loadArt(map) {
    const host = $('ldArt'); if (!host) return;
    const id = map.id;
    try {
      let svg = svgCache.get(id);
      if (!svg) { svg = await (await fetch(map.preview)).text(); svgCache.set(id, svg); }
      if (this.mapId !== id) return;
      host.innerHTML = svg;
      const root = host.querySelector('svg'); if (!root) return;
      root.removeAttribute('width'); root.removeAttribute('height'); root.setAttribute('preserveAspectRatio', 'xMidYMid meet'); root.setAttribute('aria-hidden', 'true');
      root.querySelectorAll('text').forEach((t) => t.remove());
      root.querySelector('rect')?.setAttribute('fill', 'transparent');
      // the route is drawn three times (black casing, white, red): the red one draws in with the progress
      const lines = [...root.querySelectorAll('polyline')].filter((p) => /#f45143/i.test(p.getAttribute('stroke') || ''));
      for (const l of lines) { l.setAttribute('pathLength', '1'); l.classList.add('ld-route'); }
      this.route = lines; this.applyRoute();
    } catch (e) { host.innerHTML = ''; console.warn('[loading] art', e); }
  }
  applyRoute() { for (const l of this.route || []) l.style.strokeDashoffset = String(1 - this.p); }
  progress(text, f) {
    if (text != null) { const s = $('lstat'); if (s) s.textContent = text; }
    if (f !== undefined && Number.isFinite(+f)) {
      // Preloading overlaps HUD/sky work. A later builder can report an earlier
      // milestone, but a single session's completed progress never goes back.
      this.p = Math.max(this.p, Math.max(0, Math.min(1, +f)));
      setProgress($('lbar'), this.p);
      const pc = $('lpct'); if (pc) pc.textContent = Math.round(this.p * 100) + '%';
      this.applyRoute();
    }
  }
  nextTip() {
    const t = $('ldTip'); if (!t) return;
    this.tipIdx = (this.tipIdx + 1) % TIPS.length;
    t.classList.remove('in'); void t.offsetWidth; const tip = TIPS[this.tipIdx]; t.innerHTML = esc(typeof tip === 'function' ? tip() : tip); t.classList.add('in');
  }
  hide() {
    const el = this.el; if (!el) return;
    this.progress(null, 1);
    clearInterval(this.tipTimer);
    clearInterval(this.waitTimer);
    // Loading is complete: menus must be clickable even while the fade finishes.
    el.style.pointerEvents = 'none'; el.inert = true; el.setAttribute('aria-hidden', 'true');
    this.hideTimer = setTimeout(() => { el.classList.remove('open'); el.removeAttribute('aria-busy'); }, 180);
  }
  get open() { return !!this.el?.classList.contains('open'); }
}
export const loading = new LoadingScreen();
if (typeof window !== 'undefined') window.__loading = loading;
