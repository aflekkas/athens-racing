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
const quality = process.env.MAP_TEST_QUALITY || 'low';
const proofOnly = process.env.MAP_TEST_PROOF_ONLY === '1';
const lifecycleOnly = process.env.MAP_TEST_LIFECYCLE_ONLY === '1';
if (proofOnly && lifecycleOnly) throw new Error('Choose either proof-only or lifecycle-only mode');
const streetView = !proofOnly && !lifecycleOnly && process.env.MAP_TEST_STREETVIEW !== '0';
// A proof-only run inherits its explicit rendering quality (low by default).
const proofQuality = proofOnly ? quality : process.env.MAP_TEST_PROOF_QUALITY || quality;
if (!['low', 'med', 'high'].includes(quality)) throw new Error('MAP_TEST_QUALITY must be low, med or high');
let playwright;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/tmp/pw/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { playwright = await import(name.startsWith('/') ? pathToFileURL(name).href : name); break; } catch {}
}
if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
let pngDecoder;
for (const spec of ['pngjs', '/tmp/pw/node_modules/playwright-core/lib/utilsBundle.js']) { try { pngDecoder = (await import(spec)).PNG; if (pngDecoder) break; } catch {} }
function blackFrame(bytes) {
  if (!pngDecoder) return false;
  const { data, width, height } = pngDecoder.sync.read(bytes); let dark = 0, count = 0;
  for (let y = 10; y < height - 40; y += 8) for (let x = 10; x < width - 10; x += 8) { const k = (y * width + x) * 4; count++; if (Math.max(data[k], data[k+1], data[k+2]) < 18) dark++; }
  return dark / count > .99;
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    let file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + sep) && file !== root) throw new Error('Outside repository');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    let bytes = await readFile(file);
    if (file === resolve(root, 'index.html')) bytes = Buffer.from(bytes.toString().replace('<script type="module" src="./src/main.js"></script>', '<script type="module">await import("./tools/map-resource-audit.mjs"); await import("./src/main.js");</script>'));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((yes, no) => { server.once('error', no); server.listen(+(process.env.MAP_TEST_PORT || 8057), '127.0.0.1', yes); });
console.log(`Map browser test server PID ${process.pid}, port ${server.address().port}`);
await mkdir(out, { recursive: true });
let browser;

async function verifyStreetView(browser, report) {
  report.streetview = [];
  const references = resolve(out, 'references'); await mkdir(references, { recursive: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(120000);
    for (const [name, lat, lon, heading] of [['access-road', 37.98398, 23.35924, 40], ['north-public', 37.9913, 23.3609, 40], ['syntagma-control', 37.9755, 23.7348, 0]]) {
      const record = { name, requested: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}&heading=${heading}&pitch=0&fov=90&hl=en` };
      report.streetview.push(record);
      try {
        const response = await page.goto(record.requested, { waitUntil: 'domcontentloaded', timeout: 120000 });
        record.status = response?.status();
        const reject = page.getByRole('button', { name: /^(Reject all|Απόρριψη όλων)$/ }).first();
        if (await reject.isVisible().catch(() => false)) await reject.click();
        await page.waitForTimeout(30000);
        record.finalURL = page.url();
        record.visible = await page.evaluate(() => {
          const text = document.body.innerText;
          return { text: text.slice(0, 12000), noImageryMessage: /No Street View imagery|Street View is not available|Δεν υπάρχουν εικόνες/i.test(text), panoURL: /!1e1|!3a,/.test(location.href), canvases: [...document.querySelectorAll('canvas')].filter(c => { const r = c.getBoundingClientRect(); return r.width > 300 && r.height > 200 && getComputedStyle(c).visibility !== 'hidden'; }).map(c => ({ width: c.width, height: c.height, label: c.getAttribute('aria-label') })) };
        });
        record.screenshot = resolve(references, `streetview-${name}.png`);
        await saveScreenshot(page, { path: record.screenshot });
        console.log('STREETVIEW', name, JSON.stringify({ finalURL: record.finalURL, noImageryMessage: record.visible.noImageryMessage, panoURL: record.visible.panoURL }));
      } catch (error) { record.error = String(error); console.warn('STREETVIEW', name, record.error); }
      await writeFile(resolve(references, 'streetview-verification.json'), JSON.stringify(report.streetview, null, 2) + '\n');
    }
  } catch (error) { report.streetview.push({ error: String(error) }); }
  finally { await page?.close(); }
}

async function saveScreenshot(page, options) {
  try { return await page.screenshot({ ...options, timeout: 120000 }); }
  catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    console.warn('Retrying slow screenshot in the same browser:', options.path);
    return await page.screenshot({ ...options, timeout: 120000 });
  }
}
async function captureProof(page, id, report, stationsOverride = null) {
        await page.evaluate(() => {
          const capture = window.__sim;
          capture.G.state = 'paused';
          window.__proofCars = capture.cars.map(car => [car, car.model.root.visible]);
          for (const [car] of window.__proofCars) car.model.root.visible = false;
          document.querySelector('#graphics-quality').style.visibility = 'hidden';
        });
        const uiError = await page.evaluate(() => window.__proofUiError || null);
        if (uiError) report.validationErrors.push(uiError);
        const stations = stationsOverride || (id === 'megara' ? [260, 510, 700, 1000, 1290, 1670, 1900, 0, 'northwest'] : [2318]);
        for (const station of stations) {
          const pose = await page.evaluate(async station => {
            const capture = window.__sim, { route, camera } = capture;
            const s = station === 'northwest' ? 1000 : station;
            const p = route.point(s, 0), ahead = station === 'northwest' ? { x: p.x - 35, y: p.y, z: p.z - 35 } : route.point(s + 35, 0);
            camera.position.set(p.x, p.y + 1.65, p.z); camera.lookAt(ahead.x, ahead.y + 1.3, ahead.z);
            camera.rotation.reorder('YXZ');
            camera.fov = 78; camera.updateProjectionMatrix(); capture.post.dof = 0; capture.post.resetHistory?.();
            const { updateSceneryLod } = await import('./src/scenery.js');
            const list = [];
            capture.scene.traverse(o => { if (o.userData.far && o.boundingSphere) list.push(o); });
            updateSceneryLod(list, camera);
            capture.render();
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
            return { station, x: p.x, y: p.y + 1.65, z: p.z, heading: camera.rotation.y };
          }, station);
          report.photos ||= []; report.photos.push({ mapId: id, quality: new URL(page.url()).searchParams.get('quality'), ...pose });
          const shotPath = resolve(out, id === 'riviera' ? 'riviera-regression.png' : `ingame-${station}.png`);
          let shot = await saveScreenshot(page, { path: shotPath });
          for (let retry = 0; blackFrame(shot) && retry < 1; retry++) {
            console.warn('Retrying black proof frame', id, station);
            const direct = await page.evaluate(() => { const c = window.__sim; if (c.renderer.getContext().isContextLost()) throw new Error('PROOF_WEBGL_CONTEXT_LOST'); c.render(); return c.canvas.toDataURL('image/png'); });
            shot = Buffer.from(direct.split(',')[1], 'base64'); await writeFile(shotPath, shot);
            report.photos.at(-1).capture = 'direct-canvas-retry';
          }
          if (blackFrame(shot)) report.validationErrors.push(`Black proof frame: ${id} ${station}`);
          console.log('PHOTO', id, station);
          if (await page.evaluate(() => document.querySelector('#c')?.getContext('webgl2')?.isContextLost())) throw new Error('PROOF_WEBGL_CONTEXT_LOST');
        }
        await page.evaluate(() => {
          for (const [car, visible] of window.__proofCars) car.model.root.visible = visible;
          delete window.__proofCars;
          document.querySelector('#graphics-quality').style.visibility = '';
          window.__sim.G.state = 'menu'; window.__flow.menu.show('maps');
        });
        await page.waitForFunction(() => [...document.querySelectorAll('.map-card img')].every(img => img.complete));
        await saveScreenshot(page, { path: resolve(out, 'map-select.png') });
}
async function waitReady(page) {
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.querySelector('#err')?.textContent?.startsWith('Error:'), null, { timeout: 600000 });
  if (!(await page.evaluate(() => document.body.classList.contains('loaded')))) throw new Error(await page.locator('#err').textContent());
}
const report = { quality, proofQuality, proofOnly, lifecycleOnly, visits: [], errors: [], validationErrors: [] };
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
  page.setDefaultTimeout(120000);
  page.on('console', msg => { if (msg.type() === 'error' && /Shader Error|VALIDATE_STATUS|GL_INVALID/.test(msg.text()) && !report.errors.includes(msg.text())) report.errors.push(msg.text()); });
  page.on('pageerror', error => { report.errors.push(String(error)); console.error('PAGE ERROR', String(error)); });
  if (!lifecycleOnly && ids.includes('megara')) {
    console.log('PROOF FIRST', proofQuality, 'megara');
    await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=${proofQuality}&notraffic&map=megara`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitReady(page);
    try { await captureProof(page, 'megara', report); } catch (error) {
      if (!String(error).includes('PROOF_WEBGL_CONTEXT_LOST') || proofQuality === 'low') throw error;
      report.proofFallback = { from: proofQuality, to: 'low', reason: String(error) };
      await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=low&notraffic&map=megara`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await waitReady(page); await captureProof(page, 'megara', report);
    }
    report.mediumProofCaptured = true;
  }
  if (!proofOnly) {
  await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=${quality}&notraffic&map=${ids[0]}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitReady(page);
  await page.evaluate(async () => {
    // Postprocess fullscreen quad/depth targets upload lazily on the first full render.
    window.__sim.render();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    await window.__mapResourceAudit.sample(window.__sim.scene, true);
  });
  // Repeat every map: resource ownership must plateau once shared geometry caches warm up.
  for (let pass = 0; pass < 3; pass++) for (const id of ids) {
    let visit;
    try { visit = await page.evaluate(async ({ id, pass }) => {
      const changing = window.__flow.mapId !== id;
      let damageProof = null;
      if (changing && window.__flow.mapId === 'riviera' && id === 'megara') { try {
        const ctx = window.__sim;
        const car = ctx.traffic.cars.find(c => !c.type.bus && !c.type.scooter && c.m.damageParts?.some(p => p.id.startsWith('bumper_f') && p.detachable));
        if (!car) throw new Error('No traffic damage model for unload regression');
        const p = ctx.route.point(ctx.route.start + 100, 0);
        car.m.root.visible = true; car.m.root.position.set(p.x, p.y, p.z); car.m.root.updateMatrixWorld(true);
        const bumper = car.m.damageParts.find(p => p.id.startsWith('bumper_f') && p.detachable);
        car.m.setLOD?.(0);
        car.m.setDamage('front', 1, { ebs: 25, localPoint: { x: bumper.center.x, y: bumper.center.y, z: bumper.center.z }, localNormal: { x: 0, y: 0, z: 1 } });
        const debris = ctx.scene.children.filter(o => o.userData.damageDebris);
        if (!debris.length) throw new Error('Traffic damage did not generate debris');
        ctx.camera.position.set(p.x + 4, p.y + 2, p.z - 5); ctx.camera.lookAt(p.x, p.y + .5, p.z); ctx.render();
        damageProof = { spawned: debris.length, model: car.type.id, point: { x: bumper.center.x, y: bumper.center.y, z: bumper.center.z } };
      } catch (error) { damageProof = { error: String(error) }; } }
      if (changing) window.__mapResourceAudit.beforeSwitch(window.__sim.scene);
      await window.__flow.switchMap(id);
      if (changing && window.__sim.scene.children.some(o => o.userData.damageDebris)) throw new Error(id + ': damage debris survived map unload');
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
      const ctx = window.__sim, eye = r.point(r.start + 100, 0), ahead = r.point(r.start + 140, 0);
      ctx.camera.position.set(eye.x, eye.y + 8, eye.z); ctx.camera.lookAt(ahead.x, ahead.y + 1, ahead.z);
      const { updateSceneryLod } = await import('./src/scenery.js');
      const lod = []; ctx.scene.traverse(o => { if (o.userData.far && o.boundingSphere) lod.push(o); });
      updateSceneryLod(lod, ctx.camera); ctx.render();
      const allocation = await window.__mapResourceAudit.sample(ctx.scene);
      const state = window.__mapRuntime();
      if (allocation.counts.geometries.allocated !== state.memory.geometries) throw new Error(id + ": GPU geometry audit count does not match renderer");
      if (state.worlds.length !== 1 || state.mapId !== id) throw new Error(id + ': map root not replaced');
      if (state.lastDisposal && (!state.lastDisposal.detached || state.lastDisposal.children || !state.lastDisposal.bundleDisposed)) throw new Error(id + ': old map retained');
      return { pass, id, samples, damageProof, allocation, ...state };
    }, { id, pass }); } catch (error) { report.validationErrors.push(`${id} pass${pass}: ${error}`); console.error('DIAGNOSTIC', id, String(error)); continue; }
    if (visit.damageProof?.error) report.validationErrors.push(`${id} pass${pass}: ${visit.damageProof.error}`);
    report.visits.push(visit);
    console.log(JSON.stringify(visit));
    if (pass === 0 && !lifecycleOnly) {
      await saveScreenshot(page, { path: resolve(out, `runtime-${id}.png`) });
      if (id === 'riviera' || (id === 'megara' && !report.mediumProofCaptured)) {
        await captureProof(page, id, report, id === 'megara' && quality !== proofQuality ? [260] : null);
      }
    }
  }
  for (const id of ids) {
    const visits = report.visits.filter(v => v.id === id);
    if (visits.length !== 3) { report.validationErrors.push(`${id}: expected3 visits, got${visits.length}`); continue; }
    const before = visits.at(-2), after = visits.at(-1);
    for (const visit of visits) {
      if (visit.allocation.orphans.length) report.validationErrors.push(`${id}: orphan GPU allocations ${JSON.stringify(visit.allocation.orphans)}`);
      if (visit.allocation.owned.missed.length) report.validationErrors.push(`${id}: map resources not disposed ${JSON.stringify(visit.allocation.owned.missed)}`);
    }
    // Total GPU counts vary with frustum/parking LOD. Every upload is accounted for as live,
    // an explicit shared template, or the fixed boot-time postprocess/sky allocation set.
    if (after.weatherWidgets !== before.weatherWidgets) report.validationErrors.push(id + ': duplicate lifecycle widgets');
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  report.lifecyclePassed = report.validationErrors.length === 0;
  if (!lifecycleOnly && !report.mediumProofCaptured && proofQuality !== quality && ids.includes('megara')) {
    console.log('PHOTO QUALITY', proofQuality, 'megara');
    await page.goto(`http://127.0.0.1:${server.address().port}/?menu&simhook&quality=${proofQuality}&notraffic&map=megara`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitReady(page);
    await captureProof(page, 'megara', report);
    if (report.errors.length) throw new Error(report.errors.join('\n'));
  }
  if (streetView) { await page.close(); await verifyStreetView(browser, report); }
  if (report.validationErrors.length) throw new Error(report.validationErrors.join('\n'));
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  if (report.validationErrors.length) throw new Error(report.validationErrors.join('\n'));
  report.passed = true;
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  if (browser && streetView && !report.streetview) await verifyStreetView(browser, report);
  await writeFile(resolve(out, proofOnly ? 'proof-recapture-report.json' : lifecycleOnly ? 'lifecycle-only-report.json' : 'runtime-map-report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise(done => server.close(done));
}
