import test from 'node:test';
import assert from 'node:assert/strict';
import { createHudSway, swayTarget, HUD_MOTION, HUD_SWAY_TUNING } from '../src/hud-sway.js';

const fakeEl = () => ({ style: {} });
const run = (sway, input, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) sway.update(dt, input); };
const px = (el) => el.style.translate.split(' ').map(parseFloat);

test('a right-hand turn swings the HUD outward (left) and leans it, braking dips it', () => {
  const t = swayTarget({ ay: 9.81, ax: -9.81 });
  assert.ok(t.x < 0 && t.r < 0, 'outward and leaning with the turn');
  assert.ok(t.y > 0 && t.s > 0, 'braking dips and leans in');
  assert.ok(swayTarget({ ax: 5 }).y < 0, 'acceleration lifts');
  assert.ok(swayTarget({ lookYaw: 0.8 }).x > 0 && swayTarget({ lookYaw: -0.8 }).x < 0, 'look counter-offset');
});

test('the spring settles on the target and near layers move more than far ones', () => {
  const near = fakeEl(), far = fakeEl(), sway = createHudSway({ near: [near], far: [far] });
  run(sway, { active: true, cam: 'cockpit', mode: 'full', ay: 9.81 }, 4);
  const [nx] = px(near), [fx] = px(far);
  assert.ok(Math.abs(nx + HUD_SWAY_TUNING.latPx) < 0.2, `settled at ${nx}`);
  assert.ok(Math.abs(fx) < Math.abs(nx) * 0.6);
  assert.ok(Math.abs(parseFloat(near.style.rotate)) <= HUD_SWAY_TUNING.maxDeg);
});

test('it lags: the first frame of a corner barely moves, the spring overshoots a little and stays bounded', () => {
  const near = fakeEl(), sway = createHudSway({ near: [near] });
  sway.update(1 / 60, { active: true, cam: 'cockpit', mode: 'full', ay: 9.81 });
  assert.ok(Math.abs(px(near)[0]) < 0.5);
  let peak = 0; for (let i = 0; i < 240; i++) { sway.update(1 / 60, { active: true, cam: 'cockpit', mode: 'full', ay: 30 }); peak = Math.max(peak, Math.abs(px(near)[0])); }
  assert.ok(peak <= HUD_SWAY_TUNING.maxPx);
});

test('chase is gentler than cockpit, subtle gentler than full, off clears styles and pause freezes the mount', () => {
  const settle = (cam, mode) => { const el = fakeEl(), s = createHudSway({ near: [el] }); run(s, { active: true, cam, mode, ay: 8 }, 4); return Math.abs(px(el)[0]); };
  assert.ok(settle('chase', 'full') < settle('cockpit', 'full'));
  assert.ok(settle('cockpit', 'subtle') < settle('cockpit', 'full'));
  assert.equal(HUD_MOTION.off, 0);
  const el = fakeEl(), s = createHudSway({ near: [el] });
  run(s, { active: true, cam: 'cockpit', mode: 'full', ay: 8 }, 1);
  assert.notEqual(el.style.translate, '');
  const frozen = el.style.translate;
  s.update(1 / 60, { active: false, cam: 'cockpit', mode: 'full', ay: 8 });
  assert.equal(el.style.translate, frozen);
  s.update(1 / 60, { active: false, mode: 'off' });
  assert.equal(el.style.translate, ''); assert.equal(el.style.willChange, '');
  s.update(1 / 60, { active: true, cam: 'orbit', mode: 'full', ay: 8 });
  assert.equal(el.style.translate, '', 'the orbit (menu / results) camera never sways');
});

test('a settled HUD stops writing to the DOM', () => {
  let writes = 0; const style = {}; const el = { style: new Proxy(style, { set(o, k, v) { if (k === 'translate') writes++; o[k] = v; return true; } }) };
  const s = createHudSway({ near: [el] }); run(s, { active: true, cam: 'cockpit', mode: 'full', ay: 3 }, 6);
  const before = writes; run(s, { active: true, cam: 'cockpit', mode: 'full', ay: 3 }, 1);
  assert.equal(writes, before);
});

test('suspension spring stays stable at low frame rates', () => {
  const el = fakeEl(), s = createHudSway({ near: [el] });
  for (let i = 0; i < 600; i++) s.update(0.05, { active: true, cam: 'cockpit', mode: 'full', heave: Math.sin(i) * 0.02 });
  assert.ok(Number.isFinite(s.state.b) && Math.abs(s.state.b) < 8);
});
