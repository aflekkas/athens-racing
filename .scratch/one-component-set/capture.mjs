// Captures every menu screen at 1280x800, 1920x1080 and 390x844.
//   tools/browser-slot.sh node .scratch/one-component-set/capture.mjs ROOT OUT_DIR [only,names]
// ROOT is a clean checkout (git archive). Writes OUT_DIR/<name>-<w>x<h>.png and OUT_DIR/checks.json.
import http from 'node:http';
import fs from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]), out = resolve(process.argv[3]); await fs.mkdir(out, { recursive: true });
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
const app = await createGameServer({ root, dataDir: resolve(out, '.server-data') });
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary' };
const { buildReleaseInfo, buildCredits } = await import(pathToFileURL(resolve(root, 'tools/release-data.mjs')));
const release = await buildReleaseInfo(root, { sha: 'ui-audit' }), credits = await buildCredits(root, { authors: [] });
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/auth/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ providers: ['google'], required: false })); return; }
  if (path.startsWith('/api/') || path === '/health') return app.server.emit('request', req, res);
  try {
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (path.startsWith('/vendor/')) file = resolve(root, 'node_modules/three', path.slice(8));
    let body = await fs.readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/vendor/').replace('</head>', `<meta name="asr-version" content="${release.version}"><script id="asr-release-data" type="application/json">${JSON.stringify({ release, credits }).replaceAll('<', '\\u003c')}</script></head>`));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
server.on('upgrade', (...args) => app.server.emit('upgrade', ...args));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const result = { title: 'VICTORY', sub: 'You beat Stavros by 4.21 s', win: true, kick: 'QUICK RACE · ATHENS RIVIERA', rows: [['TIME', '6:42.18', true], ['TOP SPEED', '212 KM/H'], ['VS BEST', '−2.0 S'], ['POSITION', '1']], field: [{ pos: 1, name: 'YOU', car: 'MINI', time: '6:42.18', me: true }, { pos: 2, name: 'STAVROS', car: 'BMW M3', time: '+4.21' }] };
const SCREENS = [
  ['title', 'title', {}], ['signin', 'signIn', {}], ['account', 'account', {}], ['mode', 'mode', {}], ['maps', 'maps', { mode: 'quick' }],
  ['setup', 'setup', { mode: 'quick' }], ['garage', 'car', { garage: true, index: 0 }], ['garage-scrolled', 'car', { garage: true, index: 0 }],
  ['car-detail', 'car', { garage: true, index: 0, detail: true }],
  ...['driver', 'audio', 'video', 'driving', 'camera', 'controls', 'about'].map((tab) => ['settings-' + tab, 'settings', { tab, from: 'title' }]),
  ['whats-new', 'whatsNew', {}], ['credits', 'credits', {}], ['mp-join', 'mp', { tab: 'join' }], ['mp-host', 'mp', { tab: 'host' }], ['mp-lobby', 'mpLobby', {}],
  ['pause', 'pause', { kick: 'QUICK RACE · ATHENS RIVIERA', sub: 'LAP 1 · 1:23.4' }], ['results', 'results', result], ['loading', null, {}],
].filter(([n]) => !only || only.has(n));
const VIEWS = [[1280, 800], [1920, 1080], [390, 844]];
const errors = [], checks = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await context.newPage();
page.setDefaultTimeout(180000); page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.addInitScript(() => {
  const raf = requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { if (cb.name === 'frame') { window.__auditMainFrame = cb; return 0; } return raf(cb); };
  localStorage.setItem('paraliaki.driver', 'GR-4821');
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?menu&quality=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__flow?.menu?.screen && window.__multiplayer?.loaded);
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
  // the floating MULTIPLAYER pill is a gameplay control; headless boot leaves it over the status bar
  await page.addStyleTag({ content: '#mp-toggle{display:none!important}' });
  await page.evaluate(async () => {
    const { CARS } = await import('/src/cars.js');
    window.auditMP = { ...__multiplayer, id: 'you', me: { id: 'you', car: 'mini', ready: true }, worldReady: true, connected: true, cars: CARS, maps: [{ id: 'riviera', name: 'ATHENS RIVIERA' }], allowedCars: CARS.map((c) => c.id), lobby: { code: 'ATH123', name: 'RIVIERA EVENING', host: 'you', mapId: 'riviera', mode: 'sprint', status: 'waiting', capacity: 8, config: { time: 'afternoon', weather: 'clear', traffic: 1 }, players: [{ id: 'you', name: 'GR-4821', car: 'mini', ready: true, loaded: true, connected: true }, { id: 'friend', name: 'ELENI', car: 'z4', ready: false, loaded: true, connected: true }] } };
    const MP = await import('/src/ui/mp-screens.js'); __flow.menu.r_mpLobby = function () { return MP.renderLobby(this, auditMP); };
  });
  for (const [width, height] of VIEWS) {
    await page.setViewportSize({ width, height });
    for (const [name, screen, data] of SCREENS) {
      console.log('CAPTURE', width, name);
      await page.evaluate(async ([screen, data, name]) => {
        const m = __flow.menu; window.__loading?.hide?.();
        for (const el of document.querySelectorAll('#accounts-offline')) el.remove();
        __multiplayer.panel.hidden = true; __multiplayer.lobby = name === 'mp-lobby' ? auditMP.lobby : null;
        const acc = m.accounts;
        if (acc) {
          acc.offline = false; acc.ready = true; acc.providers = ['google']; acc.error = '';
          if (name === 'signin') acc.user = null;
          else Object.assign(acc, { user: { id: 'you', displayName: 'GR-4821', plate: 'IKA 1920' }, friends: [{ id: 'f1', display_name: 'ELENI', state: 'accepted' }, { id: 'f2', display_name: 'NIKOS', state: 'accepted' }, { id: 'f3', display_name: 'MARIA', state: 'pending', direction: 'incoming' }], presence: { f1: { status: 'in-menu' }, f2: { status: 'in-race', map: 'Penteli' } }, invites: [] });
        }
        if (!screen) { m.show('title'); m.hide?.(); window.__loading.show('riviera', 'QUICK RACE'); window.__loading.progress('LOADING ROADS', 0.42); return; }
        if (name === 'signin') { m.show('title'); await new Promise((r) => setTimeout(r, 300)); }
        if (name === 'mp-join' || name === 'mp-host') { const L = await import('/src/ui/mp-loader.js'); await L.openEntry(m, data.tab); } else m.show(screen, data);
        if (name === 'signin' && m.screen !== 'signIn') { await new Promise((r) => setTimeout(r, 800)); m.show(screen, data); }
      }, [screen, data, name]);
      await page.waitForTimeout(name === 'title' || name === 'signin' ? 1500 : name.startsWith('garage') || name === 'car-detail' || name === 'maps' || name.startsWith('mp') ? 2500 : 600);
      if (name.startsWith('garage')) await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('.car-grid img[data-car-thumb]')].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }); return imgs.length && imgs.every((i) => i.dataset.thumbReady === 'true'); }, null, { timeout: 60000 }).catch(() => console.log('thumbs not ready'));
      if (name === 'garage-scrolled') await page.evaluate(() => { const g = document.querySelector('.car-grid'); if (g) g.scrollTop = g.clientHeight * 0.61; });
      if (name === 'garage-scrolled') await page.waitForTimeout(1200);
      checks.push(await page.evaluate(([name, width, height]) => {
        const grid = document.querySelector('.car-grid'), cards = grid ? [...grid.querySelectorAll('.car-card')] : [];
        const g = grid?.getBoundingClientRect();
        const fullRows = g ? new Set(cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top >= g.top - 1 && r.bottom <= g.bottom + 1; }).map((c) => Math.round(c.getBoundingClientRect().top))).size : null;
        return { name, width, height, screen: __flow.menu.screen, nativeSelects: document.querySelectorAll('#ui select').length, scrollWidth: document.documentElement.scrollWidth, fullRows, gridTop: g?.top ?? null, gridHeight: g?.height ?? null };
      }, [name, width, height]));
      await page.screenshot({ path: resolve(out, `${name}-${width}x${height}.png`) });
    }
  }
  console.log('COMPLETE', checks.length);
} catch (e) { console.error(e); process.exitCode = 1; await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {}); }
finally {
  await fs.writeFile(resolve(out, 'checks.json'), JSON.stringify({ errors, checks }, null, 1));
  await browser.close(); server.close(); app.server.close(); await fs.rm(resolve(out, '.server-data'), { recursive: true, force: true }); process.exit(process.exitCode || 0);
}
