// Owner playtest 2026-10-18: the look-back camera (B) and opt-in mouse look must be visible where controls are listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { controlsStrip } from '../src/ui/driving-hints.js';
import { input } from '../src/input.js';
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
test('the race-start key hints list LOOK BACK with its binding, for keyboard and controller', () => {
  const keyboard = text(controlsStrip({ device: 'keyboard' })), pad = text(controlsStrip({ device: 'gamepad' }));
  assert.match(keyboard, /B\s*LOOK BACK/); assert.match(pad, /RS\s*LOOK BACK/);
  assert.match(keyboard, /HOLD TO LOOK/, 'the mouse hint says a button is held; it does not claim the mouse looks by itself');
  assert.doesNotMatch(keyboard, /CLICK ROAD TO CAPTURE/);
  const was = input.bindings.keyboard.lookBack; input.bindings.keyboard.lookBack = ['KeyN'];
  try { assert.match(text(controlsStrip({ device: 'keyboard' })), /N\s*LOOK BACK/, 'follows rebinding'); } finally { input.bindings.keyboard.lookBack = was; }
});
test('Settings > Controls lists LOOK BACK with both columns, and Settings > Camera has the mouse free look toggle', () => {
  const panel = readFileSync(new URL('../src/ui/controls-panel.js', import.meta.url), 'utf8'), menu = readFileSync(new URL('../src/menu.js', import.meta.url), 'utf8');
  assert.match(panel, /lookBack: 'LOOK BACK'/);
  assert.ok('lookBack' in input.bindings.keyboard && 'lookBack' in input.bindings.gamepad);
  assert.match(menu, /key: 'mouseLook', label: 'MOUSE FREE LOOK'/);
  assert.match(menu, /\['camera', 'POV \/ OUTSIDE'\]/);
  assert.match(menu, /\['cameraPosition', 'VIEW POSITION'\]/);
  assert.match(menu, /\['lookBack', 'LOOK BACK \(HOLD\)'\]/);
});
