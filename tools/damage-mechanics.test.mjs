// node --import ./tools/physics-test/register.mjs --test tools/damage-mechanics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../src/physics.js';
import { damageIncrement, equivalentBarrierSpeed } from '../src/damage-math.js';

const route = {
  frame: () => ({ tx: 0, tz: -1 }), point: (s, u) => ({ x: u, y: 0, z: -s }),
};
const spec = { mass: 1500, wheelbase: 2.6, width: 1.84, length: 4.4, wheelR: 0.33,
  drive: 'fwd', engine: 'turbo4', idle: 800, gears: [3.5, 2, 1], final: 4.1 };
const mk = (extra = {}) => new Vehicle({ ...spec, ...extra }, route);
const wall = (v, kmh, zone = 'front', extra = {}) => v.addDamage(zone, kmh / 3.6, { kind: 'wall', ...extra });
const advance = (v, seconds) => { let maxSteam = 0; for (let t = 0; t < seconds; t += 0.05) {
  v.damageFx(0.05); maxSteam = Math.max(maxSteam, v.steamAmount);
} return maxSteam; };

test('energy thresholds: bumper elasticity, cosmetic 10 km/h, serious 50 km/h, terminal 100 km/h', () => {
  assert.equal(damageIncrement(7 / 3.6, 'front'), 0);
  assert.ok(damageIncrement(10 / 3.6, 'front') < 0.02);
  assert.ok(damageIncrement(30 / 3.6, 'front') > 0.2);
  assert.ok(damageIncrement(50 / 3.6, 'front') > 0.8);
  const light = mk(); wall(light, 10);
  assert.equal(light.engHealth, 1); assert.equal(light.damageSignificant, false);
  assert.ok(light.cornerDamage.every(v => v === 0));
  const wreck = mk(); wall(wreck, 100, 'rear');
  assert.equal(wreck.engineStalled, true); assert.equal(wreck.engHealth, 0);
});

test('reduced-mass energy is split once; resting/separating/malformed contacts do nothing', () => {
  assert.equal(equivalentBarrierSpeed(20, 1500, 1500), 10);
  const a = mk(), b = mk(), c = mk(); wall(a, 36);
  b.addDamage('front', 11.5, { sev: 20, car: { mass: 1500 }, kind: 'crash' });
  assert.equal(a.damage.front, b.damage.front);
  assert.ok(equivalentBarrierSpeed(20, 1500, 12000) > 10);
  assert.ok(equivalentBarrierSpeed(20, 12000, 1500) < 10);
  for (const dv of [NaN, Infinity, -1, 0]) assert.equal(c.addDamage('front', dv), 0);
  assert.equal(c.addDamage('front', 5, { sev: -2 }), 0);
  assert.equal(c.addDamage('constructor', 5), 0);
  for (const zone of ['constructor', '__proto__', 'missing']) assert.equal(damageIncrement(10, zone), 0);
  assert.deepEqual(c.damage, { front: 0, rear: 0, left: 0, right: 0 });
});

test('contact position isolates the struck wheel; vectors are copied and metadata serial increases', () => {
  const v = mk(), p = { x: -v.track / 2, y: 0.4, z: -v.a };
  const n = { x: 1, y: 0, z: 0 };
  wall(v, 50, 'left', { localPoint: p, localNormal: n });
  assert.ok(v.cornerDamage[0] > v.cornerDamage[1] * 3);
  assert.ok(v.cornerDamage[0] > v.cornerDamage[2] * 10);
  assert.ok(v.toePull < 0);
  assert.ok(Math.abs(v.wheelCamber[0]) > Math.abs(v.wheelCamber[1]));
  p.x = 99; n.x = 99;
  assert.notEqual(v.lastDamage.localPoint.x, p.x); assert.equal(v.lastDamage.localNormal.x, 1);
  const serial = v.lastDamage.serial; wall(v, 30, 'rear');
  assert.equal(v.lastDamage.serial, serial + 1);
});

test('radiator rupture has delayed heat, intermittent thin steam, then progressive power loss', () => {
  const v = mk(); wall(v, 50);
  assert.ok(v.radiatorDamage > 0); assert.equal(v.coolantTemp, 90);
  assert.equal(v.steamAmount, 0); assert.equal(v.smoke, false);
  const initialPower = v.engHealth;
  const peak = advance(v, 30);
  assert.ok(v.coolantTemp > 110); assert.ok(peak > 0 && peak <= 0.18);
  assert.ok(v.engHealth < initialPower);
  let quiet = false, steaming = false;
  for (let i = 0; i < 100; i++) { v.damageFx(0.05); quiet ||= v.steamAmount === 0; steaming ||= v.steamAmount > 0.01; }
  assert.ok(quiet && steaming);
  const clean = mk(); wall(clean, 10); advance(clean, 60);
  assert.equal(clean.coolantTemp, 90); assert.equal(clean.smoke, false); assert.equal(clean.engHealth, 1);
});

test('engine-location damage and heavy-hit stall; deterministic rare driveline failure only on enormous hits', () => {
  const rearEngine = mk({ engineZone: 'rear' }), frontEngine = mk();
  wall(rearEngine, 80); wall(frontEngine, 80);
  assert.equal(rearEngine.engineStalled, false); assert.equal(frontEngine.engineStalled, true);
  wall(rearEngine, 80, 'rear'); assert.equal(rearEngine.engineStalled, true);
  let failed = 0;
  for (let kmh = 100; kmh < 200; kmh++) {
    const a = mk(), b = mk(); wall(a, kmh); wall(b, kmh);
    assert.equal(a.drivetrainBroken, b.drivetrainBroken);
    if (kmh < 115) assert.equal(a.drivetrainBroken, false);
    if (a.drivetrainBroken) failed++;
  }
  assert.ok(failed > 0 && failed < 25, `${failed}/100 enormous crashes broke driveline`);
});

test('repeated impacts remain finite and bounded; reset repairs every cached mechanical consequence', () => {
  const v = mk(); v.vLong = 20;
  for (let i = 0; i < 250; i++) { wall(v, 40, ['front', 'rear', 'left', 'right'][i % 4]); v.damageFx(0.1); }
  v.damageFx(NaN); v.damageFx(Infinity);
  assert.ok(Object.values(v.damage).every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  assert.ok(v.cornerDamage.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  assert.ok(v.wheelCamber.every(n => Number.isFinite(n) && Math.abs(n) <= 0.22));
  assert.ok(Number.isFinite(v.toePull) && Math.abs(v.toePull) <= 0.055);
  assert.ok(Number.isFinite(v.dmgDrag) && v.dmgDrag < 1.33);
  const serial = v.lastDamage.serial;
  v.reset(0, 0);
  assert.equal(v.engHealth, 1); assert.equal(v.radiatorDamage, 0); assert.equal(v.coolantTemp, 90);
  assert.equal(v.smoke, false); assert.equal(v.steamAmount, 0); assert.equal(v.engineStalled, false);
  assert.equal(v.drivetrainBroken, false); assert.ok(v.cornerDamage.every(n => n === 0));
  assert.equal(v.toePull, 0); assert.equal(v.lastDamage, null);
  wall(v, 30); assert.equal(v.lastDamage.serial, serial + 1);
});
