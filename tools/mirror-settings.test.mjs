import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// The Mirror setting (Settings > Graphics): Off / Low / High. Off hides the mirrors and skips the render pass,
// Low halves the resolution and refreshes every other frame, High is full resolution every frame. A low performance
// class caps High at Low (owner request 2026-10-21).

const memory = () => ({ values: new Map(), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } });
let serial = 0;
async function preferences(storage) {
  globalThis.localStorage = storage;
  return import('../src/settings.js?mirror-settings-test=' + serial++);
}

test('the Mirror setting persists Off / Low / High and rejects anything else', async () => {
  const storage = memory(), module = await preferences(storage), changes = [];
  const off = module.onSettings((s, key) => changes.push([key, s[key]]));
  assert.equal(module.settings.mirrors, 'high');
  for (const level of ['low', 'off', 'high']) {
    module.setSetting('mirrors', level);
    assert.equal(module.settings.mirrors, level);
    assert.equal(JSON.parse(storage.getItem('paraliaki.settings')).mirrors, level);
    assert.equal((await preferences(storage)).settings.mirrors, level);
  }
  assert.deepEqual(changes.filter(([key]) => key === 'mirrors').map(([, value]) => value), ['low', 'off', 'high']);
  module.setSetting('mirrors', 'banana');
  assert.equal(module.settings.mirrors, 'high', 'invalid values are ignored');
  off();
});

test('legacy boolean Mirror saves migrate to High / Off, and a low class picks Low', async () => {
  const on = memory(); on.setItem('paraliaki.settings', JSON.stringify({ mirrors: true }));
  assert.equal((await preferences(on)).settings.mirrors, 'high');
  const offStorage = memory(); offStorage.setItem('paraliaki.settings', JSON.stringify({ mirrors: false }));
  assert.equal((await preferences(offStorage)).settings.mirrors, 'off');
  const junk = memory(); junk.setItem('paraliaki.settings', JSON.stringify({ mirrors: 'banana' }));
  assert.equal((await preferences(junk)).settings.mirrors, 'high');
  for (const perfClass of ['potato', 'low']) {
    const weak = memory(); weak.setItem('paraliaki.settings', JSON.stringify({ perfClass }));
    assert.equal((await preferences(weak)).settings.mirrors, 'low', `${perfClass} picks Low`);
  }
  const strong = memory(); strong.setItem('paraliaki.settings', JSON.stringify({ perfClass: 'high' }));
  assert.equal((await preferences(strong)).settings.mirrors, 'high');
});

test('mirrorQuality: Off and Low stick, High drops to Low on weak classes only', async () => {
  const { mirrorQuality } = await preferences(memory());
  assert.equal(mirrorQuality('off', 'high'), 'off');
  assert.equal(mirrorQuality('low', 'high'), 'low');
  assert.equal(mirrorQuality('high', 'high'), 'high');
  assert.equal(mirrorQuality('high', 'med'), 'high');
  assert.equal(mirrorQuality('high', 'auto'), 'high');
  assert.equal(mirrorQuality('high', 'low'), 'low');
  assert.equal(mirrorQuality('high', 'potato'), 'low');
  assert.equal(mirrorQuality(false, 'high'), 'off');
  assert.equal(mirrorQuality(true, 'low'), 'low');
});

test('the Graphics menu offers Mirror as an Off / Low / High kit segmented control', async () => {
  const { Menu } = await import('../src/menu.js');
  const html = Object.assign(Object.create(Menu.prototype), { h: {} }).r_settings({ tab: 'video', from: 'pause' });
  assert.match(html, /data-key="mirrors"/);
  const row = html.slice(html.indexOf('data-key="mirrors"') - 2000, html.indexOf('data-key="mirrors"') + 500);
  assert.match(row, /OFF/); assert.match(row, /LOW/); assert.match(row, /HIGH/);
  assert.doesNotMatch(row, /<select/, 'kit components only: no native dropdowns');
});

// --- the render pass itself (the real Cockpit method against stub scene plumbing) ---

async function cockpitModule() {
  return import('../src/cockpit.js?mirror-settings-test=' + serial++);
}

function stubMesh() {
  return {
    visible: true,
    geometry: { computeBoundingBox() {}, boundingBox: { getCenter(v) { return v.set(0, 0, 0); } } },
    localToWorld(v) { return v; },
  };
}

function stubMirror(name = 'interior') {
  return { name, mesh: stubMesh(), material: { map: null, color: { set() { return { multiplyScalar() {} }; } } } };
}

function stubContext(mirrors) {
  const rearCamera = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), far: 600, updateProjectionMatrix() {}, updateMatrixWorld() {} };
  const body = { updateMatrixWorld() {}, getWorldQuaternion(q) { return q; }, matrixWorld: new THREE.Matrix4(), localToWorld(v) { return v; } };
  return {
    mirrors, rearCamera, rearTarget: null, mirrorCalls: 0, rearLast: undefined, mirrorQuality: undefined,
    model: { body, root: { visible: true, updateMatrixWorld() {} }, shape: {} },
  };
}

function stubRenderer(deviceWidth = 1280, deviceHeight = 800, pixelRatio = 1) {
  const calls = { renders: 0, target: null };
  return {
    calls,
    shadowMap: { autoUpdate: true },
    getSize(v) { return v.set(deviceWidth, deviceHeight); },
    getPixelRatio() { return pixelRatio; },
    getRenderTarget() { return calls.target; },
    setRenderTarget(t) { calls.target = t; },
    render() { calls.renders++; },
  };
}

test('Off hides the mirrors and skips the render pass entirely', async () => {
  const { Cockpit } = await cockpitModule();
  for (const quality of ['off', 'low', 'high']) {
    const renderer = stubRenderer(), ctx = stubContext([stubMirror(), stubMirror(), stubMirror()]);
    const enabled = quality !== 'off';
    Cockpit.prototype.renderMirrors.call(ctx, renderer, {}, { enabled, quality, now: 0, width: 384 });
    if (!enabled) {
      assert.equal(renderer.calls.renders, 0, 'Off renders nothing');
      assert.equal(ctx.rearTarget, null, 'Off allocates no target');
      assert.ok(ctx.mirrors.every((m) => m.mesh.visible === false), 'Off hides the mirrors');
      assert.ok(ctx.mirrors.every((m) => m.material.map && m.material.map !== ctx.rearTarget?.texture), 'Off binds dark glass');
    } else {
      assert.equal(renderer.calls.renders, 1, `${quality} renders`);
      assert.ok(ctx.mirrors.every((m) => m.mesh.visible === true), `${quality} shows the mirrors`);
    }
  }
  // quality 'off' hides even when enabled (the main loop passes both consistently, this pins the method contract)
  const renderer = stubRenderer(), ctx = stubContext([stubMirror()]);
  Cockpit.prototype.renderMirrors.call(ctx, renderer, {}, { enabled: true, quality: 'off', now: 0 });
  assert.equal(renderer.calls.renders, 0);
  assert.equal(ctx.mirrors[0].mesh.visible, false);
});

test('the High target follows the drawing buffer size; Low halves it', async () => {
  const { Cockpit, mirrorTargetWidth } = await cockpitModule();
  assert.equal(mirrorTargetWidth(2560, 'high'), 768, 'capped at RENDER.mirror.width');
  assert.equal(mirrorTargetWidth(2560, 'low'), 384, 'Low is half resolution');
  assert.equal(mirrorTargetWidth(1280, 'high'), 384);
  assert.ok(mirrorTargetWidth(320, 'high') >= 256, 'floored for small windows');
  const heightFor = (w) => Math.round(w * Math.tan(THREE.MathUtils.degToRad(26 / 2)) / Math.tan(THREE.MathUtils.degToRad(84 / 2)));

  const renderer = stubRenderer(1280, 800, 2); // 2560 device px wide
  const ctx = stubContext([stubMirror('interior')]);
  Cockpit.prototype.renderMirrors.call(ctx, renderer, {}, { quality: 'high', now: 0 });
  assert.equal(ctx.rearTarget.width, 768, 'High matches the on-screen size x devicePixelRatio');
  assert.equal(ctx.rearTarget.height, heightFor(768));
  assert.equal(ctx.rearTarget.texture.magFilter, THREE.LinearFilter);
  assert.equal(ctx.rearTarget.texture.minFilter, THREE.LinearFilter);

  const small = stubRenderer(640, 400, 1);
  Cockpit.prototype.renderMirrors.call(ctx, small, {}, { quality: 'high', now: 16 });
  assert.equal(ctx.rearTarget.width, 256, 'the target reallocates when the screen size changes');

  const low = stubRenderer(1280, 800, 2);
  const lowCtx = stubContext([stubMirror('interior')]);
  Cockpit.prototype.renderMirrors.call(lowCtx, low, {}, { quality: 'low', now: 0 });
  assert.equal(lowCtx.rearTarget.width, 384, 'Low halves the High target');
});

test('High renders every frame; Low renders every other frame', async () => {
  const { Cockpit } = await cockpitModule();
  const highRenderer = stubRenderer(), high = stubContext([stubMirror('interior')]);
  Cockpit.prototype.renderMirrors.call(high, highRenderer, {}, { quality: 'high', now: 0 });
  Cockpit.prototype.renderMirrors.call(high, highRenderer, {}, { quality: 'high', now: 16 });
  assert.equal(highRenderer.calls.renders, 2, 'High refreshes every frame');

  const lowRenderer = stubRenderer(), low = stubContext([stubMirror('interior')]);
  Cockpit.prototype.renderMirrors.call(low, lowRenderer, {}, { quality: 'low', now: 0 });
  Cockpit.prototype.renderMirrors.call(low, lowRenderer, {}, { quality: 'low', now: 16 });
  Cockpit.prototype.renderMirrors.call(low, lowRenderer, {}, { quality: 'low', now: 32 });
  assert.equal(lowRenderer.calls.renders, 2, 'Low skips alternate frames');
});
