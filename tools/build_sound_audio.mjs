/** Reproducible WebAudio audition/regression harness.
 * node tools/build_sound_audio.mjs → open http://localhost:8015, then run the button.
 * Uses the production graph in OfflineAudioContext, saves PCM WAVs and ffmpeg spectrograms/LUFS.
 */
export async function renderSoundV2({ scenarios = ['straight-100kmh', 'corner-limit', 'handbrake-slide', 'rival-pass-150kmh', 'menu-duck', 'normal-race'] } = {}) {
  const { Audio, tyreParameters } = await import('../src/audio.js');
  const { spatialAudio } = await import('../src/world-sounds.js');
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  const loaded = { Fz: 3500, sx: 0, sy: 0, vw: 27.78, vgx: 27.78 };
  const straight = tyreParameters(loaded, 27.78), corner = tyreParameters({ ...loaded, sy: 1.3 }, 27.78);
  assert(corner.squeal > straight.squeal && corner.scrub > straight.scrub, 'Slip must audibly expose the grip limit');
  assert(tyreParameters({ ...loaded, Fz: 0, sy: 3 }, 27.78).squeal === 0, 'Airborne wheel squeals');
  assert(tyreParameters({ ...loaded, sy: 3 }, 27.78, 'sand').squeal < corner.squeal, 'Sand has asphalt squeal');
  assert(tyreParameters(loaded, 27.78, 'kerb').rumble > 0, 'Kerb has no rumble');
  assert(tyreParameters({ ...loaded, sx: -5 }, 27.78).lock, 'Lock-up not detected');
  const slew = {}, initial = spatialAudio(slew, { vr: 100 }, 0).doppler;
  assert(spatialAudio(slew, { vr: -100 }, 1 / 60).doppler >= initial - 0.031, 'Doppler jumps');
  const report = [];
  for (const scenario of scenarios) {
    const seconds = 8, sr = 44100, ctx = new OfflineAudioContext(2, seconds * sr, sr), a = new Audio();
    a.musicOn = false;
    a.start({ context: ctx, recordings: true, radio: false });
    const spec = { id: 'mini', engine: 'turbo4', idle: 850, redline: 6800 };
    a.setEngine(spec); await Promise.all([a.engineReady, a.worldReady]); a.cancelIgnition();
    if (scenario === 'normal-race') {
      const music = ctx.createBufferSource();
      music.buffer = await ctx.decodeAudioData(await (await fetch('/assets/audio/music/greek-dance.mp3')).arrayBuffer());
      music.connect(a.musicBus); a.musicBus.gain.setValueAtTime(0.5, 0); music.start(0, 25);
    }
    const isPass = scenario === 'rival-pass-150kmh';
    let dopplerMin = 2, dopplerMax = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const time = i / 60, envelope = Math.min(1, Math.max(0, (time - 1) / 0.8));
      const wheels = Array.from({ length: 4 }, (_, j) => ({ ...loaded, Fz: 3500 }));
      if (scenario === 'corner-limit') for (let j = 0; j < 4; j++) Object.assign(wheels[j], { sy: (j < 2 ? 1.25 : 1.05) * envelope, Fz: j % 2 ? 4800 : 2200 });
      if (scenario === 'handbrake-slide') for (let j = 0; j < 4; j++) Object.assign(wheels[j], { sy: (j < 2 ? 0.85 : 3.2) * envelope, sx: j < 2 ? 0 : -6 * envelope, vw: j < 2 ? 27.78 : 27.78 * (1 - envelope) });
      const x = (time - 4) * (150 / 3.6), distance = Math.hypot(x, 5), closing = -x * (150 / 3.6) / distance;
      a.update({ audioTime: time, dt: 1 / 60, rpm: isPass ? 850 : 3600, redline: 6800, load: isPass ? 0 : 0.5, speed: isPass ? 0 : 27.78,
        gear: 3, gearRatio: 1.3, wheels: isPass ? wheels.map(w => ({ ...w, vw: 0, vgx: 0 })) : wheels,
        surfaces: ['asphalt', 'asphalt', 'asphalt', 'asphalt'], nominalLoad: 3500, open: true,
        menuOpen: scenario === 'menu-duck' && time >= 3 && time < 6,
        // The recorded voice and production spatial path, at constant RPM to isolate the pitch shift.
        rival: isPass ? { rpm: 4800, load: 0.8, dist: distance, vr: closing, pan: x / distance } : null,
        traffic: scenario === 'normal-race' ? [12, 24, 45].map((d, j) => ({ id: j, kind: j === 1 ? 'bus' : 'car', d, pan: j % 2 ? -0.6 : 0.6, vr: 0, v: 22, acc: 0.4 })) : [], sea: isPass ? 0 : 0.3, city: 0, cicadas: 0, action: 0 });
      if (isPass) { a.engineVoice.set(3600, 0, 0, time); dopplerMin = Math.min(dopplerMin, a.legacySpatial.doppler); dopplerMax = Math.max(dopplerMax, a.legacySpatial.doppler); }
    }
    const buffer = await ctx.startRendering();
    let peak = 0, energy = 0;
    for (let ch = 0; ch < 2; ch++) for (const sample of buffer.getChannelData(ch)) { assert(Number.isFinite(sample), 'Non-finite sample'); peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
    assert(peak > 0.001 && peak < 1, `${scenario}: silent or clipped`);
    const rmsBetween = (start, end) => {
      let sum = 0, n = 0;
      for (let ch = 0; ch < 2; ch++) for (let i = Math.floor(start * sr); i < end * sr; i++) { sum += buffer.getChannelData(ch)[i] ** 2; n++; }
      return Math.sqrt(sum / n);
    };
    const duckDb = scenario === 'menu-duck' ? 20 * Math.log10(rmsBetween(4.5, 5.5) / rmsBetween(1.5, 2.5)) : null;
    if (duckDb != null) assert(duckDb < -15 && duckDb > -21, `Duck is ${duckDb} dB`);
    if (isPass) assert(dopplerMax > 1.1 && dopplerMin < 0.91, 'Pass has no audible Doppler');
    const row = { scenario, peak, rms: Math.sqrt(energy / buffer.length / 2), duckDb, ...(isPass ? { dopplerMin, dopplerMax } : {}) };
    const saved = await fetch(`/render/${scenario}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(buffer) });
    assert(saved.ok, `Save failed: ${saved.status}`);
    const measurement = await saved.json();
    if (scenario === 'normal-race') {
      const lufs = +measurement.summary.match(/I:\s+(-?[\d.]+) LUFS/)[1];
      assert(lufs >= -16 && lufs <= -14, `Normal race loudness: ${lufs} LUFS`);
    }
    report.push({ ...row, ...measurement });
  }
  return report;
}

function wav(buffer) {
  const channels = buffer.numberOfChannels, bytes = buffer.length * channels * 2, data = new ArrayBuffer(44 + bytes), view = new DataView(data);
  const str = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, bytes, true);
  for (let i = 0; i < buffer.length; i++) for (let ch = 0; ch < channels; ch++) view.setInt16(44 + (i * channels + ch) * 2, Math.round(Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i])) * 32767), true);
  return data;
}

if (typeof process !== 'undefined' && process.versions?.node) {
  const { createServer } = await import('node:http'), { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url'), { resolve, extname } = await import('node:path'), { execFileSync } = await import('node:child_process');
  const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(root, '.scratch/sound-v2');
  await mkdir(out, { recursive: true });
  createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (req.method === 'POST' && /^\/render\/[a-z0-9-]+$/.test(path)) {
        const name = path.split('/').at(-1), chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const file = resolve(out, name + '.wav'); await writeFile(file, Buffer.concat(chunks));
        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-lavfi', 'showspectrumpic=s=1200x600:legend=1:scale=log:fscale=log:color=intensity', resolve(out, name + '.png')]);
        const { spawnSync } = await import('node:child_process');
        const measure = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
        await writeFile(resolve(out, name + '-loudness.txt'), measure.stderr);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ file, summary: measure.stderr.slice(measure.stderr.lastIndexOf('Summary:')) })); return;
      }
      if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (path === '/') {
        res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Sound v2 render</title><button id="render">Render production audio clips</button><pre id="result"></pre><script type="module">import {renderSoundV2} from "/tools/build_sound_audio.mjs";window.renderSoundV2=renderSoundV2;document.querySelector("button").onclick=async()=>{try{window.soundReport=await renderSoundV2();document.querySelector("pre").textContent=JSON.stringify(window.soundReport,null,2)}catch(e){document.querySelector("pre").textContent=e.stack;throw e}};</script>'); return;
      }
      const file = resolve(root, '.' + path); if (!file.startsWith(root)) throw new Error('Outside root');
      const content = await readFile(file);
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' })[extname(file)] || 'application/octet-stream'); res.end(content);
    } catch (e) { res.statusCode = 404; res.end(String(e)); }
  }).listen(8015, '127.0.0.1', () => console.log('Sound render harness: http://127.0.0.1:8015'));
}
