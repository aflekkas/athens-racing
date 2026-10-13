// EVENTS: data-driven race events (sprints against a grid, time trials, score attacks, speed-camera runs), their
// route segments / direction, medal targets and saved results; plus the event hook API other systems listen to.
// Pure logic, no DOM or three.js: node can import and test it (tools/events-test.mjs).
//
// ---------------------------------------------------------------------------------------------- HOOK API
//   import { events } from './events.js';        (also window.__events in the browser)
//   const off = events.on('finish', (result) => { ... });   off() unsubscribes; events.once(name, fn) fires once
//
//   'start'   { eventId, type, car, def, run }      at GO (after the countdown). run = the live EventRun
//   'split'   { eventId, index, id, name, time, best, delta }    passing a checkpoint (district markers) / the finish
//   'trap'    { eventId, index, kmh, total }        through a speed camera
//   'score'   { eventId, kind, pts, total }         points scored during a score attack (and style in any mode)
//   'finish'  result                                event complete (finished, or the score-attack clock ran out)
//   'abort'   { eventId, type, reason }             restart / quit to menu before the finish
//
//   result = { eventId, type, car, time, splits, position, score, medal,
//              field, trapSpeeds, trapTotal, breakdown, penalties, distance, reverse, record, newBest, prevMedal,
//              valid (a clean, normal finish: not autodrive / online / aborted), routeKey ('<s0>><s1>' in metres) }
//     time       seconds incl. penalties (null when the score-attack clock ran out before the finish)
//     splits     [seconds at each checkpoint, last one = finish]
//     position   1..field (sprints; 1 for solo events), field = number of cars
//     score      style / attack points (score attack: the result; other modes: the style tally)
//     medal      'gold' | 'silver' | 'bronze' | null
//     record     what is now saved in localStorage['paraliaki.events.<id>']
//
// ---------------------------------------------------------------------------------------------- DEFINITIONS
//   { id, name, blurb, type: 'sprint' | 'timetrial' | 'score' | 'speedtrap',
//     from, to,              route locations: 'start' | 'finish' | a data/map.json marks id | a route s in metres;
//                            from > to (in s) means the REVERSE direction (Lomvarda -> Vouliagmeni)
//     rivals: n | [ids],     sprint grid (DRIVERS ids), 0 for solo events
//     traffic: 0..1.6,       traffic density multiplier (0 = closed road)
//     rules: { timeLimit, penalty, signals },   score attack clock (s); red light penalty (s); signals off = all green
//     traps: n | [s...],     speed cameras (auto-placed at the end of the longest straights when a count)
//     targets: { gold, silver, bronze },  sprint: finishing position; timetrial: average km/h (-> a time);
//                            score: points; speedtrap: summed km/h through all cameras
//     conditions: { time: 'dawn'|'day'|'afternoon'|'sunset'|'night', weather: 'clear'|'overcast'|'rain' } | null,
//                            handed to setConditions() (src/weather.js) on top of the session's own conditions
//     car: id | null }       forced car (otherwise your garage pick)

// ------------------------------------------------------------------ emitter
const listeners = new Map();
export const events = {
  on(name, fn) { let s = listeners.get(name); if (!s) listeners.set(name, (s = new Set())); s.add(fn); return () => s.delete(fn); },
  once(name, fn) { const off = this.on(name, (p) => { off(); fn(p); }); return off; },
  off(name, fn) { listeners.get(name)?.delete(fn); },
  has(name) { return (listeners.get(name)?.size || 0) > 0; },
  emit(name, payload) {
    for (const fn of [...(listeners.get(name) || [])]) { try { fn(payload); } catch (e) { console.error('[events] listener for', name, 'failed', e); } }
  },
};

// ------------------------------------------------------------------ drivers (the AI grid)
// pace: share of the car's top speed they aim for on the straights; nitro: how keen on the bottle;
// risk: chance multiplier for running an amber / red; mistakes: how often they fluff a corner; car: preferred body
export const DRIVERS = [
  { id: 'stavros', name: 'STAVROS', pace: 0.90, nitro: 1.0, risk: 1.0, mistakes: 1.0, car: ['z4', 'mini'], helmet: '#16181c', blurb: 'The regular. Knows every bend.' },
  { id: 'eleni', name: 'ELENI', pace: 0.92, nitro: 0.8, risk: 0.5, mistakes: 0.5, car: ['carrera', 'z4'], helmet: '#c2262e', blurb: 'Clean lines, late braking.' },
  { id: 'nikos', name: 'NIKOS', pace: 0.88, nitro: 1.4, risk: 1.8, mistakes: 1.6, car: ['gr_yaris', 'mini'], helmet: '#1f5fbf', blurb: 'All gas. Sometimes too much.' },
  { id: 'dimitra', name: 'DIMITRA', pace: 0.91, nitro: 1.0, risk: 0.8, mistakes: 0.8, car: ['gtv', 'z4'], helmet: '#2a8f5a', blurb: 'Classic car, modern pace.' },
  { id: 'yiannis', name: 'YIANNIS', pace: 0.86, nitro: 0.6, risk: 1.3, mistakes: 1.2, car: ['taxi'], helmet: '#e8b716', blurb: 'Off shift. Still has a fare to make.' },
  { id: 'kostas', name: 'KOSTAS', pace: 0.89, nitro: 1.2, risk: 1.1, mistakes: 1.0, car: ['mini', 'gr_yaris'], helmet: '#7d3fb0', blurb: 'Weekend hero from Glyfada.' },
  { id: 'maria', name: 'MARIA', pace: 0.93, nitro: 0.9, risk: 0.6, mistakes: 0.6, car: ['carrera', 'z4'], helmet: '#e05a1a', blurb: 'Track-day regular. Fast.' },
  { id: 'giorgos', name: 'GIORGOS', pace: 0.87, nitro: 1.0, risk: 1.5, mistakes: 1.3, car: ['gtv', 'taxi'], helmet: '#3d4651', blurb: 'Old school, no aids.' },
];
export const driver = (id) => DRIVERS.find((d) => d.id === id) || DRIVERS[0];
/** the grid for an event: driver records in grid order (n from a count, or explicit ids) */
export function gridFor(def) {
  if (Array.isArray(def.rivals)) return def.rivals.map(driver);
  const n = Math.max(0, Math.min(DRIVERS.length, def.rivals | 0));
  // a stable but per-event shuffle so the same event always has the same faces
  const h = hash(def.id); const pool = DRIVERS.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = ((h >>> (i % 16)) + i * 7) % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = pool.slice(0, n);
  if (n && !out.some((d) => d.id === 'stavros')) out[0] = DRIVERS[0]; // STAVROS is always there
  return out;
}
/** the body a driver brings (first preferred one that exists) */
export function driverCar(d, carIds, avoid) {
  const ok = d.car.filter((c) => carIds.includes(c));
  return ok.find((c) => c !== avoid) || ok[0] || carIds[(hash(d.id) % carIds.length)];
}

// ------------------------------------------------------------------ the events
export const TYPES = {
  sprint: { label: 'SPRINT', short: 'SPRINT', desc: 'Beat the grid to the line. Traffic, lights, the lot.' },
  timetrial: { label: 'TIME TRIAL', short: 'TT', desc: 'You, the road and the clock. Split times at every district.' },
  score: { label: 'SCORE ATTACK', short: 'SCORE', desc: 'Near misses and drifts against the clock. Chain them for combos.' },
  speedtrap: { label: 'SPEED CAMERAS', short: 'CAMERAS', desc: 'Flash every camera as fast as you dare. Your speeds are added up.' },
};
export const MEDALS = ['bronze', 'silver', 'gold'];

export const EVENTS = [
  { id: 'riviera-sprint', name: 'RIVIERA SPRINT', blurb: 'The full run, Vouliagmeni to Lomvarda, against five locals who know the road.', type: 'sprint', from: 'start', to: 'finish', rivals: 5, traffic: 1, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'astir-varkiza', name: 'BEACH ROAD DASH', blurb: 'Past the lake and the coves of Limanakia, flat out into Varkiza.', type: 'sprint', from: 'astir', to: 'varkiza', rivals: 3, traffic: 0.8, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'cliff-sprint', name: 'CLIFF ROAD SPRINT', blurb: 'Limanakia to Lomvarda: the bends above the Saronic, four rivals, no room for error.', type: 'sprint', from: 'limanakia', to: 'finish', rivals: 4, traffic: 0.9, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'return-leg', name: 'THE RETURN LEG', blurb: 'Reverse direction. Lomvarda back to Vouliagmeni as the sun drops.', type: 'sprint', from: 'finish', to: 'start', rivals: 4, traffic: 1, conditions: { time: 'sunset' }, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'harbour-run', name: 'HARBOUR RUN', blurb: 'Reverse: from Varkiza harbour back to the lake. Six cars, one lane each way.', type: 'sprint', from: 'varkiza', to: 'lake', rivals: 6, traffic: 0.7, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'tt-riviera', name: 'RIVIERA TIME TRIAL', blurb: 'The whole road closed off. Every district is a split.', type: 'timetrial', from: 'start', to: 'finish', rivals: 0, traffic: 0, targets: { gold: 150, silver: 132, bronze: 115 } },
  { id: 'tt-coast', name: 'COAST ROAD TT', blurb: 'Varkiza to Lomvarda with the morning traffic still about.', type: 'timetrial', from: 'varkiza', to: 'finish', rivals: 0, traffic: 0.4, targets: { gold: 140, silver: 122, bronze: 105 } },
  { id: 'tt-reverse', name: 'REVERSE TT', blurb: 'Lomvarda to Limanakia, the wrong way round. Closed road.', type: 'timetrial', from: 'finish', to: 'limanakia', rivals: 0, traffic: 0, targets: { gold: 148, silver: 130, bronze: 112 } },
  { id: 'score-beach', name: 'BEACH TRAFFIC FRENZY', blurb: 'Two minutes in the summer crawl. Thread the needle for points.', type: 'score', from: 'start', to: 'varkiza', rivals: 0, traffic: 1.5, rules: { timeLimit: 120 }, targets: { gold: 9000, silver: 5500, bronze: 2800 } },
  { id: 'score-varkiza', name: 'VARKIZA RUSH HOUR', blurb: '90 seconds through Varkiza by night and onto the coast. Drift, dodge, combo.', type: 'score', from: 'limanakia', to: 'finish', rivals: 0, traffic: 1.4, conditions: { time: 'night' }, rules: { timeLimit: 90 }, targets: { gold: 7000, silver: 4200, bronze: 2000 } },
  { id: 'cameras-coast', name: 'SPEED CAMERAS: COAST', blurb: 'Four cameras on the cliff road, in the rain. Smile.', type: 'speedtrap', from: 'varkiza', to: 'finish', rivals: 0, traffic: 0.5, traps: 4, conditions: { weather: 'rain' }, targets: { gold: 640, silver: 560, bronze: 470 } },
  { id: 'cameras-riviera', name: 'SPEED CAMERAS: RIVIERA', blurb: 'Five cameras the length of the coast, reverse direction.', type: 'speedtrap', from: 'finish', to: 'start', rivals: 0, traffic: 0.6, traps: 5, targets: { gold: 780, silver: 680, bronze: 570 } },
];
/** Quick Race: the full sprint in whatever car you have, three rivals */
export const QUICK_RACE = { id: 'quick', name: 'QUICK RACE', blurb: 'Vouliagmeni to Lomvarda against three locals.', type: 'sprint', from: 'start', to: 'finish', rivals: 3, traffic: 1, targets: { gold: 1, silver: 2, bronze: 3 }, quick: true };
export const getEvent = (id) => (id === 'quick' ? QUICK_RACE : EVENTS.find((e) => e.id === id) || null);

// ------------------------------------------------------------------ resolving a definition onto the route
/** ctx = { route: {start, finish, length, from, to, curv?}, marks: [{id, name, sub, s}] } */
export function locate(loc, ctx) {
  if (typeof loc === 'number') return { s: loc, name: nearestName(loc, ctx) };
  if (loc === 'start') return { s: ctx.route.start, name: (ctx.route.from || 'START').toUpperCase() };
  if (loc === 'finish') return { s: ctx.route.finish, name: (ctx.route.to || 'FINISH').toUpperCase() };
  const m = ctx.marks.find((q) => q.id === loc);
  if (!m) throw new Error('unknown event location ' + loc);
  return { s: m.s, name: m.name };
}
function nearestName(s, ctx) { let n = (ctx.route.from || '').toUpperCase(); for (const m of ctx.marks) if (s >= m.s - 1) n = m.name; return n; }

export function resolve(def, ctx) {
  const a = locate(def.from, ctx), b = locate(def.to, ctx);
  const dir = b.s >= a.s ? 1 : -1, len = Math.abs(b.s - a.s);
  const prog = (s) => (s - a.s) * dir;
  // checkpoints: the district markers strictly inside the segment, then the finish
  let cps = ctx.marks.filter((m) => prog(m.s) > 150 && prog(m.s) < len - 150).sort((p, q) => prog(p.s) - prog(q.s)).map((m) => ({ id: m.id, name: m.name, s: m.s, d: prog(m.s) }));
  if (!cps.length && len > 2500) { // a long segment with few districts: add kilometre splits
    const n = Math.floor(len / 2000); cps = [];
    for (let i = 1; i <= n; i++) { const d = len * i / (n + 1); cps.push({ id: 'km' + i, name: `${(d / 1000).toFixed(1)} KM`, s: a.s + dir * d, d }); }
  }
  cps.push({ id: 'finish', name: b.name, s: b.s, d: len });
  let traps = [];
  if (def.type === 'speedtrap') traps = Array.isArray(def.traps) ? def.traps.map((s) => ({ s, d: prog(s) })) : placeTraps(def.traps || 4, a.s, dir, len, ctx.route);
  const out = { s0: a.s, s1: b.s, dir, len, fromName: a.name, toName: b.name, checkpoints: cps, traps, reverse: dir < 0, timeLimit: def.rules?.timeLimit || 0 };
  out.targetTimes = def.type === 'timetrial' ? Object.fromEntries(MEDALS.map((m) => [m, len / (def.targets[m] / 3.6)])) : null;
  return out;
}

/** speed cameras at the end of the longest straights: one per equal share of the segment */
export function placeTraps(n, s0, dir, len, route) {
  const curv = route.curv ? (s) => Math.abs(route.curv(s)) : () => 0;
  const out = [], a = 350, b = len - 120, bin = (b - a) / n;
  for (let k = 0; k < n; k++) {
    let best = null, bestScore = -1;
    for (let d = a + bin * k + 40; d <= a + bin * (k + 1) - 20; d += 20) {
      const s = s0 + dir * d; if (curv(s) > 0.004) continue;
      // run-up: distance back (against the travel direction) to the last bend tighter than ~250 m radius
      let run = 0; while (run < 700 && curv(s - dir * run) < 0.004) run += 20;
      const score = run + (d - a - bin * k) * 0.05; // ties: later in the bin
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (best === null) best = a + bin * (k + 0.6);
    out.push({ s: s0 + dir * best, d: best });
  }
  return out;
}

// ------------------------------------------------------------------ medals
const rank = (m) => (m ? MEDALS.indexOf(m) + 1 : 0);
export const betterMedal = (a, b) => (rank(a) >= rank(b) ? a : b);
/** medal earned by a result for this definition (r = resolve(def)) */
export function medalFor(def, res, r) {
  const t = def.targets || {};
  if (def.type === 'sprint') { if (res.time == null) return null; for (const m of ['gold', 'silver', 'bronze']) if (res.position <= t[m]) return m; return null; }
  if (def.type === 'timetrial') { if (res.time == null) return null; for (const m of ['gold', 'silver', 'bronze']) if (res.time <= r.targetTimes[m]) return m; return null; }
  if (def.type === 'score') { for (const m of ['gold', 'silver', 'bronze']) if (res.score >= t[m]) return m; return null; }
  if (def.type === 'speedtrap') { if (res.time == null) return null; for (const m of ['gold', 'silver', 'bronze']) if (res.trapTotal >= t[m]) return m; return null; }
  return null;
}
/** human-readable targets: [['gold', 'P1'], ...] */
export function targetLabels(def, r, fmtTime, unit = 'kmh') {
  const t = def.targets || {}, sp = (v) => (unit === 'mph' ? Math.round(v * 0.621371) + ' MPH' : Math.round(v) + ' KM/H');
  return ['gold', 'silver', 'bronze'].map((m) => [m,
    def.type === 'sprint' ? (t[m] === 1 ? 'WIN' : 'TOP ' + t[m]) : def.type === 'timetrial' ? fmtTime(r.targetTimes[m]) : def.type === 'score' ? t[m].toLocaleString('en-US') + ' PTS' : sp(t[m]) + ' TOTAL']);
}

// ------------------------------------------------------------------ saved results
const KEY = (id) => 'paraliaki.events.' + id;
const store = () => (typeof localStorage !== 'undefined' ? localStorage : memStore);
const memStore = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
export function loadRecord(id, st = store()) { try { return JSON.parse(st.getItem(KEY(id)) || 'null') || {}; } catch { return {}; } }
export function saveRecord(id, rec, st = store()) { try { st.setItem(KEY(id), JSON.stringify(rec)); } catch {} }
/** fold a result into the saved record; returns { record, newBest, prevMedal } */
export function recordResult(def, res, st = store()) {
  const prev = loadRecord(def.id, st), rec = { ...prev };
  rec.runs = (prev.runs || 0) + 1;
  rec.medal = betterMedal(prev.medal || null, res.medal) || null;
  let newBest = false;
  if (def.type === 'score') { if (!(res.score <= (prev.bestScore ?? -1))) { rec.bestScore = res.score; newBest = true; } }
  else if (def.type === 'speedtrap') { if (res.time != null && !(res.trapTotal <= (prev.bestTrap ?? -1))) { rec.bestTrap = res.trapTotal; rec.trapSpeeds = res.trapSpeeds; newBest = true; } }
  if (res.time != null && def.type !== 'score') {
    if (!(res.time >= (prev.bestTime ?? Infinity))) { rec.bestTime = res.time; rec.bestSplits = res.splits.slice(); rec.bestCar = res.car; if (def.type !== 'speedtrap') newBest = true; }
  }
  if (def.type === 'sprint' && res.time != null) rec.bestPos = Math.min(prev.bestPos ?? 99, res.position);
  rec.last = { time: res.time, score: res.score, position: res.position, medal: res.medal, car: res.car, at: Date.now() };
  saveRecord(def.id, rec, st);
  return { record: rec, newBest, prevMedal: prev.medal || null };
}
export function medalCount(st = store()) {
  const c = { gold: 0, silver: 0, bronze: 0 };
  for (const e of EVENTS) { const m = loadRecord(e.id, st).medal; if (m) c[m]++; }
  return c;
}

// ------------------------------------------------------------------ positions
/** racers: [{ id, prog, finish (time or null) }] -> same objects sorted 1st..last */
export function rankRacers(racers) {
  return racers.slice().sort((a, b) => {
    const fa = a.finish != null, fb = b.finish != null;
    if (fa && fb) return a.finish - b.finish;
    if (fa !== fb) return fa ? -1 : 1;
    return b.prog - a.prog;
  });
}

// ------------------------------------------------------------------ wrong way
/** heading = cos(angle between the car's nose and the event's direction of travel); hysteresis so it doesn't flicker */
export function wrongWay(state, dt, heading, speed) {
  const bad = heading < -0.35 && speed > 2.5;
  state.t = bad ? Math.min(3, (state.t || 0) + dt) : Math.max(0, (state.t || 0) - dt * 2.5);
  if (!state.on && state.t > 1.0) state.on = true;
  else if (state.on && state.t <= 0.2) state.on = false;
  return state.on;
}

// ------------------------------------------------------------------ a run of one event
export class EventRun {
  /** def: an event definition; ctx: see resolve(); opts: { car, storage } */
  constructor(def, ctx, opts = {}) {
    this.def = def; this.r = resolve(def, ctx); this.car = opts.car || null; this.st = opts.storage || store();
    this.best = loadRecord(def.id, this.st);
    this.reset();
  }
  reset() {
    this.t = 0; this.started = false; this.done = false; this.result = null;
    this.cpIdx = 0; this.splits = []; this.trapIdx = 0; this.trapSpeeds = [];
    this.score = 0; this.breakdown = {}; this.counts = {}; this.lastProg = 0; this.maxProg = 0; this.ww = {};
  }
  get type() { return this.def.type; }
  get id() { return this.def.id; }
  progress(s) { return (s - this.r.s0) * this.r.dir; }
  /** 0..1 along the event */
  frac(s) { return Math.max(0, Math.min(1, this.progress(s) / this.r.len)); }
  timeLeft() { return this.r.timeLimit ? Math.max(0, this.r.timeLimit - this.t) : Infinity; }
  start(payload = {}) {
    this.started = true;
    events.emit('start', { eventId: this.id, type: this.type, car: this.car, def: this.def, run: this, ...payload });
  }
  /** points scored (kind: 'near' | 'oncoming' | 'drift' | 'overtake' | 'cone' | 'amber' | 'polite' | 'penalty' ...) */
  addScore(kind, pts) {
    if (this.done || !this.started) return;
    this.score = Math.max(0, this.score + pts); this.breakdown[kind] = (this.breakdown[kind] || 0) + pts; this.counts[kind] = (this.counts[kind] || 0) + 1;
    events.emit('score', { eventId: this.id, kind, pts, total: this.score });
  }
  /**
   * advance with the player: p = { t (race time incl. penalties), s (route s of the front bumper), kmh }.
   * returns a list of what happened this step: { kind: 'split' | 'trap' | 'finish' | 'timeup', ... }
   */
  update(dt, p) {
    const out = [];
    if (!this.started || this.done) return out;
    this.t = p.t;
    const prog = this.progress(p.s);
    this.maxProg = Math.max(this.maxProg, prog);
    // checkpoints (only when crossed forwards: driving back and forth across a line doesn't count twice)
    while (this.cpIdx < this.r.checkpoints.length && prog >= this.r.checkpoints[this.cpIdx].d) {
      const cp = this.r.checkpoints[this.cpIdx], i = this.cpIdx++;
      this.splits.push(p.t);
      const best = this.best.bestSplits?.[i] ?? null;
      const e = { kind: 'split', eventId: this.id, index: i, id: cp.id, name: cp.name, time: p.t, best, delta: best != null ? p.t - best : null, last: cp.id === 'finish' };
      events.emit('split', e); out.push(e);
    }
    while (this.trapIdx < this.r.traps.length && prog >= this.r.traps[this.trapIdx].d) {
      const i = this.trapIdx++; this.trapSpeeds.push(p.kmh);
      const e = { kind: 'trap', eventId: this.id, index: i, kmh: p.kmh, total: this.trapSpeeds.reduce((a, b) => a + b, 0) };
      events.emit('trap', e); out.push(e);
    }
    if (this.cpIdx >= this.r.checkpoints.length) out.push({ kind: 'finish' });
    else if (this.r.timeLimit && p.t >= this.r.timeLimit) out.push({ kind: 'timeup' });
    this.lastProg = prog;
    return out;
  }
  /** close the run: extra = { time (null if not finished), position, field, penalties, carName, ... } */
  finish(extra = {}) {
    if (this.done) return this.result;
    this.done = true;
    const trapTotal = this.trapSpeeds.reduce((a, b) => a + b, 0);
    const res = {
      eventId: this.id, type: this.type, car: this.car, time: extra.time ?? null, splits: this.splits.slice(),
      position: extra.position ?? 1, field: extra.field ?? 1, score: Math.round(this.score), medal: null,
      trapSpeeds: this.trapSpeeds.slice(), trapTotal, breakdown: { ...this.breakdown }, penalties: extra.penalties || 0,
      distance: this.r.len, reverse: this.r.reverse, routeKey: `${Math.round(this.r.s0)}>${Math.round(this.r.s1)}`, valid: true, ...extra,
    };
    if (res.time == null && this.type !== 'score') res.valid = false;
    res.medal = medalFor(this.def, res, this.r);
    if (!this.def.quick || this.def.save) Object.assign(res, recordResult(this.def, res, this.st));
    else res.record = null;
    this.result = res;
    events.emit('finish', res);
    return res;
  }
  abort(reason = 'restart') {
    if (this.done || !this.started) return;
    this.done = true;
    events.emit('abort', { eventId: this.id, type: this.type, reason });
  }
}

function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

if (typeof window !== 'undefined') window.__events = events;
