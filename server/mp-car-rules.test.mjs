// Multiplayer car rules: PI/class per trim, ruleset validation, balancing math
// and server enforcement. The PI table classifies every catalogue trim from
// data, so new trims are covered automatically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
import { CARS } from '../src/cars.js';
import { carCategory, CAR_CLASSES } from '../src/car-catalog.js';
import { carPerformanceIndex, performanceClass, classifyCar, PI_CLASSES } from '../src/car-performance.js';
import { defaultCarRules, sanitizeCarRules, carEligibility, eligibleIds, balanceTable, balanceLabel, describeRules, applyBalance, MAX_BALLAST_KG } from '../src/mp-car-rules.js';
import { createGameCore } from './core.mjs';

const views = CARS.map((c) => {
  const { pi, class: cls } = classifyCar(c);
  return { id: c.id, name: c.short || c.id, pi, class: cls, category: carCategory(c), power: c.power, mass: c.mass };
});
const byId = (id) => views.find((v) => v.id === id);
const ctx = { classes: [...PI_CLASSES], categories: [...CAR_CLASSES], knownIds: CARS.map((c) => c.id) };

// ---------------------------------------------------------------- PI + classes
test('every trim gets a bounded PI and a D/C/B/A/S class', () => {
  assert.deepEqual(PI_CLASSES, ['D', 'C', 'B', 'A', 'S']);
  for (const c of CARS) {
    const { pi, class: cls } = classifyCar(c);
    assert.ok(Number.isInteger(pi) && pi >= 100 && pi <= 900, `${c.id} PI ${pi}`);
    assert.ok(PI_CLASSES.includes(cls), `${c.id} class ${cls}`);
    assert.equal(performanceClass(pi), cls);
    assert.equal(carPerformanceIndex(c), pi, 'deterministic');
  }
  // Missing telemetry never breaks classification (the police trim quotes no 0-100).
  assert.ok(carPerformanceIndex({}) > 0 && performanceClass(0) === 'D');
});

test('class anchors follow real pace from city cars to supercars', () => {
  assert.equal(byId('ibiza').class, 'D');
  assert.equal(byId('panda').class, 'D');
  assert.equal(byId('e36_318i').class, 'C');
  assert.equal(byId('police_octavia').class, 'C');
  assert.equal(byId('ibiza_cupra').class, 'B');
  assert.equal(byId('mini').class, 'B');
  assert.equal(byId('superb_4x4').class, 'A');
  assert.equal(byId('z4').class, 'A');
  assert.equal(byId('cla45s').class, 'S');
  assert.equal(byId('carrera_gts').class, 'S');
  assert.equal(byId('huracan').class, 'S');
  const pace = ['panda', 'golf', 'z4_20i', 'z4', 'carrera', 'huracan'].map((id) => byId(id).pi);
  assert.deepEqual([...pace].sort((a, b) => a - b), pace, 'PI climbs with real pace');
});

// ---------------------------------------------------------------- rulesets
test('sanitizeCarRules accepts every preset and rejects bad input with a reason', () => {
  for (const [input, key] of [
    [{ preset: 'open' }, 'preset'], [{ preset: 'same-class', class: 'B' }, 'class'],
    [{ preset: 'max-pi', maxPI: 450 }, 'maxPI'], [{ preset: 'category', category: 'hot hatch' }, 'category'],
    [{ preset: 'spec', spec: 'gr_yaris' }, 'spec'], [{ preset: 'balanced', class: 'A' }, 'preset'],
    [{ preset: 'same-class', class: 'C', balanced: true }, 'balanced'],
  ]) {
    const { rules, error } = sanitizeCarRules(input, ctx);
    assert.equal(error, undefined, JSON.stringify(input));
    assert.equal(rules[key === 'preset' ? 'preset' : key], input[key === 'preset' ? 'preset' : key]);
    if (input.preset === 'balanced') assert.equal(rules.balanced, true, 'the balanced preset implies equalizing');
  }
  assert.equal(sanitizeCarRules(undefined, ctx).rules, null, 'absent rules mean no change');
  for (const input of [{ preset: 'nope' }, { preset: 'same-class', class: 'Z' }, { preset: 'max-pi' },
    { preset: 'category', category: 'hovercraft' }, { preset: 'spec', spec: 'missing' },
    { preset: 'open', balanced: true }, { preset: 'spec', spec: 'mini', balanced: true },
    { preset: 'open', allowedCars: [] }, { preset: 'open', allowedCars: ['missing'] }, null, 42]) {
    assert.match(sanitizeCarRules(input, ctx).error || '', /.+/, JSON.stringify(input) + ' is rejected');
  }
  // Unknown allow-list ids filter out; valid ones survive.
  assert.deepEqual(sanitizeCarRules({ preset: 'open', allowedCars: ['mini', 'missing'] }, ctx).rules.allowedCars, ['mini']);
  // Spec-dependent presets need pace data.
  assert.match(sanitizeCarRules({ preset: 'same-class', class: 'B' }, { ...ctx, haveSpecs: false }).error, /unavailable/);
  assert.ok(sanitizeCarRules({ preset: 'open' }, { ...ctx, haveSpecs: false }).rules);
});

test('eligibility resolves each preset and the Advanced override narrows it', () => {
  const b = eligibleIds(views, sanitizeCarRules({ preset: 'same-class', class: 'B' }, ctx).rules);
  assert.ok(b.length > 1 && b.every((id) => byId(id).class === 'B') && !b.includes('huracan'));
  const capped = eligibleIds(views, sanitizeCarRules({ preset: 'max-pi', maxPI: 300 }, ctx).rules);
  assert.ok(capped.length > 1 && capped.every((id) => byId(id).pi <= 300));
  const city = eligibleIds(views, sanitizeCarRules({ preset: 'category', category: 'city' }, ctx).rules);
  assert.ok(city.length > 1 && city.every((id) => byId(id).category === 'city'));
  assert.deepEqual(eligibleIds(views, sanitizeCarRules({ preset: 'spec', spec: 'gr_yaris' }, ctx).rules), ['gr_yaris']);
  assert.deepEqual(eligibleIds(views, sanitizeCarRules({ preset: 'open' }, ctx).rules).length, views.length);
  // Advanced override intersects, never widens.
  const narrowed = eligibleIds(views, sanitizeCarRules({ preset: 'same-class', class: 'B', allowedCars: ['mini', 'huracan'] }, ctx).rules);
  assert.deepEqual(narrowed, ['mini']);
  // Reasons name the car and the rule.
  assert.deepEqual(carEligibility(byId('huracan'), sanitizeCarRules({ preset: 'same-class', class: 'B' }, ctx).rules), { ok: false, reason: 'HURACÁN EVO is class S · this lobby races class B.' });
  assert.match(carEligibility(byId('huracan'), sanitizeCarRules({ preset: 'max-pi', maxPI: 300 }, ctx).rules).reason, /PI 872 · the lobby caps at 300/);
  assert.match(carEligibility(byId('huracan'), sanitizeCarRules({ preset: 'category', category: 'city' }, ctx).rules).reason, /SUPER · this lobby races CITY only/);
  assert.match(carEligibility(byId('mini'), sanitizeCarRules({ preset: 'spec', spec: 'gr_yaris' }, ctx).rules).reason, /not the spec car/);
  assert.match(carEligibility(byId('mini'), sanitizeCarRules({ preset: 'open', allowedCars: ['z4'] }, ctx).rules).reason, /excluded list/);
  assert.deepEqual(describeRules(sanitizeCarRules({ preset: 'balanced', class: 'B' }, ctx).rules), 'CLASS B · BALANCED');
  assert.deepEqual(describeRules(sanitizeCarRules({ preset: 'spec', spec: 'gr_yaris' }, ctx).rules, { gr_yaris: 'GR YARIS' }), 'SPEC · GR YARIS');
});

// ---------------------------------------------------------------- balancing
test('balanced entries converge on the slowest car: ballast first, then a power cap', () => {
  const field = ['ibiza_cupra', 'mini', 'mini_jcw', 'cle200', 'golf_gti'].map((id) => CARS.find((c) => c.id === id));
  const table = balanceTable(field.map((c) => ({ ...c, category: carCategory(c) })));
  assert.equal(table.targetId, 'ibiza_cupra', 'the slowest car sets the pace');
  assert.deepEqual(table.cars.ibiza_cupra, { ballastKg: 0, powerCapKW: 0, label: 'EVEN PACE', balancedPI: byId('ibiza_cupra').pi, effPw: table.cars.ibiza_cupra.effPw });
  for (const c of field) {
    const e = table.cars[c.id];
    assert.ok(e.ballastKg >= 0 && e.ballastKg <= MAX_BALLAST_KG, `${c.id} ballast in range`);
    assert.equal(e.label, balanceLabel(e.ballastKg, e.powerCapKW));
  }
  assert.ok(table.cars.mini.ballastKg > 0 && table.cars.mini.powerCapKW === 0, 'small gaps earn ballast only');
  assert.ok(table.cars.mini_jcw.powerCapKW > 0 && table.cars.mini_jcw.ballastKg === MAX_BALLAST_KG, 'huge gaps earn a cap on top of full ballast');
  // Effective power-to-weight converges to the target.
  const pws = field.map((c) => table.cars[c.id].effPw);
  assert.ok(Math.max(...pws) - Math.min(...pws) < 20, `effective pw converges: ${pws}`);
  // Balanced PI spread shrinks while the reference car is untouched.
  const raw = field.map((c) => byId(c.id).pi), after = field.map((c) => table.cars[c.id].balancedPI);
  assert.ok(Math.max(...after) - Math.min(...after) < Math.max(...raw) - Math.min(...raw));
  assert.deepEqual(balanceTable([]), { targetId: null, targetPI: null, cars: {} });
  assert.equal(balanceTable([{ id: 'ghost' }]).cars.ghost.label, 'EVEN PACE', 'cars without data race as-is');
});

test('applyBalance only touches handicapped specs', () => {
  const spec = CARS.find((c) => c.id === 'mini');
  assert.equal(applyBalance(spec, null), spec);
  assert.equal(applyBalance(spec, { ballastKg: 0, powerCapKW: 0 }), spec);
  const heavy = applyBalance(spec, { ballastKg: 40, powerCapKW: 0 });
  assert.equal(heavy.mass, spec.mass + 40);
  assert.equal(heavy.power, spec.power);
  assert.equal(heavy.id, spec.id);
  const capped = applyBalance(spec, { ballastKg: 0, powerCapKW: 100 });
  assert.equal(capped.power, 100);
  assert.equal(applyBalance(spec, { ballastKg: 0, powerCapKW: 9999 }), spec, 'a cap above catalogue power is a no-op');
});

// ---------------------------------------------------------------- server
const socket = () => ({ readyState: 1, messages: [], send(d) { this.messages.push(JSON.parse(d)); }, close() { this.readyState = 3; } });
const geometry = { step: 20, x: [0, 20], z: [0, 0], y: [0, 0], lanes: [1, 1], div: [0, 0] };
const maps = new Map([['riviera', { track: { version: 'v' }, geometry, definitions: new Map([['quick', { id: 'quick', type: 'sprint', s0: 0, s1: 200, dir: 1, len: 200 }]]) }]]);
const pick = (ids) => {
  const specs = {};
  for (const id of ids) {
    const c = CARS.find((c) => c.id === id);
    specs[id] = { power: c.power, mass: c.mass, torque: c.torque, drive: c.drive, vmax: c.vmax, grip: c.grip, gripRear: c.gripRear, brake: c.brake, zeroTo100: c.zeroTo100, name: c.name, short: c.short };
  }
  return specs;
};
function setup(t, ids = ['mini', 'z4', 'panda', 'gr_yaris', 'huracan', 'golf_gti']) {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps, cars: new Set(ids), carSpecs: pick(ids), leaderboard: { submit: async () => {} }, countdownMs: 100 });
  const a = socket(), b = socket();
  core.connect(a, 'a', { protocol: MULTIPLAYER_PROTOCOL });
  core.connect(b, 'b', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (s, m) => core.message(s, JSON.stringify(m));
  return { core, a, b, send, lobby: () => [...core.lobbies.values()][0] };
}

test('same-class rules coerce joins and reject invalid picks with the reason', (t) => {
  const e = setup(t), { a, b, send } = e;
  send(a, { type: 'create', carRules: { preset: 'same-class', class: 'B' }, car: 'mini' });
  const l = e.lobby();
  assert.equal(l.carRules.preset, 'same-class');
  assert.ok(l.allowedCars.length > 0 && l.allowedCars.every((id) => byId(id)?.class === 'B' || ['mini', 'golf_gti'].includes(id)));
  send(b, { type: 'join', code: l.code, car: 'z4' });
  const guest = [...l.players.values()][1];
  assert.ok(l.allowedCars.includes(guest.car), 'join coerces to an eligible car');
  send(b, { type: 'car', car: 'z4' });
  assert.match(b.messages.at(-1).message, /not allowed/);
  assert.match(b.messages.at(-1).message, /class A · this lobby races class B/);
  send(b, { type: 'ready', ready: true, version: 'v', car: 'huracan' });
  assert.match(b.messages.at(-1).message, /not allowed/);
  send(a, { type: 'options', carRules: { preset: 'same-class', class: 'Z' } });
  assert.match(a.messages.at(-1).message, /class/i);
  // The lobby publish carries the ruleset plus per-player pace.
  const pub = a.messages.findLast((m) => m.type === 'lobby').lobby;
  assert.equal(pub.carRules.class, 'B');
  assert.ok(pub.players.every((p) => Number.isInteger(p.pi) && /^[DCBAS]$/.test(p.class)));
});

test('host edits move disallowed drivers, the Advanced list narrows, balance syncs', (t) => {
  const e = setup(t), { a, b, send } = e;
  send(a, { type: 'create', car: 'mini' });
  const l = e.lobby();
  send(b, { type: 'join', code: l.code, car: 'golf_gti' });
  const guest = () => [...l.players.values()][1];
  send(a, { type: 'options', carRules: { preset: 'balanced', class: 'B' } });
  assert.equal(guest().car, 'golf_gti', 'eligible drivers keep their car');
  const pub = a.messages.findLast((m) => m.type === 'lobby').lobby;
  assert.equal(pub.balance.targetId, 'mini', 'the slowest entered car sets the pace');
  assert.equal(pub.players.find((p) => p.car === 'mini').balance.label, 'EVEN PACE');
  assert.match(pub.players.find((p) => p.car === 'golf_gti').balance.label, /KG/, 'the faster car shows its handicap');
  // Advanced override narrows inside the ruleset; clearing it restores the field.
  send(a, { type: 'options', allowedCars: ['mini'] });
  assert.equal(guest().car, 'mini');
  assert.equal(guest().ready, false);
  send(b, { type: 'car', car: 'golf_gti' });
  assert.match(b.messages.at(-1).message, /excluded list/);
  send(a, { type: 'options', allowedCars: null });
  send(b, { type: 'car', car: 'golf_gti' });
  assert.equal(guest().car, 'golf_gti');
  // Shrinking the field below anyone's car reassigns and unreadies only them.
  send(a, { type: 'options', carRules: { preset: 'spec', spec: 'mini' } });
  assert.equal(guest().car, 'mini');
  assert.equal(a.messages.findLast((m) => m.type === 'lobby').lobby.balance, null, 'no table without balancing');
});

test('without pace data only open rules validate and racing is unaffected', (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const core = createGameCore({ maps, cars: new Set(['mini', 'z4']), leaderboard: { submit: async () => {} } });
  const a = socket();
  core.connect(a, 'a', { protocol: MULTIPLAYER_PROTOCOL });
  const send = (m) => core.message(a, JSON.stringify(m));
  send({ type: 'create', carRules: { preset: 'same-class', class: 'B' } });
  assert.match(a.messages.at(-1).message, /unavailable/);
  assert.equal([...core.lobbies.values()].length, 0);
  send({ type: 'create' });
  const l = [...core.lobbies.values()][0];
  assert.deepEqual(l.allowedCars, ['mini', 'z4']);
  send({ type: 'car', car: 'z4' });
  assert.equal([...l.players.values()][0].car, 'z4');
});

test('car rules survive a save/restore round trip', (t) => {
  const e = setup(t), { a, send } = e;
  send(a, { type: 'create', carRules: { preset: 'max-pi', maxPI: 500 }, car: 'mini' });
  const l = e.lobby();
  const saved = JSON.parse(JSON.stringify(e.core.exportState()));
  const sockets = new Map([...e.core.clients].map((c) => [c.token, c.ws]));
  const restored = createGameCore({ maps, cars: new Set(['mini', 'z4', 'panda', 'gr_yaris', 'huracan', 'golf_gti']), carSpecs: pick(['mini', 'z4', 'panda', 'gr_yaris', 'huracan', 'golf_gti']), leaderboard: { submit: async () => {} } });
  restored.restore(saved, sockets);
  const rl = [...restored.lobbies.values()][0];
  assert.equal(rl.carRules.preset, 'max-pi');
  assert.equal(rl.carRules.maxPI, 500);
  assert.ok(rl.allowedCars.length > 0 && rl.allowedCars.every((id) => byId(id).pi <= 500));
});
