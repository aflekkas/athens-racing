import { MusicSources } from './music-sources.js';
import { preloadEngine, loadRecordedEngine, recordingFor, RecordedEngineVoice } from './engine-recordings.js';
import { loadWorldSounds, loopSource, spatialAudio } from './world-sounds.js';
import { WeatherAudio } from './weather-audio.js';
import { Sirens } from './sirens.js';

// Recorded player/rival engines with procedural fallback; recorded world (WebAudio).
// Starts on the first key press / click (autoplay policy).
//  - player engine: local field-recorded RPM loops and ignition one-shots; fallback firing-order pulse models
//    (turbo inline-three/four/six, NA four, warbly five-cylinder, flat-six, V12, turbo-diesel), four RPM points x on/off
//    load, equal-power crossfaded like a multi-sample engine; intake roar, turbo spool / blow-off / flutter,
//    transmission whine, rev-limiter stutter, shift clunks, overrun burble and exhaust pops
//  - tyres: recorded squeal tied to slip (pitched for wheelspin and lock-up), scrub; road roar per surface,
//    suspension thumps over joints and bumps, gravel; recorded wind rising with speed (louder roof-down), cabin
//    filtering when the roof is up
//  - traffic: a pool of positional voices on the nearest vehicles (recorded petrol / diesel / bus / scooter loops)
//    with doppler, distance filtering and panning; recorded horns and impacts, bus air brakes; the rival's engine
//  - ambience recorded on Greek and Mediterranean coasts, following the route: waves on sand in the bays and on the
//    rocks below the cliffs (on the shore side, muffled with distance), Athens traffic and café murmur in town, beach
//    crowds at Vouliagmeni / Limanakia, cicadas swelling in the pines, gulls
//  - radio: a streamed playlist that ducks under the action; master bus compressor; synth fallbacks until loaded

import { ENGINE_SOUND, buildEngineBank, EngineVoice, rng32 } from './audio/engine-synth.js';
export { ENGINE_SOUND, buildEngineBank, EngineVoice } from './audio/engine-synth.js';
import { engineProfile } from './audio/engine-profiles.js';
import { ExternalEngines } from './audio/engine-spatial.js';
import { EngineLifecycle } from './audio/engine-lifecycle.js';

const MIDI = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PLAYER_ENGINE_LEVEL = 0.75;
const MUSIC_LEVEL = 0.35;
const MENU_MUSIC_LEVEL = 0.62;
// Mix controls are independent of legacy sfx (which still scales every non-music bus).
export const AUDIO_DEFAULTS = Object.freeze({ master: 0.6, music: 0.55, sfx: 1, engine: 0.85, tyres: 0.28, ambience: 0.5, traffic: 0.65, voice: 0.65, ui: 0.4 });
const clampAudio = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

/** One detail budget across rivals and traffic, so separate pools cannot each fill the foreground. */
export function externalEngineWeights(rivals = [], traffic = []) {
  const weights = { rivals: new Map(), traffic: new Map() };
  const candidates = Object.entries({ rivals, traffic }).flatMap(([kind, list]) => list
    .filter(source => Number.isFinite(source.d ?? source.dist) && (source.d ?? source.dist) < 260)
    .map(source => ({ kind, source, distance: source.d ?? source.dist })));
  candidates.sort((a, b) => a.distance - b.distance);
  candidates.forEach(({ kind, source }, index) => weights[kind].set(source.id, index < 6 ? 1 : 0.18));
  return weights;
}

export class AudioMix {
  constructor(ctx, volumes = AUDIO_DEFAULTS) {
    this.ctx = ctx;
    const gain = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -5; this.limiter.knee.value = 6; this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.16;
    this.limiter.connect(ctx.destination);
    // Live race calibration: leave transients clear without continuously driving the limiter.
    this.calibration = gain(1.5, this.limiter);
    this.master = gain(1, this.calibration);
    this.sfx = gain(1, this.master);
    this.worldDuck = gain(1, this.sfx);
    this.buses = {};
    for (const name of ['engine', 'tyres', 'ambience', 'traffic', 'voice', 'ui', 'music']) {
      this.buses[name] = gain(1, name === 'music' ? this.master : name === 'ui' ? this.sfx : this.worldDuck);
    }
    this.setVolumes(volumes, 0);
  }
  setVolumes(volumes, now = this.ctx.currentTime) {
    this.volumes = { ...AUDIO_DEFAULTS, ...this.volumes, ...volumes };
    for (const [key, node] of Object.entries({ master: this.master, sfx: this.sfx, ...this.buses })) {
      node.gain.setTargetAtTime(clampAudio(this.volumes[key]), now, 0.04);
    }
  }
  setMenu(open, now = this.ctx.currentTime) {
    if (this.menu === !!open) return;
    this.menu = !!open;
    // ~98% of an 18 dB change in 0.4 s. A single duck stage avoids double attenuation.
    this.worldDuck.gain.setTargetAtTime(open ? Math.pow(10, -18 / 20) : 1, now, 0.1);
  }
}

/** Map actual FL/FR/RL/RR contact patches to sound. sx/sy are normalized to the tyre's grip peak. */
export function tyreParameters(w, speed, surface = 'asphalt', nominalLoad = 3500) {
  const loadRatio = clampAudio((w.Fz ?? nominalLoad) / Math.max(1, nominalLoad), 0, 2);
  const load = Math.sqrt(loadRatio);
  const slip = Math.hypot(w.sx ?? ((w.slipRatio || 0) / 0.12), w.sy ?? (Math.tan(w.aDyn ?? w.slipAngle ?? 0) / Math.tan(0.12)));
  const patch = Math.abs(w.vgx ?? speed), spinSpeed = Math.abs(w.vw ?? speed);
  const motion = clampAudio(Math.max(patch, spinSpeed) / 7);
  const soft = /gravel|dirt|sand|grass|scrub|verge|water/.test(surface);
  const kerb = /kerb|curb|pavement|rumble/.test(surface);
  const grain = /gravel|rock/.test(surface) ? 1 : /sand|dirt/.test(surface) ? 0.65 : soft ? 0.35 : 0;
  const scrub = clampAudio((slip - 0.82) / 0.23);
  const squealEligible = !soft && loadRatio >= .20 && Math.abs(speed) > 25 / 3.6;
  const squeal = squealEligible ? Math.pow(clampAudio((slip - 1.10) / .65), 1.15) : 0;
  const signedSlip = (w.sx ?? 0) * (w.vgx < 0 ? -1 : 1);
  const lock = signedSlip < -1 && patch > 2;
  return {
    roll: load * clampAudio(patch / 42) * (soft ? 0.055 : 0.012),
    rollHz: (soft ? 480 : 140) + Math.min(1600, patch * (soft ? 26 : 12)),
    scrub: load * motion * scrub * (soft ? 0.025 : 0.07) * (1 - squeal * 0.55),
    howl: soft ? 0 : load * motion * scrub * 0.025 * (1 - squeal * 0.7),
    squeal: load * motion * squeal * (soft ? 0.008 : 0.11),
    // Stick/slip resonances rise with sliding speed; locked rubber has a lower, rougher howl.
    pitch: clampAudio(800 + Math.max(0, slip - 0.98) * 1050 + patch * 2 + Math.max(0, signedSlip) * 20 - (lock ? 100 : 0), 700, 2400),
    grit: load * motion * grain * (0.04 + 0.018 * Math.min(3, slip)),
    rumble: kerb ? load * clampAudio(patch / 18) * 0.065 : 0,
    rumbleHz: clampAudio(patch / 0.45, 12, 170), lock, slip, squealEligible,
  };
}

// Onset/release use different slip thresholds; level still follows excess above 1.10.
export function tyreSquealActive(active, parameters) {
  return parameters.squealEligible && parameters.slip > (active ? 1.06 : 1.14);
}

/** Four decorrelated contact-patch voices; no downloaded squeal is needed before the first corner. */
export class TyreVoice {
  constructor(ctx, dest, index) {
    this.ctx = ctx; this.index = index;
    const gain = (value = 0) => { const n = ctx.createGain(); n.gain.value = value; return n; };
    const filter = (type, hz, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = hz; n.Q.value = q; return n; };
    const chain = (...nodes) => nodes.slice(1).forEach((n, i) => nodes[i].connect(n));
    const osc = (hz, type = 'sine') => { const n = ctx.createOscillator(); n.type = type; n.frequency.value = hz; n.start(); return n; };
    const n = ctx.sampleRate * 19, noise = ctx.createBuffer(1, n, ctx.sampleRate), data = noise.getChannelData(0), rand = rng32(817 + index * 333);
    let brown = 0;
    for (let i = 0; i < n; i++) { brown = 0.96 * brown + (rand() * 2 - 1) * 0.12; data[i] = brown + (rand() * 2 - 1) * 0.4; }
    // Crossfade the seam once, preserving continuous value/slope during repetition.
    const seam = Math.floor(ctx.sampleRate * 0.04);
    for (let i = 0; i < seam; i++) data[n - seam + i] = data[n - seam + i] * (1 - i / seam) + data[i] * (i / seam);
    this.noise = ctx.createBufferSource(); this.noise.buffer = noise; this.noise.loop = true; this.noise.loopStart = seam / ctx.sampleRate;
    this.noise.start(0, rand() * noise.duration);
    // Player contact patches stay centred even when one loaded wheel dominates.
    // Axles retain independent texture and filtering, without head-fixed left/right bias.
    this.axle = filter('lowpass', index < 2 ? 9500 : 6200);
    // Preserve the removed equal-power panner's centre gain (no 3 dB loudness jump).
    this.center = gain(Math.SQRT1_2); chain(this.axle, this.center, dest);
    this.roll = gain(); this.rollLP = filter('lowpass', 400); this.cavity = filter('peaking', 205, 1.1); this.cavity.gain.value = 2; chain(this.noise, this.rollLP, this.cavity, this.roll, this.axle);
    this.scrubLP = filter('lowpass', 1200, 0.7); this.scrubLP.connect(this.axle);
    this.scrub = gain(); this.scrubBP = filter('bandpass', 580, 1.8); chain(this.noise, this.scrubBP, this.scrub, this.scrubLP);
    this.howl = gain(); this.howlBP = filter('bandpass', 460, 3); chain(this.noise, this.howlBP, this.howl, this.scrubLP);
    this.waverRandom = rng32(3081 + index * 731); this.nextWaver = 0; this.waver = 0;
    this.grit = gain(); this.gritBP = filter('bandpass', 2500, 0.6); chain(this.noise, this.gritBP, this.grit, this.axle);
    this.rumble = gain(); this.rumbleOsc = osc(40, 'triangle'); chain(this.rumbleOsc, this.rumble, this.axle);
    // Rubber is a cluster of noisy stick/slip modes, not three clean sine oscillators.
    // Each harmonic has two detuned, independently wandering resonances per contact patch.
    // All squeal paths (synthesis, recording and lock chirp) share the same -7 dB trim.
    this.squealBus = gain(Math.pow(10, -7 / 20)); this.squealBus.connect(this.axle);
    this.squealActive = false; this.squealTarget = 0;
    this.squeal = gain(); this.squealFlutter = gain(1); chain(this.squeal, this.squealFlutter, this.squealBus);
    this.squealModes = [];
    for (const [harmonic, level] of [[1, 15.2], [2, 6.4], [3, 1.92]]) {
      for (const detune of [0.977, 1.026]) {
        const band = filter('bandpass', 850 * harmonic * detune, 11 + harmonic * 2), amp = gain(level);
        chain(this.noise, band, amp, this.squeal);
        this.squealModes.push({ band, harmonic, detune, wander: 0 });
      }
    }
    this.nextFlutter = 0; this.nextChatter = 0; this.chatterUntil = 0;
    this.chirp = gain(); this.chirpOsc = osc(1200); chain(this.chirpOsc, this.chirp, this.squealBus);
  }
  attachRecording(sound) {
    if (this.recording) return;
    this.recordGain = this.ctx.createGain(); this.recordGain.gain.value = 0;
    this.recordGain.connect(this.squealBus);
    this.recording = loopSource(this.ctx, sound, this.recordGain, 0.95 + this.index * 0.025);
  }
  set(w, speed, surface, nominalLoad, now) {
    const p = tyreParameters(w, speed, surface, nominalLoad);
    this.squealActive = tyreSquealActive(this.squealActive, p);
    p.squeal = this.squealActive ? p.squeal : 0;
    const squealTime = p.squeal > this.squealTarget ? .12 : .20;
    this.squealTarget = p.squeal;
    for (const key of ['roll', 'scrub', 'howl', 'grit', 'rumble']) this[key].gain.setTargetAtTime(p[key], now, .055);
    this.squeal.gain.setTargetAtTime(p.squeal, now, squealTime);
    if (this.recording) {
      this.recordGain.gain.setTargetAtTime(p.squeal * 0.85, now, squealTime);
      this.recording.playbackRate.setTargetAtTime(clampAudio(p.pitch / 850, 0.7, 1.65) * (0.97 + this.index * 0.018), now, 0.07);
    }
    this.rollLP.frequency.setTargetAtTime(p.rollHz, now, 0.09);
    this.cavity.frequency.setTargetAtTime(180 + Math.min(70,Math.abs(speed)*1.5),now,.12);
    this.cavity.gain.setTargetAtTime(/asphalt|concrete/.test(surface)?2:0,now,.12);
    this.scrubBP.frequency.setTargetAtTime(360 + Math.min(1.4, p.slip) * 180 + Math.abs(speed) * 3, now, 0.06);
    // Renew random targets at 4–12 Hz; no oscillator LFO, repeated grain clock or fixed vibrato.
    if (now >= this.nextWaver) {
      this.waver = (this.waverRandom() * 2 - 1) * 0.038;
      for (const mode of this.squealModes) mode.wander = (this.waverRandom() * 2 - 1) * 0.012;
      this.noise.playbackRate.setTargetAtTime(0.96 + this.waverRandom() * 0.08, now, 0.25);
      this.nextWaver = now + 1 / (4 + this.waverRandom() * 8);
    }
    const fundamental = p.pitch * (0.985 + this.index * 0.011) * (1 + this.waver);
    this.howlBP.frequency.setTargetAtTime((300 + Math.min(1.1, p.slip) * 240 + Math.abs(speed) * 1.2) * (1 + this.waver * 0.5), now, 0.06);
    for (const mode of this.squealModes) mode.band.frequency.setTargetAtTime(fundamental * mode.harmonic * mode.detune * (1 + mode.wander), now, 0.018);
    if (now >= this.nextFlutter) {
      if (now >= this.nextChatter) {
        this.chatterUntil = now + 0.015 + this.waverRandom() * 0.025;
        this.nextChatter = now + 0.07 + this.waverRandom() * 0.3;
      }
      const flutter = (0.7 + this.waverRandom() * 0.55) * (now < this.chatterUntil ? 0.35 : 1);
      this.squealFlutter.gain.setTargetAtTime(flutter, now, 0.008);
      this.nextFlutter = now + 0.018 + this.waverRandom() * 0.035;
    }
    this.rumbleOsc.frequency.setTargetAtTime(p.rumbleHz, now, 0.035);
    if (p.lock && !this.locked && p.squeal > 0) {
      this.chirp.gain.cancelScheduledValues(now); this.chirp.gain.setValueAtTime(0, now);
      this.chirp.gain.linearRampToValueAtTime(p.squeal * 0.7, now + 0.008);
      this.chirp.gain.exponentialRampToValueAtTime(0.00001, now + 0.13);
      this.chirp.gain.linearRampToValueAtTime(0, now + 0.15);
      this.chirpOsc.frequency.setValueAtTime(p.pitch * 1.65, now);
      this.chirpOsc.frequency.exponentialRampToValueAtTime(p.pitch, now + 0.13);
    }
    this.locked = p.lock;
    return p;
  }
}

export class Audio {
  constructor() { this.ctx = null; this.musicOn = false; this.started = false; this.engineSpec = null; this.duckEv = 0; this.banks = {}; this.engineRevision = 0; this.recordingState = 'idle'; this.weather = new WeatherAudio(this); this.sirens = new Sirens(this); this.vol = { ...AUDIO_DEFAULTS }; this.rivals = new Map(); this.musicSources = new MusicSources(this); this.lifecycle = new EngineLifecycle(this); }

  start({ context, recordings = true, radio = true } = {}) {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!context && !AC) return;
    const ctx = this.ctx = context || new AC();
    this.started = true;
    const sr = ctx.sampleRate;
    this.mix = new AudioMix(ctx, this.vol);
    this.master = this.mix.sfx; this.mainOut = this.mix.master;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; this.mix.limiter.connect(this.analyser);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.55; this.sfx.connect(this.mix.worldDuck);
    this.uiBus = this.mix.buses.ui;
    this.engineLP = ctx.createBiquadFilter(); this.engineLP.type = 'lowpass'; this.engineLP.frequency.value = 16000;
    // Preserve engine feedback while the master/headroom stages and surrounding voices become quieter.
    this.eng = ctx.createGain(); this.eng.channelCount = 1; this.eng.channelCountMode = 'explicit'; this.eng.gain.value = PLAYER_ENGINE_LEVEL; this.eng.connect(this.engineLP); this.engineLP.connect(this.mix.buses.engine);
    this.chassis = ctx.createGain(); this.chassis.channelCount = 1; this.chassis.channelCountMode = 'explicit'; this.chassis.gain.value = 0.7;
    this.roadLP = ctx.createBiquadFilter(); this.roadLP.type = 'lowpass'; this.roadLP.frequency.value = 14000; this.roadLP.Q.value = 0.5;
    this.roadCabin = ctx.createGain(); this.chassis.connect(this.roadLP); this.roadLP.connect(this.roadCabin); this.roadCabin.connect(this.mix.buses.tyres);
    this.cabinLP = ctx.createBiquadFilter(); this.cabinLP.type = 'lowpass'; this.cabinLP.frequency.value = 14000; this.cabinLP.Q.value = 0.5;
    // Each external bus has its own cabin filter, preserving independent volume controls.
    this.ext = ctx.createGain(); this.ext.gain.value = 1; this.ext.connect(this.cabinLP); this.cabinLP.connect(this.mix.buses.traffic);
    this.ambLP = ctx.createBiquadFilter(); this.ambLP.type = 'lowpass'; this.ambLP.frequency.value = 14000;
    this.amb = ctx.createGain(); this.amb.gain.value = 0.45; this.amb.connect(this.ambLP); this.ambLP.connect(this.mix.buses.ambience);
    this.trafficBus = ctx.createGain(); this.trafficBus.gain.value = 0.32; this.trafficBus.connect(this.ext);
    if (typeof document !== 'undefined' && !context) {
      this.menuObserver = new MutationObserver(() => this.syncMenu());
      this.menuObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      this.syncMenu();
    }
    // reverb send (synthetic plate) for sfx and music
    this.verb = ctx.createConvolver();
    { const L = Math.floor(sr * 1.4), ir = ctx.createBuffer(2, L, sr); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < L; i++) { const k = 0.85 - 0.75 * i / L; lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * Math.pow(1 - i / L, 3.6) * 0.6; } } this.verb.buffer = ir; } // tail darkens as it decays
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.2; this.verbIn.connect(this.verb); this.verb.connect(this.mix.worldDuck);
    this.sfx.connect(this.verbIn);
    // noise buffers
    const mkNoise = (secs, color) => {
      const len = Math.floor(sr * secs), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (color === 'pink') { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2; }
        else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else d[i] = w;
      }
      return b;
    };
    this.white = mkNoise(2, 'white'); this.pink = mkNoise(4, 'pink'); this.brown = mkNoise(4, 'brown');
    const loopSrc = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s; };
    this.loopSrc = loopSrc;
    const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
    const filt = (type, f, q = 1) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
    this.mk = { chain, filt, gain, osc };

    // --- ENGINE extras (the engine voice itself is created per car in setEngine)
    const x = {};
    x.intake = loopSrc(this.pink); x.intakeBP = filt('bandpass', 500, 0.9); x.intakeG = gain(); chain(x.intake, x.intakeBP, x.intakeG, this.eng);
    x.turbo = osc('sine', 2500); x.turbo2 = osc('sine', 5000); x.turboG = gain(); x.turbo2G = gain(0.3);
    x.turbo.connect(x.turboG); chain(x.turbo2, x.turbo2G, x.turboG); x.turboG.connect(this.eng);
    x.compressorAir = loopSrc(this.white); x.compressorBP = filt('bandpass', 3200, .8); x.compressorG = gain(); chain(x.compressorAir, x.compressorBP, x.compressorG, this.eng);
    x.whine = osc('sine', 600); x.whineG = gain(); chain(x.whine, x.whineG, this.eng);
    x.nitro = loopSrc(this.white); x.nitroBP = filt('bandpass', 2400, 0.7); x.nitroG = gain(); chain(x.nitro, x.nitroBP, x.nitroG, this.eng);
    this.x = x;

    // --- TYRES / ROAD / SUSPENSION / WIND
    const t = {};
    this.tyres = Array.from({ length: 4 }, (_, i) => new TyreVoice(ctx, this.chassis, i));
    // wind: recorded gusts, brighter and faster with speed; a slow gust swell on top
    t.windLP = filt('lowpass', 900, 0.5); t.windMod = gain(1); t.windG = gain(); chain(t.windLP, t.windMod, t.windG, this.chassis);
    t.gust = osc('sine', 0.13); t.gustG = gain(0.25); chain(t.gust, t.gustG, t.windMod.gain);
    t.whistle = loopSrc(this.white); t.whistleBP = filt('bandpass', 2200, 14); t.whistleG = gain(); chain(t.whistle, t.whistleBP, t.whistleG, this.chassis);
    this.t = t;

    // --- AMBIENCE beds (recorded; each fades in when it arrives): sea on the shore side, muffled with distance
    const a = {};
    a.seaLP = filt('lowpass', 12000, 0.5); a.seaPan = ctx.createStereoPanner(); chain(a.seaPan, a.seaLP, this.amb);
    a.sand = gain(); a.rocks = gain(); a.sand.connect(a.seaPan); a.rocks.connect(a.seaPan);
    a.city = gain(); a.cityLP = filt('lowpass', 5000, 0.5); chain(a.city, a.cityLP, this.amb);
    a.cafe = gain(); a.beach = gain(); a.cic = gain(); a.cicSwell = gain(1); a.gulls = gain(0.7);
    a.cafe.connect(this.amb); a.beach.connect(this.amb); chain(a.cic, a.cicSwell, this.amb); a.gulls.connect(this.amb);
    this.a = a;
    const now = ctx.currentTime;
    this.nextGull = now + 3; this.nextHorn = now + 6; this.nextCic = now; this.nextScoot = now + 5;

    // --- TRAFFIC voices (assigned each frame to the nearest vehicles): recorded idle + running loops crossfaded by
    // rpm, an electric whine, and tyre roll
    this.externalEngines = new ExternalEngines(ctx, this.trafficBus, (level, pan) => this.passBy(level, pan));

    // --- RADIO
    this.musicBus = gain(0);
    this.musicLP = filt('lowpass', 12000, 0.7);
    this.musicDuck = gain(1);
    this.musicVol = this.mix.buses.music; // the music volume setting (setVolumes)
    chain(this.musicBus, this.musicDuck, this.musicLP, this.musicVol);
    this.radio = this.musicSources; this.musicSources.attach(radio);
    if (this.musicOn) { this.radio.play(); this.musicBus.gain.setTargetAtTime(this.mix.menu ? MENU_MUSIC_LEVEL : MUSIC_LEVEL, ctx.currentTime, 1.2); }

    // --- recorded world sounds
    this.S = {};
    this.worldReady = recordings ? loadWorldSounds(ctx, (name, snd) => { this.S[name] = snd; this.attach(name, snd); }).catch(error => console.warn('World audio unavailable:', error)) : Promise.resolve();
    if (this.engineSpec) { const s = this.engineSpec; this.engineSpec = null; this.setEngine(s); }
  }

  /** Select by car ID as well as engine: two cars can have different recordings. */
  setEngine(spec) {
    preloadEngine(spec);
    if (this.engineSpec?.id === spec.id && this.engineSpec.engine === spec.engine && this.engineSpec.redline === spec.redline && this.engineVoice) { this.engineSpec = spec; return; }
    this.engineSpec = spec;
    if (!this.ctx) return;
    const revision = ++this.engineRevision;
    this.cancelIgnition(); this.recordedBank = null;
    this.profile = engineProfile(spec);
    const key = this.profile.synth + '@' + spec.idle + '@' + spec.redline;
    const bank = this.banks[key] || (this.banks[key] = buildEngineBank(this.ctx, this.profile.synth, spec.idle, spec.redline));
    this.installEngineVoices(bank, spec);
    this.recordingState = recordingFor(spec) ? 'loading' : 'procedural';
    this.requestIgnition();
    this.engineReady = loadRecordedEngine(this.ctx, spec).then(recorded => {
      // A slow earlier car must never replace a newer selection.
      if (revision !== this.engineRevision || !recorded) return;
      this.recordedBank = recorded;
      this.installEngineVoices(recorded, spec);
      this.recordingState = 'recorded';
      this.playPendingIgnition();
    }).catch(error => {
      if (revision !== this.engineRevision) return;
      this.recordingState = 'fallback'; this.pendingIgnition = null;
      if (this.lastSpeed < 2) this.lifecycle.start(this.ctx.currentTime);
      console.warn('Recorded engine unavailable; using procedural engine.', error);
    });
  }

  installEngineVoices(bank, spec) {
    this.engineVoice?.stop();
    const profile = this.profile || engineProfile(spec);
    this.engineVoice = bank.recorded
      ? new RecordedEngineVoice(this.ctx, bank, this.eng, spec, profile.gain)
      : new EngineVoice(this.ctx, bank, this.eng, profile.gain);
    this.E = ENGINE_SOUND[profile.synth] || ENGINE_SOUND.turbo4;
  }

  cancelIgnition() {
    this.pendingIgnition = null; this.ignitionAt = null;
    if (this.ignitionSource) {
      const source = this.ignitionSource, gain = this.ignitionGain, now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(0, now, .015);
      source.stop(now + .08); this.ignitionSource = null;
    }
  }

  requestIgnition() {
    if (!this.ctx) return;
    if (!recordingFor(this.engineSpec) || this.recordingState === 'fallback') {
      if (this.lastIgnitionRequest != null && this.ctx.currentTime - this.lastIgnitionRequest < .1) return;
      this.lastIgnitionRequest = this.ctx.currentTime;
      this.cancelIgnition(); this.lifecycle.start(this.ctx.currentTime); return;
    }
    // setEngine + restart can happen in the same frame.
    if (this.lastIgnitionRequest != null && this.ctx.currentTime - this.lastIgnitionRequest < .1 && (this.pendingIgnition != null || this.ignitionSource)) return;
    this.cancelIgnition();
    this.lastIgnitionRequest = this.pendingIgnition = this.ctx.currentTime;
    this.lifecycle.start(this.ctx.currentTime, true);
    this.playPendingIgnition();
  }

  playPendingIgnition() {
    if (!this.recordedBank || this.pendingIgnition == null) return;
    const now = this.ctx.currentTime, age = now - this.pendingIgnition;
    this.pendingIgnition = null;
    // Never play a delayed ignition over a car that is already driving.
    if (age > 3 || (this.lastSpeed || 0) > 2) return;
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    source.buffer = this.recordedBank.start; gain.gain.value = .9;
    source.connect(gain); gain.connect(this.eng);
    this.lifecycle.start(now, true);
    this.ignitionAt = now; this.ignitionSource = source; this.ignitionGain = gain;
    source.onended = () => { source.disconnect(); gain.disconnect(); if (this.ignitionSource === source) this.ignitionSource = null; };
    source.start(now);
  }

  engineStartLevel(now) {
    if (this.pendingIgnition != null && now - this.pendingIgnition < 3) return 0;
    if (this.ignitionAt == null || !this.recordedBank) return 1;
    // Starter -> firing/catch -> running engine. Do not pitch-shift the starter.
    return Math.max(0, Math.min(1, (now - this.ignitionAt - this.recordedBank.catchAt) / .6));
  }

  engineOff() {
    if (!this.ctx) return;
    this.cancelIgnition(); this.lifecycle.stop(this.ctx.currentTime);
    // Quitting can stop the render loop, so schedule the fade in audio time.
    this.engineVoice?.set(this.engineSpec?.idle || 800, 0, 0, this.ctx.currentTime);
    if (this.x) { this.x.intakeG.gain.setTargetAtTime(0, this.ctx.currentTime, .08); this.x.turboG.gain.setTargetAtTime(0, this.ctx.currentTime, .08); this.x.compressorG.gain.setTargetAtTime(0, this.ctx.currentTime, .08); this.x.whineG.gain.setTargetAtTime(0, this.ctx.currentTime, .08); this.x.nitroG.gain.setTargetAtTime(0, this.ctx.currentTime, .08); }
  }

  toggleMusic() { return this.musicSources.toggle(); }
  /** Skip only the chosen local/built-in source; Off never starts the radio. */
  nextTrack() { if (this.ctx) void this.musicSources.next(); }

  /** hook a recorded sound into the graph built in start() */
  attach(name, snd) {
    this.externalEngines?.attachWorld(name, snd);
    const ctx = this.ctx, t = this.t, a = this.a;
    const bed = { 'sea-sand': a.sand, 'sea-rocks': a.rocks, city: a.city, cafe: a.cafe, beach: a.beach, cicadas: a.cic }[name];
    if (bed) loopSource(ctx, snd, bed);
    else if (name === 'wind') t.wind = loopSource(ctx, snd, t.windLP, 0.8);
    else if (name === 'tyre-squeal') for (const wheel of this.tyres) wheel.attachRecording(snd);

  }
  /** play a recorded one-shot; returns false when it has not loaded (callers fall back to synthesis) */
  sample(name, { gain = 1, rate = 1, pan = 0, at = 0, bus, offset = 0, dur, lp } = {}) {
    const snd = this.S && this.S[name];
    if (!snd) return false;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const s = ctx.createBufferSource(); s.buffer = snd.buffer; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    const pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan));
    let node = s;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; s.connect(f); node = f; }
    node.connect(g); g.connect(pn); pn.connect(bus || this.sfx);
    if (dur) { const fi = Math.min(0.4, dur * 0.2), fo = Math.min(0.6, dur * 0.3); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + fi); g.gain.setValueAtTime(gain, t + dur - fo); g.gain.linearRampToValueAtTime(0, t + dur); }
    s.start(t, offset, dur); s.onended = () => pn.disconnect();
    return true;
  }


  // ------------------------------------------------------------------ per-frame
  /**
   * p: { wheels: FL/FR/RL/RR corners (sx/sy normalized slip, Fz N, vw/vgx m/s), surfaces, nominalLoad,
   *      rivals: [{id, spec, rpm, load, d, pan, vr}], menuOpen, dt, rpm, redline, load (-1..1), throttle, gear, shift (+1/-1 event), limiter, boost, speed (m/s), skid, wheelspin, lockup,
   *      bump (0..1 event), rough, offroad, nitro, open (roof down / outside cam), muted, sea (0..1), seaPan, city, beach, cicadas,
   *      damage: {rear: 0..1}, action (0..1), rival: {rpm, load, dist, pan, vr}, traffic: [{id, kind, electric, d, pan, vr, v, acc}] }
   */
  update(p) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = p.audioTime ?? ctx.currentTime, x = this.x, t = this.t, a = this.a;
    const v = Math.max(0, p.speed), red = p.redline || 7000, rn = Math.min(1.1, p.rpm / red);
    const load = p.muted ? 0 : p.load, E = this.E || ENGINE_SOUND.turbo4;
    this.menuRequested = !!(p.menuOpen || p.muted); this.syncMenu(now);
    const mute = 1;
    // ---- engine
    this.lastSpeed = v;
    this.lifecycle.update(p, now, this.engineSpec?.idle);
    if (this.lifecycle.shiftStarted) this.shiftCutUntil = now + (this.lifecycle.shiftKind === 'auto' ? .035 : this.lifecycle.shiftKind === 'dct' ? .065 : (p.shiftDuration ?? p.shiftStart?.duration ?? .12));
    if (this.lifecycle.shiftEnded) this.shiftCutUntil = now;
    const startLevel = this.lifecycle.level * this.engineStartLevel(now) * (now < (this.shiftCutUntil || 0) ? (this.lifecycle.shiftKind === 'auto' ? .75 : .18) : 1);
    this.updateExhaustRattle(p, now, startLevel);
    if (this.engineVoice) this.engineVoice.set(this.lifecycle.rpm, load, mute * startLevel, now, 1, p.limiter);
    const on = Math.max(0, load) * startLevel;
    x.intakeBP.frequency.setTargetAtTime(260 + rn * 2600, now, 0.05);
    x.intakeG.gain.setTargetAtTime(mute * on * (p.open ? 0.02 + 0.045 * rn : 0.025 + 0.085 * rn), now, 0.05);
    const boost = p.boost || 0, tb = this.profile?.turbo ? (E.knock ? .6 : 1) : 0;
    x.turbo.frequency.setTargetAtTime(1800 + boost * 5200 * (0.6 + 0.4 * rn), now, 0.06);
    x.turbo2.frequency.setTargetAtTime((1800 + boost * 5200 * (0.6 + 0.4 * rn)) * 2.01, now, 0.06);
    x.turboG.gain.setTargetAtTime(mute * tb * boost * boost * 0.006, now, 0.05);
    x.compressorBP.frequency.setTargetAtTime(1800 + boost * 3600, now, .10);
    x.compressorG.gain.setTargetAtTime(tb * boost * boost * .013 * startLevel, now, .08);
    // blow-off valve / wastegate flutter when the throttle snaps shut on boost
    const lift = (this.lastLoad ?? 0) > 0.3 && load < 0.05;
    if (lift && tb && boost > 0.35) {
      if (E === ENGINE_SOUND.turbo5) this.flutter(boost); else this.noise({ dur: 0.45, f: 2400, sweep: 900, type: 'bandpass', q: 0.7, gain: 0.06 * boost * tb, attack: 0.01, bus: this.eng });
    }
    // overrun: burble and pops from hot exhausts after a lift at high rpm, and on the upshift ignition cut
    const crackle = this.profile?.pops ?? 0;
    if ((lift || p.overrun && !this.lastOverrun) && rn > .42) this.overrunUntil = now + .7 + crackle * .9;
    if ((p.overrun ?? load < -0.05) && rn > 0.42 && !p.muted && now < (this.overrunUntil || 0)) {
      this.popAcc = (this.popAcc || 0) + Math.min(.1,p.dt || 0) * crackle * (rn - 0.35) * 9 * (this.lastLift < 2 ? 1 : 0.25);
      while (this.popAcc > 1) { this.popAcc -= 1 + Math.random(); this.pop(0.35 + Math.random() * 0.5 * rn, Math.random() * 0.05); }
    }
    else this.popAcc = 0;
    this.lastLift = load < -0.05 ? (this.lastLift || 0) + p.dt : 0;
    if (this.lifecycle.shiftStarted && this.lifecycle.shiftKind === 'dct' && (this.lastLoad ?? 0) > .6 && rn > .55 && crackle > .3) this.pop(.45, .015);
    this.lastOverrun = !!p.overrun;
    this.lastLoad = load;
    x.whine.frequency.setTargetAtTime(p.rpm / 60 * 7.3 / Math.max(0.6, (p.gearRatio || 1) * 0.35), now, 0.05);
    x.whineG.gain.setTargetAtTime(mute * E.whine * 0.012 * (0.3 + Math.abs(load)) * Math.min(1, v / 8), now, 0.08);
    x.nitroG.gain.setTargetAtTime(p.nitro ? 0.07 : 0, now, p.nitro ? 0.05 : 0.2);

    // ---- four contact patches: unloaded wheels are silent, combined slip reveals the grip limit.
    const sk = Math.min(1.3, p.skid || 0), sq = Math.max(0, sk - 0.25) / 1.05;
    for (let i = 0; i < 4; i++) {
      const wheel = p.wheels?.[i] || { sy: sk, sx: (p.wheelspin || 0) * 3 - (p.lockup || 0) * 3, Fz: p.nominalLoad || 3500 };
      this.tyres[i].set(wheel, v, p.surfaces?.[i] || (p.offroad ? 'gravel' : 'asphalt'), p.nominalLoad || 3500, now);
    }
    if (p.bump > 0.05 && !p.muted) this.thump(p.bump, p.wb && v > 2 ? p.wb / v : 0.1);
    // ---- wind (roof down: the full blast; roof up: muffled with a mirror whistle)
    const open = p.open ? 1 : 0;
    this.roadLP.frequency.setTargetAtTime(open ? 14000 : 1100, now, 0.2);
    this.roadCabin.gain.setTargetAtTime(open ? 1 : 0.65, now, 0.2);
    t.windG.gain.setTargetAtTime(mute * Math.min(0.2, v * v * 0.00003) * (0.45 + 0.55 * open), now, 0.25);
    t.windLP.frequency.setTargetAtTime(Math.min(12000, 450 + v * (open ? 110 : 45)), now, 0.3);
    t.wind?.playbackRate.setTargetAtTime(0.75 + Math.min(0.45, v / 110), now, 0.4);
    t.whistleG.gain.setTargetAtTime(mute * (1 - open) * Math.max(0, v - 25) * 0.00015, now, 0.4);
    t.whistleBP.frequency.setTargetAtTime(1800 + v * 12, now, 0.4);
    // cabin: roof up filters the outside world
    this.cabinLP.frequency.setTargetAtTime(open ? 15000 : 2600, now, 0.2);
    this.ext.gain.setTargetAtTime(open ? 1 : 0.7, now, 0.2);
    this.ambLP.frequency.setTargetAtTime(open ? 15000 : 2200, now, 0.2);
    this.engineLP.frequency.setTargetAtTime(open ? 15000 : 3800, now, 0.2);

    this.externalEngines.update(p.rivals, p.traffic, now);
    this.sirens.update(p.traffic || [], now, mute);

    // ---- map ambience / weather (owns bed levels and sparse natural events)
    this.weather.update(p, now);

    // ---- music ducks under the action (crashes, horns, slides, speed)
    this.duckEv = Math.max(0, this.duckEv - p.dt * 0.7);
    const duck = Math.min(1, Math.max(this.duckEv, (p.action || 0) * 0.6, sq * 0.8));
    this.musicDuck.gain.setTargetAtTime(1 - 0.55 * duck, now, duck > (this.lastDuck || 0) ? 0.05 : 0.6);
    this.lastDuck = duck;
  }
  duck(amount = 1) { this.duckEv = Math.max(this.duckEv, amount); }
  // ---- police (traffic.js pursuits): radio one-shots; sirens are in sirens.js
  /** radio squelch plus a burst of chatter; returns the time it ends (s from now) */
  radioBurst(talk = 1.4, gain = 0.32, at = 0) {
    const bed = this.S && this.S['radio-chatter'];
    if (!this.sample('radio-squelch', { gain: gain * 0.8, at })) this.noise({ dur: 0.25, f: 1800, type: 'bandpass', q: 0.7, gain: 0.08, at });
    if (bed) this.sample('radio-chatter', { gain, at: at + 0.12, offset: Math.random() * (bed.buffer.duration - talk - 0.2), dur: talk });
    this.sample('radio-beep', { gain: gain * 0.6, at: at + talk + 0.15 });
    return at + talk + 0.5;
  }
  /** dispatcher squelch when the heat goes up */
  copRadio() { if (!this.ctx) return; this.radioBurst(0.9 + Math.random() * 0.8, 0.26); }
  /** caught: radio chatter and a falling stinger */
  copBusted() {
    if (!this.ctx) return;
    this.duck(1);
    const end = this.radioBurst(2.2, 0.34, 0.6);
    [[311, 0.22], [277, 0.22], [233, 0.7]].forEach(([f, d], i) => this.tone({ f, dur: d, gain: 0.1, type: 'sawtooth', at: i * 0.2, lp: 1500, attack: 0.02 }));
    return end;
  }
  /** got away: a last crackle of radio and a rising pluck */
  copEvaded() {
    if (!this.ctx) return;
    this.radioBurst(0.8, 0.2);
    [62, 66, 69, 74, 78].forEach((n, i) => this.pluck(MIDI(n), 1.1 + i * 0.07, 0.14));
  }
  /** weather.js: kind 'clear' | 'overcast' | 'rain', intensity 0..1 */
  setWeather(kind, intensity = 1) { this.weather.setWeather(kind, intensity); }
  /** weather.js: 'dawn' | 'day' | 'sunset' | 'night' */
  setTimeOfDay(time) { this.weather.setTimeOfDay(time); }

  syncMenu(now = this.ctx?.currentTime || 0) {
    const classes = typeof document !== 'undefined' ? document.body?.classList : null;
    this.mix?.setMenu(this.menuRequested || ['menu', 'ui-open', 'loading', 'paused', 'results'].some(k => classes?.contains(k)), now);
    if (this.musicBus && this.musicMenu !== this.mix.menu) {
      this.musicMenu = this.mix.menu;
      this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicMenu ? MENU_MUSIC_LEVEL : MUSIC_LEVEL : 0, now, 0.4);
    }
    this.musicSources.syncMenu();
  }

  /** Loose exhaust shield/hanger: quiet metallic chatter, not extra exhaust pops. */
  updateExhaustRattle(p, now, startLevel = 1) {
    const rear = Number.isFinite(p.damage?.rear) ? p.damage.rear : 0;
    const severity = Math.max(0, Math.min(1, (rear - .5) * 2));
    if (!severity || p.muted || !(p.rpm > 300) || startLevel < .95) {
      this.nextExhaustRattle = 0;
      return;
    }
    if (now < (this.nextExhaustRattle || 0)) return;
    const rn = Math.max(0, Math.min(1, p.rpm / (p.redline || 7000)));
    const bump = Math.max(0, Math.min(1, p.bump || 0));
    const load = Math.max(0, Math.min(1, Math.abs(p.load || 0)));
    // Audio-time rate limit: a slow frame never queues a burst of overdue hits.
    this.nextExhaustRattle = now + .12 + (1 - rn) * .18 + Math.random() * .08;
    this.noise({ dur: .045, f: 1350 + Math.random() * 550, type: 'bandpass', q: 8,
      gain: severity * (.006 + rn * .009 + load * .005 + bump * .012),
      attack: .002, bus: this.chassis });
  }

  // ------------------------------------------------------------------ new one-shots
  /** an exhaust pop / crackle on the overrun */
  pop(level = 0.6, at = 0) {
    if (!this.ctx) return;
    const f = 500 + Math.random() * 1400;
    this.noise({ dur: 0.025 + Math.random() * 0.04, f, type: 'bandpass', q: 1.5, gain: 0.16 * level, at, bus: this.eng });
    this.tone({ f: 70 + Math.random() * 50, slide: 40, dur: 0.07, gain: 0.18 * level, type: 'sine', at, bus: this.eng });
  }
  /** turbo wastegate flutter ("stu-tu-tu") */
  flutter(boost = 1) {
    for (let i = 0; i < 5; i++) this.noise({ dur: 0.05, f: 1500 - i * 120, type: 'bandpass', q: 1.6, gain: 0.07 * boost * (1 - i * 0.15), at: i * 0.045, bus: this.eng });
  }
  /** gearbox clunk */
  clunk(level = 0.5) {
    this.tone({ f: 95, slide: 55, dur: 0.06, gain: 0.12 * level, type: 'sine', bus: this.chassis });
    this.noise({ dur: 0.035, f: 1800, type: 'bandpass', q: 2, gain: 0.03 * level, bus: this.chassis });
  }
  /** suspension thump over a joint / bump: front axle, then the rear one a wheelbase later */
  thump(level = 0.5, gap = 0.1) {
    for (const [at, k] of [[0, 1], [Math.min(0.4, gap), 0.7]]) {
      this.tone({ f: 70 + Math.random() * 20, slide: 42, dur: 0.12, gain: 0.3 * level * k, type: 'sine', at, bus: this.chassis });
      this.noise({ dur: 0.05, f: 900, type: 'lowpass', gain: 0.12 * level * k, at, bus: this.chassis });
      if (level > 0.4) this.noise({ dur: 0.08, f: 3500, type: 'bandpass', q: 3, gain: 0.02 * level * k, at: at + 0.02, bus: this.chassis }); // trim rattle
    }
  }
  /** bus air brakes / kneeling hiss */
  airHiss(level = 0.5, pan = 0) {
    if (!this.ctx || level < 0.02) return;
    this.noise({ dur: 0.9, f: 3200, type: 'highpass', gain: 0.1 * level, attack: 0.02, pan, bus: this.trafficBus });
    this.noise({ dur: 0.25, f: 5200, type: 'bandpass', q: 1, gain: 0.08 * level, pan, bus: this.trafficBus });
  }
  // ------------------------------------------------------------------ primitives
  noise({ dur = 0.2, f = 1000, type = 'lowpass', q = 1, gain = 0.3, attack = 0.002, at = 0, pan = 0, sweep, bus, buf }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const s = ctx.createBufferSource(); s.buffer = buf || this.white;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    s.connect(fl); fl.connect(g); g.connect(pn); pn.connect(bus || this.sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  tone({ f = 440, dur = 0.2, gain = 0.2, type = 'sine', slide, at = 0, attack = 0.004, vib = 0, vibF = 6, pan = 0, bus, lp }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    if (vib) { const l = ctx.createOscillator(); l.frequency.value = vibF; const lg = ctx.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    node.connect(g); g.connect(pn); pn.connect(bus || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }
  pluck(f, at = 0, gain = 0.2) {
    // quick synthesized bouzouki-ish pluck for UI events
    this.tone({ f, dur: 0.5, gain, type: 'sawtooth', at, lp: 3200, attack: 0.002 });
    this.tone({ f: f * 2.003, dur: 0.35, gain: gain * 0.4, type: 'triangle', at: at + 0.002 });
  }
  crackle(rpm, red = 6500, max = 7) {
    const n = 2 + Math.floor(Math.random() * max * (rpm / red));
    for (let i = 0; i < n; i++) this.noise({ dur: 0.02 + Math.random() * 0.03, f: 700 + Math.random() * 1500, type: 'bandpass', q: 2, gain: 0.08 + Math.random() * 0.1, at: 0.05 + i * (0.05 + Math.random() * 0.09), bus: this.eng });
  }

  /** formant voice. segs: [{v:'o'|'a'|'e'|'i'|'u', dur, f0, f1}] with optional {gap} silences / {burst} plosives */
  voice(segs, gain = 0.32, pan = 0, at = 0) {
    if (!this.ctx) return;
    const F = { a: [800, 1250, 2600], o: [460, 820, 2800], e: [500, 1750, 2500], i: [300, 2250, 2950], u: [330, 760, 2500], ah: [700, 1100, 2450] };
    const ctx = this.ctx; let t = ctx.currentTime + 0.01 + at;
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 4; vib.connect(vg); vg.connect(src.frequency);
    const amp = ctx.createGain(); amp.gain.value = 0;
    const out = ctx.createGain(); out.gain.value = gain;
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    const filters = [0, 1, 2].map((k) => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = [9, 12, 14][k]; const g = ctx.createGain(); g.gain.value = [1.0, 0.55, 0.22][k] * 3; src.connect(amp); amp.connect(f); f.connect(g); g.connect(out); return f; });
    out.connect(pn); pn.connect(this.voiceBus || this.sfx);
    const t0 = t;
    let first = true;
    for (const s of segs) {
      if (s.gap) { amp.gain.setTargetAtTime(0, t, 0.008); t += s.gap; continue; }
      if (s.burst) { this.noise({ dur: 0.03, f: 1500, type: 'bandpass', q: 0.8, gain: gain * 0.5, at: t - ctx.currentTime, pan }); continue; }
      const fv = F[s.v];
      if (first) { src.frequency.setValueAtTime(s.f0, t); filters.forEach((f, k) => f.frequency.setValueAtTime(fv[k], t)); first = false; }
      else { src.frequency.setValueAtTime(s.f0, t); filters.forEach((f, k) => f.frequency.setTargetAtTime(fv[k], t, 0.025)); }
      src.frequency.linearRampToValueAtTime(s.f1 || s.f0, t + s.dur);
      amp.gain.setTargetAtTime(s.amp || 1, t, 0.015);
      t += s.dur;
    }
    amp.gain.setTargetAtTime(0, t - 0.05, 0.03);
    src.start(t0); vib.start(t0); src.stop(t + 0.2); vib.stop(t + 0.2);
  }
  opa(excited = 1) {
    const p = 0.9 + Math.random() * 0.25;
    this.voice([{ v: 'o', dur: 0.17 * excited, f0: 200 * p, f1: 255 * p }, { gap: 0.055 }, { burst: true }, { v: 'a', dur: 0.3 * excited, f0: 245 * p, f1: 150 * p }], 0.34, (Math.random() - 0.5) * 0.4);
  }
  scream() { if (this.sample('scream', { gain: 0.5, rate: 0.9 + Math.random() * 0.2, pan: 0.3 })) return; const p = 0.9 + Math.random() * 0.3; this.voice([{ v: 'a', dur: 0.12, f0: 330 * p, f1: 520 * p }, { v: 'ah', dur: 0.45, f0: 540 * p, f1: 380 * p }], 0.22, 0.3); }
  /** a pedestrian yelling: formant 'HEY!', 'WHOA!', 'AAH!' or an indignant rant. pitch ~0.8 (man) .. 2 (child) */
  shout(pitch = 1, kind = 0, pan = 0, gain = 0.24) {
    if (!this.ctx) return;
    const f = 150 * pitch;
    const S = [
      [{ v: 'e', dur: 0.1, f0: f * 1.3, f1: f * 1.7 }, { v: 'i', dur: 0.22, f0: f * 1.7, f1: f * 1.2 }],
      [{ v: 'u', dur: 0.07, f0: f * 1.1, f1: f * 1.3 }, { v: 'o', dur: 0.34, f0: f * 1.55, f1: f * 0.95 }],
      [{ v: 'a', dur: 0.1, f0: f * 1.5, f1: f * 1.9 }, { v: 'ah', dur: 0.32, f0: f * 1.9, f1: f * 1.3 }],
      [{ v: 'e', dur: 0.08, f0: f * 1.25, f1: f * 1.4 }, { gap: 0.05 }, { v: 'e', dur: 0.08, f0: f * 1.4, f1: f * 1.55 }, { gap: 0.05 }, { v: 'a', dur: 0.24, f0: f * 1.7, f1: f * 1.1 }],
      [{ v: 'o', dur: 0.12, f0: f * 1.2, f1: f * 1.0 }, { gap: 0.04 }, { burst: true }, { v: 'a', dur: 0.26, f0: f * 1.35, f1: f * 0.9 }],
    ];
    this.voice(S[kind % S.length], gain, Math.max(-1, Math.min(1, pan)));
  }
  /** traffic-police whistle trill */
  whistle() { if (!this.ctx) return; for (const [at, d] of [[0, 0.18], [0.26, 0.6]]) this.tone({ f: 2950, dur: d, gain: 0.06, type: 'sine', at, vib: 140, vibF: 26, attack: 0.008 }); }
  /** the blind-assist ticker on a crossing's green man */
  pedTick(fast = false, pan = 0) { if (!this.ctx) return; this.tone({ f: fast ? 1250 : 980, dur: 0.025, gain: 0.05, type: 'square', lp: 2400, pan }); }
  meow() { this.voice([{ v: 'i', dur: 0.1, f0: 720, f1: 820 }, { v: 'a', dur: 0.22, f0: 820, f1: 640 }, { v: 'u', dur: 0.15, f0: 640, f1: 520 }], 0.16, 0.2); }
  woof() { for (const at of [0, 0.22]) this.voice([{ v: 'u', dur: 0.04, f0: 190, f1: 230 }, { v: 'a', dur: 0.1, f0: 230, f1: 160 }], 0.3, -0.1, at); }

  // ------------------------------------------------------------------ game events
  crash(kind, severity = 1, material = {}) {
    if (!this.ctx) return;
    this.duck(0.9 * severity + 0.3);
    severity = Math.max(0, Math.min(1, Number.isFinite(severity) ? severity : 0));
    const heavy = kind === 'heavy', glass = material.glass ?? (heavy && severity > .5), r = 0.92 + Math.random() * 0.16;
    if (glass) this.sample('crash-glass', { gain: .30 * Math.sqrt(severity), rate: r, at: .03 });
    if (material.metal && severity > .15) this.noise({ dur: .12 + severity * .15, f: 1500, type: 'bandpass', q: 2, gain: .08 * severity, at: .04 });
    // body thud under the recorded impact, for weight
    this.tone({ f: heavy ? 110 : 170, slide: heavy ? 40 : 65, dur: 0.3, gain: (heavy ? 0.4 : 0.25) * severity, type: 'sine' });
    const g = Math.min(1, 0.35 + 0.75 * severity);
    if (heavy) {
      if (this.sample(Math.random() < 0.5 ? 'crash-heavy' : 'crash-medium', { gain: 0.75 * g, rate: r })) return;
    } else if (this.sample(severity > 0.45 ? 'hit-clank' : 'hit-fast', { gain: 0.7 * g, rate: r })) return;
    // synthesized fallback until the recordings load
    this.noise({ dur: heavy ? 0.4 : 0.2, f: heavy ? 600 : 1400, type: 'lowpass', gain: 0.45 * severity });
    if (heavy) {
      for (let i = 0; i < 3; i++) this.noise({ dur: 0.08, f: 1300 + Math.random() * 1500, type: 'bandpass', q: 3, gain: 0.22, at: 0.03 + i * 0.05 });
      if (glass) for (let i = 0; i < 6; i++) this.tone({ f: 2600 + Math.random() * 3600, dur: 0.12 + Math.random() * 0.3, gain: 0.04, type: 'sine', at: 0.08 + Math.random() * 0.25 }); // glass tinkle
    }
  }
  hitObject(o) {
    if (!this.ctx) return;
    if (o.cls === 'person') this.scream();
    else if (o.type === 'cat') this.meow();
    else if (o.type === 'dog') this.woof();
    else if (o.type === 'pickup') { for (let i = 0; i < 4; i++) this.noise({ dur: 0.12, f: 400, type: 'lowpass', gain: 0.25, at: 0.2 + i * 0.13 }); }
    else if (o.type === 'works' || o.type === 'chairs') for (let i = 0; i < 4; i++) { this.tone({ f: 300 + Math.random() * 400, dur: 0.07, gain: 0.12, at: i * 0.09, type: 'triangle' }); }
    if (o.cls === 'heavy' && o.type !== 'scooter' && Math.random() < 0.7) this.horn(o.type === 'bus', 0.9, 0.2, 0.25);
  }
  nearMiss(combo = 1, pan = 0) {
    if (!this.ctx) return;
    this.noise({ dur: 0.45, f: 500, sweep: 2600, type: 'bandpass', q: 1.2, gain: 0.22, attack: 0.12, pan });
    const scale = [62, 63, 66, 67, 69, 70, 72, 74, 75, 78, 79, 81];
    this.pluck(MIDI(scale[Math.min(scale.length - 1, combo - 1)] + 12), 0.05, 0.12);
  }
  passBy(level = 0.5, pan = -0.4) { this.noise({ dur: 0.6, f: 300, sweep: 1500, type: 'bandpass', q: 0.8, gain: 0.12 * level, attack: 0.25, pan }); }
  moped(pan = 0.4, level = 1) {
    // two-stroke scooter buzzing past (doppler drop)
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, rec = this.S && this.S['scooter-run'];
    let o, bp, g = ctx.createGain();
    if (rec) {
      // the recorded scooter, its pitch dropping as it passes
      o = loopSource(ctx, rec, g, 1.2); o.playbackRate.setValueAtTime(1.2, t); o.playbackRate.linearRampToValueAtTime(1.28, t + 0.35); o.playbackRate.exponentialRampToValueAtTime(0.9, t + 0.9);
      bp = g; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35 * level, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    } else {
      o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(175, t); o.frequency.linearRampToValueAtTime(190, t + 0.35); o.frequency.exponentialRampToValueAtTime(125, t + 0.9);
      bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.4;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * level, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.connect(bp); o.start(t);
    }
    const pn = ctx.createStereoPanner(); pn.pan.setValueAtTime(pan * 0.3, t); pn.pan.linearRampToValueAtTime(pan, t + 0.9);
    if (bp !== g) bp.connect(g);
    g.connect(pn); pn.connect(this.trafficBus);
    o.stop(t + 1.05);
  }
  curb(strength = 0.5) { this.tone({ f: 90, slide: 50, dur: 0.15, gain: 0.25 * strength, type: 'sine' }); this.noise({ dur: 0.18, f: 2200, type: 'highpass', gain: 0.08 * strength }); }
  horn(big, level = 0.6, pan = 0, at = 0) {
    if (!this.ctx) return;
    this.duck(0.35 * level);
    if (this.sample(big ? 'horn-long' : 'horn-double', { gain: 0.5 * level, rate: big ? 0.72 : 0.95 + Math.random() * 0.15, pan, at, bus: this.trafficBus })) return;
    const d = 0.25 + Math.random() * 0.35;
    const f1 = big ? 220 : 400, f2 = big ? 277 : 500;
    for (const f of [f1, f2]) this.tone({ f, dur: d, gain: 0.045 * level, type: 'square', attack: 0.01, lp: 2200, pan, at, bus: this.trafficBus });
  }
  /** a traffic horn: car (two-tone), taxi, bus (low, brassy), scooter / moto (thin "meep"). style 1 = long lean on it */
  carHorn(kind = 'car', style = 0, level = 1, pan = 0, at = 0) {
    if (!this.ctx || level < 0.02) return;
    const bus = kind === 'bus', bike = kind === 'scooter' || kind === 'delivery' || kind === 'moto';
    const lp = 900 + 2400 * Math.min(1, level); // distant horns lose their bite
    if (level > 0.3) this.duck(0.3 * Math.min(1, level));
    // the recorded horns, pitched per vehicle: buses low, scooters thin
    const rate = (bus ? 0.7 : bike ? 1.45 : kind === 'taxi' ? 1.08 : 0.92) * (0.96 + Math.random() * 0.08);
    const opts = { gain: (bike ? 0.3 : bus ? 0.6 : 0.5) * Math.min(1, level), rate, pan, at, lp: lp * 1.6, bus: this.trafficBus || this.amb };
    if (style ? this.sample('horn-long', opts) : this.sample('horn-double', opts)) return;
    const f1 = bus ? 196 : bike ? 560 + Math.random() * 80 : kind === 'taxi' ? 415 : 360 + Math.random() * 90, f2 = bike ? f1 * 1.06 : f1 * 1.26;
    const pattern = style ? [[0, 0.75 + Math.random() * 0.5]] : Math.random() < 0.5 ? [[0, 0.12], [0.2, 0.16]] : [[0, 0.28]];
    const g = (bike ? 0.035 : bus ? 0.07 : 0.055) * Math.min(1, level);
    for (const [t0, d] of pattern) for (const f of bike ? [f1] : [f1, f2]) this.tone({ f, dur: d, gain: g, type: bike ? 'square' : 'sawtooth', attack: 0.012, lp, pan, at: at + t0, bus: this.trafficBus || this.amb });
  }
  gull(side = 0.6, near = 1) {
    const pan = Math.max(-1, Math.min(1, side * (0.5 + Math.random() * 0.5)));
    const bed = this.S && this.S.gulls;
    if (bed) {
      // a few seconds of the gull recording, from a random point
      const dur = 2.5 + Math.random() * 2.5;
      this.sample('gulls', { gain: 0.5 + 0.5 * near, pan: pan * 0.6, offset: Math.random() * (bed.buffer.duration - dur), dur, rate: 0.95 + Math.random() * 0.1, bus: this.a.gulls });
      return;
    }
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const at = i * 0.32;
      this.tone({ f: 1500, slide: 2400, dur: 0.12, gain: 0.03, type: 'triangle', at, pan, bus: this.amb });
      this.tone({ f: 2400, slide: 1300, dur: 0.22, gain: 0.03, type: 'triangle', at: at + 0.11, pan, vib: 60, vibF: 30, bus: this.amb });
    }
  }
  tramBell() { for (const at of [0, 0.35]) { this.tone({ f: 1250, dur: 0.6, gain: 0.05, at, pan: -0.5, bus: this.amb }); this.tone({ f: 3130, dur: 0.4, gain: 0.02, at, pan: -0.5, bus: this.amb }); } }
  checkpoint() {
    if (!this.ctx) return;
    [62, 66, 69, 74, 78].forEach((n, i) => this.pluck(MIDI(n), i * 0.08, 0.16));
    this.tone({ f: 1760, dur: 0.6, gain: 0.05, at: 0.42 });
    setTimeout(() => this.opa(1.1), 450);
  }
  gameOver() {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.tapeStop(0.45, 2.2);
    this.musicLP.frequency.setTargetAtTime(700, now, 0.6);
    // sad trombone
    [[311, 0.42], [294, 0.42], [277, 0.42], [262, 1.3]].forEach(([f, d], i) => this.tone({ f, dur: d, gain: 0.13, type: 'sawtooth', at: 0.3 + i * 0.45, lp: 1100, vib: i === 3 ? 7 : 0, vibF: 5.5, attack: 0.04 }));
  }
  finish() {
    if (!this.ctx) return;
    [62, 66, 69, 74, 69, 74, 78, 81].forEach((n, i) => this.pluck(MIDI(n), i * 0.11, 0.17));
    setTimeout(() => this.opa(1.3), 900);
  }
  beep(final = false) {
    if (!this.ctx) return;
    this.tone({ f: final ? 1320 : 660, dur: final ? 0.7 : 0.22, gain: 0.16, type: 'square', lp: 3000, attack: 0.005 });
    this.tone({ f: final ? 2640 : 1320, dur: final ? 0.5 : 0.15, gain: 0.04, type: 'sine' });
  }
  nitroStart() { this.noise({ dur: 0.5, f: 300, sweep: 4000, type: 'bandpass', q: 0.9, gain: 0.18, attack: 0.03, bus: this.eng }); this.tone({ f: 90, slide: 45, dur: 0.4, gain: 0.25 }); }
  scrape(level = 0.5) { this.noise({ dur: 0.25, f: 3200, type: 'bandpass', q: 3, gain: 0.12 * level }); this.noise({ dur: 0.2, f: 600, type: 'lowpass', gain: 0.2 * level }); }
  ui(up = true) { this.tone({ f: up ? MIDI(74) : MIDI(69), dur: 0.12, gain: 0.1, type: 'sine', attack: 0.005, bus: this.uiBus }); }
  win() {
    if (!this.ctx) return;
    [62, 66, 69, 74, 78, 81, 86].forEach((n, i) => this.pluck(MIDI(n), i * 0.09, 0.17));
    [74, 78, 81].forEach((n) => this.tone({ f: MIDI(n), dur: 1.4, gain: 0.05, type: 'triangle', at: 0.65, vib: 5, vibF: 5.5 }));
    setTimeout(() => this.opa(1.4), 700);
  }
  lose() {
    if (!this.ctx) return;
    [[311, 0.42], [294, 0.42], [277, 0.42], [262, 1.3]].forEach(([f, d], i) => this.tone({ f, dur: d, gain: 0.12, type: 'sawtooth', at: 0.2 + i * 0.45, lp: 1100, vib: i === 3 ? 7 : 0, vibF: 5.5, attack: 0.04 }));
  }
  /** Only local/built-in sources own a media element; other sources can retain an old one. */
  musicElement() {
    const radio = this.radio;
    return radio && (!radio.source || ['files', 'builtin'].includes(radio.source)) ? radio.el : null;
  }
  /** Glide an existing local music element's speed (and pitch). */
  tapeStop(rate, secs) {
    clearInterval(this.tapeT); this.tapeT = null;
    const element = this.musicElement();
    if (!element) return;
    const radio = this.radio, revision = radio.revision;
    const r0 = element.playbackRate, t0 = performance.now();
    const timer = setInterval(() => {
      // A source/file switch cancels the effect; never animate a replacement track.
      if (this.musicElement() !== element || radio.revision !== revision) {
        clearInterval(timer); if (this.tapeT === timer) this.tapeT = null; return;
      }
      const k = Math.min(1, (performance.now() - t0) / 1000 / secs);
      element.playbackRate = r0 + (rate - r0) * k;
      if (k >= 1) { clearInterval(timer); if (this.tapeT === timer) this.tapeT = null; }
    }, 50);
    this.tapeT = timer;
  }
  restart() {
    if (!this.ctx) return;
    this.nextExhaustRattle = 0;
    this.lastSpeed = 0; this.requestIgnition();
    const now = this.ctx.currentTime;
    if (this.musicElement()) {
      this.tapeStop(1, 0.3);
      this.musicLP?.frequency.setTargetAtTime(12000, now, 0.4);
    } else { clearInterval(this.tapeT); this.tapeT = null; }
    this.duckEv = 0;
  }
}

// debug helper: RMS (dBFS) of the master output and of individual buses
Audio.prototype.levels = function () {
  if (!this.ctx) return null;
  const buf = new Float32Array(this.analyser.fftSize);
  this.analyser.getFloatTimeDomainData(buf);
  let s = 0, pk = 0; for (const v of buf) { s += v * v; pk = Math.max(pk, Math.abs(v)); }
  return { rms: +(10 * Math.log10(s / buf.length + 1e-12)).toFixed(1), peak: +(20 * Math.log10(pk + 1e-12)).toFixed(1) };
};
/** volume settings (src/settings.js), each 0..1: master = everything, music = the radio, sfx = everything but the radio */
Audio.prototype.setVolumes = function (volumes = {}) {
  for (const key of Object.keys(AUDIO_DEFAULTS)) if (key in volumes) this.vol[key] = clampAudio(volumes[key]);
  if (this.eng) this.eng.gain.setTargetAtTime(PLAYER_ENGINE_LEVEL, this.ctx.currentTime, 0.04);
  if (this.engineSpec) this.E = ENGINE_SOUND[engineProfile(this.engineSpec).synth] || this.E;
  this.mix?.setVolumes(this.vol);
};
// debug helper: RMS (dBFS) per bus, to keep the mix balanced
Audio.prototype.busLevels = function () {
  if (!this.ctx) return null;
  if (!this.taps) {
    this.taps = {};
    for (const k of ['eng', 'chassis', 'trafficBus', 'amb', 'sfx', 'musicDuck', 'mainOut']) { const an = this.ctx.createAnalyser(); an.fftSize = 2048; this[k].connect(an); this.taps[k] = an; }
    return null;
  }
  const out = {}, buf = new Float32Array(2048);
  for (const k in this.taps) { this.taps[k].getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; out[k] = +(10 * Math.log10(s / buf.length + 1e-12)).toFixed(1); }
  return out;
};
