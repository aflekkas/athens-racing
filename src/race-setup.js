// RACE SETUP: the player's per-event choices (AI rivals, traffic, time of day, weather, laps, direction) layered over an
// event definition. Pure logic, no DOM: node imports it (tools/events-test.mjs).
//   import { setupFields, loadSetup, saveSetup, applySetup } from './race-setup.js';
//   const fields = setupFields(def, { closed })   which options the event offers, with their event defaults
//   const setup = loadSetup(def.id)                { rivals, traffic, time, weather, laps, reverse }; null = event default
//   const runDef = applySetup(def, setup, { closed })   a new definition. Route- or field-changing choices give it a
//     variant id ('<id>~r8~t2~l5~rev') so its records, ghosts and best times are kept apart from the official event, and
//     `custom: true` keeps it off the online leaderboard. Time of day and weather never change the id.
// Saved in localStorage['paraliaki.raceSetup'] = { [eventId]: setup }.
import { rivalCount, MAX_RIVALS, SP_RIVALS } from './events.js';

export { MAX_RIVALS };
/** above this many AI cars the frame rate can suffer on modest machines: the menu shows a warning, not a limit */
export const PERF_RIVALS = 5;
export const TRAFFIC_LEVELS = Object.freeze([['off', 0, 'OFF'], ['light', 0.5, 'LIGHT'], ['normal', 1, 'NORMAL'], ['heavy', 1.5, 'HEAVY'], ['extreme', 2, 'EXTREME']]);
export const TIMES = Object.freeze([['dawn', 'DAWN'], ['day', 'MIDDAY'], ['afternoon', 'AFTERNOON'], ['sunset', 'SUNSET'], ['night', 'NIGHT']]);
export const WEATHERS = Object.freeze([['clear', 'CLEAR'], ['overcast', 'OVERCAST'], ['rain', 'RAIN']]);
export const MAX_LAPS = 20;
const KEY = 'paraliaki.raceSetup';
const memStore = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, String(v)); } };
const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : memStore; } catch { return memStore; } };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** the traffic choices for an event: the nearest non-zero level takes the event's own density, so its default is a choice */
export function trafficLevels(dflt = 1) {
  const levels = TRAFFIC_LEVELS.map(([id, v, label]) => [id, v, label]);
  if (dflt > 0) { let best = 1; for (let i = 1; i < levels.length; i++) if (Math.abs(levels[i][1] - dflt) < Math.abs(levels[best][1] - dflt)) best = i; levels[best][1] = dflt; }
  return levels;
}
const baseLaps = (def) => Math.max(1, Math.floor(def.laps || 1));

/** what this event lets you change: [{ key, dflt }] in display order */
export function setupFields(def, { closed = false } = {}) {
  const out = [];
  if (def.type === 'sprint') out.push({ key: 'rivals', dflt: rivalCount(def), min: 0, max: MAX_RIVALS });
  if (!closed) out.push({ key: 'traffic', dflt: def.traffic ?? 1, levels: trafficLevels(def.traffic ?? 1) });
  if (closed) out.push({ key: 'laps', dflt: baseLaps(def), min: 1, max: MAX_LAPS });
  if (def.type !== 'pursuit') out.push({ key: 'reverse', dflt: false });
  out.push({ key: 'time', dflt: def.conditions?.time || 'afternoon' }, { key: 'weather', dflt: def.conditions?.weather || 'clear' });
  return out;
}

export function loadSetup(id, st = store()) {
  try { const all = JSON.parse(st.getItem(KEY) || '{}'); const s = all?.[id]; return s && typeof s === 'object' ? { ...s } : {}; } catch { return {}; }
}
export function saveSetup(id, setup, st = store()) {
  try {
    const all = JSON.parse(st.getItem(KEY) || '{}') || {};
    const clean = Object.fromEntries(Object.entries(setup || {}).filter(([, v]) => v != null));
    if (Object.keys(clean).length) all[id] = clean; else delete all[id];
    st.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** the effective value of each field: saved choice, else the event default */
export function resolveSetup(def, setup = {}, ctx = {}) {
  const out = {};
  for (const f of setupFields(def, ctx)) {
    let v = setup[f.key];
    if (f.key === 'rivals' || f.key === 'laps') v = Number.isFinite(+v) && v !== null && v !== '' ? clamp(Math.round(+v), f.min, f.max) : f.dflt;
    else if (f.key === 'traffic') v = Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, 0, 2) : f.dflt;
    else if (f.key === 'reverse') v = v === true;
    else if (f.key === 'time') v = TIMES.some(([t]) => t === v) ? v : f.dflt;
    else if (f.key === 'weather') v = WEATHERS.some(([w]) => w === v) ? v : f.dflt;
    out[f.key] = v;
  }
  return out;
}
/** true when any choice differs from the event */
export function isCustom(def, setup = {}, ctx = {}) {
  const cur = resolveSetup(def, setup, ctx);
  return setupFields(def, ctx).some((f) => cur[f.key] !== f.dflt);
}

/** a run definition with the choices applied (the input definition is not modified) */
export function applySetup(def, setup = {}, ctx = {}) {
  const fields = setupFields(def, ctx), cur = resolveSetup(def, setup, ctx), dflt = Object.fromEntries(fields.map((f) => [f.key, f.dflt]));
  const out = { ...def, baseId: def.baseId || def.id };
  const key = [];
  if ('rivals' in cur) {
    out.rivalCount = cur.rivals;
    if (Array.isArray(def.rivals)) out.rivals = def.rivals.slice(0, cur.rivals);
    else out.rivals = cur.rivals;
    if (cur.rivals !== dflt.rivals) key.push('r' + cur.rivals);
  }
  if ('traffic' in cur) { out.traffic = cur.traffic; if (cur.traffic !== dflt.traffic) key.push('t' + String(cur.traffic).replace('.', '')); }
  if ('laps' in cur) {
    out.laps = cur.laps;
    if (cur.laps !== dflt.laps) {
      key.push('l' + cur.laps);
      if (def.targetTimes) out.targetTimes = Object.fromEntries(Object.entries(def.targetTimes).map(([m, t]) => [m, t * cur.laps / baseLaps(def)]));
    }
  }
  if (cur.reverse) {
    key.push('rev');
    if (ctx.closed) out.reverse = !def.reverse;
    else { out.from = def.to; out.to = def.from; }
  }
  if ('time' in cur || 'weather' in cur) {
    const cond = { ...(def.conditions || {}) };
    if (cur.time !== dflt.time || def.conditions?.time) cond.time = cur.time;
    if (cur.weather !== dflt.weather || def.conditions?.weather) cond.weather = cur.weather;
    out.conditions = Object.keys(cond).length ? cond : (def.conditions ?? null);
  }
  if (key.length) { out.id = `${out.baseId}~${key.join('~')}`; out.custom = true; }
  out.setup = cur;
  return out;
}
export { SP_RIVALS };
