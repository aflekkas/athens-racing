// Two REAL browser clients racing each other through a real game server, with one slow machine and a bad link.
// Run through the browser slot (one slot; both clients share a single Chromium; loading takes minutes on a busy host, so
// every scenario runs inside ONE loaded session):
//   tools/browser-slot.sh node tools/mp-two-client-browser.mjs --out=DIR [--tree=ROOT] [--scenarios=smooth,collision] [--net=rtt150] [--slow-fps=15 --cpu=5]
//   --target=https://staging.athensracing.com   drive staging instead of a local server (needs SMOKE_TOKEN, see tools/deploy-smoke.mjs)
//   scenarios:
//     smooth     the other car's drawn position error, step/jerk metric, snaps and invisible time, for each condition in CONDITIONS
//     collision  A rams B and B rams A at several speeds: both cars' velocity change and how many frames reported the hit
// Sign-in is the stub-Google helper locally (server/accounts-stub.mjs: real OAuth handlers, mocked Google) and the smoke session
// on staging. The network shaper wraps the WebSocket (CDP network throttling does not touch WebSockets): fixed delay + jitter each way,
// in-order delivery, and a retransmit stall for a small share of messages. The slow client is CPU-throttled and frame-capped.
// The GL draw call is stubbed (--gl keeps it): the subject is the game logic and the network, and software rendering on a shared
// host turns a "15 fps" client into 0.5 fps. Frames still run the real simulation, HUD update, intake and render-pose code.
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d, flag = k => process.argv.includes(`--${k}`);
const tree = resolve(arg('tree', new URL('..', import.meta.url).pathname)), out = resolve(arg('out', '.scratch/mp-two-client'));
const target = arg('target', ''), scenarios = arg('scenarios', 'smooth').split(',');
const NETS = { none: { base: 0, jitter: 0, loss: 0, rto: 0 }, mid: { base: 60, jitter: 20, loss: 0, rto: 0 }, rtt150: { base: 75, jitter: 50, loss: .015, rto: 300 }, bad: { base: 150, jitter: 50, loss: .015, rto: 300 } };
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
await mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

let server, base, auth = [];
if (target) {
  base = target.replace(/\/$/, '');
  const token = process.env.SMOKE_TOKEN || readFileSync(resolve(homedir(), '.config/athens-racing/smoke-token'), 'utf8').trim();
  // Same payload and HMAC as server/smoke-session.mjs; valid for ten minutes, so a staging run must stay shorter.
  const header = () => { const payload = `smoke:${randomBytes(16).toString('hex')}:${Date.now() + 540000}`; return payload + '.' + createHmac('sha256', token).update(payload).digest('base64url'); };
  auth = [{ smoke: header() }, { smoke: header() }];
} else {
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  const { accountsStub } = await import(pathToFileURL(resolve(tree, 'server/accounts-stub.mjs')));
  const stub = accountsStub(base);
  const { createGameServer } = await import(pathToFileURL(resolve(tree, 'server/index.mjs')));
  server = await createGameServer({ root: tree, accountEnv: stub.env, dataDir: resolve(out, 'data'), countdownMs: 3000 });
  await new Promise(r => server.server.listen(port, '127.0.0.1', r));
  for (const [i, name] of ['ALPHA', 'BRAVO'].entries()) { const a = await stub.signIn(`mp-sync-${i}`, name); auth.push({ cookie: a.cookie }); }
}

// ---- the link, switchable between scenarios: in-order delivery, base delay, jitter and the occasional retransmit stall
const cond = { net: NETS[arg('net', 'rtt150')] };
function shaper() {
  const lane = () => { let last = 0; return fn => { const net = cond.net; let at = Date.now() + net.base + (Math.random() * 2 - 1) * net.jitter; if (net.loss && Math.random() < net.loss) at += net.rto; at = Math.max(last, at); last = at; setTimeout(fn, Math.max(0, at - Date.now())); }; };
  return { up: lane(), down: lane() };
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const pages = {}, cdps = {}, errors = [], results = {};
const both = fn => Promise.all(Object.values(pages).map(fn));
try {
  for (const [i, name] of ['A', 'B'].entries()) {
    const context = await browser.newContext({ viewport: { width: 320, height: 180 }, ...(auth[i].smoke ? { extraHTTPHeaders: { 'X-Smoke-Session': auth[i].smoke } } : {}) });
    if (auth[i].cookie) { const [n, ...v] = auth[i].cookie.split('='); await context.addCookies([{ name: n, value: v.join('='), url: base }]); }
    const page = await context.newPage(); pages[name] = page; page.setDefaultTimeout(+arg('step-timeout', 240000));
    { const wait = page.waitForFunction.bind(page); page.waitForFunction = (fn, a, opts = {}) => wait(fn, a, { polling: 200, ...opts }); } // the default polls on requestAnimationFrame
    cdps[name] = await context.newCDPSession(page);
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    if (target) await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: `smoke-${name}`, name: `SMOKE ${name}`, displayName: `SMOKE ${name}` }, csrf: 'x' } }));
    const shaped = shaper();
    await page.routeWebSocket(/\/ws(\?|$)/, ws => {
      const upstream = ws.connectToServer();
      ws.onMessage(m => shaped.up(() => upstream.send(m)));
      upstream.onMessage(m => shaped.down(() => ws.send(m)));
      ws.onClose((code, reason) => upstream.close({ code, reason })); upstream.onClose((code, reason) => ws.close({ code, reason }));
    });
    await page.addInitScript(({ name }) => {
      localStorage.setItem('paraliaki.driver', name === 'A' ? 'ALPHA' : 'BRAVO'); localStorage.setItem('paraliaki.car', 'mini');
      const raf = window.requestAnimationFrame.bind(window); let lastRun = 0; const frames = window.__frames = [];
      window.__fps = 0;
      window.requestAnimationFrame = cb => raf(ts => {
        if (window.__fps && ts - lastRun < 1000 / window.__fps - 4) return window.requestAnimationFrame(cb); // a machine that only manages __fps
        lastRun = ts; cb(ts);
        if (cb.name === 'frame' && window.__record) {
          const v = window.__vehicle?.(), remote = window.__onlineCars?.()[0];
          frames.push({ wall: Date.now(), x: v?.x, z: v?.z, y: v?.y, yaw: v?.yaw, s: v?.s, v: v?.vLong, remote: remote ? { visible: remote.visible, x: remote.x, z: remote.z, yaw: remote.yaw, s: remote.s, v: remote.vLong } : null, state: window.__sim?.G.state, hits: (window.__multiplayer?.lastContacts || []).filter(h => h.closing > 1).map(h => ({ closing: h.closing, impulse: h.impulse })) });
        }
      });
    }, { name });
    await page.goto(`${base}/?simhook=1&debug=1&quality=low&fixedres=1&map=riviera`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  }
  await both(p => p.waitForFunction(() => document.body.classList.contains('loaded') && window.__multiplayer?.connected && window.__sim?.player, null, { timeout: 900000 }));
  log('both clients loaded', base);
  const { A, B } = pages;
  if (!flag('gl')) await both(p => p.evaluate(() => { __sim.renderer.render = () => {}; }));
  await A.evaluate(() => __multiplayer.createLobby({ private: true, config: { traffic: 0 } }));
  await A.waitForFunction(() => __multiplayer.lobby?.status === 'waiting');
  const code = await A.evaluate(() => __multiplayer.lobby.code);
  await B.evaluate(code => __multiplayer.action('join', { code }), code);
  await B.waitForFunction(() => __multiplayer.worldReady && __multiplayer.me?.loaded);
  await A.waitForFunction(() => __multiplayer.lobby.players.length === 2 && __multiplayer.lobby.players.every(p => p.loaded));
  log('lobby formed', code);

  // ---- conditions and helpers shared by the scenarios
  const setCpu = async (name, rate) => cdps[name].send('Emulation.setCPUThrottlingRate', { rate });
  async function conditions({ net, slow = null, fps = 15, cpu = 5 }) {
    cond.net = NETS[net];
    for (const n of ['A', 'B']) { await pages[n].evaluate(f => { window.__fps = f; }, n === slow ? fps : 0); await setCpu(n, n === slow ? cpu : 1); }
  }
  // Ready everyone and start (or restart) the race, then wait for GO on both screens.
  async function race() {
    const status = await A.evaluate(() => __multiplayer.lobby.status);
    if (status === 'waiting') {
      for (const p of [A, B]) await p.evaluate(() => { const me = __multiplayer.me; if (!me.ready) __multiplayer.$('mp-ready').click(); });
      await A.waitForFunction(() => __multiplayer.lobby.players.every(p => p.ready && p.loaded));
      await A.evaluate(() => __multiplayer.startRace());
    } else await A.evaluate(() => __multiplayer.restart());
    await sleep(500);
    await both(p => p.waitForFunction(() => __multiplayer.lobby.status === 'race' && __multiplayer.now() >= __multiplayer.lobby.startAt && __sim.G.state === 'race', null, { timeout: 120000 }));
    await both(p => p.evaluate(() => { __multiplayer.close(); __flow.menu.close?.(); }));
  }
  // Autopilot: pure pursuit to the middle of a lane (the law main.js uses to park a car), real physics, speed target `speed` m/s.
  // `coast` stops the throttle so a collision is not fought by the driver; `hold` keeps the car still.
  const pilot = (p, lane) => p.evaluate(lane => {
    const v = __vehicle();
    if (!v.__piloted) {
      const step = v.update.bind(v); v.__piloted = true;
      window.__pilot = { speed: 24, lane, coast: false, hold: false };
      v.update = (dt, pin) => {
        const P = window.__pilot, r = __sim.route, look = Math.max(10, Math.abs(v.vLong) * .8), s2 = Math.min(r.length - 5, v.s + look), q = r.point(s2, r.laneU(s2, P.lane));
        const dx = q.x - v.x, dz = q.z - v.z, lat = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw), lon = Math.max(1, -dx * Math.sin(v.yaw) - dz * Math.cos(v.yaw));
        const steer = Math.max(-1, Math.min(1, Math.atan(v.wb * 2 * lat / (lon * lon + lat * lat)) / v.lockAt(Math.abs(v.vLong))));
        if (P.hold) return step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: true, nitro: false });
        if (P.coast) return step(dt, { throttle: 0, brake: 0, steer, handbrake: false, nitro: false });
        const err = P.speed - v.vLong; return step(dt, { throttle: Math.max(0, Math.min(1, err * .25)), brake: err < -2 ? .3 : 0, steer, handbrake: false, nitro: false });
      };
    }
    Object.assign(window.__pilot, { lane, speed: 24, coast: false, hold: false });
  }, lane);
  const record = async on => both(p => p.evaluate(on => { window.__record = on; if (on) window.__frames.length = 0; }, on));
  const frames = async () => { const f = {}; for (const [n, p] of Object.entries(pages)) f[n] = await p.evaluate(() => window.__frames.slice()); return f; };

  for (const scenario of scenarios) {
    if (scenario === 'smooth') {
      results.smooth = {};
      const CONDITIONS = [
        { name: 'perfect link, both machines fast', net: 'none' },
        { name: `${arg('net', 'rtt150')} link, sender A at ${arg('slow-fps', 15)} fps and ${arg('cpu', 5)}x CPU throttle`, net: arg('net', 'rtt150'), slow: 'A', fps: +arg('slow-fps', 15), cpu: +arg('cpu', 5) },
        { name: `${arg('net', 'rtt150')} link, both machines fast`, net: arg('net', 'rtt150') },
      ];
      for (const c of CONDITIONS) {
        await conditions(c); await race(); await pilot(A, 0); await pilot(B, 1);
        await sleep(4000); await record(true); log('smooth', c.name); await sleep(+arg('seconds', 20) * 1000); await record(false);
        const f = await frames(); await writeFile(resolve(out, `frames-smooth-${Object.keys(results.smooth).length}.json`), JSON.stringify({ c, f }));
        results.smooth[c.name] = measure(f, 'A'); log(JSON.stringify(results.smooth[c.name]));
      }
    }
    if (scenario === 'collision') {
      results.collision = [];
      const nets = [['none', {}], [arg('net', 'rtt150'), { slow: 'B', fps: 15, cpu: 4 }]];
      let cases = 0;
      for (const [net, extra] of nets) for (const attacker of ['A', 'B']) for (const closing of [4, 12, 24]) {
        if (cases++ >= +arg('limit', 99)) break;
        await conditions({ net, ...extra }); await race();
        const victim = attacker === 'A' ? 'B' : 'A', av = pages[attacker], vv = pages[victim];
        await pilot(A, 0); await pilot(B, 0);
        // Set the scene without driving there: stop sending for 1.5 s (so the arena accepts a jump), put the victim cruising and the
        // attacker `closing` m/s faster, four seconds behind it on the same lane, then let both coast into each other.
        const gap = closing * 4 + 7;
        await both(p => p.evaluate(() => { const mp = __multiplayer; window.__send = mp.stateSender.send; mp.stateSender.send = () => {}; window.__pilot.hold = true; }));
        await sleep(1500);
        const start = 300 + Math.floor(Math.random() * 200);
        await vv.evaluate(({ s, v0 }) => { const v = __vehicle(); v.reset(s, __sim.route.laneU(s, 0), v0); __multiplayer.stateSender.discontinuity(); window.__pilot.hold = false; window.__pilot.coast = true; }, { s: start + gap, v0: 18 });
        await av.evaluate(({ s, v0 }) => { const v = __vehicle(); v.reset(s, __sim.route.laneU(s, 0), v0); __multiplayer.stateSender.discontinuity(); window.__pilot.hold = false; window.__pilot.coast = true; }, { s: start, v0: 18 + closing });
        await record(true);
        await both(p => p.evaluate(() => { __multiplayer.stateSender.send = window.__send; }));
        let contacted = false; const until = Date.now() + 25000;
        while (Date.now() < until && !contacted) {
          if (flag('trace')) log('trace', JSON.stringify(await av.evaluate(() => { const mp = __multiplayer, v = __vehicle(), peer = [...mp.peers.values()][0], t = peer?.timeline, now = performance.now(), pose = t?.predict(now); return { dist: pose && +Math.hypot(pose.x - v.x, pose.z - v.z).toFixed(1), v: +v.vLong.toFixed(1), pv: pose && +pose.vLong.toFixed(1), peerAge: peer && Math.round(now - peer.at), stale: pose?.stale, contacts: (mp.lastContacts || []).length }; })));
          contacted = (await both(p => p.evaluate(() => window.__frames.some(f => f.hits.length)))).some(Boolean);
          await sleep(100);
        }
        await sleep(3000); await record(false);
        const f = await frames();
        results.collision.push({ net, slow: extra.slow || null, attacker, closing, contacted, ...collisionSummary(f, attacker, victim, closing) }); log('collision', JSON.stringify(results.collision.at(-1)));
        await both(p => p.evaluate(() => { window.__pilot.coast = false; window.__pilot.speed = 18; window.__pilot.hold = false; }));
      }
    }
  }
  if (scenarios.includes('contact')) {
    // Frame-rate independent wiring check of the production contact path: the attacker is put 4.3 m behind the other car at
    // closing speed and ONE physics step is run, so the attacker detects the hit locally; the other client must then receive the
    // arena's relay and apply the matching impulse to its own car, even though it saw nothing arrive. Both directions, each net.
    results.contact = [];
    let contactCases = 0;
    for (const net of arg('contact-nets', [...new Set(['none', arg('net', 'rtt150')])].join(',')).split(',')) for (const attacker of ['A', 'B']) for (const closing of [6, 16]) {
      if (contactCases++ >= +arg('contact-limit', 99)) break;
      await conditions({ net }); await race(); await pilot(A, 0); await pilot(B, 1);
      const victim = attacker === 'A' ? 'B' : 'A', av = pages[attacker], vv = pages[victim];
      await both(p => p.evaluate(() => { window.__pilot.hold = true; }));
      await sleep(1500);
      for (let i = 0; i < 150; i++) { const v = await both(p => p.evaluate(() => Math.abs(__vehicle().vLong))); if (v.every(x => x < .2)) break; await sleep(200); } // both parked: the victim is at rest
      await vv.evaluate(() => { const mp = __multiplayer; window.__contactLog = []; mp.hooks.__contact ||= mp.hooks.contact; const v = __vehicle(); mp.hooks.contact = e => { const before = v.vLong; mp.hooks.__contact(e); window.__contactLog.push({ dv: v.vLong - before, from: e.from }); }; window.__vBefore = v.vLong; });
      // The other car must have been announced (a parked car sends once, then nothing). Say what both sides see if it never is.
      const announced = await av.waitForFunction(() => __multiplayer.peers.size > 0, null, { timeout: 15000 }).then(() => true, () => false);
      if (!announced) { const diag = p => p.evaluate(() => ({ peers: __multiplayer.peers.size, status: __multiplayer.lobby.status, started: __multiplayer.startedRace === __multiplayer.lobby.raceId, sent: __multiplayer.stateSender.last && { x: __multiplayer.stateSender.last.x, at: __multiplayer.stateSender.lastAt }, now: performance.now(), pending: __multiplayer.stateSender.pending.length, connected: __multiplayer.connected, batching: __multiplayer.stateBatching, gstate: __sim.G.state, hold: window.__pilot.hold })); log('NOT ANNOUNCED', JSON.stringify({ attacker: await diag(av), victim: await diag(vv) })); }
      await av.waitForFunction(() => [...__multiplayer.peers.values()].every(p => Math.abs(p.state.vLong) < .1 && Math.abs(p.state.vLat) < .1), null, { timeout: 60000 }).catch(() => {}); // the victim is parked as far as this side knows
      const out1 = await av.evaluate(async ({ closing }) => {
        const mp = __multiplayer, v = __vehicle(), peer = [...mp.peers.values()][0], other = __onlineCars()[0]; if (!peer) return { error: 'no peer' };
        // Placed on the route (reset keeps s/u/yaw consistent; setting x/z alone trips the route containment) 0.15 m inside the other car.
        const dir = mp.lobby.event.dir || 1, d = v.halfL * 2 - .15;
        v.reset(other.s - dir * d, peer.state.u, closing); window.__pilot.hold = false; window.__pilot.coast = true;
        const probe = () => { const pose = peer.timeline?.predict(performance.now()); return { pose: pose && { x: +pose.x.toFixed(2), z: +pose.z.toFixed(2), vLong: +pose.vLong.toFixed(2), stale: pose.stale, parked: pose.parked }, me: { x: +v.x.toFixed(2), z: +v.z.toFixed(2) }, drawn: { x: +other.x.toFixed(2), z: +other.z.toFixed(2) }, peerState: { x: +peer.state.x.toFixed(2), z: +peer.state.z.toFixed(2), vLong: peer.state.vLong }, member: mp.lobby.players.find(p => p.id !== mp.id), gstate: __sim.G.state, recoveryUntil: peer.state.recoveryUntil, now: mp.now() }; };
        window.__probe = probe();
        const before = v.vLong; mp.lastContacts = []; __sim.step(1, 1 / 60);
        return { probe: window.__probe && { ...window.__probe, member: { loaded: window.__probe.member?.loaded, connected: window.__probe.member?.connected, dnf: window.__probe.member?.dnf, finish: window.__probe.member?.finish } }, gap: d, before, after: v.vLong, dv: v.vLong - before, hits: (mp.lastContacts || []).map(h => ({ closing: +h.closing.toFixed(2), impulse: +h.impulse.toFixed(2) })) };
      }, { closing });
      await sleep(2500);
      const got = await vv.evaluate(() => window.__contactLog);
      const row = { net, attacker, closing, attackerSide: out1, victimReports: got, victimDv: got[0]?.dv ?? 0, want: closing / 2 };
      results.contact.push(row); log('contact', JSON.stringify(row));
      await both(p => p.evaluate(() => { window.__pilot.coast = false; window.__pilot.hold = false; window.__pilot.speed = 18; }));
    }
  }
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ base, tree, results, errors }, null, 1));
  log('done', JSON.stringify(errors));
} catch (error) {
  log('FAILED', error.message.split('\n')[0]);
  for (const [n, p] of Object.entries(pages)) { await p.screenshot({ path: resolve(out, `failure-${n}.png`) }).catch(() => {}); log(n, await p.evaluate(() => JSON.stringify({ state: window.__sim?.G.state, connected: __multiplayer?.connected, lobby: __multiplayer?.lobby && { status: __multiplayer.lobby.status, players: __multiplayer.lobby.players.map(x => ({ n: x.name, loaded: x.loaded, ready: x.ready })) }, worldReady: __multiplayer?.worldReady, status: document.querySelector('#mp-status')?.textContent })).catch(e => 'eval failed ' + e.message)); }
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ base, tree, results, errors, failure: error.message }, null, 1)).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

function pct(xs, p) { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function round(n, d = 3) { return Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n; }
// Velocity of the car in each client's own frames, before and after the contact; how many frames reported a hit.
function collisionSummary(frames, attacker, victim, closing) {
  const own = n => frames[n].filter(f => Number.isFinite(f.v)), first = n => own(n).findIndex(f => f.hits.length);
  const row = n => {
    const f = own(n), i = first(n); if (i < 0) return { hit: false };
    const before = f.slice(Math.max(0, i - 6), Math.max(1, i - 1)).reduce((a, x, _, l) => a + x.v / l.length, 0), t = f[i].wall;
    const late = f.filter(x => x.wall > t + 500 && x.wall < t + 1500), after = late.reduce((a, x) => a + x.v / late.length, 0);
    return { hit: true, vBefore: round(before, 2), vAfter: round(after, 2), dv: round(after - before, 2), hitFrames: f.filter(x => x.hits.length).length, firstHitWall: t, impulse: round(f[i].hits[0].impulse, 2) };
  };
  const a = row(attacker), v = row(victim);
  return { attacker: a, victim: v, wantAttackerDv: -closing / 2, wantVictimDv: closing / 2, firstHitSkewMs: a.hit && v.hit ? v.firstHitWall - a.firstHitWall : null };
}
// What B drew of A, against where A really was. Both pages stamp frames with Date.now (same machine, same clock).
function measure(frames, senderName) {
  const receiverName = senderName === 'A' ? 'B' : 'A', truth = frames[senderName].filter(f => Number.isFinite(f.x)), seen = frames[receiverName].filter(f => f.remote && Number.isFinite(f.remote.x));
  const at = t => { let lo = 0, hi = truth.length - 1; if (t <= truth[0].wall) return truth[0]; if (t >= truth[hi].wall) return truth[hi]; while (hi - lo > 1) { const m = lo + hi >> 1; truth[m].wall <= t ? lo = m : hi = m; } const a = truth[lo], b = truth[hi], k = (t - a.wall) / (b.wall - a.wall); return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; };
  const rows = seen.filter(f => f.remote.visible).map(f => ({ t: f.wall, x: f.remote.x, z: f.remote.z })), t0 = rows[0]?.t ?? 0;
  const err = rows.map(r => Math.hypot(r.x - at(r.t).x, r.z - at(r.t).z));
  let best = { lag: 0, rms: Infinity };
  for (let lag = 0; lag <= 900; lag += 10) { const rms = Math.sqrt(rows.reduce((a, r) => { const q = at(r.t - lag); return a + (r.x - q.x) ** 2 + (r.z - q.z) ** 2; }, 0) / rows.length); if (rms < best.rms) best = { lag, rms }; }
  // Invisible: frames where the other car should be on screen's world (race running) but is hidden or absent.
  const all = frames[receiverName].filter(f => f.state === 'race'), hidden = all.filter(f => !f.remote || !f.remote.visible);
  const frameMs = all.length > 1 ? (all.at(-1).wall - all[0].wall) / (all.length - 1) : 0;
  let longest = 0, run = 0; for (const f of all) { if (!f.remote || !f.remote.visible) run += frameMs; else { longest = Math.max(longest, run); run = 0; } } longest = Math.max(longest, run);
  const pathStats = points => {
    const v = [], t = []; for (let i = 1; i < points.length; i++) { const dt = (points[i].t - points[i - 1].t) / 1000; if (dt > 0) { v.push(Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) / dt); t.push(points[i].t); } }
    const dev = [], jerk = [];
    for (let i = 0; i < v.length; i++) { let sum = 0, n = 0; for (let j = i; j >= 0 && t[i] - t[j] <= 250; j--) { sum += v[j]; n++; } for (let j = i + 1; j < v.length && t[j] - t[i] <= 250; j++) { sum += v[j]; n++; } dev.push(Math.abs(v[i] - sum / n) / Math.max(sum / n, 1));
      if (i > 1) { const a1 = (v[i] - v[i - 1]) / ((t[i] - t[i - 1]) / 1000), a0 = (v[i - 1] - v[i - 2]) / ((t[i - 1] - t[i - 2]) / 1000); jerk.push((a1 - a0) / ((t[i] - t[i - 1]) / 1000)); } }
    const rms = Math.sqrt(jerk.reduce((x, y) => x + y * y, 0) / jerk.length), snaps = [];
    for (let i = 1; i < points.length; i++) { const dt = (points[i].t - points[i - 1].t) / 1000, d = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z); if (d > 3 * pct(v, .5) * dt + 1) snaps.push({ t: points[i].t - t0, d }); }
    return { frames: v.length, speedDevP95: round(pct(dev, .95)), speedDevMax: round(Math.max(...dev)), jerkRms: round(rms, 1), jerkP99: round(pct(jerk.map(Math.abs), .99), 1), snaps: snaps.length, biggestSnapM: round(snaps.reduce((m, s) => Math.max(m, s.d), 0), 2) };
  };
  const truthRows = rows.map(r => { const q = at(r.t); return { t: r.t, x: q.x, z: q.z }; });
  return { sender: senderName, receiverFrames: rows.length, receiverFps: round(rows.length / ((rows.at(-1).t - rows[0].t) / 1000), 1), errMeanM: round(err.reduce((a, b) => a + b, 0) / err.length, 2), errP95M: round(pct(err, .95), 2), errMaxM: round(Math.max(...err), 2), effectiveLagMs: best.lag, noiseRmsM: round(best.rms), hiddenMs: Math.round(hidden.length * frameMs), longestHiddenMs: Math.round(longest), drawn: pathStats(rows), realCar: pathStats(truthRows) };
}
