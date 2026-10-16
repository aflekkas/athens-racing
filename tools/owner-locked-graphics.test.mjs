// Guards for OWNER-LOCKED decisions (docs/OWNER-DECISIONS.md): the one graphics look (the old Lighting = OFF +
// Effects = OFF), no graphics presets or lighting / effects levels, and no mirror in the chase camera.
// If one of these fails you are changing something the owner decided. Do not "fix" the test: ask the owner first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as graphics from '../src/graphics.js';
import { DEFAULTS, settings, setSetting } from '../src/settings.js';
import { createPost } from '../src/post.js';
import { mirrorsInView } from '../src/cockpit.js';
import { Menu } from '../src/menu.js';

const LOCK = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const src = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('one graphics look: no shadow, post, AO, bloom or reflection pass is enabled in the fixed config', () => {
  const R = graphics.RENDER;
  assert.ok(Object.isFrozen(R) && Object.isFrozen(R.mirror), `RENDER must stay frozen. ${LOCK}`);
  const expected = { shadow: null, shadowEvery: 1, probeEvery: 0, msaa: 0, fxaa: false, ao: 0, bloomMips: 0, blurTaps: 0, dofTaps: 8, sharpen: 0, heat: false, grade: false, simple: true, waterEvery: 0, particles: 'low' };
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(R[key], value, `RENDER.${key} must stay ${JSON.stringify(value)} (the old Lighting/Effects OFF). ${LOCK}`);
  assert.deepEqual({ ...R.mirror }, { every: 3, far: 150, width: 384 }, `in-car mirror sharpness is the old Effects OFF tier. ${LOCK}`);
  for (const s of [{ perfClass: 'potato' }, { perfClass: 'high', renderScale: 1, drawDistance: 4000 }, {}])
    assert.equal(graphics.resolveGraphics(s, { deviceRatio: 2 }).R, R, `performance settings must never change the look. ${LOCK}`);
});

test('no graphics presets or lighting / effects levels in settings, the renderer config or the menus', () => {
  for (const name of ['PRESETS', 'PRESET_IDS', 'PRESET_LABELS', 'LIGHTING', 'EFFECTS', 'LEVEL_IDS', 'GRAPHICS_TIERS', 'GRAPHICS_CHOICES', 'detectQuality', 'detectQualityTier', 'applyQualityTier', 'applySceneryQuality'])
    assert.equal(name in graphics, false, `graphics.js must not export ${name}. ${LOCK}`);
  for (const key of ['graphics', 'lighting', 'effects', 'motionBlur']) {
    assert.equal(key in DEFAULTS, false, `settings.${key} must not exist. ${LOCK}`);
    setSetting(key, 'high'); assert.equal(key in settings, false, `setSetting('${key}') must be ignored. ${LOCK}`);
  }
  const html = Object.assign(Object.create(Menu.prototype), { h: {} }).r_settings({ tab: 'video', from: 'pause' });
  for (const key of ['graphics', 'lighting', 'effects', 'motionBlur']) assert.doesNotMatch(html, new RegExp(`data-key="${key}"`), `Settings > Graphics must not offer "${key}". ${LOCK}`);
  assert.doesNotMatch(html, /POTATO|ULTRA|PRESET|LIGHTING|EFFECTS|MOTION BLUR/, `Settings > Graphics must not offer presets or lighting / effects levels. ${LOCK}`);
  assert.equal(DEFAULTS.worldDetail,true,LOCK);
  assert.equal((html.match(/data-key="worldDetail"/g)||[]).length,1,LOCK+' exactly one World detail control');
  const menu = src('src/menu.js'), main = src('src/main.js'), onboarding = src('src/ui/graphics-onboarding.js');
  assert.doesNotMatch(menu + main, /graphicsControl|graphics-quality|PRESET_IDS|LEVEL_IDS|applyQualityTier/, `no hidden preset control. ${LOCK}`);
  assert.doesNotMatch(onboarding, /prompt\s*\(|potato|ultra|Graphics preset/i, `the first-run check must stay silent: no quality prompt. ${LOCK}`);
});

test('the renderer never turns on shadows, the car probe, sea reflections or a post pass beyond tone mapping', () => {
  const main = src('src/main.js'), post = src('src/post.js');
  assert.doesNotMatch(main, /shadowMap\.enabled\s*=(?!\s*false)/, `main.js must not enable shadow maps. ${LOCK}`);
  assert.doesNotMatch(main, /setShadowRange|renderReflection\(|updateProbe|drawRearStrip|post\.setEffects|motionBlur/, `main.js must not render shadows, probe faces, sea reflections or a rear strip. ${LOCK}`);
  assert.doesNotMatch(post, /AOShader|BLOOM_|FXAA|uBloom|uGlare|uRainLens|uSharpen|BLUR_TAPS|uHeat|samples:(?!\s*0\b)/, `post.js must stay tone map + grade (+ orbit DOF). ${LOCK}`);
  // Run the real post chain against a counting renderer: one scene pass + one final pass, nothing else.
  const passes = [], size = new THREE.Vector2(640, 400);
  let target = null;
  const renderer = { getSize: (v) => v.copy(size), getPixelRatio: () => 1, getContext: () => ({ finish() {} }), clear() {},
    setRenderTarget(t) { target = t; }, getRenderTarget: () => target, render(scene) { passes.push(target ? (scene.isScene ? 'scene' : 'offscreen') : 'screen'); } };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const chain = createPost(renderer, scene, camera);
  chain.render(1 / 60);
  assert.deepEqual(passes, ['scene', 'screen'], `the post chain is exactly scene + final. ${LOCK}`);
  passes.length = 0; chain.comp.uDof.value = 5.5; chain.render(1 / 60);
  assert.deepEqual(passes, ['scene', 'offscreen', 'screen'], `only the orbit / garage depth of field adds a pass. ${LOCK}`);
});

test('the chase / third-person camera renders no mirror and pays for no mirror pass', () => {
  for (const cam of ['chase', 'orbit', 'spectate', 'photo']) assert.equal(mirrorsInView(cam), false, `no mirror in the ${cam} camera. ${LOCK}`);
  assert.equal(mirrorsInView('cockpit'), true, `in-car mirrors stay (Settings > Mirrors). ${LOCK}`);
  const main = src('src/main.js'), calls = main.split('\n').filter(l => /\.renderMirrors\(/.test(l));
  assert.ok(calls.length >= 1, `main.js renders the in-car mirrors. ${LOCK}`);
  for (const line of calls) assert.match(line, /if \(mirrorsInView\(G\.cam\)\)/, `every mirror pass must be gated by mirrorsInView. ${LOCK}`);
  assert.doesNotMatch(main + src('src/cockpit.js'), /rearStrip|drawRearStrip/, `no chase-camera rear-view strip. ${LOCK}`);
});
