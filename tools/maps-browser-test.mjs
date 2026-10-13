#!/usr/bin/env node
// Run via tools/browser-slot.sh node tools/maps-browser-test.mjs.
// Uses a private static server on port 8057 (MAP_TEST_PORT overrides) and never restarts the game server.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAPS } from '../src/map-catalog.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.scratch/megara');
const ids = process.env.MAP_TEST_IDS?.split(',') || MAPS.map(m => m.id);
let playwright;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/tmp/pw/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { playwright = await import(name.startsWith('/') ? pathToFileURL(name).href : name); break; } catch {}
}
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    let file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + sep) && file !== root) throw new Error('Outside repository');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((yes, no) => { server.once('error', no); server.listen(+(process.env.MAP_TEST_PORT || 8057), '127.0.0.1', yes); });
console.log(`Map browser test server PID ${process.pid}, port ${server.address().port}`);
await mkdir(out, { recursive: true });
let browser;
const report = { visits: [], errors: [] };
try {
  let executablePath = process.env.CHROME_BIN;
  if (!executablePath && !existsSync(playwright.chromium.executablePath())) {
    const cache = resolve(homedir(), '.cache/ms-playwright');
    for (const folder of (await readdir(cache).catch(() => [])).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
      const candidate = resolve(cache, folder, 'chrome-linux64/chrome');
      if (existsSync(candidate)) { executablePath = candidate; break; }
    }
  }
  browser = await playwright.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => { report.errors.push(String(error)); console.error('PAGE ERROR', String(error)); });
  await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=low&notraffic&map=${ids[0]}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.querySelector('#err')?.textContent?.startsWith('Error:'), null, { timeout: 180000 });
  if (!(await page.evaluate(() => document.body.classList.contains('loaded')))) throw new Error(await page.locator('#err').textContent());
  // Repeat every map: resource ownership must plateau once shared geometry caches warm up.
  for (let pass = 0; pass < 3; pass++) for (const id of ids) {
    const visit = await page.evaluate(async ({ id, pass }) => {
      await window.__flow.switchMap(id);
      const sim = window.__sim, r = sim.route, v = sim.player.veh;
      const samples = [];
      // Integrate physics around a representative part of every map; cross the lap seam on circuits.
      const stations = r.closed ? [r.length - 3, r.length + r.length * .3, 2 * r.length - 3] : [r.start + 50, (r.start + r.finish) / 2];
      for (const s of stations) {
        v.reset(s, r.closed ? 0 : r.laneU(s, 0), 12); v.ground = sim.ground;
        let prior = v.s;
        for (let k = 0; k < 90; k++) {
          const f = r.frame(v.s + 10, {});
          const heading = Math.atan2(-f.tx, -f.tz);
          const err = Math.atan2(Math.sin(heading - v.yaw), Math.cos(heading - v.yaw));
          v.update(1 / 60, { throttle: .15, brake: 0, steer: Math.max(-1, Math.min(1, -err)), nitro: false, handbrake: false });
          if (![v.x, v.y, v.z, v.s, v.u, v.vLong].every(Number.isFinite)) throw new Error(id + ': nonfinite simulation');
          if (r.closed && Math.abs(v.s - prior) > r.length * .25) throw new Error(id + ': lap progress discontinuity');
          prior = v.s;
        }
        samples.push({ start: s, end: v.s, lateral: v.u, height: v.y });
      }
      // Exercise the game's references too, then permit uploads and a normal frame before recording memory.
      sim.step(1);
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      // Compare an identical camera on each revisit; parked-car LODs otherwise follow the menu orbit.
      const ctx = window.__replay.ctx, eye = r.point(r.start + 100, 0), ahead = r.point(r.start + 140, 0);
      ctx.camera.position.set(eye.x, eye.y + 8, eye.z); ctx.camera.lookAt(ahead.x, ahead.y + 1, ahead.z);
      const { updateSceneryLod } = await import('./src/scenery.js');
      const lod = []; ctx.scene.traverse(o => { if (o.userData.far && o.boundingSphere) lod.push(o); });
      updateSceneryLod(lod, ctx.camera); ctx.render();
      const state = window.__mapRuntime();
      if (state.worlds.length !== 1 || state.mapId !== id) throw new Error(id + ': map root not replaced');
      if (state.lastDisposal && (!state.lastDisposal.detached || state.lastDisposal.children || !state.lastDisposal.bundleDisposed)) throw new Error(id + ': old map retained');
      return { pass, id, samples, ...state };
    }, { id, pass });
    report.visits.push(visit);
    console.log(JSON.stringify(visit));
    if (pass === 0) {
      await page.screenshot({ path: resolve(out, `runtime-${id}.png`) });
      if (id === 'riviera' || id === 'megara') {
        await page.evaluate(() => {
          const replay = window.__replay;
          replay.ctx.G.state = 'paused';
          if (!replay.photo()) throw new Error('Photo mode unavailable for comparison capture');
          replay.ui.hidden = true;
          window.__proofCars = replay.cars.map(car => [car, car.model.root.visible]);
          for (const [car] of window.__proofCars) car.model.root.visible = false;
          document.querySelector('#graphics-quality').style.visibility = 'hidden';
        });
        const stations = id === 'megara' ? [260, 510, 700, 1000, 1290, 1670, 1900, 0] : [2318];
        for (const station of stations) {
          const pose = await page.evaluate(async station => {
            const replay = window.__replay, { route, camera } = replay.ctx;
            const p = route.point(station, 0), ahead = route.point(station + 35, 0);
            camera.position.set(p.x, p.y + 1.65, p.z); camera.lookAt(ahead.x, ahead.y + 1.3, ahead.z);
            camera.rotation.reorder('YXZ');
            Object.assign(replay.photoState, { position: camera.position.clone(), yaw: camera.rotation.y, pitch: camera.rotation.x, roll: 0, fov: 78, dof: 0 });
            replay.ctx.post.setPhoto(replay.photoState); replay.ctx.post.resetHistory?.();
            replay.updateCamera(0);
            const { updateSceneryLod } = await import('./src/scenery.js');
            const list = [];
            replay.ctx.scene.traverse(o => { if (o.userData.far && o.boundingSphere) list.push(o); });
            updateSceneryLod(list, camera);
            replay.ctx.render();
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
            return { station, x: p.x, y: p.y + 1.65, z: p.z, heading: replay.photoState.yaw };
          }, station);
          report.photos ||= []; report.photos.push({ mapId: id, ...pose });
          await page.screenshot({ path: resolve(out, id === 'riviera' ? 'riviera-regression.png' : `ingame-${station}.png`) });
          console.log('PHOTO', id, station);
        }
        await page.evaluate(() => {
          for (const [car, visible] of window.__proofCars) car.model.root.visible = visible;
          delete window.__proofCars; window.__replay.closePhoto();
          document.querySelector('#graphics-quality').style.visibility = '';
          window.__replay.ctx.G.state = 'menu'; window.__flow.menu.show('maps');
        });
        await page.waitForFunction(() => [...document.querySelectorAll('.map-card img')].every(img => img.complete));
        await page.screenshot({ path: resolve(out, 'map-select.png') });
      }
    }
  }
  for (const id of ids) {
    const visits = report.visits.filter(v => v.id === id);
    const before = visits.at(-2), after = visits.at(-1);
    for (const metric of ['geometries', 'textures']) if (after.memory[metric] > before.memory[metric] + 2) throw new Error(`${id}: ${metric} grew on repeated load (${before.memory[metric]} → ${after.memory[metric]})`);
    if (after.weatherWidgets !== before.weatherWidgets) throw new Error(id + ': duplicate lifecycle widgets');
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  report.passed = true;
} finally {
  await writeFile(resolve(out, 'runtime-map-report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise(done => server.close(done));
}
