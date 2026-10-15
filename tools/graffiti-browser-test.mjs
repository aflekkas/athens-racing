#!/usr/bin/env node
// Run through tools/browser-slot.sh. One private browser/server, two maps in sequence.
// Fixed cameras compare identical world views with this feature hidden/visible; no FPS claim.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, '.scratch/graffiti');
await fs.mkdir(out, { recursive: true });
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs').href);
let executablePath = process.env.CHROME_BIN;
if (!executablePath && !existsSync(pw.chromium.executablePath())) {
  for (const folder of (await fs.readdir(resolve(homedir(), '.cache/ms-playwright')).catch(() => [])).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const file = resolve(homedir(), '.cache/ms-playwright', folder, 'chrome-linux64/chrome'); if (existsSync(file)) { executablePath = file; break; }
  }
}
const frozen = new Map();
for (const base of ['src', 'data']) for (const file of await fs.readdir(resolve(root, base), { recursive: true })) {
  const path = resolve(root, base, file); if ((await fs.stat(path)).isFile()) frozen.set(path, await fs.readFile(path));
}
for (const file of ['index.html', 'style.css']) frozen.set(resolve(root, file), await fs.readFile(resolve(root, file)));
const threeRoot = process.env.THREE_MODULE_ROOT || '/tmp/roads-v2-three/node_modules/three';
assert.ok(existsSync(resolve(threeRoot, 'build/three.module.js')), 'Set THREE_MODULE_ROOT to three@0.170.0');
const app = await createGameServer({ dataDir: resolve(out, 'server-data') }), serve = app.server.listeners('request')[0];
app.server.removeAllListeners('request');
app.server.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), path = resolve(root, '.' + url.pathname), file = path === root ? resolve(root, 'index.html') : path;
  try {
    let bytes;
    if (url.pathname.startsWith('/graffiti-three/')) bytes = await fs.readFile(resolve(threeRoot, url.pathname.slice(16)));
    else if (frozen.has(file)) bytes = frozen.get(file);
    else return serve(req, res);
    if (file.endsWith('index.html')) bytes = Buffer.from(bytes.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/graffiti-three/'));
    if (file.endsWith('src/main.js')) bytes = Buffer.from(bytes.toString().replace('stencil: false', 'stencil: false, preserveDrawingBuffer: true'));
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' })[extname(file)] || 'application/octet-stream'); res.end(bytes);
  } catch (e) { res.writeHead(404).end(String(e)); }
});
await new Promise(done => app.server.listen(0, '127.0.0.1', done));
const browser = await pw.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
try {
  for (const id of (process.argv[2] || 'riviera,penteli').split(',')) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 }), errors = [];
    page.on('pageerror', e => { errors.push(String(e)); console.log(id, 'PAGEERROR', String(e)); });
    page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log(id, 'CONSOLE', m.text().slice(0, 1600), m.location().url); } });
    page.on('response', response => { if (response.status() >= 400) console.log(id, 'HTTP', response.status(), response.url()); });
    await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = cb => window.__freezeGraffiti && cb.name === 'frame' ? 0 : raf(cb); localStorage.setItem('paraliaki.car', 'mini'); });
    console.log(id, 'BOOT');
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&notraffic&fixeddt&map=${id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('loaded'), null, { timeout: 600000 });
    const setup = await page.evaluate(() => {
      window.__freezeGraffiti = true;
      const sim = window.__sim, life = sim.people.streetLife;
      sim.G.state = 'paused';
      return { stats: life.stats, bins: life.group.userData.bins, artists: life.artists.map(a => ({ s: a.s, x: a.x, y: a.y, z: a.z, yaw: a.yaw })), colliders: sim.ground.parked.filter(p => p.kind === 'municipal-bin').length };
    });
    console.log(id, 'SETUP', JSON.stringify({ stats: setup.stats, colliders: setup.colliders }));
    assert.equal(setup.colliders, setup.stats.bins); assert.ok(setup.stats.artists >= 3 && setup.stats.artists <= 6);
    const station = id === 'riviera' ? 850 : 220;
    const bin = setup.bins.reduce((a, b) => Math.abs(b.s - station) < Math.abs(a.s - station) ? b : a);
    async function position(target, distance = 7) {
      await page.evaluate(({ target: b, distance }) => {
        const r = window.__sim, sim = window.__sim, camera = r.camera;
        sim.player.veh.reset(b.s, sim.route.laneU(b.s, 0), 0);
        sim.people.reset(b.s); sim.people.update(0, b.s, [], camera.position); sim.people.update(0, b.s, [], camera.position);
        camera.position.set(b.x + Math.sin(b.yaw) * distance + Math.cos(b.yaw) * 3.6, b.y + 3, b.z + Math.cos(b.yaw) * distance - Math.sin(b.yaw) * 3.6);
        camera.lookAt(b.x, b.y + .9, b.z); camera.rotation.reorder('YXZ');
        camera.fov = 60; camera.updateProjectionMatrix(); r.post.dof = 0; r.post.resetHistory(); r.render();
      }, { target, distance });
    }
    async function capture(name) {
      const bytes = await page.evaluate(() => { const c = window.__sim; c.render(); c.renderer.getContext().finish(); return c.canvas.toDataURL('image/png').split(',')[1]; });
      await fs.writeFile(resolve(out, name), Buffer.from(bytes, 'base64')); console.log(id, 'CAPTURE', name);
    }
    await position(bin);
    const perf = await page.evaluate(() => {
      const sim = window.__sim, life = sim.people.streetLife, ctx = window.__sim, camera = ctx.camera;
      const draw = artists => { sim.people.crowd.begin(); for (const p of sim.people.peds) if (p.active && (artists || p.kind !== 'artist')) { const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z); if (d < 175) { sim.people.pose(p); sim.people.crowd.draw(p.P, p.look, d); } } sim.people.crowd.end(); };
      const sample = enabled => { life.group.visible = enabled; draw(enabled); ctx.render(); ctx.renderer.getContext().finish(); ctx.render(); return { calls: ctx.renderer.info.render.calls, triangles: ctx.renderer.info.render.triangles }; };
      const before = sample(false), after = sample(true); return { before, after, added: { calls: after.calls - before.calls, triangles: after.triangles - before.triangles }, gpu: window.__renderInfo().gpu, pixelRatio: window.__renderInfo().pixelRatio, viewport: [960, 600] };
    });
    await page.evaluate(() => { const sim = window.__sim, a = sim.people.streetLife.artists; for (const p of a) p.elapsed = 10; sim.people.streetLife.update(0, window.__sim.camera.position); });
    await capture(`${id}-bins.png`);
    const frames = [];
    if (id === 'riviera') {
      const a = setup.artists.reduce((a, b) => Math.abs(b.s - station) < Math.abs(a.s - station) ? b : a);
      const nearest = setup.bins.reduce((b, c) => Math.abs(c.s - a.s) < Math.abs(b.s - a.s) ? c : b);
      await position(nearest, 4.3);
      for (const elapsed of [.8, 4.5, 8.7]) {
        const state = await page.evaluate(elapsed => { const sim = window.__sim, life = sim.people.streetLife, camera = window.__sim.camera;
          for (const a of life.artists) { a.elapsed = elapsed; if (a.ped) { a.ped.t = elapsed; sim.people.pose(a.ped); } }
          sim.people.update(0, sim.player.veh.s, [], camera.position); return life.artists.filter(a => a.ped).map(a => ({ elapsed: a.elapsed, moving: a.ped.moving, raised: a.ped.P.shA[1], progress: Math.min(1, a.elapsed / 9) })); }, elapsed);
        const name = `artist-${String(elapsed).replace('.', '-')}.png`; await capture(name); frames.push({ file: name, state });
      }
      const reaction = await page.evaluate(() => { const sim = window.__sim, a = sim.people.streetLife.artists.find(a => a.ped), p = a.ped;
        const veh = { x: p.x + .3, z: p.z + .3, y: p.y, s: a.s, u: 0, yaw: 0, vLong: 0, halfL: 2, halfW: .9 };
        const before = { x: p.x, z: p.z }; sim.people.update(.2, a.s, [{ veh, kind: 'player' }], window.__sim.camera.position);
        return { distance: Math.hypot(p.x - before.x, p.z - before.z), moving: p.moving }; });
      assert.ok(reaction.distance > .1 && reaction.moving, 'artist steps back from a slow close car');
      console.log('ARTIST REACTION', reaction);
    }
    const row = { id, ...setup, perf, frames, errors }; report.push(row);
    await fs.writeFile(resolve(out, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(id, 'PERF', JSON.stringify(perf)); await page.close(); assert.equal(errors.length, 0, 'no browser errors');
  }
} finally { await browser.close(); await app.close(); }
