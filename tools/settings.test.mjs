import { test } from 'node:test';
import assert from 'node:assert/strict';

const memory = () => ({ values: new Map(), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); } });
let serial = 0;
async function preferences(storage) {
  globalThis.localStorage = storage;
  return import('../src/settings.js?steering-test=' + serial++);
}

test('steering assist defaults follow the active device until explicitly selected', async () => {
  const storage = memory(), module = await preferences(storage), vehicle = {};
  assert.equal(module.settings.steeringAssist, null);
  assert.equal(module.applySteeringAssist(vehicle, 'keyboard'), 1);
  assert.equal(vehicle.steerAssist, 1);
  assert.equal(module.applySteeringAssist(vehicle, 'touch'), 1);
  assert.equal(module.applySteeringAssist(vehicle, 'gamepad'), 0.35);
  assert.equal(module.applySteeringAssist(vehicle, 'wheel'), 0.35);
  assert.equal(module.settings.steeringAssist, null, 'adaptive defaults do not count as a user choice');
});

test('Off / Light / Full apply live, persist and take priority over device defaults', async () => {
  const storage = memory(), module = await preferences(storage), vehicle = {};
  let device = 'gamepad', updates = 0;
  const unsubscribe = module.onSettings((settings, key) => {
    if (key === 'steeringAssist') { module.applySteeringAssist(vehicle, device); updates++; }
  });
  // Choosing Full while Full is the keyboard default must still persist an explicit choice.
  module.setSetting('steeringAssist', 'full');
  assert.equal(vehicle.steerAssist, 1);
  assert.equal(JSON.parse(storage.getItem('paraliaki.settings')).steeringAssist, 'full');
  for (const [choice, value] of [['off', 0], ['light', 0.35], ['full', 1]]) {
    module.setSetting('steeringAssist', choice);
    assert.equal(vehicle.steerAssist, value, 'live subscriber applies the setting');
    device = 'keyboard'; assert.equal(module.applySteeringAssist(vehicle, device), value);
    device = 'gamepad'; assert.equal(module.applySteeringAssist(vehicle, device), value);
    const reloaded = await preferences(storage);
    assert.equal(reloaded.settings.steeringAssist, choice);
    assert.equal(reloaded.applySteeringAssist({}, 'wheel'), value);
  }
  assert.equal(updates, 4);
  unsubscribe();
});

test('invalid saved steering assist returns to the adaptive default', async () => {
  const storage = memory(); storage.setItem('paraliaki.settings', JSON.stringify({ steeringAssist: 'invalid' }));
  const module = await preferences(storage);
  assert.equal(module.settings.steeringAssist, null);
  assert.equal(module.applySteeringAssist({}, 'gamepad'), 0.35);
  module.setSetting('steeringAssist', 'invalid');
  assert.equal(module.settings.steeringAssist, null);
});
