#!/usr/bin/env node
// One browser-slot job: real sprint physics, then a controlled witnessed offence.
// Run from a clean archive: tools/browser-slot.sh node tools/police-browser.mjs
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.POLICE_EVIDENCE_DIR || resolve(root, '.scratch/police-browser'));
await fs.mkdir(out, { recursive: true });
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs').href);
let executablePath = process.env.CHROME_BIN;
if (!executablePath && !existsSync(pw.chromium.executablePath())) {
  for (const name of (await fs.readdir(resolve(homedir(), '.cache/ms-playwright')).catch(() => [])).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const file = resolve(homedir(), '.cache/ms-playwright', name, 'chrome-linux64/chrome'); if (existsSync(file)) { executablePath = file; break; }
  }
}
const threeRoot = process.env.THREE_MODULE_ROOT || resolve(root, 'node_modules/three');
const app = await createGameServer({ root, dataDir: resolve(out, 'server-data') }), serve = app.server.listeners('request')[0];
app.server.removeAllListeners('request');
app.server.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/police-three/')) {
      const file = resolve(threeRoot, url.pathname.slice('/police-three/'.length));
      res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(file)); return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await fs.readFile(resolve(root, 'index.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html'); res.end(html.replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/police-three/')); return;
    }
    if (url.pathname === '/src/main.js') {
      const js = await fs.readFile(resolve(root, 'src/main.js'), 'utf8');
      res.setHeader('Content-Type', 'text/javascript'); res.end(js.replace('stencil: false', 'stencil: false, preserveDrawingBuffer: true')); return;
    }
    return serve(req, res);
  } catch (e) { res.writeHead(404).end(String(e)); }
});
await new Promise(done => app.server.listen(0, '127.0.0.1', done));
const browser = await pw.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const report = { errors: [], normal: null, witnessed: [], browser: executablePath || pw.chromium.executablePath() };
page.on('pageerror', error => { report.errors.push(String(error)); console.log('PAGEERROR', String(error)); });
page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0, 400)); });
async function capture(name) {
  await page.evaluate(() => { window.__sim.render(); window.__replay.ctx.renderer.getContext().finish(); window.__notifications?.update(); });
  await page.screenshot({ path: resolve(out, name + '.png'), animations: 'disabled', timeout: 30000 });
  console.log('SCREENSHOT', name);
}
try {
  await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = cb => window.__freezePoliceProof && cb.name === 'frame' ? 0 : raf(cb); });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&fixeddt&quality=low&notraffic&map=riviera&car=mini&cam=chase`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('loaded') && window.__sim?.player, null, { timeout: 600000 });
  console.log('LOADED');
  await page.evaluate(() => {
    window.__freezePoliceProof = true;
    window.__flow.startEvent({ id: 'police-proof', name: 'POLICE ON · COAST SPRINT', type: 'sprint', from: 2000, to: 10500, rivals: 0, traffic: 0, rules: { police: true, laws: true }, conditions: { time: 'day', weather: 'clear' }, targets: { gold: 200 } }, { car: 'mini' });
  });
  await page.waitForFunction(() => window.__game?.state === 'countdown' || window.__sim.G.state === 'countdown', null, { timeout: 120000 });
  await page.evaluate(() => {
    const sim = window.__sim;
    sim.G.countWall = performance.now() - 6000; sim.G.autodrive = true; sim.G.cameraStarting = false; sim.step(1);
    window.__policeTrace = [];
    window.__cruise = (target, exact = false) => {
      const controller = sim.player.ai?.controller;
      if (!controller || controller.__policeProof) return;
      const update = controller.update.bind(controller);
      controller.update = (dt, opts) => {
        const result = update(dt, opts), kmh = sim.player.veh.kmh;
        if (exact || kmh > window.__proofTarget) {
          const error = window.__proofTarget - kmh;
          result.throttle = Math.max(0, Math.min(1, error * .12 + .18));
          result.brake = Math.max(0, Math.min(.5, -error * .05)); result.nitro = false;
        }
        return result;
      };
      controller.__policeProof = true; window.__proofTarget = target;
    };
  });
  report.normal = await page.evaluate(() => {
    const sim = window.__sim, police = window.__police, v = sim.player.veh, start = v.s;
    let maxStars = 0, maxHeat = 0, maxKmh = 0;
    for (let i = 0; i < 1200; i++) { window.__cruise(120); sim.step(1); maxStars = Math.max(maxStars, police.hm.level); maxHeat = Math.max(maxHeat, police.hm.heat); maxKmh = Math.max(maxKmh, v.kmh); }
    return { enabled: police.enabled, raceState: sim.G.state, seconds: 20, distance: v.s - start, start, end: v.s, maxKmh, maxStars, maxHeat, patrols: police.patrols.map(p => ({ id: p.id, s: p.s, fixed: p.fixed })) };
  });
  console.log('NORMAL', JSON.stringify(report.normal));
  assert.equal(report.normal.enabled, true); assert.equal(report.normal.maxStars, 0); assert.ok(report.normal.distance > 100);
  await capture('01-normal-sprint-no-wanted');
  await page.evaluate(() => {
    const sim = window.__sim, police = window.__police, v = sim.player.veh;
    const site = police.patrols.find(p => p.id === 'coast-speed-trap'); const s = site.s - 45;
    police.reset(true); const limit = police.limitAt(s); v.reset(s, sim.route.laneU(s, 0), (limit + 40) / 3.6);
    sim.player.ai = null; sim.G.pFront = v.s + v.halfL;
    // One nearby real unit, on the road behind the player. The offence itself
    // comes from the live speed/LOS checks; no wanted/heat is injected.
    const c = police.spawnCop(s - 25, 1, { v: (limit + 40) / 3.6 });
    if (!c) throw Error('No available police unit'); c.cop.keep = true;
    window.__proofTarget = limit + 40; window.__witnessCop = c;
    window.__offenceStart = police.t; window.__proofLimit = limit;
  });
  for (const [name, ticks] of [['02-witnessed-warning', 90], ['03-gradual-one-star', 180]]) {
    const row = await page.evaluate(ticks => {
      const sim = window.__sim, police = window.__police, v = sim.player.veh;
      let visibleTicks = 0, minKmh = Infinity, maxKmh = 0;
      for (let i = 0; i < ticks; i++) {
        window.__cruise(window.__proofTarget, true); sim.step(1);
        if (police.witnesses()) visibleTicks++;
        minKmh = Math.min(minKmh, v.kmh); maxKmh = Math.max(maxKmh, v.kmh);
        window.__policeTrace.push({ t: police.t - window.__offenceStart, heat: police.hm.heat, level: police.hm.level, state: police.hm.state, kmh: v.kmh, witness: police.witnesses() });
      }
      return { seconds: police.t - window.__offenceStart, limit: window.__proofLimit, visibleTicks, minKmh, maxKmh, heat: police.hm.heat, stars: police.hm.level, state: police.hm.state, copS: window.__witnessCop.s, playerS: v.s };
    }, ticks);
    report.witnessed.push(row); console.log('WITNESSED', JSON.stringify(row)); await capture(name);
  }
  const warning = report.witnessed[0], star = report.witnessed[1];
  assert.equal(warning.stars, 0); assert.equal(warning.state, 'warning'); assert.ok(warning.heat > .25 && warning.heat < 1);
  assert.equal(star.stars, 1); assert.equal(star.state, 'pursuit');
  report.trace = await page.evaluate(() => window.__policeTrace); assert.deepEqual(report.errors, []);
} catch (e) { report.failure = String(e); await capture('failure').catch(() => {}); throw e; }
finally { await fs.writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); await app.close(); }
