// Chase-camera frame strips of an overcooked, trail-braked Megara hairpin entry, real WebGL + production Ground.
//   tools/browser-slot.sh node tools/physics-test/handling-opus-browser.mjs after|before [car]
// before: BEFORE_DIR holds physics.js / cars.js to serve in place of src/ (the pre-fix modules).
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const out = resolve(root, '.scratch/handling-opus');
const phase = process.argv[2] || 'after', car = process.argv[3] || 'huracan', mode = process.argv[4] || 'hairpin';
const apexS = 1772.647, beforeDir = process.env.BEFORE_DIR;
await mkdir(out, { recursive: true });
let playwright;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/tmp/pw/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { playwright = await import(name.startsWith('/') ? pathToFileURL(name).href : name); break; } catch {}
}
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) && file !== root) throw new Error('Outside repository');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    if (phase === 'before' && beforeDir && (pathname === '/src/physics.js' || pathname === '/src/cars.js')) file = resolve(beforeDir, pathname.slice(5));
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const sockets = new WebSocketServer({ server, path: '/ws' });
sockets.on('connection', (s) => s.on('message', (b) => { try { const m = JSON.parse(String(b)); if (m.type === 'ping') s.send(JSON.stringify({ type: 'pong', sent: m.sent, now: Date.now() })); } catch {} }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, errors = [];
let browser;
try {
  const executablePath = process.env.CHROME_PATH || (existsSync(playwright.chromium.executablePath()) ? undefined : '/home/dev/.t3/tools/chrome-headless-shell/linux64/154.0.8037.92/chrome-headless-shell');
  browser = await playwright.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000); page.on('pageerror', (e) => errors.push(String(e)));
  const s0 = mode === 'sbend' ? 60 : apexS - 70;
  await page.goto(`http://127.0.0.1:${port}/?car=${car}&map=megara&cam=chase&simhook&debug&quality=low&notraffic&fixeddt&s=${s0}&event=megara-tt`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!window.__sim?.step && !!window.__vehicle?.() && window.__game.state === 'race', null, { timeout: 180000 });
  await page.evaluate(() => { window.__game.state = 'paused'; });
  const result = await page.evaluate(async ({ s0, apexS, mode }) => {
    const { RivalAI } = await import('/src/rival-ai.js');
    const sim = window.__sim, v = window.__vehicle(), { route, keys } = sim;
    keys.clear(); sim.G.inputDevice = 'keyboard';
    const u = route.closed ? 0 : route.laneU(s0, 0);
    v.reset(s0, u, 80 / 3.6); for (let k = 0; k < 30; k++) { v.update(1 / 60, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = 80 / 3.6; } v.reset(s0, u, 80 / 3.6);
    const ai = new RivalAI(route, v, { perfect: true, closedRoad: true });
    const frames = [], trace = [], held = new Set();
    // Real keyboard events through the game's Input (the same path as a player's key presses).
    const press = (want) => { for (const code of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) { const on = want.has(code); if (on === held.has(code)) continue;
      window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code.slice(3).toLowerCase(), bubbles: true })); if (on) held.add(code); else held.delete(code); } };
    sim.G.state = 'race';
    for (let i = 0; i < 60 * 6; i++) {
      const cmd = ai.update(1 / 60), d = apexS - v.s;
      if (mode === 'sbend') {
        // A lifted keyboard S-bend at 80 km/h: right for 0.6 s, left for 0.9 s, then straighten.
        press(new Set(i < 36 ? ['KeyD'] : i < 90 ? ['KeyA'] : [])); sim.step(1, 1 / 60);
        trace.push({ t: (i + 1) / 60, s: v.s, u: v.u, kmh: v.kmh, beta: Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong))) * 57.3, w: v.w, steer: sim.input.steer, brake: sim.input.brake, abs: v.absOn, esc: v.escOn, offroad: v.offroad, wall: v.wallHit, latch: v.driftLatch });
        if (i >= 30 && frames.length < 8 && i % 12 === 6) { sim.render(); frames.push(sim.canvas.toDataURL('image/png')); }
        if (i > 140) break; continue;
      }
      const want = new Set(), err = cmd.steer - sim.input.steer;
      if (Math.abs(err) > 0.075) want.add(err > 0 ? 'KeyD' : 'KeyA');
      // Overcooked: coast in at 80 km/h, brake late (30 m out) and trail the brake into the bend; then the AI's pedals.
      if (d > 30) { /* coast in at 80 */ } else if (d > -5 && v.kmh > 38) want.add('KeyS'); else if (cmd.throttle > 0.3) want.add('KeyW'); else if (cmd.brake > 0.3) want.add('KeyS');
      press(want);
      sim.step(1, 1 / 60);
      trace.push({ t: (i + 1) / 60, s: v.s, u: v.u, kmh: v.kmh, beta: Math.atan2(v.vLat, Math.max(2, Math.abs(v.vLong))) * 57.3, w: v.w, steer: sim.input.steer, brake: sim.input.brake, abs: v.absOn, esc: v.escOn, offroad: v.offroad, wall: v.wallHit, latch: v.driftLatch });
      if (d < 32 && frames.length < 8 && (i % 15 === 0)) { sim.render(); frames.push(sim.canvas.toDataURL('image/png')); }
      if (v.s > apexS + 60) break;
    }
    press(new Set()); sim.G.state = 'paused';
    // compose a 4x2 strip
    const imgs = await Promise.all(frames.map((src) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = src; })));
    const c = document.createElement('canvas'); c.width = 1280; c.height = 360; const g = c.getContext('2d');
    imgs.forEach((im, k) => g.drawImage(im, (k % 4) * 320, Math.floor(k / 4) * 180, 320, 180));
    return { strip: c.toDataURL('image/webp', 0.75), trace };
  }, { s0, apexS, mode });
  await writeFile(resolve(out, `${mode}-${car}-${phase}.webp`), Buffer.from(result.strip.split(',')[1], 'base64'));
  const t = result.trace, near = t.filter((r) => Math.abs(r.s - apexS) < 12);
  const summary = { phase, car, apexS, minKmhAtHairpin: Math.min(...near.map((r) => r.kmh)), maxAbsU: Math.max(...near.map((r) => Math.abs(r.u))), offroadFrames: t.filter((r) => r.offroad).length, wallFrames: t.filter((r) => r.wall > 0).length, maxBeta: Math.max(...t.map((r) => Math.abs(r.beta))), latchedFrames: t.filter((r) => r.latch > 0).length, escFrames: t.filter((r) => r.esc).length, errors };
  await writeFile(resolve(out, `${mode}-${car}-${phase}.json`), JSON.stringify({ summary, trace: t }, null, 1));
  console.log(JSON.stringify(summary));
} finally { await browser?.close(); await new Promise((r) => server.close(r)); }
