// What a player sees from the first frame of a launch until the first real screen (owner 2026-10-20: one central loading
// screen that checks auth, "no flash of the wrong screen"). Every animation frame records what is visible; only changes are
// kept. Scenarios: signed in, signed out, an expired session, offline (the API unreachable), a slow API.
//   tools/browser-slot.sh node launch.mjs ROOT OUT_DIR
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launch, signedIn, sleep } from './harness.mjs';
const root = resolve(process.argv[2]), out = resolve(process.argv[3]); await fs.mkdir(out, { recursive: true });
const srv = await startServer(root, out), browser = await launch(), report = {};
const watch = () => {
  const seen = window.__seen = []; let last = '';
  const look = () => {
    const boot = document.getElementById('boot'), ui = document.getElementById('ui');
    const bootOn = !!boot && !boot.dataset.done && getComputedStyle(boot).display !== 'none';
    const scr = ui?.querySelector('.scr'), dialog = !!ui?.querySelector('.dialog');
    const what = [bootOn ? 'BOOT:' + (boot.querySelector('.boot__step')?.textContent || '') : null, scr ? 'SCREEN:' + ([...scr.classList].find(c => c.startsWith('scr--')) || 'scr') : null, dialog ? 'DIALOG' : null].filter(Boolean).join(' + ') || 'BLANK';
    if (what !== last) { seen.push({ t: Math.round(performance.now()), what }); last = what; }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};
const ALL = [
  ['signed-in', { signed: true }], ['returning', { signed: true, warm: true }], ['signed-out', {}], ['expired', { cookie: 'ar_session=0000expired0000' }],
  ['offline', { signed: true, down: true }], ['slow', { signed: true, delay: 2500 }], ['slow-returning', { signed: true, warm: true, delay: 2500 }],
];
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null, repeat = +(process.env.REPEAT || 1);
const SCENARIOS = ALL.filter(([n]) => !only || only.has(n)).flatMap(([n, o]) => Array.from({ length: repeat }, (_, i) => [repeat > 1 ? `${n}#${i + 1}` : n, o]));
try {
  for (const [name, o] of SCENARIOS) {
    srv.setApiDown(!!o.down); srv.setApiDelay(o.delay || 0);
    const context = o.signed ? await signedIn(browser, srv) : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (o.cookie) { const [n, v] = o.cookie.split('='); await context.addCookies([{ name: n, value: v, url: srv.base }]); }
    await context.addInitScript(watch);
    const page = await context.newPage(); page.setDefaultTimeout(120000);
    // A returning player: this browser has played before (its cache and storage are warm), then opens the game again.
    if (o.warm) { const d = srv.setApiDelay; d(0); await page.goto(`${srv.base}/`); await page.waitForFunction(() => document.querySelector('#ui .scr--title'), null, { timeout: 120000 }); await sleep(1500); d(o.delay || 0); }
    await page.goto(`${srv.base}/`, { waitUntil: 'commit' });
    await sleep(600); await page.screenshot({ path: resolve(out, `${name.replace('#', '-')}-early.png`) });
    await page.waitForFunction(() => { const b = document.getElementById('boot'); return (!b || b.dataset.done) && document.querySelector('#ui .scr'); }, null, { timeout: 60000 }).catch(() => {});
    await sleep(2500); await page.screenshot({ path: resolve(out, `${name.replace('#', '-')}-final.png`) });
    report[name] = await page.evaluate(() => window.__seen);
    console.log(name, JSON.stringify(report[name].map(s => `${s.t}ms ${s.what}`)));
    await context.close();
  }
} catch (e) { console.error(e); process.exitCode = 1; }
finally { srv.setApiDown(false); await fs.writeFile(resolve(out, 'launch.json'), JSON.stringify(report, null, 1)); await browser.close(); await srv.close(); process.exit(process.exitCode || 0); }
