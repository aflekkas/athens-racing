// usage: node capture.mjs <root> <outDir> <variant: default|offoff|after>
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const [root, out, variant] = process.argv.slice(2);
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const only = process.argv[5] ? process.argv[5].split(',') : ['riviera', 'megara', 'penteli'];
await fs.mkdir(out, { recursive: true });
const { createGameServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')).href);
const pw = await import('/tmp/pw/node_modules/playwright/index.mjs');
const app = await createGameServer({ root, dataDir: resolve('/tmp/gl/data-' + variant) });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const port = app.server.address().port;
const browser = await pw.chromium.launch({ headless: true, executablePath: resolve(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { variant, maps: {}, errors: [] };
const ls = variant === 'offoff' ? { s: JSON.stringify({ lighting: 'off', effects: 'off' }), g: 'high' } : variant === 'default' ? { s: '{}', g: '' } : { s: JSON.stringify({ perfClass: 'high' }), g: '' };
try {
  for (const map of only) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => report.errors.push(map + ': ' + e));
    await page.addInitScript(([s, g]) => { localStorage.setItem('paraliaki.settings', s); if (g) localStorage.setItem('paraliaki.graphics', g); localStorage.setItem('paraliaki.graphicsPrompt.v1', 'seen'); const raf = requestAnimationFrame; window.requestAnimationFrame = cb => window.__freeze && cb.name === 'frame' ? 0 : raf(cb); }, [ls.s, ls.g]);
    await page.route('**/src/main.js', async r => { const res = await r.fetch(); await r.fulfill({ response: res, body: (await res.text()).replace('stencil: false', 'stencil: false, preserveDrawingBuffer: true') }); });
    await page.goto(`http://127.0.0.1:${port}/?simhook&fixeddt&notraffic&map=${map}&car=mini`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('loaded'), null, { timeout: 900000, polling: 250 });
    await page.evaluate(() => { window.__freeze = true; });
    await page.evaluate(() => new Promise(d => requestAnimationFrame(() => requestAnimationFrame(d))));
    await page.evaluate(() => { window.__game.state = 'race'; const r = window.__sim.route; window.__sim.player.veh.reset(300, r.closed ? 0 : r.laneU(300, 0), 0); window.__sim.step(1); });
    report.maps[map] = { renderInfo: await page.evaluate(() => window.__renderInfo()) };
    for (const tod of ['day', 'night']) for (const cam of ['chase', 'cockpit']) {
      const stat = await page.evaluate(([tod, cam]) => {
        window.__setConditions({ time: tod, weather: 'clear' }); window.__post.snapGrade();
        const { G, camera, player, renderer } = window.__sim; G.cam = G.userCam = cam;
        const root = player.model.root; root.updateMatrixWorld(true);
        const fwd = root.position.clone().set(0, 0, -1).applyQuaternion(root.quaternion), p = root.position;
        if (cam === 'cockpit') { player.cockpit.setVisible(true); player.driver.head.visible = false; player.driver.head.getWorldPosition(camera.position); camera.position.y += .02; camera.lookAt(camera.position.clone().add(fwd)); camera.fov = 66; camera.near = .05; }
        else { player.driver.head.visible = true; camera.position.copy(p).addScaledVector(fwd, -7); camera.position.y += 2.8; camera.lookAt(p.clone().addScaledVector(fwd, 8).add(new p.constructor(0, 1, 0))); camera.fov = 58; camera.near = .25; }
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        for (let i = 0; i < 4; i++) window.__sim.render(); // settle mirror cadence / grade
        let passes = 0, targets = new Set(); const orig = renderer.render;
        renderer.render = function (s, c) { passes++; targets.add(renderer.getRenderTarget()?.texture?.name || (renderer.getRenderTarget() ? 'rt' : 'screen')); return orig.call(this, s, c); };
        window.__sim.render(); renderer.render = orig; renderer.getContext().finish();
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, passes, targets: [...targets], shadowMap: renderer.shadowMap.enabled };
      }, [tod, cam]);
      const name = `${variant}-${map}-${tod}-${cam}`;
      await page.screenshot({ path: resolve(out, name + '.png'), timeout: 120000 });
      report.maps[map][tod + '-' + cam] = stat; console.log(name, JSON.stringify(stat));
    }
    if (map === 'riviera') {
      await page.evaluate(() => { window.__freeze = false; window.__game.state = 'menu'; window.__flow.menu.show('settings', { tab: 'video' }); });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(out, `${variant}-settings-graphics.png`), timeout: 120000 });
    }
    await page.close();
  }
} catch (e) { report.errors.push(String(e.stack || e)); console.error(e); }
finally { await fs.writeFile(resolve(out, variant + '-report.json'), JSON.stringify(report, null, 2)); await browser.close(); await app.close?.(); process.exit(0); }
