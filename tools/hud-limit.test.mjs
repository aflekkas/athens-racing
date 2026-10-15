import test from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud.js';
const fixture = () => {
  const attrs = new Set();
  const sign = { dataset: {}, hidden: true, hasAttribute: k => attrs.has(k), setAttribute: k => attrs.add(k), removeAttribute: k => attrs.delete(k), toggleAttribute: (k, on) => on ? attrs.add(k) : attrs.delete(k) };
  const hud = Object.create(Hud.prototype); hud.el = { limitSign: sign, limitV: {} };
  return { hud, sign };
};
test('threshold hunting cannot chop or restart a four-flash burst; the halo follows current speed', () => {
  const { hud, sign } = fixture(), limit = { v: 50, src: 'osm' };
  hud.setLimit(limit, 53.1);
  assert.ok(sign.hasAttribute('data-flashing')); assert.ok(sign.hasAttribute('data-over'));
  // Replay the short bursts from the logged drive: 53.1 -> 50.8 -> 53.1 -> 50.9.
  for (const kmh of [50.8, 53.1, 50.9]) { hud.setLimit(limit, kmh); assert.ok(sign.hasAttribute('data-flashing')); }
  assert.equal(sign.hasAttribute('data-over'), false);
  hud.finishLimitFlash({ animationName: 'limitFlashV' }); assert.ok(sign.hasAttribute('data-flashing'));
  hud.finishLimitFlash({ animationName: 'limitFlash' }); assert.equal(sign.hasAttribute('data-flashing'), false);
  hud.setLimit(limit, 53.1); assert.ok(sign.hasAttribute('data-flashing'), 'a later warning starts a new burst');
  hud.finishLimitFlash({ animationName: 'limitFlash' });
  hud.setLimit(limit, 70); assert.equal(sign.hasAttribute('data-flashing'), false, 'steady overspeed holds halo without looping');
  assert.ok(sign.hasAttribute('data-over')); assert.equal(sign.hidden, false);
});
test('unknown roads hide the sign; reduced motion uses only the halo', () => {
  const { hud, sign } = fixture(); const previous = globalThis.matchMedia;
  try {
    globalThis.matchMedia = () => ({ matches: true });
    hud.setLimit({ v: 50 }, 60); assert.ok(sign.hasAttribute('data-over')); assert.equal(sign.hasAttribute('data-flashing'), false);
    hud.setLimit(null, 60); assert.equal(sign.hidden, true); assert.equal(sign.hasAttribute('data-over'), false);
  } finally { globalThis.matchMedia = previous; }
});
