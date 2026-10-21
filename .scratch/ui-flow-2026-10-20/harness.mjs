// Shared browser harness for the flow and launch checks (2026-10-20): serves ROOT with the game server and the stub Google
// (server/accounts-stub.mjs), so sign-in is real (cookie session) without Google. One browser at a time, via tools/browser-slot.sh.
import http from 'node:http';
import fs from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** start the game server + static files for ROOT; returns { base, stub, close, setApiDelay(ms), setApiDown(bool) } */
export async function startServer(root, out) {
  const port = await new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const base = `http://127.0.0.1:${port}`;
  const { accountsStub } = await import(pathToFileURL(resolve(root, 'server/accounts-stub.mjs')));
  const stub = accountsStub(base);
  const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
  const dataDir = resolve(out, '.server-data');
  const app = await createGameServer({ root, accountEnv: stub.env, dataDir });
  const { buildReleaseInfo, buildCredits } = await import(pathToFileURL(resolve(root, 'tools/release-data.mjs')));
  const release = await buildReleaseInfo(root, { sha: 'flow' }), credits = await buildCredits(root, { authors: [] });
  let apiDelay = 0, apiDown = false;
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/') || path === '/health' || path.startsWith('/ws')) {
      if (apiDown) { req.socket.destroy(); return; }
      if (apiDelay) await sleep(apiDelay);
      return app.server.emit('request', req, res);
    }
    try {
      let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (path.startsWith('/vendor/')) file = resolve(root, 'node_modules/three', path.slice(8));
      let body = await fs.readFile(file);
      if (file.endsWith('index.html')) body = Buffer.from(body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/vendor/').replace('</head>', `<meta name="asr-version" content="${release.version}"><script id="asr-release-data" type="application/json">${JSON.stringify({ release, credits }).replaceAll('<', '\\u003c')}</script></head>`));
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  server.on('upgrade', (...args) => app.server.emit('upgrade', ...args));
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { base, stub, setApiDelay: ms => { apiDelay = ms; }, setApiDown: v => { apiDown = v; },
    close: async () => { server.close(); app.server.close(); await fs.rm(dataDir, { recursive: true, force: true }); } };
}

export async function launch() {
  const { chromium } = await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
  return chromium.launch({ headless: true, executablePath: '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
}

/** a signed-in browser context (the stub's session cookie) */
export async function signedIn(browser, srv, { viewport = { width: 1280, height: 800 }, name = 'GR-4821', id = 'flow-1' } = {}) {
  const auth = await srv.stub.signIn(id, name);
  const context = await browser.newContext({ viewport });
  const [n, ...v] = auth.cookie.split('='); await context.addCookies([{ name: n, value: v.join('='), url: srv.base }]);
  await context.addInitScript(n => { try { localStorage.setItem('paraliaki.driver', n); } catch {} }, name);
  return context;
}
