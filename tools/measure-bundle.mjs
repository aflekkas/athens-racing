// Interleaved five-run cold/warm navigation benchmark. Run through browser-slot.sh.
// Usage: node tools/measure-bundle.mjs OUTPUT LABEL=ASSETS [...]
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { serveBundle } from './serve-bundle.mjs';
const out = resolve(process.argv[2]); await mkdir(out, { recursive: true });
const variants = [];
let prepare;
if (process.env.BUNDLE_BEFORE_REF) {
  const { variantBuilder } = await import('./bundle-variants.mjs');
  prepare = await variantBuilder(process.env.BUNDLE_BEFORE_REF, process.env.BUNDLE_REPOSITORY || process.cwd());
}
for (const spec of process.argv.slice(3)) {
  const [label, ...path] = spec.split('=');
  variants.push({ label, path: path.join('=') });
}
const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE))
  : await import('playwright').catch(() => import('/tmp/pw/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || (existsSync('/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') ? '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' : undefined), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const samples = [];
function compileMs(events) {
  const groups = new Map();
  for (const event of events) if (event.ph === 'X' && event.dur > 0 && /(?:v8.*(?:parse|compile)|(?:parse|compile).*script|compilecode)/i.test(event.name)) {
    const key = event.pid + ':' + event.tid;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([event.ts, event.ts + event.dur]);
  }
  let total = 0;
  for (const intervals of groups.values()) {
    intervals.sort((a, b) => a[0] - b[0]); let start = 0, end = 0;
    for (const [a, b] of intervals) { if (a > end) { total += end - start; start = a; end = b; } else end = Math.max(end, b); }
    total += end - start;
  }
  return total / 1000;
}
try {
  for (let run = 0; run < 5; run++) for (const variant of run % 2 ? [...variants].reverse() : variants) {
    variant.app = await serveBundle(prepare ? await prepare(variant.label) : resolve(variant.path), { dataDir: resolve(out, variant.label + '-server') });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Rendering is measured elsewhere; keep simulation rAF out of this CPU/network benchmark.
    await page.addInitScript(() => { performance.setResourceTimingBufferSize(2000); const raf = requestAnimationFrame; window.requestAnimationFrame = cb => cb.name === 'frame' ? 0 : raf(cb); });
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('Network.enable');
    let network;
    cdp.on('Network.requestWillBeSent', event => { if (network && /^https?:/.test(event.request.url)) network.set(event.requestId, { url: event.request.url, decoded: 0, transfer: 0 }); });
    cdp.on('Network.dataReceived', event => { const row = network?.get(event.requestId); if (row) row.decoded += event.dataLength; });
    cdp.on('Network.loadingFinished', event => { const row = network?.get(event.requestId); if (row) row.transfer = event.encodedDataLength; });
    for (const temperature of ['cold', 'warm']) {
      network = new Map();
      await cdp.send('Performance.disable'); await cdp.send('Performance.enable');
      const trace = []; cdp.on('Tracing.dataCollected', collect);
      function collect(event) { trace.push(...event.value); }
      await cdp.send('Tracing.start', { categories: 'v8,devtools.timeline,disabled-by-default-v8.compile', transferMode: 'ReportEvents' });
      if (temperature === 'cold') await page.goto(variant.app.url + '/?menu&quality=low&guest=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
      else await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => performance.getEntriesByName('menu-ready').length && window.__flow?.menu.screen === 'title', null, { timeout: 120000 });
      const atMenu = await page.evaluate(() => {
        const mark = performance.getEntriesByName('menu-ready')[0].startTime;
        const resources = performance.getEntriesByType('resource').filter(r => r.startTime <= mark);
        return { timeToMenuMs: mark, requestsAtMenu: resources.length + 1, transferAtMenu: resources.reduce((n, r) => n + r.transferSize, performance.getEntriesByType('navigation')[0].transferSize), decodedAtMenu: resources.reduce((n, r) => n + r.decodedBodySize, performance.getEntriesByType('navigation')[0].decodedBodySize) };
      });
      const ended = new Promise(done => cdp.once('Tracing.tracingComplete', done)); await cdp.send('Tracing.end'); await ended; cdp.off('Tracing.dataCollected', collect);
      const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      await page.waitForTimeout(3000);
      const settled = await page.evaluate(() => {
        const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')];
        return { requests: entries.length, networkRequests: entries.filter(r => r.transferSize > 0).length, transferBytes: entries.reduce((n, r) => n + r.transferSize, 0), encodedBytes: entries.reduce((n, r) => n + r.encodedBodySize, 0), decodedBytes: entries.reduce((n, r) => n + r.decodedBodySize, 0), mapRequests: entries.filter(r => new URL(r.name).pathname.startsWith('/data/')).length };
      });
      const wire = [...network.values()];
      if (process.env.BUNDLE_METRIC_SHOTS === '1' && run === 0 && temperature === 'warm') {
        await page.waitForFunction(() => document.querySelector('[data-title-hero]')?.dataset.ready === 'true', null, { timeout: 90000 }).catch(() => {});
        await page.screenshot({ path: resolve(out, variant.label + '-menu.png'), timeout: 60000 });
      }
      const sample = { run: run + 1, variant: variant.label, temperature, ...atMenu, ...settled, cdpRequests: wire.length, cdpNetworkRequests: wire.filter(row => row.transfer > 0).length, cdpTransferBytes: wire.reduce((n, r) => n + r.transfer, 0), cdpDecodedBytes: wire.reduce((n, r) => n + r.decoded, 0), parseCompileMs: compileMs(trace), scriptDurationMs: after.ScriptDuration * 1000, errors };
      if (errors.length) throw new Error('Benchmark page errors: ' + errors.join('; '));
      samples.push(sample); console.log(JSON.stringify(sample));
      await writeFile(resolve(out, 'samples.json'), JSON.stringify(samples, null, 2));
      await writeFile(resolve(out, `${variant.label}-${run + 1}-${temperature}-compile.json`), JSON.stringify({ traceEvents: trace.filter(e => /parse|compile/i.test(e.name)) }));
    }
    await context.close(); await variant.app.close(); variant.app = null;
  }
} finally { await browser.close(); for (const { app } of variants) if (app) await app.close(); }
