// Shared rig for the two-client browser tools (mp-two-client-browser.mjs, mp-lobby-browser.mjs): a real game server with the stub-Google
// sign-in (or staging with a smoke session), two clients in ONE Chromium context pair, a switchable shaped WebSocket (delay, jitter,
// retransmit stalls), CPU throttling and a frame cap per client, and a per-frame recorder. Run tools through tools/browser-slot.sh.
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';

export const NETS = { none: { base: 0, jitter: 0, loss: 0, rto: 0 }, mid: { base: 60, jitter: 20, loss: 0, rto: 0 }, rtt150: { base: 75, jitter: 50, loss: .015, rto: 300 }, bad: { base: 150, jitter: 50, loss: .015, rto: 300 } };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

/** url: the page to open for both clients (default: straight into a Riviera race session with the test hooks). stepTimeout: ms per wait. */
export async function startRig({ tree, out, target = '', net = 'rtt150', url = '/?simhook=1&debug=1&quality=low&fixedres=1&map=riviera', stepTimeout = 240000, names = ['ALPHA', 'BRAVO'], noDraw = false } = {}) {
  await mkdir(out, { recursive: true });
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
  let server, base, auth = [];
  if (target) {
    base = target.replace(/\/$/, '');
    const token = process.env.SMOKE_TOKEN || readFileSync(resolve(homedir(), '.config/athens-racing/smoke-token'), 'utf8').trim();
    // Same payload and HMAC as server/smoke-session.mjs; valid for ten minutes, so a staging run must stay shorter.
    const header = () => { const payload = `smoke:${randomBytes(16).toString('hex')}:${Date.now() + 540000}`; return payload + '.' + createHmac('sha256', token).update(payload).digest('base64url'); };
    auth = [{ smoke: header() }, { smoke: header() }];
  } else {
    const port = await freePort(); base = `http://127.0.0.1:${port}`;
    const { accountsStub } = await import(pathToFileURL(resolve(tree, 'server/accounts-stub.mjs')));
    const stub = accountsStub(base);
    const { createGameServer } = await import(pathToFileURL(resolve(tree, 'server/index.mjs')));
    server = await createGameServer({ root: tree, accountEnv: stub.env, dataDir: resolve(out, 'data'), countdownMs: 3000 });
    await new Promise(r => server.server.listen(port, '127.0.0.1', r));
    for (const [i, name] of names.entries()) { const a = await stub.signIn(`mp-sync-${i}`, name); auth.push({ cookie: a.cookie }); }
  }

  // ---- the link, switchable between scenarios: in-order delivery, base delay, jitter and the occasional retransmit stall
  const cond = { net: NETS[net] };
  function shaper() {
    const lane = () => { let last = 0; return fn => { const net = cond.net; let at = Date.now() + net.base + (Math.random() * 2 - 1) * net.jitter; if (net.loss && Math.random() < net.loss) at += net.rto; at = Math.max(last, at); last = at; setTimeout(fn, Math.max(0, at - Date.now())); }; };
    return { up: lane(), down: lane() };
  }
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const pages = {}, cdps = {}, errors = [], wsLog = [];
  const note = (who, dir, m) => { try { const j = JSON.parse(typeof m === 'string' ? m : m.toString()); if (!['state', 'sync', 'pong', 'ping'].includes(j.type)) wsLog.push({ t: Date.now() - t0, who, dir, type: j.type, status: j.lobby?.status, error: j.message }); } catch {} if (wsLog.length > 400) wsLog.shift(); };
  try {
    for (const [i, name] of ['A', 'B'].entries()) {
      const context = await browser.newContext({ viewport: { width: 320, height: 180 }, ...(auth[i].smoke ? { extraHTTPHeaders: { 'X-Smoke-Session': auth[i].smoke } } : {}) });
      if (auth[i].cookie) { const [n, ...v] = auth[i].cookie.split('='); await context.addCookies([{ name: n, value: v.join('='), url: base }]); }
      const page = await context.newPage(); pages[name] = page; page.setDefaultTimeout(stepTimeout);
      { const wait = page.waitForFunction.bind(page); page.waitForFunction = (fn, a, opts = {}) => wait(fn, a, { polling: 200, ...opts }); } // the default polls on requestAnimationFrame
      cdps[name] = await context.newCDPSession(page);
      page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
      if (target) await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: `smoke-${name}`, name: `SMOKE ${name}`, displayName: `SMOKE ${name}` }, csrf: 'x' } }));
      const shaped = shaper();
      await page.routeWebSocket(/\/ws(\?|$)/, ws => {
        const upstream = ws.connectToServer();
        ws.onMessage(m => { note(name, 'up', m); shaped.up(() => upstream.send(m)); });
        upstream.onMessage(m => { note(name, 'down', m); shaped.down(() => ws.send(m)); });
        ws.onClose((code, reason) => upstream.close({ code, reason })); upstream.onClose((code, reason) => ws.close({ code, reason }));
      });
      await page.addInitScript(({ name, names, noDraw }) => {
        // Software GL on a shared host makes one drawing client starve the other: skip the draw calls, keep every other GL call and all game logic.
        if (noDraw) for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (C?.prototype[k]) C.prototype[k] = function () {};
        localStorage.setItem('paraliaki.driver', name === 'A' ? names[0] : names[1]); localStorage.setItem('paraliaki.car', 'mini');
        // The menu instance: the boot menu when the title loaded lazily, else the one the game runtime built.
        Object.defineProperty(window, '__menu', { get: () => window.__bootMenu || window.__flow?.menu });
        const raf = window.requestAnimationFrame.bind(window); let lastRun = 0; const frames = window.__frames = [];
        window.__fps = 0;
        window.requestAnimationFrame = cb => raf(ts => {
          if (window.__fps && ts - lastRun < 1000 / window.__fps - 4) return window.requestAnimationFrame(cb); // a machine that only manages __fps
          lastRun = ts; cb(ts);
          if (cb.name === 'frame' && window.__record) {
            const v = window.__vehicle?.(), remote = window.__onlineCars?.()[0];
            frames.push({ wall: Date.now(), x: v?.x, z: v?.z, y: v?.y, yaw: v?.yaw, s: v?.s, v: v?.vLong, remote: remote ? { visible: remote.visible, x: remote.x, z: remote.z, yaw: remote.yaw, s: remote.s, v: remote.vLong } : null, state: window.__sim?.G.state, hits: (window.__multiplayer?.lastContacts || []).filter(h => h.closing > 1).map(h => ({ closing: h.closing, impulse: h.impulse })) });
          }
        });
      }, { name, names, noDraw });
      await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 240000 });
    }
  } catch (error) { await browser.close().catch(() => {}); if (server) await server.close().catch(() => {}); throw error; }
  const both = fn => Promise.all(Object.values(pages).map(fn));
  const setCpu = async (name, rate) => cdps[name].send('Emulation.setCPUThrottlingRate', { rate });
  const close = async () => { await browser.close().catch(() => {}); if (server) await server.close().catch(() => {}); };
  return { base, pages, cdps, cond, both, setCpu, close, errors, NETS, wsLog };
}
