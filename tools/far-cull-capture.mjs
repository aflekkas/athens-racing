#!/usr/bin/env node
// Far-cull capture (Potato's far cull, src/far-cull.js): Riviera at fixed poses on a long straight and in a corner, driver's view (cockpit) or chase camera,
// 1280x800 @1x. Writes a screenshot per pose and a JSON report (draw calls / triangles of the frame, per pose), so before / after trees can be compared:
//   ROOT=<archive> OUT=<dir> TAG=before|after CAM=cockpit|chase [CLASS=potato] [QUERY=farcull=0] [RIVALS=0] tools/browser-slot.sh node tools/far-cull-capture.mjs
// The poses are found from the route's curvature (the longest straight, the sharpest corner) so every tree gets the same two places.
import { resolve } from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = resolve(process.env.ROOT || process.cwd()), out = resolve(process.env.OUT || '.'), tag = process.env.TAG || 'run', cam = process.env.CAM === 'chase' ? 'chase' : 'cockpit', cls = process.env.CLASS || 'potato';
const mapId = process.env.MAP || 'riviera', query = process.env.QUERY ? '&' + process.env.QUERY : '', rivals = +(process.env.RIVALS || 0), onlyPose = process.env.POSE || '';
await fs.mkdir(out, { recursive: true });
const { createGameServer } = await import(pathToFileURL(root + '/server/index.mjs').href);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs').href);
const dataDir = await fs.mkdtemp(resolve(tmpdir(), 'athens-farcull-srv.'));
const app = await createGameServer({ root, dataDir }); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sha = async path => { try { return createHash('sha256').update(await fs.readFile(resolve(root, path))).digest('hex'); } catch { return null; } };
const graphicsSource = await fs.readFile(resolve(root, 'src/graphics.js'), 'utf8');
const report = { tag, cam, class: cls, rivals, query: query.slice(1), farCull: +(graphicsSource.match(/potato: \{[^}]*?farCull: (\d+)/)?.[1] ?? 0), sourceHashes: { 'src/far-cull.js': await sha('src/far-cull.js') }, poses: {}, errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { report.errors.push(String(e).slice(0, 300)); console.log('PAGEERROR', String(e).slice(0, 300)); });
  await page.addInitScript(({ cls }) => {
    localStorage.setItem('paraliaki.graphics-onboarding', '1'); const raf = requestAnimationFrame; window.requestAnimationFrame = cb => window.__freeze && cb.name === 'frame' ? 0 : raf(cb);
    localStorage.setItem('paraliaki.settings', JSON.stringify({ perfClass: cls, dynamicResolution: false, hudMotion: 'full', frameCap: 60 }));
    let seed = 9001; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  }, { cls });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?simhook&map=${mapId}&guest=1&autodrive&car=gla&cam=${cam}${query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__sim?.player && document.body.classList.contains('loaded'), null, { timeout: 600000 });
  await page.evaluate(async (rivals) => {
    const s = window.__sim, f = window.__flow;
    await f.startEvent({ ...f.event().def, id: 'farcull', rivals, traffic: 0, police: false, rules: { police: false }, conditions: { time: 'morning', weather: 'clear' } });
    s.G.state = 'race'; s.G.autodrive = true; f.menu.hide(); document.body.classList.remove('counting'); document.body.classList.add('racing');
    window.__freeze = true;
  }, rivals);
  await page.waitForTimeout(500);
  // poses: the longest straight (|curvature| < 1.5e-4 for the longest run) and the sharpest corner (stop 70 m before its apex)
  const poses = await page.evaluate(() => {
    const r = window.__sim.route, L = r.length, step = 10; let best = { len: 0, s: 0 }, run = 0, runS = 0, corner = { k: 0, s: 0 };
    for (let s = 200; s < L - 400; s += step) {
      const k = Math.abs(r.curv(s));
      if (k < 1.5e-4) { if (!run) runS = s; run += step; if (run > best.len) best = { len: run, s: runS }; } else run = 0;
      if (k > corner.k) corner = { k, s };
    }
    return { straight: { s: best.s + Math.min(best.len / 2, 150), runLength: best.len }, corner: { s: corner.s - 70, curvature: corner.k, radius: Math.round(1 / corner.k) } };
  });
  report.route = poses;
  for (const name of onlyPose ? [onlyPose] : ['straight', 'corner']) {
    const info = await page.evaluate(async ({ s0 }) => {
      const s = window.__sim, v = s.player.veh;
      v.reset(s0, s.route.laneU(s0, 0), 0);
      for (let i = 0; i < 6; i++) s.step(1);
      window.__sim.G.autodrive = true;
      for (let i = 0; i < 150; i++) s.step(1);
      s.render(); s.render(); s.render(); s.render();
      const i = s.renderer.info.render, calls = [];
      for (let k = 0; k < 6; k++) { s.render(); calls.push(i.calls); } // 6 renders: two turns of the every-3rd-frame mirror pass
      const fc = s.farCull, t0 = performance.now(); if (fc) for (let k = 0; k < 50; k++) fc.update(s.camera, fc.active || 0); const updateMs = (performance.now() - t0) / 50;
      // what is still drawn beyond the cut: visible world meshes the cull does not manage, nearest point farther than the distance
      const leaks = [], managed = new Set((fc?.entries || []).map(e => e.o)), cut = fc?.active || 0;
      if (cut) s.scene.traverse(o => {
        if (!(o.isMesh || o.isPoints) || managed.has(o) || o === s.player?.model?.root) return;
        for (let c = o; c; c = c.parent) if (!c.visible) return;
        const g = o.geometry; if (!g) return; if (!g.boundingSphere) g.computeBoundingSphere();
        const sp = (o.boundingSphere || g.boundingSphere).clone().applyMatrix4(o.matrixWorld), d = s.camera.position.distanceTo(sp.center) - sp.radius;
        if (d > cut + 30) { const path = []; let still = true; for (let c = o; c && c !== s.scene; c = c.parent) { path.unshift(c.name || c.type); if (c !== o && c.matrixAutoUpdate !== false) still = false; } leaks.push({ path: path.join(' > ').slice(0, 90), meshAutoUpdate: o.matrixAutoUpdate, ancestorsStatic: still, radius: Math.round(sp.radius), nearestM: Math.round(d) }); }
      });
      return { leaks: leaks.slice(0, 25), leakCount: leaks.length, managed: fc?.entries.length ?? null, hidden: fc?.hidden ?? null, updateMs: fc ? +updateMs.toFixed(3) : null, s: Math.round(v.s), x: Math.round(v.x), z: Math.round(v.z), calls: calls, triangles: i.triangles, speedKmh: Math.round(Math.hypot(v.vLong || 0, v.vLat || 0) * 3.6) };
    }, { s0: poses[name].s });
    await page.waitForTimeout(3500); // the GO! banner and the event card fade out in real time
    await page.evaluate(() => { const s = window.__sim; s.render(); });
    await page.waitForTimeout(300);
    const buf = await page.screenshot({ type: 'png', timeout: 240000 });
    await sharp(buf).webp({ quality: 88 }).toFile(`${out}/${tag}-${cam}-${name}-1280x800.webp`);
    report.poses[name] = info; console.log(tag, cam, name, JSON.stringify(info));
  }
} catch (e) { console.error('CAPTURE FAILED', e); report.failed = String(e); process.exitCode = 1; }
finally { await fs.writeFile(`${out}/${tag}-${cam}.json`, JSON.stringify(report, null, 2)); await browser.close(); app.server.close(); await fs.rm(dataDir, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 300); }
