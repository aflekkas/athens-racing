#!/usr/bin/env node
// Run through tools/browser-slot.sh: one browser job at a time.
// Frame sequences of the driver shift hand from the cockpit camera, via the
// lightweight tools/fixtures/shift-hand.html harness (real CarModel + Driver +
// Cockpit, camera at the driver's eye, scripted shift events, fixed dt).
import http from 'node:http';
import fs from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] || process.env.SHIFT_HAND_OUT || resolve(root, '.scratch/shift-hand'));
await fs.mkdir(out, { recursive: true });
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs').href);
let executablePath = process.env.CHROME_BIN;
if (!executablePath && !existsSync(pw.chromium.executablePath())) {
  for (const folder of (await fs.readdir(resolve(homedir(), '.cache/ms-playwright')).catch(() => [])).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const file = resolve(homedir(), '.cache/ms-playwright', folder, 'chrome-linux64/chrome');
    if (existsSync(file)) { executablePath = file; break; }
  }
}
const threeRoot = process.env.THREE_MODULE_ROOT || '/tmp/roads-v2-three/node_modules/three';
assert.ok(existsSync(resolve(threeRoot, 'build/three.module.js')), 'Set THREE_MODULE_ROOT to three@0.170.0');

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    let file;
    if (url.pathname.startsWith('/fixture-three/')) file = resolve(threeRoot, url.pathname.slice(15));
    else file = resolve(root, '.' + url.pathname);
    let bytes = await fs.readFile(file);
    if (file.endsWith('shift-hand.html')) bytes = Buffer.from(bytes.toString());
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch (e) { res.writeHead(404).end(String(e)); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const browser = await pw.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { scenarios: {} };
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(String((e && e.stack) || e)); console.log('PAGEERROR', String(e).slice(0, 800)); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('CONSOLE', m.text().slice(0, 800)); } });
  console.log('BOOT harness');
  await page.goto(`http://127.0.0.1:${port}/tools/fixtures/shift-hand.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.shiftHand && window.shiftHand.ready, null, { timeout: 120000 });
  const names = await page.evaluate(() => Object.keys(window.shiftHand.scenarios));
  for (const name of names) {
    const times = await page.evaluate((n) => window.shiftHand.scenarios[n].times, name);
    const frames = [];
    for (let i = 0; i < times.length; i++) {
      const probe = await page.evaluate(([n, t]) => window.shiftHand.pose(n, t), [name, times[i]]);
      const file = `${name}-${String(i).padStart(2, '0')}.png`;
      for (let attempt = 0; ; attempt++) {
        try {
          await page.screenshot({ path: resolve(out, file), timeout: 60000 });
          break;
        } catch (e) {
          if (attempt >= 2) throw e;
          console.log(name, `screenshot retry ${attempt + 1}`);
          await page.waitForTimeout(5000);
        }
      }
      frames.push({ file, t: times[i], probe });
      console.log(name, `t=${times[i]}`, probe.summary);
    }
    report.scenarios[name] = { frames };
  }
  await fs.writeFile(resolve(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  await page.close();
  assert.deepEqual(errors, [], 'no browser errors');
} finally {
  await browser.close();
  server.close();
}
console.log('shift-hand evidence done');
