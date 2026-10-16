import { test } from 'node:test';
import assert from 'node:assert/strict';

const memory = () => ({ values: new Map(), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } });
let serial = 0;
async function preferences(storage) {
  globalThis.localStorage = storage;
  return import('../src/settings.js?steering-test=' + serial++);
}

test('old all-aids-off migrates ABS and quick TC/ESC persists without changing ABS', async () => {
  for (const oldAids of [false, true]) {
    const storage=memory();storage.setItem('paraliaki.settings',JSON.stringify({aids:oldAids}));
    const module=await preferences(storage);assert.equal(module.settings.aids,oldAids);assert.equal(module.settings.abs,oldAids);
    module.setSetting('aids',!oldAids);assert.equal(module.settings.abs,oldAids);
    const loaded=await preferences(storage);assert.equal(loaded.settings.aids,!oldAids);assert.equal(loaded.settings.abs,oldAids);
  }
});

test('comfortable master default migrates the old default once and preserves explicit volumes', async () => {
  assert.equal((await preferences(memory())).settings.master, 0.6);
  for (const master of [0, 0.3, 0.8, 0.95]) {
    const storage = memory();
    storage.setItem('paraliaki.settings', JSON.stringify({ master, music: 0.2, engine: 0.9 }));
    const module = await preferences(storage);
    assert.equal(module.settings.master, master === 0.8 ? 0.6 : master);
    assert.equal(module.settings.music, 0.2);
    assert.equal(module.settings.engine, 0.9);
    module.setSetting('master', 0.8);
    assert.equal((await preferences(storage)).settings.master, 0.8, 'intentional later selection survives');
  }
});

test('saved volumes remain usable when storage writes are denied', async () => {
  const storage = memory();
  storage.setItem('paraliaki.settings', JSON.stringify({ master: 0.3, music: 0.2 }));
  storage.setItem = () => { throw new Error('storage is read-only'); };
  const module = await preferences(storage);
  assert.equal(module.settings.master, 0.3);
  assert.equal(module.settings.music, 0.2);
});

test('quieter tyres migrate the old default once without changing custom levels or master', async () => {
  assert.equal((await preferences(memory())).settings.tyres, 0.28);
  for (const tyres of [0, 0.3, 0.8, 0.95]) {
    const storage = memory();
    storage.setItem('paraliaki.audio-default-version', '1');
    storage.setItem('paraliaki.settings', JSON.stringify({ master: 0.8, tyres }));
    const module = await preferences(storage);
    assert.equal(module.settings.tyres, tyres === 0.8 ? 0.28 : tyres);
    assert.equal(module.settings.master, 0.8);
    module.setSetting('tyres', 0.8);
    assert.equal((await preferences(storage)).settings.tyres, 0.8);
  }
});

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

test('resolution persists and notifies live subscribers; graphics presets are gone', async () => {
  const storage = memory(), module = await preferences(storage), changes = [];
  const off = module.onSettings((s, key) => changes.push([key, s[key]]));
  module.setSetting('graphics', 'ultra'); module.setSetting('lighting', 'high'); module.setSetting('effects', 'high');
  module.setSetting('renderScale', .65);
  module.setSetting('pixelRatioCap', 2);
  assert.deepEqual(changes, [['renderScale', .65], ['pixelRatioCap', 2]]);
  assert.equal(storage.getItem('paraliaki.graphics'), null);
  const saved = JSON.parse(storage.getItem('paraliaki.settings'));
  assert.equal(saved.renderScale, .65); assert.equal(saved.pixelRatioCap, 2);
  for (const k of ['graphics', 'lighting', 'effects', 'motionBlur']) assert.equal(k in saved, false, k);
  const restored = await preferences(storage);
  assert.equal(restored.settings.renderScale, .65); assert.equal('graphics' in restored.settings, false);
  module.setSetting('renderScale', 'auto'); assert.equal(module.settings.renderScale, 'auto');
  off();
});

test('old graphics / lighting / effects saves load cleanly: the preset becomes a performance class only', async () => {
  const storage = memory();
  storage.setItem('paraliaki.settings', JSON.stringify({ lighting: 'ultra', effects: 'high', motionBlur: false, renderScale: .8, master: .3 }));
  storage.setItem('paraliaki.graphics', 'ultra');
  const module = await preferences(storage);
  for (const k of ['graphics', 'lighting', 'effects', 'motionBlur']) assert.equal(k in module.settings, false, k);
  assert.equal(module.settings.perfClass, 'high'); assert.equal(module.settings.renderScale, .8); assert.equal(module.settings.master, .3);
  assert.equal(storage.getItem('paraliaki.graphics'), null);
  const saved = JSON.parse(storage.getItem('paraliaki.settings'));
  assert.deepEqual(Object.keys(saved).filter(k => ['graphics', 'lighting', 'effects', 'motionBlur'].includes(k)), []);
  assert.equal(saved.perfClass, 'high'); assert.equal(saved.master, .3);
  const potato = memory(); potato.setItem('paraliaki.graphics', 'potato');
  assert.equal((await preferences(potato)).settings.perfClass, 'potato');
  const junk = memory(); junk.setItem('paraliaki.graphics', 'banana');
  assert.equal((await preferences(junk)).settings.perfClass, 'auto');
});

test('resolution values are bounded on load and live writes', async () => {
  const storage = memory(); storage.setItem('paraliaki.settings', JSON.stringify({ renderScale: 3, pixelRatioCap: .2 }));
  const module = await preferences(storage);
  assert.equal(module.settings.renderScale, 1); assert.equal(module.settings.pixelRatioCap, 1);
  module.setSetting('renderScale', .1); assert.equal(module.settings.renderScale, .5);
  module.setSetting('pixelRatioCap', 10); assert.equal(module.settings.pixelRatioCap, 2);
  module.setSetting('renderScale', 'invalid'); assert.equal(module.settings.renderScale, 'auto');
  module.setSetting('perfClass', 'invalid'); assert.equal(module.settings.perfClass, 'auto');
});

test('fresh players start with the tyre grip display off', async () => {
  const module = await preferences(memory());
  assert.equal(module.settings.showTyreGrip, false);
  assert.equal(module.DEFAULTS.showTyreGrip, false);
});

test('HUD motion respects reduced motion until explicitly chosen and rejects invalid values', async () => {
  const previous = globalThis.matchMedia;
  try {
    globalThis.matchMedia = () => ({ matches: false });
    assert.equal((await preferences(memory())).settings.hudMotion, 'full', 'Full by default');
    globalThis.matchMedia = () => ({ matches: true });
    const storage = memory(), module = await preferences(storage);
    assert.equal(module.settings.hudMotion, 'off');
    module.setSetting('hudMotion', 'full');
    assert.equal((await preferences(storage)).settings.hudMotion, 'full');
    module.setSetting('hudMotion', 'invalid');
    assert.equal(module.settings.hudMotion, 'full');
    globalThis.matchMedia = () => ({ matches: false });
    const old = memory(); old.setItem('paraliaki.settings', JSON.stringify({ hudMotion: 'subtle' }));
    const migrated = await preferences(old);
    assert.equal(migrated.settings.hudMotion, 'full', 'the old Subtle default moves to Full once');
    migrated.setSetting('hudMotion', 'subtle');
    assert.equal((await preferences(old)).settings.hudMotion, 'subtle', 'a later deliberate Subtle survives reloads');
  } finally { globalThis.matchMedia = previous; }
});

test('retired phone controller preferences are dropped from memory and saved settings', async () => {
  const storage = memory();
  storage.setItem('paraliaki.settings', JSON.stringify({ phoneWheel: true, phoneWheelHaptics: true, phone_wheelLock: 90, touchSteering: 'tilt', master: 0.3 }));
  const { settings, setSetting } = await preferences(storage);
  for (const value of [settings, JSON.parse(storage.getItem('paraliaki.settings'))]) {
    assert.ok(!Object.keys(value).some(key => /^phone.?wheel/i.test(key)));
    assert.equal(value.master, 0.3);
  }
  setSetting('phoneWheel', true);
  assert.equal(settings.phoneWheel, undefined);
});
