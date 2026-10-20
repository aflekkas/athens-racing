// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md, "One car per model (top trim only)"): the catalogue keeps one entry per
// model, its top trim. Every id a removed trim ever had (saved garage choices, personal bests, leaderboard entries, multiplayer
// lobbies and old clients) maps to the kept car of its model. Pure and dependency-free: the browser, the Node server and the
// Cloudflare worker share it. The Honda Jazz drift spec maps to the road trim, never the other way round.
export const LEGACY_CAR_IDS = Object.freeze({
  sl400: 'sl65', sl500: 'sl65', sl63: 'sl65',
  a160: 'a190',
  p928_s4: 'p928', p928_gt: 'p928',
  f348: 'f348_spider', f348_ts: 'f348_spider',
  qashqai_dci: 'qashqai',
  van: 'van_150',
  panda_11: 'panda_100hp', panda: 'panda_100hp',
  jazz: 'jazz_dynamic', jazz_drift: 'jazz_dynamic',
  yaris: 'yaris_ts', yaris_13: 'yaris_ts',
  ibiza: 'ibiza_cupra',
  golf: 'golf_r', golf_gtd: 'golf_r', golf_gti: 'golf_r',
  mini: 'mini_jcw', mini_cooper: 'mini_jcw', mini_s: 'mini_jcw', mini_cabrio_cooper: 'mini_jcw', mini_cabrio_jcw: 'mini_jcw',
  gla: 'gla45', gla250: 'gla45',
  corolla_15: 'corolla',
  taxi: 'octavia_rs', octavia_16tdi: 'octavia_rs',
  superb: 'superb_4x4', superb_15: 'superb_4x4',
  cla: 'cla45s', cla250: 'cla45s', cla35: 'cla45s',
  cle: 'cle53', cle200: 'cle53', cle300e: 'cle53', cle450: 'cle53',
  z4_20i: 'z4', z4_30i: 'z4',
  carrera: 'carrera_gts', carrera_s: 'carrera_gts',
  huracan_rwd: 'huracan',
  gtv1750: 'gtv',
  e36: 'e36_m3', e36_318i: 'e36_m3',
});
/** The car every fresh or unreadable selection (and an unknown multiplayer car) starts from. */
export const DEFAULT_CAR_ID = 'mini_jcw';
/** The kept car for any id: a removed trim maps to its model's top trim; every other value comes back unchanged. `known` (optional
 *  Set) is the catalogue a server actually serves: an id it lists is already a car there and is never rewritten. */
export const canonicalCarId = (id, known) => typeof id === 'string' && !known?.has(id) && Object.hasOwn(LEGACY_CAR_IDS, id) ? LEGACY_CAR_IDS[id] : id;
export const isLegacyCarId = id => typeof id === 'string' && Object.hasOwn(LEGACY_CAR_IDS, id);
