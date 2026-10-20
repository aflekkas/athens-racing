// Free roam picker in the Athens world (lead 2026-10-20, owner: "I can't click on the map anywhere", "could not scroll wheel to
// zoom out, the whole thing felt jank"). Serves ROOT locally with the world that staging serves (its manifest and cells
// proxied from staging.athensracing.com), signs in through the stub Google, opens ?map=athens&menu free roam and:
//   - shoots the picker, then zooms (Mac-style mouse wheel at the cursor) and clicks spots across the centre, north, west, coast
//   - checks +/- keys, drag pan, pinch (ctrl+wheel) and trackpad pan
//   - measures frame times in a 5 s pan-and-zoom sweep, and saves a zoom frame sequence
//   - presses DRIVE on one spot and checks the car is placed on a road there (optional: DRIVE=1)
//   tools/browser-slot.sh node check.mjs ROOT OUT_DIR
import http from 'node:http';
import fs from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]), out = resolve(process.argv[3]); await fs.mkdir(out, { recursive: true });
const STAGING = 'https://staging.athensracing.com';
const port = await new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const { accountsStub } = await import(pathToFileURL(resolve(root, 'server/accounts-stub.mjs')));
const stub = accountsStub(base);
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
const dataDir = resolve(out, '.server-data');
const app = await createGameServer({ root, accountEnv: stub.env, dataDir });
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary' };
const { buildReleaseInfo, buildCredits } = await import(pathToFileURL(resolve(root, 'tools/release-data.mjs')));
const release = await buildReleaseInfo(root, { sha: 'local' }), credits = await buildCredits(root, { authors: [] });
const worldCache = new Map();
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/') || path === '/health' || path.startsWith('/ws')) return app.server.emit('request', req, res);
  // The staging world: its manifest (the alias redirects to the content-addressed file) and its immutable cells.
  if (path === '/data/athens/manifest.json' || path.startsWith('/world/')) {
    try {
      let body = worldCache.get(path);
      if (!body) { const r = await fetch(STAGING + path); if (!r.ok) { res.writeHead(r.status); return res.end(); } body = Buffer.from(await r.arrayBuffer()); if (path.startsWith('/world/cells/')) worldCache.set(path, body); }
      res.writeHead(200, { 'Content-Type': path.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': body.length }); return res.end(body);
    } catch { res.writeHead(502); return res.end(); }
  }
  try {
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (path.startsWith('/vendor/')) file = resolve(root, 'node_modules/three', path.slice(8));
    let body = await fs.readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/vendor/').replace('</head>', `<script id="asr-release-data" type="application/json">${JSON.stringify({ release, credits }).replaceAll('<', '\\u003c')}</script></head>`));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(port, '127.0.0.1', r));
const auth = await stub.signIn('athens-picker-1', 'GR-4821');
const { chromium } = await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ headless: true, executablePath: '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', ...(process.env.GPU2D ? [] : ['--disable-accelerated-2d-canvas'])] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { errors: [], spots: [], input: {}, perf: {}, drive: null };
// Spots: [label, region, lat, lon, expect road?]
const SPOTS = [
  ['Syntagma', 'centre', 37.9755, 23.7348, true], ['Omonia', 'centre', 37.9841, 23.7280, true], ['Kypseli', 'centre', 38.0004, 23.7389, true],
  ['Marousi', 'north', 38.0502, 23.8071, true], ['Kifisia', 'north', 38.0737, 23.8114, true], ['Chalandri', 'north', 38.0212, 23.7993, true],
  ['Peristeri', 'west', 38.0136, 23.6912, true], ['Aigaleo', 'west', 37.9918, 23.6813, true], ['Piraeus', 'coast', 37.9421, 23.6465, true],
  ['Palaio Faliro', 'coast', 37.9276, 23.7008, true], ['Glyfada', 'coast', 37.8647, 23.7531, true], ['Voula', 'coast', 37.8436, 23.7745, true],
  ['Saronic sea', 'sea', 37.9000, 23.6000, false],
];
const W = 1280, H = 800;
try {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const [n, ...v] = auth.cookie.split('='); await context.addCookies([{ name: n, value: v.join('='), url: base }]);
  const page = await context.newPage(); page.setDefaultTimeout(240000); page.on('pageerror', e => report.errors.push(String(e.stack || e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { localStorage.setItem('paraliaki.driver', 'GR-4821'); });
  await page.goto(`${base}/?${process.env.LEGACY ? '' : 'map=athens&'}menu&quality=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__flow?.menu?.screen === 'title');
  await page.evaluate(() => document.fonts.ready); await sleep(1500);
  await page.evaluate(() => { const m = __flow.menu; m.stack.length = 0; m.show('maps', { filter: 'free', mode: 'free' }); });
  await page.waitForFunction(() => document.querySelector('.attica-map.ready') && window.__flow.menu.mapView, null, { timeout: 120000 });
  await sleep(9000);
  const state = () => page.evaluate(() => { const mv = window.__flow.menu.mapView, c = mv.choice; return { name: c.name, area: document.querySelector('.map-track-count')?.textContent, mapId: c.mapId, at: c.at, local: c.local, nohere: document.querySelector('.spawn-nohere')?.classList.contains('on'), marker: document.querySelector('.spawn-marker__name')?.textContent }; });
  await page.screenshot({ path: resolve(out, 'picker-1280x800.png') });
  report.initial = await state();
  const areas = [];
  for (let i = 0; i < (process.env.PERF_ONLY ? 0 : 20); i++) { const s = await state(); if (areas.includes(s.area)) break; areas.push(s.area); await page.keyboard.press('ArrowRight'); await sleep(1800); }
  report.areas = areas;
  await page.screenshot({ path: resolve(out, 'area-step-1280x800.png') });
  const at = (lat, lon) => page.evaluate(async ([lat, lon]) => { const s = await import('/src/spawn-spots.js'); return s.atticaFromLonLat(lon, lat); }, [lat, lon]);
  const screenOf = a => page.evaluate(a => window.__flow.menu.mapView.screenOf(a), a);
  const camScale = () => page.evaluate(() => { const mv = window.__flow.menu.mapView; const a = mv.screenOf([700, 400]), b = mv.screenOf([701, 400]); return b[0] - a[0]; });
  const MAC = 4.000244140625;
  // Zoom out with the mouse wheel (Mac-style notches) to the whole map, from the middle.
  await page.mouse.move(W * .35, H * .5);
  const s0 = await camScale(); for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, MAC * 10); await sleep(25); } await sleep(900);
  const s1 = await camScale();
  report.input.wheelOut = { before: +s0.toFixed(2), after: +s1.toFixed(2), zoomedOut: s1 < s0 * .5 };
  await page.screenshot({ path: resolve(out, 'zoomed-out-1280x800.png') });
  for (const [label, region, lat, lon, expect] of process.env.PERF_ONLY ? [] : SPOTS) {
    // From the whole map: zoom in at the spot with the wheel (the point under the cursor must stay put), then click it.
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, MAC * 10); await sleep(10); } await sleep(700);
    const a = await at(lat, lon); let p = await screenOf(a);
    await page.mouse.move(p[0], p[1]);
    for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, -MAC); await sleep(40); } await sleep(1200);
    const q = await screenOf(a), drift = Math.hypot(q[0] - p[0], q[1] - p[1]), scale = await camScale();
    await page.mouse.click(q[0] + 3, q[1] + 2); await sleep(900);
    const s = await state(), metres = s.mapId === 'athens' && !s.nohere ? Math.hypot(s.at[0] - a[0], s.at[1] - a[1]) * 87.65875 : null;
    const ok = expect ? !s.nohere && s.mapId === 'athens' && metres < 120 : s.nohere;
    report.spots.push({ label, region, expect, ok, street: s.name, area: s.area, nohere: s.nohere, metresFromClick: metres && +metres.toFixed(1), zoomScale: +scale.toFixed(1), cursorDriftPx: +drift.toFixed(1) });
    await page.screenshot({ path: resolve(out, `spot-${label.toLowerCase().replace(/\W+/g, '-')}-1280x800.png`) });
    console.log('spot', label, JSON.stringify(report.spots.at(-1)));
  }
  // +/- keys
  await page.mouse.move(10, 10);
  // from a middle zoom, so both keys have room: + twice, then − once
  await page.keyboard.press('Equal'); await sleep(1500);
  let k0 = await camScale(); await page.keyboard.press('Equal'); await sleep(1500); let k1 = await camScale(); await page.keyboard.press('Minus'); await sleep(1500); let k2 = await camScale();
  report.input.keys = { start: +k0.toFixed(2), afterPlus: +k1.toFixed(2), afterMinus: +k2.toFixed(2), ok: k1 > k0 * 1.3 && k2 < k1 / 1.3 };
  // drag pan
  const drag0 = await screenOf([800, 450]); await page.mouse.move(500, 400); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(500 + i * 20, 400 + i * 8); await sleep(16); } await sleep(150); await page.mouse.up(); await sleep(700);
  const drag1 = await screenOf([800, 450]); report.input.drag = { moved: [+(drag1[0] - drag0[0]).toFixed(0), +(drag1[1] - drag0[1]).toFixed(0)], ok: drag1[0] - drag0[0] > 150 };
  // trackpad two-finger pan (small fractional deltas) and pinch (ctrl+wheel)
  const tp0 = await screenOf([800, 450]); for (let i = 0; i < 12; i++) { await page.mouse.wheel(6.5, 3.25); await sleep(16); } await sleep(400); const tp1 = await screenOf([800, 450]);
  report.input.trackpadPan = { moved: [+(tp1[0] - tp0[0]).toFixed(0), +(tp1[1] - tp0[1]).toFixed(0)], ok: tp1[0] < tp0[0] - 40 };
  const pz0 = await camScale(); await page.keyboard.down('Control'); for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -6); await sleep(16); } await page.keyboard.up('Control'); await sleep(900); const pz1 = await camScale();
  report.input.pinch = { before: +pz0.toFixed(2), after: +pz1.toFixed(2), ok: pz1 > pz0 * 1.3 };
  // Frame times in a 5 s pan-and-zoom sweep (requestAnimationFrame intervals, measured in the page).
  // Our own main-thread work per frame: every requestAnimationFrame callback (the picker's frame loop) is timed.
  await page.evaluate(() => { window.__work = []; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(t => { const s = performance.now(); try { cb(t); } finally { if (window.__ftOn) window.__work.push(performance.now() - s); } }); });
  await page.evaluate(() => { window.__ft = []; let last = performance.now(); const tick = t => { window.__ft.push(t - last); last = t; if (window.__ftOn) requestAnimationFrame(tick); }; window.__ftOn = true; requestAnimationFrame(tick); });
  const t0 = Date.now(); let i = 0;
  await page.mouse.move(640, 400);
  while (Date.now() - t0 < 5000) {
    const phase = Math.floor(i / 25) % 4;
    if (phase === 0) await page.mouse.wheel(0, -MAC * 3); else if (phase === 1) await page.mouse.wheel(9.5, 4.25); else if (phase === 2) await page.mouse.wheel(0, MAC * 3); else await page.mouse.wheel(-9.5, -4.25);
    i++; await sleep(16);
  }
  await page.evaluate(() => { window.__ftOn = false; });
  const ft = (await page.evaluate(() => window.__ft)).slice(2).sort((a, b) => a - b), pct = q => ft[Math.min(ft.length - 1, Math.floor(q * ft.length))];
  const work = (await page.evaluate(() => window.__work)).sort((a, b) => a - b), wq = q => work.length ? +work[Math.min(work.length - 1, Math.floor(q * work.length))].toFixed(1) : null;
  const os = await import('node:os');
  report.perf = { loadAverage: os.loadavg().map(x => +x.toFixed(1)), cpus: os.cpus().length, work: { callbacks: work.length, p50: wq(.5), p95: wq(.95), max: wq(1) }, frames: ft.length, events: i, p50: +pct(.5).toFixed(1), p95: +pct(.95).toFixed(1), p99: +pct(.99).toFixed(1), max: +ft.at(-1).toFixed(1), over33: ft.filter(x => x > 33.4).length, renderer: await page.evaluate(() => window.__flow.menu.mapView?.stats?.() || null) };
  // A zoom frame sequence: from the basin to street level over Syntagma, a frame every ~140 ms.
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, MAC * 10); await sleep(10); } await sleep(1000);
  const sa = await screenOf(await at(37.9755, 23.7348)); await page.mouse.move(sa[0], sa[1]);
  for (let f = 0; f < 10; f++) { for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -MAC * 8); await sleep(15); } await sleep(80); await page.screenshot({ path: resolve(out, `zoom-${String(f).padStart(2, '0')}.png`) }); }
  await sleep(1500); await page.screenshot({ path: resolve(out, 'street-level-1280x800.png') });
  // 960x700: the picker at the narrow size
  await page.setViewportSize({ width: 960, height: 700 }); await sleep(2500); await page.screenshot({ path: resolve(out, 'picker-960x700.png') });
  await page.setViewportSize({ width: W, height: H }); await sleep(1500);
  // DRIVE from Kypseli: the open world boots there and puts the car on a road near the chosen point.
  if (process.env.DRIVE) {
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, MAC * 10); await sleep(10); } await sleep(700);
    const a = await at(38.0004, 23.7389), p = await screenOf(a); await page.mouse.move(p[0], p[1]);
    for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, -MAC * 10); await sleep(25); } await sleep(1200);
    const q = await screenOf(a); await page.mouse.click(q[0], q[1]); await sleep(900);
    const chosen = await state(); await page.screenshot({ path: resolve(out, 'drive-chosen-1280x800.png') });
    await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('[data-act=spawnDrive]')]);
    const url = page.url();
    await page.waitForFunction(() => window.__athens?.player?.veh, null, { timeout: 900000 });
    await page.waitForFunction(() => !document.getElementById('loading')?.classList.contains('open'), null, { timeout: 600000 }).catch(() => {});
    await sleep(5000);
    const car = await page.evaluate(() => { const v = window.__athens.player.veh; return { x: v.x, z: v.z }; });
    report.drive = { chosen: chosen.name, url: url.replace(base, ''), spawn: chosen.local, car, metres: +Math.hypot(car.x - chosen.local[0], car.z - chosen.local[1]).toFixed(1) };
    await page.screenshot({ path: resolve(out, 'drive-world-1280x800.png') });
    console.log('drive', JSON.stringify(report.drive));
  }
  await context.close();
} catch (e) { console.error(e); report.errors.push('script: ' + String(e.stack || e)); process.exitCode = 1; }
finally {
  await fs.writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ areas: report.areas, input: report.input, perf: report.perf, errors: report.errors.length }, null, 1));
  await browser.close(); server.close(); app.server.close(); await fs.rm(dataDir, { recursive: true, force: true }); process.exit(process.exitCode || 0);
}
