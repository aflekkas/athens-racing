// Real WebGL/ground/input smoke proof. Run through tools/browser-slot.sh.
// node tools/physics-test/driver-feel-browser.mjs [before|after]
// Before uses captured physics-before.js/input-before.js/cars-before.js in the
// artifact folder. PLAYWRIGHT_MODULE / CHROME_PATH may select local tooling.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const out = resolve(root, '.scratch/handling-feel');
const phase = process.argv[2] || 'after';
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after');
await mkdir(out, { recursive: true });
let playwright;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/tmp/pw/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { playwright = await import(name.startsWith('/') ? pathToFileURL(name).href : name); break; } catch {}
}
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) && file !== root) throw new Error('Outside repository');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    if (phase === 'before' && ['/src/physics.js', '/src/cars.js'].includes(pathname)) file = resolve(out, pathname.slice(5, -3) + '-before.js');
    let bytes = await readFile(file);
    if (phase === 'before' && pathname === '/src/input.js') {
      // Other agents may add unrelated input APIs during this shared-checkout
      // run. Keep those APIs, replay the exact captured steering ramp/curve.
      const baseline = await readFile(resolve(out, 'input-before.js'), 'utf8');
      let source = bytes.toString();
      for (const name of ['rate', 'keyboardSteer']) source = source.replace(new RegExp(`^    const ${name} = .*;$`, 'm'), baseline.match(new RegExp(`^    const ${name} = .*;$`, 'm'))[0]);
      bytes = Buffer.from(source);
    }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`Handling ${phase}: private server on ${port}`);
let browser;
const errors = [], runs = [];
try {
  const executablePath = process.env.CHROME_PATH || (existsSync(playwright.chromium.executablePath()) ? undefined : '/home/dev/.t3/tools/chrome-headless-shell/linux64/154.0.8037.92/chrome-headless-shell');
  browser = await playwright.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('Browser console:', m.text()); });
  page.on('requestfailed', r => { if (!r.url().includes('/ws')) console.log('Request failed:', r.url(), r.failure()?.errorText); });
  const cdp = await page.context().newCDPSession(page);
  for (const car of ['z4', 'mini']) {
    const response = await page.goto(`http://127.0.0.1:${port}/?car=${car}&simhook&debug&quality=low&notraffic&fixeddt&s=1704`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (response.status() !== 200) throw new Error(`Game page returned HTTP ${response.status()}`);
    try {
      await page.waitForFunction(() => !!window.__sim?.step && !!window.__vehicle?.() && window.__game.state === 'race', null, { timeout: 120000 });
    } catch (error) {
      console.log('Boot state', await page.evaluate(() => ({ game: window.__game?.state, sim: !!window.__sim, car: window.__vehicle?.()?.spec.id, text: document.body.innerText.slice(0, 1000) })));
      await page.screenshot({ path: resolve(out, `${phase}-boot-failure.png`) });
      throw error;
    }
    // Pause autonomous animation after boot; the existing simhook advances the
    // normal player update at 60 Hz. Input remains real trusted CDP key events.
    await page.evaluate(() => {
      window.__handlingFrames = [];
      window.requestAnimationFrame = cb => { window.__handlingFrames.push(cb); return 0; };
      window.__game.state = 'paused';
    });
    await page.waitForTimeout(250);
    for (const powered of [false, true]) {
      const setup = await page.evaluate(() => {
        const { route, keys, G } = window.__sim, v = window.__vehicle();
        keys.clear(); G.state = 'paused'; G.inputDevice = 'keyboard';
        const s = 1704, u = route.laneU(s, 0), side = Math.sign(route.curv(s));
        v.reset(s, u, 25);
        // A rolling car in a road gear, with settled tyres and engine.
        for (let i = 0; i < 90; i++) { v.update(1 / 60, { throttle: 0.2, brake: 0, steer: 0 }); v.vLong = 25; }
        const gear = v.gear;
        v.reset(s, u, 25); v.gear = gear;
        v.rpm = Math.max(v.spec.idle, 25 / v.spec.wheelR * v.ratio() * 30 / Math.PI);
        return { side, car: v.spec.id, assist: v.steerAssist, cornerRadius: 1 / Math.abs(route.curv(s)), gear };
      });
      if (setup.car !== car) throw new Error(`Wrong car: expected ${car}, got ${setup.car}`);
      const code = setup.side > 0 ? 'KeyD' : 'KeyA', key = setup.side > 0 ? 'd' : 'a';
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: setup.side > 0 ? 68 : 65 });
      if (powered) await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
      const trace = await page.evaluate(() => {
        const sim = window.__sim, v = window.__vehicle(), trace = [];
        sim.G.state = 'race';
        // 0.8 s turns through ~15–20 degrees of the real corner, before a
        // sustained full-lock circle would necessarily leave its asphalt.
        for (let i = 0; i < 48; i++) {
          sim.step(1, 1 / 60);
          trace.push({ t: (i + 1) / 60, steerInput: sim.input.steer, throttle: sim.input.throttle,
            rackDeg: v.steer * 180 / Math.PI, kmh: v.speed * 3.6, yawRate: v.w,
            lateralG: Math.abs(v.ayRaw) / 9.81, frontDeg: v.slipF * 180 / Math.PI, rearDeg: v.slipR * 180 / Math.PI,
            tcCut: v.tcCut, escCut: v.escCut, offroad: v.offroad, wallHit: v.wallHit,
            x: v.x, z: v.z, s: v.s, u: v.u, assist: v.steerAssist });
        }
        sim.G.state = 'paused';
        return trace;
      });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: setup.side > 0 ? 68 : 65 });
      if (powered) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
      await page.evaluate(() => { const cb = window.__handlingFrames.pop(); window.__handlingFrames.length = 0; cb?.(performance.now()); });
      const label = `${phase}-${car}-${powered ? 'power' : 'coast'}`;
      await page.screenshot({ path: resolve(out, label + '.png') });
      const run = { label, ...setup, powered, trace };
      runs.push(run);
      await writeFile(resolve(out, label + '.json'), JSON.stringify(run, null, 2) + '\n');
      if (trace.some(r => !Number.isFinite(r.yawRate) || r.offroad || r.wallHit > 1)) throw new Error(`${label}: invalid drive / left asphalt / hit barrier`);
      if (trace.at(-1).assist !== 1 || Math.abs(trace.at(-1).steerInput) !== 1) throw new Error(`${label}: default full keyboard input did not reach physics`);
      console.log(`${label}: 150 ms ${trace[8].lateralG.toFixed(3)} g, 250 ms ${trace[14].lateralG.toFixed(3)} g, peak ${Math.max(...trace.map(r => r.lateralG)).toFixed(3)} g, u ${trace.at(-1).u.toFixed(2)}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await writeFile(resolve(out, `browser-${phase}.json`), JSON.stringify({ phase, port, errors, runs }, null, 2) + '\n');
  await browser?.close();
  await new Promise(r => server.close(r));
}
