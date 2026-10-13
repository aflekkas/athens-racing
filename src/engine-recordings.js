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

/** Build a long, phase-coherent granular bed once per decoded take. Random offsets
 * must not randomize the firing fundamental: equal-power windows alone cannot
 * prevent destructive interference between correlated engine grains.
 */
const grainBeds = new WeakMap();
function engineGrainBed(ctx, buffer, rpm, cylinders) {
  if (grainBeds.has(buffer)) return grainBeds.get(buffer);
  const sr = buffer.sampleRate, input = buffer.getChannelData(0), size = input.length;
  const fundamental = rpm * cylinders / 120; // four-stroke firing order
  // Separate the firing body from the stochastic texture before overlap normalization.
  const bass = new Float32Array(size), texture = new Float32Array(size);
  const cutoff = fundamental * 1.6;
  bass.set(input);
  // Zero-phase fourth-order crossover: a causal low-pass leaves much of the
  // fundamental in x-low because of phase delay, defeating body normalization.
  for (const reverse of [false, true]) for (const q of [.5411961, 1.306563]) {
    const w = 2 * Math.PI * cutoff / sr, alpha = Math.sin(w) / (2*q);
    const b0 = (1 - Math.cos(w)) / 2 / (1 + alpha), b1 = 2*b0;
    const a1 = -2*Math.cos(w)/(1+alpha), a2 = (1-alpha)/(1+alpha);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = -size*2; i < size; i++) {
      const wrapped = (i % size + size) % size, index = reverse ? size-1-wrapped : wrapped;
      const x = bass[index], y = b0*x + b1*x1 + b0*x2 - a1*y1 - a2*y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      if (i >= 0) bass[index] = y;
    }
  }
  for (let i = 0; i < size; i++) texture[i] = input[i] - bass[i];
  let seed = 0x71a5 + Math.round(rpm);
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // An integer number of firing cycles also makes the prepared bed's wrap coherent.
  const length = Math.round(Math.round(24 * fundamental) * sr / fundamental);
  const low = new Float32Array(length), high = new Float32Array(length);
  const weight = new Float32Array(length), power = new Float32Array(length);
  const grainLength = Math.round(sr * .42), meanHop = sr * .12;
  const omega = 2 * Math.PI * fundamental / sr;
  const wrap = i => (i % size + size) % size;
  // Circular overlap-add carries the final grains across the wrap without a seam.
  for (let start = 0; start < length; ) {
    let offset = Math.floor(random() * size);
    // Measure the local firing phase, then align this random excerpt to audio time.
    let re = 0, im = 0;
    const probe = Math.round(sr * .1);
    for (let j = 0; j < probe; j += 4) {
      const h = Math.sin(Math.PI * j / probe) ** 2, v = bass[wrap(offset + j)] * h;
      re += v * Math.cos(omega * j); im -= v * Math.sin(omega * j);
    }
    const phase = Math.atan2(im, re), target = omega * start;
    const correction = Math.atan2(Math.sin(target - phase), Math.cos(target - phase)) / omega;
    offset += Math.round(correction);
    for (let j = 0; j < grainLength; j++) {
      const out = (start + j) % length;
      const win = Math.sin(Math.PI * j / (grainLength - 1)); // equal-power sine window
      const source = wrap(offset + j);
      low[out] += bass[source] * win; high[out] += texture[source] * win;
      weight[out] += win; power[out] += win * win;
    }
    start += Math.round(meanHop * (.6 + .8 * random())); // +/-40%; max hop .168 < half .42
  }
  for (let i = 0; i < length; i++) {
    low[i] /= Math.max(1e-6, weight[i]); // coherent firing body: normalize amplitude
    high[i] /= Math.sqrt(Math.max(1e-6, power[i])); // decorrelated texture: normalize power
  }
  // Normalize residual source-level changes after summation, not individual grains.
  // Symmetric look-ahead is possible because preparation precedes playback; no AGC lag.
  const stabilize = (samples, reference) => {
    let target = 0; for (const v of reference) target += v*v;
    target /= reference.length;
    const radius = Math.round(sr * .04), squared = new Float64Array(length + 2*radius + 1);
    for (let i = 0; i < length + 2*radius; i++) {
      const v = samples[(i - radius + length) % length]; squared[i+1] = squared[i] + v*v;
    }
    const envelope = new Float32Array(length);
    for (let i = 0; i < length; i++) envelope[i] = Math.sqrt(target / Math.max(1e-12, (squared[i+2*radius] - squared[i]) / (2*radius)));
    // Smooth gain itself over 20 ms; retain natural individual combustion pulses.
    const smooth = Math.round(sr * .01), sums = new Float64Array(length + 2*smooth + 1);
    for (let i = 0; i < length + 2*smooth; i++) sums[i+1] = sums[i] + envelope[(i-smooth+length)%length];
    for (let i = 0; i < length; i++) samples[i] *= Math.min(4, (sums[i+2*smooth] - sums[i]) / (2*smooth));
  };
  stabilize(low, bass); stabilize(high, texture);
  const result = ctx.createBuffer(1, length, sr), data = result.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = low[i] + high[i];
  stabilize(data, input); // also account for residual correlation between the two bands
  grainBeds.set(buffer, result); return result;
}

export class GranularEngineLoop {
  constructor(ctx, buffer, dest, rpm = 1800, cylinders = 4) {
    this.source = ctx.createBufferSource(); this.source.buffer = engineGrainBed(ctx, buffer, rpm, cylinders);
    this.source.loop = true; this.source.connect(dest); this.playbackRate = this.source.playbackRate;
  }
  start(now) { this.source.start(now); }
  stop(at) { if (!this.stopped) { this.stopped = true; this.source.stop(at); } }
  disconnect() { this.source.disconnect(); }
}

export class RecordedEngineVoice {
  constructor(ctx, bank, dest, spec, gain = 1) {
    this.ctx = ctx; this.bank = bank; this.spec = spec; this.level = gain;
    this.sources = []; this.gains = [];
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = .55;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.filter.connect(this.out); this.out.connect(dest);
    for (const sample of bank.loops) {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(this.filter);
      const source = spec.id === 'mini' || sample.buffer.duration < 1.25
        ? new GranularEngineLoop(ctx, sample.buffer, g, sample.rpm, spec.engine === 'turbo6' ? 6 : 4)
        : ctx.createBufferSource();
      if (!(source instanceof GranularEngineLoop)) { source.buffer = sample.buffer; source.loop = true; source.connect(g); }
      source.start(ctx.currentTime, Math.random() * sample.buffer.duration);
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
      const rate = Math.max(.25, Math.min(4, r / this.bank.loops[i].rpm * dop));
      source.playbackRate.setTargetAtTime(rate, now, tc);
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
