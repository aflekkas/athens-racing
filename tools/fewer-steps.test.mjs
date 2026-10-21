// Fewer steps from launch to driving (owner 2026-10-20: "fewer clicks to get anywhere"). Measured paths and the before/after
// table: .scratch/ui-flow-2026-10-20/FLOWS.md. Each cut keeps the locked screens (title, RACE cards, track confirmation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialMapId, lastPlayedMap } from '../src/menu-map.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const menu = strip(read('src/menu.js')), boot = strip(read('src/boot.js')), main = strip(read('src/main.js')), picker = strip(read('src/spawn-select.js'));
const store = values => ({ getItem: k => values[k] ?? null });

test('Track select opens on the track you raced last; a URL map or event still wins', () => {
  assert.equal(lastPlayedMap(store({ 'paraliaki.lastPlayedMap': 'penteli' })), 'penteli');
  assert.equal(lastPlayedMap(store({ 'paraliaki.lastPlayedMap': 'nowhere' })), null, 'an unknown or unplayable track is ignored');
  assert.equal(lastPlayedMap(store({})), null);
  const saved = globalThis.localStorage;
  globalThis.localStorage = store({ 'paraliaki.lastPlayedMap': 'penteli' });
  try {
    assert.equal(initialMapId(new URLSearchParams('')), 'penteli');
    assert.equal(initialMapId(new URLSearchParams('map=riviera')), 'riviera');
  } finally { if (saved === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved; }
  assert.equal(initialMapId(new URLSearchParams('')), 'riviera', 'no history: the first track');
});

test('Enter goes straight through: race setup opens on CHOOSE CAR, RACE on the card you played last', () => {
  assert.match(menu, /label: 'CHOOSE CAR'[^)]*act: 'setupGo', attrs: \{ 'data-default': '' \}/);
  assert.doesNotMatch(menu, /rows\[0\] = rows\[0\]\.replace\('<div class="mi field', '<div data-default=""/, 'the first option is no longer the default');
  assert.match(menu, /attrs: act === last \? \{ 'data-default': '' \} : undefined/);
  assert.match(menu, /this\.openQuickRace\(\); rememberMode\('quick'\)/);
  assert.match(menu, /this\.show\('maps', \{ filter: 'free', mode: 'free' \}, true\); rememberMode\('free'\)/);
});

test('a race opens the car picker on your current car (Back shows the garage)', () => {
  assert.match(menu, /pickCar\(data\) \{\n    const from = this\.screen;\n    void loadGarage\(\)\.then\(\(\) => \{ if \(this\.screen !== from\) return; this\.show\('car', data, true\); this\.show\('car', \{ \.\.\.data, detail: true \}, true\); \}\)/, 'the grid, then the car itself, once the garage is loaded');
  assert.match(boot, /const pickCarFor = def => menu\.pickCar\(\{ def, index: car \}\);/);
  assert.match(boot, /openEvent: id => pickCarFor\(/); assert.match(boot, /quickRace: \(\) => pickCarFor\(quickMapEvent\(mapId\)\)/);
  assert.match(main, /else menu\.pickCar\(\{ def, index: idx \}\);/);
});

test('results: RACE AGAIN is one press with the same car; CHANGE CAR opens the picker', () => {
  assert.match(menu, /act\('raceAgain', 'rotate-ccw', 'RACE AGAIN', 'primary'\)\}\$\{act\('changeCar', 'car', 'CHANGE CAR'\)\}/);
  assert.match(menu, /attrs: a === 'raceAgain' \? \{ 'data-default': '' \} : null/, 'RACE AGAIN is the default');
  assert.match(menu, /case 'raceAgain': \(this\.h\.raceAgain \|\| this\.h\.restart\)\(\); break;/);
  assert.match(menu, /case 'changeCar': \(this\.h\.changeCar \|\| this\.h\.restart\)\(\); break;/);
  assert.match(main, /changeCar: \(\) => openEvent\(G\.ev\.def, G\.carIdx, true\)/, 'CHANGE CAR opens the garage grid (you want another car)');
  assert.match(main, /if \(browse\) menu\.show\('car', \{ def, index: idx \}, true\); else menu\.pickCar\(\{ def, index: idx \}\);/);
  assert.match(main, /raceAgain: \(\) => startEvent\(G\.ev\.def, \{ car: G\.carIdx \}\)/, 'the same event, the same car, no picker');
  assert.match(main, /restart: \(\) => openEvent\(G\.ev\.def\)/, 'CHANGE CAR still goes through the picker');
});

test('free roam remembers where you last started, one place per world', () => {
  assert.match(picker, /const SAVED = athens => athens \? 'paraliaki\.spawn\.athens' : 'paraliaki\.spawn';/);
  assert.match(picker, /choice = session\.choice \|\|= savedChoice\(areas, athensMode\) \|\| areaChoice\(areas\[0\]\)/);
  assert.match(picker, /session\.choice = next; session\.arrived = true; saveChoice\(choice, athensMode\);/);
  assert.match(picker, /areas\.some\(a => a\.mapId === c\.mapId\)/, 'only a place in an area this picker offers is restored');
});
