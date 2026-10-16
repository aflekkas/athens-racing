// tools/browser-slot.sh node tools/changelog-pictures-browser.mjs ROOT OUTPUT
// Exercises the real production bundle. Only the continuous 3D loop is held on the software GPU.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] || '.'), out = resolve(process.argv[3] || '.scratch/release-notes/pictures');
await mkdir(out, { recursive: true });
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
const app = await createGameServer({ root: resolve(root, '.deploy/assets'), dataDir: resolve(out, 'server-data') });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { errors: [], checks: [], captures: [] }, url = `http://127.0.0.1:${app.server.address().port}/?menu&quality=low`;
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, serviceWorkers: 'block' });
    const page = await context.newPage(), photos = [], maps = [];
    page.on('pageerror', e => report.errors.push(e.stack));
    page.on('request', req => { const path = new URL(req.url()).pathname; if (path.startsWith('/assets/changelog/')) photos.push(path); if (path.startsWith('/data/')) maps.push(path); });
    await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = cb => ['frame', 'onAnimationFrame'].includes(cb.name) ? 0 : raf(cb); });
    const boot = async () => { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForFunction(() => window.__flow?.menu.screen === 'title' && document.body.classList.contains('loaded'), null, { timeout: 120000 }); };
    const click = act => page.locator(`[data-act="${act}"]`).first().click();
    const readyImage = selector => page.waitForFunction(selector => { const i = document.querySelector(selector); return i?.complete && i.naturalWidth > 0; }, selector);
    const snap = async name => { await page.locator('#ui img').evaluateAll(images => Promise.all(images.filter(i => i.complete && i.naturalWidth).map(i => i.decode()))); await page.waitForTimeout(250); const file = `${name}-${width}.png`; await page.screenshot({ path: resolve(out, file), animations: 'disabled', timeout: 60000 }); report.captures.push(file); console.log('Captured', file); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); };
    await boot();
    assert.equal(photos.length, 0); assert.equal(maps.length, 0); assert.equal(await page.locator('.news-panel').count(), 0);
    report.checks.push(`${width}: brand-new boot requests zero changelog images and zero map data`);
    report.build = await page.evaluate(() => Object.fromEntries(['version', 'sha', 'build'].map(key => [key, document.querySelector(`meta[name="asr-${key}"]`)?.content])));
    await page.evaluate(() => { localStorage.setItem('paraliaki.releaseSeen', '2026.10.14.1'); localStorage.setItem('paraliaki.car', 'seat'); });
    await boot(); await page.waitForSelector('.news-panel');
    assert.equal(photos.length, 0); assert.equal(maps.length, 0);
    await click('newsPictures'); await readyImage('.news-panel img');
    await snap('card-photos');
    await page.locator('.news-panel [data-act="releaseImage"]').first().click();
    assert.equal(await page.evaluate(() => __flow.menu.screen), 'releaseImage');
    assert.equal(await page.locator('#ui [role="dialog"]').count(), 0);
    await click('back'); assert.equal(await page.evaluate(() => __flow.menu.screen), 'title');
    assert.equal(await page.locator('.news-panel').count(), 1, 'viewing card pictures does not dismiss the card');
    await click('dismissNews'); await click('whatsNew'); await readyImage('.release-list img');
    assert.ok((await page.locator('.release-list img').count()) >= 5);
    assert.equal(await page.locator('.release-list img:not([loading="lazy"])').count(), 0);
    await snap('whats-new');
    await page.locator('.release-list [data-act="releaseImage"]').first().click();
    await readyImage('.release-image img'); await snap('full-screen');
    assert.equal(await page.locator('#ui [role="dialog"]').count(), 0);
    await click('back'); assert.equal(await page.evaluate(() => __flow.menu.screen), 'whatsNew');
    assert.equal(maps.length, 0, 'notes and image viewer never load a map');
    report.checks.push(`${width}: card opt-in photos, lazy notes gallery, full screen and Back; no map data`);
    await context.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(resolve(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  await browser.close(); app.server.closeAllConnections(); await app.close();
}
