// Contact sheets from the after captures:
//   contact-sheet.png  every screen at 1280x800 in one grid
//   pause-pairs.png    the pause menu (the reference style) beside every other screen
//   tools/browser-slot.sh node .scratch/one-component-set/contact.mjs .scratch/one-component-set
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = resolve(process.argv[2]), after = resolve(dir, 'after');
const files = (await fs.readdir(after)).filter((f) => f.endsWith('-1280x800.png')).sort();
const order = ['pause', 'title', 'signin', 'account', 'mode', 'maps', 'setup', 'garage', 'garage-scrolled', 'car-detail', 'settings-driver', 'settings-audio', 'settings-video', 'settings-driving', 'settings-camera', 'settings-controls', 'settings-about', 'whats-new', 'credits', 'mp-join', 'mp-host', 'mp-lobby', 'results', 'loading', 'race-chase', 'race-cockpit'];
const name = (f) => f.replace('-1280x800.png', '');
files.sort((a, b) => (order.indexOf(name(a)) + 99) % 199 - (order.indexOf(name(b)) + 99) % 199);
const img = (f) => `<figure><img src="${pathToFileURL(resolve(after, f)).href}"><figcaption>${name(f).toUpperCase()}</figcaption></figure>`;
const css = `body{margin:0;padding:24px;background:#05070a;color:#a9b6c1;font:600 14px 'Barlow Condensed',sans-serif;letter-spacing:.16em}
h1{font:400 28px Barlow,sans-serif;letter-spacing:.14em;color:#f1f5f8;margin:0 0 6px}p{margin:0 0 18px;font:500 14px Barlow,sans-serif;letter-spacing:.02em}
.g{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.p{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
figure{margin:0}img{width:100%;display:block;border:1px solid #1e2833;border-radius:6px}figcaption{padding:6px 2px 0}`;
const sheet = `<!doctype html><style>${css}</style><h1>ATHENS RACING · ONE COMPONENT SET</h1><p>Every screen at 1280×800, built from src/ui/components.js + src/ui/ui.css, derived from the pause-menu reference style.</p><div class="g">${files.map(img).join('')}</div>`;
const pause = files.find((f) => name(f) === 'pause');
const pairs = `<!doctype html><style>${css}</style><h1>THE REFERENCE · PAUSE BESIDE EVERY SCREEN</h1><p>Left: the pause menu (owner-chosen reference, 2026-10-16). Right: each screen. Same panels, rows, icon plates, focus outline, kickers, titles, key hints.</p>${files.filter((f) => f !== pause).map((f) => `<div class="p">${img(pause)}${img(f)}</div>`).join('')}`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
for (const [file, html, width] of [['contact-sheet.png', sheet, 2600], ['pause-pairs.png', pairs, 1400]]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const tmp = resolve(dir, '.' + file + '.html'); await fs.writeFile(tmp, html);
  await page.goto(pathToFileURL(tmp).href); await page.waitForLoadState('load');
  await page.screenshot({ path: resolve(dir, file), fullPage: true }); await fs.rm(tmp); await page.close();
}
await browser.close(); console.log('COMPLETE');
