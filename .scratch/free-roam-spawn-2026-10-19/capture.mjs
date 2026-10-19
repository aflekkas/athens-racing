// Browser proof and screenshots for the free roam spawn picker (owner 2026-10-19). One job at a time:
//   tools/browser-slot.sh node .scratch/free-roam-spawn-2026-10-19/capture.mjs <out-dir> <base-url> [playwright-index.mjs]
// At 1280x800 and a narrow desktop window (960x700): the picker with its pins, a clicked road point, "no road here", and
// the car in the cockpit after DRIVE at two places, with the placement measured against the map's own roads.
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
const [outArg = '.scratch/free-roam-spawn-2026-10-19', base = 'http://127.0.0.1:8000', pwArg = '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs'] = process.argv.slice(2);
const out = resolve(outArg); await fs.mkdir(out, { recursive: true });
const { chromium } = await import(pwArg);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { sizes: [], errors: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (page, name) => { await page.screenshot({ path: resolve(out, name + '.png'), timeout: 900000 }); };
const settled = page => page.waitForFunction(() => document.querySelector('.attica-map.ready') && !document.querySelector('.map-preview.panel--moving'), null, { timeout: 600000 }).then(() => sleep(6000));

async function openPicker(page) {
  await page.waitForSelector('[data-act=play]', { timeout: 600000 }); await page.click('[data-act=play]');
  await page.waitForSelector('[data-act=free]'); await page.click('[data-act=free]');
  await settled(page);
}
// Page-side: distance from the car to the nearest road of the loaded map, independent of the tow planner.
const measure = () => page => page.evaluate(() => {
  const sim = window.__sim, v = sim.player.veh, r = sim.route, segs = sim.ground.network?.segments || [];
  let best = Infinity, on = 'route';
  for (let i = 0; i < r.N; i++) { const d = Math.hypot(r.X[i] - v.x, r.Z[i] - v.z) - r.edge(i * r.step); if (d < best) { best = d; on = 'route'; } }
  for (const g of segs) { const t = Math.max(0, Math.min(1, ((v.x - g.ax) * g.dx + (v.z - g.az) * g.dz) / g.L2)), d = Math.hypot(v.x - g.ax - g.dx * t, v.z - g.az - g.dz * t) - g.hw; if (d < best) { best = d; on = 'street'; } }
  const q = sim.ground.network?.sample(v.x, v.z);
  return { map: window.__game.ev?.def?.mapId, x: +v.x.toFixed(1), z: +v.z.toFixed(1), y: +v.y.toFixed(2), yaw: +v.yaw.toFixed(3), speed: +Math.abs(v.vLong).toFixed(2), network: !!v._network, roadDistance: +Math.max(0, best).toFixed(2), nearest: on,
    tarmac: v._network ? q?.step === 0 : Math.abs(v.u) + v.halfW <= r.edge(v.s), roadY: v._network ? +sim.ground.network.height(v.x, v.z).toFixed(2) : +r.point(v.s, v.u).y.toFixed(2), state: window.__game.state, mode: document.body.dataset.mode,
    routeHud: ['routeBox', 'lapTiming', 'posBox'].map(id => { const el = document.getElementById(id); return el ? getComputedStyle(el).display : 'none'; }).every(d => d === 'none') };
});

// SIZES=1280x800,960x700 and SCENES=picker,overview,road,noroad,riviera,psychiko pick what runs (a re-run needs only the missing ones).
const sizes = (process.env.SIZES || '1280x800,960x700').split(',').map(v => v.split('x').map(Number)), scenes = new Set((process.env.SCENES || 'picker,overview,road,noroad,riviera,psychiko').split(','));
for (const [width, height] of sizes) {
  const tag = `${width}x${height}`, page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' }), entry = { size: tag, steps: [] };
  page.on('pageerror', e => report.errors.push(`${tag} pageerror: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') report.errors.push(`${tag} console: ${m.text()}`); });
  await page.goto(base + '/?menu=1'); await openPicker(page);
  const choose = async id => { await page.evaluate(spot => window.__flow.menu.mapView.preview(spot), id); await settled(page); };
  if (scenes.has('picker')) {
    entry.picker = await page.evaluate(() => ({ screen: window.__flow.menu.screen, mode: window.__flow.menu.data.mode, pins: document.querySelectorAll('.spawn-pin').length, trackPins: document.querySelectorAll('[data-map-id]').length, panelFloat: !!document.querySelector('.map-preview.panel--float'), choice: window.__flow.menu.mapView.choice.name }));
    await shot(page, `picker-${tag}`);
    // Keyboard cycles the named spots (the menu's "right" action is what D and RB send); the camera flies to the next one.
    await page.evaluate(() => window.__flow.menu.action('right')); await settled(page);
    entry.afterNext = await page.evaluate(() => window.__flow.menu.mapView.choice.name);
  }
  if (scenes.has('overview')) {
    // Scroll zooms the map out to every region's pins; choosing a place flies back in.
    await page.mouse.move(width * .35, height * .5); for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1400); await sleep(350); } await settled(page); await shot(page, `picker-overview-${tag}`);
    entry.overview = await page.evaluate(() => document.querySelectorAll('.spawn-pin').length);
    await choose('riviera:vouliagmeni');
  }
  if (scenes.has('road') || scenes.has('noroad')) {
    // Choose Varkiza by its pin, then click a nearby named street on the map.
    await choose('riviera:varkiza');
    const target = await page.evaluate(async () => {
      const spots = await import('/src/spawn-spots.js'), roads = spots.decodeSpawnRoads(await (await fetch('assets/maps/spawn-roads.json')).json());
      const at = window.__flow.menu.mapView.choice.at; let best = null, bd = 1e9;
      for (const road of roads.riviera.roads) if (road.name && !road.major) for (let i = 0; i < road.pts.length; i += 2) { const d = Math.hypot(road.pts[i] - at[0], road.pts[i + 1] - at[1]); if (d > 1.2 && d < bd) { bd = d; best = { at: [road.pts[i], road.pts[i + 1]], name: road.name }; } }
      return { ...best, client: window.__flow.menu.mapView.screenOf(best.at) };
    });
    await page.mouse.click(target.client[0] + 3, target.client[1] + 2); await sleep(400);
    entry.clicked = await page.evaluate(() => ({ ...window.__flow.menu.mapView.choice, panel: document.querySelector('.map-preview h3').textContent, kind: document.querySelector('.map-kind').textContent }));
    await settled(page); await shot(page, `road-click-${tag}`);
    // Open water: no road, a short hint.
    const sea = await page.evaluate(() => window.__flow.menu.mapView.screenOf([window.__flow.menu.mapView.choice.at[0] + 2.2, window.__flow.menu.mapView.choice.at[1] + 2.4]));
    await page.mouse.click(sea[0], sea[1]); await sleep(500);
    entry.noRoad = await page.evaluate(() => ({ shown: document.querySelector('.spawn-nohere').classList.contains('on'), choiceKept: window.__flow.menu.mapView.choice.name }));
    await shot(page, `no-road-${tag}`);
  }
  // DRIVE from a named spot, then from another map's spot.
  let first = true;
  for (const [scene, spot] of [['riviera', 'riviera:vouliagmeni'], ['psychiko', 'psychiko:kifisias']]) {
    if (!scenes.has(scene)) continue;
    if (!first) { await page.evaluate(() => window.__flow.quit('title')); await page.waitForSelector('[data-act=play]', { timeout: 600000 }); await openPicker(page); }
    first = false;
    await choose(spot); await page.click('[data-act=spawnDrive]');
    await page.waitForFunction(() => window.__game?.state === 'race' && document.body.classList.contains('started'), null, { timeout: 900000 }); await sleep(6000);
    const pose = await measure()(page); entry.steps.push({ spot, ...pose });
    await shot(page, `in-car-${scene}-${tag}`);
  }
  report.sizes.push(entry); await page.close();
}
await fs.writeFile(resolve(out, `report-${(process.env.SIZES || 'all').replace(/,/g, '_')}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
