// UI taste pass (2026-10-20): every screen at 1280x800 and 960x700, signed in through the stub Google (server/accounts-stub.mjs).
//   tools/browser-slot.sh node .scratch/ui-taste-2026-10-20/capture.mjs ROOT OUT_DIR [only,names]
// ROOT is a clean archive of prod (node_modules symlinked). Writes OUT_DIR/<screen>/<screen>-<w>x<h>.png.
import http from 'node:http';
import fs from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]), out = resolve(process.argv[3]); await fs.mkdir(out, { recursive: true });
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const want = (n) => !only || only.has(n);
const port = await new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const base = `http://127.0.0.1:${port}`;
const { accountsStub } = await import(pathToFileURL(resolve(root, 'server/accounts-stub.mjs')));
const stub = accountsStub(base);
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
const dataDir = resolve(out, '.server-data');
const app = await createGameServer({ root, accountEnv: stub.env, dataDir });
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' };
const { buildReleaseInfo, buildCredits } = await import(pathToFileURL(resolve(root, 'tools/release-data.mjs')));
const release = await buildReleaseInfo(root, { sha: 'ui-taste' }), credits = await buildCredits(root, { authors: [] });
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/') || path === '/health' || path.startsWith('/ws')) return app.server.emit('request', req, res);
  try {
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (path.startsWith('/vendor/')) file = resolve(root, 'node_modules/three', path.slice(8));
    let body = await fs.readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/vendor/').replace('</head>', `<meta name="asr-version" content="${release.version}"><script id="asr-release-data" type="application/json">${JSON.stringify({ release, credits }).replaceAll('<', '\\u003c')}</script></head>`));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
server.on('upgrade', (...args) => app.server.emit('upgrade', ...args));
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const auth = await stub.signIn('ui-taste-1', 'GR-4821');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ headless: true, executablePath: '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name, w, h) => { await page.waitForFunction(() => !document.querySelector('#ui.is-entering, #ui.is-leaving'), null, { timeout: 20000 }).catch(() => {}); await sleep(400); await fs.mkdir(resolve(out, name), { recursive: true }); await page.screenshot({ path: resolve(out, name, `${name}-${w}x${h}.png`) }); console.log('shot', name, w, h); };
const result = { title: 'VICTORY', sub: 'You beat Stavros by 4.21 s', win: true, kick: 'QUICK RACE · ATHENS RIVIERA', rows: [['TIME', '6:42.18', true], ['TOP SPEED', '212 KM/H'], ['VS BEST', '−2.0 S'], ['POSITION', '1']], field: [{ pos: 1, name: 'YOU', car: 'MINI', time: '6:42.18', me: true }, { pos: 2, name: 'STAVROS', car: 'BMW M3', time: '+4.21' }, { pos: 3, name: 'ELENI', car: 'AUDI TT', time: '+9.80' }], splits: [{ name: 'SECTOR 1 · GLYFADA', time: '2:01.4', delta: '−0.6', cls: 'good' }, { name: 'SECTOR 2 · VOULA', time: '2:14.9', delta: '+0.2', cls: 'bad' }, { name: 'SECTOR 3 · VOULIAGMENI', time: '2:25.8', delta: '−1.6', cls: 'good' }] };
const MENU = [
  ['title', 'title', {}], ['mode', 'mode', {}], ['maps', 'maps', { mode: 'quick' }], ['map-confirm', 'mapConfirm', { mapId: 'riviera', mode: 'quick' }],
  ['spawn', 'maps', { mode: 'free', filter: 'free' }], ['setup', 'setup', { mode: 'quick' }],
  ['garage', 'car', { garage: true, index: 0 }], ['car-detail', 'car', { garage: true, index: 0, detail: true }],
  ['leaderboards', 'leaderboards', { tab: 'global', filters: { mapId: 'riviera' } }],
  ...['audio', 'video', 'driving', 'controls'].map((tab) => ['settings-' + tab, 'settings', { tab, from: 'title' }]),
  ['whats-new', 'whatsNew', {}], ['credits', 'credits', {}], ['account', 'account', {}],
  ['mp-browse', 'mp', {}], ['mp-host', 'mpHost', {}], ['mp-lobby', 'mpLobby', {}],
  ['pause', 'pause', { kick: 'QUICK RACE · ATHENS RIVIERA', sub: 'LAP 1 · 1:23.4' }], ['results', 'results', result], ['loading', null, {}],
].filter(([n]) => want(n));
const SIZES = [[1280, 800], [960, 700]];
try {
  // ---- menu screens, signed in
  if (MENU.length) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const [n, ...v] = auth.cookie.split('='); await context.addCookies([{ name: n, value: v.join('='), url: base }]);
    const page = await context.newPage(); page.setDefaultTimeout(240000); page.on('pageerror', (e) => errors.push(String(e.stack || e)));
    await page.addInitScript(() => { localStorage.setItem('paraliaki.driver', 'GR-4821'); });
    await page.goto(`${base}/?menu&quality=low`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__flow?.menu?.screen === 'title');
    await page.evaluate(() => document.fonts.ready); await sleep(2500);
    // open the garage once so the main runtime (and the full menu) loads
    await page.click('[data-act="play"]'); await page.waitForSelector('[data-act="quick"]'); await sleep(500);
    await page.waitForFunction(() => window.__multiplayer?.loaded, null, { timeout: 240000 }).catch(() => console.log('no mp loaded'));
    await page.addStyleTag({ content: '#mp-toggle{display:none!important}' });
    await page.evaluate(async () => {
      const { CARS } = await import('/src/cars.js');
      const lobby = (code, name, mapId, mode, n, status, time, weather) => ({ code, name, host: 'p0', mapId, mode, status, capacity: 8, config: { time, weather, traffic: 1 }, players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: ['ELENI', 'NIKOS', 'MARIA', 'YANNIS', 'SOFIA', 'KOSTAS', 'DIMITRA', 'ALEX'][i] })) });
      window.auditMP = { ...__multiplayer, loaded: true, id: 'you', me: { id: 'you', car: 'mini', ready: true }, worldReady: true, connected: true, canChangeCar: true, cars: CARS, maps: [{ id: 'riviera', name: 'ATHENS RIVIERA' }, { id: 'penteli', name: 'PENTELI HILL CLIMB' }, { id: 'psychiko', name: 'PSYCHIKO GARDEN CIRCUIT' }], allowedCars: CARS.map((c) => c.id),
        __lobbies: [lobby('RIV123', 'RIVIERA EVENING', 'riviera', 'sprint', 3, 'waiting', 'sunset', 'clear'), lobby('PEN456', 'Penteli Sunday run', 'penteli', 'sprint', 8, 'waiting', 'afternoon', 'clear'), lobby('PSY789', 'GARDEN LAPS', 'psychiko', 'circuit', 5, 'race', 'night', 'rain')],
        lobby: { code: 'ATH123', name: 'RIVIERA EVENING', host: 'you', mapId: 'riviera', mode: 'sprint', status: 'waiting', capacity: 8, config: { time: 'afternoon', weather: 'clear', traffic: 1 }, players: [{ id: 'you', name: 'GR-4821', car: 'mini', ready: true, loaded: true, connected: true }, { id: 'friend', name: 'ELENI', car: 'z4', ready: false, loaded: true, connected: true }] } };
      const MP = await import('/src/ui/mp-screens.js'); const m = __flow.menu;
      m.r_mp = function () { return MP.renderMp(this, auditMP); }; m.r_mpHost = function () { return MP.renderHost(this, auditMP); }; m.r_mpLobby = function () { return MP.renderLobby(this, auditMP); };
    });
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      for (const [name, screen, data] of MENU) {
        await page.evaluate(async ([screen, data, name]) => {
          const m = __flow.menu; window.__loading?.hide?.();
          if (!screen) { m.show('title'); m.hide?.(); window.__loading.show('riviera', 'QUICK RACE'); window.__loading.progress('LOADING ROADS', 0.42); return; }
          m.stack.length = 0; m.show(screen, structuredClone(data));
        }, [screen, data, name]);
        await sleep(['maps', 'spawn', 'garage', 'car-detail', 'map-confirm'].includes(name) || name.startsWith('mp') ? 6000 : 1500);
        if (name === 'garage') await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('img[data-car-thumb]')].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }); return imgs.length && imgs.every((i) => i.dataset.thumbReady === 'true'); }, null, { timeout: 90000 }).catch(() => console.log('thumbs not ready'));
        if (name === 'maps' || name === 'spawn') await page.waitForFunction(() => document.querySelector('.attica-map.ready') && !document.querySelector('.panel--moving'), null, { timeout: 120000 }).then(() => sleep(9000)).catch(() => console.log('map not settled'));
        await shot(page, name, w, h);
        if (process.env.DUMP) console.log('dump', name, JSON.stringify(await page.evaluate(() => { const out = []; let e = document.elementFromPoint(800, 260);
          for (; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.opacity !== '1' || cs.filter !== 'none') out.push([e.tagName + '.' + e.className + '#' + e.id, cs.opacity, cs.filter]); }
          return { chain: out, top: document.elementsFromPoint(800, 260).slice(0, 6).map(x => x.tagName + '.' + x.className + '#' + x.id), body: document.body.className, ui: document.getElementById('ui')?.className }; })));
        if (name === 'spawn' && want('spawn-input')) {
          // Free roam input proof (owner 2026-10-20): a two-finger trackpad scroll pans, a mouse wheel notch zooms, a click snaps to a road.
          const box = await page.locator('.attica-map').boundingBox(), cx = box.x + box.width * .35, cy = box.y + box.height * .55;
          const cam = () => page.evaluate(() => { const c = document.querySelector('.attica-canvas'); return window.__flow.menu.mapView.screenOf([780, 540]).map(Math.round); });
          const before = await cam();
          await page.mouse.move(cx, cy); for (let i = 0; i < 6; i++) { await page.mouse.wheel(18.5, 7.25); await sleep(30); }
          await sleep(600); const panned = await cam();
          await sleep(400); for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -100); await sleep(260); } await sleep(900); const zoomed = await cam();
          // click the nearest drawn road to the map centre of the safe area: pick a point of the riviera roads on screen
          const target = await page.evaluate(async () => { const s = await import('/src/spawn-spots.js'), roads = s.decodeSpawnRoads(await (await fetch('assets/maps/spawn-roads.json')).json()), mv = window.__flow.menu.mapView;
            for (const r of roads.riviera.roads) if (r.name && !r.major) { const p = mv.screenOf([r.pts[0], r.pts[1]]); if (p[0] > 200 && p[0] < innerWidth * .6 && p[1] > 200 && p[1] < innerHeight - 150) return { p, name: r.name }; } return null; });
          if (target) { await page.mouse.click(target.p[0] + 2, target.p[1] + 1); await sleep(6000); }
          const after = await page.evaluate(() => ({ choice: window.__flow.menu.mapView.choice.name, marker: document.querySelector('.spawn-marker__name')?.textContent, panel: document.querySelector('.map-preview h3')?.textContent, pins: document.querySelectorAll('.spawn-pin').length }));
          console.log('spawn-input', w, h, JSON.stringify({ before, panned, zoomed, target: target?.name, after }));
          await shot(page, 'spawn-click', w, h);
          if (process.env.PROBE) for (const wait of [0, 15000]) { await sleep(wait); await shot(page, 'spawn-click-probe-' + wait, w, h);
            console.log('probe', wait, JSON.stringify(await page.evaluate(() => { const c = document.querySelector('.attica-canvas'), r = c.getBoundingClientRect(), g = c.getContext('2d'), k = c.width / r.width;
              const px = (x, y) => [...g.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data];
              return { canvas: [r.left, r.top, r.width, r.height, c.width, c.height], at: px(1200, 680), beside: px(1050, 680), els: document.elementsFromPoint(1200, 680).slice(0, 5).map(e => e.tagName + '.' + e.className), stats: window.__flow.menu.mapView && window.__mapStats?.() }; }))); }
          await page.evaluate(() => window.__flow.menu.action('right')); await sleep(10000);
          console.log('spawn-area', w, h, await page.evaluate(() => document.querySelector('.map-track-count')?.textContent + ' / ' + window.__flow.menu.mapView.choice.name));
          await shot(page, 'spawn-area', w, h);
          await page.evaluate(() => { window.__flow.menu.data.spawn = null; });
        }
      }
    }
    await context.close();
  }
  // ---- sign-in dialog: a fresh visitor with no session
  if (want('signin')) for (const [w, h] of SIZES) {
    const context = await browser.newContext({ viewport: { width: w, height: h } }), page = await context.newPage(); page.on('pageerror', (e) => errors.push(String(e.stack || e)));
    await page.goto(`${base}/?menu&quality=low`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dialog', { timeout: 120000 }).catch(() => console.log('no dialog'));
    await page.evaluate(() => document.fonts.ready); await sleep(2500);
    await shot(page, 'signin', w, h); await context.close();
  }
  // ---- the computers-only gate: a tablet-class touch device at desktop sizes
  if (want('gate')) for (const [w, h] of SIZES) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'load' }); await page.waitForSelector('#device-gate:visible', { timeout: 30000 }).catch(() => console.log('no gate')); await sleep(800);
    await shot(page, 'gate', w, h); await context.close();
  }
  // ---- in-race HUD, pause over the race, results over the race
  if (want('hud') || want('pause-race') || want('results-race')) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const [n, ...v] = auth.cookie.split('='); await context.addCookies([{ name: n, value: v.join('='), url: base }]);
    const page = await context.newPage(); page.setDefaultTimeout(600000); page.on('pageerror', (e) => errors.push(String(e.stack || e)));
    await page.goto(`${base}/?simhook&map=riviera&quick&quality=low&cam=chase`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__sim?.player && document.body.classList.contains('loaded'), null, { timeout: 600000 });
    await page.waitForFunction(() => window.__game?.state === 'race' || window.__sim?.G?.state === 'race', null, { timeout: 120000 }).catch(() => console.log('no race state'));
    await page.evaluate(() => { const v = window.__sim.player.veh; window.__sim.player.input = { throttle: 1, brake: 0, steer: 0 }; });
    await sleep(8000);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h }); await sleep(2500);
      if (want('hud')) await shot(page, 'hud', w, h);
    }
    if (want('pause-race')) for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(() => window.__flow.action?.('pause') ?? window.__flow.pause?.()); await sleep(2000);
      await shot(page, 'pause-race', w, h);
      await page.evaluate(() => window.__flow.menu.action('back')); await sleep(1500);
    }
    await context.close();
  }
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  await fs.writeFile(resolve(out, 'errors.json'), JSON.stringify(errors, null, 1));
  await browser.close(); server.close(); app.server.close(); await fs.rm(dataDir, { recursive: true, force: true }); process.exit(process.exitCode || 0);
}
