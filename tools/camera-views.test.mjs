import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAMERA_POSITIONS, MAX_CHASE_ELEVATION, chaseElevation, createCameraViews } from '../src/camera-views.js';
import { DEFAULT_BINDINGS, Input } from '../src/input.js';
import { renderControls } from '../src/ui/controls-panel.js';
import { controlsStrip } from '../src/ui/driving-hints.js';

const store = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
};

test('mode toggle and position cycle are independent, and positions survive recreation', () => {
  const storage = store(), views = createCameraViews(null, storage);
  assert.equal(views.current, 'cockpit', 'races and free roam start in the driver seat');
  assert.deepEqual(CAMERA_POSITIONS.outside, ['chase', 'far', 'bumper']);
  assert.deepEqual(CAMERA_POSITIONS.pov, ['cockpit'], 'hood POV is retired');
  assert.equal(views.cycle(), 'cockpit', 'one POV position: cycling is a no-op');
  assert.equal(views.toggle(), 'chase', 'C toggles POV / outside');
  assert.equal(views.cycle(), 'far'); assert.equal(views.toggle(), 'cockpit');
  assert.equal(views.cycle(), 'cockpit');
  const again = createCameraViews(null, storage);
  assert.equal(again.current, 'cockpit'); assert.equal(again.toggle(), 'far', 'the cycled outside position survived recreation');
});

test('legacy hood (query or saved) resolves to the cockpit driver seat', () => {
  const hoodQuery = createCameraViews('hood', store());
  assert.equal(hoodQuery.current, 'cockpit');
  const storage = store();
  storage.setItem('paraliaki.camera.views', JSON.stringify({ outside: 'chase', pov: 'hood' }));
  const saved = createCameraViews(null, storage);
  assert.equal(saved.current, 'cockpit', 'stale saved POV hood falls back to cockpit');
  assert.equal(saved.toggle(), 'chase');
});

test('chase elevation cannot become top-down even from extreme mouse input or tall vehicles', () => {
  for (const up of [1.75, 4, 10]) for (const pitch of [-9, 0, .24, 10, Infinity, NaN]) {
    const elevation = chaseElevation(up, 6, pitch);
    assert.ok(elevation <= MAX_CHASE_ELEVATION && elevation >= -.08);
  }
  assert.ok(MAX_CHASE_ELEVATION < Math.PI / 6);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /look\.zoom|1\.35/, 'legacy wheel zoom and steep orbit clamp are gone');
  assert.match(main, /look\.idleT > recentre/, 'released orbit returns to the road');
  assert.match(main, /look\.dragging \? STALE_DRAG_RECENTRE_DELAY/, 'a lost mouse release cannot keep orbit active forever');
  assert.doesNotMatch(main, /look\.dragging \? Infinity/);
});

test('both controls are distinct and rebindable on keyboard and gamepad', () => {
  for (const kind of ['keyboard', 'gamepad']) {
    assert.ok(DEFAULT_BINDINGS[kind].camera.length);
    assert.ok(DEFAULT_BINDINGS[kind].cameraPosition.length);
    assert.notDeepEqual(DEFAULT_BINDINGS[kind].camera, DEFAULT_BINDINGS[kind].cameraPosition);
  }
  const input = new Input({ target: new EventTarget(), navigator: null, document: null, storage: store() });
  assert.equal(input.bind('keyboard', 'cameraPosition', ['KeyC']), false);
  assert.equal(input.bind('keyboard', 'lookBack', ['KeyC']), false, 'look-back cannot take the camera key');
  assert.equal(input.bind('keyboard', 'lookBack', ['KeyP']), false, 'look-back cannot take the position-cycle key');
  assert.equal(input.bind('keyboard', 'cameraPosition', ['KeyB']), false, 'position cycling cannot take the look-back key');
  assert.equal(input.bind('keyboard', 'cameraPosition', ['KeyN']), true);
  assert.equal(input.bind('gamepad', 'cameraPosition', ['b16']), true);
  input.destroy();
  const legacy = store();
  legacy.setItem('paraliaki.input.keyboard', JSON.stringify({ camera: ['KeyB'] }));
  legacy.setItem('paraliaki.input.gamepad', JSON.stringify({ camera: ['b8'] }));
  const migrated = new Input({ target: new EventTarget(), navigator: null, document: null, storage: legacy });
  assert.deepEqual(migrated.bindings.keyboard.cameraPosition, ['KeyP']);
  assert.deepEqual(migrated.bindings.keyboard.lookBack, ['KeyV'], 'custom camera keeps B alone; inherited look-back takes V');
  assert.deepEqual(migrated.bindings.gamepad.cameraPosition, ['b16']);
  migrated.destroy();
});

test('Settings Controls and driving hints render both current bindings', () => {
  const html = renderControls({ root: { dataset: {} } });
  assert.match(html, /TOGGLE POV \/ OUTSIDE/);
  assert.match(html, /CYCLE VIEW POSITION/);
  assert.match(html, /data-action="cameraPosition"/);
  const strip = controlsStrip({ device: 'keyboard' });
  assert.match(strip, /POV \/ OUTSIDE/); assert.match(strip, /VIEW POSITION/);
  const menu = readFileSync(new URL('../src/menu.js', import.meta.url), 'utf8');
  assert.match(menu, /\['cameraPosition', 'VIEW POSITION'\]/);
});

test('the separate streamed Athens free roam entry uses the same camera controls', () => {
  const source = readFileSync(new URL('../src/athens-world.js', import.meta.url), 'utf8');
  assert.match(source, /cameraViews\.toggle\(\).*cameraViews\.cycle\(\)/);
  assert.match(source, /cam==='chase'\|\|cam==='far'/);
  assert.match(source, /cam==='bumper'/);
  assert.match(source, /player\.cockpit\.setVisible\(cock\)/);
  assert.doesNotMatch(source, /cam==='front'/);
  assert.match(source, /input\.state\.lookBack/, 'Athens honours held look-back');
  assert.doesNotMatch(source, /cam==='hood'/, 'hood is not a selectable Athens view');
  // NOTE: the Athens live-mirror pass (mirrorsInView) lands with the mirror commit; its assertion returns there.
});
