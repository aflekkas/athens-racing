// Lobby flows with two REAL browser clients on the real menus (title -> MULTIPLAYER -> host / join by code / join from the list /
// change car / track switch), against a real server with stub Google sign-in or staging (--target, SMOKE_TOKEN).
//   tools/browser-slot.sh node tools/mp-lobby-browser.mjs --out=DIR [--tree=ROOT] [--net=rtt150] [--track=megara] [--target=https://staging.athensracing.com]
// Every step records what each player sees (menu screen, whether the lobby panel is up, lobby status, game state, who is in the room
// and in which car) and flags what should never happen: a joined player with no lobby screen, a waiting lobby whose car cannot be
// changed, a car change the other player does not see, a player stuck loading, a double click that joins twice.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startRig, sleep, log } from './mp-browser-kit.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const tree = resolve(arg('tree', new URL('..', import.meta.url).pathname)), out = resolve(arg('out', '.scratch/mp-lobby'));
const rig = await startRig({ tree, out, target: arg('target', ''), net: arg('net', 'rtt150'), url: '/?quality=low&fixedres=1&debug=1', noDraw: !process.argv.includes('--gl'), stepTimeout: +arg('step-timeout', 240000) });
const { pages: { A, B }, both, errors } = rig, flows = [], problems = [];
const view = p => p.evaluate(() => { const mp = window.__multiplayer, l = mp?.lobby, menu = window.__menu; if (!mp) return { screen: menu?.screen, runtime: false }; return { screen: menu?.screen, panelHidden: mp.panel.hidden, connected: mp.connected, code: l?.code ?? null, status: l?.status ?? null, game: window.__sim?.G.state ?? null, mapId: l?.mapId ?? null, loadedMap: mp.mapId, worldReady: mp.worldReady, canChangeCar: mp.canChangeCar, me: mp.me && { car: mp.me.car, loaded: mp.me.loaded, ready: mp.me.ready }, players: l?.players.map(x => ({ name: x.name, car: x.car, loaded: x.loaded })) ?? [], text: document.querySelector('#mp-status')?.textContent }; });
const act = (p, name, data = {}) => p.evaluate(({ name, data }) => { const el = [...document.querySelectorAll(`[data-act="${name}"]`)].find(e => Object.entries(data).every(([k, v]) => e.dataset[k] === v)); if (!el) return false; __menu.activate(el); return true; }, { name, data });
const until = (p, fn, arg, timeout = 120000) => p.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const flag = (flow, what, detail) => { problems.push({ flow, what, detail }); log('PROBLEM', flow, what, JSON.stringify(detail)); };
async function step(flow, name, run) { const t = Date.now(); const result = await run(); const rec = { flow, step: name, ms: Date.now() - t, A: await view(A), B: await view(B), ...result }; flows.push(rec); log(flow, name, `${rec.ms} ms`, JSON.stringify({ A: [rec.A.screen, rec.A.status, rec.A.game], B: [rec.B.screen, rec.B.status, rec.B.game] })); return rec; }

try {
  await both(p => p.waitForFunction(() => window.__menu?.screen === 'title', null, { timeout: 300000 }));
  log('both clients at the title', rig.base);

  // ---- 1. host creates a public lobby through the real screens
  // The title is the lightweight menu: the game runtime (and the online connection) loads when MULTIPLAYER is first opened.
  await step('host', 'open MULTIPLAYER on the title', async () => { const clicked = await act(A, 'multiplayer'); const ok = await until(A, () => window.__multiplayer?.connected && window.__menu.screen === 'mp', null, 900000); return { clicked, ok }; });
  await step('host', 'open HOST A LOBBY', async () => ({ clicked: await act(A, 'mpHost') }));
  if (arg('track', '')) await step('host', `pick ${arg('track')}`, async () => ({ clicked: await act(A, 'mpTrack', { map: arg('track') }) }));
  const created = await step('host', 'CREATE LOBBY', async () => { const clicked = await act(A, 'mpCreate'); const ok = await until(A, () => __multiplayer.lobby?.status === 'waiting' && __menu.screen === 'mpLobby'); return { clicked, ok }; });
  if (!created.ok) flag('host', 'the host never reaches the lobby screen', created.A);
  const code = created.A.code; log('lobby', code, created.A.mapId);

  // ---- 2. a friend joins by code
  await step('join by code', 'open MULTIPLAYER on the title', async () => { const clicked = await act(B, 'multiplayer'); const ok = await until(B, () => window.__multiplayer?.connected && window.__menu.screen === 'mp', null, 900000); return { clicked, ok }; });
  await step('join by code', 'type the code', async () => { await B.evaluate(code => { const input = document.querySelector('[data-field=code]'); input.value = code; input.dispatchEvent(new Event('input', { bubbles: true })); }, code); return {}; });
  const joined = await step('join by code', 'JOIN LOBBY', async () => {
    const clicked = await act(B, 'mpJoinCode'), second = await act(B, 'mpJoinCode'); // an impatient second click
    const ok = await until(B, () => __multiplayer.lobby?.players.length === 2 && __menu.screen === 'mpLobby' && __multiplayer.worldReady && __multiplayer.me?.loaded, null, 400000);
    return { clicked, second, ok };
  });
  if (!joined.ok) flag('join by code', 'the friend never reaches a loaded lobby screen', joined.B);
  if (joined.B.players.length !== 2 || joined.A.players.length !== 2) flag('join by code', 'the two screens disagree about who is in the room', { A: joined.A.players, B: joined.B.players });
  if (joined.B.panelHidden || joined.B.game === 'race') flag('join by code', 'the friend is in the game without the lobby', joined.B);
  if (!joined.B.canChangeCar) flag('join by code', 'the friend cannot change car in a waiting lobby', joined.B);

  // ---- 3. the friend changes car in the lobby; the host must see it
  const other = await B.evaluate(() => __multiplayer.allowedCars.find(id => id !== __multiplayer.me.car));
  const changed = await step('change car', `pick ${other}`, async () => {
    const clicked = await act(B, 'mpCar'); await sleep(800);
    const picked = await B.evaluate(id => { const d = __menu.data; if (!d?.onPick) return 'no picker'; return d.onPick(id); }, other);
    const ok = await until(A, id => __multiplayer.lobby.players.some(p => p.car === id), other, 20000) && await until(B, id => __multiplayer.me.car === id, other, 20000);
    return { clicked, picked, ok, other };
  });
  if (!changed.ok) flag('change car', 'the car change is not what both screens show', { A: changed.A.players, B: changed.B.players, picked: changed.picked });

  if (!process.argv.includes('--skip-list')) {
  // ---- 4. the friend leaves and joins again from the open-lobby list
  await step('join from the list', 'LEAVE LOBBY', async () => { const clicked = await act(B, 'mpLeave'); const ok = await until(B, () => !__multiplayer.lobby); return { clicked, ok }; });
  await step('join from the list', 'back to the browser', async () => { const have = await B.evaluate(() => __menu.screen); if (!['mp'].includes(have)) await act(B, 'multiplayer'); await sleep(1500); const listed = await until(B, code => !!document.querySelector(`[data-act=mpJoinLobby][data-code="${code}"]`), code, 20000); return { listed }; });
  const listJoin = await step('join from the list', 'JOIN on the lobby row', async () => { const clicked = await act(B, 'mpJoinLobby', { code }); const ok = await until(B, () => __multiplayer.lobby?.players.length === 2 && __menu.screen === 'mpLobby' && __multiplayer.worldReady && __multiplayer.me?.loaded); return { clicked, ok }; });
  if (!listJoin.ok) flag('join from the list', 'the friend never reaches a loaded lobby screen', listJoin.B);
  if (listJoin.B.me?.car !== changed.other && listJoin.B.me) log('note', 'after rejoining the friend is in', listJoin.B.me.car, '(the car picked in the lobby was', changed.other + ')');

  }

  // ---- 5. both ready, host starts: both must land on the grid with the right car
  await step('start', 'both ready, host starts', async () => { await act(B, 'mpReady'); await act(A, 'mpReady'); await until(A, () => __multiplayer.lobby.players.every(p => p.ready && p.loaded)); const enabled = await until(A, () => { const b = document.querySelector('[data-act=mpStart]'); return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; }, null, 60000); const btn = await A.evaluate(() => { const e = document.querySelector('[data-act=mpStart]'); return e ? { disabled: e.disabled || e.getAttribute('aria-disabled') } : null; }); const startClicked = await act(A, 'mpStart'); const ok = await until(A, () => window.__sim.G.state === 'onlineCountdown' || window.__sim.G.state === 'race', null, 60000) && await until(B, () => window.__sim.G.state === 'onlineCountdown' || window.__sim.G.state === 'race', null, 60000); return { ok, btn, startClicked, startEnabled: enabled }; });
  const last = flows.at(-1); if (!last.ok) flag('start', 'a player is not on the grid after the host starts', { A: last.A, B: last.B });

  await writeFile(resolve(out, 'report.json'), JSON.stringify({ base: rig.base, code, flows, problems, errors, ws: rig.wsLog.slice(-120) }, null, 1));
  log('done', JSON.stringify({ problems: problems.length, pageErrors: errors }));
} catch (error) {
  log('FAILED', error.message.split('\n')[0]);
  for (const [n, p] of Object.entries(rig.pages)) { await p.screenshot({ path: resolve(out, `failure-${n}.png`) }).catch(() => {}); log(n, JSON.stringify(await view(p).catch(e => 'view failed ' + e.message))); }
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ base: rig.base, flows, problems, errors, failure: error.message }, null, 1)).catch(() => {});
  process.exitCode = 1;
} finally { await rig.close(); }
