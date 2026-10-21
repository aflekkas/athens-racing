import { matchesRecord } from './leaderboard-records.js';
import { canonicalCarId } from './car-ids.js';
import {migrateRouteRecord,competitiveRecordKey,routeHistory,historicalEdition} from './route-migrations.js';
// Personal records are versioned separately from the event medal/leaderboard store.
// Only a completed, normally driven run can enter this local board.
const STORAGE_KEY = 'paraliaki.personalBests.v1';
const memory = new Map();
const fallback = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
const storage = () => { try { return globalThis.localStorage || fallback; } catch { return fallback; } };
const station = s => Math.round(Number(s || 0) * 1000) / 1000;
export function personalBestSetup({ mapId, def = {}, route = {}, car, carSpec = {}, conditions = {}, assists = {} }) {
  return {
    ...(def.routeId?{worldId:def.worldId,routeId:def.routeId,geometryHash:def.geometryHash,edition:def.edition,policeLevel:def.rules?.policeLevel||'normal',busted:def.rules?.busted!==false,signals:def.rules?.signals===true}:{}),
    map: mapId || def.mapId || 'riviera', event: def.baseId || String(def.id || 'quick').split('~')[0],
    type: def.type || 'sprint', from: station(route.s0), to: station(route.s1), direction: route.dir || 1,
    laps: route.laps || 1, car: car || def.car || 'unknown',
    ...(carSpec.name ? { carName: carSpec.name } : {}),
    traffic: Number(def.traffic ?? 1), time: def.setup?.time ?? def.conditions?.time ?? conditions.time ?? 'afternoon',
    weather: def.setup?.weather ?? def.conditions?.weather ?? conditions.weather ?? 'clear',
    rivals: Number(def.rivalCount ?? (Array.isArray(def.rivals) ? def.rivals.length : def.rivals) ?? 0),
    police: def.rules?.police === true,
    tc: assists.tc ?? true, abs: assists.abs ?? true, steering: assists.steering ?? 'full', gearbox: assists.gearbox ?? 'auto',
  };
}
const legacyBestKey = setup => JSON.stringify(personalBestSetup({
  mapId: setup.map, def: { id: setup.event, type: setup.type, traffic: setup.traffic, rivals: setup.rivals, rules: { police: setup.police } },
  route: { s0: setup.from, s1: setup.to, dir: setup.direction, laps: setup.laps }, car: setup.car,
  conditions: { time: setup.time, weather: setup.weather }, assists: { tc: setup.tc, abs: setup.abs, steering: setup.steering, gearbox: setup.gearbox },
}));
// One board per car: the car id is the only car field in the key (names are display metadata). Trim fields no longer exist.
// A setup that still names a removed trim reads and writes its model's top-trim board.
export const exactBestKey = setup => setup.routeId?competitiveRecordKey({routeId:setup.routeId,edition:setup.edition,eventId:setup.event,car:setup.car,setup:canonicalSetup(setup)}):legacyBestKey(canonicalSetup(setup));
// Route board intentionally spans cars, event names, weather, traffic and aids.
export const routeBestKey = s => JSON.stringify(s.routeId?[s.routeId,s.edition,s.direction,s.laps]:[s.map, s.from, s.to, s.direction, s.laps]);
export const bestGhostEvent = setup => 'personal-best:' + exactBestKey(setup);
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): a record set with a removed trim belongs to that model's top trim, and the trim
// fields are gone. Idempotent; where two records land on one board the faster time wins.
const canonicalSetup = setup => {
  if (!setup || typeof setup !== 'object' || Array.isArray(setup)) return setup;
  const { carName, carGeneration, carTrim, ...rest } = setup, car = canonicalCarId(rest.car);
  return carTrim === undefined && carGeneration === undefined && car === rest.car ? setup : { ...rest, car, ...(car === rest.car && carName ? { carName } : {}) };
};
const canonicalRecord = raw => {
  if (!raw || typeof raw !== 'object') return raw;
  const setup = canonicalSetup(raw.setup), car = canonicalCarId(raw.car);
  return setup === raw.setup && car === raw.car ? raw : { ...raw, car, ...(setup ? { setup } : {}) };
};
function canonicalStore(d) {
  const keyOf = (key, setup) => { if (setup) return exactBestKey(setup); try { const s = JSON.parse(key); return s && typeof s === 'object' && !Array.isArray(s) ? exactBestKey(canonicalSetup(s)) : key; } catch { return key; } };
  const exact = {}, routes = {};
  for (const [key, raw] of Object.entries(d.exact)) {
    const record = canonicalRecord(raw), next = keyOf(key, record?.setup);
    if (!exact[next] || !valid(exact[next]) || (valid(record) && record.time < exact[next].time)) exact[next] = record;
  }
  for (const [key, raw] of Object.entries(d.routes)) {
    const record = canonicalRecord(raw);
    if (!routes[key] || !valid(routes[key]) || (valid(record) && record.time < routes[key].time)) routes[key] = record;
  }
  return { ...d, exact, routes };
}
function read(st) { try { const d = JSON.parse(st.getItem(STORAGE_KEY) || '{}'); return d?.version === 1 && d.exact && d.routes ? canonicalStore(d) : { version: 1, exact: {}, routes: {} }; } catch { return { version: 1, exact: {}, routes: {} }; } }
const ROUTE_STORAGE_KEY='paraliaki.personalBests.v2';
function readRoutes(st){let d;try{d=JSON.parse(st.getItem(ROUTE_STORAGE_KEY)||'{}');}catch{}if(d?.version!==2||!d.exact||!d.routes||!d.history)d={version:2,exact:{},routes:{},history:{}};
  const legacy=read(st);for(const [key,record]of Object.entries(legacy.exact)){const r=migrateRouteRecord(record,{source:'personal-bests-v1',key});if(r.identity)d.history[r.migration.id]=r;}
  // Event counters are independent from the personal-best index. Keep their original storage keys and all fields.
  if(typeof st.key==='function')for(let i=0;i<st.length;i++){const key=st.key(i);if(!/^paraliaki\.events\.(?:psychiko-(?:race|tt)|penteli-(?:descent-tt|race|tt)|quick|riviera-sprint|tt-riviera)(?:\.|$)/.test(key||'')||/\.[a-f0-9]{64}$/.test(key))continue;try{const record=JSON.parse(st.getItem(key));if(!record||typeof record!=='object')continue;const r=migrateRouteRecord({...record,eventId:key.match(/psychiko-(?:race|tt)|penteli-(?:descent-tt|race|tt)|riviera-sprint|tt-riviera|quick/)[0],mapId:key.includes('psychiko-')?'psychiko':key.includes('penteli-')?'penteli':'riviera'},{source:'event-store',key});if(r.identity)d.history[r.migration.id]=r;}catch{}}
  try{st.setItem(ROUTE_STORAGE_KEY,JSON.stringify(d));}catch{}return d;
}
export function getRouteHistoricalTimes(routeId,st=storage(),{edition=historicalEdition(routeId)}={}){return routeHistory(Object.values(readRoutes(st).history),routeId,{edition});}
const valid = record => record && Number.isFinite(record.time) && record.time > 0;
export function getPersonalBests(setup, st = storage()) {
  const d = setup.routeId?readRoutes(st):read(st), exact = d.exact[exactBestKey(setup)], route = d.routes[routeBestKey(setup)];
  return { exact: valid(exact) ? exact : null, route: valid(route) ? route : null,...(setup.routeId?{history:routeHistory(Object.values(d.history),setup.routeId),historyEdition:historicalEdition(setup.routeId)}:{}) };
}
export function recordPersonalBest(setup, result, st = storage()) {
  const before = getPersonalBests(setup, st);
  if (!result.valid || result.time == null || !Number.isFinite(result.time) || result.time <= 0 || result.busted || result.retired || result.wrecked) return { ...before, newBest: false, delta: null, eligible: false };
  const d = setup.routeId?readRoutes(st):read(st), key = exactBestKey(setup), routeKey = routeBestKey(setup);
  const newBest = !before.exact || result.time < before.exact.time;
  const entry = { time: result.time, car: setup.car, date: result.date || new Date().toISOString(), setup: { ...setup } };
  if (newBest) d.exact[key] = entry;
  if (!before.route || result.time < before.route.time) d.routes[routeKey] = entry;
  let persistent = false;
  try { st.setItem(setup.routeId?ROUTE_STORAGE_KEY:STORAGE_KEY, JSON.stringify(d)); persistent = true; } catch {}
  return { exact: newBest ? entry : before.exact, route: d.routes[routeKey], newBest, delta: before.exact ? result.time - before.exact.time : null, eligible: true, persistent };
}
export function personalBestLabel(pb) {
  return pb?.newBest ? 'NEW PERSONAL BEST' + (pb.delta < 0 ? ` −${Math.abs(pb.delta).toFixed(2)} s` : '') : '';
}

export function getMapPersonalBest(mapId, st = storage()) {
  return Object.values(read(st).routes).filter(r => valid(r) && r.setup?.map === mapId).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

// Exact records contain every setup PB. The route index is a fallback for older stores.
export function listPersonalBests(filters = {}, st = storage()) {
  const legacy=read(st),v2=readRoutes(st),d={exact:{...legacy.exact,...v2.exact},routes:{...legacy.routes,...v2.routes}},records = new Map();
  for (const [key, raw] of Object.entries(d.exact)) {
    if (!valid(raw)) continue;
    let setup = raw.setup;
    if (!setup) { try { const parsed = JSON.parse(key); if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') setup = parsed; } catch {} }
    const entry = { ...raw, ...(setup ? { setup } : {}) };
    records.set(setup ? exactBestKey(setup) : key, entry);
  }
  for (const raw of Object.values(d.routes)) if (valid(raw) && raw.setup && !records.has(exactBestKey(raw.setup))) records.set(exactBestKey(raw.setup), raw);
  return [...records.values()].filter(r => matchesRecord(r, filters)).sort((a, b) => a.time - b.time || String(a.date).localeCompare(String(b.date)));
}
