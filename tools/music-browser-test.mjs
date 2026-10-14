#!/usr/bin/env node
// Run through tools/browser-slot.sh; real Menu/Audio/Input without the expensive 3D world.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.MUSIC_EVIDENCE_DIR || resolve(root, '.scratch/music/browser'));
await mkdir(out, { recursive: true });
function tone(frequency) {
  const rate = 24000, length = rate * 30, bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 8000), 44 + i * 2);
  return bytes;
}
// Current stream checked on the publisher's official YouTube /streams page; IDs can expire.
const youtubeURL = process.env.MUSIC_YOUTUBE_URL || 'https://www.youtube.com/watch?v=rFZHOHl-L8A';
const first = resolve(out, 'tone-440.wav'), second = resolve(out, 'tone-660.wav');
await writeFile(first, tone(440)); await writeFile(second, tone(660));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.mjs'));
const app = await createGameServer({ root, dataDir: resolve(out, 'server-data') });
const [normal] = app.server.listeners('request'); app.server.removeAllListeners('request');
app.server.on('request', async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/music-three/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(resolve(process.env.THREE_MODULE_ROOT || resolve(root, 'node_modules/three'), url.pathname.slice(13)))); return; }
    if (url.pathname === '/music-settings-fixture') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Music source verification</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/ui/ui.css"><link rel="stylesheet" href="/src/menu.css"><script type="importmap">{"imports":{"three":"/music-three/build/three.module.js","three/addons/":"/music-three/examples/jsm/"}}</script></head><body><div id="ui"></div><script type="module">
        import { Audio } from '/src/audio.js';
        import { Menu } from '/src/menu.js';
        import { Input } from '/src/input.js';
        import { settings, setSetting, onSettings } from '/src/settings.js';
        const audio = new Audio(), start = audio.start.bind(audio);
        audio.start = options => start({ recordings: false, ...options });
        const input = new Input();
        const menu = new Menu(document.getElementById('ui'), { inputDevice: () => 'keyboard', ui: () => {}, cancelBindings: () => {} });
        onSettings(s => { audio.setVolumes(s); if (menu.screen === 'settings') menu.refreshValues(); });
        window.__flow = {
          menu, openSettings() { menu.show('settings', { tab: 'audio', from: 'pause' }); },
          resume() { menu.hide(); audio.menuRequested = false; audio.syncMenu(); },
        };
        setInterval(() => {
          input.update(1 / 60, { inMenu: menu.open });
          for (const action of input.actions) {
            if (action === 'transmission') setSetting('transmission', settings.transmission === 'manual' ? 'auto' : 'manual');
            else if (menu.open) menu.action(action);
            else if (action === 'music') audio.toggleMusic();
            else if (action === 'nextTrack') audio.nextTrack();
          }
        }, 1000 / 60);
        window.__flow.openSettings();
      </script></body></html>`);
      return;
    }
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end((await readFile(resolve(root, 'index.html'), 'utf8')).replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/music-three/')); return; }
    normal(req, res);
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/home/dev/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
const errors = [], requests = [], evidence = { base, root, fixture: 'production Menu + Audio + Input, recorded world disabled', checks: [], errors };
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/youtube|scdn|spotify|tracks\.json/.test(request.url())) requests.push(request.url()); });
await page.addInitScript(() => { window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined; });
const save = name => page.screenshot({ path: resolve(out, name + '.png'), fullPage: true, timeout: 60000 });
try {
  await page.goto(base + '/music-settings-fixture', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__flow?.menu && window.__music, null, { timeout: 60000 });
  await page.evaluate(() => { window.__flow.openSettings(); });
  await page.locator('#music-source-settings').waitFor({ timeout: 15000 });
  assert.equal(await page.getByLabel('Music source').inputValue(), 'off');
  assert.equal(requests.some(url => /tracks\.json/.test(url)), false);
  evidence.checks.push('Fresh default Off; no bundled playlist fetch'); await save('01-off');
  await page.getByLabel('Music source').selectOption('files');
  await page.locator('[data-file-input]').setInputFiles([first, second]);
  await page.waitForFunction(() => window.__music.el && !window.__music.el.paused && window.__music.el.currentTime > 0.1);
  const playback = await page.evaluate(async () => {
    const music = window.__music, a = music.audio, analyser = a.ctx.createAnalyser(); analyser.fftSize = 2048; a.musicVol.connect(analyser);
    await new Promise(resolve => setTimeout(resolve, 300));
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    const { setSetting } = await import('/src/settings.js'); setSetting('music', 0); await new Promise(resolve => setTimeout(resolve, 700)); analyser.getFloatTimeDomainData(samples);
    const mutedRms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    setSetting('music', .55); a.musicVol.disconnect(analyser);
    return { source: music.source, currentTime: music.el.currentTime, files: music.files.map(file => file.name), context: a.ctx.state, rms, mutedRms, menuTrim: music.inputGain.gain.value };
  });
  assert.ok(playback.rms > .001, JSON.stringify(playback)); assert.ok(playback.mutedRms < playback.rms / 20, JSON.stringify(playback));
  evidence.playback = playback; evidence.checks.push('Generated WAV plays through music bus; music=0 silences it');
  await page.locator('[data-next]').click(); await page.waitForFunction(() => window.__music.index === 1);
  await page.locator('[data-prev]').click(); await page.waitForFunction(() => window.__music.index === 0);
  await page.locator('[data-shuffle]').click(); assert.equal(await page.locator('[data-shuffle]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-play]').click(); assert.equal(await page.evaluate(() => __music.el.paused), true);
  await page.locator('[data-play]').click(); await page.waitForFunction(() => !__music.el.paused);
  evidence.checks.push('Next, previous, shuffle, play/pause work'); await save('02-your-files');
  // Escape control/navigation focus before exercising the real game input mapping.
  await page.evaluate(() => { document.activeElement.blur(); __flow.resume(); });
  await page.keyboard.press('KeyJ'); await page.waitForFunction(() => __music.el.paused);
  assert.equal(await page.evaluate(() => __settings.transmission), 'auto');
  await page.keyboard.press('KeyN'); await page.waitForFunction(() => !__music.el.paused);
  assert.equal(await page.evaluate(() => __settings.transmission), 'auto');
  await page.keyboard.press('KeyM');
  const bindings = await page.evaluate(() => ({ transmission: __settings.transmission, source: __music.source, paused: __music.el.paused }));
  assert.equal(bindings.transmission, 'manual'); assert.equal(bindings.source, 'files'); assert.equal(bindings.paused, false);
  evidence.checks.push('J mute, N next, M toggles transmission without changing music');
  await page.evaluate(() => __flow.openSettings()); await page.locator('#music-source-settings').waitFor();
  await page.getByLabel('Music source').selectOption('spotify');
  assert.match(await page.locator('[data-spotify-setup]').innerText(), /No client ID/);
  assert.match(await page.locator('[data-source=spotify]').innerText(), /Premium required/);
  assert.equal(requests.some(url => /spotify|scdn/.test(url)), false);
  evidence.checks.push('Spotify no-ID setup, Premium note, external link; no OAuth/SDK requests'); await save('03-spotify-setup');
  await page.getByLabel('Music source').selectOption('youtube');
  await page.locator('[data-youtube-url]').fill(youtubeURL);
  await page.locator('[data-youtube-load]').click();
  await page.locator('.music-youtube iframe').waitFor({ timeout: 30000 });
  await page.locator('.music-youtube').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.music-status')?.textContent.includes('Press Play') || /could not play/.test(document.querySelector('.music-status')?.textContent), null, { timeout: 45000 });
  const iframe = page.locator('.music-youtube iframe'), box = await iframe.boundingBox();
  assert.ok(box.width >= 200 && box.height >= 200, JSON.stringify(box));
  evidence.youtube = { src: await iframe.getAttribute('src'), box, status: await page.locator('.music-status').innerText(), requests: requests.filter(url => /youtube/.test(url)).slice(0, 8) };
  const { parseYouTubeURL } = await import('../src/music-youtube.js');
  assert.ok(evidence.youtube.src.includes(parseYouTubeURL(youtubeURL).video));
  const youtubeFrame = page.frameLocator('.music-youtube iframe');
  await youtubeFrame.getByRole('button', { name: /^Play/ }).first().click({ timeout: 30000 });
  await youtubeFrame.locator('video').evaluate(video => new Promise((resolve, reject) => {
    const started = performance.now(), poll = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused) resolve();
      else if (performance.now() - started > 30000) reject(Error('YouTube video did not start after native Play.'));
      else setTimeout(poll, 100);
    }; poll();
  }));
  evidence.youtube.nativePlayback = await youtubeFrame.locator('video').evaluate(video => ({ readyState: video.readyState, paused: video.paused, width: video.videoWidth, height: video.videoHeight }));
  await iframe.hover();
  await save('04-youtube-player'); evidence.checks.push('Real IFrame API + public livestream plays after native user gesture; visible minimum-size player');
  await page.getByLabel('Music source').selectOption('off'); assert.equal(await page.locator('.music-youtube iframe').count(), 0);
  evidence.checks.push('Changing source destroys YouTube');
  await page.getByLabel('Music source').selectOption('youtube');
  await page.locator('[data-youtube-load]').click();
  await page.locator('.music-youtube iframe').waitFor({ timeout: 30000 });
  await page.evaluate(() => __flow.menu.show('settings', { tab: 'video' }));
  assert.equal(await page.locator('.music-youtube iframe').count(), 0);
  evidence.checks.push('Leaving Sound settings removes the YouTube player');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = String(error); evidence.text = await page.locator('body').innerText().catch(() => '');
  await save('failure').catch(() => {}); throw error;
} finally {
  await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); await browser.close(); await app.close();
}
