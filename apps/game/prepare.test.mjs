import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { desktopHTML, assertPlayableMaps, assertGameOutput } from './prepare.mjs';
import { MAPS } from '../../src/map-catalog.js';
import { desktopAvailable, desktopLaunchURL, takeDesktopLaunch, clearDesktopSession, desktopTransitionEndsSession } from '../../src/desktop-navigation.js';

test('desktop HTML eliminates eager Google Font traffic and enables local fonts', () => {
  const html = desktopHTML('<head><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Barlow" rel="stylesheet"></head>');
  assert.doesNotMatch(html, /googleapis|gstatic/); assert.match(html, /asr-desktop/); assert.match(html, /\/assets\/fonts\/desktop.css/);
});
test('desktop build requires the complete four-map inputs before touching output', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'athens-desktop-assets.'));
  try {
    await assert.rejects(assertPlayableMaps(dir), /ATHENS RIVIERA.*data\/map.json/);
    for (const map of MAPS) for (const name of [map.dataUrl, map.terrainUrl, map.preview]) { const path = resolve(dir, name); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, 'present'); }
    await assertPlayableMaps(dir);
    await rm(resolve(dir, MAPS[3].terrainUrl));
    await assert.rejects(assertPlayableMaps(dir), /PSYCHIKO.*terrain.bin/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('query parameters never grant the desktop capability', () => {
  assert.equal(desktopAvailable({ location: { search: '?desktop=1' } }), false);
  assert.equal(desktopAvailable({ athensDesktop: { session() {}, host() {}, join() {}, solo() {} } }), true);
  assert.equal(desktopAvailable({ athensDesktop: { session() {}, host() {}, join() {} } }), false);
});
test('session transitions clear remote race and lobby parameters', () => {
  assert.equal(desktopLaunchURL('http://127.0.0.1:17833/?lobby=ABC123&map=athens&routes=1#old', 'solo'), 'http://127.0.0.1:17833/?desktopSolo=1');
  assert.equal(desktopLaunchURL('http://127.0.0.1:17833/?lobby=ABC123', 'host'), 'http://127.0.0.1:17833/?desktopLan=host');
  assert.throws(() => desktopLaunchURL('http://localhost/', 'external'), /Unknown/);
});
test('desktop launch intent is consumed once while retaining unrelated query state', () => {
  let saved;
  assert.equal(takeDesktopLaunch({ href: 'http://localhost/?desktopLan=join&debug=1' }, { replaceState(a, b, url) { saved = url.href; } }), 'join');
  assert.equal(saved, 'http://localhost/?debug=1');
  assert.equal(takeDesktopLaunch({ href: saved }, { replaceState() { assert.fail(); } }), null);
});

test('build output cannot erase source or traverse a symbolic-link destination', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'athens-desktop-output.'));
  try {
    await assert.rejects(assertGameOutput(dir, dir), /inside/);
    await assert.rejects(assertGameOutput(dir, resolve(dir, '../outside')), /inside/);
    await mkdir(resolve(dir, 'outside'));
    await symlink(resolve(dir, 'outside'), resolve(dir, '.desktop'), 'dir');
    await assert.rejects(assertGameOutput(dir, resolve(dir, '.desktop/game')), /symbolic links/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('explicit mode changes drop lobby resumption while preserving local profile and records', () => {
  const values = new Map([['paraliaki.session', 'remote-token'], ['paraliaki.route-session', 'remote-route'], ['paraliaki.driver', 'LOCAL'], ['personal-bests', 'records']]);
  clearDesktopSession({ removeItem: key => values.delete(key) });
  assert.deepEqual([...values], [['paraliaki.driver', 'LOCAL'], ['personal-bests', 'records']]);
  assert.doesNotThrow(() => clearDesktopSession({ removeItem() { throw Error('Storage unavailable'); } }));
});

test('reopening an existing hosted session keeps its lobby while Solo and Join end the old session', () => {
  assert.equal(desktopTransitionEndsSession({ mode: 'host' }, 'host'), false);
  assert.equal(desktopTransitionEndsSession({ mode: 'solo' }, 'host'), true);
  assert.equal(desktopTransitionEndsSession({ mode: 'join' }, 'host'), true);
  assert.equal(desktopTransitionEndsSession({ mode: 'join' }, 'join'), true);
  assert.equal(desktopTransitionEndsSession({ mode: 'host' }, 'solo'), true);
});
