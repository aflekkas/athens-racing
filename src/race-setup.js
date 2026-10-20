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
import { isDrivingMode } from './driving-objectives.js';
import { canReverse } from './map-catalog.js';

export { MAX_RIVALS };
export const TRAFFIC_LEVELS = Object.freeze([['off', 0, 'OFF'], ['light', 0.5, 'LIGHT'], ['normal', 1, 'NORMAL'], ['heavy', 1.5, 'HEAVY'], ['extreme', 2, 'EXTREME']]);
export const TIMES = Object.freeze([['dawn', 'DAWN'], ['day', 'MIDDAY'], ['afternoon', 'AFTERNOON'], ['sunset', 'SUNSET'], ['night', 'NIGHT'], ['dynamic', 'DYNAMIC']]);
export const WEATHERS = Object.freeze([['clear', 'CLEAR'], ['overcast', 'OVERCAST'], ['rain', 'RAIN'], ['dynamic', 'DYNAMIC']]);
export const MAX_LAPS = 20;
/** POLICE difficulty (src/police.js POLICE_LEVELS); OFF is police: false */
export const POLICE_LEVELS = Object.freeze([['relaxed', 'RELAXED'], ['normal', 'NORMAL'], ['tough', 'TOUGH']]);
export const isPoliceLevel = (v) => POLICE_LEVELS.some(([id]) => id === v);
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
  // Saved race-setup keys: `police` (boolean), `policeLevel` (POLICE_LEVELS id) and `busted` (can the police arrest you).
  // The menu shows police + policeLevel as one OFF / RELAXED / NORMAL / TOUGH row, and CAN BE BUSTED while police are on.
  if (def.type !== 'pursuit') out.push({ key: 'police', dflt: def.rules?.police === true },
    { key: 'policeLevel', dflt: isPoliceLevel(def.rules?.policeLevel) ? def.rules.policeLevel : 'normal' }, { key: 'busted', dflt: def.rules?.busted !== false });
  if (!closed || def.type === 'sprint' || def.type === 'free' || isDrivingMode(def)) out.push({ key: 'traffic', dflt: def.traffic ?? 1, levels: trafficLevels(def.traffic ?? 1) });
  if (closed && def.type !== 'free' && !isDrivingMode(def)) out.push({ key: 'laps', dflt: baseLaps(def), min: 1, max: MAX_LAPS });
  if (!['pursuit', 'free'].includes(def.type) && !isDrivingMode(def) && canReverse(def.mapId)) out.push({ key: 'reverse', dflt: false });
  out.push({ key: 'time', dflt: def.conditions?.time || 'afternoon' }, { key: 'weather', dflt: def.conditions?.weather || 'clear' });
  return out;
}

export function loadSetup(id, st = store()) {
  try {
    const all = JSON.parse(st.getItem(KEY) || '{}'), s = all?.[id];
    if (!s || typeof s !== 'object') return {};
    // Setups saved before the two-rival cap: bring them down and store the fix.
    if (Number.isFinite(+s.rivals) && +s.rivals > MAX_RIVALS) { s.rivals = MAX_RIVALS; all[id] = s; st.setItem(KEY, JSON.stringify(all)); }
    return { ...s };
  } catch { return {}; }
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
    else if (f.key === 'police') v = v === true;
    else if (f.key === 'policeLevel') v = isPoliceLevel(v) ? v : f.dflt;
    else if (f.key === 'busted') v = v === true || v === false ? v : f.dflt;
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
  return setupFields(def, ctx).some((f) => cur[f.key] !== f.dflt && (cur.police || !['policeLevel', 'busted'].includes(f.key)));
}

/** a run definition with the choices applied (the input definition is not modified) */
export function applySetup(def, setup = {}, ctx = {}) {
  const fields = setupFields(def, ctx), cur = resolveSetup(def, setup, ctx), dflt = Object.fromEntries(fields.map((f) => [f.key, f.dflt]));
  const out = { ...def, baseId: def.baseId || def.id };
  const key = [];
  if ('police' in cur) {
    out.rules = { ...(def.rules || {}), police: cur.police, policeLevel: cur.policeLevel, busted: cur.busted };
    if (cur.police !== dflt.police) key.push('police' + Number(cur.police));
    if (cur.police && cur.policeLevel !== dflt.policeLevel) key.push('pol-' + cur.policeLevel);
    if (cur.police && cur.busted !== dflt.busted) key.push(cur.busted ? 'bust' : 'nobust');
  }
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
  if (cur.reverse && canReverse(def.mapId)) {
    key.push('rev');
    if (ctx.closed) out.reverse = !def.reverse;
    else { out.from = def.to; out.to = def.from; }
  }
  if ('time' in cur || 'weather' in cur) {
    const cond = { ...(def.conditions || {}) };
    if (cur.time !== dflt.time || def.conditions?.time) cond.time = cur.time;
    if (cur.weather !== dflt.weather || def.conditions?.weather) cond.weather = cur.weather;
    out.conditions = def.type === 'free' ? { ...cond, time: cur.time, weather: cur.weather } : Object.keys(cond).length ? cond : (def.conditions ?? null);
  }
  if (key.length) { out.id = `${out.baseId}~${key.join('~')}`; out.custom = true; }
  out.setup = cur;
  return out;
}
export { SP_RIVALS };
