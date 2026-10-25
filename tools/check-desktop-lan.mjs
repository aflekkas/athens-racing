// One browser-slot job, two installed desktop clients and actual race controls.
import assert from 'node:assert/strict';
import { createRecoveryWireLog, installRecoveryObserver, readRecoveryDiagnostic } from './desktop-lan-diagnostics.mjs';
import { closeOwnedApplication, finishDesktopCheck } from './desktop-test-cleanup.mjs';
import { _electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import http from 'node:http';
import { DESKTOP_SERVICE, MULTIPLAYER_PROTOCOL } from '../packages/contracts/desktop.mjs';
const temporary = await mkdtemp(resolve(process.env.DESKTOP_TEMP_ROOT || '/tmp', 'athens-desktop-lan.'));
const evidence = resolve(process.env.DESKTOP_EVIDENCE || '.scratch/desktop-check');
await mkdir(evidence, { recursive: true });
await mkdir(resolve(temporary, 'launch'));
const environment = { ...process.env };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete environment[key];
if (process.env.DESKTOP_EXECUTABLE) delete environment.ASR_GAME_ROOT;
const children = new Map();
const applications = [], errors = [], checks = [], wire = [], recoverySnapshots = [];
const recoveryWire = createRecoveryWireLog();
let failure, incompatible;
async function launch(name, port) {
  const application = await _electron.launch({ ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE, args: ['--mute-audio'], cwd: resolve(temporary, 'launch') } : { args: ['--mute-audio', 'apps/desktop/main.mjs'] }), env: { ...environment, ASR_DESKTOP_USER_DATA: resolve(temporary, name), ASR_DESKTOP_PORT: String(port) }, timeout: 60000 });
  applications.push(application); children.set(application, application.process());
  const page = await application.firstWindow();
  await application.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    for (const window of BrowserWindow.getAllWindows()) {
      window.show(); window.focus();
      const contents = window.webContents;
      contents.setAudioMuted(true);
      contents.on('dom-ready', () => contents.setAudioMuted(true));
    }
  }); page.setDefaultTimeout(60000);
  page.on('websocket', socket => { for (const [event, direction] of [['framesent', 'sent'], ['framereceived', 'received']]) socket.on(event, frame => { try { const packet = JSON.parse(String(frame.payload)); recoveryWire.observe(name,direction,packet); if (['state', 'states', 'snapshot', 'error', 'recovered'].includes(packet.type)) { const record = { client: name, direction, type: packet.type, keys: Object.keys(packet), data: JSON.stringify(packet).slice(0, 1600) }; wire.push(record); if (wire.length > 24) wire.shift(); } } catch {} }); });
  page.on('pageerror', error => { errors.push(name + ': ' + error.message); console.log(name, 'renderer error:', error.message); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log(name, 'navigated:', frame.url()); });
  page.on('console', message => { if (message.type() === 'error') console.log(name, 'console:', message.text()); });
  await page.waitForFunction(() => !!window.athensDesktop && document.body.classList.contains('loaded'), null, { timeout: 90000 });
  return { application, page };
}
try {
  const host = await launch('host', 17843), guest = await launch('guest', 17844);
  console.log('LAN native clients launched');
  // Failed preflight stays on the join screen and preserves solo mode.
  incompatible = http.createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ service: DESKTOP_SERVICE, protocol: MULTIPLAYER_PROTOCOL + 1, release: 'different' })); });
  await new Promise(resolve => incompatible.listen(0, '127.0.0.1', resolve));
  await guest.page.locator('[data-act=desktopLan]').click();
  for (const [address, expected] of [['127.0.0.1:' + incompatible.address().port, 'incompatible'], ['127.0.0.1:9', 'Could not reach']]) {
    await guest.page.locator('[data-desktop-address]').fill(address);
    await guest.page.locator('[data-act=desktopJoin]').click();
    await guest.page.waitForFunction(expected => document.body.innerText.includes(expected), expected);
    assert.equal((await guest.page.evaluate(() => window.athensDesktop.session())).mode, 'solo');
    checks.push({ rejectedAddress: address, reason: expected });
  }
  await guest.page.goto(new URL(guest.page.url()).origin);
  await host.page.locator('[data-act=desktopLan]').click();
  await host.page.locator('[data-act=desktopHost]').click();
  await host.page.locator('[data-act=mpCreate]').waitFor({ state: 'visible', timeout: 120000 });
  const session = await host.page.evaluate(() => window.athensDesktop.session());
  assert.equal(session.mode, 'host');
  // Join explicitly over the listener a real second computer would use.
  const address = session.addresses[0] || '127.0.0.1:' + session.port;
  await guest.page.locator('[data-act=desktopLan]').click();
  await guest.page.locator('[data-desktop-address]').fill(address);
  await guest.page.locator('[data-act=desktopJoin]').click();
  await guest.page.waitForFunction(async () => (await window.athensDesktop.session()).mode === 'join', null, { timeout: 60000 });
  const megara = host.page.locator('[data-act=mpTrack][data-map=megara-club]');
  if (await megara.count()) await megara.click();
  await host.page.locator('[data-act=mpCreate]').click();
  await host.page.waitForFunction(() => !!window.__multiplayer?.lobby, null, { timeout: 180000 });
  const code = await host.page.evaluate(() => window.__multiplayer.lobby.code);
  await guest.page.locator('[data-act=mpJoinLobby][data-code="' + code + '"]').click({ timeout: 120000 });
  await Promise.all([host, guest].map(({ page }) => page.waitForFunction(() => window.__multiplayer?.worldReady && window.__multiplayer.lobby?.players.length === 2, null, { timeout: 240000 })));
  for (const { page } of [host, guest]) {
    await page.locator('[data-desktop-room-address]').waitFor({ state: 'visible' });
    await page.locator('[data-act=mpCopy]').click();
    await page.waitForFunction(() => { const field = document.querySelector('[data-desktop-share]'); return field && field.selectionStart === 0 && field.selectionEnd === field.value.length; });
    const text = await page.locator('[data-desktop-share]').inputValue();
    assert.ok(text.includes(address) && text.includes(code), 'room share must retain upstream LAN address and lobby code');
    assert.doesNotMatch(text, /127\.0\.0\.1|localhost|\?lobby/);
  }
  checks.push({ hostAndGuestRoomShare: { address, code, manualTextSelected: true } });
  await host.page.screenshot({ path: resolve(evidence, 'lan-two-drivers.jpg'), type: 'jpeg', quality: 85 });
  for (const { page } of [host, guest]) await page.locator('[data-act=mpReady]').click();
  await host.page.locator('[data-act=mpStart]').click();
  await Promise.all([host, guest].map(({ page }) => page.waitForFunction(() => window.__multiplayer?.lobby?.status === 'race' && window.__game?.state === 'race', null, { timeout: 30000 })));
  for (const { page } of [host, guest]) await page.waitForFunction(() => !document.body.classList.contains('menu-backdrop') && getComputedStyle(document.getElementById('c')).visibility === 'visible');
  const races = await Promise.all([host, guest].map(({ page }) => page.evaluate(() => ({ id: window.__multiplayer.lobby.raceId, start: window.__multiplayer.lobby.startAt }))));
  console.log('LAN synchronized race', JSON.stringify(races));
  assert.deepEqual(races[0], races[1]); checks.push({ race: races[0], code, hostAddress: address });
  // Observe before driving/screenshot; the manual success wrapper below stays unchanged.
  await host.page.evaluate(installRecoveryObserver);
  const recoverySnapshot = async label => {
    const state=await host.page.evaluate(readRecoveryDiagnostic,label).catch(error=>({label,error:error.message}));
    state.latestWirePoses=JSON.parse(JSON.stringify(recoveryWire.latestPoses));
    recoverySnapshots.push(state); console.log('LAN recovery diagnostic',JSON.stringify(state));
  };
  await recoverySnapshot('before throttle');
  const hostId = await host.page.evaluate(() => window.__multiplayer.id);
  const before = await host.page.evaluate(() => window.__multiplayer.me.gridPose);
  assert.ok(Number.isFinite(before.x) && Number.isFinite(before.z), 'host authenticated starting pose required');
  await host.page.bringToFront(); await host.page.keyboard.down('w'); await host.page.waitForTimeout(3500); await host.page.keyboard.up('w');
  console.log('LAN host throttle applied; observing accepted remote motion');
  await guest.page.waitForFunction(({ id, before }) => { const p = window.__multiplayer?.peers.get(id)?.state; return p && Math.hypot(p.x - before.x, p.z - before.z) > .1; }, { id: hostId, before });
  const after = await guest.page.evaluate(id => window.__multiplayer.peers.get(id).state, hostId);
  checks.push({ remoteMovementMetres: Math.hypot(after.x - before.x, after.z - before.z) });
  await host.page.screenshot({ path: resolve(evidence, 'lan-race.jpg'), type: 'jpeg', quality: 85 });
  await host.page.evaluate(() => {
    const multiplayer = window.__multiplayer, recover = multiplayer.recover.bind(multiplayer);
    window.__desktopRecovered = null;
    multiplayer.recover = async options => { const result = await recover(options); window.__desktopRecovered = result; return result; };
  });
  await recoverySnapshot('before R');
  await host.page.keyboard.press('r');
  await recoverySnapshot('after R');
  try { await host.page.waitForFunction(() => !!window.__desktopRecovered && !window.__game.towing, null, { timeout: 30000 }); }
  catch(error) { await recoverySnapshot('timeout'); throw error; }
  await recoverySnapshot('completed');
  const recovered = await host.page.evaluate(() => window.__desktopRecovered);
  assert.ok(Number.isFinite(recovered.x) && Number.isFinite(recovered.z) && Number.isFinite(recovered.until));
  checks.push({ authoritativeLanTow: recovered });
  const guestId = await guest.page.evaluate(() => window.__multiplayer.id);
  await guest.page.evaluate(() => window.__multiplayer.ws.close());
  await guest.page.waitForFunction(id => window.__multiplayer?.connected && window.__multiplayer.id === id && window.__multiplayer.resumeCount > 0, guestId, { timeout: 30000 });
  checks.push({ reconnectRetainedDriver: guestId });
  const hostShutdown = await closeOwnedApplication(host.application, children.get(host.application));
  if (hostShutdown.errors.length) throw new AggregateError(hostShutdown.errors, 'Host shutdown failed');
  applications.splice(applications.indexOf(host.application), 1);
  await guest.page.waitForFunction(() => !window.__multiplayer?.connected, null, { timeout: 30000 });
  await guest.page.goto(new URL(guest.page.url()).origin);
  await guest.page.locator('[data-act=desktopSolo]').click();
  await guest.page.waitForFunction(async () => (await window.athensDesktop.session()).mode === 'solo' && (window.__flow?.menu || window.__bootMenu)?.screen === 'mode');
  checks.push({ hostShutdownAndReturnToSolo: true });
  assert.deepEqual(errors, []);
} catch (error) { failure = error; for (const [index, application] of applications.entries()) { const page = await application.firstWindow().catch(() => null); if (page && !page.isClosed()) { console.log('LAN failure client', index, await page.evaluate(() => ({ url: location.href, game: window.__game?.state, multiplayer: !!window.__multiplayer, network: window.__multiplayer ? { id: window.__multiplayer.id, connected: window.__multiplayer.connected, ready: window.__multiplayer.worldReady, me: window.__multiplayer.me, peers: [...window.__multiplayer.peers] } : null, text: document.body.innerText.slice(-1500) })).catch(() => null)); await page.screenshot({ path: resolve(evidence, 'lan-failure-' + index + '.jpg'), type: 'jpeg', quality: 80 }).catch(() => {}); } } }
finally {
  await finishDesktopCheck({ temporary, failure,
    applications: applications.reverse().map(application => ({ application, child: children.get(application) })),
    closeResources: async () => { if (incompatible) await new Promise(resolve => incompatible.close(resolve)); },
    writeReceipt: status => writeFile(resolve(evidence, 'lan-results.json'), JSON.stringify({ ...status, checks, errors, wire, recoveryWire: recoveryWire.records, recoverySnapshots }, null, 2))
  });
}
console.log('PASS: two desktop clients host/join, ready/start, synchronized race, remote movement, reconnect, host shutdown and solo recovery.');
