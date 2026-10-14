#!/usr/bin/env node
// ONE tools/browser-slot.sh job: real assets, accelerated free-roam clock, fronts,
// both maps, population audit and GPU context restore during an active sky fade.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { auditMarkdown } from './world-life-audit.mjs';
const workspace = resolve(import.meta.dirname, '..');
const root = process.env.WORLD_LIFE_ARCHIVE || (await fs.readFile(resolve(workspace, '.scratch/world-life/archive-path'), 'utf8')).trim();
const out = resolve(process.env.WORLD_LIFE_EVIDENCE || resolve(workspace, '.scratch/world-life/evidence')); await fs.mkdir(out, { recursive: true });
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')).href);
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs').href);
const threeRoot = resolve(workspace, 'node_modules/three');
const app = await createGameServer({ root, dataDir: resolve(out, 'server-data') }), serve = app.server.listeners('request')[0];
app.server.removeAllListeners('request');
app.server.on('request', async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  try {
    let bytes = path.startsWith('/world-three/') ? await fs.readFile(resolve(threeRoot, path.slice(13))) : await fs.readFile(file);
    if (path === '/' || path === '/index.html') bytes = Buffer.from(bytes.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/world-three/'));
    if (path === '/src/main.js') bytes = Buffer.from(bytes.toString().replace('stencil: false', 'stencil: false, preserveDrawingBuffer: true'));
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream'); res.end(bytes);
  } catch { serve(req, res); }
});
await new Promise(done => app.server.listen(0, '127.0.0.1', done));
const browser = await pw.chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || resolve(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { archive: root, audit: [], shots: [], transitions: [], restore: null, errors: [] };
async function save() { await fs.writeFile(resolve(out, 'browser-report.json'), JSON.stringify(report, null, 2)); }
try {
  for (const id of ['riviera', 'penteli']) {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => { report.errors.push(String(e)); console.log('PAGEERROR', String(e)); });
    page.on('console', m => { if (m.type() === 'error' && !/net::ERR/.test(m.text())) { report.errors.push(m.text()); console.log('CONSOLE', m.text()); } });
    await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = cb => window.__freezeWorld && cb.name === 'frame' ? 0 : raf(cb); localStorage.setItem('paraliaki.car', 'mini'); });
    console.log('BOOT', id);
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?menu&simhook&quality=low&fixedres&fixeddt&map=${id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('loaded') && window.__sim?.people, null, { timeout: 600000 });
    await page.evaluate(async () => {
      window.__freezeWorld = true; window.__worldENV = await import('/src/env.js');
      window.__worldUtil = await import('/src/util.js'); window.__worldAudit = await import('/tools/world-life-audit.mjs');
      window.__flow.startEvent('free'); window.__sim.G.state = 'paused'; window.__sim.G.lastDt = .25;
      window.__iblIdentity = window.__replay.ctx.scene.environment;
    });
    const rows = await page.evaluate(() => {
      const env = window.__worldENV, life = window.__worldLife;
      return window.__worldAudit.auditPeople(window.__sim.people,
        (hour, weather) => { life.world.configure({ type: 'free', hour, weather }); env.COND.hour = hour; env.COND_STATE.rain = weather === 'rain' ? 1 : 0; },
        () => { window.__sim.people.rng = new window.__worldUtil.RNG(2024); });
    });
    report.audit.push(...rows); assert.ok(rows.every(row => row['mountain/forest'] === 0), 'zero pedestrians on every sampled mountain connector'); await save();
    async function position(s, resident = false) {
      return page.evaluate(({ s, resident }) => {
        const sim = window.__sim, r = sim.route, camera = sim.camera, ctx = window.__replay.ctx;
        sim.player.veh.reset(s, r.laneU(s, 0), 0); sim.people.reset(s); sim.traffic.reset(s); sim.traffic.sync(s);
        const f = r.frame(s, {}), p = r.point(s, 0);
        let anchor = resident ? sim.people.anchors.find(a => a.kind === 'resident') : null;
        if (anchor) { camera.position.set(anchor.x + 5, anchor.y + 2.6, anchor.z + 7); camera.lookAt(anchor.x, anchor.y + .8, anchor.z); }
        else { camera.position.set(p.x - f.tx * 14 + f.rx * 4, p.y + 3.2, p.z - f.tz * 14 + f.rz * 4); const target = r.point(s + 28, 0); camera.lookAt(target.x, target.y + .8, target.z); }
        camera.near = .25; camera.fov = 58; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); sim.G.lastDt = .25; ctx.post.resetHistory();
        sim.people.update(0, s, [], camera.position); for (let i = 0; i < 7; i++) sim.render();
        return { active: sim.people.peds.filter(p => p.active).map(p => ({ kind: p.kind, s: p.s ?? p.anchor.s, x: p.x, y: p.y, z: p.z })), station: s };
      }, { s, resident });
    }
    async function capture(file, detail = {}) {
      const state = await page.evaluate(() => {
        const ctx = window.__replay.ctx; ctx.render(); ctx.renderer.getContext().finish();
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500; const c = canvas.getContext('2d'); c.drawImage(ctx.canvas, 0, 0, 800, 500); const a = c.getImageData(0, 0, 800, 500).data;
        let lum = 0; for (let i = 0; i < a.length; i += 4) lum += .2126 * a[i] + .7152 * a[i + 1] + .0722 * a[i + 2];
        return { png: canvas.toDataURL().split(',')[1], luminance: lum / (a.length / 4), conditions: window.__conditions(), health: window.__lightingInfo(), snapshot: window.__worldLife.world.snapshot(), sameIBL: ctx.scene.environment === window.__iblIdentity };
      });
      await fs.writeFile(resolve(out, file), Buffer.from(state.png, 'base64')); delete state.png;
      report.shots.push({ file, ...state, ...detail }); console.log('SHOT', file, state.luminance, JSON.stringify(state.conditions)); assert.ok(state.sameIBL); await save(); return state;
    }
    if (id === 'riviera') {
      await page.evaluate(() => window.__worldLife.configure({ type: 'free', conditions: { time: 'dawn', weather: 'clear' } }));
      const station = 4700; await position(station);
      for (const [name, seconds] of [['dawn', 0], ['noon', 600], ['dusk', 450], ['night', 525]]) {
        await page.evaluate(seconds => { window.__worldLife.tick(seconds); window.__sim.G.lastDt = .25; for (let i = 0; i < 7; i++) window.__sim.render(); }, seconds);
        await position(station); await capture(`riviera-${name}.png`);
      }
      // A real cloud-to-rain front, advanced through its normal 45-second ramp.
      await page.evaluate(() => { const w = window.__worldLife.world; w.configure({ type: 'free', time: 'day', weather: 'lightRain' }); w.from = { ...w.weather, rain: 0, haze: 3 }; w.weather = { ...w.from }; w.transition = 0; window.__worldENV.setWorldConditions(w.sample(), { forceBake: true }); });
      for (const seconds of [0, 15, 30, 60]) {
        const transition = await page.evaluate(async seconds => { window.__worldLife.tick(seconds); const wet = await import('/src/weather.js'); wet.updateRoadWeather(seconds); window.__sim.G.lastDt = .25; for (let i = 0; i < 7; i++) window.__sim.render(); return { elapsed: seconds, rain: window.__worldENV.COND_STATE.rain, wet: (await import('/src/wet-grip.js')).WEATHER.wet }; }, seconds);
        report.transitions.push(transition); await capture(`riviera-rain-${seconds}.png`, transition);
      }
      assert.ok(report.transitions[1].rain > 0 && report.transitions[1].rain < report.transitions[2].rain); assert.ok(report.transitions.at(-1).wet > 0);
      // Context restore in the middle of a fade: both snapshots must be reseeded.
      const before = await page.evaluate(() => { window.__worldLife.tick(10); window.__worldENV.updateWorldBlend(.2); const gl = window.__replay.ctx.renderer.getContext(), ext = gl.getExtension('WEBGL_lose_context'); window.__worldRestore = ext; ext.loseContext(); return true; });
      assert.ok(before); await page.waitForFunction(() => window.__sim.G.ctxLost, null, { timeout: 30000 });
      await page.evaluate(() => window.__worldRestore.restoreContext()); await page.waitForFunction(() => !window.__sim.G.ctxLost, null, { timeout: 60000 });
      await page.evaluate(() => { window.__sim.render(); window.__worldENV.setWorldConditions(window.__worldLife.world.sample()); for (let i = 0; i < 10; i++) { window.__worldENV.updateWorldBlend(.2); window.__sim.render(); } });
      report.restore = await capture('riviera-restored.png'); assert.ok(report.restore.luminance > 5); assert.ok(report.restore.health.environment); assert.ok(report.restore.health.sun);
    } else {
      await page.evaluate(() => window.__worldLife.configure({ type: 'free', conditions: { time: 'day', weather: 'clear' } }));
      const residents = await position(120, true); assert.ok(residents.active.some(p => p.kind === 'resident'));
      await capture('penteli-village.png', residents);
      for (const s of [2500, 7344]) { const mountain = await position(s); assert.equal(mountain.active.length, 0); await capture(`penteli-mountain-${s}.png`, mountain); }
    }
    await page.close();
  }
  assert.equal(report.errors.length, 0); await fs.writeFile(resolve(out, 'population-table.md'), auditMarkdown(report.audit)); console.log(auditMarkdown(report.audit)); await save();
} finally { await browser.close(); await app.close(); }
