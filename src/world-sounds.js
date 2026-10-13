// Recorded world sounds: ambience beds, traffic engine loops, impacts and horns (assets/audio/world, built by
// tools/build_world_audio.mjs), plus the radio playlist (assets/audio/music). Everything loads in the background
// after the first key press; the game plays without any of it and each sound fades in once it arrives.
const WORLD = new URL('../assets/audio/world/', import.meta.url);
const ENGINES = new URL('../assets/audio/engines/', import.meta.url);
const MUSIC = new URL('../assets/audio/music/', import.meta.url);

// Engine loops reused for traffic, with the RPM each was recorded at (see engine-recordings.js). Petrol traffic
// uses the BMW exterior takes: they are heard from outside, and long enough that the loop never audibly repeats.
const TRAFFIC_ENGINES = { 'car-idle': ['z4-idle.wav', 745], 'car-engine': ['z4-low.wav', 1545], 'diesel-idle': ['taxi-idle.wav', 860], 'diesel-engine': ['taxi-low.wav', 2000] };
// Loaded first: what you hear in the first seconds of a race.
const FIRST = ['sea-sand', 'cicadas', 'wind', 'tyre-squeal', 'car-idle', 'car-engine', 'city', 'diesel-idle', 'diesel-engine'];

/**
 * Decode everything; onLoad(name, sound) fires per sound. sound: { buffer, loopStart, loopEnd } (loops) or { buffer }.
 * Loops come with a guard copy of their start after `frames`, so loopEnd always falls inside real audio; the
 * leading offset covers decoders that do not strip the MP3 encoder delay.
 */
export async function loadWorldSounds(ctx, onLoad) {
  const manifest = await (await fetch(new URL('sounds.json', WORLD))).json();
  const jobs = Object.entries(manifest).map(([name, m]) => [name, new URL(m.file, WORLD), m]);
  for (const [name, [file, rpm]] of Object.entries(TRAFFIC_ENGINES)) jobs.push([name, new URL(file, ENGINES), { kind: 'loop', rpm }]);
  jobs.sort((a, b) => (FIRST.includes(b[0]) ? 1 : 0) - (FIRST.includes(a[0]) ? 1 : 0));
  const one = async ([name, url, m]) => {
    const buffer = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const sound = { buffer, rpm: m.rpm };
    if (m.kind === 'loop' && m.frames) {
      const len = m.frames * ctx.sampleRate / m.sampleRate, guard = 0.3 * ctx.sampleRate;
      let off = 0;
      if (buffer.length > len + guard + 64) {
        const d = buffer.getChannelData(0), lim = Math.min(d.length, 4096);
        while (off < lim && Math.abs(d[off]) < 1e-3) off++;
        if (off >= lim) off = 0;
      }
      sound.loopStart = off / ctx.sampleRate; sound.loopEnd = (off + len) / ctx.sampleRate;
    } else if (m.kind === 'loop') { sound.loopStart = 0; sound.loopEnd = buffer.duration; }
    onLoad(name, sound);
  };
  // Two at a time: the first beds arrive quickly without starving the engine recordings.
  const queue = jobs.slice();
  const worker = async () => { while (queue.length) { const j = queue.shift(); try { await one(j); } catch (e) { console.warn('World sound unavailable:', j[0], e); } } };
  await Promise.all([worker(), worker()]);
}

/** A looping source started at a random point of its loop. */
export function loopSource(ctx, sound, dest, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = sound.buffer; s.loop = true; s.loopStart = sound.loopStart ?? 0; s.loopEnd = sound.loopEnd ?? sound.buffer.duration;
  s.playbackRate.value = rate; s.connect(dest);
  s.start(ctx.currentTime, s.loopStart + Math.random() * (s.loopEnd - s.loopStart));
  return s;
}

/**
 * Radio: a streamed playlist (media element, so nothing is decoded up front) routed into the music bus.
 * onTrack(track) fires when a song starts.
 */
export class Radio {
  constructor(ctx, dest, onTrack) {
    this.ctx = ctx; this.onTrack = onTrack; this.tracks = []; this.i = -1;
    this.el = new window.Audio(); this.el.preload = 'auto'; this.el.crossOrigin = 'anonymous';
    if ('preservesPitch' in this.el) this.el.preservesPitch = false; // the slow-down on a lost race is a tape stop
    this.node = ctx.createMediaElementSource(this.el); this.node.connect(dest);
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('error', () => { if (this.tracks.length > 1 && !this.failed) { this.failed = true; this.next(); } });
    this.ready = fetch(new URL('tracks.json', MUSIC)).then((r) => r.json()).then((j) => { this.tracks = j.tracks; }).catch((e) => console.warn('Radio unavailable:', e));
  }
  async play() {
    await this.ready;
    if (!this.tracks.length) return;
    if (this.i < 0) return this.next(0);
    this.el.play().catch(() => {});
  }
  pause() { this.el.pause(); }
  async next(i = this.i + 1) {
    await this.ready;
    if (!this.tracks.length) return;
    this.i = i % this.tracks.length; this.failed = false;
    const t = this.tracks[this.i];
    this.el.src = new URL(t.file, MUSIC).href;
    this.el.playbackRate = 1;
    this.el.play().then(() => this.onTrack?.(t)).catch(() => {});
  }
  set rate(r) { this.el.playbackRate = r; }
}

/** Camera-relative moving source. vr is positive when closing (m/s).
 * Slew limiting bounds network/camera discontinuities; AudioParam ramps handle sample-rate interpolation.
 */
export function spatialAudio(state, source, now, reference = 16) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : 0));
  const vr = clamp(source.vr, -100, 100), distance = Math.max(0, source.d ?? source.dist ?? 0);
  const target = clamp(343 / (343 - vr), 0.72, 1.4);
  const dt = state.spatialTime == null ? 1 / 60 : clamp(now - state.spatialTime, 0, 0.1);
  const previous = state.doppler ?? 1;
  state.doppler = previous + clamp(target - previous, -1.8 * dt, 1.8 * dt);
  state.spatialTime = now;
  return { doppler: state.doppler, gain: 1 / (1 + (distance / reference) ** 1.6),
    cutoff: 600 + 15000 * Math.exp(-distance / 85), pan: clamp(source.pan, -0.95, 0.95) };
}
