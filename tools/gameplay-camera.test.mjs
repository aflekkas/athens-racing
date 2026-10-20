import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/input.js';
import { settings, setSetting } from '../src/settings.js';
// Deliberate orbit only: dragging with the left or right button held looks around (the press-time
// context menu on Linux never cancels the hold), and the opt-in free look covers raw movement under
// pointer lock. Plain mouse movement with no button held never moves the camera.
function mouseRig({ lockWorks = true, free = false } = {}) {
  const target = new EventTarget(); target.innerWidth = 800; target.innerHeight = 600;
  const document = { pointerLockElement: null, exitPointerLock() { this.pointerLockElement = null; } };
  let enabled = true, requests = 0, freeLook = free;
  const canvas = { requestPointerLock() { requests++; if (!lockWorks) return Promise.reject(Error('unsupported')); document.pointerLockElement = canvas; } };
  const input = new Input({ target, navigator: null, document: null, storage: null }); input.document = document;
  const movements = [], drags = [];
  input.mountMouseLook(canvas, { enabled: () => enabled, free: () => freeLook, move: (...delta) => movements.push(delta), drag: on => drags.push(on) });
  const fire = (type, props) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { pointerType: 'mouse', clientX: 400, clientY: 300, buttons: 0, button: 0, ...props }); Object.defineProperty(e, 'target', { value: canvas }); target.dispatchEvent(e); };
  const pointer = props => fire('mousemove', props);
  return { input, document, canvas, movements, drags, pointer, fire, setEnabled: x => { enabled = x; }, setFree: x => { freeLook = x; }, requests: () => requests };
}

// Owner playtest 2026-10-18 (friend): "the camera is really weird, it pans around with the mouse". Mouse look is opt-in now.
test('by default the mouse never pans the view, however it moves, and no pointer lock is requested', () => {
  const r = mouseRig();
  for (let i = 0; i < 20; i++) r.pointer({ clientX: 100 + i * 30, clientY: 50 + i * 10, movementX: 30, movementY: 10 });
  assert.deepEqual(r.movements, []); r.input.requestMouseLock(); assert.equal(r.requests(), 0); assert.equal(r.document.pointerLockElement, null);
  r.pointer({ movementX: 12, movementY: 3, buttons: 1 }); assert.deepEqual(r.movements, [], 'a button held without an on-canvas press is not a look gesture either');
  r.input.destroy();
});
test('holding the left or right button and dragging looks around, and releasing reports the end of the hold', () => {
  for (const [button, buttons] of [[0, 1], [2, 2]]) {
    const r = mouseRig(); r.fire('mousedown', { button, buttons });
    r.pointer({ movementX: 35, movementY: -12, buttons }); assert.deepEqual(r.movements, [[35, -12]]); assert.deepEqual(r.drags, [true]);
    r.fire('mouseup', { button, buttons: 0 }); assert.deepEqual(r.drags, [true, false]);
    r.pointer({ movementX: 50, movementY: 5 }); assert.deepEqual(r.movements, [[35, -12]], 'after the release the mouse is ignored again');
    r.setEnabled(false); r.fire('mousedown', { button, buttons }); assert.deepEqual(r.drags, [true, false], 'menus never start a look'); r.input.destroy();
  }
});
test('the press-time context menu never cancels a held drag', () => {
  const r = mouseRig(); r.fire('mousedown', { button: 2, buttons: 2 });
  r.fire('contextmenu', { button: 2, buttons: 2 });
  r.pointer({ movementX: 35, movementY: -12, buttons: 2 }); assert.deepEqual(r.movements, [[35, -12]], 'the drag survives its own context menu (Linux/GTK, Mac, Windows)');
  r.fire('mouseup', { button: 2, buttons: 0 });
  r.fire('contextmenu', { button: 2, buttons: 0 }); assert.deepEqual(r.drags, [true, false], 'a released menu still reports the end of the hold');
  r.input.destroy();
});
test('a clear (pause, menu, blur) ends a hold', () => {
  const r = mouseRig(); r.fire('mousedown', { button: 2, buttons: 2 }); r.input.clear(); assert.deepEqual(r.drags, [true, false]);
  r.pointer({ movementX: 9, buttons: 2 }); assert.deepEqual(r.movements, []); r.input.destroy();
});
test('free look is opt-in: raw deltas under pointer lock, pause releases it and a transition retains it', () => {
  const r = mouseRig({ free: true }); r.input.requestMouseLock(); assert.equal(r.requests(), 1);
  r.pointer({ movementX: 35, movementY: -12 }); assert.deepEqual(r.movements, [[35, -12]]);
  r.input.update(1 / 60, { inMenu: true, retainMouseLock: true }); assert.equal(r.document.pointerLockElement, r.canvas);
  r.input.update(1 / 60, { inMenu: true }); assert.equal(r.document.pointerLockElement, null);
  r.setEnabled(false); r.pointer({ movementX: 70 }); assert.equal(r.movements.length, 1, 'menus do not react'); r.input.destroy();
});
test('free look without pointer lock needs a held button: the cursor position never looks', async () => {
  const r = mouseRig({ lockWorks: false, free: true }); r.input.requestMouseLock(); await Promise.resolve();
  r.pointer({ clientX: 800, clientY: 0, movementX: 400, movementY: -300 }); assert.deepEqual(r.movements, []);
  r.pointer({ movementX: 8, movementY: 2, buttons: 1 }); assert.deepEqual(r.movements, [[8, 2]]); r.input.destroy();
});
test('turning free look off stops lock requests at once', () => {
  const r = mouseRig({ free: true }); r.setFree(false); r.input.requestMouseLock(); assert.equal(r.requests(), 0); r.input.destroy();
});
test('camera preferences clamp FOV/sensitivity and marker/invert choices update live', () => {
  setSetting('chaseFov', 1000); assert.equal(settings.chaseFov, 75); setSetting('cockpitFov', 0); assert.equal(settings.cockpitFov, 45);
  setSetting('mouseSensitivity', -10); assert.equal(settings.mouseSensitivity, 0.25); setSetting('playerMarkers', false); assert.equal(settings.playerMarkers, false); setSetting('invertLookY', true); assert.equal(settings.invertLookY, true);
  setSetting('chaseFov', 58); setSetting('cockpitFov', 66); setSetting('mouseSensitivity', 1); setSetting('playerMarkers', true); setSetting('invertLookY', false);
});
test('overlapping start handlers make one pointer-lock request while the first is pending', async () => {
  const r = mouseRig({ free: true }); let reject, requests = 0;
  r.canvas.requestPointerLock = () => { requests++; return new Promise((resolve, no) => { reject = no; }); };
  r.input.requestMouseLock(); r.input.requestMouseLock(); assert.equal(requests, 1);
  reject(Error('denied')); await Promise.resolve(); r.pointer({ clientX: 600, movementX: 5 }); assert.deepEqual(r.movements, []);
  r.input.requestMouseLock(); assert.equal(requests, 2); reject(Error('denied')); await Promise.resolve(); r.input.destroy();
});
test('mouse free look is off by default and saved as a camera flag', () => {
  assert.equal(settings.mouseLook, false); setSetting('mouseLook', true); assert.equal(settings.mouseLook, true); setSetting('mouseLook', false); assert.equal(settings.mouseLook, false);
});
