// Real race scene (Megara free roam, simhook) with the in-race notices up, chase + cockpit, 1280 / 1920 / 390.
//   tools/browser-slot.sh node .scratch/one-component-set/race-capture.mjs ROOT OUT_DIR
import http from 'node:http';
import fs from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]), out = resolve(process.argv[3]); await fs.mkdir(out, { recursive: true });
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
const app = await createGameServer({ root, dataDir: resolve(out, '.server-data') });
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary' };
const { buildReleaseInfo, buildCredits } = await import(pathToFileURL(resolve(root, 'tools/release-data.mjs')));
const release = await buildReleaseInfo(root, { sha: 'ui-audit' }), credits = await buildCredits(root, { authors: [] });
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/auth/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ providers: [], required: false })); return; }
  if (path.startsWith('/api/') || path === '/health') return app.server.emit('request', req, res);
  try {
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (path.startsWith('/vendor/')) file = resolve(root, 'node_modules/three', path.slice(8));
    let body = await fs.readFile(file);
    if (path === '/src/main.js') body = Buffer.from(body.toString().replaceAll('await compileScene();', '/* capture: compile on the explicit render */'));
    if (file.endsWith('index.html')) body = Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/vendor/').replace('</head>', `<meta name="asr-version" content="${release.version}"><script id="asr-release-data" type="application/json">${JSON.stringify({ release, credits }).replaceAll('<', '\\u003c')}</script></head>`));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
server.on('upgrade', (...args) => app.server.emit('upgrade', ...args));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], checks = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await context.newPage();
page.setDefaultTimeout(400000); page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = (cb) => { if (cb.name === 'frame') { window.auditFrame = cb; return 0; } return raf(cb); }; });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?simhook&map=megara&event=free&quality=low&notraffic&nopedestrians&cam=chase`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__sim?.player && document.body.classList.contains('loaded'));
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.evaluate(() => { __flow.menu.hide(); document.querySelector('#accounts-offline')?.remove(); __multiplayer.panel.hidden = true; __sim.G.state = 'race'; __sim.G.cam = 'chase'; __sim.G.cameraStarting = false; __sim.step(1); document.body.classList.remove('menu', 'menu-backdrop', 'ui-open', 'counting'); document.body.classList.add('racing'); document.querySelector('#count').textContent = ''; __sim.render(); });
  for (const [width, height] of [[1280, 800], [1920, 1080], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const view of ['chase', 'cockpit']) {
      await page.evaluate(async (view) => {
        if (__sim.G.cam !== view) __flow.action('camera'); document.body.dataset.cameraView = view; __sim.cameraBlend.active = false; __sim.step(2); __sim.cameraBlend.active = false; __sim.render();
        const n = __notifications; n.clear();
        const { pursuit } = await import('/src/police.js');
        Object.assign(pursuit, { enabled: true, state: 'pursuit', level: 3, heat: .8 });
        window.__policeHud?.update?.(0);
        if (!window.__policeHud) { const { PoliceHud } = await import('/src/police-hud.js'); new PoliceHud().update(0); }
        n.toast('<i>TOWED</i> · +5 s · BACK ON THE ROAD', { ms: 60000, priority: 40 });
        n.post({ title: 'TRACTION CONTROL OFF', text: 'Press V to turn it back on', ms: 60000 });
        n.dirty = true; n.update();
      }, view);
      await page.waitForTimeout(500);
      checks.push(await page.evaluate(([width, height, view]) => {
        const rect = (el) => { if (!el || !el.getClientRects().length || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
        const mv = __notifications.mirrorView?.();
        return { width, height, view, lane: rect(document.querySelector('#notification-lane')), cards: [...document.querySelectorAll('#notification-lane > :not([hidden])')].map(rect), badges: [...document.querySelectorAll('.hud-badges')].map(rect),
          posBox: rect(document.querySelector('#posBox')), mapBox: rect(document.querySelector('#mapBox')), dialBox: rect(document.querySelector('#dialBox')), limitSign: rect(document.querySelector('#limitSign')), routeBox: rect(document.querySelector('#routeBox')),
          mirrors: mv ? window.__notificationMirrorBounds?.() : null };
      }, [width, height, view]));
      await page.screenshot({ path: resolve(out, `race-${view}-${width}x${height}.png`) });
    }
  }
  console.log('COMPLETE');
} catch (e) { console.error(e); process.exitCode = 1; await page.screenshot({ path: resolve(out, 'race-failure.png') }).catch(() => {}); }
finally {
  await fs.writeFile(resolve(out, 'race-checks.json'), JSON.stringify({ errors, checks }, null, 1));
  await browser.close(); server.close(); app.server.close(); await fs.rm(resolve(out, '.server-data'), { recursive: true, force: true }); process.exit(process.exitCode || 0);
}
