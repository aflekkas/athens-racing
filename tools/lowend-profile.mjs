#!/usr/bin/env node
// Low-end profile: per-frame main-thread CPU (per system) plus draw calls / triangles, on a CPU-throttled, small-viewport
// headless Chromium. Private server on its own random port, ?simhook race with traffic + 2 rivals + police.
//   tools/browser-slot.sh node tools/lowend-profile.mjs --root <archive> --map riviera --class potato --throttle 4 --out r.json
// Options: --map riviera|megara · --class potato|low|med|high (settings.perfClass) · --throttle N (CDP CPU rate) ·
//   --realtime (wait on the live loop instead of the deterministic stepped warm-up) · --rivals N (grid rivals, default 2) · --traffic N · --police off · --calls [--depth N] (draw calls per owner) · --viewport 640x360 · --seconds 15 · --warm 6 · --cap 60 · --dyn (leave dynamic resolution on) · --noworld (world detail off) · --query farcull=300 (extra URL parameters)
import { createGameServer } from '../server/index.mjs';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]; };
const root = resolve(arg('root', process.cwd()));
const map = arg('map', 'riviera'), cls = arg('class', 'low'), throttle = +arg('throttle', 4), seconds = +arg('seconds', 15), warm = +arg('warm', 6), cap = +arg('cap', 60);
const [vw, vh] = String(arg('viewport', '640x360')).split('x').map(Number);
const out = arg('out', null);
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs').href);
const dataDir = await fs.mkdtemp(resolve(tmpdir(), 'athens-lowend-srv.'));
const app = await createGameServer({ root, dataDir });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const port = app.server.address().port;
const browser = await pw.chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || resolve(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const report = { root, map, class: cls, throttle, viewport: [vw, vh], seconds, cap, dyn: !!arg('dyn', false), noworld: !!arg('noworld', false), errors: [] };
try {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => { report.errors.push(String(e)); console.log('PAGEERROR', String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error') { report.errors.push(m.text().slice(0, 300)); console.log('CONSOLE', m.text().slice(0, 300)); } });
  // expose draw calls / triangles of the last rendered frame
  await page.route('**/src/main.js', async r => { const response = await r.fetch(); let body = await response.text();
    body = body.replace('window.__renderInfo = () => ({', 'window.__renderInfo = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length, ');
    await r.fulfill({ response, body }); });
  await page.addInitScript(({ cls, cap, dyn, noworld }) => {
    localStorage.setItem('paraliaki.graphics-onboarding', '1'); const raf = requestAnimationFrame; window.requestAnimationFrame = cb => window.__freeze && cb.name === 'frame' ? 0 : raf(cb);
    localStorage.setItem('paraliaki.settings', JSON.stringify({ perfClass: cls, dynamicResolution: dyn, hudMotion: 'full', frameCap: cap, worldDetail: !noworld }));
    let seed = 9001; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  }, { cls, cap, dyn: !!arg('dyn', false), noworld: !!arg('noworld', false) });
  await page.goto(`http://127.0.0.1:${port}/?simhook&map=${map}&guest=1&autodrive&cpuProfile&car=mini${arg('query', false) ? '&' + arg('query') : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__sim?.player && document.body.classList.contains('loaded'), null, { timeout: 600000 });
  console.log('loaded', map, cls);
  await page.evaluate(async (opts) => {
    const s = window.__sim, f = window.__flow;
    if (opts.det) { // deterministic scenario: freeze the real-time loop, reseed, then everything below is stepped by hand at a fixed dt
      window.__freeze = true; await new Promise(r => setTimeout(r, 400));
      let seed = 777; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    }
    await f.startEvent({ ...f.event().def, id: 'lowend', rivals: opts.rivals, traffic: opts.traffic, police: opts.police, rules: { police: opts.police }, conditions: { time: 'morning', weather: 'clear' } });
    s.G.state = 'race'; s.G.autodrive = true; f.menu.hide(); document.body.classList.remove('counting'); document.body.classList.add('racing');
    window.__police?.reset?.(true);
  }, { rivals: +arg('rivals', 2), traffic: +arg('traffic', 2), police: arg('police', 'on') !== 'off', det: !arg('realtime', false) });
  // --warm seconds of the race, simulated: stepped by hand (fixed 1/60 s), so the scene at the measurement is the same on every run
  // (--realtime: the old behaviour, wait on the live loop; counts then depend on machine load and frame timing)
  if (!arg('realtime', false)) await page.evaluate(({ warm }) => { const s = window.__sim; for (let i = 0; i < warm * 60; i++) s.step(1); }, { warm });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await cdp.send('Performance.enable');
  if (arg('realtime', false)) await page.waitForTimeout(warm * 1000);
  // CPU phase: the game loop is frozen and stepped by hand (no GL in the timing), so SwiftShader cannot pollute JS ms.
  const frames = +arg('frames', 360);
  const snap = await page.evaluate(async ({ frames }) => {
    window.__freeze = true; await new Promise(r => setTimeout(r, 300));
    const s = window.__sim, m = window.__cpuMetrics;
    for (let i = 0; i < 60; i++) s.step(1);
    // 6 blocks of frames: the report is the quietest block (a busy machine adds noise upwards only) next to the median block
    const blocks = [], per = Math.round(frames / 6);
    for (let k = 0; k < 6; k++) {
      m.reset(); const ms = [];
      for (let i = 0; i < per; i++) { const t = performance.now(); s.step(1); ms.push(performance.now() - t); }
      ms.sort((a, b) => a - b);
      blocks.push({ stepMs: ms.reduce((a, b) => a + b, 0) / per, p95: ms[Math.floor(per * .95)], max: ms[per - 1], systems: Object.fromEntries(Object.entries(m.systems).map(([key, v]) => [key, v / per])) });
      await new Promise(r => setTimeout(r, 0));
    }
    blocks.sort((a, b) => a.stepMs - b.stepMs);
    const best = blocks[0], median = blocks[3];
    const systems = best.systems, total = best.stepMs, ms = [best.p95], frames2 = 1;
    // render phase: submit cost + draw calls / triangles of the last frame
    // the in-car mirror pass runs every 3rd render only while frames are quick (cockpit.js: it is skipped when < 150 ms passed); a throttled software-GL run is
    // slower than that, which would put a mirror pass in EVERY frame and make counts depend on machine load. Pin the cadence: exactly every 3rd render.
    const ck = s.player?.cockpit; if (ck) { ck.mirrorCalls = 0; ck.rearLast = performance.now(); }
    const rms = [], jsMs = [], callsEach = []; for (let i = 0; i < 24; i++) { if (ck) ck.rearLast = performance.now(); const t = performance.now(); s.render(); const t1 = performance.now(); s.renderer.getContext().finish(); rms.push(performance.now() - t); jsMs.push(t1 - t); callsEach.push(s.renderer.info.render.calls); }
    // renderSubmitMs: the main-thread JS cost of drawing a frame (scene traversal, state changes, draw calls issued), before the GPU is waited on
    jsMs.sort((a, b) => a - b);
    // the in-car mirror pass redraws the scene every 3rd frame: calls = the mean over 24 frames, callsMain = a frame without the mirror, callsMax = a mirror frame
    const callsMean = callsEach.reduce((a, b) => a + b, 0) / callsEach.length, callsMain = Math.min(...callsEach), callsMax = Math.max(...callsEach);
    rms.sort((a, b) => a - b);
    const r = window.__renderInfo();
    return { systems, stepMs: total, stepMedianBlockMs: median.stepMs, stepP95: best.p95, stepMax: best.max, renderMsMedian: rms[12], renderSubmitMs: jsMs[12], calls: Math.round(callsMean), callsMain, callsMax, programs2: r.programs, triangles: r.triangles, pixelRatio: r.pixelRatio, drawDistance: r.drawDistance, perfClass: r.perfClass, programs: r.programs,
      trafficActive: s.traffic.cars.filter(c => c.active).length, peds: s.people.peds ? s.people.peds.filter(p => p.active).length : null, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null };
  }, { frames });
  if (arg('hot', false)) {
    // sampling profile of the stepped loop and of the render submission: where the main-thread JS goes
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    const hot = async (label, fn) => {
      await cdp.send('Profiler.start'); await page.evaluate(fn); const { profile } = await cdp.send('Profiler.stop');
      const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map(), incl = new Map(), parent = new Map();
      for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
      const key = n => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/src\//, '').replace(/^.*\//, '')}:${n.callFrame.lineNumber + 1}`;
      let total = 0;
      profile.samples.forEach((id, i) => { const dt = (profile.timeDeltas[i] || 0) / 1000; total += dt; const n = byId.get(id); self.set(key(n), (self.get(key(n)) || 0) + dt);
        const seen = new Set(); for (let cur = id; cur != null; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + dt); } } });
      const top = (m, n) => [...m].filter(([k]) => !/^\((program|idle|root|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +v.toFixed(1)]);
      report['hot_' + label] = { totalMs: +total.toFixed(0), self: top(self, 25), inclusive: top(incl, 45), gcMs: +(self.get('(garbage collector) :0') || 0).toFixed(1) };
    };
    await hot('step', () => { for (let i = 0; i < 240; i++) window.__sim.step(1); });
    await hot('render', () => { for (let i = 0; i < 30; i++) window.__sim.render(); });
  }
  if (arg('alloc', false)) {
    // allocation hot spots (sampling heap profile) over 300 stepped frames: what feeds the garbage collector
    await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048 });
    await page.evaluate(() => { for (let i = 0; i < 300; i++) window.__sim.step(1); });
    const { profile } = await cdp.send('HeapProfiler.stopSampling'), sizes = new Map();
    const walk = (n, path) => { const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\//, '')}:${n.callFrame.lineNumber + 1}`; sizes.set(k, (sizes.get(k) || 0) + n.selfSize); for (const c of n.children) walk(c); };
    walk(profile.head);
    report.alloc = { perFrameKB: +([...sizes.values()].reduce((a, b) => a + b, 0) / 300 / 1024).toFixed(1), top: [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, +(v / 300 / 1024).toFixed(2)]) };
  }
  if (arg('breakdown', false)) {
    // what the draw calls / triangles are: hide each scene branch in turn and read the drop
    report.breakdown = await page.evaluate(() => {
      const s = window.__sim, info = () => { s.render(); return [s.renderer.info.render.calls, s.renderer.info.render.triangles]; };
      info(); info();
      const [c0, t0] = info(), rows = [];
      const probe = (obj, label, depth) => {
        if (!obj.visible) return;
        obj.visible = false; const [c, t] = info(); obj.visible = true;
        const dc = c0 - c, dt = t0 - t;
        if (dc > 3 || dt > 3000) { rows.push({ label, calls: dc, tris: dt }); if (depth < 2 && obj.children.length > 1 && (dc > 25 || dt > 40000)) for (const child of obj.children.slice(0, 80)) probe(child, label + ' > ' + (child.name || child.type), depth + 1); }
      };
      for (const child of s.scene.children) probe(child, child.name || child.type, 0);
      return { total: { calls: c0, tris: t0 }, rows: rows.sort((a, b) => b.tris - a.tris).slice(0, 40) };
    });
  }
  if (arg('calls', false)) {
    // who the draw calls are: record every renderBufferDirect of 3 consecutive frames (one of them has the mirror pass), grouped by owner path
    // (the first --depth named ancestors, with the material name from depth 4 on); reported for the lightest frame and the heaviest one
    report.calls = await page.evaluate((depth) => {
      const s = window.__sim, r = s.renderer, orig = r.renderBufferDirect, frames = [];
      const mine = s.player?.model?.root;
      const path = (o) => { const p = []; let own = false; for (let c = o; c && c !== s.scene; c = c.parent) { if (c === mine) own = true; p.unshift(c.name || c.type); } return (own ? 'PLAYER ' : '') + p.slice(0, depth).join(' > '); };
      const ck = s.player?.cockpit; if (ck) { ck.mirrorCalls = 0; ck.rearLast = performance.now(); }
      for (let f = 0; f < 3; f++) {
        if (ck) ck.rearLast = performance.now();
        const rows = new Map(), mats = new Set(); let total = 0;
        r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
          const kind = (object.isInstancedMesh ? 'instanced' : object.isSkinnedMesh ? 'skinned' : object.isSprite ? 'sprite' : object.isPoints ? 'points' : object.isLine ? 'line' : 'mesh') + (material.transparent ? '/transparent' : '');
          const key = path(object) + ' | ' + kind + (depth > 3 ? ' | ' + (material.name || material.type) : ''); const e = rows.get(key) || { calls: 0, tris: 0, materials: new Set() };
          e.calls++; total++; { const bs = object.boundingSphere || geometry.boundingSphere; if (bs) { const c = bs.center.clone().applyMatrix4(object.matrixWorld), d = Math.max(0, c.distanceTo(s.camera.position) - bs.radius * object.matrixWorld.getMaxScaleOnAxis()); e.dMin = Math.min(e.dMin ?? Infinity, d); e.dMax = Math.max(e.dMax ?? 0, d); } } e.tris += (geometry.index ? geometry.index.count : geometry.attributes.position?.count || 0) / 3; e.materials.add(material.uuid); mats.add(material.uuid); rows.set(key, e);
          return orig.apply(this, arguments);
        };
        s.render(); r.renderBufferDirect = orig;
        frames.push({ total, materials: mats.size, rows: [...rows].map(([k, v]) => ({ owner: k, calls: v.calls, tris: Math.round(v.tris), materials: v.materials.size, nearestM: v.dMin == null ? null : Math.round(v.dMin), farthestM: v.dMax == null ? null : Math.round(v.dMax) })).sort((a, b) => b.calls - a.calls).slice(0, 90) });
      }
      frames.sort((a, b) => a.total - b.total);
      return { main: frames[0], mirror: frames[2] };
    }, +arg('depth', 3));
  }
  if (arg('inspect', false)) {
    // what the draw-call owners are: the instanced chunks and static meshes of the map group, with their user data, sizes and chunk radius
    report.inspect = await page.evaluate(() => {
      const s = window.__sim, rows = [];
      s.scene.traverse(o => { if (!o.isMesh || o.userData.dynamic === 'x') return; let top = o; while (top.parent && top.parent !== s.scene && !(top.parent.name || '').startsWith('map-world')) top = top.parent;
        if (!(top.parent?.name || '').startsWith('map-world')) return;
        rows.push({ top: top.name || top.type, inst: !!o.isInstancedMesh, count: o.isInstancedMesh ? o.count : 1, verts: o.geometry.attributes.position?.count, radius: o.boundingSphere ? Math.round(o.boundingSphere.radius) : (o.geometry.boundingSphere ? Math.round(o.geometry.boundingSphere.radius) : null), far: o.userData.far, near: o.userData.near, staticCell: !!o.userData.staticCell, visible: o.visible, mat: o.material.name || o.material.type, geo: o.geometry.uuid.slice(0, 6), matId: o.material.uuid.slice(0, 6), parent: o.parent.name || o.parent.type }); });
      return rows;
    });
  }
  report.snapshot = snap;
  const sum = Object.values(snap.systems).reduce((a, b) => a + b, 0);
  report.summary = { class: cls, map, throttle, stepMs: +snap.stepMs.toFixed(2), stepMedianBlockMs: +snap.stepMedianBlockMs.toFixed(2), stepP95: +snap.stepP95.toFixed(2), ...Object.fromEntries(Object.entries(snap.systems).map(([k, v]) => [k, +v.toFixed(2)])), other: +(snap.stepMs - sum).toFixed(2),
    renderMsMedian: +snap.renderMsMedian.toFixed(1), renderSubmitMs: +snap.renderSubmitMs.toFixed(2), calls: snap.calls, callsMain: snap.callsMain, callsMax: snap.callsMax, materials: snap.programs, triangles: snap.triangles, pixelRatio: snap.pixelRatio, drawDistance: snap.drawDistance, trafficActive: snap.trafficActive, peds: snap.peds, heapMB: snap.heapMB && +snap.heapMB.toFixed(0) };
  console.log(JSON.stringify(report.summary));
} catch (e) { console.error('PROFILE FAILED', e); report.failed = String(e); process.exitCode = 1; }
finally { if (out && out !== true) await fs.writeFile(out, JSON.stringify(report, null, 2)); await browser.close(); await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
