// Run through tools/browser-slot.sh. Exercises the actual generated entry, not source imports.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { serveBundle } from './serve-bundle.mjs';
import { routeDestinationForMap } from '../src/unified-routes.js';
// Expectations come from the actual private build's installed public catalogue.
function bundleRouteExpectations(config, selections) {
  if (!config || !['staging', 'production'].includes(config.environment) || !Array.isArray(config.routes)) throw Error('Built route catalogue unavailable');
  const hashes = ['routeHash', 'geometryHash', 'worldSetRevision'], worlds = new Set();
  return selections.map(({ map, id }) => {
    const entries = config.routes.filter(entry => entry.id === id);
    if (entries.length !== 1) throw Error('Built route unavailable: ' + id);
    const entry = entries[0];
    if (hashes.some(key => !/^[a-f0-9]{64}$/.test(entry[key] || '')) || entry.url !== `/data/routes/${id}.${entry.routeHash}.json`) throw Error('Built route identity invalid: ' + id);
    worlds.add(entry.worldSetRevision);
    if (worlds.size !== 1) throw Error('Built routes use different world releases');
    return { map, id, ...Object.fromEntries(hashes.map(key => [key, entry[key]])) };
  });
}

// A legacy menu destination now selects a route in the shared Athens world.
// Loading failures stop the gate promptly; they are never accepted as readiness.
function bundleRaceReady(expected) {
  if (globalThis.__loading?.failure) throw Error('Route start failed: ' + expected.id + ' (' + (globalThis.__loading.failure.code || 'unknown') + ')');
  const game = globalThis.__game;
  if (!game || !['race', 'countdown'].includes(game.state)) return false;
  if (game.mapId !== 'athens') throw Error('Race did not enter the shared Athens world');
  const compiled = game.unifiedCompiled;
  if (!compiled || compiled.worldId !== 'athens' || ['id', 'routeHash', 'geometryHash', 'worldSetRevision'].some(key => compiled[key] !== expected[key])) throw Error('Race compiled route identity mismatch: ' + expected.id);
  if (game.routePreparing || !globalThis.__sim || !globalThis.__routePilot) return false;
  if (globalThis.__worldSession?.manifest?.revision !== expected.worldSetRevision) throw Error('Race world release mismatch: ' + expected.id);
  const active = globalThis.__sim.route?.compiled;
  if (!active || ['id', 'routeHash', 'geometryHash', 'worldSetRevision'].some(key => active[key] !== expected[key])) throw Error('Active route identity mismatch: ' + expected.id);
  return true;
}

async function closeBundleCheck(browser, app, saveReport, primaryError) {
  const failures = [];
  for (const close of [saveReport, () => browser?.close(), () => app.close()]) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (primaryError) { for (const error of failures) { try { console.error('Secondary bundle cleanup failure:', error.message); } catch {} } return; }
  if (failures.length) throw failures[0];
}

const out = resolve(process.env.BUNDLE_EVIDENCE || '.scratch/bundle-check'); await mkdir(out, { recursive: true });
const app = await serveBundle(resolve(process.argv[2] || '.deploy/assets'), { dataDir: resolve(out, 'server-data') });
const errors = [], results = [];
let page, browser, primaryError;
try {
  const expectedRoutes = bundleRouteExpectations(app.routeConfig, ['riviera', 'megara', 'penteli'].map(map => ({ map, id: routeDestinationForMap(map) })));
  if(!app.worldAssets)throw Error('Bundle world transport was not prepared');
  app.worldAssets.check();
  const { chromium } = process.env.PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE))
    : await import('playwright').catch(() => import('/tmp/pw/node_modules/playwright/index.mjs'));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || (existsSync('/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') ? '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' : undefined), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage(); const requested = [];
  await page.addInitScript(origin => {
    // Unified-world Quit performs a real menu navigation. Keep this harness's
    // instrumentation across documents before boot reads the new query.
    if (window.top === window && location.origin === origin) {
      const url = new URL(location.href);
      for (const [key, value] of [['simhook', ''], ['debug', ''], ['quality', 'low'], ['guest', '1']]) url.searchParams.set(key, value);
      history.replaceState(null, '', url);
    }
    const raf = requestAnimationFrame;
    window.requestAnimationFrame = cb => cb.name === 'frame' ? 0 : raf(cb);
  }, new URL(app.url).origin);
  page.on('console', message => { if (message.type() === 'error' || /world-|abs|ready|map|compiled|textures/.test(message.text())) console.log(message.type(), message.text()); });
  page.on('pageerror', error => { errors.push(error.stack); console.error(error.stack); }); page.on('request', request => requested.push(request.url()));
  await page.goto(app.url + '/?menu&simhook&quality=low&guest=1&debug', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('loaded') && window.__flow?.menu.screen === 'title');
  console.log('menu ready'); await page.waitForTimeout(2500);
  assert.equal(requested.some(url => new URL(url).pathname.startsWith('/data/')), false, 'fresh menu must fetch zero map files (including service worker installation)');
  assert.equal(await page.evaluate(() => !!window.__game?.mapId), false, 'fresh menu owns no world');
  await page.screenshot({ path: resolve(out, 'menu.png') });
  // Exercise account and multiplayer lazy loaders as well as the garage handover.
  await page.evaluate(() => window.__flow.menu.show('account', {}, true));
  await page.waitForFunction(() => window.__flow.menu.screen === 'account');
  await page.evaluate(() => window.__flow.menu.show('title'));
  for (const expected of expectedRoutes) {
    const map = expected.map;
    console.log('starting', map);
    // Select using the real menu handlers, then confirm the garage to load the runtime.
    await page.evaluate(map => { const menu = window.__flow.menu; menu.h.selectMap(map); menu.h.quickRace(); }, map);
    await page.waitForFunction(() => window.__flow.menu.screen === 'car', null, { timeout: 60000 });
    await page.evaluate(() => window.__flow.menu.confirmCar());
    await Promise.race([page.waitForFunction(bundleRaceReady, expected, { timeout: 600000 }),app.worldAssets.failure.then(error=>{throw error;})]);
    app.worldAssets.check();
    // Let the real countdown and camera transition finish before rendering the capture.
    await page.evaluate(() => { window.__sim.step(90, 1 / 60); window.__sim.render(); });
    assert.equal(await page.evaluate(() => window.__game.state), 'race', map + ' must enter the race state');
    await page.screenshot({ path: resolve(out, map + '.png'), timeout: 60000 });
    assert.equal(await page.evaluate(bundleRaceReady, expected), true, map + ' must retain its exact route and world identity');
    results.push({ ...expected, worldId: 'athens', state: await page.evaluate(() => window.__game.state) });
    await page.evaluate(() => window.__flow.quit());
    await page.waitForFunction(() => document.body.classList.contains('loaded') && window.__flow?.menu.screen === 'title');
  }
  await page.evaluate(() => { const menu = window.__flow.menu; menu.show('title'); menu.activate(menu.root.querySelector('[data-act=multiplayer]')); });
  await page.waitForFunction(() => window.__flow.menu.screen === 'mp' && window.__multiplayer?.loaded, null, { timeout: 60000 });
  if (await page.evaluate(() => !!window.__bootMenu)) {
    const faultContext = await browser.newContext({ serviceWorkers: 'block' });
    await faultContext.addInitScript(() => { window.requestIdleCallback = () => 0; });
    const faultPage = await faultContext.newPage(), faultErrors = []; let reloads = 0;
    faultPage.on('pageerror', error => faultErrors.push(error.message));
    await faultPage.route('**/*', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (/\/src\/main-[A-Z0-9]+\.js$/.test(path)) return route.fulfill({ status: 404, body: 'old chunk removed' });
      if (path === '/' && !request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<meta name="asr-build" content="fault-injected-new-build">' });
      return route.continue();
    });
    await faultPage.goto(app.url + '/?menu&quality=low&guest=1', { waitUntil: 'domcontentloaded' });
    await faultPage.waitForFunction(() => !!window.__bootMenu?.h.ensureRuntime);
    faultPage.on('framenavigated', frame => { if (frame === faultPage.mainFrame()) reloads++; });
    const navigation = faultPage.waitForEvent('framenavigated', { predicate: frame => frame === faultPage.mainFrame(), timeout: 30000 });
    await faultPage.evaluate(() => { void window.__bootMenu.h.ensureRuntime(); });
    await navigation;
    await faultPage.waitForFunction(() => !!window.__bootMenu?.h.ensureRuntime);
    const failure = await faultPage.evaluate(async () => { try { await window.__bootMenu.h.ensureRuntime(); return ''; } catch (error) { return error.message; } });
    assert.match(failure, /module|import|fetch/i);
    assert.equal(reloads, 1, 'missing old chunks must reload once, without looping');
    assert.deepEqual(faultErrors, []);
    await faultContext.close();
  }
  app.worldAssets.check();
  assert.deepEqual(errors, [], 'built client page errors');
  await context.close();
} catch (error) {
  primaryError = error;
  console.error(error.stack);
  const state = await Promise.race([page?.evaluate(() => ({ state: window.__game?.state, mapId: window.__game?.mapId, screen: window.__flow?.menu?.screen, loading: document.getElementById('lstat')?.textContent, error: document.getElementById('err')?.textContent })), new Promise(resolve => setTimeout(() => resolve('page busy'), 5000))]);
  console.error(JSON.stringify(state));
  try { await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: error.stack, state }, null, 2)); } catch (secondary) { try { console.error('Secondary bundle failure-report error:', secondary.message); } catch {} }
  throw error;
} finally {
  await closeBundleCheck(browser, app, () => writeFile(resolve(out, 'report.json'), JSON.stringify({ errors, results, worldTransport:app.worldAssets?.status() }, null, 2)), primaryError);
}
console.log(JSON.stringify({ pass: true, results, errors }));
