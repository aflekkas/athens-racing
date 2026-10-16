// LOADING SCREEN: full-screen, shown when a committed session needs a map. The map's name and facts, its route outline
// (the map-select art, assets/maps/<id>.svg, inlined), four honest steps and a rotating tip. The markup lives in
// index.html (#loading) so it paints before any module loads.
//   import { loading } from './ui/loading.js';
//   loading.show(mapId, context)    loading.progress(text, fraction, detail?)    loading.fail({ code, retry, fallback })    loading.hide()
// Steps: MAP DATA → DOWNLOAD → BUILD → FINISH. Only the active step moves. It fills only from measured bytes
// (detail.loadedBytes / detail.totalBytes); everything unmeasurable is an indeterminate sweep, never a guessed number.
// Legacy (text, fraction) callers still work: their milestone text picks the step and fraction is ignored for display.
// detail (baked-world-data.js): { phase: download|inflate|decode|generate|failed|ready, loadedBytes, totalBytes,
//   source, error: { code, retryable }, retry(), fallback() }. retry/fallback resume the same pending load.
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
export const STEPS = ['data', 'fetch', 'build', 'prep'];
const PAUSED = ['LOADING PAUSED', 'DOWNLOAD PAUSED', 'BUILD PAUSED', 'LOADING PAUSED'];
const STEP_SPOKEN = ['loading map data', 'downloading the track', 'building the track', 'finishing up'];
// Legacy milestone text → [step, label shown]. A null label keeps the builder's own words (PAVING POSEIDONOS AVENUE).
const MILESTONES = [
  [/^LOADING MAP DATA/, 0, 'LOADING MAP DATA', 'map'],
  [/GENERATING/, 2, 'BUILDING THE TRACK ON THIS DEVICE', 'generate'],
  [/^DOWNLOAD/, 1, 'DOWNLOADING THE TRACK', 'download'],
  [/READY$/, 2, 'BUILDING THE TRACK', 'build'],
  [/^WARMING TYRES/, 3, 'WARMING TYRES', 'prep'],
  [/TEXTURES/, 3, 'LOADING TEXTURES', 'prep'],
  [/SHADERS/, 3, 'PREPARING GRAPHICS', 'prep'],
  [/^(BUILDING|PAVING|FUELLING)/, 2, null, 'build'],
];
const PHASES = {
  download: [1, 'DOWNLOADING THE TRACK'], inflate: [1, 'UNPACKING THE TRACK'], decode: [1, 'UNPACKING THE TRACK'],
  generate: [2, 'BUILDING THE TRACK ON THIS DEVICE'], ready: [2, 'BUILDING THE TRACK'],
};
/** Player-facing failure copy. Never names files, codecs, workers or HTTP. */
export const FAILURES = {
  offline: ['YOU’RE OFFLINE', 'Reconnect to the internet, then try again. The download picks up where it stopped.'],
  network: ['CONNECTION LOST', 'The track download stopped. Try again to continue where it left off.'],
  timeout: ['CONNECTION STALLED', 'No data has arrived for a while. Check your connection and try again.'],
  http: ['TRACK UNAVAILABLE', 'The track couldn’t be fetched right now. Try again in a moment.'],
  storage: ['NOT ENOUGH SPACE', 'Your browser ran out of room for the track. Free up some space, then try again.'],
  invalid: ['DOWNLOAD DAMAGED', 'Part of the track arrived damaged. Try again to fetch a fresh copy.'],
  generate: ['COULDN’T BUILD THE TRACK', 'This device couldn’t finish building the track. Try again or return to the menu.'],
  unknown: ['COULDN’T LOAD THE TRACK', 'Something went wrong while loading. Try again or return to the menu.'],
};
export const STALL_MS = { network: 8000, work: 20000 };
const CANCEL_AFTER_MS = 12000;
const $ = (id) => document.getElementById(id);
const fmtKm = (m) => (m / 1000).toFixed(1) + ' KM';
const mb = (bytes) => (bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1);
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const svgCache = new Map();
export const errorCode = (error) => !online() ? 'offline' : FAILURES[error?.code] ? error.code : 'unknown';

/** Text-only legacy progress → { step, label, kind }; unknown text keeps the current step. */
export function classify(text, step = 0) {
  for (const [re, s, label, kind] of MILESTONES) if (re.test(text)) return { step: s, label: label || text, kind };
  return { step, label: text, kind: null };
}

function wireButton(host, opts, onPress) {
  host.insertAdjacentHTML('beforeend', button({ ...opts, attrs: { tabindex: '0', ...opts.attrs } }));
  const control = host.lastElementChild;
  control.onclick = onPress;
  control.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onPress(); } };
  return control;
}

class LoadingScreen {
  constructor() { this.tipIdx = Math.floor(Math.random() * TIPS.length); this.p = 0; this.mapId = null; this.reset(); }
  get el() { return $('loading'); }
  reset() {
    this.step = 0; this.kind = 'map'; this.label = 'LOADING MAP DATA'; this.bytes = null; this.parts = null; this.source = null;
    this.failure = null; this.downloadTried = false; this.chosenBuild = false; this.note = ''; this.changed = this.started = performance.now();
  }
  show(mapId = 'riviera', context = 'QUICK RACE') {
    const el = this.el; if (!el) return;
    clearTimeout(this.hideTimer);
    this.setMap(mapId);
    const purpose = $('ldContext'); if (purpose) purpose.textContent = 'LOADING TRACK FOR ' + context;
    this.p = 0; this.reset(); this.applyRoute(); this.render(true);
    el.inert = false; el.style.pointerEvents = ''; el.removeAttribute('aria-hidden');
    el.classList.add('open'); this.renderIssue();
    const recovery = $('ldRecovery'); if (recovery) recovery.hidden = true;
    const back = $('ldReturn');
    if (back) { back.innerHTML = ''; wireButton(back, { label: 'RETURN TO MENU', variant: 'ghost', size: 'sm', icon: 'arrow-left' }, () => this.cancel()); }
    this.watchNetwork(true);
    clearInterval(this.waitTimer); clearInterval(this.tipTimer);
    this.waitTimer = setInterval(() => this.tick(), 1000);
    this.nextTip(); this.tipTimer = setInterval(() => this.nextTip(), 5200);
  }
  /** Leaving mid-load: replacing the document also stops outstanding workers/fetches safely. */
  cancel() {
    const url = new URL(location.href); url.searchParams.set('menu', '1'); url.searchParams.delete('lobby');
    location.assign(url.href);
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
      // the route is drawn three times (black casing, white, red): the red one draws in step by step
      const lines = [...root.querySelectorAll('polyline')].filter((p) => /#f45143/i.test(p.getAttribute('stroke') || ''));
      for (const l of lines) { l.setAttribute('pathLength', '1'); l.classList.add('ld-route'); }
      this.route = lines; this.applyRoute();
    } catch (e) { host.innerHTML = ''; console.warn('[loading] art', e); }
  }
  applyRoute() { for (const l of this.route || []) l.style.strokeDashoffset = String(1 - this.p); }
  /** Measured share of the active step, or null when the work cannot be measured. */
  measured() { const b = this.bytes; return this.step === 1 && b && b.total > 0 ? Math.min(1, b.loaded / b.total) : null; }
  progress(text, _fraction, detail) {
    const before = `${this.step}|${this.label}|${this.bytes?.loaded}`;
    if (detail && typeof detail === 'object' && detail.phase) {
      if (detail.mapId && this.mapId && detail.mapId !== this.mapId) return;
      if (detail.phase === 'failed') { this.fail({ ...detail.error, retry: detail.retry, fallback: detail.fallback }); return; }
      if (this.failure) this.clearFailure();
      const [step, label] = PHASES[detail.phase] || [this.step, text || this.label];
      this.setStep(step, detail.phase === 'download' && detail.source === 'generated-cache' ? 'LOADING YOUR SAVED COPY' : label, detail.phase);
      if (detail.phase === 'download') {
        this.downloadTried = true; this.source = detail.source || 'download';
        const loaded = Math.max(0, +detail.loadedBytes || 0), total = Number.isFinite(+detail.totalBytes) && +detail.totalBytes > 0 ? +detail.totalBytes : null;
        this.bytes = { loaded, total };
      } else if (step !== 1) this.bytes = null;
      // On-device generation reports real stages (map, terrain, roads, buffers): count them, never time them.
      this.parts = detail.phase === 'generate' && Number.isInteger(detail.step) && detail.steps > 1 ? { step: Math.min(detail.step, detail.steps - 1), steps: detail.steps } : null;
    } else if (text != null) {
      if (this.failure) return; // a paused load does not chatter; retry/fallback resume with a fresh detail
      const c = classify(text, this.step);
      if (c.step < this.step) { /* overlapping preload milestones never step backwards */ }
      else {
        this.setStep(c.step, c.label, c.kind || this.kind);
        if (c.kind === 'download') {
          this.downloadTried = true;
          const m = /([\d.]+)\s*MB/.exec(text); // pre-detail callers report bytes in the text only, total unknown
          if (m) this.bytes = { loaded: +m[1] * 1048576, total: null };
        }
      }
    }
    if (`${this.step}|${this.label}|${this.bytes?.loaded}` !== before) this.changed = performance.now();
    this.render();
  }
  setStep(step, label, kind) {
    if (step !== this.step && step !== 1) this.bytes = null;
    this.step = Math.max(0, Math.min(STEPS.length - 1, step)); this.label = label; this.kind = kind;
  }
  fail({ code, retry, fallback } = {}) {
    const prior = this.failure;
    this.failure = { code: code || prior?.code || 'unknown', retry: retry || prior?.retry || null, fallback: fallback || prior?.fallback || null };
    this.render(); this.renderIssue();
  }
  clearFailure() { this.failure = null; this.changed = performance.now(); this.renderIssue(); }
  async resume(action) {
    const failure = this.failure; this.chosenBuild ||= !!action && action === failure?.fallback; this.clearFailure(); this.render(true);
    try { await (action || (() => location.reload()))(); }
    catch (error) { if (!this.failure && this.open) this.fail({ ...failure, code: errorCode(error) === 'unknown' ? failure.code : errorCode(error) }); }
  }
  renderIssue() {
    const el = this.el, box = $('ldIssue'), f = this.failure;
    el?.setAttribute('data-state', f ? 'failed' : 'active');
    if (f) el?.removeAttribute('aria-busy'); else if (this.open) el?.setAttribute('aria-busy', 'true');
    const tip = el?.querySelector?.('.ld-tip'); if (tip) tip.hidden = !!f;
    if (!box) return;
    if (!f) { box.hidden = true; return; }
    const code = online() ? f.code : 'offline', [what, body] = FAILURES[code] || FAILURES.unknown;
    $('ldIssueWhat').textContent = what; $('ldIssueBody').textContent = body;
    const actions = $('ldActions'); actions.innerHTML = '';
    const primary = wireButton(actions, { label: 'TRY AGAIN', variant: 'primary', icon: 'arrows-clockwise' }, () => this.resume(f.retry));
    if (f.fallback) wireButton(actions, { label: 'BUILD ON THIS DEVICE', variant: 'secondary', icon: 'cube', sub: 'NO DOWNLOAD · ABOUT A MINUTE' }, () => this.resume(f.fallback));
    wireButton(actions, { label: 'RETURN TO MENU', variant: 'ghost', icon: 'arrow-left' }, () => this.cancel());
    box.hidden = false;
    const recovery = $('ldRecovery'); if (recovery) recovery.hidden = true;
    primary.focus?.({ preventScroll: true }); // keyboard and gamepad players land on the next step
  }
  /** What the player should know when the screen has gone quiet. Empty while things visibly move. */
  noteFor(now = performance.now()) {
    if (this.failure) return '';
    const idle = now - this.changed;
    if (this.kind === 'generate') return this.downloadTried && !this.chosenBuild
      ? 'The download didn’t finish, so this device is building the track instead. This can take a minute or two.'
      : 'This device is building the track. This can take a minute or two.';
    if (this.step === 1 && this.kind === 'download' && (!online() || idle >= STALL_MS.network))
      return online() ? 'Waiting for the network…' : 'You’re offline. The download continues when you reconnect.';
    if (idle >= STALL_MS.work) return 'Still working. Slower devices can take a little longer.';
    return '';
  }
  tick() {
    const now = performance.now(), note = this.noteFor(now), el = $('ldNote');
    if (el) { if (el.textContent !== note) el.textContent = note; el.hidden = !note; }
    if (note && note !== this.note) this.say(note);
    this.note = note;
    const recovery = $('ldRecovery');
    if (recovery) recovery.hidden = !!this.failure || !(note || now - this.started >= CANCEL_AFTER_MS);
  }
  say(text) { const live = $('ldLive'); if (live && live.textContent !== text) live.textContent = text; }
  render(force = false) {
    const stat = $('lstat'); if (stat) stat.textContent = this.failure ? PAUSED[this.step] : this.label;
    const share = this.measured(), b = this.step === 1 ? this.bytes : null;
    const parts = this.kind === 'generate' && this.parts;
    const pct = $('lpct'); if (pct) pct.textContent = parts ? `PART ${parts.step + 1} OF ${parts.steps}` : !b || !b.loaded && !b.total ? '' : b.total ? `${mb(b.loaded)} / ${mb(b.total)} MB` : `${mb(b.loaded)} MB`;
    const bar = $('lbar');
    if (bar) {
      const spoken = `Step ${this.step + 1} of ${STEPS.length}: ${this.failure ? 'paused' : STEP_SPOKEN[this.step]}` + (b?.total ? `, ${mb(b.loaded)} of ${mb(b.total)} megabytes` : '');
      bar.setAttribute('aria-valuetext', spoken);
      if (share == null) { bar.removeAttribute('aria-valuenow'); bar.removeAttribute('aria-valuemin'); bar.removeAttribute('aria-valuemax'); }
      else { bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(share * 100))); }
      STEPS.forEach((id, i) => {
        const li = bar.querySelector?.(`[data-step="${id}"]`); if (!li) return;
        const state = i < this.step ? 'done' : i > this.step ? 'next' : this.failure ? 'failed' : 'active';
        li.setAttribute('data-state', state);
        const seg = li.querySelector('.progress');
        if (seg) {
          seg.classList.toggle('progress--indeterminate', state === 'active' && share == null);
          seg.classList.toggle('progress--bad', state === 'failed');
          setProgress(seg, state === 'done' ? 1 : state === 'next' ? 0 : share ?? (state === 'failed' ? 1 : 0));
        }
      });
      const fetchName = $('ldFetchName'); if (fetchName) fetchName.textContent = this.source === 'generated-cache' ? 'SAVED COPY' : 'DOWNLOAD';
    }
    // The route art follows finished steps (plus measured bytes), never a clock.
    this.p = Math.max(this.p, (this.step + (share ?? 0)) / STEPS.length); this.applyRoute();
    const spokenStep = this.failure ? '' : STEP_SPOKEN[this.step];
    if (force || spokenStep && spokenStep !== this.spokenStep) { this.spokenStep = spokenStep; if (spokenStep) this.say(spokenStep[0].toUpperCase() + spokenStep.slice(1)); }
    this.tick();
  }
  watchNetwork(on) {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    this.onNetwork ||= () => { if (this.failure) this.renderIssue(); else this.tick(); };
    for (const type of ['online', 'offline']) on ? window.addEventListener(type, this.onNetwork) : window.removeEventListener(type, this.onNetwork);
  }
  nextTip() {
    const t = $('ldTip'); if (!t) return;
    this.tipIdx = (this.tipIdx + 1) % TIPS.length;
    t.classList.remove('in'); void t.offsetWidth; const tip = TIPS[this.tipIdx]; t.innerHTML = esc(typeof tip === 'function' ? tip() : tip); t.classList.add('in');
  }
  hide() {
    const el = this.el; if (!el) return;
    this.failure = null; this.p = 1; this.applyRoute();
    clearInterval(this.tipTimer);
    clearInterval(this.waitTimer);
    this.watchNetwork(false);
    // Loading is complete: menus must be clickable even while the fade finishes.
    el.style.pointerEvents = 'none'; el.inert = true; el.setAttribute('aria-hidden', 'true');
    this.hideTimer = setTimeout(() => { el.classList.remove('open'); el.removeAttribute('aria-busy'); }, 180);
  }
  get open() { return !!this.el?.classList.contains('open'); }
}
export const loading = new LoadingScreen();
if (typeof window !== 'undefined') window.__loading = loading;
