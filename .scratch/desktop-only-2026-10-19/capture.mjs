// Desktop-only before/after captures (2026-10-19 owner decision: phones and tablets can't play).
// Run: tools/browser-slot.sh node .scratch/desktop-only-2026-10-19/capture.mjs <root> <outdir> <prefix> [--gate]
//   <root>   a checkout to serve natively (index.html + src/), e.g. an archive of prod
//   --gate   capture the phone gate at 390x844 and the iPad gate at 820x1180 instead of the desktop screens
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const [root, outdir, prefix] = process.argv.slice(2);
const gate = process.argv.includes('--gate');
await mkdir(outdir, { recursive: true });
const { createGameServer: serve } = await import(resolve(root, 'server/index.mjs'));
const app = await serve({ root: resolve(root), dataDir: resolve(outdir, '.server-data') });
await new Promise(done => app.server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${app.server.address().port}/`;
const executablePath = process.env.CHROME_BIN || (existsSync('/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') ? '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' : undefined);
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  if (gate) {
    const devices = [
      ['phone-390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }],
      ['ipad-820x1180', { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' }],
    ];
    for (const [name, options] of devices) {
      const context = await browser.newContext(options), page = await context.newPage();
      const requests = [];
      page.on('request', r => requests.push(new URL(r.url()).pathname));
      page.on('pageerror', e => errors.push(`${name}: ${e}`));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#device-gate:visible', { timeout: 15000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(outdir, `${prefix}-gate-${name}.png`) });
      const state = await page.evaluate(() => ({ device: document.documentElement.dataset.device, title: !!document.querySelector('#ui .scr--title'), canvasVisible: getComputedStyle(document.getElementById('c')).display !== 'none', text: document.querySelector('#device-gate')?.innerText }));
      console.log(name, JSON.stringify(state), 'requests:', requests.filter(p => /\/src\/(main|boot)|\/data\/|world/.test(p)).length, 'game/world requests');
      await context.close();
    }
  } else {
    const nav = {
      title: async () => {},
      mode: async page => page.click('[data-act="play"]'),
      maps: async page => { await page.click('[data-act="play"]'); await page.waitForSelector('[data-act="quick"]'); await page.click('[data-act="quick"]'); },
      garage: async page => page.click('[data-act="garage"]'),
      'settings-controls': async page => { await page.click('[data-act="settings"]'); await page.waitForSelector('[data-key="settingsTab"]'); await page.click('[data-key="settingsTab"] [data-v="controls"]'); },
    };
    for (const [w, h] of [[1280, 800], [960, 700]]) for (const [name, go] of Object.entries(nav)) {
      const context = await browser.newContext({ viewport: { width: w, height: h } }), page = await context.newPage();
      page.on('pageerror', e => errors.push(`${name} ${w}x${h}: ${e}`));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#ui .scr--title', { timeout: 60000 });
      await page.waitForTimeout(2500);
      await go(page);
      await page.waitForFunction(() => { const s = document.querySelector('#ui .scr'); return s && getComputedStyle(s).opacity === '1'; }, null, { timeout: 90000 }); // the screen has finished its fade-in
      await page.waitForTimeout(name === 'maps' ? 7000 : 2500); // the map art streams in
      await page.screenshot({ path: resolve(outdir, `${prefix}-${name}-${w}x${h}.png`) });
      console.log('captured', name, w, h);
      await context.close();
    }
  }
} finally { await browser.close(); await new Promise(done => app.server.close(done)); }
if (errors.length) console.log("PAGE ERRORS", errors);
process.exit(errors.length ? 1 : 0);
