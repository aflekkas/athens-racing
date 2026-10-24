// Native result-image fallback: real rendered game photo, Results SHARE gesture,
// native DownloadItem save/cancel, and same-origin subframe rejection.
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const evidence = resolve(process.env.DESKTOP_EVIDENCE || '.scratch/desktop-check');
const temporary = await mkdtemp(resolve(process.env.DESKTOP_TEMP_ROOT || '/tmp', 'athens-desktop-download.'));
await mkdir(evidence, { recursive: true }); await mkdir(resolve(temporary, 'launch'));
const environment = { ...process.env, ASR_DESKTOP_USER_DATA: resolve(temporary, 'profile'), ASR_DESKTOP_PORT: '17845' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete environment[key];
if (process.env.DESKTOP_EXECUTABLE) delete environment.ASR_GAME_ROOT;
let application, page, failure, observations = [];
try {
  application = await _electron.launch({ ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE, args: ['--mute-audio'], cwd: resolve(temporary, 'launch') } : { args: ['--mute-audio', 'apps/desktop/main.mjs'] }), env: environment, timeout: 60000 });
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
  await page.waitForFunction(() => !!window.athensDesktop && document.documentElement.classList.contains('booted'));
  await application.evaluate(({ BrowserWindow }, paths) => {
    globalThis.__asrDownloadProbe = { mode: 'save', records: [], errors: [], paths };
    BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (event, item, contents, frame) => {
      const probe = globalThis.__asrDownloadProbe;
      try {
        const record = { filename: item.getFilename(), mime: item.getMimeType(), origin: item.getInitiatorOrigin(), gesture: item.hasUserGesture(), total: item.getTotalBytes(), chain: item.getURLChain(), mainFrame: frame === contents?.mainFrame, blocked: event.defaultPrevented, state: event.defaultPrevented ? 'blocked' : 'pending' };
        probe.records.push(record);
        if (event.defaultPrevented) return;
        item.setSavePath(probe.mode === 'cancel' ? probe.paths.cancel : probe.paths.save);
        item.once('done', (_event, state) => { record.state = state; record.received = item.getReceivedBytes(); });
        if (probe.mode === 'cancel') item.cancel();
      } catch (error) { probe.errors.push(error.message); }
    });
  }, { save: resolve(temporary, 'saved-result.png'), cancel: resolve(temporary, 'cancelled-result.png') });
  await page.goto(new URL(page.url()).origin + '/?routes=1&route=megara-club&quick&simhook&guest=1');
  await page.waitForFunction(() => window.__game?.state === 'race' && !!window.__sim?.player, null, { timeout: 240000 });
  await page.keyboard.down('w'); await page.waitForTimeout(2000); await page.keyboard.up('w');
  await page.evaluate(() => {
    // This is a result-image integration fixture after genuine driving, not a
    // claim of finishing the race or earning a record.
    const G = window.__game;
    G.result = { time: 45.67, carName: window.__sim.player.spec.name, position: 1, field: 1, date: new Date().toISOString() };
    G.resultPhotoPending = true; window.__sim.render(); G.state = 'results';
    window.__flow.menu.show('results', { result: G.result, title: 'IMAGE SAVE CHECK', rows: [['TIME', '0:45.67', true]] });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
  });
  const waitForDownload = async (index, state) => {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const probe = await application.evaluate(() => globalThis.__asrDownloadProbe);
      assert.deepEqual(probe.errors, [], 'native download observations must remain readable');
      if (probe.records[index]?.state === state) return probe.records[index];
      if (probe.records[index]?.blocked && state !== 'blocked') throw Error('Expected result download was denied: ' + JSON.stringify(probe.records[index]));
      await page.waitForTimeout(100);
    }
    throw Error('Native download did not reach ' + state + ': ' + JSON.stringify(await application.evaluate(() => globalThis.__asrDownloadProbe)));
  };
  await page.locator('[data-act=shareResult]').click();
  observations.push(await waitForDownload(0, 'completed'));
  const bytes = await readFile(resolve(temporary, 'saved-result.png'));
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.readUInt32BE(16), 1200); assert.equal(bytes.readUInt32BE(20), 900); assert.ok(bytes.length < 8 * 1024 ** 2);
  await writeFile(resolve(evidence, 'result-card.png'), bytes);
  await application.evaluate(() => { globalThis.__asrDownloadProbe.mode = 'cancel'; });
  await page.locator('[data-act=shareResult]').click(); observations.push(await waitForDownload(1, 'cancelled'));
  await assert.rejects(access(resolve(temporary, 'cancelled-result.png')));
  await page.screenshot({ path: resolve(evidence, 'result-share.jpg'), type: 'jpeg', quality: 85 });
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.id = 'download-subframe'; frame.style.cssText = 'position:fixed;top:0;left:0;width:320px;height:100px;z-index:2147483647;background:white';
    frame.srcdoc = `<button id="download">Download</button><script>document.getElementById('download').onclick=()=>{const c=document.createElement('canvas');c.width=2;c.height=2;c.toBlob(blob=>{const a=document.createElement('a');a.download='athens-racing-result.png';a.href=URL.createObjectURL(blob);a.click();},'image/png');};<\/script>`;
    document.body.append(frame);
  });
  await page.frameLocator('#download-subframe').locator('#download').click(); observations.push(await waitForDownload(2, 'blocked'));
} catch (error) { failure = error; if (page && !page.isClosed()) await page.screenshot({ path: resolve(evidence, 'download-failure.jpg'), type: 'jpeg', quality: 85 }).catch(() => {}); }
finally {
  if (application) { observations = await application.evaluate(() => globalThis.__asrDownloadProbe?.records || []).catch(() => observations); await application.close().catch(error => { failure ||= error; }); }
  await rm(temporary, { recursive: true, force: true });
  await writeFile(resolve(evidence, 'download-results.json'), JSON.stringify({ passed: !failure, observations, fixture: 'Results SHARE after real driving; synthetic result only for image save, no finish/record claim', failure: failure?.stack }, null, 2));
}
if (failure) throw failure;
console.log('PASS: native Results image saved as1200×900 PNG, cancelled save left no file, subframe download denied.');
