// Local, edited field recordings. Full provenance and known substitutions:
// assets/audio/engines/sources.json and CREDITS.txt.
const base = new URL('../assets/audio/engines/', import.meta.url);
const loop = (file, rpm, revision = '') => ({ url: new URL(file + '.wav' + (revision ? '?v=' + encodeURIComponent(revision) : ''), base).href, rpm });
export const ENGINE_RECORDINGS = {
  // Version only the re-cut layer so existing browser asset caches fetch its replacement.
  mini: { engine: 'turbo4', start: 'mini-start', catchAt: .7, loops: [loop('mini-idle', 900), loop('mini-low', 1800), loop('mini-mid', 4300, 'c58f458b'), loop('mini-high', 6100)] },
  z4: { engine: 'turbo6', start: 'z4-start', catchAt: .45, loops: [loop('z4-idle', 745), loop('z4-low', 1545), loop('z4-mid', 3000), loop('z4-high', 5050)] },
  taxi: { engine: 'diesel', start: 'taxi-start', catchAt: .85, loops: [loop('taxi-idle', 860), loop('taxi-low', 2000), loop('taxi-high', 3000)] },
};
const downloads = new Map();
const banks = new WeakMap();

function download(url) {
  if (!downloads.has(url)) {
    const request = fetch(url, { signal: AbortSignal.timeout(12000) }).then(r => {
      if (!r.ok) throw new Error(`Engine audio ${r.status}: ${url}`);
      return r.arrayBuffer();
    }).catch(error => { downloads.delete(url); throw error; });
    downloads.set(url, request);
  }
  return downloads.get(url);
}
export function recordingFor(spec) {
  const recording = ENGINE_RECORDINGS[spec?.id];
  return recording && recording.engine === spec?.engine ? recording : null;
}
export function preloadEngine(spec) {
  const recording = recordingFor(spec);
  if (!recording) return;
  // Start network work before the first input unlocks AudioContext.
  for (const url of [new URL(recording.start + '.wav', base).href, ...recording.loops.map(l => l.url)]) download(url).catch(() => {});
}
export function loadRecordedEngine(ctx, spec) {
  const recording = recordingFor(spec);
  if (!recording) return Promise.resolve(null);
  let cache = banks.get(ctx);
  if (!cache) { cache = new Map(); banks.set(ctx, cache); }
  if (!cache.has(spec.id)) {
    const decode = async url => ctx.decodeAudioData((await download(url)).slice(0));
    const promise = Promise.all([
      decode(new URL(recording.start + '.wav', base).href),
      Promise.all(recording.loops.map(async l => ({ ...l, buffer: await decode(l.url) }))),
    ]).then(([start, loops]) => ({ ...recording, start, loops, recorded: true }))
      .catch(error => { cache.delete(spec.id); throw error; });
    cache.set(spec.id, promise);
  }
  return cache.get(spec.id);
}

export function rpmBlend(points, rpm) {
  let i = 0;
  while (i < points.length - 2 && rpm > points[i + 1]) i++;
  const x = Math.max(0, Math.min(1, Math.log(Math.max(1, rpm) / points[i]) / Math.log(points[i + 1] / points[i])));
  return points.map((_, k) => k === i ? Math.cos(x * Math.PI / 2) : k === i + 1 ? Math.sin(x * Math.PI / 2) : 0);
}

export class RecordedEngineVoice {
  constructor(ctx, bank, dest, spec, gain = 1) {
    this.ctx = ctx; this.bank = bank; this.spec = spec; this.level = gain;
    this.sources = []; this.gains = [];
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = .55;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.filter.connect(this.out); this.out.connect(dest);
    for (const sample of bank.loops) {
      const source = ctx.createBufferSource(), g = ctx.createGain();
      source.buffer = sample.buffer; source.loop = true; g.gain.value = 0;
      source.connect(g); g.connect(this.filter); source.start(ctx.currentTime, Math.random() * sample.buffer.duration);
      this.sources.push(source); this.gains.push(g);
    }
    // Preserve limiter feedback without distorting the recorded engine timbre.
    this.limiter = ctx.createOscillator(); this.limiter.type = 'square'; this.limiter.frequency.value = 17;
    this.limiterGain = ctx.createGain(); this.limiterGain.gain.value = 0;
    this.limiter.connect(this.limiterGain); this.limiterGain.connect(this.out.gain); this.limiter.start();
  }
  set(rpm, load, level, now, dop = 1, limiter = false, tc = .045) {
    if (this.stopped) return;
    const r = Math.max(this.spec.idle * .65, rpm), on = Math.max(0, Math.min(1, load));
    const weights = rpmBlend(this.bank.loops.map(s => s.rpm), r);
    this.sources.forEach((source, i) => {
      // Clamp only outside the driving envelope (e.g. corrupt telemetry).
      source.playbackRate.setTargetAtTime(Math.max(.25, Math.min(4, r / this.bank.loops[i].rpm * dop)), now, tc);
      this.gains[i].gain.setTargetAtTime(weights[i], now, .06);
    });
    const rn = Math.min(1, r / this.spec.redline);
    this.filter.frequency.setTargetAtTime((this.spec.engine === 'diesel' ? 2500 : 4800) + on * 6500 + rn * 1800, now, .07);
    const amplitude = level * this.level * (.48 + .35 * on + .17 * rn);
    this.out.gain.setTargetAtTime(amplitude, now, .055);
    this.limiterGain.gain.setTargetAtTime(limiter ? -amplitude * .35 : 0, now, .015);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, now, .045); this.limiterGain.gain.setTargetAtTime(0, now, .02);
    for (const source of this.sources) source.stop(now + .3);
    this.limiter.stop(now + .3);
    // onended follows audio time even when the tab/context is suspended.
    this.limiter.onended = () => {
      for (const node of [...this.sources, ...this.gains, this.filter, this.out, this.limiter, this.limiterGain]) node.disconnect();
    };
  }
}
