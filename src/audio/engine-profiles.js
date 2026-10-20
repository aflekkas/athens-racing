/** Audio-only profiles. Sample keys name substitutes, never model-exact claims.
 * Layout wins over cylinder count: a Porsche boxer must not become a BMW I6.
 * Cached by immutable catalogue spec; no allocations on the update path.
 */
// tone scales the recorded voice's low-pass: families that share a recording get a different brightness.
const profile = (id, synth, sample, cylinders, turbo = false, pops = .12, gain = 1, tone = 1) =>
  Object.freeze({ id, synth, sample, cylinders, turbo, pops, gain, tone, diesel: ['diesel','bus','truck'].includes(synth) });
export const ENGINE_PROFILES = Object.freeze({
  v8flat: profile('na-flat-plane-v8','v8flat','ferrari',8,false,.12,.82),
  v8na: profile('na-cross-plane-v8','v8na','cross',8,false,.08,.9),
  turbov6: profile('sl-biturbo-v6','v6',null,6,true,.24),
  turbov8: profile('sl-biturbo-v8','v8',null,8,true,.35),
  turbov12: profile('sl-biturbo-v12','v12','v12',12,true,.28,.9),
  turbo3: profile('turbo-i3', 'turbo3', null, 3, true, .35),
  na3: profile('city-i3', 'na3', null, 3, false, 0, .85),
  city4: profile('city-i4', 'city4', null, 4, false, 0, .8),
  na4: profile('na-i4', 'na4', null, 4, false, 0, .72),
  turbo4: profile('turbo-i4', 'turbo4', 'mini', 4, true, .18),
  // Hot, mainstream and small turbo fours each take their own recording (Focus RS, Abarth 595) rather than the MINI's.
  hot4: profile('hot-turbo-i4', 'turbo4', 'focus', 4, true, .65),
  comfort4: profile('comfort-turbo-i4', 'turbo4', 'focus', 4, true, .1, .86, .5),
  small4: profile('small-turbo-i4', 'turbo4', 'abarth', 4, true, .6, .95),
  fiat4: profile('fiat-i4', 'city4', null, 4, false, 0, .76, .85),
  diesel: profile('diesel-i4', 'diesel', 'taxi', 4, true, 0, .9),
  van: profile('van-diesel-i4', 'diesel', 'taxi', 4, true, 0, .85),
  bus: profile('bus-diesel-i6', 'bus', null, 6, true, 0, .9),
  truck: profile('truck-diesel-i4', 'truck', null, 4, true, 0, .85),
  na6: profile('na-i6', 'na6', null, 6, false, .18, .58),
  turbo6: profile('turbo-i6', 'turbo6', 'z4', 6, true, .4),
  v6: profile('biturbo-v6', 'v6', null, 6, true, .5),
  v8: profile('biturbo-v8', 'v8', null, 8, true, .6),
  flat6: profile('na-flat6', 'flat6', 'flat6', 6, false, .65, 1, .6),
  v10: profile('na-v10', 'v10', null, 10, false, .7),
  v12: profile('na-v12', 'v12', 'v12', 12, false, .65),
  turbo5: profile('turbo-i5', 'turbo5', null, 5, true, .7),
  bike: profile('motorcycle', 'bike', null, 2, false, 0, .65),
  electric: profile('electric', 'electric', null, 0, false, 0, .25),
});
const SVJ_PROFILE=profile('aventador-svj-v12','v12','v12',12,false,0,.92);
// Acoustic calibrations, not claimed model-exact recordings. Gain does not change pitch.
// growl = loaded 180–500 Hz body, intake = induction strength, rough = pulse variance.
// Commuters have no theatrical exhaust crackle; G16E is a triple, M139 a four, M256 a six.
const CAR_VOICES = Object.freeze({
  sl65: {tone:.56,growl:5.5,body:180,intake:.55,pops:.18,gain:.88},
  a190: {sample:null,tone:.62,growl:1.5,body:280,intake:.45,gain:.58},
  p928: {tone:.82,growl:4.5,body:190,intake:.8},
  f348_spider: {tone:1.06,growl:3,body:330,intake:1.1},
  aygo: {tone:.9,growl:1.2,body:340,intake:.6,gain:.55,rough:.06},
  qashqai: {tone:.48,growl:1.5,body:210,intake:.4,pops:0,gain:.73},
  dolphin: {gain:.55,motorOrder:8},
  atto3: {gain:.49,motorOrder:7.8},
  van_150: {tone:.72,growl:3.5,body:150,intake:.35,gain:.85},
  truck: {tone:.7,growl:4,body:105,intake:.3,rough:.055},
  bus: {tone:.7,growl:4.5,body:95,intake:.25,rough:.035},
  police_octavia: {tone:.58,growl:2.2,body:240,intake:.55,pops:0,gain:.76},
  panda_100hp: {growl:2.5,body:310,intake:.95},
  jazz_dynamic: {sample:null,tone:1.05,growl:2,body:380,intake:1.1,gain:.68},
  yaris_ts: {sample:null,tone:.92,growl:2.6,body:300,intake:.85,gain:.7},
  ibiza_cupra: {tone:.7,growl:4,body:200,intake:.65,pops:.08},
  golf_r: {tone:.88,growl:4,body:230,intake:.75,pops:.3},
  mini_jcw: {tone:.92,growl:4.5,body:250,intake:.9,pops:.55},
  gr_yaris: {tone:.82,growl:4,body:190,intake:.85,pops:.12,gain:.83,rough:.07},
  corolla: {sample:null,tone:.67,growl:1.7,body:290,intake:.55,gain:.62},
  octavia_rs: {tone:.82,growl:3.3,body:220,intake:.7,pops:.18,gain:.92},
  superb_4x4: {tone:.48,growl:2.5,body:180,intake:.4,pops:0,gain:.72},
  gla45: {tone:1,growl:4.7,body:285,intake:.9,pops:.45},
  cla45s: {tone:1.04,growl:4.5,body:300,intake:.95,pops:.48},
  cle53: {tone:.78,growl:4.2,body:210,intake:.75,pops:.24},
  z4: {tone:.94,growl:4.6,body:250,intake:.95,pops:.45},
  carrera_gts: {tone:1.12,growl:3.5,body:340,intake:1.15,pops:.32},
  aventador_svj: {tone:1.04,growl:3,body:390,intake:.9,pops:0},
  huracan: {tone:1.1,growl:3.6,body:350,intake:1.05,pops:.42,gain:.86,rough:.022},
  gtv: {sample:null,tone:1.12,growl:4,body:300,intake:1.35,pops:.08,gain:.82},
  e36_m3: {tone:1.08,growl:3.8,body:320,intake:1.2,gain:.83,pops:.08,rough:.02},
});
const cache = new WeakMap();
export function engineProfile(spec) {
  if (!spec) return ENGINE_PROFILES.turbo4;
  if (cache.has(spec)) return cache.get(spec);
  const type = String(spec.engine || '').toLowerCase();
  const layout = String(spec.engineLayout || spec.layout || '').toLowerCase();
  let key = type;
  if (spec.electric || type === 'electric') key = 'electric';
  else if (spec.kind === 'bus' || spec.nativeFleet === 'bus' || type === 'bus') key = 'bus';
  else if (spec.kind === 'truck' || spec.nativeFleet === 'truck') key = 'truck';
  else if (spec.kind === 'van' || spec.nativeFleet === 'van') key = 'van';
  else if (/flat[- ]?6|boxer/.test(layout)) key = 'flat6';
  else if (['v8flat','v8na','turbov6','turbov8','turbov12'].includes(type)) key = type;
  else if (/v8/.test(type + layout)) key = 'v8';
  else if (/v6/.test(type + layout)) key = 'v6';
  else if (type === 'na4' && /^panda/.test(spec.id || '')) key = 'fiat4';
  else if (type === 'na4' && /^(yaris|ibiza|corolla)/.test(spec.id || '')) key = 'city4';
  else if (type === 'turbo4') {
    const id = spec.id || '';
    // MINI Cooper S and the B48 Z4s keep the MINI recording; AMG/GTI/RS trims get the Focus RS; the Cupra and Jazz drift car the Abarth.
    if (/^(mini|z4)/.test(id)) key = 'turbo4';
    else if (/gla45|cla35|cla45|golf_r|golf_gti|octavia_rs/.test(id)) key = 'hot4';
    else if (/ibiza_cupra/.test(id)) key = 'small4';
    else key = 'comfort4';
  }
  let selected = ENGINE_PROFILES[key] || ENGINE_PROFILES.turbo4;
  // Sport exhaust calibrations belong to trim IDs, not every turbo commuter.
  if ((selected === ENGINE_PROFILES.turbo4 || selected === ENGINE_PROFILES.small4) && /jcw|gti|cupra|_rs|golf_r|gla45|cla35|cla45/.test(spec.id || '')) {
    selected = Object.freeze({ ...selected, id: selected.id + '-sport', pops: .65 });
  }
  if (spec.id === 'aventador_svj') selected = SVJ_PROFILE;
  if (CAR_VOICES[spec.id]) selected = Object.freeze({growl:2.5,body:240,intake:.7,...selected,...CAR_VOICES[spec.id],
    diesel:['diesel','bus','truck'].includes(selected.synth)});
  cache.set(spec, selected); return selected;
}
const gearboxCache = new WeakMap(), emptySpec = {};
// Motor pitch follows wheel speed and the fixed reduction. The generic vehicle
// clutch model can report free-rev RPM while an EV is stopped; that is not a motor sound.
export function electricMotorRpm(spec,speed) {
  return Math.max(0,speed)/(spec?.wheelR||.32)*60/(2*Math.PI)*(spec?.gears?.[0]||1)*(spec?.final||9);
}
export function gearboxSound(spec, signal) {
  spec ||= emptySpec;
  const cached = gearboxCache.get(spec);
  if (cached && cached.signal === signal) return cached.kind;
  const known = /^(huracan|taxi|octavia|cla|gla)/.test(spec?.id || '') ? 'dct' : /^(z4|cle)/.test(spec?.id || '') ? 'auto' : 'manual';
  const type = String(signal || spec?.powertrain?.gearboxType || spec?.gearboxType || spec?.gearbox || known).toLowerCase();
  const kind = /amt|isr/.test(type) ? 'amt' : /dct|dsg|pdk|dual/.test(type) ? 'dct' : /auto|^at$|cvt|torque/.test(type) ? 'auto' : 'manual';
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
