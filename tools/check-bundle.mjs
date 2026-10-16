// Run through tools/browser-slot.sh. Exercises the actual generated entry, not source imports.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { serveBundle } from './serve-bundle.mjs';
const out = resolve(process.env.BUNDLE_EVIDENCE || '.scratch/bundle-check'); await mkdir(out, { recursive: true });
const app = await serveBundle(resolve(process.argv[2] || '.deploy/assets'), { dataDir: resolve(out, 'server-data') });
const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE))
  : await import('playwright').catch(() => import('/tmp/pw/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || (existsSync('/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') ? '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' : undefined), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], results = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage(); const requested = [];
  await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = cb => cb.name === 'frame' ? 0 : raf(cb); });
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
  for (const map of ['riviera', 'megara', 'penteli']) {
    console.log('starting', map);
    // Select using the real menu handlers, then confirm the garage to load the runtime.
    await page.evaluate(map => { const menu = window.__flow.menu; menu.h.selectMap(map); menu.h.quickRace(); }, map);
    await page.waitForFunction(() => window.__flow.menu.screen === 'car', null, { timeout: 60000 });
    await page.evaluate(() => window.__flow.menu.confirmCar());
    await page.waitForFunction(map => window.__game?.mapId === map && ['race', 'countdown'].includes(window.__game?.state), map, { timeout: 600000 });
    // Let the real countdown and camera transition finish before rendering the capture.
    await page.evaluate(() => { window.__sim.step(90, 1 / 60); window.__sim.render(); });
    assert.equal(await page.evaluate(() => window.__game.state), 'race', map + ' must enter the race state');
    await page.screenshot({ path: resolve(out, map + '.png'), timeout: 60000 });
    results.push({ map, state: await page.evaluate(() => window.__game.state) });
    await page.evaluate(() => window.__flow.quit());
    await page.waitForFunction(() => window.__flow.menu.screen === 'title');
  }
  await page.evaluate(() => { const menu = window.__flow.menu; menu.show('multiplayer'); menu.activate(menu.root.querySelector('[data-act=mpJoin]')); });
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
  assert.deepEqual(errors, [], 'built client page errors');
  await context.close();
} catch (error) {
  console.error(error.stack);
  const state = await Promise.race([page?.evaluate(() => ({ state: window.__game?.state, mapId: window.__game?.mapId, screen: window.__flow?.menu?.screen, loading: document.getElementById('lstat')?.textContent, error: document.getElementById('err')?.textContent })), new Promise(resolve => setTimeout(() => resolve('page busy'), 5000))]);
  console.error(JSON.stringify(state));
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: error.stack, state }, null, 2));
  throw error;
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ errors, results }, null, 2));
  await browser.close(); await app.close();
}
console.log(JSON.stringify({ pass: true, results, errors }));
