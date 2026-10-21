// Walk launch-to-goal paths with the keyboard and record every step (screen, focused control, screenshot).
//   tools/browser-slot.sh node flows.mjs ROOT OUT_DIR [flow,flow]
// Each flow is a list of keys pressed from a freshly loaded, signed-in title screen. A step that starts a session (race
// loading or free roam) ends the flow. The step count is the number of presses; Enter on a default counts as one.
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launch, signedIn, sleep } from './harness.mjs';
const root = resolve(process.argv[2]), out = resolve(process.argv[3]); await fs.mkdir(out, { recursive: true });
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const FLOWS = JSON.parse(await fs.readFile(new URL('./flows.json', import.meta.url), 'utf8'));
const srv = await startServer(root, out), browser = await launch(), report = {};
const state = page => page.evaluate(() => {
  const m = window.__flow?.menu || window.__bootMenu, f = m?.items?.()[m.focus], ld = document.getElementById('loading');
  return { screen: m?.screen || null, ui: document.body.classList.contains('ui-open'), loading: !!ld?.classList.contains('open'), state: window.__flow?.state || null,
    focus: f ? (f.dataset.act || f.dataset.key || f.dataset.carIndex || f.tagName).toString().slice(0, 24) + (f.textContent ? ' · ' + f.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) : '') : null, url: location.search };
});
try {
  for (const flow of FLOWS.filter(f => !only || only.has(f.name))) {
    const context = await signedIn(browser, srv), page = await context.newPage(); page.setDefaultTimeout(120000);
    if (flow.setup) await context.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, flow.setup);
    await page.goto(`${srv.base}/${flow.query || ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window.__flow?.menu || window.__bootMenu)?.screen === 'title' && !document.querySelector('.dialog'), null, { timeout: 120000 });
    await page.evaluate(() => document.fonts.ready); await sleep(1500);
    const steps = [{ key: null, ...(await state(page)) }];
    await page.screenshot({ path: resolve(out, `${flow.name}-00.png`) });
    for (const [i, key] of flow.keys.entries()) {
      if (key.startsWith('click:')) await page.click(key.slice(6)); else await page.keyboard.press(key);
      await sleep(flow.wait || 1400);
      const s = await state(page); steps.push({ key, ...s });
      await page.screenshot({ path: resolve(out, `${flow.name}-${String(i + 1).padStart(2, '0')}.png`) });
      if (s.loading || s.state === 'race' || /spawn=|map=athens&spawn/.test(s.url)) break;
    }
    // From the results of the race just loaded: which screen does one press of Enter lead to?
    if (flow.results) {
      await page.waitForFunction(() => window.__flow?.state === 'race' || window.__flow?.state === 'countdown', null, { timeout: 600000 });
      await sleep(3000);
      await page.evaluate(() => { const m = window.__flow.menu; m.show('results', { title: 'FINISHED', kick: 'QUICK RACE', rows: [['TIME', '6:42.18', true]], result: { time: 402.18 } }, true); });
      await sleep(1500); const r0 = await state(page); await page.screenshot({ path: resolve(out, `${flow.name}-results.png`) });
      await page.keyboard.press('Enter'); await sleep(2500); const r1 = await state(page);
      await page.screenshot({ path: resolve(out, `${flow.name}-results-enter.png`) });
      steps.push({ key: 'results', ...r0 }, { key: 'Enter', ...r1, restarted: r1.screen !== 'car' && (r1.loading || r1.state === 'countdown' || r1.state === 'race') });
    }
    const last = steps.at(-1);
    report[flow.name] = { presses: steps.length - 1, reached: last.loading || last.state === 'race' ? 'session' : last.screen, goal: flow.goal, steps };
    console.log(flow.name, steps.length - 1, JSON.stringify(steps.map(s => `${s.key || 'start'} -> ${s.screen}${s.loading ? ' [loading]' : ''} (${s.focus})`)));
    await context.close();
  }
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await fs.writeFile(resolve(out, 'flows.json'), JSON.stringify(report, null, 1)); await browser.close(); await srv.close(); process.exit(process.exitCode || 0); }
