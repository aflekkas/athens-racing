#!/usr/bin/env node
// Audio under load, rendered offline in a real browser: the live Audio graph (player engine, 4 tyre voices, traffic and
// rival engines, ambience) is driven by synthetic telemetry at a chosen update rate and rendered by an
// OfflineAudioContext. Reports the render cost (x real time, lower is lighter for the audio thread), node / param-event
// counts, and click / dropout counts in the output, so audio changes can be compared before and after.
//   tools/browser-slot.sh node tools/audio-load-browser.mjs --root <archive> --fps 60 --seconds 12 [--nokrate] [--out r.json]
import { createGameServer } from '../server/index.mjs';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]; };
const root = resolve(arg('root', process.cwd())), fps = +arg('fps', 60), seconds = +arg('seconds', 12), out = arg('out', null), low = !!arg('low', false);
const variant = { notraffic: !!arg('notraffic', false), noupdate: !!arg('noupdate', false) };
const kRate = !arg('nokrate', false), repeats = +arg('repeats', 2), compare = !!arg('compare', false); // --compare: run 0 is a-rate, run 1+ k-rate, each compared with run 0
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs').href);
const dataDir = await fs.mkdtemp(resolve(tmpdir(), 'athens-audio-srv.'));
const app = await createGameServer({ root, dataDir });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const browser = await pw.chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || resolve(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const report = { root, fps, seconds, kRate, low, runs: [] };
try {
  const page = await browser.newPage();
  // CPU seconds of the page's renderer process (reliable on a busy machine, unlike wall time)
  const bcdp = await browser.newBrowserCDPSession(), marks = {};
  const rendererCpu = async () => (await bcdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'renderer').reduce((m, p) => Math.max(m, p.cpuTime), 0);
  await page.exposeFunction('markCpu', async name => { marks[name] = await rendererCpu(); });
  page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/robots.txt`);
  for (let run = 0; run < repeats; run++) {
    const runKRate = compare ? run % 2 === 1 : kRate;
    const result = await page.evaluate(async ({ fps, seconds, kRate, low, compare, variant }) => {
      const { Audio } = await import('/src/audio.js');
      const CARS = Function('return ' + (await (await fetch('/src/cars.js')).text()).split('export const CARS = ')[1].split('\n];')[0] + '\n];')(); // cars.js imports three: read the plain data
      { let seed = 12345; Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
      const sr = 48000, off = new OfflineAudioContext(2, sr * seconds, sr);
      const a = new Audio(); a.lowCost = low;
      a.start({ context: off, recordings: true, kRate });
      const car = CARS.find(c => c.id === 'mini'), z4 = CARS.find(c => c.id === 'z4'), taxi = CARS.find(c => c.id === 'taxi');
      a.setEngine(car);
      await Promise.all([a.worldReady, a.engineReady]);
      const wheels = Array.from({ length: 4 }, () => ({ sx: 0, sy: 0, Fz: 3500, vw: 20, vgx: 20 }));
      const telemetry = (t) => {
        const k = t / seconds, rpm = 1400 + 5200 * (0.5 - 0.5 * Math.cos(k * Math.PI * 4)), slip = (t % 4) > 1.2 && (t % 4) < 2.6 ? 1.35 : 0.2;
        for (const w of wheels) { w.sy = slip; w.sx = 0.1; w.vgx = 25; w.vw = 25; }
        const traffic = Array.from({ length: 8 }, (_, i) => ({ id: i, kind: ['car', 'taxi', 'bus', 'car'][i % 4], d: 12 + i * 14 + 6 * Math.sin(t + i), pan: Math.sin(t * 0.5 + i), vr: 8 * Math.sin(t * 0.7 + i), v: 12 + i, acc: 0, rpm: 1500 + 900 * Math.sin(t + i) + 1000 }));
        return { dt: 1 / fps, speed: 18 + 14 * Math.sin(k * Math.PI * 4), rpm, redline: car.redline, load: 0.7, throttle: 0.7, wheels, surfaces: ['asphalt', 'asphalt', 'asphalt', 'asphalt'], nominalLoad: 3500,
          skid: slip, open: false, cockpit: true, sea: 0.8, seaPan: 0.6, city: 0.3, cicadas: 1, gear: 3, gearRatio: 3, wb: 2.5, bump: 0, overrun: false, limiter: false, boost: 0.5,
          rivals: variant.notraffic ? [] : [{ id: 'ai-0', spec: z4, rpm: 3000 + 800 * Math.sin(t), limiter: false, load: 0.6, d: 20 + 10 * Math.sin(t), pan: 0.4, vr: 2 }, { id: 'ai-1', spec: taxi, rpm: 2500, limiter: false, load: 0.5, d: 40, pan: -0.5, vr: -2 }],
          traffic: variant.notraffic ? [] : traffic, mapId: 'riviera' };
      };
      // warm-up: build the traffic voices and let their recordings decode before the timed render
      let warm = telemetry(0); a.update(warm); await new Promise(r => setTimeout(r, 2500)); a.update(warm); await new Promise(r => setTimeout(r, 500));
      const quantum = 128 / sr; let jsMs = 0;
      const frames = Math.floor(seconds * fps) - 2;
      for (let f = 1; f <= frames; f++) {
        const t = Math.ceil(f / fps / quantum) * quantum;
        off.suspend(t).then(() => { const t0 = performance.now(); if (!variant.noupdate) a.update({ ...telemetry(off.currentTime), audioTime: undefined }); jsMs += performance.now() - t0; off.resume(); });
      }
      const created = a.ctx === off ? null : null;
      await window.markCpu('start'); const t0 = performance.now(); const buffer = await off.startRendering(); await window.markCpu('end'); const total = performance.now() - t0;
      const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
      // clicks: a sample step far above the local step level; dropouts: 25 ms windows of silence
      let clicks = 0, maxStep = 0; const win = Math.round(sr * 0.005);
      let env = 1e-3;
      for (let i = 1; i < L.length; i++) { const d = Math.abs(L[i] - L[i - 1]); if (d > 0.08 && d > 14 * env) clicks++; env += (d - env) * (1 / win); if (d > maxStep) maxStep = d; }
      let silent = 0; const w25 = Math.round(sr * 0.025), start = Math.round(sr * 0.5);
      for (let i = start; i + w25 < L.length; i += w25) { let s = 0; for (let j = 0; j < w25; j++) s += L[i + j] * L[i + j] + R[i + j] * R[i + j]; if (Math.sqrt(s / (2 * w25)) < 1e-4) silent++; }
      let rms = 0; for (let i = 0; i < L.length; i++) rms += L[i] * L[i]; rms = Math.sqrt(rms / L.length);
      let rel = null; if (compare) { const ref = window.__ref; if (!ref) window.__ref = L.slice(); else { let e = 0, n = 0; for (let i = 0; i < L.length; i++) { const d = L[i] - ref[i]; e += d * d; n += ref[i] * ref[i]; } rel = Math.sqrt(e / n); } }
      return { relErrVsFirstRun: rel, renderMs: total, jsMs, audioSeconds: seconds, renderOverJs: (total - jsMs) / (seconds * 1000), updates: frames, clicks, maxStep, silentWindows: silent, rms, health: a.health?.() ?? null };
    }, { fps, seconds, kRate: runKRate, low, compare, variant });
    result.cpuSecondsPerAudioSecond = (marks.end - marks.start) / seconds; result.kRateUsed = runKRate;
    report.runs.push(result); console.log(JSON.stringify({ kRate: runKRate, cpuPerAudioSecond: +result.cpuSecondsPerAudioSecond.toFixed(3), wallPerAudioSecond: +(result.renderMs / 1000 / seconds).toFixed(2), clicks: result.clicks, silentWindows: result.silentWindows, relErr: result.relErrVsFirstRun, updates: result.updates }));
  }
} catch (e) { console.error('AUDIO LOAD FAILED', e); process.exitCode = 1; }
finally { if (out && out !== true) await fs.writeFile(out, JSON.stringify(report, null, 2)); await browser.close(); await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
