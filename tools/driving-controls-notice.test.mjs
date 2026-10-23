// The race DRIVING CONTROLS tip read "LMANUAL / AUTOEPADDLE UPQPADDLE DOWNSPACEHANDBRAKE…": the key-cap strip was
// flattened to text before it reached the notice card. The card now carries the kit strip as key | action rows, and
// its screen-reader line keeps every binding separated from its action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { controlsStrip, controlsText, drivingHints } from '../src/ui/driving-hints.js';
import { notifications, notificationText } from '../src/ui/notifications.js';
import { input } from '../src/input.js';

const rows = html => [...html.matchAll(/<span><span class="driving-controls__keys">(.*?)<\/span><b>(.*?)<\/b><\/span>/g)]
  .map(([, keys, label]) => ({ keys: [...keys.matchAll(/<kbd[^>]*>(.*?)<\/kbd>/g)].map(m => m[1]), label }));

test('the strip is one key-cap group and one action label per row, for keyboard and controller', () => {
  const kb = rows(controlsStrip({ device: 'keyboard' })), pad = rows(controlsStrip({ device: 'gamepad' }));
  assert.equal(kb.length, 10, 'nine bindings plus the mouse look row');
  assert.equal(pad.length, 7, 'no mouse row on a controller, and no rows for its unbound TOW and BIG MAP');
  for (const r of [...kb, ...pad]) { assert.ok(r.keys.length >= 1 && r.keys.every(Boolean), `keys for ${r.label}`); assert.ok(r.label.trim(), 'label'); }
  assert.deepEqual(kb.slice(0, 3).map(r => [r.keys, r.label]), [[['L'], 'MANUAL / AUTO'], [['E', 'Q'], 'PADDLE UP / DOWN'], [['SPACE'], 'HANDBRAKE']]);
  assert.deepEqual(rows(controlsStrip({ device: 'keyboard', manual: true }))[1].label, 'SHIFT UP / DOWN');
  assert.match(pad.find(r => r.label === 'LOOK BACK').keys[0], /RS/);
  const mouse = kb.at(-1);
  assert.equal(mouse.label, 'HOLD TO LOOK');
  assert.match(mouse.keys[0], /ico-mouse|#mouse/, 'the mouse row is the Lucide mouse in a key cap');
  assert.doesNotMatch(mouse.keys[0], /arrow-right/, 'not "RIGHT" turned into an arrow icon');
});

test('the readable line keeps every binding apart from its action and follows rebinding', () => {
  const line = controlsText({ device: 'keyboard' });
  assert.match(line, /^L: MANUAL \/ AUTO\. E \/ Q: PADDLE UP \/ DOWN\. SPACE: HANDBRAKE\./);
  assert.match(line, /MOUSE BUTTON: HOLD TO LOOK\.$/);
  assert.doesNotMatch(line, /AUTOE|UPQ|DOWNSPACE|HANDBRAKEX|BACKR|TOWM|MAPMOUSE/, 'no run-together keys and labels');
  assert.equal(notificationText(line), line, 'the notice keeps the line as written');
  const was = input.bindings.keyboard.camera;input.bindings.keyboard.camera = ['KeyV'];
  try {
    assert.match(controlsText({ device: 'keyboard' }), /V: POV \/ OUTSIDE\./);
    assert.ok(rows(controlsStrip({ device: 'keyboard' })).some(r => r.keys[0] === 'V' && r.label === 'POV / OUTSIDE'));
  } finally { input.bindings.keyboard.camera = was; }
  assert.doesNotMatch(controlsText({ device: 'gamepad' }), /MOUSE/);
});

test('the race tip posts the structured strip as the card body, not flattened text', () => {
  const posts = [], post = notifications.post, now = Date.now, real = now();let t = real;
  notifications.post = value => { posts.push(value);return value.id; };Date.now = () => t;
  try {
    drivingHints.update({ state: 'menu', device: 'keyboard', manual: false });
    drivingHints.update({ state: 'race', device: 'keyboard', manual: false });
    t += 11000;drivingHints.update({ state: 'race', device: 'keyboard', manual: false });
  } finally { notifications.post = post;Date.now = now; }
  const tip = posts.find(p => p.id === 'tip:controls');
  assert.ok(tip, 'the controls tip is posted ten seconds into a race');
  assert.equal(tip.title, 'DRIVING CONTROLS');
  assert.equal(tip.text, controlsText({ device: 'keyboard', manual: false }));
  assert.equal(tip.body, controlsStrip({ device: 'keyboard', manual: false }));
  assert.deepEqual(tip.actions.map(a => a.label), ['HIDE TIPS']);
});

test('the notice card renders a body under its title and keeps the text for screen readers only', () => {
  const src = readFileSync(new URL('../src/ui/notifications.js', import.meta.url), 'utf8');
  assert.match(src, /if\(item\.body\)text\.className='sr-only'/);
  assert.match(src, /if\(item\.body\)\{const t=document\.createElement\('template'\);t\.innerHTML=item\.body;card\.append\(t\.content\);\}/);
  const css = readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8');
  assert.match(css, /\.race-notice \.driving-controls \{ display: grid; grid-template-columns: max-content minmax\(0, 1fr\);/);
  assert.match(css, /\.race-notice \.driving-controls > span \{ display: contents; \}/);
});

// Unbound actions (the controller's TOW and BIG MAP by default; controller towing is the tow prompt's D-pad down, A) have no row
// and no tip: never an UNBOUND key cap or "UNBOUND returns you to the road". A custom binding brings them straight back.
test('fully unbound actions have no row; a custom controller binding brings TOW and BIG MAP back; keyboard keeps both', () => {
  const pad = rows(controlsStrip({ device: 'gamepad' })), kb = rows(controlsStrip({ device: 'keyboard' }));
  assert.ok(!pad.some(r => r.label === 'TOW' || r.label === 'BIG MAP'));
  assert.doesNotMatch(controlsStrip({ device: 'gamepad' }) + controlsText({ device: 'gamepad' }), /UNBOUND/);
  assert.deepEqual(kb.filter(r => ['TOW', 'BIG MAP'].includes(r.label)).map(r => [r.keys, r.label]), [[['R / T'], 'TOW'], [['M'], 'BIG MAP']]);
  const was = { tow: input.bindings.gamepad.tow, map: input.bindings.gamepad.map };
  input.bindings.gamepad.tow = ['b2']; input.bindings.gamepad.map = ['b8'];
  try {
    const bound = rows(controlsStrip({ device: 'gamepad' }));
    assert.deepEqual(bound.filter(r => ['TOW', 'BIG MAP'].includes(r.label)).map(r => [r.keys, r.label]), [[['X'], 'TOW'], [['VIEW'], 'BIG MAP']]);
    assert.match(controlsText({ device: 'gamepad' }), /X: TOW\. VIEW: BIG MAP\./);
  } finally { Object.assign(input.bindings.gamepad, was); }
  const shift = input.bindings.gamepad.shiftDown; input.bindings.gamepad.shiftDown = [];
  try { assert.deepEqual(rows(controlsStrip({ device: 'gamepad' }))[1].keys, ['RB', 'UNBOUND'], 'a row with one bound key stays'); }
  finally { input.bindings.gamepad.shiftDown = shift; }
});

function nextTip(device) {
  const posts = [], post = notifications.post, now = Date.now;let t = now() + 1e9;
  for (const k of Object.keys(drivingHints.saved)) delete drivingHints.saved[k];
  Object.assign(drivingHints.saved, { controls: true, manual: true, handbrake: true, camera: true, cameraPosition: true });
  notifications.post = value => { posts.push(value);return value.id; };Date.now = () => t;
  try {
    drivingHints.lastState = 'menu';drivingHints.update({ state: 'race', device, manual: false });
    t += 11000;drivingHints.update({ state: 'race', device, manual: false });
  } finally { notifications.post = post;Date.now = now; }
  return posts.find(p => p.id.startsWith('tip:'));
}
test('a progressive tip whose key is unbound is skipped, not shown as UNBOUND; bound again, it returns', () => {
  const pad = nextTip('gamepad');
  assert.equal(pad.id, 'tip:lookBack', 'the unbound controller TOW tip is skipped');
  assert.equal(drivingHints.saved.tow, undefined, 'and not marked seen, so binding TOW later still teaches it');
  assert.doesNotMatch(pad.text, /UNBOUND/);
  const was = input.bindings.gamepad.tow;input.bindings.gamepad.tow = ['b2'];
  try { const tip = nextTip('gamepad');assert.equal(tip.id, 'tip:tow');assert.equal(tip.text, 'X returns you to the road.'); }
  finally { input.bindings.gamepad.tow = was; }
  assert.equal(nextTip('keyboard').text, 'R / T returns you to the road.', 'keyboard unchanged');
});
