/** Audio-only profiles. Sample keys name substitutes, never model-exact claims.
 * Layout wins over cylinder count: a Porsche boxer must not become a BMW I6.
 * Cached by immutable catalogue spec; no allocations on the update path.
 */
const profile = (id, synth, sample, cylinders, turbo = false, pops = .12, gain = 1) =>
  Object.freeze({ id, synth, sample, cylinders, turbo, pops, gain, diesel: synth === 'diesel' || synth === 'bus' });
export const ENGINE_PROFILES = Object.freeze({
  turbo3: profile('turbo-i3', 'turbo3', null, 3, true, .35),
  na3: profile('city-i3', 'na3', null, 3, false, 0, .85),
  city4: profile('city-i4', 'city4', 'mini', 4, false, 0, .8),
  na4: profile('na-i4', 'na4', null, 4),
  turbo4: profile('turbo-i4', 'turbo4', 'mini', 4, true, .18),
  diesel: profile('diesel-i4', 'diesel', 'taxi', 4, true, 0, .9),
  van: profile('van-diesel-i4', 'diesel', 'taxi', 4, true, 0, .85),
  bus: profile('bus-diesel-i6', 'bus', null, 6, true, 0, .9),
  na6: profile('na-i6', 'na6', null, 6, false, .18),
  turbo6: profile('turbo-i6', 'turbo6', 'z4', 6, true, .4),
  v6: profile('biturbo-v6', 'v6', null, 6, true, .5),
  v8: profile('biturbo-v8', 'v8', null, 8, true, .6),
  flat6: profile('na-flat6', 'flat6', null, 6, false, .65),
  v10: profile('na-v10', 'v10', null, 10, false, .7),
  v12: profile('na-v12', 'v12', null, 12, false, .65),
  turbo5: profile('turbo-i5', 'turbo5', null, 5, true, .7),
  bike: profile('motorcycle', 'bike', null, 2, false, 0, .65),
  electric: profile('electric', 'electric', null, 0, false, 0, .25),
});
const cache = new WeakMap();
export function engineProfile(spec) {
  if (!spec) return ENGINE_PROFILES.turbo4;
  if (cache.has(spec)) return cache.get(spec);
  const type = String(spec.engine || '').toLowerCase();
  const layout = String(spec.engineLayout || spec.layout || '').toLowerCase();
  let key = type;
  if (spec.electric || type === 'electric') key = 'electric';
  else if (spec.kind === 'bus' || type === 'bus') key = 'bus';
  else if (spec.kind === 'van') key = 'van';
  else if (/flat|boxer/.test(layout)) key = 'flat6';
  else if (/v8/.test(type + layout)) key = 'v8';
  else if (/v6/.test(type + layout)) key = 'v6';
  else if (type === 'na4' && /^(panda|yaris|ibiza|corolla)/.test(spec.id || '')) key = 'city4';
  let selected = ENGINE_PROFILES[key] || ENGINE_PROFILES.turbo4;
  // Sport exhaust calibrations belong to trim IDs, not every turbo commuter.
  if (selected === ENGINE_PROFILES.turbo4 && /jazz_drift|jcw|gti|cupra|_rs|golf_r|gla45|cla35|cla45/.test(spec.id || '')) {
    selected = Object.freeze({ ...selected, id: selected.id + '-sport', pops: .65 });
  }
  cache.set(spec, selected); return selected;
}
const gearboxCache = new WeakMap(), emptySpec = {};
export function gearboxSound(spec, signal) {
  spec ||= emptySpec;
  const cached = gearboxCache.get(spec);
  if (cached && cached.signal === signal) return cached.kind;
  const known = /^(huracan|taxi|octavia|cla|gla)/.test(spec?.id || '') ? 'dct' : /^(z4|cle)/.test(spec?.id || '') ? 'auto' : 'manual';
  const type = String(signal || spec?.powertrain?.gearboxType || spec?.gearboxType || spec?.gearbox || known).toLowerCase();
  const kind = /dct|dsg|pdk|dual/.test(type) ? 'dct' : /auto|^at$|cvt|torque/.test(type) ? 'auto' : 'manual';
  gearboxCache.set(spec, {signal, kind}); return kind;
}
const traffic = {};
for (const [kind, engine, idle, redline] of [
  ['car','turbo4',850,6500], ['taxi','diesel',800,4800], ['van','diesel',800,4500],
  ['truck','diesel',750,3600], ['bus','bus',650,2600], ['police','turbo4',850,6500], ['scooter','bike',1800,8500],
  ['delivery','bike',1800,8500], ['moto','bike',1200,10000], ['police_moto','bike',1200,10000],
  ['electric','electric',800,12000],
]) traffic[kind] = Object.freeze({id: 'traffic-' + kind, kind, engine, idle, redline});
export const TRAFFIC_PROFILES = Object.freeze(traffic);
