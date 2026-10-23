// Real parent-source free-roam proof. Requires SURFACE_ROOT, SURFACE_PROXY_HELPER,
// ASR_SURFACE_TEMP and the repository browser-slot.sh wrapper. No source injection.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { chromium } from 'playwright';
const root = resolve(process.env.SURFACE_ROOT || '.');
const temp = process.env.ASR_SURFACE_TEMP;
const helper = process.env.SURFACE_PROXY_HELPER;
assert.ok(temp && helper, 'Provide the task temp directory and authenticated read-only world proxy helper');
const out = resolve(process.env.SURFACE_OUT || '.scratch/car-surface');
const reportName = process.env.SURFACE_REPORT || 'report.json';
const sparse = process.env.SURFACE_SPARSE !== '0';
const sharedWs = import.meta.resolve('ws');
registerHooks({ resolve(name, context, next) { return name === 'ws' ? { url: sharedWs, shortCircuit: true } : next(name, context); } });
const { start } = await import(pathToFileURL(helper).href);
const app = await start({ root, tmp: temp, releaseDir: null });
const report = { status: 'running', sourceRoot: root, sourceCommit: process.env.ASR_SURFACE_COMMIT, hookInserted: false, sources: {}, errors: [], runs: [] };
let browser;
const sourceBodies = new Map();
await fs.mkdir(out, { recursive: true });
const save = () => fs.writeFile(resolve(out, reportName), JSON.stringify(report, null, 2));
const deadline = setTimeout(() => { report.deadlineExceeded = true; void browser?.close(); }, 330000);
deadline.unref();
try {
  for (const file of ['main', 'athens-world', 'cars', 'car-surface']) {
    const body = await fs.readFile(resolve(root, `src/${file}.js`));
    sourceBodies.set(file, body);
    report.sources[`src/${file}.js`] = createHash('sha256').update(body).digest('hex');
    if (file === 'athens-world') assert.match(body.toString(), /player\.model\.updateSurface\?\./, 'Production free-roam hook required');
  }
  for (const path of ['/', '/data/athens/manifest.json', '/src/car-surface.js']) {
    const response = await fetch(app.base + path);
    assert.equal(response.status, 200, 'HTTP preflight ' + path);
    console.log('HTTP_READY', path, (await response.arrayBuffer()).byteLength);
  }
  if (process.env.SURFACE_PREFLIGHT === '1') {
    report.status = 'preflight-passed';
  } else {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const quality of (process.env.SURFACE_CLASSES || 'low,high').split(',')) {
      const run = { quality, intermediateSceneDraws: sparse ? 'omitted during drive only; all camera layers restored before captures and GPU measurements; not driving-render performance proof' : 'normal', capture: 'Actual parent free roam; matched world render pose and camera; actual Vehicle/AthensGround driving, staged existing Ground._hit impulse; live world data via authenticated read-only proxy' }; report.runs.push(run);
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(120000);
      page.on('response', response => { if (response.status() >= 400) console.log('HTTP_FAILURE', response.status(), response.url()); });
      page.on('pageerror', error => { report.errors.push(String(error.stack)); console.log('PAGEERROR', error.stack); });
      page.on('console', message => {
        if (message.type() === 'error') {
          console.log('CONSOLE', message.text());
          if (/WebGLProgram|Shader Error|GL_INVALID/.test(message.text())) report.errors.push(message.text());
        }
      });
      await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', async route => route.fulfill({ body: await fs.readFile(resolve(import.meta.dirname, '../node_modules/three', route.request().url().split('three@0.170.0/')[1])), contentType: 'text/javascript' }));
      await page.addInitScript(quality => {
        const raf = requestAnimationFrame;
        window.requestAnimationFrame = cb => ['frame', 'tick'].includes(cb.name) ? 0 : raf(cb);
        localStorage.setItem('paraliaki.settings', JSON.stringify({ perfClass: quality, renderScale: 1, dynamicResolution: false, master: 0, worldDetail: true }));
      }, quality);
      for (const [name, body] of sourceBodies) await page.route('**/src/' + name + '.js', route => route.fulfill({ body, contentType: 'text/javascript' }));
      console.log('LOAD', quality);
      await page.goto(app.base + `/?simhook&map=psychiko&car=gr_yaris&event=free&cam=chase&quality=${quality}&fixedres&notraffic`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__athens?.player?.model?.surface);
      await page.evaluate(() => {
        const a = __athens, v = a.player.veh;
        a.menu.close?.(); a.setPaused(false);
        window.surfacePose = { x: v.x, y: v.y, z: v.z, yaw: v.yaw };
        a.setCameraHook((camera, v, o) => {
          const p = surfacePose;
          camera.position.set(p.x - o.x - 4.8, p.y + 1.6, p.z - o.z - 5.5);
          camera.lookAt(p.x - o.x, p.y + .65, p.z - o.z);
          camera.fov = 40; camera.updateProjectionMatrix();
        });
        a.render(0);
      });
      const metrics = () => page.evaluate(async () => {
        const a = __athens, m = a.player.model, r = a.renderer;
        const { settings } = await import('/src/settings.js');
        const gl = r.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
        const materials = new Set(), geometries = new Set(), textures = new Set();
        m.root.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const material of [].concat(o.material || [])) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); } });
        return { perfClass: settings.perfClass, drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), dirt: m.surface.dirt.toArray(), scuffs: m.surface.scuffs.map(p => p.toArray()), enabled: m.surface.size.w, paintVersion: m.paint.version, shaderKey: m.paint.customProgramCacheKey(), carMaterials: materials.size, carGeometries: geometries.size, carTextures: textures.size, programs: r.info.programs.length, surfacePrograms: r.info.programs.filter(p => p.cacheKey?.includes('car-surface-v1')).length, drawCalls: r.info.render.calls, memory: { ...r.info.memory }, uniformBytes: m.surface.bytes, shaderAddedBytes: m.surface.shaderBytes, damage: { ...a.player.veh.damage }, resources: a.inventory().resources };
      });
      // Match the player's render pose only; physics/contact measurements retain
      // their actual driven coordinates. Capture and render share one evaluation.
      const shot = async name => {
        const data = await page.evaluate(() => {
          const a = __athens, v = a.player.veh, p = surfacePose;
          const pose = { x: v.x, y: v.y, z: v.z, yaw: v.yaw };
          Object.assign(v, p); a.render(0); Object.assign(v, pose);
          return a.renderer.domElement.toDataURL('image/jpeg', .92).split(',')[1];
        });
        const bytes = Buffer.from(data, 'base64');
        assert.ok(bytes.length > 20000, 'Fresh nonempty game capture');
        const path = resolve(out, `${quality}-${name}.jpg`);
        await fs.writeFile(path, bytes); console.log('PHOTO', path);
      };
      await shot('clean'); run.clean = await metrics();
      assert.equal(run.clean.perfClass, quality); assert.ok(run.clean.shaderAddedBytes > 2000); assert.deepEqual(report.errors, []);
      console.log('CLEAN_METRICS', JSON.stringify(run.clean)); await save();
      run.drive = await page.evaluate(sparse => {
        const a = __athens, v = a.player.veh, g = v.ground, s = a.stream;
        let spot;
        // A real narrow verge is sufficient for forward/reverse driving. Check
        // the whole 16m by 5m strip against loaded contact and actual colliders.
        outer: for (let radius = 5; radius <= 180; radius += 5) for (let angle = 0; angle < Math.PI * 2; angle += .3) for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI * .75]) {
          const x = v.x + Math.cos(angle) * radius, z = v.z + Math.sin(angle) * radius;
          let valid = true, low = Infinity, high = -Infinity, height;
          for (let along = -8; along <= 8 && valid; along += 2) for (let across = -2.5; across <= 2.5; across += 1.25) {
            const px = x - Math.sin(yaw) * along + Math.cos(yaw) * across;
            const pz = z - Math.cos(yaw) * along - Math.sin(yaw) * across;
            const c = s.contact(px, pz, { referenceY: v.y });
            if (!c || c.flags & 1 || c.y < 0 || !s.readyAt(px, pz) || a.obstacles.contact(px, c.y, pz, 1.2)) { valid = false; break; }
            low = Math.min(low, c.y); high = Math.max(high, c.y);
            height ??= c.y;
            if (!a.barriers.safe({ x: px, y: c.y, z: pz, yaw }, { halfWidth: v.halfW, halfLength: v.halfL })) { valid = false; break; }
          }
          if (valid && high - low < 1.5) { spot = { x, y: s.contact(x, z, { referenceY: v.y }).y, z, yaw }; break outer; }
        }
        if (!spot) throw Error('No loaded clear dirt strip for actual contact drive');
        a.place(spot);
        let metres = 0, contacts = 0, steps = 0, direction = 1, reversals = 0, previous = { x: v.x, z: v.z };
        // Sparse capture: keep production render/state updates, but omit the
        // intermediate world draws. Restore all camera layers for every proof
        // image and GPU comparison; no renderer or game-source replacement.
        const layers = a.camera.layers.mask; if (sparse) a.camera.layers.mask = 0;
        try { for (let frame = 0; frame < 1000; frame++) {
          for (let j = 0; j < 24; j++) {
            const along = -(v.x - spot.x) * Math.sin(spot.yaw) - (v.z - spot.z) * Math.cos(spot.yaw);
            if (direction > 0 && along > 3.8 || direction < 0 && along < -3.8) { direction *= -1; reversals++; }
            const targetX = spot.x - Math.sin(spot.yaw) * direction * 8;
            const targetZ = spot.z - Math.cos(spot.yaw) * direction * 8;
            const dx = targetX - v.x, dz = targetZ - v.z;
            const lateral = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw);
            const k = direction * 2 * lateral / Math.max(1, dx * dx + dz * dz);
            const changing = direction > 0 ? v.reverse : !v.reverse;
            const pedal = changing ? .7 : Math.max(0, Math.min(.5, .2 + (3 - Math.abs(v.vLong)) * .25));
            a.step(1 / 240, { throttle: direction > 0 ? pedal : 0, brake: direction < 0 ? pedal : 0, steer: v.steerInputFor(k, Math.max(3, Math.abs(v.vLong))), handbrake: false });
            metres += Math.hypot(v.x - previous.x, v.z - previous.z); previous = { x: v.x, z: v.z }; steps++;
            contacts += v.wheelSurf.filter((surface, i) => surface === 'dirt' && v.corners[i].Fz > 1).length;
          }
          a.render(.1);
          if (a.player.model.surface.dirt.toArray().some(n => n > .55)) break;
        }
        } finally { a.camera.layers.mask = layers; }
        return { intermediateSceneRendering: sparse ? 'camera layers omitted during drive; restored for all captures/comparisons' : 'normal', spot, metres, contacts, steps, reversals, dirt: a.player.model.surface.dirt.toArray(), surfaces: v.wheelSurf, damage: { ...v.damage }, missingContacts: a.stats.missingContacts };
      }, sparse);
      console.log('DRIVE', JSON.stringify(run.drive)); await save();
      assert.ok(run.drive.contacts > 20); assert.ok(run.drive.dirt.some(n => n > .15)); assert.equal(run.drive.missingContacts, 0);
      await shot('dirty'); run.dirty = await metrics(); await save();
      run.impact = await page.evaluate(async () => {
        const { Ground } = await import('/src/ground.js');
        const a = __athens, v = a.player.veh;
        v.vLong = 0; v.vLat = -9; v.w = 0;
        const before = { vLong: v.vLong, vLat: v.vLat, w: v.w };
        Ground.prototype._hit.call(v.ground, v, Math.cos(v.yaw), -Math.sin(v.yaw), .02, .7, { kind: 'wall', restitution: .05, height: 2 });
        a.render(0); // snapshot + real production surface hook
        return { before, after: { vLong: v.vLong, vLat: v.vLat, w: v.w }, hit: v.lastDamage };
      });
      assert.equal(run.impact.hit.zone, 'left');
      await shot('damaged'); run.damaged = await metrics(); assert.ok(run.damaged.scuffs[2][3] > 0); await save();
      run.comparison = await page.evaluate(() => {
        const a = __athens, r = a.renderer, m = a.player.model, v = a.player.veh, gl = r.getContext();
        const capture = () => { r.render(a.scene, a.camera); const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; };
        m.updateSurface(0, v, false, false); const off = capture();
        m.updateSurface(0, v, true, true); const online = capture();
        m.updateSurface(0, v, true, false); const enabled = capture();
        let hiddenChanges = 0, wearChanges = 0;
        for (let i = 0; i < off.length; i += 4) { if (off[i] !== online[i] || off[i + 1] !== online[i + 1] || off[i + 2] !== online[i + 2]) hiddenChanges++; if (Math.max(Math.abs(off[i] - enabled[i]), Math.abs(off[i + 1] - enabled[i + 1]), Math.abs(off[i + 2] - enabled[i + 2])) > 3) wearChanges++; }
        const timing = [];
        for (const enabled of [0, 1]) { m.surface.size.w = enabled; gl.finish(); const start = performance.now(); for (let i = 0; i < 2; i++) r.render(a.scene, a.camera); gl.finish(); timing.push({ enabled, samples: 2, ms: (performance.now() - start) / 2, drawCalls: r.info.render.calls, programs: r.info.programs.length }); }
        return { hiddenChanges, wearChanges, timing };
      });
      console.log('LAYER_COMPARISON', JSON.stringify(run.comparison)); await save();
      assert.equal(run.comparison.hiddenChanges, 0); assert.ok(run.comparison.wearChanges > 100);
      await page.evaluate(async () => { await __athens.tow(); __athens.render(0); });
      await shot('repaired'); run.repaired = await metrics(); await save();
      assert.deepEqual(run.repaired.dirt, [0, 0, 0, 0]); assert.ok(run.repaired.scuffs.every(p => p[3] === 0)); assert.ok(Object.values(run.repaired.damage).every(n => n === 0));
      for (const key of ['carMaterials', 'carTextures', 'carGeometries', 'paintVersion', 'shaderKey', 'surfacePrograms']) assert.equal(run.clean[key], run.dirty[key], key);
      await page.close();
    }
    assert.deepEqual(report.errors, []); report.status = 'passed';
  }
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { clearTimeout(deadline); await browser?.close(); await app.close(); await save(); }
