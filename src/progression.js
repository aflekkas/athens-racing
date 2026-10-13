// PROGRESSION: the career economy. Drachma credits (DR) and XP from finished events, driver levels 1-30,
// car unlocks (buy with credits or reach a level), per-car performance upgrades, a performance index (PI) and
// class letter per car + upgrades, and the career ladder (tiers of EVENTS unlocked with medals).
// Pure logic, no DOM or three.js: node can import and test it (tools/progression.test.mjs).
// UI lives in src/progression-ui.js; main.js applies upgrades at its one spec hook (applyDriving -> tunedSpec).
//
//   import * as PROG from './progression.js';
//   PROG.attach(events)            listen to events 'start' / 'score' / 'finish' and pay out (main.js / UI, once)
//   PROG.tunedSpec(spec)           the car spec with this profile's fitted upgrades (a copy; spec is untouched)
//   PROG.canEnter(def, spec)       { ok, reason, code } — locked tier, class restriction, locked car outside Quick Race
//   PROG.onProgress(fn)            fn({ kind: 'award' | 'change' | 'levelup', ... }); returns an unsubscribe
//   PROG.awardOnline({ position, field, raceId })   flat small online payout, deduped per raceId (multiplayer owner calls it)
//
// Profile: localStorage['paraliaki.profile'] = { v, credits, xp, owned: [carId], upgrades: { carId: { cat: { bought, fitted } } },
//   stats: { events, wins, earned, xpEarned }, online: [raceId] (recent, for dedupe), created }
// Level is derived from xp. A car is owned when bought, starter, or the driver level reaches its unlock level.
import { EVENTS, MEDALS, loadRecord } from './events.js';

export const SCHEMA = 1;
export const KEY = 'paraliaki.profile';
export const CURRENCY = 'DR';
export const fmtDR = (n) => `${Math.round(n).toLocaleString('en-US')} ${CURRENCY}`;

// ------------------------------------------------------------------ storage
const memStore = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } };
const defaultStore = () => { try { if (typeof localStorage !== 'undefined') return localStorage; } catch {} return memStore; };

// ------------------------------------------------------------------ cars: price, unlock level, upgrade cost scale
// starter cars cost nothing; unknown (future) cars are treated as starters so new content is never hidden
export const CAR_ECON = {
  mini: { starter: true, costMul: 0.8 },
  taxi: { starter: true, costMul: 0.7 },
  gtv: { starter: true, costMul: 0.75 },
  z4: { price: 16000, level: 8, costMul: 1.1 },
  gr_yaris: { price: 22000, level: 12, costMul: 1.1 },
  carrera: { price: 38000, level: 18, costMul: 1.35 },
};
const carEcon = (id) => CAR_ECON[id] || { starter: true, costMul: 1 };

// ------------------------------------------------------------------ upgrades
// each: 3 stages; mul[i] is the factor at stage i+1. cost[i] (DR) is scaled by the car's costMul.
export const UPGRADES = {
  engine: { label: 'ENGINE', desc: 'ECU map · intake & exhaust · forged internals', stat: 'POWER', mul: [1.06, 1.12, 1.2], cost: [1800, 4200, 8500] },
  tyres: { label: 'TYRES', desc: 'Sport · semi-slick · track compound', stat: 'GRIP', mul: [1.03, 1.06, 1.09], cost: [1200, 2800, 6000] },
  weight: { label: 'WEIGHT', desc: 'Lighter seats · carbon panels · stripped interior', stat: 'MASS', mul: [0.97, 0.94, 0.91], cost: [1500, 3600, 7500] },
  brakes: { label: 'BRAKES', desc: 'Pads & lines · big calipers · carbon-ceramic', stat: 'BRAKE', mul: [1.06, 1.12, 1.18], cost: [900, 2200, 4800] },
  nitro: { label: 'NITRO', desc: 'Bigger bottle: the shot lasts longer', stat: 'N₂O', mul: [1.25, 1.5, 1.8], cost: [1000, 2400, 5000] },
};
export const UPGRADE_KEYS = Object.keys(UPGRADES);
export const MAX_STAGE = 3;
export const upgradeCost = (carId, cat, stage) => Math.round(UPGRADES[cat].cost[stage - 1] * carEcon(carId).costMul / 50) * 50;
const factor = (cat, stage) => (stage > 0 ? UPGRADES[cat].mul[Math.min(MAX_STAGE, stage) - 1] : 1);

/** pure: spec + fitted stages { engine: 0..3, tyres, weight, brakes, nitro } -> a modified copy */
export function applyUpgrades(spec, up = {}) {
  const st = (k) => Math.max(0, Math.min(MAX_STAGE, (up[k] | 0)));
  const out = { ...spec };
  const pm = factor('engine', st('engine'));
  if (pm !== 1) {
    out.powerMul = (spec.powerMul ?? 1) * pm;
    // drag-limited top speed grows with the cube root of power
    out.vmax = Math.round(spec.vmax * Math.cbrt(pm) * 10) / 10;
  }
  out.grip = spec.grip * factor('tyres', st('tyres'));
  out.mass = Math.round(spec.mass * factor('weight', st('weight')));
  out.brake = (spec.brake ?? 1) * factor('brakes', st('brakes'));
  out.nitroCap = (spec.nitroCap ?? 1) * factor('nitro', st('nitro'));
  out.upgrades = Object.fromEntries(UPGRADE_KEYS.map((k) => [k, st(k)]));
  return out;
}
/** physics drains the bottle at 0.2 / s; a bigger bottle (nitroCap) is refunded so the net drain is 0.2 / cap */
export const nitroRefund = (spec) => 0.2 * (1 - 1 / Math.max(1, spec?.nitroCap ?? 1));

// ------------------------------------------------------------------ performance index + class
export const CLASSES = [['D', 0], ['C', 400], ['B', 500], ['A', 600], ['S', 700]];
/** 100..999 from power-to-weight, grip, top speed, brakes, driven axle and nitro (tuned spec in) */
export function perfIndex(spec) {
  const pw = spec.power * (spec.powerMul ?? 1) / (spec.mass / 1000); // kW / t
  const drive = spec.drive === 'awd' ? 20 : spec.drive === 'rwd' ? 5 : 0;
  const pi = 1.6 * pw + 300 * (spec.grip - 1) + 0.9 * (spec.vmax - 200) + 60 * ((spec.brake ?? 1) - 1) + drive + 20 * ((spec.nitroCap ?? 1) - 1) + 195;
  return Math.max(100, Math.min(999, Math.round(pi)));
}
export const classOf = (pi) => { let c = 'D'; for (const [k, min] of CLASSES) if (pi >= min) c = k; return c; };
const classRank = (c) => CLASSES.findIndex(([k]) => k === c);

// ------------------------------------------------------------------ driver level
export const MAX_LEVEL = 30;
/** XP needed to go from level L to L + 1 */
export const xpToNext = (L) => 300 + 120 * (L - 1) + 8 * (L - 1) ** 2;
/** total XP to reach level L */
export function xpForLevel(L) { let t = 0; for (let i = 1; i < Math.min(L, MAX_LEVEL); i++) t += xpToNext(i); return t; }
export function levelFromXp(xp) { let L = 1; while (L < MAX_LEVEL && xp >= xpForLevel(L + 1)) L++; return L; }
/** { level, xp, into (xp into this level), need (xp this level spans), frac } */
export function levelInfo(xp) {
  const level = levelFromXp(xp), base = xpForLevel(level);
  if (level >= MAX_LEVEL) return { level, xp, into: xp - base, need: 0, frac: 1 };
  const need = xpToNext(level);
  return { level, xp, into: xp - base, need, frac: (xp - base) / need };
}
/** what reaching level L gives you */
export function levelReward(L) {
  const unlocks = Object.entries(CAR_ECON).filter(([, e]) => e.level === L).map(([id]) => id);
  return { level: L, credits: 400 + 120 * L, unlocks };
}

// ------------------------------------------------------------------ career ladder
export const TIERS = [
  { id: 'rookie', name: 'ROOKIE', blurb: 'Learn the road. Any car will do.', need: 0, from: null, mul: 1,
    events: ['astir-varkiza', 'harbour-run', 'tt-coast', 'score-beach', 'classic-cup'] },
  { id: 'local', name: 'LOCAL HERO', blurb: 'The regulars take notice. Faster cars, longer runs.', need: 3, from: 'rookie', mul: 1.4,
    events: ['riviera-sprint', 'cliff-sprint', 'hot-hatch', 'tt-reverse', 'score-varkiza', 'cameras-coast', 'pursuit-escape'] },
  { id: 'legend', name: 'RIVIERA LEGEND', blurb: 'The whole coast knows your number plate.', need: 5, from: 'local', mul: 1.9,
    events: ['return-leg', 'tt-riviera', 'tt-night-cliffs', 'cameras-riviera', 'pursuit-survive', 'legend-run'] },
];
/** class limits per event (the events themselves stay class-free in events.js) */
export const RESTRICT = {
  'classic-cup': { maxClass: 'C' },
  'hot-hatch': { maxClass: 'B' },
  'legend-run': { minClass: 'A' },
};
export const restrictLabel = (r) => (!r ? '' : r.maxClass && r.minClass ? `${r.minClass}–${r.maxClass} CLASS` : r.maxClass ? `${r.maxClass} CLASS OR BELOW` : `${r.minClass} CLASS OR ABOVE`);
/** tier of an event id; events nobody placed (new content) count as ROOKIE so they are never hidden */
export function tierOf(id) {
  if (id === 'quick') return null;
  return TIERS.find((t) => t.events.includes(id)) || TIERS[0];
}
function tierEvents(t) {
  const known = new Set(TIERS.flatMap((x) => x.events));
  const ids = EVENTS.map((e) => e.id);
  return t === TIERS[0] ? ids.filter((id) => t.events.includes(id) || !known.has(id)) : ids.filter((id) => t.events.includes(id));
}
function tierMedals(t, st) { let n = 0; const c = { gold: 0, silver: 0, bronze: 0 }; for (const id of tierEvents(t)) { const m = loadRecord(id, st).medal; if (m) { n++; c[m]++; } } return { n, ...c }; }
export function tierUnlocked(t, st = defaultStore()) {
  if (!t.from) return true;
  const prev = TIERS.find((x) => x.id === t.from);
  return tierUnlocked(prev, st) && tierMedals(prev, st).n >= t.need;
}
/** the ladder for the menu: [{ id, name, blurb, unlocked, need, have, from, medals, events: [ids] }] */
export function ladderView(st = defaultStore()) {
  return TIERS.map((t) => {
    const prev = t.from ? TIERS.find((x) => x.id === t.from) : null;
    return { id: t.id, name: t.name, blurb: t.blurb, unlocked: tierUnlocked(t, st), need: t.need, have: prev ? tierMedals(prev, st).n : 0, from: prev?.name || null, medals: tierMedals(t, st), events: tierEvents(t) };
  });
}

// ------------------------------------------------------------------ profile + migration
export function freshProfile(now = Date.now()) {
  return { v: SCHEMA, credits: 2500, xp: 0, owned: Object.keys(CAR_ECON).filter((id) => CAR_ECON[id].starter), upgrades: {}, stats: { events: 0, wins: 0, earned: 0, xpEarned: 0 }, online: [], created: now };
}
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
/** clamp / repair every field, whatever the version */
function sanitize(p) {
  const f = freshProfile(num(p.created, Date.now()));
  const out = { ...f, v: Math.max(SCHEMA, num(p.v, SCHEMA)) };
  out.credits = Math.max(0, Math.floor(num(p.credits)));
  out.xp = Math.max(0, Math.floor(num(p.xp)));
  out.owned = [...new Set([...f.owned, ...(Array.isArray(p.owned) ? p.owned.filter((x) => typeof x === 'string') : [])])];
  out.upgrades = {};
  for (const [car, ups] of Object.entries(p.upgrades && typeof p.upgrades === 'object' ? p.upgrades : {})) {
    const o = {};
    for (const k of UPGRADE_KEYS) {
      const u = ups?.[k]; if (u == null) continue;
      const bought = Math.max(0, Math.min(MAX_STAGE, Math.floor(num(typeof u === 'object' ? u.bought : u))));
      const fitted = Math.max(0, Math.min(bought, Math.floor(num(typeof u === 'object' ? u.fitted : u, bought))));
      if (bought) o[k] = { bought, fitted };
    }
    if (Object.keys(o).length) out.upgrades[car] = o;
  }
  const s = p.stats || {};
  out.stats = { events: Math.max(0, num(s.events)), wins: Math.max(0, num(s.wins)), earned: Math.max(0, num(s.earned)), xpEarned: Math.max(0, num(s.xpEarned)) };
  out.online = Array.isArray(p.online) ? p.online.filter((x) => typeof x === 'string').slice(-200) : [];
  return out;
}
/** version-to-version steps: MIGRATIONS[n] turns a version-n profile into version n + 1 */
export const MIGRATIONS = {
  // v0: the unversioned draft shape { cr, xp, cars: { id: { owned, upg: { engine: n } } } }
  0: (p) => {
    const out = { ...p, v: 1 };
    if (p.cr != null && p.credits == null) out.credits = p.cr;
    if (p.cars && typeof p.cars === 'object') {
      out.owned = Object.entries(p.cars).filter(([, c]) => c?.owned).map(([id]) => id);
      out.upgrades = Object.fromEntries(Object.entries(p.cars).filter(([, c]) => c?.upg).map(([id, c]) => [id, Object.fromEntries(Object.entries(c.upg).map(([k, n]) => [k, { bought: n, fitted: n }]))]));
    }
    delete out.cr; delete out.cars;
    return out;
  },
};
/**
 * anything (null, garbage, an old version, a future version) -> a valid current profile.
 * A brand-new profile is seeded from medals already won before progression existed (retro: { gold, silver, bronze } counts).
 */
export function migrate(raw, retro = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const p = freshProfile();
    if (retro) { const g = retroGrant(retro); p.credits += g.credits; p.xp += g.xp; p.retro = g; }
    return p;
  }
  let p = { ...raw }, v = Number.isFinite(+p.v) ? +p.v : 0;
  while (v < SCHEMA && MIGRATIONS[v]) { p = MIGRATIONS[v](p); v = num(p.v, v + 1); }
  return sanitize(p); // a future version keeps its number (sanitize never downgrades v)
}
/** what medals won before the economy existed are worth (once, on first load) */
export function retroGrant(c) {
  const credits = (c.gold || 0) * ECON.firstMedal.gold + (c.silver || 0) * ECON.firstMedal.silver + (c.bronze || 0) * ECON.firstMedal.bronze;
  const xp = (c.gold || 0) * 400 + (c.silver || 0) * 250 + (c.bronze || 0) * 150;
  return { credits, xp };
}
export function loadProfile(st = defaultStore()) {
  let raw = null, txt = null;
  try { txt = st.getItem(KEY); raw = txt ? JSON.parse(txt) : null; } catch { raw = null; }
  if (raw == null) {
    // first load: credit medals that already sit in the event records
    const c = { gold: 0, silver: 0, bronze: 0 };
    for (const e of EVENTS) { const m = loadRecord(e.id, st).medal; if (m) c[m]++; }
    const p = migrate(txt ? 'corrupt' : null, c.gold + c.silver + c.bronze ? c : null);
    saveProfile(p, st);
    return p;
  }
  const p = migrate(raw);
  if (p.v !== raw.v) saveProfile(p, st);
  return p;
}
export function saveProfile(p, st = defaultStore()) { try { st.setItem(KEY, JSON.stringify(p)); return true; } catch { return false; } }

// ------------------------------------------------------------------ queries on a profile
export const levelOf = (p) => levelFromXp(p.xp);
export function isOwnedIn(p, carId) {
  const e = carEcon(carId);
  return !!(e.starter || p.owned.includes(carId) || (e.level && levelOf(p) >= e.level));
}
export function fittedIn(p, carId) { const u = p.upgrades[carId] || {}; return Object.fromEntries(UPGRADE_KEYS.map((k) => [k, u[k]?.fitted || 0])); }
export function boughtIn(p, carId) { const u = p.upgrades[carId] || {}; return Object.fromEntries(UPGRADE_KEYS.map((k) => [k, u[k]?.bought || 0])); }

// ------------------------------------------------------------------ shop (pure: profile in, { ok, profile, reason } out)
export function buyCarIn(p, carId) {
  const e = carEcon(carId);
  if (isOwnedIn(p, carId)) return { ok: false, profile: p, reason: 'ALREADY IN YOUR GARAGE' };
  if (!e.price) return { ok: false, profile: p, reason: 'NOT FOR SALE' };
  if (p.credits < e.price) return { ok: false, profile: p, reason: `NEED ${fmtDR(e.price - p.credits)} MORE` };
  return { ok: true, profile: { ...p, credits: p.credits - e.price, owned: [...p.owned, carId] }, spent: e.price };
}
export function buyUpgradeIn(p, carId, cat) {
  if (!UPGRADES[cat]) return { ok: false, profile: p, reason: 'UNKNOWN PART' };
  if (!isOwnedIn(p, carId)) return { ok: false, profile: p, reason: 'BUY THE CAR FIRST' };
  const cur = p.upgrades[carId]?.[cat]?.bought || 0;
  if (cur >= MAX_STAGE) return { ok: false, profile: p, reason: 'FULLY UPGRADED' };
  const cost = upgradeCost(carId, cat, cur + 1);
  if (p.credits < cost) return { ok: false, profile: p, reason: `NEED ${fmtDR(cost - p.credits)} MORE` };
  const ups = { ...(p.upgrades[carId] || {}), [cat]: { bought: cur + 1, fitted: cur + 1 } };
  return { ok: true, profile: { ...p, credits: p.credits - cost, upgrades: { ...p.upgrades, [carId]: ups } }, spent: cost, stage: cur + 1 };
}
/** fit any stage you have bought (0 = stock), e.g. to drop under a class limit */
export function fitUpgradeIn(p, carId, cat, stage) {
  const u = p.upgrades[carId]?.[cat];
  const bought = u?.bought || 0;
  if (!UPGRADES[cat] || stage < 0 || stage > bought) return { ok: false, profile: p, reason: 'NOT BOUGHT' };
  const ups = { ...(p.upgrades[carId] || {}), [cat]: { bought, fitted: stage } };
  return { ok: true, profile: { ...p, upgrades: { ...p.upgrades, [carId]: ups } } };
}

// ------------------------------------------------------------------ the economy
export const ECON = {
  base: {
    sprint: { finish: 500, bronze: 900, silver: 1400, gold: 2100 },
    timetrial: { finish: 400, bronze: 800, silver: 1200, gold: 1800 },
    score: { finish: 400, bronze: 800, silver: 1200, gold: 1800 },
    speedtrap: { finish: 400, bronze: 800, silver: 1200, gold: 1800 },
    pursuit: { finish: 600, bronze: 1000, silver: 1500, gold: 2300 },
  },
  xp: { finish: 100, bronze: 150, silver: 250, gold: 400 },
  xpPerKm: 12,
  beaten: 150, beatenXp: 20,      // per rival behind you (sprints)
  styleRate: 1 / 40, styleCap: 1500, styleXpRate: 1 / 100, styleXpCap: 300,
  near: 15,                       // per near miss / oncoming pass
  drift: 0.02,                    // per drift point
  firstMedal: { bronze: 500, silver: 750, gold: 1200 }, firstMedalXp: 100,
  record: 350, recordXp: 50,
  quickMul: 0.8,                  // Quick Race pays like a slightly-discounted rookie event
  testDrive: 0.5,                 // credits share when you race a car you don't own
  online: { finish: 250, beaten: 75, xp: 60, beatenXp: 15 },
};
const NEAR_KINDS = ['near', 'oncoming'];
const r10 = (x) => Math.round(x / 10) * 10;

/**
 * pure: what a finish result is worth. opts = { def, testDrive, counts: { near, driftPts } (from 'score' events) }.
 * Returns null for invalid results. { credits, xp, lines: [{ key, label, credits, xp }], tier, testDrive }
 */
export function computeAward(res, opts = {}) {
  if (!res || res.valid === false) return null;
  const type = res.type, base = ECON.base[type] || ECON.base.sprint;
  const quick = res.eventId === 'quick' || opts.def?.quick;
  const tier = quick ? null : tierOf(res.eventId);
  const mul = quick ? ECON.quickMul : tier?.mul || 1;
  const medal = MEDALS.includes(res.medal) ? res.medal : null;
  const lines = [];
  const add = (key, label, credits, xp = 0) => { if (credits || xp) lines.push({ key, label, credits: r10(credits), xp: Math.round(xp) }); };
  add('base', medal ? `${medal.toUpperCase()} MEDAL` : 'FINISHED', base[medal || 'finish'] * mul, (ECON.xp[medal || 'finish'] + ECON.xpPerKm * (res.distance || 0) / 1000) * mul);
  if (type === 'sprint' || type === 'pursuit') {
    const beaten = Math.max(0, (res.field || 1) - (res.position || 1));
    if (beaten) add('position', `P${res.position} · ${beaten} BEATEN`, ECON.beaten * beaten * mul, ECON.beatenXp * beaten);
  }
  // style: points that aren't near misses / drifts (those get their own lines)
  const bd = res.breakdown || {};
  const nearPts = NEAR_KINDS.reduce((a, k) => a + Math.max(0, bd[k] || 0), 0), driftPts = opts.counts?.driftPts ?? Math.max(0, bd.drift || 0);
  const other = Math.max(0, (res.score || 0) - nearPts - driftPts);
  add('style', `STYLE · ${other.toLocaleString('en-US')} PTS`, Math.min(ECON.styleCap, other * ECON.styleRate), Math.min(ECON.styleXpCap, other * ECON.styleXpRate));
  const near = opts.counts?.near ?? res.nearMisses ?? 0;
  if (near > 0) add('near', `NEAR MISSES × ${near}`, near * ECON.near, near * 2);
  if (driftPts > 0) add('drift', `DRIFT · ${Math.round(driftPts).toLocaleString('en-US')} PTS`, driftPts * ECON.drift, driftPts / 200);
  // first time at a medal tier for this event (saved events only)
  if (res.record && medal) {
    const prev = MEDALS.indexOf(res.prevMedal), now = MEDALS.indexOf(medal);
    let cr = 0, n = 0; for (let i = prev + 1; i <= now; i++) { cr += ECON.firstMedal[MEDALS[i]]; n++; }
    if (cr) add('firstMedal', `FIRST ${medal.toUpperCase()}`, cr, ECON.firstMedalXp * n);
  }
  if (res.record && res.newBest && (res.record.runs || 0) > 1) add('record', 'NEW RECORD', ECON.record, ECON.recordXp);
  let credits = lines.reduce((a, l) => a + l.credits, 0), xp = lines.reduce((a, l) => a + l.xp, 0);
  if (opts.testDrive && credits > 0) { const cut = -r10(credits * (1 - ECON.testDrive)); lines.push({ key: 'testDrive', label: 'TEST DRIVE · LOANER', credits: cut, xp: 0 }); credits += cut; }
  return { credits, xp, lines, tier: tier?.id || (quick ? 'quick' : null), testDrive: !!opts.testDrive, medal };
}

/** pure: bank an award -> { profile, levelUps: [levelReward...] } */
export function applyAward(p, award, extra = {}) {
  if (!award) return { profile: p, levelUps: [] };
  const before = levelOf(p);
  let credits = p.credits + award.credits, xp = p.xp + award.xp;
  const after = levelFromXp(xp), levelUps = [];
  for (let L = before + 1; L <= after; L++) { const r = levelReward(L); levelUps.push(r); credits += r.credits; }
  const stats = { ...p.stats, events: p.stats.events + 1, wins: p.stats.wins + (extra.win ? 1 : 0), earned: p.stats.earned + award.credits + levelUps.reduce((a, r) => a + r.credits, 0), xpEarned: p.stats.xpEarned + award.xp };
  return { profile: { ...p, credits, xp, stats }, levelUps };
}

/** pure: the flat online payout */
export function computeOnline({ position, field }) {
  const pos = Math.max(1, position | 0), n = Math.max(pos, field | 0 || 1), beaten = n - pos, o = ECON.online;
  const lines = [{ key: 'online', label: 'ONLINE FINISH', credits: o.finish, xp: o.xp }];
  if (beaten) lines.push({ key: 'position', label: `P${pos} · ${beaten} BEATEN`, credits: o.beaten * beaten, xp: o.beatenXp * beaten });
  return { credits: lines.reduce((a, l) => a + l.credits, 0), xp: lines.reduce((a, l) => a + l.xp, 0), lines, tier: 'online', medal: null };
}

// ------------------------------------------------------------------ live state (browser / tests with a store)
let ST = null, P = null;
const subs = new Set();
const emit = (e) => { for (const fn of [...subs]) { try { fn(e); } catch (err) { console.error('[progression]', err); } } };
export function onProgress(fn) { subs.add(fn); return () => subs.delete(fn); }
/** swap the backing store (tests); resets the cached profile */
export function useStore(st) { ST = st; P = null; awards = new WeakMap(); lastAward = null; }
export function getProfile() { if (!P) P = loadProfile(ST || defaultStore()); return P; }
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key !== KEY || ST) return;
  P = loadProfile(defaultStore()); emit({ kind: 'external', profile: P });
});
function commit(p, kind = 'change', extra = {}) { P = p; saveProfile(p, ST || defaultStore()); emit({ kind, profile: p, ...extra }); }
export const level = () => levelOf(getProfile());
export const isOwned = (carId) => isOwnedIn(getProfile(), carId);
export const fitted = (carId) => fittedIn(getProfile(), carId);
export const bought = (carId) => boughtIn(getProfile(), carId);
export const tunedSpec = (spec) => applyUpgrades(spec, fittedIn(getProfile(), spec.id));
export function carInfo(spec) {
  const p = getProfile(), e = carEcon(spec.id), t = tunedSpec(spec), pi = perfIndex(t), stockPi = perfIndex(applyUpgrades(spec, {}));
  return { id: spec.id, owned: isOwnedIn(p, spec.id), price: e.price || 0, unlockLevel: e.level || 0, level: levelOf(p), credits: p.credits, pi, cls: classOf(pi), stockPi, stockCls: classOf(stockPi), tuned: t, fitted: fittedIn(p, spec.id), bought: boughtIn(p, spec.id) };
}
const shop = (r, kind, extra) => { if (r.ok) commit(r.profile, kind, extra); return r; };
export const buyCar = (carId) => shop(buyCarIn(getProfile(), carId), 'buy', { carId });
export const buyUpgrade = (carId, cat) => shop(buyUpgradeIn(getProfile(), carId, cat), 'upgrade', { carId, cat });
export const fitUpgrade = (carId, cat, stage) => shop(fitUpgradeIn(getProfile(), carId, cat, stage), 'fit', { carId, cat });

/** can this car (spec, as it would be built) enter this event? { ok, reason, code } */
export function canEnter(def, spec, st = ST || defaultStore()) {
  if (!def) return { ok: false, reason: 'NO SUCH EVENT', code: 'event' };
  const quick = def.quick || def.id === 'quick';
  const forced = !!def.car; // the event hands you its own car
  if (!quick) {
    const t = tierOf(def.id);
    if (t && !tierUnlocked(t, st)) { const v = ladderView(st).find((x) => x.id === t.id); return { ok: false, code: 'tier', reason: `${t.name} LOCKED · ${Math.max(0, v.need - v.have)} MORE ${v.from} MEDAL${v.need - v.have === 1 ? '' : 'S'}` }; }
  }
  if (spec && !forced && !isOwned(spec.id) && !quick) return { ok: false, code: 'car', reason: `${spec.short || spec.name} IS LOCKED · TEST DRIVES IN QUICK RACE ONLY` };
  const rs = RESTRICT[def.id];
  if (rs && spec && !forced) {
    const pi = perfIndex(tunedSpec(spec)), c = classOf(pi), r = classRank(c);
    if ((rs.maxClass && r > classRank(rs.maxClass)) || (rs.minClass && r < classRank(rs.minClass))) return { ok: false, code: 'class', reason: `${restrictLabel(rs)} · YOUR ${spec.short || spec.name} IS ${c} ${pi}` };
  }
  return { ok: true, reason: '', code: '' };
}
/** menu view data for one event: tier, lock and class state for your current car */
export function eventInfo(id, spec, st = ST || defaultStore()) {
  const def = EVENTS.find((e) => e.id === id) || (id === 'quick' ? { id, quick: true } : null);
  const t = tierOf(id), rs = RESTRICT[id] || null, gate = canEnter(def, spec, st);
  const pi = spec ? perfIndex(tunedSpec(spec)) : 0;
  return { id, tier: t ? { id: t.id, name: t.name } : null, restrict: rs, restrictLabel: restrictLabel(rs), gate, locked: !gate.ok, pi, cls: classOf(pi) };
}

// ------------------------------------------------------------------ wiring to the events hooks
let awards = new WeakMap(), lastAward = null, attached = null;
const tally = { eventId: null, near: 0, driftPts: 0 };
/** award for a finish result (the object events emitted) */
export const awardFor = (res) => (res && awards.get(res)) || null;
export const getLastAward = () => lastAward;
/** grant a finish result to the live profile (attach() calls it); returns { award, levelUps } or null */
export function grant(res, opts = {}) {
  if (!res || res.valid === false) return null;
  if (awards.has(res)) return awards.get(res);
  const counts = tally.eventId === res.eventId ? { near: tally.near, driftPts: tally.driftPts } : null;
  const testDrive = opts.testDrive ?? (res.car ? !isOwned(res.car) : false);
  const award = computeAward(res, { counts, testDrive, def: opts.def });
  if (!award) return null;
  const { profile, levelUps } = applyAward(getProfile(), award, { win: res.type === 'sprint' ? res.position === 1 : res.medal === 'gold' });
  const out = { award, levelUps, level: levelOf(profile), before: levelOf(getProfile()) };
  awards.set(res, out); lastAward = { res, ...out };
  commit(profile, 'award', out);
  for (const r of levelUps) emit({ kind: 'levelup', profile, ...r });
  return out;
}
/** subscribe to the events hook API once; returns a detach function */
export function attach(ev) {
  if (attached) return attached;
  const offs = [
    ev.on('start', (e) => { tally.eventId = e.eventId; tally.near = 0; tally.driftPts = 0; }),
    ev.on('score', (e) => { if (e.eventId !== tally.eventId) return; if (NEAR_KINDS.includes(e.kind) && e.pts > 0) tally.near++; else if (e.kind === 'drift' && e.pts > 0) tally.driftPts += e.pts; }),
    ev.on('finish', (res) => { try { grant(res); } catch (err) { console.error('[progression] award failed', err); } }),
    ev.on('abort', () => { tally.eventId = null; }),
  ];
  attached = () => { offs.forEach((f) => f()); attached = null; };
  return attached;
}
/** online: a flat small payout, paid at most once per raceId (persisted). Call only for a real finish (no DNF). */
export function awardOnline({ position, field, raceId } = {}) {
  if (!raceId || !Number.isFinite(+position) || +position < 1) return null;
  // A resumed/duplicated tab may have cached its profile before another tab paid this race.
  const id = String(raceId), p = loadProfile(ST || defaultStore()); P = p;
  if (p.online.includes(id)) return null;
  const award = computeOnline({ position: +position, field: +field });
  const { profile, levelUps } = applyAward(p, award, { win: +position === 1 });
  profile.online = [...p.online, id].slice(-200);
  const out = { award, levelUps, level: levelOf(profile), before: levelOf(p), raceId: id };
  lastAward = { res: null, ...out };
  commit(profile, 'award', out);
  for (const r of levelUps) emit({ kind: 'levelup', profile, ...r });
  return out;
}

if (typeof window !== 'undefined') window.__progression = { getProfile, awardOnline, carInfo, buyCar, buyUpgrade, fitUpgrade, ladderView, canEnter };
