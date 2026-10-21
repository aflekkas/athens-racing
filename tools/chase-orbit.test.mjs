// Chase orbit regression (owner report 2026-10-20: "I can't seem to pan my mouse around my
// car anymore"). The passive cursor-position look stays removed per the 2026-10-18 playtest
// complaint it caused; the deliberate orbit is click-drag with the left or right button, and the
// view eases back after release. The opt-in pointer-lock free look setting stays as it is.
// C toggles cockpit/outside; B cycles the current mode's position.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Input } from '../src/input.js';
import { settings } from '../src/settings.js';

function mouseRig({ free = false } = {}) {
  const target = new EventTarget(); target.innerWidth = 800; target.innerHeight = 600;
  const document = { pointerLockElement: null, exitPointerLock() { this.pointerLockElement = null; } };
  let enabled = true, requests = 0, freeLook = free;
  const canvas = { requestPointerLock() { requests++; document.pointerLockElement = canvas; } };
  const input = new Input({ target, navigator: null, document: null, storage: null }); input.document = document;
  const movements = [], drags = [];
  input.mountMouseLook(canvas, { enabled: () => enabled, free: () => freeLook, move: (...delta) => movements.push(delta), drag: on => drags.push(on) });
  const fire = (type, props) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { pointerType: 'mouse', clientX: 400, clientY: 300, buttons: 0, button: 0, ...props }); Object.defineProperty(e, 'target', { value: canvas }); target.dispatchEvent(e); };
  const pointer = props => fire('mousemove', props);
  return { input, document, canvas, movements, drags, pointer, fire, setEnabled: x => { enabled = x; }, requests: () => requests };
}

test('dragging with the left or right button held orbits the car', () => {
  for (const [button, buttons] of [[0, 1], [2, 2]]) {
    const r = mouseRig(); r.fire('mousedown', { button, buttons });
    r.pointer({ movementX: 35, movementY: -12, buttons }); assert.deepEqual(r.movements, [[35, -12]]); assert.deepEqual(r.drags, [true]);
    r.fire('mouseup', { button, buttons: 0 }); assert.deepEqual(r.drags, [true, false]);
    r.pointer({ movementX: 50, movementY: 5 }); assert.deepEqual(r.movements, [[35, -12]], 'after the release the mouse is ignored again');
    r.input.destroy();
  }
});

test('plain mouse movement with no button held never moves the camera', () => {
  const r = mouseRig();
  for (let i = 0; i < 20; i++) r.pointer({ clientX: 100 + i * 30, clientY: 50 + i * 10, movementX: 30, movementY: 10 });
  assert.deepEqual(r.movements, [], 'however the cursor moves, no press means no look');
  r.pointer({ movementX: 12, movementY: 3, buttons: 1 }); assert.deepEqual(r.movements, [], 'a hold that started off-canvas is not a drag either');
  r.input.requestMouseLock(); assert.equal(r.requests(), 0, 'no lock without the opt-in');
  r.input.destroy();
});

test('the press-time context menu never cancels a held drag', () => {
  const r = mouseRig(); r.fire('mousedown', { button: 2, buttons: 2 });
  r.fire('contextmenu', { button: 2, buttons: 2 });
  r.pointer({ movementX: 35, movementY: -12, buttons: 2 }); assert.deepEqual(r.movements, [[35, -12]], 'the drag survives its own context menu (Linux/GTK, Mac, Windows)');
  r.fire('mouseup', { button: 2, buttons: 0 });
  r.fire('contextmenu', { button: 2, buttons: 0 }); assert.deepEqual(r.drags, [true, false], 'a released menu still ends the hold');
  r.input.destroy();
});

test('a cancelled pointer releases mouse orbit', () => {
  const r = mouseRig(); r.fire('mousedown', { button: 2, buttons: 2 });
  r.fire('pointercancel', { button: 2, buttons: 0 });
  assert.deepEqual(r.drags, [true, false]);
  r.input.destroy();
});

test('menus never start a look', () => {
  const r = mouseRig(); r.setEnabled(false);
  r.fire('mousedown', { button: 0, buttons: 1 }); r.fire('mousedown', { button: 2, buttons: 2 });
  r.pointer({ movementX: 12, movementY: 3, buttons: 1 }); assert.deepEqual(r.movements, []); assert.deepEqual(r.drags, []);
  r.input.destroy();
});

test('no passive look path is wired anywhere: position and plain are gone', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const inputSrc = readFileSync(new URL('../src/input.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /plain:\s*\(\)/, 'the chase view must not orbit on plain movement');
  assert.doesNotMatch(main, /position\(x,\s*y\)/, 'the cursor position must not steer the look');
  assert.doesNotMatch(inputSrc, /position\?\.|lookPlain/, 'no cursor-position look path in the input layer');
});

test('the pointer-lock free look setting still exists and stays off by default', () => {
  assert.equal(settings.mouseLook, false, 'opt-in, see Settings > Camera > MOUSE FREE LOOK');
  const menu = readFileSync(new URL('../src/menu.js', import.meta.url), 'utf8');
  assert.match(menu, /key: 'mouseLook', label: 'MOUSE FREE LOOK'/);
});

test('C toggles POV/outside and B cycles positions, with no front-facing drive camera', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /cameraViews\.toggle\(\).*cameraViews\.cycle\(\)/);
  assert.doesNotMatch(main, /else if \(G\.cam === 'front'\)/);
  assert.match(main, /viewX=veh\.x-\(worldSession\?\.stream\.origin\.x\|\|0\),viewZ=veh\.z-\(worldSession\?\.stream\.origin\.z\|\|0\)/, 'the camera uses the streamed world origin');
  assert.match(main, /chaseElevation\(up, back, look\.pitch\)/);
});
