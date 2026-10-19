import { MAPS, canReverse } from './map-catalog.js';
import { upperName } from './greek-caps.js';
import { buildCourse, observeCourse } from './course.js';
// EVENTS: data-driven race events (sprints against a grid of 3 by default, time trials, police pursuits), their route segments /
// direction, medal targets and saved results; plus the event hook API other systems listen to. Straight time: no points.
// Pure logic, no DOM or three.js: node can import and test it (tools/events-test.mjs).
//
// ---------------------------------------------------------------------------------------------- HOOK API
//   import { events } from './events.js';        (also window.__events in the browser)
//   const off = events.on('finish', (result) => { ... });   off() unsubscribes; events.once(name, fn) fires once
//
//   'start'   { eventId, type, car, def, run }      at GO (after the countdown). run = the live EventRun
//   'split'   { eventId, index, id, name, time, best, delta }    timing sector crossed (district markers) / the finish
//   'lap'     { eventId, lap, laps, time, total }   a lap completed (circuits)
//   'finish'  result                                event complete (finished, busted, or a pursuit survived)
//   'abort'   { eventId, type, reason }             restart / quit to menu before the finish
//
//   result = { eventId, mapId, type, car, time, splits, laps, lapTimes, bestLap, position, medal,
//              field, penalties, distance, reverse, record, newBest, prevMedal, busted,
//              valid (a clean, normal finish: not autodrive / online / aborted), routeKey ('<s0>><s1>' in metres) }
//     time       seconds incl. penalties (null = did not finish, e.g. busted)
//     splits     [seconds at each timing sector, last one = finish]
//     position   1..field (sprints; 1 for solo events), field = number of cars
//     medal      'gold' | 'silver' | 'bronze' | null
//     record     what is now saved in localStorage['paraliaki.events.<id>']
//
// ---------------------------------------------------------------------------------------------- DEFINITIONS
//   { id, name, blurb, type: 'sprint' | 'timetrial' | 'pursuit',
//     from, to,              route locations: 'start' | 'finish' | a data/map.json marks id | a route s in metres;
//                            from > to (in s) means the REVERSE direction (Lomvarda -> Vouliagmeni)
//     rivals: n | [ids],     sprint grid (DRIVERS ids; SP_RIVALS = 2 by default, up to MAX_RIVALS via src/race-setup.js), 0 for solo events
//     rivalCount: n          the player's choice of AI rivals (race setup); overrides the rivals count, keeps listed ids first
//     traffic: 0..1.6,       traffic density multiplier (0 = closed road)
//     rules: { timeLimit, penalty, signals },   pursuit survive clock (s); red light penalty (s); signals off = all green
//     targets: { gold, silver, bronze },  sprint: finishing position; timetrial: average km/h (-> a time);
//                            pursuit 'escape': seconds until the cops are shaken off (lower is better)
//     rules.police / startHeat / goal: 'escape' (lose the police, or reach the finish unbusted) | 'survive'
//                            (rules.timeLimit s unbusted; pass/fail = gold). src/police.js drives the cops; busted = DNF
//     conditions: { time: 'dawn'|'day'|'afternoon'|'sunset'|'night', weather: 'clear'|'overcast'|'rain' } | null,
//                            handed to setConditions() (src/weather.js) on top of the session's own conditions
//     car: id | null }       forced car (otherwise your garage pick)

// ------------------------------------------------------------------ emitter
import { DRIVING_MODES, isDrivingMode, drivingModeDefinition, resolveDrivingMode } from './driving-objectives.js';
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
  { id: 'yiannis', name: 'YIANNIS', pace: 0.86, racePace: 1.02, aggression: 1, nitro: 0.6, risk: 1.3, mistakes: 1.2, car: ['taxi'], helmet: '#e8b716', blurb: 'Off shift. Still has a fare to make.' },
  { id: 'kostas', name: 'KOSTAS', pace: 0.89, nitro: 1.2, risk: 1.1, mistakes: 1.0, car: ['mini', 'gr_yaris'], helmet: '#7d3fb0', blurb: 'Weekend hero from Glyfada.' },
  { id: 'maria', name: 'MARIA', pace: 0.93, nitro: 0.9, risk: 0.6, mistakes: 0.6, car: ['carrera', 'z4'], helmet: '#e05a1a', blurb: 'Track-day regular. Fast.' },
  { id: 'giorgos', name: 'GIORGOS', pace: 0.87, racePace: 1.02, aggression: 1, nitro: 1.0, risk: 1.5, mistakes: 1.3, car: ['gtv', 'taxi'], helmet: '#3d4651', blurb: 'Old school, no aids.' },
  { id: 'sofia', name: 'SOFIA', pace: 0.91, nitro: 1.1, risk: 0.9, mistakes: 0.7, car: ['gr_yaris', 'carrera'], helmet: '#0f8c8c', blurb: 'Rally club, Saturday mornings.' },
  { id: 'petros', name: 'PETROS', pace: 0.88, nitro: 0.9, risk: 1.2, mistakes: 1.1, car: ['z4', 'gtv'], helmet: '#b03a6a', blurb: 'Drives to the beach every evening.' },
  { id: 'katerina', name: 'KATERINA', pace: 0.9, nitro: 1.0, risk: 0.7, mistakes: 0.8, car: ['carrera', 'mini'], helmet: '#5a7d1f', blurb: 'Smooth and patient.' },
];
const CLASSIC_DRIVERS = 8; // the original grid pool (see gridFor)
export const driver = (id) => DRIVERS.find((d) => d.id === id) || DRIVERS[0];
/** single player: the default number of AI racers in a sprint (the race setup can change it, 0..MAX_RIVALS) */
export const SP_RIVALS = 2;
/** the most AI racers a grid takes: two (the user's cap; more cost frame rate for little racing) */
export const MAX_RIVALS = 2;
/** how many AI racers an event runs: the player's choice, else the event's own count, else SP_RIVALS */
export function rivalCount(def) {
  if (def.type !== 'sprint') return 0;
  const n = def.rivalCount ?? (Array.isArray(def.rivals) ? def.rivals.length : def.rivals ?? SP_RIVALS);
  return Math.max(0, Math.min(MAX_RIVALS, DRIVERS.length, Math.floor(+n) || 0));
}
export { WRECK_EBS } from './damage-math.js';
export { isTerminalImpact as isWrecked } from './damage-math.js';
/** the grid for an event: driver records in grid order (explicit ids, or a stable per-event pick); rivalCount(def) of them */
export function gridFor(def) {
  const n = rivalCount(def);
  if (Array.isArray(def.rivals) && def.rivals.length >= n) return def.rivals.slice(0, n).map(driver);
  // a stable but per-event shuffle so the same event always has the same faces
  // (the first eight drivers shuffle exactly as before the grid could grow, so default grids keep their faces; the
  // drivers added for bigger grids queue after them)
  const h = hash(def.baseId || def.id); const pool = DRIVERS.slice(0, CLASSIC_DRIVERS);
  for (let i = pool.length - 1; i > 0; i--) { const j = ((h >>> (i % 16)) + i * 7) % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  pool.push(...DRIVERS.slice(CLASSIC_DRIVERS));
  const fixed = Array.isArray(def.rivals) ? def.rivals.map(driver) : [];
  const out = [...fixed, ...pool.filter((d) => !fixed.includes(d))].slice(0, n);
  if (n && !fixed.length && !out.some((d) => d.id === 'stavros')) out[0] = DRIVERS[0]; // STAVROS is always there
  return out;
}
/** the body a driver brings (first preferred one that exists) */
export function driverCar(d, carIds, avoid) {
  const ok = d.car.filter((c) => carIds.includes(c));
  return ok.find((c) => c !== avoid) || ok[0] || carIds[(hash(d.id) % carIds.length)];
}

// ------------------------------------------------------------------ the events
export const TYPES = {
  ...DRIVING_MODES,
  free: { label: 'FREE ROAM', short: 'FREE', desc: 'Drive anywhere in traffic. No clock, rivals or finish.' },
  sprint: { label: 'SPRINT', short: 'SPRINT', desc: 'Beat two locals to the line.' },
  timetrial: { label: 'TIME TRIAL', short: 'TT', desc: 'You, the road and the clock.' },
  pursuit: { label: 'PURSUIT', short: 'PURSUIT', desc: 'Shake the ΕΛ.ΑΣ. off your tail. Get busted and it is over.' },
};
/** Map-local untimed session; never part of the competitive event catalogue. `spawn` ({ x, z, name }, map metres) is where the
 *  player chose to start (owner 2026-10-19): the car goes on the nearest drivable road to it. Without one the session starts at the map's start. */
export const freeRoam = (mapId = 'riviera', spawn = null) => ({ id: 'free:' + mapId, mapId, name: 'FREE ROAM', type: 'free', ...(spawn ? { spawn } : {}), reverse: MAPS.find(m => m.id === mapId)?.defaultReverse === true, free: true, from: 'start', to: 'finish', rivals: 0, traffic: mapId === 'megara' ? 0 : 1, targets: {} });
export const MEDALS = ['bronze', 'silver', 'gold'];

export const EVENTS = [
  { id: 'riviera-sprint', name: 'RIVIERA SPRINT', blurb: 'The full run, Vouliagmeni to Lomvarda.', type: 'sprint', from: 'start', to: 'finish', rivals: 2, traffic: 1, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'astir-varkiza', name: 'BEACH ROAD DASH', blurb: 'Past the lake and the coves of Limanakia into Varkiza.', type: 'sprint', from: 'astir', to: 'varkiza', rivals: 2, traffic: 0.8, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'cliff-sprint', name: 'CLIFF ROAD SPRINT', blurb: 'Limanakia to Lomvarda, the bends above the sea.', type: 'sprint', from: 'limanakia', to: 'finish', rivals: 2, traffic: 0.9, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'return-leg', name: 'THE RETURN LEG', blurb: 'Reverse: Lomvarda back to Vouliagmeni at sunset.', type: 'sprint', from: 'finish', to: 'start', rivals: 2, traffic: 1, conditions: { time: 'sunset' }, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'harbour-run', name: 'HARBOUR RUN', blurb: 'Reverse: Varkiza harbour back to the lake.', type: 'sprint', from: 'varkiza', to: 'lake', rivals: 2, traffic: 0.7, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'classic-cup', name: 'CLASSIC CUP', blurb: 'Vouliagmeni to the Limanakia cliffs.', type: 'sprint', from: 'start', to: 'limanakia', rivals: ['giorgos', 'yiannis'], traffic: 0.6, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'hot-hatch', name: 'HOT HATCH SHOOTOUT', blurb: 'The lake to the coast road.', type: 'sprint', from: 'lake', to: 'coast', rivals: ['nikos', 'stavros'], traffic: 0.9, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'legend-run', name: 'LEGEND OF THE RIVIERA', blurb: 'The full road at night against the two fastest locals.', type: 'sprint', from: 'start', to: 'finish', rivals: ['maria', 'eleni'], traffic: 1.2, conditions: { time: 'night' }, targets: { gold: 1, silver: 2, bronze: 3 } },
  { id: 'tt-riviera', name: 'RIVIERA TIME TRIAL', blurb: 'The whole road, closed off.', type: 'timetrial', from: 'start', to: 'finish', rivals: 0, traffic: 0, targets: { gold: 150, silver: 132, bronze: 115 } },
  { id: 'tt-coast', name: 'COAST ROAD TT', blurb: 'Varkiza to Lomvarda in the morning traffic.', type: 'timetrial', from: 'varkiza', to: 'finish', rivals: 0, traffic: 0.4, targets: { gold: 140, silver: 122, bronze: 105 } },
  { id: 'tt-reverse', name: 'REVERSE TT', blurb: 'Lomvarda to Limanakia, the wrong way round.', type: 'timetrial', from: 'finish', to: 'limanakia', rivals: 0, traffic: 0, targets: { gold: 148, silver: 130, bronze: 112 } },
  { id: 'tt-night-cliffs', name: 'MIDNIGHT CLIFFS TT', blurb: 'Limanakia to Lomvarda after dark.', type: 'timetrial', from: 'limanakia', to: 'finish', rivals: 0, traffic: 0, conditions: { time: 'night' }, targets: { gold: 138, silver: 120, bronze: 104 } },
  { id: 'pursuit-escape', name: 'HOT PURSUIT: CLIFF ROAD', blurb: 'Two stars on your tail from Limanakia. Lose them, the faster the better.', type: 'pursuit', from: 'limanakia', to: 'finish', rivals: 0, traffic: 0.9, rules: { police: true, startHeat: 2, goal: 'escape' }, targets: { gold: 60, silver: 95, bronze: 140 } },
  { id: 'pursuit-survive', name: 'MOST WANTED: RIVIERA', blurb: 'Survive three minutes with every patrol on the coast after you.', type: 'pursuit', from: 'start', to: 'finish', rivals: 0, traffic: 1, rules: { police: true, startHeat: 1, goal: 'survive', timeLimit: 180 }, targets: {} },
];
/** Quick Race: the full sprint in whatever car you have, two rivals */
export const QUICK_RACE = { id: 'quick', name: 'QUICK RACE', blurb: 'Vouliagmeni to Lomvarda against two locals.', type: 'sprint', from: 'start', to: 'finish', rivals: 2, traffic: 1, targets: { gold: 1, silver: 2, bronze: 3 }, quick: true };
// Bundle-owned events are registered when that map loads; IDs stay global for saved records.
const mapEvents = new Map();
export function registerMapEvents(mapId, defs) {
  if (!Array.isArray(defs)) throw new Error('Invalid events for map ' + mapId);
  mapEvents.set(mapId, defs.map(def => ({ reverse: MAPS.find(m => m.id === mapId)?.defaultReverse === true, ...def, mapId })));
}
export function getEvents(mapId = 'riviera') { return mapEvents.get(mapId) || (mapId === 'riviera' ? EVENTS : []); }
export const getEvent = (id) => (isDrivingMode(id?.split(':')[0]) ? drivingModeDefinition(id.split(':')[0], id.split(':')[1]?.split('~')[0] || 'riviera') : id?.startsWith('free:') ? freeRoam(id.slice(5)) : id === 'quick' ? QUICK_RACE : EVENTS.find((e) => e.id === id) || [...mapEvents.values()].flat().find(e => e.id === id) || null);

// ------------------------------------------------------------------ resolving a definition onto the route
/** ctx = { route: {start, finish, length, from, to, curv?}, marks: [{id, name, sub, s}] } */
export function locate(loc, ctx) {
  if (typeof loc === 'number') return { s: loc, name: nearestName(loc, ctx) };
  if (loc === 'start') return { s: ctx.route.start, name: upperName(ctx.route.from || 'START') };
  if (loc === 'finish') return { s: ctx.route.finish, name: upperName(ctx.route.to || 'FINISH') };
  const m = ctx.marks.find((q) => q.id === loc);
  if (!m) throw new Error('unknown event location ' + loc);
  return { s: m.s, name: m.name };
}
function nearestName(s, ctx) { let n = upperName(ctx.route.from || ''); for (const m of ctx.marks) if (s >= m.s - 1) n = m.name; return n; }

export function resolve(def, ctx) {
  if (isDrivingMode(def)) return resolveDrivingMode(def, ctx);
  if (def.reverse && !canReverse(def.mapId)) def = { ...def, reverse: false }; // one-way-only course

  const a = locate(def.from, ctx), b = locate(def.to, ctx);
  if (def.type === 'free') return { s0: a.s, s1: b.s, dir: def.reverse ? -1 : 1, len: ctx.route.length, fromName: a.name, toName: b.name, sectors: [], reverse: def.reverse === true, timeLimit: 0, targetTimes: null, free: true };
  if (ctx.route.closed) {
    const laps = Math.max(1, Math.min(99, Math.floor(def.laps || 1))), lapLength = ctx.route.length;
    const dir = def.reverse ? -1 : 1, len = lapLength * laps, sectors = [];
    for (let lap = 1; lap <= laps; lap++) for (let sector = 1; sector <= 4; sector++) {
      const d = ((lap - 1) + sector / 4) * lapLength, last = lap === laps && sector === 4;
      sectors.push({ id: last ? 'finish' : `lap${lap}-sector${sector}`, name: sector === 4 ? `LAP ${lap}` : `SECTOR ${sector}`, s: a.s + dir * d, d, lapEnd: sector === 4, lap });
    }
    return { s0:a.s, s1:a.s + dir*len, dir, len, laps, lapLength, closed:true, fromName:a.name,
      toName:b.name, sectors, reverse:dir<0, timeLimit:0,
      targetTimes:def.type === 'timetrial' ? Object.fromEntries(MEDALS.map(m => [m, def.targetTimes?.[m] ?? len / ((def.targets?.[m] || 100) / 3.6)])) : null };
  }
  const dir = b.s >= a.s ? 1 : -1, len = Math.abs(b.s - a.s);
  const prog = (s) => (s - a.s) * dir;
  // timing sectors: the district markers strictly inside the segment, then the finish
  let cps = ctx.marks.filter((m) => prog(m.s) > 150 && prog(m.s) < len - 150).sort((p, q) => prog(p.s) - prog(q.s)).map((m) => ({ id: m.id, name: m.name, s: m.s, d: prog(m.s) }));
  if (!cps.length && len > 2500) { // a long segment with few districts: add kilometre splits
    const n = Math.floor(len / 2000); cps = [];
    for (let i = 1; i <= n; i++) { const d = len * i / (n + 1); cps.push({ id: 'km' + i, name: `${(d / 1000).toFixed(1)} KM`, s: a.s + dir * d, d }); }
  }
  cps.push({ id: 'finish', name: b.name, s: b.s, d: len });
  const out = { s0: a.s, s1: b.s, dir, len, fromName: a.name, toName: b.name, sectors: cps, reverse: dir < 0, timeLimit: def.rules?.timeLimit || 0 };
  out.targetTimes = def.type === 'timetrial' ? Object.fromEntries(MEDALS.map((m) => [m, len / (def.targets[m] / 3.6)])) : null;
  return out;
}

// ------------------------------------------------------------------ medals
const rank = (m) => (m ? MEDALS.indexOf(m) + 1 : 0);
export const betterMedal = (a, b) => (rank(a) >= rank(b) ? a : b);
/** medal earned by a result for this definition (r = resolve(def)) */
export function medalFor(def, res, r) {
  if (res.wrecked) return null;
  const t = def.targets || {};
  if (def.type === 'sprint') { if (res.time == null) return null; for (const m of ['gold', 'silver', 'bronze']) if (res.position <= t[m]) return m; return null; }
  if (def.type === 'timetrial') { if (res.time == null) return null; for (const m of ['gold', 'silver', 'bronze']) if (res.time <= r.targetTimes[m]) return m; return null; }
  if (def.type === 'pursuit') {
    if (res.time == null || res.busted) return null;
    if (def.rules?.goal === 'survive') return res.time >= (def.rules.timeLimit || 0) ? 'gold' : null; // pass / fail
    for (const m of ['gold', 'silver', 'bronze']) if (res.time <= t[m]) return m; return null;
  }
  return null;
}
/** human-readable targets: [['gold', 'WIN'], ...] (all times, or positions for sprints) */
export function targetLabels(def, r, fmtTime) {
  if (def.type === 'free' || isDrivingMode(def)) return [];
  const t = def.targets || {};
  if (def.type === 'pursuit' && def.rules?.goal === 'survive') return [['gold', 'SURVIVE ' + fmtTime(def.rules.timeLimit)]];
  return ['gold', 'silver', 'bronze'].map((m) => [m,
    def.type === 'sprint' ? (t[m] === 1 ? 'WIN' : 'TOP ' + t[m]) : def.type === 'timetrial' ? fmtTime(r.targetTimes[m]) : 'LOSE THEM IN ' + fmtTime(t[m])]);
}

// ------------------------------------------------------------------ saved results
// The 2026-10-18 Garden Circuit is a different route from every earlier Psychiko loop: its personal
// bests live in their own namespace so old times never rank against it.
const KEY = (id) => 'paraliaki.events.' + id + (/^psychiko-(race|tt)(?:~|$)/.test(id) ? '.garden-v2' : '');
const store = () => (typeof localStorage !== 'undefined' ? localStorage : memStore);
const memStore = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
export function loadRecord(id, st = store()) {
  try {
    const value = st.getItem(KEY(id));
    return JSON.parse(value || 'null') || {};
  } catch { return {}; }
}
export function saveRecord(id, rec, st = store()) { try { st.setItem(KEY(id), JSON.stringify(rec)); } catch {} }
/** fold a result into the saved record; returns { record, newBest, prevMedal } */
export function recordResult(def, res, st = store()) {
  const prev = loadRecord(def.id, st), rec = { ...prev };
  rec.runs = (prev.runs || 0) + 1;
  rec.medal = betterMedal(prev.medal || null, res.medal) || null;
  let newBest = false;
  const timed = res.time != null && !res.wrecked && !res.busted && !(def.type === 'pursuit' && def.rules?.goal === 'survive');
  if (timed && !(res.time >= (prev.bestTime ?? Infinity))) { rec.bestTime = res.time; rec.bestSplits = res.splits.slice(); rec.bestCar = res.car; newBest = true; }
  if (def.type === 'sprint' && res.time != null && !res.wrecked && !res.busted) rec.bestPos = Math.min(prev.bestPos ?? 99, res.position);
  rec.last = { time: res.time, position: res.position, medal: res.medal, car: res.car, at: Date.now() };
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
    if (!!a.dnf !== !!b.dnf) return a.dnf ? 1 : -1;
    return b.prog - a.prog;
  });
}

// ------------------------------------------------------------------ wrong way
/**
 * heading = cos(angle between the car's nose and the event's direction of travel, already flipped for reverse
 * events); speed = forward speed (m/s, negative reversing). Driving nose-first against the event for 1.5 s at more
 * than 5 m/s turns it on; it clears with hysteresis so it doesn't flicker. Returns a boolean.
 */
export function wrongWay(state, dt, heading, speed) {
  const bad = heading < -0.35 && speed > 5;
  state.t = bad ? Math.min(3, (state.t || 0) + dt) : Math.max(0, (state.t || 0) - dt * 2.5);
  if (!state.on && state.t > 1.5) state.on = true;
  else if (state.on && state.t <= 0.2) state.on = false;
  return !!state.on;
}

// ------------------------------------------------------------------ a run of one event
export class EventRun {
  /** def: an event definition; ctx: see resolve(); opts: { car, storage } */
  constructor(def, ctx, opts = {}) {
    this.def = def; this.r = resolve(def, ctx); this.courseRoute = ctx.route; this.car = opts.car || null; this.st = opts.storage || store();
    this.best = loadRecord(def.id, this.st);
    this.reset();
  }
  reset() {
    this.t = 0; this.started = false; this.done = false; this.result = null;
    this.lapTimes = []; this.lapStart = 0;
    this.course = buildCourse(this.r, this.courseRoute); this.courseClock = 0;
    this.sectorIdx = 0; this.splits = []; this.lastProg = 0; this.maxProg = 0; this.ww = {};
  }
  get type() { return this.def.type; }
  get id() { return this.def.id; }
  get lap() { return Math.min(this.r.laps || 1, this.lapTimes.length + 1); }
  get lapTime() { return Math.max(0, this.t - this.lapStart); }
  progress(s) { return (s - this.r.s0) * this.r.dir; }
  /** 0..1 along the event */
  frac(s) { return Math.max(0, Math.min(1, this.progress(s) / this.r.len)); }
  timeLeft() { return this.r.timeLimit ? Math.max(0, this.r.timeLimit - this.t) : Infinity; }
  start(payload = {}) {
    this.started = true;
    events.emit('start', { eventId: this.id, type: this.type, car: this.car, def: this.def, run: this, ...payload });
  }
  /**
   * advance with the player: p = { t (race time incl. penalties), s (route s of the front bumper), kmh }.
   * returns a list of what happened this step: { kind: 'lap' | 'split' | 'finish' | 'timeup', ... }
   */
  update(dt, p) {
    const out = [];
    if (!this.started || this.done || this.type === 'free') return out;
    this.t = p.t;
    const prog = this.progress(p.s);
    this.courseClock += dt;
    observeCourse(this.course, p, this.courseClock, { route: this.courseRoute });
    this.maxProg = Math.max(this.maxProg, this.course.reached);
    // Timing sectors (only when reached forwards: driving back and forth across a line doesn't count twice).
    while (this.sectorIdx < this.r.sectors.length && this.course.reached >= this.r.sectors[this.sectorIdx].d) {
      const cp = this.r.sectors[this.sectorIdx], i = this.sectorIdx++;
      const crossedAt = this.course.markTimes[this.course.marks.findIndex(d => d >= cp.d - 1e-7)];
      const timeAtLine = Number.isFinite(crossedAt) ? p.t - (this.courseClock - crossedAt) : p.t;
      this.splits.push(timeAtLine);
      if (cp.lapEnd) {
        const time = timeAtLine - this.lapStart; this.lapTimes.push(time); this.lapStart = timeAtLine;
        const lap = { kind:'lap', eventId:this.id, lap:cp.lap, laps:this.r.laps, time, total:timeAtLine };
        events.emit('lap', lap); out.push(lap);
      }
      const best = this.best.bestSplits?.[i] ?? null;
      const e = { kind: 'split', eventId: this.id, index: i, id: cp.id, name: cp.name, time: timeAtLine, best, delta: best != null ? timeAtLine - best : null, last: cp.id === 'finish' };
      events.emit('split', e); out.push(e);
    }
    const surviving = this.type === 'pursuit' && this.def.rules?.goal === 'survive';
    if (surviving) { if (this.r.timeLimit && p.t >= this.r.timeLimit) out.push({ kind: 'timeup' }); }
    else if (this.sectorIdx >= this.r.sectors.length) out.push({ kind: 'finish', time: this.splits.at(-1) ?? p.t });
    else if (this.r.timeLimit && p.t >= this.r.timeLimit) out.push({ kind: 'timeup' });
    this.lastProg = prog;
    return out;
  }
  /** close the run: extra = { time (null if not finished), position, field, penalties, carName, ... } */
  finish(extra = {}) {
    if (this.done) return this.result;
    this.done = true;
    const res = {
      eventId: this.id, mapId: this.def.mapId || 'riviera', type: this.type, car: this.car, time: extra.time ?? null, splits: this.splits.slice(),
      laps: this.r.laps || 1, lapTimes: this.lapTimes.slice(), bestLap: this.lapTimes.length ? Math.min(...this.lapTimes) : null,
      position: extra.position ?? 1, field: extra.field ?? 1, medal: null, penalties: extra.penalties || 0,
      distance: this.r.len, reverse: this.r.reverse, routeKey: `${Math.round(this.r.s0)}>${Math.round(this.r.s1)}`, valid: true, ...extra,
    };
    if (res.wrecked) { res.time = null; res.position = null; res.valid = false; res.won = false; res.busted = false; }
    if (res.time == null) res.valid = false;
    if (this.def.custom) res.valid = false; // a changed race setup: kept apart from the official boards
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
