import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aidSpec, applyVehicleAids, toggleTractionControl } from '../src/driving-aids.js';
import { settings, setSetting, onSettings } from '../src/settings.js';

test('live TC/ESC toggle restores fitted aids, keeps ABS and mechanical state, and uses the manager', () => {
  const stock = { tc: 0.7, esc: 0.4, edl: 0.2, abs: true }, preferences = { aids: true, abs: true };
  const chassis = {}, corners = [{ esc: 80, edl: 30, abs: 0.8 }];
  const vehicle = { spec: stock, tcCut: 0.7, escCut: 0.2, tcOn: true, escOn: true, sus: chassis, corners, gear: 2, w: 1.4, yaw: -4.2, vLong: 8 };
  const notices = [], change = (key, value) => { preferences[key] = value; applyVehicleAids(vehicle, stock, preferences); };
  const notifications = { toast: (...args) => notices.push(args) };
  const fallback = () => assert.fail('manager must own the notice when available');
  assert.equal(toggleTractionControl({ preferences, change, notifications, toast: fallback }), false);
  assert.deepEqual([vehicle.spec.tc, vehicle.spec.esc, vehicle.spec.edl, vehicle.spec.abs], [0, 0, 0, true]);
  assert.deepEqual([vehicle.tcCut, vehicle.escCut, corners[0].esc, corners[0].edl], [0, 0, 0, 0]);
  assert.equal(vehicle.sus, chassis); assert.equal(vehicle.corners, corners);
  assert.deepEqual([vehicle.gear, vehicle.w, vehicle.yaw, vehicle.vLong], [2, 1.4, -4.2, 8]);
  assert.equal(notices[0][0], 'TC OFF'); assert.equal(notices[0][1].id, 'traction-control');
  assert.equal(toggleTractionControl({ preferences, change, notifications }), true);
  assert.equal(vehicle.spec, stock); assert.equal(notices[1][0], 'TC ON');
  assert.equal(aidSpec(stock, { aids: true, abs: false }).abs, false);
});

test('production flow toggles live in solo/online racing, settings subscriber runs, and menus consume it', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const flow = source.slice(source.indexOf('function flowAction(name)'), source.indexOf('const inMenu = ()'));
  const G = { state: 'race' }, menu = { open: false, action: () => true }, notices = [];
  const controls = { toast: text => notices.push(text) };
  const run = Function('menu', 'G', 'document', 'ui', 'multiplayer', 'window', 'MENU_STATES', 'toggleTractionControl', 'controls', flow + '; return flowAction;')(
    menu, G, { body: { dataset: {} } }, { action: () => false }, { panel: { hidden: true } }, {}, ['menu', 'paused', 'results'], toggleTractionControl, controls);
  let updates = 0;
  const original = settings.aids, unsubscribe = onSettings((s, key) => { if (key === 'aids') updates++; });
  try {
    setSetting('aids', true); updates = 0;
    assert.equal(run('tractionControl'), true); assert.equal(settings.aids, false); assert.equal(updates, 1); assert.equal(notices.at(-1), 'TC OFF');
    menu.open = true; run('tractionControl'); assert.equal(settings.aids, false); assert.equal(updates, 1);
    menu.open = false; G.state = 'onlineCountdown'; run('tractionControl'); assert.equal(settings.aids, true);
    G.state = 'finished'; run('tractionControl'); assert.equal(settings.aids, true);
  } finally { unsubscribe(); setSetting('aids', original); }
});
