// The Attica maps' wheel input (owner 2026-10-20, docs/OWNER-DECISIONS.md "Free roam: click anywhere on the map, no POI
// list; trackpad pans"): a two-finger trackpad scroll pans, a pinch (ctrl+wheel) zooms, a mouse wheel keeps zooming.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wheelKind, createWheelClassifier, wheelZoomFactor, wheelPan, createGlide, GESTURE_MS } from '../src/map-wheel.js';

const OWNER = 'Owner-locked decision (2026-10-20: trackpad pans, pinch and mouse wheel zoom), see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const wheel = (o = {}) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, timeStamp: 0, ...o });

test('pan versus zoom by event type', () => {
  // Trackpad: two-finger scrolls in pixels, small and often fractional, with or without a sideways component.
  assert.equal(wheelKind(wheel({ deltaY: 4.5 })), 'pan', `a small vertical trackpad scroll pans. ${OWNER}`);
  assert.equal(wheelKind(wheel({ deltaY: -12 })), 'pan', OWNER);
  assert.equal(wheelKind(wheel({ deltaX: 30, deltaY: 2 })), 'pan', `any sideways scroll pans. ${OWNER}`);
  assert.equal(wheelKind(wheel({ deltaX: -80 })), 'pan', OWNER);
  assert.equal(wheelKind(wheel({ deltaY: 66.5 })), 'pan', `a fast fractional trackpad flick still pans. ${OWNER}`);
  // Pinch: the browser sends ctrl+wheel.
  assert.equal(wheelKind(wheel({ deltaY: -3.2, ctrlKey: true })), 'zoom', `a pinch zooms. ${OWNER}`);
  assert.equal(wheelKind(wheel({ deltaX: 5, deltaY: 1, ctrlKey: true })), 'zoom', OWNER);
  // Mouse wheel: line or page mode (Firefox, most mice on Linux / Windows), or large whole-number pixel notches (Chrome, Safari).
  assert.equal(wheelKind(wheel({ deltaY: 3, deltaMode: 1 })), 'zoom', `a line-mode wheel zooms. ${OWNER}`);
  assert.equal(wheelKind(wheel({ deltaY: -1, deltaMode: 2 })), 'zoom', OWNER);
  assert.equal(wheelKind(wheel({ deltaY: 100 })), 'zoom', `a 100 px notch zooms. ${OWNER}`);
  assert.equal(wheelKind(wheel({ deltaY: -120 })), 'zoom', OWNER);
});

test('a gesture keeps its kind until the wheel rests', () => {
  const kind = createWheelClassifier();
  // A trackpad scroll that grows into one large whole-number event mid-gesture keeps panning.
  assert.equal(kind(wheel({ deltaY: 3.5, timeStamp: 0 })), 'pan');
  assert.equal(kind(wheel({ deltaY: 100, timeStamp: 16 })), 'pan', 'mid-gesture: still a pan');
  // After a rest a notched wheel zooms, and keeps zooming even if a notch arrives as a small delta.
  assert.equal(kind(wheel({ deltaY: 100, timeStamp: 16 + GESTURE_MS + 50 })), 'zoom');
  assert.equal(kind(wheel({ deltaY: 4, timeStamp: 16 + GESTURE_MS + 80 })), 'zoom');
  // A pinch always zooms, even straight after a scroll.
  assert.equal(kind(wheel({ deltaY: 2, timeStamp: 2000 })), 'pan');
  assert.equal(kind(wheel({ deltaY: 2, ctrlKey: true, timeStamp: 2010 })), 'zoom');
});

test('zoom direction and pinch sensitivity, pan follows the fingers', () => {
  assert.ok(wheelZoomFactor(wheel({ deltaY: -100 })) > 1, 'wheel up zooms in'); assert.ok(wheelZoomFactor(wheel({ deltaY: 100 })) < 1, 'wheel down zooms out');
  assert.ok(wheelZoomFactor(wheel({ deltaY: 3, deltaMode: 1 })) < 1, 'lines are converted to pixels');
  const pinch = wheelZoomFactor(wheel({ deltaY: -5, ctrlKey: true })), notch = wheelZoomFactor(wheel({ deltaY: -5 }));
  assert.ok(pinch > notch && pinch < 1.2, 'a pinch, which sends small deltas, zooms at a usable rate');
  assert.ok(wheelZoomFactor(wheel({ deltaY: -5000 })) < 1.7, 'one huge event is clamped');
  assert.deepEqual(wheelPan(wheel({ deltaX: 10, deltaY: -4 })), [-10, 4], 'scrolling right moves the map left, like a page');
  assert.deepEqual(wheelPan(wheel({ deltaX: 1, deltaY: 2, deltaMode: 1 })), [-16, -32], 'line deltas pan in pixels');
});

test('a released drag glides to a stop; a pause before letting go does not fling', () => {
  const g = createGlide();
  for (let t = 0; t <= 100; t += 16) g.track(12, 0, t);
  assert.equal(g.release(110), true, 'still moving at release: it glides');
  let travelled = 0, steps = 0, d;
  while ((d = g.step(1 / 60)) && steps < 600) { travelled += d[0]; steps++; }
  assert.ok(travelled > 20 && steps < 120, `glides on (${travelled.toFixed(0)} px) and stops within two seconds (${steps} frames)`);
  const h = createGlide(); for (let t = 0; t <= 100; t += 16) h.track(12, 0, t);
  assert.equal(h.release(400), false, 'held still before letting go: no glide');
});

test('both Attica maps use it: Track select and the free roam picker', () => {
  for (const file of ['src/map-select.js', 'src/spawn-select.js']) {
    const code = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(code, /from '\.\/map-wheel\.js'/, `${file} imports the shared wheel input. ${OWNER}`);
    assert.match(code, /wheelKind\(e\) === 'zoom'\) \{ zoomAt\(wheelZoomFactor\(e\)/, `${file}: zoom-kind events zoom. ${OWNER}`);
    assert.match(code, /const \[dx, dy\] = wheelPan\(e\); camera\.x \+= dx; camera\.y \+= dy;/, `${file}: pan-kind events pan. ${OWNER}`);
    assert.match(code, /glide\.track\(/, `${file}: drag feeds the glide. ${OWNER}`);
  }
});
