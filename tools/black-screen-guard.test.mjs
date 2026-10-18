import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBlackout } from '../src/blackout.js';

// Owner playtest 2026-10-18: "it goes to black and comes back" and a retired driver stuck spectating with no cursor.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('main.js never touches the overlay class itself: every blackout carries the watchdog', () => {
  assert.doesNotMatch(main, /classList\.(add|remove|toggle)\('fading'/);
  assert.match(main, /const blackout = createBlackout\(/);
});

test('the watchdog ends a blackout nobody released, and an owner release cancels it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set(), body = { classList: { toggle: (c, on) => on ? classes.add(c) : classes.delete(c), remove: c => classes.delete(c) } };
  let notified = 0; const blackout = createBlackout(() => notified++, { body, max: 5000 });
  blackout(true, { onTimeout: true }); assert.ok(classes.has('fading'));
  t.mock.timers.tick(4999); assert.ok(classes.has('fading'));
  t.mock.timers.tick(1); assert.ok(!classes.has('fading'), 'the screen comes back on its own'); assert.equal(notified, 1);
  blackout(true, { onTimeout: true }); blackout(false); t.mock.timers.tick(10000); assert.equal(notified, 1, 'a released blackout never fires the watchdog');
  blackout(true); t.mock.timers.tick(5000); assert.ok(!classes.has('fading')); assert.equal(notified, 1);
});

test('a tow without a connection explains itself instead of fading to black', () => {
  const tow = main.slice(main.indexOf('function tow(pv'), main.indexOf('function resetCar()'));
  assert.ok(tow.indexOf('!multiplayer.connected') > 0 && tow.indexOf('!multiplayer.connected') < tow.indexOf('blackout(true'));
  assert.match(tow, /catch \(error\) \{ G\.towing = false; blackout\(false\); console\.error/, 'an exception cannot leave the screen black');
});

test('a retired or finished online driver does not get the pointer locked back', () => {
  const resume = main.slice(main.indexOf('function resume()'), main.indexOf('function openSettings'));
  assert.match(resume, /multiplayer\.retired \|\| multiplayer\.me\?\.finish != null/);
  assert.match(main, /if \(watching\) controls\.releaseMouseLook\(\)/);
});
