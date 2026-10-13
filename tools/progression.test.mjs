// node --test tools/progression.test.mjs   (pure logic: payouts, levels, purchases, upgrade spec math, save migration)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/progression.js';
import { events, EVENTS } from '../src/events.js';

const mem = () => ({ m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); } });
const SPEC = { id: 'z4', short: 'Z4', mass: 1610, power: 250, torque: 500, vmax: 250, grip: 1.18, brake: 1.12, drive: 'rwd' };
const MINI = { id: 'mini', short: 'MINI', mass: 1320, power: 141, torque: 280, vmax: 230, grip: 1.08, brake: 1.0, drive: 'fwd' };
const res = (o = {}) => ({ eventId: 'astir-varkiza', type: 'sprint', car: 'mini', time: 120, position: 1, field: 4, score: 0, medal: 'gold', breakdown: {}, distance: 4077, valid: true, record: { runs: 1 }, newBest: true, prevMedal: null, ...o });

test('invalid results pay nothing', () => {
  assert.equal(P.computeAward(res({ valid: false })), null);
  assert.equal(P.computeAward(null), null);
  P.useStore(mem());
  assert.equal(P.grant(res({ valid: false })), null);
  assert.equal(P.getProfile().credits, 2500);
});

test('base payout by type and medal, position bonus, tier multiplier', () => {
  const a = P.computeAward(res({ record: null }));
  const line = (aw, k) => aw.lines.find((l) => l.key === k);
  assert.equal(line(a, 'base').credits, P.ECON.base.sprint.gold);
  assert.equal(line(a, 'position').credits, 3 * P.ECON.beaten);
  const silver = P.computeAward(res({ medal: 'silver', position: 2, record: null }));
  assert.ok(line(silver, 'base').credits < line(a, 'base').credits);
  assert.equal(line(silver, 'position').credits, 2 * P.ECON.beaten);
  const none = P.computeAward(res({ medal: null, position: 4, record: null }));
  assert.equal(line(none, 'base').credits, P.ECON.base.sprint.finish);
  assert.equal(line(none, 'position'), undefined);
  // a LOCAL HERO event pays 1.4x
  const local = P.computeAward(res({ eventId: 'cliff-sprint', record: null }));
  assert.equal(line(local, 'base').credits, Math.round(P.ECON.base.sprint.gold * 1.4 / 10) * 10);
  assert.equal(local.tier, 'local');
  // time trial: no position bonus, its own table
  const tt = P.computeAward(res({ eventId: 'tt-coast', type: 'timetrial', field: 1, record: null }));
  assert.equal(line(tt, 'base').credits, P.ECON.base.timetrial.gold);
  assert.equal(line(tt, 'position'), undefined);
  // quick race at a discount
  const q = P.computeAward(res({ eventId: 'quick', record: null }));
  assert.equal(line(q, 'base').credits, P.ECON.base.sprint.gold * P.ECON.quickMul);
  assert.equal(a.credits, a.lines.reduce((s, l) => s + l.credits, 0));
  assert.ok(a.xp > 0);
});

test('style, near-miss and drift payouts do not double count', () => {
  const a = P.computeAward(res({ score: 3000, breakdown: { near: 1000, drift: 1200, overtake: 800 }, record: null }), { counts: { near: 10, driftPts: 1200 } });
  const line = (k) => a.lines.find((l) => l.key === k);
  assert.equal(line('style').credits, Math.round(800 * P.ECON.styleRate / 10) * 10); // only the 800 non-near / non-drift points
  assert.equal(line('near').credits, 10 * P.ECON.near);
  assert.equal(line('drift').credits, Math.round(1200 * P.ECON.drift / 10) * 10);
  // style cap
  const big = P.computeAward(res({ score: 1e7, record: null }));
  assert.equal(big.lines.find((l) => l.key === 'style').credits, P.ECON.styleCap);
});

test('first-medal bonus covers each newly reached tier; record bonus only after the first run', () => {
  const line = (aw, k) => aw.lines.find((l) => l.key === k);
  const first = P.computeAward(res({ prevMedal: null, medal: 'gold', record: { runs: 1 }, newBest: true }));
  assert.equal(line(first, 'firstMedal').credits, P.ECON.firstMedal.bronze + P.ECON.firstMedal.silver + P.ECON.firstMedal.gold);
  assert.equal(line(first, 'record'), undefined, 'the first run is not a "new record"');
  const up = P.computeAward(res({ prevMedal: 'bronze', medal: 'gold', record: { runs: 3 }, newBest: true }));
  assert.equal(line(up, 'firstMedal').credits, P.ECON.firstMedal.silver + P.ECON.firstMedal.gold);
  assert.equal(line(up, 'record').credits, P.ECON.record);
  const same = P.computeAward(res({ prevMedal: 'gold', medal: 'gold', record: { runs: 4 }, newBest: false }));
  assert.equal(line(same, 'firstMedal'), undefined);
  assert.equal(line(same, 'record'), undefined);
});

test('test drives (car not owned) pay half the credits, full XP', () => {
  const full = P.computeAward(res({ eventId: 'quick', record: null }));
  const td = P.computeAward(res({ eventId: 'quick', record: null }), { testDrive: true });
  assert.equal(td.credits, full.credits - Math.round(full.credits * 0.5 / 10) * 10);
  assert.equal(td.xp, full.xp);
});

test('levels: thresholds, 1..30, rewards, level-ups on award', () => {
  assert.equal(P.levelFromXp(0), 1);
  assert.equal(P.levelFromXp(P.xpForLevel(2) - 1), 1);
  assert.equal(P.levelFromXp(P.xpForLevel(2)), 2);
  assert.equal(P.levelFromXp(1e12), 30);
  for (let L = 1; L < 29; L++) assert.ok(P.xpToNext(L + 1) > P.xpToNext(L));
  assert.equal(P.levelInfo(1e12).frac, 1);
  assert.deepEqual(P.levelReward(8).unlocks, ['z4']);
  const p = P.freshProfile();
  const { profile, levelUps } = P.applyAward(p, { credits: 100, xp: P.xpForLevel(4) });
  assert.deepEqual(levelUps.map((r) => r.level), [2, 3, 4]);
  assert.equal(profile.credits, p.credits + 100 + levelUps.reduce((a, r) => a + r.credits, 0));
  assert.equal(P.levelOf(profile), 4);
});

test('cars: starters owned, buy with credits, unlock by level', () => {
  let p = P.freshProfile();
  for (const id of ['mini', 'taxi', 'gtv']) assert.ok(P.isOwnedIn(p, id));
  for (const id of ['z4', 'gr_yaris', 'carrera']) assert.ok(!P.isOwnedIn(p, id));
  assert.ok(P.isOwnedIn(p, 'some_future_car'), 'unknown cars are never locked');
  let r = P.buyCarIn(p, 'z4'); assert.equal(r.ok, false); assert.match(r.reason, /MORE/);
  p = { ...p, credits: 20000 };
  r = P.buyCarIn(p, 'z4'); assert.ok(r.ok); assert.equal(r.profile.credits, 4000); assert.ok(P.isOwnedIn(r.profile, 'z4'));
  assert.equal(P.buyCarIn(r.profile, 'z4').ok, false);
  const lv = { ...P.freshProfile(), xp: P.xpForLevel(12) };
  assert.ok(P.isOwnedIn(lv, 'z4') && P.isOwnedIn(lv, 'gr_yaris') && !P.isOwnedIn(lv, 'carrera'));
});

test('upgrades: buy stages in order with rising cost, refit lower stages, cannot upgrade a locked car', () => {
  let p = { ...P.freshProfile(), credits: 100000 };
  assert.equal(P.buyUpgradeIn(p, 'z4', 'engine').ok, false);
  const costs = [1, 2, 3].map((s) => P.upgradeCost('mini', 'engine', s));
  assert.ok(costs[0] < costs[1] && costs[1] < costs[2]);
  for (let s = 1; s <= 3; s++) { const r = P.buyUpgradeIn(p, 'mini', 'engine'); assert.ok(r.ok); assert.equal(r.spent, costs[s - 1]); p = r.profile; }
  assert.equal(P.buyUpgradeIn(p, 'mini', 'engine').ok, false);
  assert.equal(p.credits, 100000 - costs.reduce((a, b) => a + b, 0));
  assert.equal(P.fittedIn(p, 'mini').engine, 3);
  p = P.fitUpgradeIn(p, 'mini', 'engine', 1).profile;
  assert.equal(P.fittedIn(p, 'mini').engine, 1); assert.equal(P.boughtIn(p, 'mini').engine, 3);
  assert.equal(P.fitUpgradeIn(p, 'mini', 'tyres', 1).ok, false);
});

test('applyUpgrades: pure copy, stage maths, PI and class rise', () => {
  const frozen = Object.freeze({ ...SPEC });
  const s0 = P.applyUpgrades(frozen, {});
  assert.notEqual(s0, frozen);
  assert.equal(s0.mass, SPEC.mass); assert.equal(s0.grip, SPEC.grip); assert.equal(s0.vmax, SPEC.vmax); assert.equal(s0.powerMul, undefined);
  const s = P.applyUpgrades(frozen, { engine: 3, tyres: 2, weight: 1, brakes: 3, nitro: 2, bogus: 9 });
  assert.equal(s.powerMul, 1.2);
  assert.ok(Math.abs(s.vmax - 250 * Math.cbrt(1.2)) < 0.1);
  assert.ok(Math.abs(s.grip - 1.18 * 1.06) < 1e-9);
  assert.equal(s.mass, Math.round(1610 * 0.97));
  assert.ok(Math.abs(s.brake - 1.12 * 1.18) < 1e-9);
  assert.equal(s.nitroCap, 1.5);
  assert.equal(s.bogus, undefined);
  assert.equal(P.applyUpgrades(frozen, { engine: 99 }).powerMul, 1.2, 'stages clamp to 3');
  assert.ok(P.perfIndex(s) > P.perfIndex(s0));
  assert.equal(P.classOf(399), 'D'); assert.equal(P.classOf(400), 'C'); assert.equal(P.classOf(700), 'S');
  assert.ok(Math.abs(P.nitroRefund({ nitroCap: 2 }) - 0.1) < 1e-12); assert.equal(P.nitroRefund({}), 0);
});

test('save migration: missing, corrupt, unversioned v0, junk fields, future version', () => {
  const st = mem();
  const fresh = P.loadProfile(st);
  assert.equal(fresh.v, P.SCHEMA); assert.equal(fresh.credits, 2500);
  assert.ok(st.getItem(P.KEY), 'a fresh profile is saved');
  st.setItem(P.KEY, '{not json'); assert.equal(P.loadProfile(st).credits, 2500);
  // v0 draft shape
  const m = P.migrate({ cr: 5000, xp: 900, cars: { z4: { owned: true, upg: { engine: 2 } } } });
  assert.equal(m.v, 1); assert.equal(m.credits, 5000); assert.ok(m.owned.includes('z4') && m.owned.includes('mini'));
  assert.deepEqual(m.upgrades.z4.engine, { bought: 2, fitted: 2 });
  // junk is repaired
  const j = P.migrate({ v: 1, credits: -50, xp: 'x', owned: 'all', upgrades: { mini: { engine: { bought: 7, fitted: 9 }, turbo: 3 } }, online: [1, 'a'] });
  assert.equal(j.credits, 0); assert.equal(j.xp, 0); assert.deepEqual(j.upgrades.mini, { engine: { bought: 3, fitted: 3 } }); assert.deepEqual(j.online, ['a']);
  // a newer save is not downgraded
  assert.equal(P.migrate({ v: 5, credits: 10 }).v, 5);
  // medals won before progression existed are credited once
  const st2 = mem(); st2.setItem('paraliaki.events.astir-varkiza', JSON.stringify({ medal: 'gold', runs: 2 }));
  const p2 = P.loadProfile(st2);
  assert.equal(p2.credits, 2500 + P.ECON.firstMedal.gold);
  assert.equal(P.loadProfile(st2).credits, p2.credits, 'retro grant only once');
});

test('ladder: tiers unlock with medals, class restrictions, locked cars outside Quick Race', () => {
  const st = mem(); P.useStore(st);
  const known = new Set(P.TIERS.flatMap((t) => t.events));
  for (const id of known) assert.ok(EVENTS.some((e) => e.id === id), 'tier event exists: ' + id);
  const local = EVENTS.find((e) => e.id === 'cliff-sprint');
  let g = P.canEnter(local, MINI, st); assert.equal(g.ok, false); assert.equal(g.code, 'tier');
  for (const id of ['astir-varkiza', 'harbour-run', 'tt-coast']) st.setItem('paraliaki.events.' + id, JSON.stringify({ medal: 'bronze' }));
  assert.ok(P.canEnter(local, MINI, st).ok);
  assert.equal(P.ladderView(st).find((t) => t.id === 'local').unlocked, true);
  assert.equal(P.ladderView(st).find((t) => t.id === 'legend').unlocked, false);
  // locked car: only Quick Race
  g = P.canEnter(local, SPEC, st); assert.equal(g.code, 'car');
  assert.ok(P.canEnter({ id: 'quick', quick: true }, SPEC, st).ok);
  // class cap: classic cup is C or below; the Z4 (B) is too quick even once owned
  const cup = EVENTS.find((e) => e.id === 'classic-cup');
  assert.ok(P.canEnter(cup, MINI, st).ok);
  P.useStore(st); const p = P.getProfile(); p.owned.push('z4');
  g = P.canEnter(cup, SPEC, st); assert.equal(g.code, 'class'); assert.match(g.reason, /C CLASS OR BELOW/);
  P.useStore(mem());
});

test('event hooks: score tally feeds the near / drift lines; one award per result', () => {
  const st = mem(); P.useStore(st);
  const off = P.attach(events);
  const seen = [];
  const unsub = P.onProgress((e) => seen.push(e.kind));
  events.emit('start', { eventId: 'astir-varkiza' });
  events.emit('score', { eventId: 'astir-varkiza', kind: 'near', pts: 100 });
  events.emit('score', { eventId: 'astir-varkiza', kind: 'oncoming', pts: 200 });
  events.emit('score', { eventId: 'astir-varkiza', kind: 'drift', pts: 500 });
  const r = res({ score: 800, breakdown: { near: 100, oncoming: 200, drift: 500 } });
  events.emit('finish', r);
  events.emit('finish', r); // the same result again: not paid twice
  const a = P.awardFor(r);
  assert.ok(a);
  assert.equal(a.award.lines.find((l) => l.key === 'near').credits, 2 * P.ECON.near);
  assert.equal(P.getProfile().credits, 2500 + a.award.credits + a.levelUps.reduce((s, l) => s + l.credits, 0));
  assert.equal(seen.filter((k) => k === 'award').length, 1);
  events.emit('finish', res({ valid: false }));
  assert.equal(seen.filter((k) => k === 'award').length, 1);
  assert.equal(JSON.parse(st.getItem(P.KEY)).credits, P.getProfile().credits, 'persisted');
  unsub(); off(); P.useStore(mem());
});

test('online: flat payout, deduped per raceId across reloads, no DNF / missing id', () => {
  const st = mem(); P.useStore(st);
  assert.equal(P.awardOnline({ position: 2, field: 4 }), null, 'no raceId, no pay');
  assert.equal(P.awardOnline({ position: null, field: 4, raceId: 'x' }), null, 'DNF');
  const a = P.awardOnline({ position: 2, field: 4, raceId: 'lobby1:race7' });
  assert.equal(a.award.credits, P.ECON.online.finish + 2 * P.ECON.online.beaten);
  assert.equal(P.awardOnline({ position: 2, field: 4, raceId: 'lobby1:race7' }), null);
  P.useStore(st); // a reload: fresh module state, same storage
  assert.equal(P.awardOnline({ position: 1, field: 4, raceId: 'lobby1:race7' }), null);
  assert.ok(P.awardOnline({ position: 1, field: 4, raceId: 'lobby1:race8' }));
  P.useStore(mem());
});

test('a stale second tab cannot repay an online race or overwrite newer earnings', async () => {
  const A = await import('../src/progression.js?online-tab-a');
  const B = await import('../src/progression.js?online-tab-b');
  const values = new Map(), shared = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  A.useStore(shared); B.useStore(shared); A.getProfile(); B.getProfile();
  A.awardOnline({ position: 1, field: 3, raceId: 'fresh-race-1' });
  A.awardOnline({ position: 2, field: 3, raceId: 'fresh-race-2' });
  const current = A.loadProfile(shared);
  assert.equal(B.awardOnline({ position: 1, field: 3, raceId: 'fresh-race-1' }), null);
  assert.equal(B.getProfile().credits, current.credits); assert.deepEqual(B.getProfile().online, current.online);
  assert.equal(B.loadProfile(shared).credits, current.credits);
  assert.deepEqual(B.loadProfile(shared).online, ['fresh-race-1', 'fresh-race-2']);
});
