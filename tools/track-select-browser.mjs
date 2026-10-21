// Signed-in end-to-end track selection. Run via tools/browser-slot.sh.
// TRACK_SELECT_TARGET defaults to production; TRACK_SELECT_OUT is a task temp dir.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
const target = process.env.TRACK_SELECT_TARGET || 'https://athensracing.com';
const uiOnly = process.env.TRACK_SELECT_UI_ONLY === '1';
const out = resolve(process.env.TRACK_SELECT_OUT || '.scratch/track-select');
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const token = (await readFile(resolve(homedir(), '.config/athens-racing/smoke-token'), 'utf8')).trim();
const nonce=randomBytes(16).toString('hex');
const smokeHeader=()=>{const payload=`smoke:${nonce}:${Date.now()+540000}`;return payload+'.'+createHmac('sha256',token).update(payload).digest('base64url');};
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
console.log('BROWSER JOB PID', process.pid);
process.once('SIGINT',()=>void browser.close());
const results = [], errors = [];
let page, failure;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { 'X-Smoke-Session': smokeHeader() } });
  page = await context.newPage(); page.setDefaultTimeout(360000);
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 'smoke-track-select', displayName: 'SMOKE TRACK' }, csrf: 'x', migrated: true } }));
  for (const path of ['friends', 'invites']) await page.route(`**/api/account/${path}`, route => route.fulfill({ json: [] }));
  await page.addInitScript(({ noDraw }) => {
    if (noDraw) for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (C?.prototype[k]) C.prototype[k] = function () {};
    window.__testPad = { id: 'Track selection test gamepad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 1 };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.__testPad] });
  }, { noDraw: process.env.TRACK_SELECT_NO_DRAW === '1' });
  const pause = () => page.waitForTimeout(200);
  const press = async key => { await page.keyboard.press(key); await pause(); };
  const pad = async button => {
    await page.evaluate(i => { Object.assign(__testPad.buttons[i], { pressed: true, touched: true, value: 1 }); __testPad.timestamp++; }, button);
    await page.waitForTimeout(180);
    await page.evaluate(i => { Object.assign(__testPad.buttons[i], { pressed: false, touched: false, value: 0 }); __testPad.timestamp++; }, button);
    await pause();
  };
  const picker = async () => {
    await page.locator('[data-act=play]').click(); await page.locator('[data-act=quick]').click();
    await page.locator('.track-pin').first().waitFor();
  };
  await page.goto(target + '/?menu=1&simhook=1', { waitUntil: 'domcontentloaded' });
  if (uiOnly) {
    await page.waitForFunction(()=>window.__bootMenu?.accounts.ready);
    await page.evaluate(async () => {
      // UI fixture uses published route/event metadata; production runs load the real world.
      const catalogue=(await(await fetch('/data/routes/index.json')).json()).routes,menu=window.__bootMenu;
      menu.h.selectUnifiedRoute=async(id,eventId)=>{
        const entry=catalogue.find(r=>r.id===id),def=entry.events.find(e=>e.id===eventId),points=entry.preview;
        const route={isWorldRoute:true,length:entry.lengthM,closed:Math.hypot(...points[0].map((v,i)=>v-points.at(-1)[i]))<1,from:entry.name,to:'FINISH',compiled:{id,sectorsM:[],definition:{name:entry.name}}};
        menu.h.ctx=()=>({mapId:'athens',route,marks:[],events:entry.events,eventId});
        menu.show('setup',{mode:'quick',def,eventId},true);
      };
    });
  }
  await picker();
  const catalogue=await page.evaluate(async()=> (await(await fetch('/data/routes/index.json')).json()).routes);
  const ids = await page.locator('.track-pin').evaluateAll(es => es.map(e => e.dataset.mapId));
  assert.deepEqual([...ids].sort(), ['megara-club', 'penteli-descent', 'penteli-hill', 'psychiko-faros', 'riviera-coast', 'syntagma-pilot'].sort());
  const selected = () => page.locator('.map-preview').getAttribute('data-map');
  for (const id of ids) for (const method of ['mouse', 'keyboard', 'gamepad']) {
    await context.setExtraHTTPHeaders({'X-Smoke-Session':smokeHeader()});
    console.log('SELECT', method, id);
    if (method === 'mouse') {
      // Select with the visible arrows, then click the card. Pins remain geographic previews.
      for (let n = 0; await selected() !== id && n < ids.length; n++) await page.locator('[data-act=mapNext]').click();
      assert.equal(await selected(), id); await page.locator(`.track-pin[data-map-id="${id}"]`).click(); await page.locator('[data-confirm-track]').click();
    } else {
      for (let n = 0; await selected() !== id && n < ids.length; n++) method === 'keyboard' ? await press('ArrowRight') : await pad(15);
      assert.equal(await selected(), id);
      if(method==='keyboard') { await press('ArrowLeft'); assert.notEqual(await selected(),id); await press('ArrowRight'); await press('ArrowUp'); assert.notEqual(await selected(),id); await press('ArrowDown'); }
      else { await pad(14); assert.notEqual(await selected(),id); await pad(15); }
      assert.equal(await selected(),id); method === 'keyboard' ? await press('Enter') : await pad(0);
    }
    await page.waitForFunction(() => window.__flow?.menu.screen === 'setup' || document.querySelector('#loading')?.dataset.state === 'failed', null, { polling: 200, timeout: 360000 });
    assert.equal(await page.evaluate(() => __flow.menu.screen), 'setup', await page.locator('#loading').innerText());
    console.log('SETUP', method, id);
    const setup = await page.evaluate(() => { const m = __flow.menu, d = m.setupDef(); return { routeId: d.routeId, eventId: d.id, summary: m.root.querySelector('.setup-head__name, .evs__name')?.textContent, worldRouteId: m.h.ctx().route.compiled.id }; });
    assert.equal(setup.routeId, id); assert.equal(setup.worldRouteId, id);
    const entry=catalogue.find(r=>r.id===id);assert.equal(setup.eventId,(entry.events.find(e=>e.type==='sprint')||entry.events[0]).id);assert.equal(setup.summary,entry.name);
    if (method === 'mouse' && !uiOnly) {
      await page.locator('[data-act=setupGo]').click(); await page.locator('[data-act=carConfirm]').click();
      await page.waitForFunction(id => window.__game?.ev?.def.routeId === id && __game.state === 'race', id, { polling: 200, timeout: 360000 });
      await press('Escape'); await page.locator('[data-act=quit]').click(); await picker();
    } else { await press('Escape'); await page.locator('.track-pin').first().waitFor(); }
    results.push({ method, id, ...setup, started: method === 'mouse' && !uiOnly }); console.log(JSON.stringify(results.at(-1)));
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(out, 'track-select.webp'), type: 'webp', quality: 65 });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = { message: error.message, state: await page?.evaluate(() => ({screen: window.__flow?.menu.screen, state:window.__game?.state, loading:document.querySelector('#loading')?.innerText, tiles:[...window.__worldSession?.stream.tiles.values() || []].map(t=>({state:t.state,error:t.error?.message})), metrics:window.__worldSession?.metrics})).catch(()=>null) };
  console.error(JSON.stringify(failure)); throw error;
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ target, uiOnly, results, errors, failure }, null, 2));
  await browser.close();
}
