// Bounded actual combined-source pause/readiness/reset regression proof. Requires SURFACE_ROOT, SURFACE_PROXY_HELPER,
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
const reportName = process.env.SURFACE_REPORT || 'clock-report.json';
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
const deadline = setTimeout(() => { report.deadlineExceeded = true; void browser?.close(); }, 120000);
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
    report.browserVersion = browser.version();
    for (const quality of (process.env.SURFACE_CLASSES || 'low').split(',')) {
      const run = { quality, intermediateSceneDraws: sparse ? 'omitted during drive only; all camera layers restored before captures and GPU measurements; not driving-render performance proof' : 'normal', capture: 'Actual parent free roam; matched world render pose and camera; actual Vehicle/AthensGround driving, actual pause; explicitly injected temporary ground.ready=false readiness fault; restored in finally; live world data via authenticated read-only proxy' }; report.runs.push(run);
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(60000);
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
        return { perfClass: settings.perfClass, drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), dirt: m.surface.dirt.toArray(), scuffs: m.surface.scuffs.map(p => p.toArray()), enabled: m.surface.size.w, paintVersion: m.paint.version, shaderKey: m.paint.customProgramCacheKey(), carMaterials: materials.size, carGeometries: geometries.size, carTextures: textures.size, programs: r.info.programs.length, surfacePrograms: r.info.programs.filter(p => p.cacheKey?.includes('car-surface-v1')).length, surfaceProgramKeys: r.info.programs.filter(p => p.cacheKey?.includes('car-surface-v1')).map(p => p.cacheKey), drawCalls: r.info.render.calls, memory: { ...r.info.memory }, uniformBytes: m.surface.bytes, shaderAddedBytes: m.surface.shaderBytes, damage: { ...a.player.veh.damage }, resources: a.inventory().resources };
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
        const path = resolve(out, `clock-${quality}-${name}.jpg`);
        await fs.writeFile(path, bytes); console.log('PHOTO', path);
      };
      await shot('clean'); run.clean = await metrics();
      await page.evaluate(() => {
        const a = __athens, v = a.player.veh, s = a.stream;
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
        a.render(0); // acknowledge reset identity before the first real step
        window.surfacePose = { ...spot };
        let metres = 0, contacts = 0, steps = 0, direction = 1, reversals = 0, previous = { x: v.x, z: v.z };
        window.surfaceDrive = frames => {
          const layers = a.camera.layers.mask;
          a.camera.layers.mask = 0;
          try { for (let frame = 0; frame < frames; frame++) {
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
          } } finally { a.camera.layers.mask = layers; }
          return { spot, metres, contacts, steps, reversals };
        };
        window.surfaceState = () => ({ dirt: a.player.model.surface.dirt.toArray(), scuffs: a.player.model.surface.scuffs.map(p => p.toArray()), simulationSeconds: a.stats.simulationSeconds || 0, metres: a.stats.metres, speed: v.vLong, loadedDirtWheels: v.wheelSurf.filter((surf,i) => surf === 'dirt' && v.corners[i].Fz > 1).length, pose: { x: v.x, y: v.y, z: v.z, yaw: v.yaw }, missingContacts: a.stats.missingContacts });
      });
      run.drive = await page.evaluate(() => surfaceDrive(60));
      run.beforePause = await page.evaluate(() => surfaceState());
      assert.ok(run.beforePause.dirt.some(n => n > 0), 'Actual loaded dirt driving accumulates wear');
      assert.ok(Math.abs(run.beforePause.speed) > .2, 'Nonzero speed left stale during hold');
      await shot('driven'); await save();
      const frozenPhase = async mode => page.evaluate(mode => {
        const a = __athens, v = a.player.veh, g = v.ground;
        const before = surfaceState(), layers = a.camera.layers.mask;
        const ownReady = Object.getOwnPropertyDescriptor(g, 'ready');
        if (mode === 'paused') a.setPaused(true);
        else g.ready = () => false; // Explicit TEST INJECTION: readiness only, no physical flags/contact data/source edits.
        a.camera.layers.mask = 0;
        try { for (let frame = 0; frame < 80; frame++) {
          for (let slice = 0; slice < 24; slice++) a.step(1 / 240, { throttle: .5, brake: 0, steer: 0, handbrake: false });
          a.render(.1);
        } } finally {
          a.camera.layers.mask = layers;
          a.setPaused(false);
          if (mode !== 'paused') { if (ownReady) Object.defineProperty(g, 'ready', ownReady); else delete g.ready; }
        }
        return { mode, injection: mode === 'paused' ? 'none: public setPaused API' : 'temporary own ground.ready returning false, restored in finally; no source/physics/contact flag edits', simulatedAttemptSeconds: 8, renderCalls: 80, before, after: surfaceState() };
      }, mode);
      for (const mode of ['paused', 'readiness-held']) {
        run[mode] = await frozenPhase(mode);
        for (const field of ['dirt', 'scuffs', 'simulationSeconds', 'metres', 'pose']) assert.deepEqual(run[mode].after[field], run[mode].before[field], mode + ' unchanged ' + field);
        await shot(mode); await save();
      }
      run.resumeDrive = await page.evaluate(() => surfaceDrive(60));
      run.resumed = await page.evaluate(() => surfaceState());
      assert.ok(run.resumed.simulationSeconds > run.beforePause.simulationSeconds);
      assert.ok(run.resumed.dirt.some((n,i) => n > run.beforePause.dirt[i]), 'Resumed real physics adds dirt');
      assert.equal(run.resumed.missingContacts, 0);
      await shot('resumed'); await save();
      // Public reset/place clears immediately; subsequent real physics may add only new-step wear.
      run.reset = await page.evaluate(() => {
        const a = __athens, pose = { ...surfacePose };
        a.place(pose);
        a.render(0);
        return surfaceState();
      });
      assert.deepEqual(run.reset.dirt, [0, 0, 0, 0]);
      await page.evaluate(async () => { await __athens.tow(); __athens.render(0); });
      run.towed = await page.evaluate(() => surfaceState());
      assert.deepEqual(run.towed.dirt, [0, 0, 0, 0]);
      assert.ok(run.towed.scuffs.every(p => p[3] === 0));
      await shot('repaired');
      run.final = await metrics();
      assert.deepEqual(report.errors, []);
      console.log('CLOCK_CHECKS', JSON.stringify(run)); await save();
      await page.close();
    }
    assert.deepEqual(report.errors, []); report.status = 'passed';
  }
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); throw error; }
finally { clearTimeout(deadline); await browser?.close(); await app.close(); await save(); }
