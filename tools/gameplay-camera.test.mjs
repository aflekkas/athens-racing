import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/input.js';
import { settings, setSetting } from '../src/settings.js';
function mouseRig({ lockWorks = true } = {}) {
  const target = new EventTarget(); target.innerWidth = 800; target.innerHeight = 600;
  const document = { pointerLockElement: null, exitPointerLock() { this.pointerLockElement = null; } };
  let enabled = true, requests = 0;
  const canvas = { requestPointerLock() { requests++; if (!lockWorks) return Promise.reject(Error('unsupported')); document.pointerLockElement = canvas; } };
  const input = new Input({ target, navigator: null, document: null, storage: null }); input.document = document;
  const movements = [], positions = [];
  input.mountMouseLook(canvas, { enabled: () => enabled, move: (...delta) => movements.push(delta), position: (...coords) => positions.push(coords) });
  const pointer = props => { const e = new Event('pointermove'); Object.assign(e, { pointerType: 'mouse', clientX: 400, clientY: 300, buttons: 0, ...props }); Object.defineProperty(e, 'target', { value: canvas }); target.dispatchEvent(e); };
  return { input, document, canvas, movements, positions, pointer, setEnabled: x => { enabled = x; }, requests: () => requests };
}
test('raw mouse movement looks around without a click, and menus do not react', () => {
  const r = mouseRig(); r.pointer({ clientX: 600, clientY: 150 }); assert.deepEqual(r.positions, [[0.5, -0.5]]); assert.equal(r.requests(), 0);
  r.setEnabled(false); r.pointer({ clientX: 700 }); assert.equal(r.positions.length, 1); r.input.destroy();
});
test('race gesture lock uses raw deltas with no buttons; pause releases it and transition retains it', () => {
  const r = mouseRig(); r.input.requestMouseLock(); r.pointer({ movementX: 35, movementY: -12 }); assert.deepEqual(r.movements, [[35, -12]]);
  r.input.update(1 / 60, { inMenu: true, retainMouseLock: true }); assert.equal(r.document.pointerLockElement, r.canvas);
  r.input.update(1 / 60, { inMenu: true }); assert.equal(r.document.pointerLockElement, null); r.input.destroy();
});
test('denied pointer lock falls back to absolute cursor position without holding a button', async () => {
  const r = mouseRig({ lockWorks: false }); r.input.requestMouseLock(); await Promise.resolve(); r.pointer({ clientX: 800, clientY: 0 }); assert.deepEqual(r.positions, [[1, -1]]); r.input.destroy();
});
test('camera preferences clamp FOV/sensitivity and marker/invert choices update live', () => {
  setSetting('chaseFov', 1000); assert.equal(settings.chaseFov, 75); setSetting('cockpitFov', 0); assert.equal(settings.cockpitFov, 45);
  setSetting('mouseSensitivity', -10); assert.equal(settings.mouseSensitivity, 0.25); setSetting('playerMarkers', false); assert.equal(settings.playerMarkers, false); setSetting('invertLookY', true); assert.equal(settings.invertLookY, true);
  setSetting('chaseFov', 58); setSetting('cockpitFov', 66); setSetting('mouseSensitivity', 1); setSetting('playerMarkers', true); setSetting('invertLookY', false);
});
test('overlapping start handlers make one pointer-lock request while the first is pending', async () => {
  const r = mouseRig(); let reject, requests = 0;
  r.canvas.requestPointerLock = () => { requests++; return new Promise((resolve, no) => { reject = no; }); };
  r.input.requestMouseLock(); r.input.requestMouseLock(); assert.equal(requests, 1);
  reject(Error('denied')); await Promise.resolve(); r.pointer({clientX:600}); assert.deepEqual(r.positions, [[0.5, 0]]);
  r.input.requestMouseLock(); assert.equal(requests, 2); reject(Error('denied')); await Promise.resolve(); r.input.destroy();
});
