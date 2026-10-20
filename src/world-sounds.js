// Recorded world sounds: ambience beds, traffic engine loops, impacts and horns (assets/audio/world, built by
// tools/build_world_audio.mjs). Everything loads in the background
// after the first key press; the game plays without any of it and each sound fades in once it arrives.
import { seamlessBuffer } from './audio/robust.js';
const WORLD = new URL('../assets/audio/world/', import.meta.url);
const ENGINES = new URL('../assets/audio/engines/', import.meta.url);
const AMBIENCE = new URL('../assets/audio/world/ambience/', import.meta.url);
const TEXTURES = new Set(['wind', 'sea-sand', 'sea-rocks', 'city', 'cafe', 'beach', 'cicadas', 'crickets', 'rain-light', 'rain-heavy', 'rain-cabin']);
const textures = new WeakMap();

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
    const sound = { buffer, rpm: m.rpm, texture: TEXTURES.has(name) || m.kind === 'texture', textureWindow: name === 'wind' ? [5, 9] : m.textureWindow };
    if (m.kind === 'loop' && m.frames) {
      const len = m.frames * ctx.sampleRate / m.sampleRate, guard = 0.3 * ctx.sampleRate;
      let off = 0;
      if (buffer.length > len + guard + 64) {
        const d = buffer.getChannelData(0), lim = Math.min(d.length, 4096);
        while (off < lim && Math.abs(d[off]) < 1e-3) off++;
        if (off >= lim) off = 0;
      }
      sound.loopStart = off / ctx.sampleRate; sound.loopEnd = (off + len) / ctx.sampleRate;
      // a loop whose end does not meet its start (rain, wipers, town) clicked once per lap: blend the seam once, here
      if (off + len <= buffer.length) { const fixed = seamlessBuffer(buffer, off, Math.round(off + len), { fade: Math.round(ctx.sampleRate * 0.05) }); if (fixed) sound.loopStart = fixed.start / ctx.sampleRate; }
    } else if (m.kind === 'loop') { sound.loopStart = 0; sound.loopEnd = buffer.duration; }
    onLoad(name, sound);
  };
  // Two at a time: the first beds arrive quickly without starving the engine recordings.
  try {
    const extra = await (await fetch(new URL('sounds.json', AMBIENCE))).json();
    for (const [name, m] of Object.entries(extra)) jobs.push([name, new URL(m.file, AMBIENCE), m]);
  } catch (e) { console.warn('Additional ambience unavailable:', e); }
  const queue = jobs.slice();
  const worker = async () => { while (queue.length) { const j = queue.shift(); try { await one(j); } catch (e) { console.warn('World sound unavailable:', j[0], e); } } };
  await Promise.all([worker(), worker()]);
}

/** A looping source started at a random point of its loop. */
export function loopSource(ctx, sound, dest, rate = 1) {
  if (sound.texture) return new TextureLoop(ctx, sound, dest, rate);
  const s = ctx.createBufferSource();
  s.buffer = sound.buffer; s.loop = true; s.loopStart = sound.loopStart ?? 0; s.loopEnd = sound.loopEnd ?? sound.buffer.duration;
  s.playbackRate.value = rate; s.connect(dest);
  s.start(ctx.currentTime, s.loopStart + Math.random() * (s.loopEnd - s.loopStart));
  return s;
}

/** Long, overlapping random excerpts: no repeated MP3 seam or fixed gust/cicada cycle.
 * Driven by the audio update clock, so a suspended/background tab never queues a burst.
 * Vehicle recordings deliberately keep the ordinary loopSource path above.
 */
class TextureLoop {
  constructor(ctx, sound, dest, rate) {
    Object.assign(this, { ctx, sound, dest, rate, next: ctx.currentTime, active: new Set() });
    // Wind speed changes the next overlapping excerpt, without repitching an active gust.
    this.playbackRate = { setTargetAtTime: value => { this.rate = Math.max(.5, Math.min(2, value)); } };
    if (!textures.has(ctx)) textures.set(ctx, new Set());
    textures.get(ctx).add(this);
    this.update(ctx.currentTime);
  }
  update(now) {
    if (now + 0.25 < this.next) return;
    const { ctx, sound } = this, at = Math.max(now, this.next);
    const start = sound.loopStart || 0, end = Math.min(sound.loopEnd || sound.buffer.duration, sound.buffer.duration);
    const rate = this.rate * (0.985 + Math.random() * 0.03);
    // First excerpt establishes the setting; short wind recordings then use varied windows
    // instead of repeatedly replaying almost their entire gust envelope.
    const [lo, hi] = (this.hasPlayed && sound.textureWindow) || [24, 37];
    const duration = Math.min((end - start) / rate, lo + Math.random() * (hi - lo));
    this.hasPlayed = true;
    const fade = Math.min(3, duration / 4), offset = start + Math.random() * Math.max(0, end - start - duration * rate);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = sound.buffer; src.playbackRate.value = rate; src.connect(g); g.connect(this.dest);
    const curve = Float32Array.from({ length: 48 }, (_, i) => Math.sin(i / 47 * Math.PI / 2));
    g.gain.setValueCurveAtTime(curve, at, fade);
    g.gain.setValueAtTime(1, at + duration - fade);
    g.gain.setValueCurveAtTime(Float32Array.from(curve).reverse(), at + duration - fade, fade);
    src.start(at, offset); src.stop(at + duration);
    this.active.add(src); src.onended = () => { src.disconnect(); g.disconnect(); this.active.delete(src); };
    this.next = at + duration - fade;
  }
  stop() { for (const src of this.active) src.stop(); textures.get(this.ctx)?.delete(this); }
}
export function updateWorldTextures(ctx, now) { for (const layer of textures.get(ctx) || []) layer.update(now); }

/** Per-map natural ambience. Existing coastline/urban route samples supply distance and direction.
 * p.mapId is the standalone/test adapter; the game's flow mapId also follows live map switches.
 */
export class WorldAmbience {
  constructor(A) {
    this.A = A; this.map = null; this.next = {}; this.srcs = {};
    this.beds = {};
    for (const name of ['farmland-wind', 'pine-wind', 'crickets']) {
      const g = A.mk.gain(), pan = A.ctx.createStereoPanner();
      A.mk.chain(g, pan, A.amb); this.beds[name] = { g, pan };
    }
    // Town sound is inland relative to the shoreline; distant murmur, no intelligible café voices.
    this.cityPan = A.ctx.createStereoPanner(); A.a.cityLP.disconnect();
    A.mk.chain(A.a.cityLP, this.cityPan, A.amb);
    A.a.cityLP.frequency.value = 1200;
  }
  update(p, now, weather) {
    const A = this.A, a = A.a;
    const map = p.mapId || (typeof window !== 'undefined' && window.__flow?.mapId) || 'riviera';
    if (map !== this.map) {
      this.map = map;
      this.next = { bird: now + 7 + Math.random() * 14, gull: now + 24 + Math.random() * 28,
        rural: now + 65 + Math.random() * 70, swell: now };
    }
    const coast = map === 'riviera', mountain = map === 'penteli';
    const v = Math.max(0, p.speed || 0);
    // Retain a faint bed at road speed; closed windows still apply the shared 2.2 kHz filter.
    // A small cabin lift keeps low-frequency shore/wind detail from disappearing with that filter.
    // Map-specific retention keeps the exposed wind and coastal beds behind the engine.
    const floor = mountain ? 0.60 : 0.72;
    const mask = (floor + (1 - floor) / (1 + (v / 5) ** 2)) * (p.open === false ? 1.26 : 1);
    const night = weather.night, rain = weather.rain, life = (1 - rain * 0.95) * (1 - night);
    const sea = coast ? Math.max(0, Math.min(1, p.sea || 0)) : 0;
    const city = coast ? Math.max(0, Math.min(1, p.city || 0)) : 0;
    const pan = Math.max(-0.85, Math.min(0.85, p.seaPan ?? 0.6));
    const level = (g, value, tc = 1.5) => g.gain.setTargetAtTime(value, now, tc);
    a.seaPan.pan.setTargetAtTime(pan, now, 0.6);
    a.seaLP.frequency.setTargetAtTime(750 + 9000 * sea * sea, now, 0.8);
    level(a.sand, 0.40 * sea ** 1.3 * (1 - (p.cliff || 0)) * mask);
    level(a.rocks, 0.35 * sea ** 1.3 * (p.cliff || 0) * mask);
    this.cityPan.pan.setTargetAtTime(-pan * 0.6, now, 0.8);
    level(a.city, 0.13 * city * mask * (1 - night * 0.65));
    // Crowded beach/café loops contained conspicuous voices/bells; keep them out of the quiet bed.
    level(a.cafe, 0); level(a.beach, 0);
    level(a.cic, (coast ? 0.15 : mountain ? 0.035 : 0.075) * Math.min(1.2, p.cicadas ?? 1) * life * mask);
    level(a.gulls, 0.15 * mask * life);
    if (now >= this.next.swell) {
      this.next.swell = now + 9 + Math.random() * 17;
      level(a.cicSwell, 0.65 + Math.random() * 0.35, 3);
      this.beds['pine-wind'].pan.pan.setTargetAtTime((Math.random() - 0.5) * 0.35, now, 5);
    }
    for (const [name, bed] of Object.entries(this.beds)) {
      const target = name === 'crickets' ? 0.13 * night * (1 - rain * 0.95) * (mountain ? 0.5 : 1) * (1 - city * 0.6) :
        name === 'pine-wind' ? (mountain ? 0.37 : 0) : map === 'megara' ? 0.24 : coast ? 0.045 : 0;
      if (target && !this.srcs[name] && A.S[name]) this.srcs[name] = loopSource(A.ctx, A.S[name], bed.g);
      level(bed.g, target * mask * (name === 'crickets' ? 1 : (1 - night * 0.35) * (1 + rain * 0.4)));
    }
    if (now >= this.next.bird) {
      this.next.bird = now + 20 + Math.random() * 35;
      if (life > 0.2 && v < 25) this.shot('birds', now, (mountain ? 0.045 : 0.065) * life * mask, (Math.random() - 0.5) * 1.5, 2 + Math.random() * 3, 5200);
    }
    if (now >= this.next.gull) {
      this.next.gull = now + 35 + Math.random() * 50;
      if (sea > 0.3 && life > 0.2 && v < 22) this.shot('gulls', now, 0.06 * sea * life * mask, pan, 2 + Math.random() * 2, 4200);
    }
    if (now >= this.next.rural) {
      this.next.rural = now + 80 + Math.random() * 100;
      if (map === 'megara' && v < 18 && rain < 0.5) {
        const tractor = night === 0 && Math.random() < 0.45;
        this.shot(tractor ? 'distant-tractor' : 'distant-dog', now, (tractor ? 0.07 : 0.045) * mask, (Math.random() < 0.5 ? -1 : 1) * 0.65, tractor ? 8 : 3, tractor ? 650 : 1800);
      }
    }
    updateWorldTextures(A.ctx, now);
  }
  shot(name, now, volume, pan, duration, cutoff) {
    const A = this.A, sound = A.S[name]; if (!sound) return;
    const src = A.ctx.createBufferSource(), g = A.mk.gain(), lp = A.mk.filt('lowpass', cutoff, 0.5), pn = A.ctx.createStereoPanner();
    src.buffer = sound.buffer; pn.pan.value = pan;
    duration = Math.min(duration, sound.buffer.duration); const offset = Math.random() * (sound.buffer.duration - duration);
    A.mk.chain(src, lp, g, pn, A.amb);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(volume, now + 0.15);
    g.gain.setValueAtTime(volume, now + duration - 0.35); g.gain.linearRampToValueAtTime(0, now + duration);
    src.start(now, offset, duration); src.onended = () => { src.disconnect(); lp.disconnect(); g.disconnect(); pn.disconnect(); };
  }
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
