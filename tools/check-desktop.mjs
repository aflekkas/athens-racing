// Run via tools/browser-slot.sh after desktop:prepare. Uses the actual Electron shell.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { remainingEntryTime, waitForRecordedEngine } from './desktop-audio-readiness.mjs';

const evidence = resolve(process.env.DESKTOP_EVIDENCE || '.scratch/desktop-check');
const temporary = await mkdtemp(resolve(process.env.DESKTOP_TEMP_ROOT || '/tmp', 'athens-desktop-check.'));
await mkdir(evidence, { recursive: true });
await mkdir(resolve(temporary, 'launch'));
const environment = { ...process.env, ASR_DESKTOP_USER_DATA: resolve(temporary, 'profile'), ASR_DESKTOP_PORT: process.env.DESKTOP_TEST_PORT || '17843' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete environment[key];
if (process.env.DESKTOP_EXECUTABLE) delete environment.ASR_GAME_ROOT;
const launchBegan = Date.now();
const metrics = {};
const requests = [], errors = [], brokenResponses = [], consoleMessages = [], failedRequests = [], results = [];
let application, page, primary;
// Electron output remains muted; assert the actual WebAudio signal before its
// device sink so silence cannot hide an unwired free-roam entry again.
async function unlockFreeAudio(entryDeadline = Date.now() + 240000, label = 'free entry') {
  const began = Date.now();
  let phase = 'context unlock';
  assert.ok(await page.evaluate(() => window.__athens?.audio === window.__bootAudio && !!window.__athens?.audio), 'free roam must wire the shared real Audio graph');
  await page.keyboard.press('w');
  try {
    await page.waitForFunction(() => {
      const view = window.__athens, audio = view?.audio;
      return audio?.ctx?.state === 'running' && audio.engineSpec?.id === view.player.spec.id && !!audio.engineVoice;
    }, null, { timeout: remainingEntryTime(entryDeadline, 30000, 5000) });
    phase = 'recording preparation';
    const readiness = await waitForRecordedEngine(page, { timeoutMs: remainingEntryTime(entryDeadline, 120000, 5000), expectedCar: 'aventador_svj' });
    readiness.label = label;
    readiness.entryRemainingMs = entryDeadline - Date.now();
    (metrics.freeRoamRecordingReadiness ||= []).push(readiness);
    console.log('Native recorded-engine preparation:', JSON.stringify(readiness));
  } catch (error) {
    // Preserve the failing condition before teardown. A combined timeout cannot
    // distinguish a host output-device problem from a missing engine bank.
    const state = await page.evaluate(() => {
      const view = window.__athens, audio = view?.audio, ctx = audio?.ctx;
      let health = null, healthError = null;
      try { health = audio?.health?.(); } catch (error) { healthError = String(error); }
      return { hidden: document.hidden, visibility: document.visibilityState, focused: document.hasFocus(),
        userActivation: navigator.userActivation && { active: navigator.userActivation.isActive, everActive: navigator.userActivation.hasBeenActive },
        sharedGraph: !!audio && audio === window.__bootAudio, started: audio?.started ?? false,
        context: ctx?.state ?? null, currentTime: ctx?.currentTime ?? null, sampleRate: ctx?.sampleRate ?? null,
        selectedCar: audio?.engineSpec?.id ?? null, playerCar: view?.player?.spec?.id ?? null,
        recording: audio?.recordingState ?? null, engineVoice: !!audio?.engineVoice, recordedBank: !!audio?.recordedBank,
        health, healthError, paused: view?.paused ?? null, frames: view?.stats?.frames ?? null };
    }).catch(error => ({ diagnosticError: String(error) }));
    Object.assign(state, { label, phase, elapsedMs: Date.now() - began, recordingPreparation: error.readiness || null });
    (metrics.freeRoamAudioFailures ||= []).push(state);
    console.error('Native free-roam audio readiness failure:', JSON.stringify(state));
    throw error;
  }
}
async function recordFreeAudio(label) {
  const snapshot = await page.evaluate(async () => {
    const view = window.__athens;
    if (!view?.audio || !view.player?.veh) throw Error('Free-roam PCM check requires an active free-roam Audio graph');
    const audio = view.audio;
    audio.busLevels(); // Install real analyser taps; allow audio blocks to fill them.
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      samples.push({ buses: audio.busLevels(), output: audio.levels(), speed: view.player.veh.kmh, rpm: view.player.veh.rpm });
    }
    return { context: audio.ctx.state, recording: audio.recordingState, selectedCar: audio.engineSpec.id, playerCar: view.player.spec.id, health: audio.health(), samples };
  });
  snapshot.label = label;
  (metrics.freeRoamAudio ||= []).push(snapshot);
  console.log('Native free-roam audio signal:', JSON.stringify(snapshot));
  assert.equal(snapshot.context, 'running', label + ': audio context runs during actual driving');
  assert.equal(snapshot.recording, 'recorded', label + ': installed selected-car recording is ready');
  assert.equal(snapshot.selectedCar, snapshot.playerCar, label + ': audio follows the actual car');
  assert.equal(snapshot.playerCar, 'aventador_svj', label + ': requested recorded Aventador must be selected');
  assert.ok(snapshot.samples.some(sample => sample.speed > .1 && Number.isFinite(sample.buses?.eng) && sample.buses.eng > -80 && Number.isFinite(sample.output?.rms) && sample.output.rms > -80), label + ': moving car produces nonzero engine and master PCM despite device mute');
}
async function assertFreeAudioDisposed(label) {
  await page.waitForFunction(() => window.__athens?.audio?.ctx?.state === 'closed', null, { timeout: 10000 });
  (metrics.freeRoamAudio ||= []).push({ label, context: await page.evaluate(() => window.__athens.audio.ctx.state) });
}
async function recordFreeAdmission(label, disposed = false) {
  const snapshot = await page.evaluate(dispose => {
    const view = window.__athens;
    if (dispose) view.dispose();
    let inventory, inventoryError = null;
    try { inventory = view.inventory(); } catch (error) { inventory = error.detail || {}; inventoryError = error.message; }
    const usage = {};
    for (const key of ['residentJSBytes','jsBytes','gpuBytes','heapBytes','sceneJSBytes','tileJSBytes','tileGPUBytes','regionalBytes','queryBytes','transientBytes','streamResidentBytes','decoderReservationBytes','roadQueryBytes','streamQueryReservationBytes']) if (typeof inventory[key] === 'number') usage[key] = inventory[key];
    usage.limits = inventory.limits || { jsBytes: inventory.resources?.jsBytes, gpuBytes: inventory.resources?.gpuBytes };
    const error = document.getElementById('err');
    return { usage, inventoryError, overlay: error && getComputedStyle(error).display !== 'none' ? error.textContent.trim() : '',
      gpuName: view.stats.gpuName, perfClass: view.stats.bootPerfClass, frames: view.stats.frames,
      rawHeapHighWater: view.stats.maxRawHeapBytes, retainedHighWater: view.stats.maxRetainedJSBytes,
      released: { tiles: view.stream.tiles.size, resident: view.stream.residentBytes, reserved: view.stream.reservedBytes, transient: view.stream.transientBytes, queryLease: view.stream.queryBytes, queryAllocation: view.roads.queryBytes } };
  }, disposed);
  snapshot.label = label;
  (metrics.freeRoamAdmission ||= []).push(snapshot);
  console.log('Native free-roam admission inventory:', JSON.stringify(snapshot));
  if (disposed) {
    for (const [key, value] of Object.entries(snapshot.released)) assert.equal(value, 0, label + ': released world counter ' + key);
    assert.equal(snapshot.usage.regionalBytes, 0, label + ': regional cache released');
  } else {
    assert.equal(snapshot.inventoryError, null, label + ': admission must succeed');
    assert.equal(snapshot.overlay, '', label + ': free roam must have no fatal error overlay');
    assert.ok(snapshot.usage.residentJSBytes <= snapshot.usage.limits.jsBytes, label + ': retained/reservation charges stay bounded');
    assert.ok(snapshot.usage.gpuBytes <= snapshot.usage.limits.gpuBytes, label + ': GPU charges stay bounded');
  }
  return snapshot;
}
try {
  application = await _electron.launch({
    ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE, args: ['--mute-audio'], cwd: resolve(temporary, 'launch') } : { args: ['--mute-audio', 'apps/desktop/main.mjs'] }),
    env: environment,
    timeout: 60000,
  });
  page = await application.firstWindow();
  await application.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    for (const window of BrowserWindow.getAllWindows()) {
      window.show(); window.focus();
      const contents = window.webContents;
      contents.setAudioMuted(true);
      contents.on('dom-ready', () => contents.setAudioMuted(true));
    }
  });
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['warning', 'warn', 'error'].includes(message.type())) { consoleMessages.push({ type: message.type(), text: message.text() }); console.log('Renderer:', message.text()); } });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) brokenResponses.push({ url: response.url(), status: response.status() }); });
  await page.waitForFunction(() => !!window.athensDesktop && document.body.classList.contains('loaded'), null, { timeout: 90000 });
  await page.waitForFunction(() => { const boot = document.getElementById('boot'); return document.documentElement.classList.contains('booted') && (!boot || getComputedStyle(boot).opacity === '0'); });
  metrics.coldLaunchToInteractiveTitleMs = Date.now() - launchBegan;
  metrics.runtime = await application.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch, packaged: process.defaultApp !== true, cwd: process.cwd(), resourcesPath: process.resourcesPath }));
  const origin = new URL(page.url()).origin;
  // Reload with listeners attached to cover every eager cold-page request too.
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('loaded'), null, { timeout: 90000 });
  assert.equal((await page.evaluate(() => window.athensDesktop.session())).mode, 'solo');
  await page.evaluate(() => localStorage.setItem('desktop-verification', 'retained'));
  await page.waitForFunction(() => { const boot = document.getElementById('boot'); return document.documentElement.classList.contains('booted') && (!boot || getComputedStyle(boot).opacity === '0'); });
  console.log('Native desktop title ready; selecting Solo through the UI.');
  await page.screenshot({ path: resolve(evidence, 'desktop-title.jpg'), type: 'jpeg', quality: 85 });
  await page.locator('[data-act=desktopSolo]').click();
  await page.waitForFunction(() => (window.__flow?.menu || window.__bootMenu)?.screen === 'mode');
  await page.locator('[data-act=quick]').click();
  await page.locator('[data-confirm-track]').waitFor({ state: 'visible' });
  for (let i = 0; i < 12 && await page.locator('[data-confirm-track]').getAttribute('data-map-id') !== 'megara-club'; i++) await page.keyboard.press('ArrowRight');

  const menuRouteBegan = Date.now();
  await page.locator('[data-confirm-track][data-map-id=megara-club]').click();
  await page.waitForFunction(() => { if (window.__loading?.failure) throw Error('Menu route loading failed: ' + JSON.stringify(window.__loading.failure)); return !!document.querySelector('[data-act=setupGo]'); }, null, { timeout: 180000 });
  await page.locator('[data-act=setupGo]').click({ timeout: 180000 });
  await page.locator('[data-act=carConfirm]').click({ timeout: 120000 });
  await page.waitForFunction(() => window.__game?.state === 'race' && window.__game.unifiedCompiled?.id === 'megara-club', null, { timeout: 180000 });
  metrics.firstMenuSelectionToRaceMs = Date.now() - menuRouteBegan;
  await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w');
  results.push({ menuRaceRoute: 'megara-club', menuFlow: 'Play Solo → Quick Race → Megara → Setup → Choose Car → Race' });
  await page.goto(origin);
  await page.locator('[data-act=desktopLan]').click();
  await page.waitForFunction(() => (window.__flow?.menu || window.__bootMenu)?.screen === 'desktopLan');
  await page.locator('[data-act=desktopHost]').click();
  await page.locator('[data-act=mpCreate]').waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForFunction(async () => (await window.athensDesktop.session()).mode === 'host');
  assert.equal((await page.evaluate(() => window.athensDesktop.session())).mode, 'host');
  const local = await page.evaluate(() => window.athensDesktop.solo());
  assert.equal(local.mode, 'solo');
  const routeIds = await page.evaluate(async () => (await (await fetch('/api/routes')).json()).routes.map(route => route.id));
  assert.ok(routeIds.length >= 6, 'all released race destinations must be included');
  for (const map of routeIds) {
    const began = Date.now(), initialRequests = requests.length;
    console.log('Checking offline route:', map);
    await page.goto(origin + '/?routes=1&route=' + map + '&quick&simhook&guest=1');
    await page.waitForFunction(() => {
      if (window.__loading?.failure) throw Error('Route loading failed: ' + JSON.stringify(window.__loading.failure));
      return window.__game?.state === 'race' && !!window.__sim?.player;
    }, null, { timeout: 240000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('desktop-verification')), 'retained');
    const before = await page.evaluate(() => ({ x: window.__sim.player.veh.x, z: window.__sim.player.veh.z }));
    await page.keyboard.down('w'); await page.waitForTimeout(2500); await page.keyboard.up('w');
    const after = await page.evaluate(() => ({ x: window.__sim.player.veh.x, z: window.__sim.player.veh.z, map: window.__game.mapId, route: window.__game.unifiedCompiled?.id, render: { calls: window.__sim.renderer.info.render.calls, triangles: window.__sim.renderer.info.render.triangles }, geometries: window.__sim.renderer.info.memory.geometries }));
    assert.equal(after.map, 'athens');
    assert.equal(after.route, map);
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.1, map + ': throttle must move the car');
    if (map === 'syntagma-pilot') {
      await page.evaluate(() => { window.__game.bestSetupChanged = false; });
      await page.keyboard.press('r');
      await page.waitForFunction(() => window.__game.bestSetupChanged && !window.__game.towing, null, { timeout: 30000 });
      const recovered = await page.evaluate(() => { const v = window.__sim.player.veh; return { x: v.x, y: v.y, z: v.z, speed: Math.hypot(v.vLong, v.vLat), surfaceId: v.routeContact?.surfaceId }; });
      assert.ok(recovered.surfaceId, 'dense city Tow must land on authenticated emitted geometry');
      assert.ok(recovered.speed < 1.5, 'Tow must stop the vehicle');
      results.push({ denseCityTow: recovered });
    }
    if (map === 'megara-club') {
      await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
      await page.bringToFront();
      await page.evaluate(() => {
        window.__desktopPointerProbe = [];
        for (const type of ['pointerlockchange', 'pointerlockerror']) document.addEventListener(type, () => window.__desktopPointerProbe.push({ type, locked: !!document.pointerLockElement, focused: document.hasFocus(), state: window.__game.state }));
        const canvas = document.getElementById('c'), request = canvas.requestPointerLock.bind(canvas);
        canvas.requestPointerLock = (...args) => {
          window.__desktopPointerProbe.push({ type: 'request', focused: document.hasFocus(), activation: navigator.userActivation.isActive, state: window.__game.state });
          const result = request(...args);
          result?.catch(error => window.__desktopPointerProbe.push({ type: 'rejected', name: error.name, message: error.message }));
          return result;
        };
      });
      await page.evaluate(() => window.__flow.menu.onChange({ key: 'mouseLook', value: true, el: { dataset: { scope: 'setting' } } }));
      await page.keyboard.press('Escape');
      await page.locator('#ui [data-act=resume]').click();
      await page.waitForFunction(() => document.pointerLockElement === document.getElementById('c')).catch(async error => {
        const probe = await page.evaluate(() => ({ events: window.__desktopPointerProbe, focused: document.hasFocus(), state: window.__game.state, screen: window.__flow.menu.screen }));
        throw Error('Native mouse-look lock failed: ' + JSON.stringify(probe), { cause: error });
      });
      await page.mouse.move(420, 320);
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => window.__flow.menu.screen === 'pause');
      await page.evaluate(() => window.__flow.menu.onChange({ key: 'mouseLook', value: false, el: { dataset: { scope: 'setting' } } }));
      await page.locator('#ui [data-act=resume]').click();
      await page.waitForFunction(() => window.__game.state === 'race' && !document.pointerLockElement);
      results.push({ pointerLockGranted: true, pointerUnlockPaused: true });
      const initialCell = await page.evaluate(() => {
        const p = window.__routePilot, v = p.player.veh;
        const Controller = p.rivals[0]?.ai?.controller?.constructor;
        if (!Controller) throw Error('Route pilot controller unavailable for bounded boundary test');
        const controller = new Controller(p.route, v, { perfect: true, closedRoad: true });
        p.setDriver((vehicle, dt) => controller.update(dt, { pace: .8 }));
        return `${Math.floor(v.x / 512)},${Math.floor(v.z / 512)}`;
      });
      await page.waitForFunction(initial => {
        const p = window.__routePilot, v = p.player.veh;
        const cell = `${Math.floor(v.x / 512)},${Math.floor(v.z / 512)}`;
        return cell !== initial && p.session.stream.tiles.get(cell)?.state === 'active';
      }, initialCell, { timeout: 120000 });
      const crossing = await page.evaluate(initial => {
        const p = window.__routePilot, v = p.player.veh, cell = `${Math.floor(v.x / 512)},${Math.floor(v.z / 512)}`;
        p.setDriver(() => ({ throttle: 0, brake: 1, steer: 0 }));
        return { from: initial, to: cell, sha256: p.session.manifest?.tiles?.[cell]?.sha256 || p.session.stream.manifest.tiles[cell].sha256, localURL: p.session.stream.manifest.tiles[cell].url, resident: p.session.stream.tiles.get(cell).state };
      }, initialCell);
      results.push({ boundaryCrossing: crossing });
      await page.screenshot({ path: resolve(evidence, 'megara-boundary.jpg'), type: 'jpeg', quality: 85 });
    }
    const cadence = await page.evaluate(() => new Promise(resolve => { const samples = []; let previous; const tick = now => { if (previous !== undefined) samples.push(now - previous); previous = now; if (samples.length === 30) { const sorted = [...samples].sort((a, b) => a - b); resolve({ meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: sorted[Math.floor(sorted.length * .95)], samples: samples.length, meaning: 'browser animation frame cadence, not a rendered FPS benchmark' }); } else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
    await page.screenshot({ path: resolve(evidence, map + '.jpg'), type: 'jpeg', quality: 85 });
    results.push({ map, route: after.route, elapsedMs: Date.now() - began, localRequests: requests.length - initialRequests, cadence, entryPhases: await page.evaluate(() => window.__worldSession?.metrics?.entryPhases || null), render: after.render, geometries: after.geometries, movedMetres: Math.hypot(after.x - before.x, after.z - before.z) });
  }
  const firstFreeEntryDeadline = Date.now() + 240000;
  await page.goto(origin + '/?map=riviera&event=free&car=aventador_svj&simhook&guest=1', { timeout: remainingEntryTime(firstFreeEntryDeadline, 240000) });
  await page.waitForFunction(() => window.__athens?.player?.veh && document.body.classList.contains('loaded'), null, { timeout: remainingEntryTime(firstFreeEntryDeadline, 240000) });
  await page.waitForFunction(() => window.__athens.stats.frames >= 30 && window.__athens.stream.inflight === 0 && window.__athens.stream.transientBytes === 0, null, { timeout: remainingEntryTime(firstFreeEntryDeadline, 120000) });
  await recordFreeAdmission('first entry');
  await unlockFreeAudio(firstFreeEntryDeadline, 'first entry');
  const freeBefore = await page.evaluate(() => ({ x: window.__athens.player.veh.x, z: window.__athens.player.veh.z }));
  await page.keyboard.down('w'); await page.waitForTimeout(1300); await recordFreeAudio('first entry driving');
  remainingEntryTime(firstFreeEntryDeadline, 1); await page.keyboard.up('w');
  const freeAfter = await page.evaluate(() => ({ x: window.__athens.player.veh.x, z: window.__athens.player.veh.z, paused: window.__athens.paused }));
  assert.ok(Math.hypot(freeAfter.x - freeBefore.x, freeAfter.z - freeBefore.z) > .1, 'offline free-roam throttle must move the car');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__athens.paused && window.__athens.menu.open);
  await page.screenshot({ path: resolve(evidence, 'free-roam-paused.jpg'), type: 'jpeg', quality: 85 });
  results.push({ freeRoamMetres: Math.hypot(freeAfter.x - freeBefore.x, freeAfter.z - freeBefore.z), pauseWorked: true });
  await recordFreeAdmission('first entry after driving');
  await recordFreeAdmission('first disposal', true);
  await assertFreeAudioDisposed('first disposal');
  // Re-enter the same world in a fresh document without forcing GC. Managed
  // stream/query/regional counters must return to zero after each real dispose.
  const secondFreeEntryDeadline = Date.now() + 240000;
  await page.goto(origin + '/?map=riviera&event=free&car=aventador_svj&simhook&guest=1', { timeout: remainingEntryTime(secondFreeEntryDeadline, 240000) });
  await page.waitForFunction(() => window.__athens?.player?.veh && window.__athens.stats.frames >= 30 && window.__athens.stream.inflight === 0 && window.__athens.stream.transientBytes === 0, null, { timeout: remainingEntryTime(secondFreeEntryDeadline, 240000) });
  await recordFreeAdmission('second entry');
  await unlockFreeAudio(secondFreeEntryDeadline, 'second entry');
  await page.keyboard.down('w'); await recordFreeAudio('second entry driving');
  remainingEntryTime(secondFreeEntryDeadline, 1);
  await page.keyboard.up('w');
  await recordFreeAdmission('second disposal', true);
  await assertFreeAudioDisposed('second disposal');

  const warmRouteBegan = Date.now();
  await page.goto(origin + '/?routes=1&route=megara-club&quick&simhook&guest=1');
  await page.waitForFunction(() => window.__game?.state === 'race' && !!window.__sim?.player, null, { timeout: 240000 });
  metrics.warmMegaraNavigationToRaceMs = Date.now() - warmRouteBegan;
  await application.close(); application = null;
  const relaunchBegan = Date.now();
  application = await _electron.launch({
    ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE, args: ['--mute-audio'], cwd: resolve(temporary, 'launch') } : { args: ['--mute-audio', 'apps/desktop/main.mjs'] }),
    env: environment, timeout: 60000,
  });
  const reopened = await application.firstWindow();
  await application.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    for (const window of BrowserWindow.getAllWindows()) {
      window.show(); window.focus();
      const contents = window.webContents;
      contents.setAudioMuted(true);
      contents.on('dom-ready', () => contents.setAudioMuted(true));
    }
  });
  await reopened.waitForFunction(() => !!window.athensDesktop && document.body.classList.contains('loaded'), null, { timeout: 90000 });
  await reopened.waitForFunction(() => document.documentElement.classList.contains('booted'));
  metrics.warmRelaunchToInteractiveTitleMs = Date.now() - relaunchBegan;
  assert.equal(await reopened.evaluate(() => localStorage.getItem('desktop-verification')), 'retained', 'profile must survive full app restart');
  const external = requests.filter(value => /^https?:|^wss?:/.test(value) && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname));
  assert.deepEqual(external, [], 'installed renderer must request no external services');
  assert.deepEqual(errors, [], 'game must have no uncaught renderer errors');
  assert.deepEqual(brokenResponses, [], 'all local assets and APIs must load successfully');
} catch (error) { primary = error; if (page && !page.isClosed()) await page.screenshot({ path: resolve(evidence, 'failure.jpg'), type: 'jpeg', quality: 85 }).catch(() => {}); }
finally {
  if (application) await application.close().catch(error => { primary ||= error; });
  await rm(temporary, { recursive: true, force: true });
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ passed: !primary, metrics, routes: results.filter(result => result.route), checks: results.filter(result => !result.route), requestCount: requests.length, errors, brokenResponses, consoleMessages, failedRequests, failure: primary?.stack }, null, 2));
}
if (primary) throw primary;
console.log(`Desktop verified: ${results.filter(result => result.route).length} routes, ${requests.length} local requests, zero renderer errors.`);
