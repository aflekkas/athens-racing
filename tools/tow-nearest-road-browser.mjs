// Real-game proof of the 2026-10-18 tow rule ("we just want to tow back onto the road"): the actual game, physics,
// ground and recovery fade on a private server. Run one job at a time:
//   tools/browser-slot.sh node tools/tow-nearest-road-browser.mjs <out-dir> [playwright-index.mjs]
// (a) free roam, Riviera: drive off into a field 30 m from the road, tow: on that road, facing the heading.
// (b) race, Psychiko: 20 m into a side street, tow: back on the route at the nearest point, not earlier.
// (c) race, Psychiko: 300 m down a non-route street, tow: the nearest road there, progress unchanged.
// (d) multiplayer, live private server over WebSocket: a tow cannot advance race progress, whatever the client claims.
import { resolve } from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { Route } from '../src/map.js';
import { roadSegments } from '../src/tow-placement.js';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
const [outArg = '.scratch/tow-nearest-road', pwArg = '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs'] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '..'), out = resolve(outArg);
await fs.mkdir(out, { recursive: true });
const { chromium } = await import(pwArg);
const app = await createGameServer({ root, dataDir: resolve(out, 'server-data') });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { scenarios: [], errors: [] };
// Page-side helpers (window.__H): an independent road search and teleport-driving through the production step.
const helpers = () => {
  const sim = window.__sim, G = window.__game, r = sim.route, v = sim.player.veh, segs = sim.ground.network?.segments || [];
  // Distance to the nearest road surface (route carriageway or any street), independent of the tow planner.
  const roadDistance = (x, z) => {
    let best = Infinity, on = 'route';
    for (let i = 0; i < r.N; i++) { const d = Math.hypot(r.X[i] - x, r.Z[i] - z) - r.edge(i * r.step); if (d < best) { best = d; on = 'route'; } }
    for (const g of segs) { const t = Math.max(0, Math.min(1, ((x - g.ax) * g.dx + (z - g.az) * g.dz) / g.L2)), d = Math.hypot(x - g.ax - g.dx * t, z - g.az - g.dz * t) - g.hw; if (d < best) { best = d; on = 'street'; } }
    return { distance: Math.max(0, best), on };
  };
  const tangentYaw = s => { const f = r.frame(s, {}); return Math.atan2(-f.tx, -f.tz); };
  const pose = () => ({ x: v.x, y: v.y, z: v.z, yaw: v.yaw, s: v.s, u: v.u, network: !!v._network });
  const course = () => { const c = G.run?.course; return c && { validProgress: c.validProgress, reached: c.reached, lastRoadS: c.lastRoad?.s, rejoinLimit: c.rejoinLimit ?? null, onRoute: c.onRoute }; };
  const hold = on => { Object.assign(sim.towOffer, { hold: on ? 1e9 : 0, corridorT: 0 }); if (!on) sim.towOffer.rearm = 0; };
  // The route in 6 m teleport steps through the production step: continuous, on the carriageway, earns progress.
  const driveRoute = (from, to) => {
    for (let s = from; s <= to; s += 6) { const u = r.closed ? 0 : (r.medHalf(s) + r.edge(s)) / 2; v.reset(s, u, 20); v.yaw = tangentYaw(s); sim.step(1, .3); }
  };
  // A straight cross-country run to (x, z) in 6 m steps (the rejoin rule counts it like any off-route drive).
  const runTo = (x, z, yaw) => {
    const x0 = v.x, z0 = v.z, n = Math.max(1, Math.ceil(Math.hypot(x - x0, z - z0) / 6));
    for (let i = 1; i <= n; i++) { v.x = x0 + (x - x0) * i / n; v.z = z0 + (z - z0) * i / n; v.yaw = yaw; v.vLong = 20; sim.step(1, .3); }
  };
  // A street point `lo`..`hi` metres from the route, in a station window, away from other roads.
  const streetSite = (lo, hi, from, to, skip = 0) => {
    let n = 0;
    for (const g of segs) {
      if (g.L < 4 || g.hw * 2 < 5 || g.road.oneway) continue;
      const x = g.ax + g.dx / 2, z = g.az + g.dz / 2, q = r.project(x, z, null), f = r.frame(q.s, {}), d = Math.hypot(x - f.x, z - f.z) - r.edge(q.s);
      if (d < lo || d > hi || q.s < from || q.s > to) continue;
      const near = sim.ground.network.candidates(x, z).filter(o => o.road !== g.road && sim.ground.network.distance(o, x, z) < o.hw + 10);
      if (near.length || sim.ground.walls(x, z, 5, {})) continue;
      if (n++ >= skip) return { x, z, s: q.s, routeDistance: d, yaw: Math.atan2(-g.dx, -g.dz), hw: g.hw, road: g.road.id };
    }
    return null;
  };
  window.__H = { sim, G, r, v, roadDistance, tangentYaw, pose, course, hold, driveRoute, runTo, streetSite };
};
async function open(url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(600000);
  page.on('pageerror', e => { report.errors.push(String(e.stack || e)); console.log('PAGEERROR', e.stack || e); });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', async r => r.fulfill({ body: await fs.readFile(resolve(root, 'node_modules/three', r.request().url().split('three@0.170.0/')[1])), contentType: 'text/javascript' }));
  await page.addInitScript(() => { const raf = requestAnimationFrame; window.requestAnimationFrame = cb => window.__hold && cb.name === 'frame' ? 0 : raf(cb); });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/${url}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__sim?.ground && document.body.classList.contains('loaded'), null, { timeout: 600000 });
  await page.evaluate(() => { window.__hold = true; window.__flow.menu?.hide?.(); const G = window.__game; G.state = 'race'; G.paused = null; G.towing = false; G.cam = 'chase'; G.userCam = 'chase'; document.body.classList.add('racing'); document.body.classList.remove('menu', 'ui-open', 'counting'); if (G.run && !G.run.started) G.run.start(); });
  await page.evaluate(`(${helpers.toString()})()`);
  return page;
}
const save = async (page, name) => {
  // The chase camera blends to the placement over about a second; the loop is frozen, so step it through.
  if (name.endsWith('-after')) await page.evaluate(() => window.__sim.step(150, 1 / 60));
  const data = await page.evaluate(() => { window.__game.cam = 'chase'; window.__sim.render(); return window.__sim.canvas.toDataURL('image/png').split(',')[1]; });
  await fs.writeFile(resolve(out, name + '.png'), Buffer.from(data, 'base64')); console.log('CAPTURE', name);
};
const settle = (page, frames = 30) => page.evaluate(frames => { window.__game.cam = 'chase'; window.__sim.step(frames, 1 / 60); }, frames);
// A real tow through the player's control; waits for the production fade, placement and recovery.
async function tow(page, reset = false) {
  await page.evaluate(() => window.__H.hold(false));
  await page.evaluate(reset => { reset ? window.__flow.resetCar() : window.__flow.action('tow'); }, reset);
  await page.waitForFunction(() => !window.__game.towing, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  // The course exactly as the tow left it, before the car drives (steps) from the placement.
  const atTow = await page.evaluate(() => { const H = window.__H; return { course: H.course(), pose: H.pose() }; });
  await page.evaluate(() => window.__sim.step(3, 1 / 60));
  return atTow;
}

// (d) A live multiplayer race against the real server over WebSocket, in real time.
async function multiplayerScenario() {
  const data = JSON.parse(await fs.readFile(resolve(root, 'data/maps/psychiko/map.json'), 'utf8')), route = new Route(data.route), segs = roadSegments(data.roadNetwork.roads);
  const mp = await createGameServer({ root, countdownMs: 300, dataDir: resolve(out, 'server-data-mp') });
  await new Promise(r => mp.server.listen(0, '127.0.0.1', r));
  const open = name => new Promise((ok, no) => {
    const ws = new WebSocket(`ws://127.0.0.1:${mp.server.address().port}/ws?protocol=${MULTIPLAYER_PROTOCOL}`), c = { ws, log: [], name };
    ws.onmessage = e => { const m = JSON.parse(e.data); c.log.push(m); if (m.lobby) c.lobby = m.lobby; if (m.standings) c.standings = m.standings; if (m.type === 'welcome' || m.id) c.id ??= m.id; };
    ws.onopen = () => ok(c); ws.onerror = no;
  });
  const send = (c, m) => c.ws.send(JSON.stringify(m)), wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(25); } };
  try {
    const a = await open('Alice'), b = await open('Bob');
    send(a, { type: 'create', name: 'Alice', mapId: 'psychiko', eventId: 'psychiko-race' }); await until(() => a.lobby?.code);
    send(b, { type: 'join', code: a.lobby.code, name: 'Bob' }); await until(() => a.lobby.players?.length === 2);
    send(a, { type: 'start', force: true }); await until(() => a.lobby.status === 'race'); await wait(500);
    const me = () => a.standings?.find(p => p.id === a.lobby.players.find(q => q.name === 'Alice')?.id)?.progress;
    let epoch = 1, last = null;
    const state = (x, z, yaw, stopped = false) => {
      const q = route.project(x, z, last?.s ?? 0, 8), f = route.frame(q.s, {});
      last = { x, y: f.y, z, yaw, s: q.s, u: q.u, vLong: stopped ? 0 : 20, vLat: 0, steer: 0, rpm: 3000, gear: 3, sampleTime: Date.now(), motionEpoch: epoch };
      send(a, { type: 'state', raceId: a.lobby.raceId, generation: a.lobby.generation, state: last });
    };
    const runTo = async (x, z, yaw) => { const x0 = last.x, z0 = last.z, n = Math.max(1, Math.ceil(Math.hypot(x - x0, z - z0) / 1.5)); for (let i = 1; i <= n; i++) { state(x0 + (x - x0) * i / n, z0 + (z - z0) * i / n, yaw); await wait(25); } };
    // A street about 20 m from the route, early in the lap.
    let site = null;
    for (const g of segs) { if (g.L < 4 || g.hw * 2 < 5 || g.road.oneway) continue; const x = g.ax + g.dx / 2, z = g.az + g.dz / 2, q = route.project(x, z, null), f = route.frame(q.s, {}), d = Math.hypot(x - f.x, z - f.z) - route.edge(q.s); if (d > 16 && d < 26 && q.s > 150 && q.s < 1500) { site = { x, z, s: q.s, yaw: Math.atan2(-g.dx, -g.dz) }; break; } }
    check('(d) a side street near the start exists', !!site, site);
    const p0 = route.point(0, 2); state(p0.x, p0.z, Math.atan2(-route.frame(0, {}).tx, -route.frame(0, {}).tz));
    for (let s = 1.5; s < site.s - 5; s += 1.5) { const p = route.point(s, 2), f = route.frame(s, {}); state(p.x, p.z, Math.atan2(-f.tx, -f.tz)); await wait(25); }
    await runTo(site.x, site.z, site.yaw); await wait(400);
    const before = me(), claim = route.point(2800, 2);
    epoch = 2; send(a, { type: 'recover', raceId: a.lobby.raceId, generation: a.lobby.generation, motionEpoch: 2, s: 2800, x: claim.x, z: claim.z });
    await until(() => a.log.some(m => m.type === 'recovered')); const ack = a.log.findLast(m => m.type === 'recovered');
    check('(d) server placed the car from its own last pose, not the claimed one', Math.hypot(ack.x - site.x, ack.z - site.z) < 45 && Math.abs(ack.s - 2800) > 500, { ack, site });
    check('(d) a route placement within 40 m, at or after the point it left', ack.kind === 'route', ack);
    // Hold: a state teleported to the claimed far pose is rejected; progress must not move.
    await wait(300); state(claim.x, claim.z, ack.yaw, true); await wait(400);
    const after = me();
    check('(d) the tow granted no progress, and the claimed far position bought none', after <= before + 1e-6, { before, after });
    report.scenarios.push({ scenario: 'd', before, after, ack });
  } finally { await mp.close(); }
}
const check = (label, ok, detail) => { console.log(ok ? 'PASS' : 'FAIL', label, detail === undefined ? '' : JSON.stringify(detail)); assert.ok(ok, `${label} ${JSON.stringify(detail ?? '')}`); };
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
try {
  // (a) Free roam on Riviera: 30 m into a field, towed onto that road, facing the heading.
  if (!process.env.ONLY_MP) {
    const page = await open('?simhook&quality=low&fixedres&fixeddt&notraffic&map=riviera&car=mini&event=free');
    const site = await page.evaluate(() => { const { r, sim, roadDistance } = window.__H;
      for (let s = 900; s < r.length - 300; s += 83) for (const side of [-1, 1]) {
        if (r.localLayout?.contains(s)) continue;
        const u = side * (r.edge(s) + 30), p = r.point(s, u), d = roadDistance(p.x, p.z), g = sim.ground.at(p.x, p.z, s, u, {});
        if (d.distance > 28 && d.distance < 33 && d.on === 'route' && !g.water && !sim.ground.walls(p.x, p.z, 6, {})) return { s, side, x: p.x, z: p.z, roadDistance: d.distance };
      } return null; });
    check('(a) a field 30 m from the road exists on Riviera', !!site, site);
    for (const [label, turn] of [['heading-along', .5], ['heading-against', Math.PI - .4]]) {
      await page.evaluate(({ site, turn }) => { const { v, r, tangentYaw, hold, sim } = window.__H; hold(true); v.reset(site.s, site.side * (r.edge(site.s) + 30), 0); v.x = site.x; v.z = site.z; v.yaw = tangentYaw(site.s) + turn; sim.step(30, 1 / 60); }, { site, turn });
      const before = await page.evaluate(() => ({ ...window.__H.pose(), roadDistance: window.__H.roadDistance(window.__H.v.x, window.__H.v.z) }));
      if (label === 'heading-along') await save(page, 'a-riviera-free-roam-before');
      await tow(page);
      const after = await page.evaluate(() => { const H = window.__H, p = H.pose(), g = H.sim.ground.at(p.x, p.z, p.s, p.u, {}); return { ...p, roadDistance: H.roadDistance(p.x, p.z), surface: g.surf, edge: H.r.edge(p.s), tangentYaw: H.tangentYaw(p.s) }; });
      if (label === 'heading-along') await save(page, 'a-riviera-free-roam-after');
      const moved = Math.hypot(after.x - before.x, after.z - before.z), flipped = angle(after.yaw, after.tangentYaw) > Math.PI / 2;
      check(`(a ${label}) on the road`, after.roadDistance.distance === 0 && Math.abs(after.u) + 0.9 <= after.edge, after);
      check(`(a ${label}) the nearest road: moved about the 30 m to it`, moved > 25 && moved < 45, { moved, before: before.roadDistance });
      check(`(a ${label}) faces the direction closest to the heading`, angle(after.yaw, before.yaw) < Math.PI / 2, { before: before.yaw, after: after.yaw, flipped });
      report.scenarios.push({ scenario: 'a', label, before, after, moved });
    }
    await page.close();
  }
  // (b) and (c): Psychiko race.
  if (!process.env.ONLY_MP) {
    const page = await open('?simhook&quality=low&fixedres&fixeddt&notraffic&map=psychiko&car=mini&event=quick');
    const start = await page.evaluate(() => ({ s0: window.__H.G.ev.r.s0, dir: window.__H.G.dir || 1, len: window.__H.G.ev.r.len, type: window.__H.G.ev.def.type }));
    console.log('RACE', JSON.stringify(start)); check('Psychiko quick race is a race', start.type !== 'free', start);
    // (b) 20 m into a side street.
    {
      const site = await page.evaluate(() => window.__H.streetSite(16, 26, 400, 3000));
      check('(b) a side street 20 m from the route exists', !!site, site);
      await page.evaluate(site => { const H = window.__H; H.driveRoute(0, Math.max(0, site.s - 12)); }, site);
      await page.evaluate(site => { const H = window.__H, v = H.v; const u = (H.r.closed ? 0 : 0); H.hold(true); H.runTo(site.x, site.z, site.yaw); H.sim.step(30, 1 / 60); }, site);
      const before = await page.evaluate(() => ({ ...window.__H.pose(), course: window.__H.course(), roadDistance: window.__H.roadDistance(window.__H.v.x, window.__H.v.z) }));
      await save(page, 'b-psychiko-side-street-before');
      const atTow = await tow(page);
      const after = await page.evaluate(() => { const H = window.__H, p = H.pose(); return { ...p, course: H.course(), roadDistance: H.roadDistance(p.x, p.z), edge: H.r.edge(p.s), tangentYaw: H.tangentYaw(p.s) }; });
      await save(page, 'b-psychiko-side-street-after');
      check('(b) progress was earned before leaving the route', before.course.lastRoadS > 500 && before.course.reached > 500, before.course);
      check('(b) back on the route', !after.network && after.roadDistance.on === 'route' && after.roadDistance.distance === 0, after);
      check('(b) at the nearest route point, not earlier than where the car left it', after.s >= before.course.lastRoadS - 1 && Math.abs(after.s - site.s) < 45, { after: after.s, left: before.course.lastRoadS, site: site.s });
      check('(b) the tow itself granted no progress', atTow.course.reached === before.course.reached && atTow.course.validProgress === before.course.validProgress && atTow.course.rejoinLimit === before.course.rejoinLimit, { before: before.course, atTow: atTow.course });
      check('(b) driving on from the tow earns no more than driving back onto the route would (the rejoin credit)', after.course.reached <= before.course.rejoinLimit + 1e-6, { before: before.course, after: after.course });
      report.scenarios.push({ scenario: 'b', site, before, atTow, after });
    }
    // (c) 300 m down a non-route street.
    {
      const site = await page.evaluate(() => window.__H.streetSite(250, 450, 400, 3000));
      check('(c) a street 300 m from the route exists', !!site, site);
      await page.evaluate(site => { const H = window.__H; H.hold(true); H.driveRoute(0, Math.max(0, site.s - 12)); }, site);
      const earned = await page.evaluate(() => window.__H.course());
      await page.evaluate(site => { const H = window.__H; H.runTo(site.x, site.z, site.yaw); H.sim.step(30, 1 / 60); }, site);
      const before = await page.evaluate(() => ({ ...window.__H.pose(), course: window.__H.course(), roadDistance: window.__H.roadDistance(window.__H.v.x, window.__H.v.z) }));
      await save(page, 'c-psychiko-300m-street-before');
      const atTow = await tow(page);
      const after = await page.evaluate(() => { const H = window.__H, p = H.pose(), net = H.sim.ground.network.sample(p.x, p.z, {}); return { ...p, course: H.course(), roadDistance: H.roadDistance(p.x, p.z), onTarmac: !!net && net.step === 0, tangentYaw: H.tangentYaw(p.s) }; });
      await save(page, 'c-psychiko-300m-street-after');
      check('(c) progress was earned before the excursion', earned.reached > 500, earned);
      check('(c) the nearest road there: on the street, not 300 m away on the route', after.network && after.onTarmac && Math.hypot(after.x - site.x, after.z - site.z) < 30, { after, site });
      check('(c) progress unchanged by the tow and by driving on from the side street', [atTow.course, after.course].every(c => c.reached === before.course.reached && c.validProgress === before.course.validProgress), { earned, before: before.course, atTow: atTow.course, after: after.course });
      report.scenarios.push({ scenario: 'c', site, earned, before, atTow, after });
    }
    await page.close();
  }
  await multiplayerScenario();
  check('no page errors', report.errors.length === 0, report.errors);
} finally {
  await fs.writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await app.close();
}
