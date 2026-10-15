// Run one job through tools/browser-slot.sh node tools/release-browser.mjs ROOT OUTPUT.
// Uses the real production HTML/bundle and menu; no recreated screen markup.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] || '.'), out = resolve(process.argv[3] || '.scratch/release-notes');
await mkdir(out, { recursive: true });
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
const app = await createGameServer({ root: resolve(root, '.deploy/assets'), dataDir: resolve(out, 'server-data') });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const url = `http://127.0.0.1:${app.server.address().port}/?menu&quality=low`, report = { errors: [], checks: [], captures: [] };
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 720 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.stack));
    // Hold only the continuous 3D loop on this software GPU. UI animation frames still run.
    await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = cb => ['frame', 'onAnimationFrame'].includes(cb.name) ? 0 : raf(cb); });
    const boot = async () => { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForFunction(() => window.__flow?.menu.screen === 'title' && document.body.classList.contains('loaded'), null, { timeout: 120000 }); };
    const click = async act => page.locator(`[data-act="${act}"]`).first().evaluate(el => el.click());
    const snap = async name => {
      await page.waitForTimeout(350);
      const file = `${name}-${width}.png`;
      await page.screenshot({ path: resolve(out, file), timeout: 60000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${name} overflows at ${width}`);
      report.captures.push(file);
    };
    await boot();
    assert.equal(await page.locator('.news-card').count(), 0, 'brand-new launch is quiet');
    const current = await page.evaluate(() => document.querySelector('meta[name="asr-version"]').content);
    assert.equal(await page.evaluate(() => localStorage.getItem('paraliaki.releaseSeen')), current);
    report.checks.push(`${width}: first launch skips and records current version`);
    await click('settings');
    await page.locator('[data-key="settingsTab"] [data-v="about"]').evaluate(el => el.click());
    await page.waitForSelector('.about-stats');
    assert.match(await page.locator('#ui').innerText(), /PR|Pull requests|PULL REQUESTS/i);
    const source = await page.locator('[data-act="openLink"][data-url="https://github.com/aflekkas/athens-street-racers"]').count();
    assert.equal(source, 1);
    const external = await page.evaluate(() => {
      const original = HTMLAnchorElement.prototype.click; let attrs;
      HTMLAnchorElement.prototype.click = function () { attrs = { href: this.href, target: this.target, rel: this.rel }; };
      try { document.querySelector('[data-act="openLink"][data-url="https://github.com/aflekkas/athens-street-racers"]').click(); } finally { HTMLAnchorElement.prototype.click = original; }
      return attrs;
    });
    assert.deepEqual(external, { href: 'https://github.com/aflekkas/athens-street-racers', target: '_blank', rel: 'noopener' });
    await snap('about');
    await click('whatsNew'); await page.waitForSelector('.release-list'); await snap('whats-new');
    assert.equal(await page.locator('.release').count(), 4);
    await page.evaluate(() => __flow.menu.pop());
    await click('credits'); await page.waitForSelector('.credits'); await snap('credits');
    assert.match(await page.locator('.credits').innerText(), /Alexandros Lekkas/);
    assert.match(await page.locator('.credits').innerText(), /Vassilis Perrotis/);
    assert.match(await page.locator('.credits').innerText(), /Copernicus/);
    await page.locator('[data-credit="assets-audio-voice-credits-txt"]').evaluate(el => el.click());
    assert.match(await page.locator('.credit-sheet').innerText(), /Piper/);
    // Persist only an older version, then reload: a returning player gets the current section.
    await page.evaluate(() => { localStorage.setItem('paraliaki.releaseSeen', '2026.10.15.2'); localStorage.setItem('paraliaki.car', 'seat'); });
    await boot(); await page.waitForSelector('.news-card'); await snap('one-time-card');
    assert.match(await page.locator('.news-card').innerText(), new RegExp(current.replaceAll('.', '\\.')));
    assert.doesNotMatch(await page.locator('.news-card').innerText(), /Police now work in online races/);
    // Even a title render while a race is active must never expose the card.
    await page.evaluate(() => { document.body.classList.add('racing'); __flow.menu.refresh(); });
    assert.equal(await page.locator('.news-card').count(), 0);
    await page.evaluate(() => { document.body.classList.remove('racing'); __flow.menu.refresh(); });
    await click('dismissNews'); await boot();
    assert.equal(await page.locator('.news-card').count(), 0, 'dismissal survives reload');
    report.checks.push(`${width}: upgrade shows latest only; race hides card; dismissal survives reload`);
    await click('credits'); assert.equal(await page.locator('.credits').count(), 1, 'title credits action');
    // The existing HUD footer uses the same screen, with a return route.
    await page.evaluate(() => { __flow.menu.show('title'); document.querySelector('a[data-credits]').click(); });
    assert.equal(await page.evaluate(() => __flow.menu.screen), 'credits');
    assert.equal(await page.evaluate(() => __flow.menu.pop()), true);
    assert.equal(await page.evaluate(() => __flow.menu.screen), 'title');
    report.checks.push(`${width}: title and footer credits navigation, including Back`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(resolve(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close();
}
