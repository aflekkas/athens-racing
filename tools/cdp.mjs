#!/usr/bin/env node
// Minimal headless-Chrome test driver (no dependencies; uses the DevTools protocol over WebSocket).
//   node tools/cdp.mjs <url> <script.json|inline-json>
// Script: [{"wait":ms} | {"shot":"file.png"} | {"key":"KeyW","down":true} | {"eval":"js"} | {"log":"text"}]
// Prints every console message / exception; exits 1 if any console error happened.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:8765/';
let steps = process.argv[3] || '[{"wait":8000},{"shot":"/tmp/shot.png"}]';
steps = JSON.parse(fs.existsSync(steps) ? fs.readFileSync(steps, 'utf8') : steps);
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--mute-audio', '--no-first-run',
  '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=metal', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (ver.length) break; } catch { } await sleep(200); }
const page = ver.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); let errors = 0;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = m.params.type; const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (t === 'error') errors++;
    console.log(`[console.${t}] ${txt}`);
  } else if (m.method === 'Runtime.exceptionThrown') { errors++; console.log('[exception]', JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); }
  else if (m.method === 'Log.entryAdded') { const e = m.params.entry; if (e.level === 'error') errors++; console.log(`[log.${e.level}] ${e.text} ${e.url || ''}`); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const t0 = Date.now();
await send('Page.navigate', { url });
const KEYS = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyC: 67, KeyR: 82, KeyG: 71, KeyM: 77, Enter: 13, Space: 32, ShiftLeft: 16, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Digit5: 53, Escape: 27 };
for (const s of steps) {
  if (s.wait) await sleep(s.wait);
  if (s.log) console.log(`--- ${s.log} (t=${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (s.key) {
    const key = s.key.startsWith('Key') ? s.key.slice(3).toLowerCase() : s.key.startsWith('Digit') ? s.key.slice(5) : s.key;
    const base = { code: s.key, key, windowsVirtualKeyCode: KEYS[s.key] || 0 };
    if (s.down !== false) await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    if (s.down !== true) await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  if (s.eval) { const r = await send('Runtime.evaluate', { expression: s.eval, returnByValue: true, awaitPromise: true }); console.log('[eval]', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? r.result)); }
  if (s.shot) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(s.shot, Buffer.from(r.result.data, 'base64')); console.log('shot', s.shot); }
}
console.log('console errors:', errors);
ws.close(); proc.kill('SIGKILL');
fs.rmSync(prof, { recursive: true, force: true });
process.exit(errors ? 1 : 0);
