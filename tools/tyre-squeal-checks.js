// Offline browser evidence through the production graph, including recorded rubber.
import { Audio } from '../src/audio.js';

export async function renderTyreRetune(save, prefix = 'after') {
  const report = [];
  for (const scenario of ['corner-sweep', 'normal-90pct']) for (const isolated of [false, true]) {
    const ctx = new OfflineAudioContext(2, 44100 * 12, 44100), a = new Audio();
    const random = Math.random; let seed = 1337;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    try {
      a.start({ context: ctx, recordings: true, radio: false });
      a.setEngine({ id: 'mini', engine: 'turbo4', idle: 850, redline: 6800 });
      await Promise.all([a.worldReady, a.engineReady]); a.cancelIgnition();
      if (!a.tyres.every(v => v.recording)) throw Error('Recorded tyre layer missing');
      a.setVolumes({ ambience: 0, traffic: 0, music: 0, voice: 0, ui: 0, ...(isolated ? { engine: 0 } : {}) });
      if (isolated) {
        for (const key of ['engine', 'ambience', 'traffic', 'music', 'voice', 'ui']) {
          a.mix.buses[key].gain.cancelScheduledValues(0); a.mix.buses[key].gain.setValueAtTime(0, 0);
        }
        for (const v of a.tyres) for (const key of ['roll', 'scrub', 'howl', 'grit', 'rumble']) v[key].disconnect();
        a.t.windG.disconnect(); a.t.whistleG.disconnect();
      }
      const trace = [];
      let wait = ctx.suspend(0), render = ctx.startRendering();
      for (let i = 0; i < 240; i++) {
        await wait; const t = ctx.currentTime;
        const slip = scenario === 'normal-90pct' ? .9 : t < 4 ? .2 + .7 * t / 4 : t < 8 ? .9 + .85 * (t - 4) / 4 : t < 10 ? 1.75 - .85 * (t - 8) / 2 : .9;
        const speed = 100 / 3.6, wheels = [2200, 4800, 2200, 4800].map(Fz => ({ Fz, sx: 0, sy: slip, vgx: speed, vw: speed }));
        a.update({ dt: .05, rpm: 3600, redline: 6800, load: .5, throttle: .5, gear: 3, gearRatio: 2, shift: 0, boost: .3, speed, open: true, wheels, surfaces: Array(4).fill('asphalt'), nominalLoad: 3500, traffic: [], rivals: [], sea: 0, city: 0, beach: 0, cicadas: 0, action: 0 });
        trace.push({ t, slip, targets: a.tyres.map(v => v.squealTarget ?? null), active: a.tyres.map(v => v.squealActive ?? null) });
        if (i < 239) wait = ctx.suspend((i + 1) * .05);
        await ctx.resume();
      }
      const b = await render, data = new Float32Array(b.length * 2);
      let peak = 0, squares = 0, stereoError = 0;
      const left = b.getChannelData(0), right = b.getChannelData(1);
      for (let i = 0; i < b.length; i++) {
        data[i * 2] = left[i]; data[i * 2 + 1] = right[i];
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        squares += left[i] ** 2 + right[i] ** 2;
        stereoError = Math.max(stereoError, Math.abs(left[i] - right[i]));
      }
      const name = `${prefix}-${scenario}${isolated ? '-squeal-only' : ''}`;
      await save(name + '.f32', data.buffer);
      const busGain = a.tyres.map(v => v.squealBus?.gain.value ?? 1);
      if (prefix === 'after') {
        if (busGain.some(g => Math.abs(20 * Math.log10(g) + 7) > 1e-5)) throw Error('Squeal trim changed');
        if (scenario === 'normal-90pct' && isolated && peak !== 0) throw Error('90% corner produced squeal');
        if (stereoError > 1e-7) throw Error('Own engine/tyres are not centred');
      }
      report.push({ name, sampleRate: b.sampleRate, frames: b.length, peak, rms: Math.sqrt(squares / data.length), stereoError, busGain, trace });
    } finally { Math.random = random; }
  }
  return report;
}
