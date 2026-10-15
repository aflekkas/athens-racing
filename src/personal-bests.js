// Personal records are versioned separately from the event medal/leaderboard store.
// Only a completed, normally driven run can enter this local board.
const STORAGE_KEY = 'paraliaki.personalBests.v1';
const memory = new Map();
const fallback = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
const storage = () => { try { return globalThis.localStorage || fallback; } catch { return fallback; } };
const station = s => Math.round(Number(s || 0) * 1000) / 1000;
export function personalBestSetup({ mapId, def = {}, route = {}, car, conditions = {}, assists = {} }) {
  return {
    map: mapId || def.mapId || 'riviera', event: def.baseId || String(def.id || 'quick').split('~')[0],
    type: def.type || 'sprint', from: station(route.s0), to: station(route.s1), direction: route.dir || 1,
    laps: route.laps || 1, car: car || def.car || 'unknown',
    traffic: Number(def.traffic ?? 1), time: def.setup?.time ?? def.conditions?.time ?? conditions.time ?? 'afternoon',
    weather: def.setup?.weather ?? def.conditions?.weather ?? conditions.weather ?? 'clear',
    rivals: Number(def.rivalCount ?? (Array.isArray(def.rivals) ? def.rivals.length : def.rivals) ?? 0),
    police: def.rules?.police === true,
    tc: assists.tc ?? true, abs: assists.abs ?? true, steering: assists.steering ?? 'full', gearbox: assists.gearbox ?? 'auto',
  };
}
export const exactBestKey = setup => JSON.stringify(personalBestSetup({
  mapId: setup.map, def: { id: setup.event, type: setup.type, traffic: setup.traffic, rivals: setup.rivals, rules: { police: setup.police } },
  route: { s0: setup.from, s1: setup.to, dir: setup.direction, laps: setup.laps }, car: setup.car,
  conditions: { time: setup.time, weather: setup.weather }, assists: { tc: setup.tc, abs: setup.abs, steering: setup.steering, gearbox: setup.gearbox },
}));
// Route board intentionally spans cars, event names, weather, traffic and aids.
export const routeBestKey = s => JSON.stringify([s.map, s.from, s.to, s.direction, s.laps]);
export const bestGhostEvent = setup => 'personal-best:' + exactBestKey(setup);
function read(st) { try { const d = JSON.parse(st.getItem(STORAGE_KEY) || '{}'); return d?.version === 1 && d.exact && d.routes ? d : { version: 1, exact: {}, routes: {} }; } catch { return { version: 1, exact: {}, routes: {} }; } }
const valid = record => record && Number.isFinite(record.time) && record.time > 0;
export function getPersonalBests(setup, st = storage()) {
  const d = read(st), exact = d.exact[exactBestKey(setup)], route = d.routes[routeBestKey(setup)];
  return { exact: valid(exact) ? exact : null, route: valid(route) ? route : null };
}
export function recordPersonalBest(setup, result, st = storage()) {
  const before = getPersonalBests(setup, st);
  if (!result.valid || result.time == null || !Number.isFinite(result.time) || result.time <= 0 || result.busted || result.retired || result.wrecked) return { ...before, newBest: false, delta: null, eligible: false };
  const d = read(st), key = exactBestKey(setup), routeKey = routeBestKey(setup);
  const newBest = !before.exact || result.time < before.exact.time;
  const entry = { time: result.time, car: setup.car, date: result.date || new Date().toISOString(), setup };
  if (newBest) d.exact[key] = entry;
  if (!before.route || result.time < before.route.time) d.routes[routeKey] = entry;
  let persistent = false;
  try { st.setItem(STORAGE_KEY, JSON.stringify(d)); persistent = true; } catch {}
  return { exact: newBest ? entry : before.exact, route: d.routes[routeKey], newBest, delta: before.exact ? result.time - before.exact.time : null, eligible: true, persistent };
}
export function personalBestLabel(pb) {
  return pb?.newBest ? 'NEW PERSONAL BEST' + (pb.delta < 0 ? ` −${Math.abs(pb.delta).toFixed(2)} s` : '') : '';
}

export function getMapPersonalBest(mapId, st = storage()) {
  return Object.values(read(st).routes).filter(r => valid(r) && r.setup?.map === mapId).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}
