import { preloadEngine, loadRecordedEngine, recordingFor, RecordedEngineVoice } from './engine-recordings.js';
import { loadWorldSounds, loopSource, Radio } from './world-sounds.js';
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

// ------------------------------------------------------------------ engine models
// cyl: cylinders; f1/f2: exhaust resonances (Hz) with decay t1/t2 (s); b: rasp resonance level; thump: low pressure pulse;
// pat: per-cylinder pulse strength (uneven headers / firing order -> warble); jit: cycle-to-cycle variation;
// knock: diesel injection clatter; lp: tone filter range; whine: gearbox whine; pops: overrun crackle tendency
export const ENGINE_SOUND = {
  // GR Yaris G16E: three evenly spaced firings per 720°, low exhaust body and a muted turbo rasp.
  turbo3: { cyl: 3, f1: 145, f2: 1050, t1: 0.007, t2: 0.0015, b: 0.32, thump: 1.05, pat: [1, 0.96, 0.93], jit: 0.028, knock: 0, rasp: 0.14, lp: [650, 5400], whine: 0.05, pops: 0.35, idleWobble: 0.035, gain: 1 },
  // Alfa 2000 twin-cam: open, metallic exhaust/intake character with restrained overrun.
  na4: { cyl: 4, f1: 205, f2: 1750, t1: 0.0054, t2: 0.0014, b: 0.52, thump: 0.82, pat: [1, 0.94, 0.98, 0.92], jit: 0.04, knock: 0, rasp: 0.23, lp: [900, 7200], whine: 0.09, pops: 0.16, idleWobble: 0.045, gain: 1 },
  turbo4: { cyl: 4, f1: 165, f2: 1150, t1: 0.0062, t2: 0.0013, b: 0.36, thump: 0.95, pat: [1, 0.92, 0.97, 0.9], jit: 0.035, knock: 0, rasp: 0.12, lp: [700, 5200], whine: 0.05, pops: 0.6, idleWobble: 0.03, gain: 1 },
  turbo6: { cyl: 6, f1: 155, f2: 1350, t1: 0.006, t2: 0.0014, b: 0.36, thump: 0.9, pat: [1, 0.97, 0.95, 1, 0.96, 0.98], jit: 0.018, knock: 0, rasp: 0.12, lp: [800, 6800], whine: 0.07, pops: 0.6, idleWobble: 0.02, gain: 1 },
  turbo5: { cyl: 5, f1: 138, f2: 900, t1: 0.0072, t2: 0.0016, b: 0.42, thump: 1.0, pat: [1, 0.74, 0.95, 0.7, 0.88], jit: 0.045, knock: 0, rasp: 0.2, lp: [650, 4800], whine: 0.55, pops: 1, idleWobble: 0.05, gain: 1.05 },
  flat6: { cyl: 6, f1: 245, f2: 2050, t1: 0.0043, t2: 0.0011, b: 0.58, thump: 0.7, pat: [1, 0.93, 0.99, 0.91, 0.97, 0.94], jit: 0.02, knock: 0, rasp: 0.26, lp: [1100, 8000], whine: 0.15, pops: 0.75, idleWobble: 0.02, gain: 1 },
  v12: { cyl: 12, f1: 315, f2: 2500, t1: 0.0031, t2: 0.0009, b: 0.5, thump: 0.62, pat: [1, 0.97, 0.99, 0.95, 1, 0.94, 0.98, 0.96, 1, 0.95, 0.99, 0.97], jit: 0.015, knock: 0, rasp: 0.13, lp: [1200, 8500], whine: 0.1, pops: 0.8, idleWobble: 0.015, gain: 1.05 },
  diesel: { cyl: 4, f1: 98, f2: 640, t1: 0.0085, t2: 0.0021, b: 0.2, thump: 1.15, pat: [1, 0.95, 0.98, 0.92], jit: 0.05, knock: 0.75, rasp: 0.05, lp: [520, 2600], whine: 0, pops: 0.05, idleWobble: 0.06, gain: 1.1 },
};

function rng32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** one looped buffer: `cycles` full 720-degree engine cycles at refRpm, on or off load */
function renderEngineCycle(ctx, E, refRpm, onLoad, cycles, seed) {
  const sr = ctx.sampleRate;
  const nc = Math.max(64, Math.round(120 / refRpm * sr)), N = nc * cycles;
  const out = new Float32Array(N);
  const rnd = rng32(seed);
  const ti = nc / E.cyl;
  const L1 = Math.min(N, Math.ceil(E.t1 * 7 * sr) + Math.ceil(ti));
  const w1 = 2 * Math.PI * E.f1 / sr, w2 = 2 * Math.PI * E.f2 / sr;
  const thumpW = Math.max(8, ti * (onLoad ? 0.55 : 0.75));
  let hp = 0;
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < E.cyl; k++) {
      const t0 = Math.round(c * nc + k * ti + (rnd() - 0.5) * ti * 0.03);
      let amp = E.pat[k % E.pat.length] * (1 + (rnd() - 0.5) * 2 * E.jit);
      if (!onLoad) amp *= 0.42 * (rnd() < 0.18 * E.pops ? 1.9 + rnd() : 0.55 + rnd() * 0.6); // burble on the overrun
      const bAmp = E.b * (onLoad ? 1 : 0.35), th = E.thump * (onLoad ? 1 : 0.6);
      for (let n = 0; n < L1; n++) {
        let v = 0;
        if (n < thumpW) v += th * Math.sin(Math.PI * n / thumpW) * 0.8;
        v += Math.exp(-n / (E.t1 * sr)) * Math.sin(w1 * n);
        v += bAmp * Math.exp(-n / (E.t2 * sr)) * Math.sin(w2 * n + 0.6);
        out[(t0 + n) % N] += v * amp;
      }
      // exhaust rasp: a burst of noise riding each pulse (high-passed)
      const Lr = Math.min(N, Math.ceil(ti * 0.8));
      const rasp = E.rasp * (onLoad ? 1 : 0.5) * amp;
      for (let n = 0; n < Lr; n++) { const w = rnd() * 2 - 1; hp = w - hp * 0.6; out[(t0 + n) % N] += hp * rasp * Math.exp(-n / (ti * 0.25)); }
      // diesel injection knock: a hard, bright click just after each firing
      if (E.knock) {
        const tk = t0 + Math.round(ti * 0.08), Lk = Math.ceil(0.0016 * sr);
        let lp = 0; for (let n = 0; n < Lk; n++) { const w = rnd() * 2 - 1; lp += (w - lp) * 0.7; out[(tk + n) % N] += (w - lp) * E.knock * (onLoad ? 1 : 0.8) * Math.exp(-n / (0.0004 * sr)) * 1.6; }
      }
    }
  }
  // remove DC, normalise
  let m = 0; for (let i = 0; i < N; i++) m += out[i]; m /= N;
  let pk = 1e-6; for (let i = 0; i < N; i++) { out[i] -= m; pk = Math.max(pk, Math.abs(out[i])); }
  const k = 0.85 / pk; for (let i = 0; i < N; i++) out[i] *= k;
  const buf = ctx.createBuffer(1, N, sr); buf.getChannelData(0).set(out);
  return { buf, ref: 120 * sr / nc };
}

/** multi-sample bank for an engine type: four RPM points, on and off load */
export function buildEngineBank(ctx, type, idle, red) {
  const E = ENGINE_SOUND[type] || ENGINE_SOUND.turbo4;
  const pts = [idle * 1.05, red * 0.34, red * 0.6, red * 0.88];
  const on = [], off = [];
  pts.forEach((r, i) => { on.push(renderEngineCycle(ctx, E, r, true, 6, 11 + i * 7)); off.push(renderEngineCycle(ctx, E, r, false, 14, 101 + i * 13)); });
  return { E, type, pts: pts.map((_, i) => on[i].ref), on, off };
}

/** a playing engine built from a bank: 4 x 2 looping sources, crossfaded by RPM (equal power, log scale) and load */
export class EngineVoice {
  constructor(ctx, bank, dest, gain = 1) {
    this.ctx = ctx; this.bank = bank;
    const E = bank.E;
    this.sum = ctx.createGain();
    this.src = []; this.gOn = []; this.gOff = [];
    const t = ctx.currentTime;
    for (let i = 0; i < bank.pts.length; i++) {
      for (const [list, gl, b] of [[this.src, this.gOn, bank.on[i]], [this.src, this.gOff, bank.off[i]]]) {
        const s = ctx.createBufferSource(); s.buffer = b.buf; s.loop = true; s.playbackRate.value = 1;
        const g = ctx.createGain(); g.gain.value = 0;
        s.connect(g); g.connect(this.sum); s.start(t, Math.random() * b.buf.duration);
        list.push(s); gl.push(g);
      }
    }
    this.shaper = ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
    this.shaper.curve = curve; this.shaper.oversample = '2x';
    this.pre = ctx.createGain(); this.pre.gain.value = 0.8;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 0.7; this.lp.frequency.value = E.lp[0];
    this.body = ctx.createBiquadFilter(); this.body.type = 'peaking'; this.body.frequency.value = E.f1 * 0.9; this.body.Q.value = 0.9; this.body.gain.value = 4;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.lim = ctx.createGain(); this.lim.gain.value = 1;
    this.sum.connect(this.pre); this.pre.connect(this.shaper); this.shaper.connect(this.lp); this.lp.connect(this.body); this.body.connect(this.lim); this.lim.connect(this.out);
    this.out.connect(dest);
    // limiter stutter LFO
    this.lfo = ctx.createOscillator(); this.lfo.type = 'square'; this.lfo.frequency.value = 17;
    this.lfoG = ctx.createGain(); this.lfoG.gain.value = 0; this.lfo.connect(this.lfoG); this.lfoG.connect(this.lim.gain); this.lfo.start();
    this.level = gain;
  }
  /** rpm, load (-1..1), level, doppler factor, limiter on/off */
  set(rpm, load, level, now, dop = 1, limiter = false, tc = 0.03) {
    const b = this.bank, P = b.pts, E = b.E;
    const r = Math.max(P[0] * 0.7, rpm);
    let i = 0; while (i < P.length - 2 && r > P[i + 1]) i++;
    let x = Math.log(r / P[i]) / Math.log(P[i + 1] / P[i]); x = Math.max(0, Math.min(1, x));
    const wA = Math.cos(x * Math.PI / 2), wB = Math.sin(x * Math.PI / 2);
    const on = Math.max(0, Math.min(1, (load + 0.08) / 0.5));
    const gOn = Math.sqrt(on), gOff = Math.sqrt(1 - on);
    for (let k = 0; k < P.length; k++) {
      const w = k === i ? wA : k === i + 1 ? wB : 0;
      const rate = r / P[k] * dop;
      this.src[k * 2].playbackRate.setTargetAtTime(rate, now, tc);
      this.src[k * 2 + 1].playbackRate.setTargetAtTime(rate, now, tc);
      this.gOn[k].gain.setTargetAtTime(w * gOn, now, 0.03);
      this.gOff[k].gain.setTargetAtTime(w * gOff * 0.9, now, 0.03);
    }
    const rn = Math.min(1.1, rpm / (P[3] / 0.88));
    this.lp.frequency.setTargetAtTime(E.lp[0] + (E.lp[1] - E.lp[0]) * Math.min(1, rn * (0.5 + 0.5 * on)), now, 0.04);
    this.pre.gain.setTargetAtTime(0.9 + on * 0.6, now, 0.05);
    this.out.gain.setTargetAtTime(level * this.level * 0.3 * (0.4 + 0.6 * rn) * (0.62 + 0.38 * on), now, 0.03);
    this.lfoG.gain.setTargetAtTime(limiter ? -0.55 : 0, now, 0.01);
  }
  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const s of this.src) s.stop(t + 0.3);
    this.lfo.stop(t + 0.3);
    setTimeout(() => { try { this.out.disconnect(); } catch (e) { /* already gone */ } }, 500);
  }
}

const MIDI = (n) => 440 * Math.pow(2, (n - 69) / 12);
const MUSIC_LEVEL = 0.5;
// police units drive and sound like the vehicle they are
const POLICE = { police: 'car', police_moto: 'moto' };
// traffic engine loops per vehicle class: [idle loop, its rpm, running loop, its rpm]. The car refs sit ~15% above the
// BMW takes' real rpm, so ordinary traffic plays them lower and less sporty.
const TRAFFIC_LOOPS = {
  car: ['car-idle', 860, 'car-engine', 1800], diesel: ['diesel-idle', 860, 'diesel-engine', 2000],
  bus: ['bus-idle', 700, 'diesel-engine', 2700], scooter: ['scooter-idle', 3300, 'scooter-run', 7400], moto: ['scooter-idle', 2600, 'scooter-run', 8200],
};

export class Audio {
  constructor() { this.ctx = null; this.musicOn = true; this.started = false; this.engineSpec = null; this.duckEv = 0; this.banks = {}; this.engineRevision = 0; this.recordingState = 'idle'; this.weather = new WeatherAudio(this); this.sirens = new Sirens(this); this.vol = { master: 1, music: 1, sfx: 1 }; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.started = true;
    const sr = ctx.sampleRate;
    // --- buses: engine/chassis (inside the car), external world (through the cabin filter), sfx, music
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.22;
    // master = everything but the music (scaled by the SFX volume); mainOut = the master volume, music joins there
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(0.9 * this.vol.sfx, ctx.currentTime, 0.6);
    this.mainOut = ctx.createGain(); this.mainOut.gain.value = this.vol.master;
    this.master.connect(this.mainOut); this.mainOut.connect(comp); comp.connect(ctx.destination);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; comp.connect(this.analyser);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.75; this.sfx.connect(this.master);
    this.eng = ctx.createGain(); this.eng.gain.value = 0.5; this.eng.connect(this.master);
    this.chassis = ctx.createGain(); this.chassis.gain.value = 1.3; this.chassis.connect(this.master);
    this.cabinLP = ctx.createBiquadFilter(); this.cabinLP.type = 'lowpass'; this.cabinLP.frequency.value = 14000; this.cabinLP.Q.value = 0.5;
    this.ext = ctx.createGain(); this.ext.gain.value = 1; this.ext.connect(this.cabinLP); this.cabinLP.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.8; this.amb.connect(this.ext);
    this.trafficBus = ctx.createGain(); this.trafficBus.gain.value = 1.3; this.trafficBus.connect(this.ext);
    // reverb send (synthetic plate) for sfx and music
    this.verb = ctx.createConvolver();
    { const L = Math.floor(sr * 1.4), ir = ctx.createBuffer(2, L, sr); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < L; i++) { const k = 0.85 - 0.75 * i / L; lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * Math.pow(1 - i / L, 3.6) * 0.6; } } this.verb.buffer = ir; } // tail darkens as it decays
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.2; this.verbIn.connect(this.verb); this.verb.connect(this.master);
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
    x.whine = osc('sine', 600); x.whineG = gain(); chain(x.whine, x.whineG, this.eng);
    x.nitro = loopSrc(this.white); x.nitroBP = filt('bandpass', 2400, 0.7); x.nitroG = gain(); chain(x.nitro, x.nitroBP, x.nitroG, this.eng);
    this.x = x;

    // --- TYRES / ROAD / SUSPENSION / WIND
    const t = {};
    t.road = loopSrc(this.brown); t.roadLP = filt('lowpass', 180, 0.6); t.roadG = gain(); chain(t.road, t.roadLP, t.roadG, this.chassis);
    t.hum = loopSrc(this.pink); t.humBP = filt('bandpass', 900, 0.8); t.humG = gain(); chain(t.hum, t.humBP, t.humG, this.chassis);
    t.grit = loopSrc(this.white); t.gritBP = filt('bandpass', 2600, 0.9); t.gritAM = gain(0); t.gritG = gain(); chain(t.grit, t.gritBP, t.gritAM, t.gritG, this.chassis);
    t.gritL = osc('sawtooth', 23); t.gritLG = gain(0.5); chain(t.gritL, t.gritLG, t.gritAM.gain);
    // squeal / wheelspin / lock-up: one recorded squeal at three pitches (added when loaded); scrub underneath
    t.slideG = gain(); t.spinG = gain(); t.lockG = gain();
    t.sqLP = filt('lowpass', 6000, 0.6); chain(t.sqLP, this.chassis);
    for (const g of [t.slideG, t.spinG, t.lockG]) g.connect(t.sqLP);
    t.scrub = loopSrc(this.pink); t.scrubBP = filt('bandpass', 520, 1.1); t.scrubG = gain(); chain(t.scrub, t.scrubBP, t.scrubG, this.chassis);
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
    this.voices = [];
    for (let i = 0; i < 8; i++) {
      const v = { id: -1, kind: null, lvl: 0, srcs: [] };
      v.o3 = osc('sine', 600); v.g3 = gain(0);
      v.eG = gain(); v.eLP = filt('lowpass', 6000, 0.7); chain(v.o3, v.g3, v.eG); v.eLP.connect(v.eG);
      v.nz = loopSrc(this.pink); v.nBP = filt('bandpass', 650, 0.8); v.nG = gain();
      chain(v.nz, v.nBP, v.nG);
      v.air = filt('lowpass', 8000, 0.5); v.out = gain(); v.pan = ctx.createStereoPanner();
      v.eG.connect(v.air); v.nG.connect(v.air); chain(v.air, v.out, v.pan, this.trafficBus);
      this.voices.push(v);
    }

    // --- RADIO
    this.musicBus = gain(0);
    this.musicLP = filt('lowpass', 12000, 0.7);
    this.musicDuck = gain(1);
    this.musicVol = gain(this.vol.music); // the music volume setting (setVolumes)
    chain(this.musicBus, this.musicDuck, this.musicLP, this.musicVol, this.mainOut);
    const mSend = gain(0.12); this.musicVol.connect(mSend); mSend.connect(this.verbIn);
    this.radio = new Radio(ctx, this.musicBus, (track) => this.onTrack?.(track));
    if (this.musicOn) { this.radio.play(); this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 1.2); }

    // --- recorded world sounds
    this.S = {};
    loadWorldSounds(ctx, (name, snd) => { this.S[name] = snd; this.attach(name, snd); });
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
    const key = spec.engine + '@' + spec.idle + '@' + spec.redline;
    const bank = this.banks[key] || (this.banks[key] = buildEngineBank(this.ctx, spec.engine, spec.idle, spec.redline));
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
      console.warn('Recorded engine unavailable; using procedural engine.', error);
    });
  }

  installEngineVoices(bank, spec) {
    this.engineVoice?.stop(); this.rivalVoice?.stop();
    // Let the old positional voice finish its fade through the old routing.
    const oldPan = this.rivalPan, oldAir = this.rivalAir;
    if (oldPan) setTimeout(() => { oldPan.disconnect(); oldAir.disconnect(); }, 500);
    const make = (dest, gain) => bank.recorded
      ? new RecordedEngineVoice(this.ctx, bank, dest, spec, gain)
      : new EngineVoice(this.ctx, bank, dest, gain);
    this.engineVoice = make(this.eng, ENGINE_SOUND[spec.engine]?.gain ?? 1);
    this.rivalPan = this.ctx.createStereoPanner(); this.rivalAir = this.mk.filt('lowpass', 6000, 0.5);
    this.rivalPan.connect(this.ext); this.rivalAir.connect(this.rivalPan);
    this.rivalVoice = make(this.rivalAir, 0.8);
    this.E = ENGINE_SOUND[spec.engine] || ENGINE_SOUND.turbo4;
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
    if (!this.ctx || !recordingFor(this.engineSpec) || this.recordingState === 'fallback') return;
    // setEngine + restart can happen in the same frame.
    if (this.lastIgnitionRequest != null && this.ctx.currentTime - this.lastIgnitionRequest < .1 && (this.pendingIgnition != null || this.ignitionSource)) return;
    this.cancelIgnition();
    this.lastIgnitionRequest = this.pendingIgnition = this.ctx.currentTime;
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

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicOn ? MUSIC_LEVEL : 0, this.ctx.currentTime, 0.3);
      if (this.musicOn) this.radio.play(); else setTimeout(() => { if (!this.musicOn) this.radio.pause(); }, 1200);
    }
    return this.musicOn;
  }
  /** skip to the next song (turns the radio on) */
  nextTrack() {
    if (!this.ctx) return;
    if (!this.musicOn) this.toggleMusic();
    this.radio.next();
  }

  /** hook a recorded sound into the graph built in start() */
  attach(name, snd) {
    const ctx = this.ctx, t = this.t, a = this.a;
    const bed = { 'sea-sand': a.sand, 'sea-rocks': a.rocks, city: a.city, cafe: a.cafe, beach: a.beach, cicadas: a.cic }[name];
    if (bed) loopSource(ctx, snd, bed);
    else if (name === 'wind') t.wind = loopSource(ctx, snd, t.windLP, 0.8);
    else if (name === 'tyre-squeal') { t.slide = loopSource(ctx, snd, t.slideG); t.spin = loopSource(ctx, snd, t.spinG, 1.15); t.lock = loopSource(ctx, snd, t.lockG, 0.8); }
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
   * p: { dt, rpm, redline, load (-1..1), throttle, gear, shift (+1/-1 event), limiter, boost, speed (m/s), skid, wheelspin, lockup,
   *      bump (0..1 event), rough, offroad, nitro, open (roof down / outside cam), muted, sea (0..1), seaPan, city, beach, cicadas,
   *      damage: {rear: 0..1}, action (0..1), rival: {rpm, load, dist, pan, vr}, traffic: [{id, kind, electric, d, pan, vr, v, acc}] }
   */
  update(p) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime, x = this.x, t = this.t, a = this.a;
    const v = Math.max(0, p.speed), red = p.redline || 7000, rn = Math.min(1.1, p.rpm / red);
    const load = p.muted ? 0 : p.load, E = this.E || ENGINE_SOUND.turbo4;
    const mute = p.muted ? 0.25 : 1;
    // ---- engine
    this.lastSpeed = v;
    const startLevel = this.engineStartLevel(now);
    this.updateExhaustRattle(p, now, startLevel);
    if (this.engineVoice) this.engineVoice.set(p.rpm, load, mute * startLevel, now, 1, p.limiter);
    const on = Math.max(0, load) * startLevel;
    x.intakeBP.frequency.setTargetAtTime(260 + rn * 2600, now, 0.05);
    x.intakeG.gain.setTargetAtTime(mute * on * (0.02 + 0.07 * rn), now, 0.05);
    const boost = p.boost || 0, tb = (E === ENGINE_SOUND.turbo3 || E === ENGINE_SOUND.turbo4 || E === ENGINE_SOUND.turbo6) ? 1 : E === ENGINE_SOUND.turbo5 ? 1.25 : E === ENGINE_SOUND.diesel ? 0.6 : 0;
    x.turbo.frequency.setTargetAtTime(1800 + boost * 5200 * (0.6 + 0.4 * rn), now, 0.06);
    x.turbo2.frequency.setTargetAtTime((1800 + boost * 5200 * (0.6 + 0.4 * rn)) * 2.01, now, 0.06);
    x.turboG.gain.setTargetAtTime(mute * tb * boost * boost * 0.011, now, 0.05);
    // blow-off valve / wastegate flutter when the throttle snaps shut on boost
    const lift = (this.lastLoad ?? 0) > 0.3 && load < 0.05;
    if (lift && tb && boost > 0.35) {
      if (E === ENGINE_SOUND.turbo5) this.flutter(boost); else this.noise({ dur: 0.45, f: 2400, sweep: 900, type: 'bandpass', q: 0.7, gain: 0.06 * boost * tb, attack: 0.01, bus: this.eng });
    }
    // overrun: burble and pops from hot exhausts after a lift at high rpm, and on the upshift ignition cut
    if (load < -0.05 && rn > 0.42 && !p.muted) {
      this.popAcc = (this.popAcc || 0) + p.dt * E.pops * (rn - 0.35) * 9 * (this.lastLift < 2 ? 1 : 0.25);
      while (this.popAcc > 1) { this.popAcc -= 1 + Math.random(); this.pop(0.35 + Math.random() * 0.5 * rn, Math.random() * 0.05); }
    }
    this.lastLift = load < -0.05 ? (this.lastLift || 0) + p.dt : 0;
    if (p.shift > 0 && (this.lastLoad ?? 0) > 0.6 && rn > 0.62) { this.clunk(0.6); if (Math.random() < E.pops) this.pop(0.9 + Math.random() * 0.4, 0.015); }
    else if (p.shift > 0) this.clunk(0.4);
    else if (p.shift < 0) { this.clunk(0.3); if (rn > 0.5 && Math.random() < E.pops * 0.8) this.pop(0.5, 0.12); }
    this.lastLoad = load;
    x.whine.frequency.setTargetAtTime(p.rpm / 60 * 7.3 / Math.max(0.6, (p.gearRatio || 1) * 0.35), now, 0.05);
    x.whineG.gain.setTargetAtTime(mute * E.whine * 0.012 * (0.3 + Math.abs(load)) * Math.min(1, v / 8), now, 0.08);
    x.nitroG.gain.setTargetAtTime(p.nitro ? 0.07 : 0, now, p.nitro ? 0.05 : 0.2);

    // ---- tyres
    const sk = Math.min(1.3, p.skid || 0);
    const sq = Math.max(0, sk - 0.25) / 1.05;
    t.slideG.gain.setTargetAtTime(mute * Math.pow(sq, 1.5) * 0.6, now, 0.04);
    t.slide?.playbackRate.setTargetAtTime(0.9 + sk * 0.12 + Math.min(0.08, v * 0.002), now, 0.08);
    t.scrubG.gain.setTargetAtTime(mute * Math.min(1, sk * 1.6) * 0.09 * Math.min(1, v / 12), now, 0.05);
    const ws = p.wheelspin || 0;
    t.spinG.gain.setTargetAtTime(mute * ws * 0.3, now, 0.04);
    t.spin?.playbackRate.setTargetAtTime(1.05 + ws * 0.15, now, 0.05);
    t.lockG.gain.setTargetAtTime(mute * (p.lockup || 0) * 0.45, now, 0.03);
    // ---- road, gravel, suspension
    const rough = p.rough || 0;
    t.roadG.gain.setTargetAtTime(mute * Math.min(0.32, v * 0.0055) * (1 + rough * 0.6 + (p.offroad ? 1.5 : 0)), now, 0.12);
    t.roadLP.frequency.setTargetAtTime(150 + v * 3 + rough * 260 + (p.offroad ? 500 : 0), now, 0.15);
    t.humG.gain.setTargetAtTime(mute * Math.min(0.06, v * v * 0.00002) * (1 + rough), now, 0.2);
    t.humBP.frequency.setTargetAtTime(600 + v * 9, now, 0.2);
    t.gritG.gain.setTargetAtTime(mute * (p.offroad ? Math.min(0.2, v * 0.01) : 0), now, 0.08);
    if (p.bump > 0.05 && !p.muted) this.thump(p.bump, p.wb && v > 2 ? p.wb / v : 0.1);
    // ---- wind (roof down: the full blast; roof up: muffled with a mirror whistle)
    const open = p.open ? 1 : 0;
    t.windG.gain.setTargetAtTime(mute * Math.min(0.6, v * v * 0.00009) * (0.45 + 0.55 * open), now, 0.25);
    t.windLP.frequency.setTargetAtTime(Math.min(12000, 450 + v * (open ? 110 : 45)), now, 0.3);
    t.wind?.playbackRate.setTargetAtTime(0.75 + Math.min(0.45, v / 110), now, 0.4);
    t.whistleG.gain.setTargetAtTime(mute * (1 - open) * Math.max(0, v - 25) * 0.00035, now, 0.4);
    t.whistleBP.frequency.setTargetAtTime(1800 + v * 12, now, 0.4);
    // cabin: roof up filters the outside world
    this.cabinLP.frequency.setTargetAtTime(open ? 15000 : 2600, now, 0.2);
    this.ext.gain.setTargetAtTime(open ? 1 : 0.8, now, 0.2);

    // ---- rival engine (same engine model, positional, doppler)
    if (this.rivalVoice && p.rival) {
      const r = p.rival, att = 1 / (1 + Math.pow(r.dist / 16, 1.7));
      const dop = Math.max(0.7, Math.min(1.4, 343 / (343 - Math.max(-80, Math.min(80, r.vr)))));
      this.rivalVoice.set(r.rpm, r.load, att * 0.7 * mute, now, dop, false, 0.05);
      this.rivalPan.pan.setTargetAtTime(Math.max(-0.95, Math.min(0.95, r.pan)), now, 0.05);
      this.rivalAir.frequency.setTargetAtTime(900 + 9000 * att, now, 0.08);
    }
    // ---- traffic voices
    this.updateTraffic(p.traffic || [], now, mute);
    this.sirens.update(p.traffic || [], now, mute);

    // ---- ambience along the route
    const sea = p.sea || 0, city = p.city || 0, beach = p.beach || 0, cliff = p.cliff || 0;
    const slow = 0.4 + 0.6 * Math.max(0, 1 - v / 30); // voices and cafés drown once you are moving
    a.seaPan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, p.seaPan ?? 0.6)), now, 0.6);
    a.seaLP.frequency.setTargetAtTime(900 + 11000 * sea * sea, now, 0.8); // distant surf loses its hiss first
    a.sand.gain.setTargetAtTime(0.6 * Math.sqrt(sea) * (1 - cliff), now, 1.5);
    a.rocks.gain.setTargetAtTime(0.65 * Math.sqrt(sea) * cliff, now, 1.5);
    a.city.gain.setTargetAtTime(0.55 * city, now, 1.2);
    a.cafe.gain.setTargetAtTime(0.5 * city * slow * (open ? 1 : 0.6), now, 1.2);
    a.beach.gain.setTargetAtTime(0.55 * beach * slow * (open ? 1 : 0.6), now, 1.2);
    a.cic.gain.setTargetAtTime(0.32 * Math.min(1.2, p.cicadas || 0) * Math.max(0, this.weather.cicadas), now, 1.5);
    this.weather.update(p, now);
    if (now > this.nextCic) { this.nextCic = now + 4 + Math.random() * 7; a.cicSwell.gain.setTargetAtTime(0.45 + Math.random() * 0.8, now, 1.8); } // cicadas come in waves
    if (now > this.nextGull) { this.nextGull = now + 5 + Math.random() * 9; if (sea > 0.3 && (open || v < 15)) this.gull(p.seaPan ?? 0.6, sea); }
    if (now > this.nextHorn) { this.nextHorn = now + 6 + Math.random() * 10; if (city > 0.3 && Math.random() < 0.7) this.carHorn(Math.random() < 0.15 ? 'taxi' : Math.random() < 0.3 ? 'scooter' : 'car', Math.random() < 0.3 ? 1 : 0, 0.18, (Math.random() - 0.5) * 1.6); }
    if (now > this.nextScoot) { this.nextScoot = now + 5 + Math.random() * 8; if (city > 0.4) this.moped((Math.random() - 0.5) * 1.6, 0.3); }

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

  updateTraffic(list, now, mute) {
    const V = this.voices;
    const want = list.slice(0, V.length);
    const wantIds = new Set(want.map((o) => o.id));
    for (const v of V) if (v.id >= 0 && !wantIds.has(v.id)) { v.id = -1; v.out.gain.setTargetAtTime(0, now, 0.08); }
    const have = new Set(V.map((v) => v.id));
    for (const o of want) {
      if (have.has(o.id)) continue;
      const v = V.find((q) => q.id < 0); if (!v) break;
      v.id = o.id; v.kind = o.kind; v.electric = !!o.electric; v.out.gain.setValueAtTime(0, now); have.add(o.id);
      this.voiceKind(v, o.kind, now, v.electric);
    }
    for (const v of V) {
      if (v.id < 0) continue;
      const o = want.find((q) => q.id === v.id);
      // Traffic objects and pooled audio voices can be reused for another model; loops can also arrive late.
      if (v.kind !== o.kind || v.electric !== !!o.electric || (v.loops && !v.srcs.length && this.S[v.loops[0]] && this.S[v.loops[2]])) {
        v.kind = o.kind; v.electric = !!o.electric;
        this.voiceKind(v, v.kind, now, v.electric);
      }
      const dop = Math.max(0.75, Math.min(1.35, 343 / (343 - Math.max(-70, Math.min(70, o.vr)))));
      const loadK = Math.max(0, Math.min(1, 0.3 + o.acc * 0.4));
      const K = POLICE[v.kind] || v.kind;
      let rpm = 0, lvl;
      const sp = o.v;
      if (v.electric) {
        // Quiet synthesized motor whine; no combustion or gear-cycle revs.
        lvl = .22 * Math.min(1, sp / 3) * (.35 + .65 * loadK);
        v.o3.frequency.setTargetAtTime((600 + sp * 45) * dop, now, .08);
      } else if (K === 'scooter' || K === 'delivery') {
        // CVT: revs climb quickly then hold while the speed rises
        rpm = 3200 + Math.min(1, sp / 9) * 3800 + loadK * 900; lvl = 0.55 + 0.45 * loadK;
      } else if (K === 'moto') {
        rpm = 2500 + ((sp / 9) % 1) * 4500 + loadK * 1500; lvl = 0.8 + 0.4 * loadK;
      } else if (K === 'bus') {
        rpm = 750 + ((sp / 4.5) % 1) * 1000 + loadK * 300; lvl = 0.95;
      } else {
        const diesel = K === 'taxi' || K === 'van';
        rpm = (diesel ? 800 : 900) + ((sp / (diesel ? 7 : 8)) % 1) * (diesel ? 1500 : 2000) + Math.min(1, sp / 6) * 300 + loadK * 500; lvl = 0.45 + 0.35 * loadK;
      }
      if (v.srcs.length) {
        // idle and running loops, equal-power crossfaded on log rpm like the player's engine
        const [, r0, , r1] = v.loops, x = Math.max(0, Math.min(1, Math.log(rpm / r0) / Math.log(r1 / r0)));
        v.srcs.forEach(({ src, g, ref }, i) => {
          src.playbackRate.setTargetAtTime(Math.max(0.4, Math.min(2.2, rpm / ref)) * dop, now, 0.06);
          g.gain.setTargetAtTime(i ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2), now, 0.08);
        });
        v.eLP.frequency.setTargetAtTime(1800 + 5500 * loadK, now, 0.1);
      }
      v.nz.playbackRate.setTargetAtTime(dop * (0.7 + Math.min(0.6, sp / 40)), now, 0.06);
      const big = K === 'bus' ? 1.6 : K === 'moto' ? 1.3 : K === 'scooter' || K === 'delivery' ? 1.1 : 1;
      const att = 1 / (1 + Math.pow(o.d / (9 * big), 1.6));
      v.eG.gain.setTargetAtTime(lvl * (v.electric ? 0.16 : 1), now, 0.08);
      v.nG.gain.setTargetAtTime(Math.min(0.5, sp * 0.018) * (K === 'scooter' || K === 'delivery' ? 0.3 : K === 'bus' ? 1.3 : 1), now, 0.08);
      v.out.gain.setTargetAtTime(att * mute * 0.9, now, 0.06);
      v.air.frequency.setTargetAtTime(700 + 11000 / (1 + o.d / 25), now, 0.08);
      v.pan.pan.setTargetAtTime(Math.max(-0.95, Math.min(0.95, o.pan)), now, 0.05);
    }
  }
  voiceKind(v, K, now, electric = false) {
    K = POLICE[K] || K;
    for (const { src, g } of v.srcs) { src.stop(now + 0.1); src.onended = () => g.disconnect(); }
    v.srcs = [];
    v.g3.gain.setValueAtTime(electric ? 0.1 : 0, now);
    v.loops = electric ? null : TRAFFIC_LOOPS[K === 'taxi' || K === 'van' ? 'diesel' : K === 'delivery' ? 'scooter' : K] || TRAFFIC_LOOPS.car;
    v.nBP.frequency.setValueAtTime(K === 'bus' ? 420 : K === 'scooter' || K === 'delivery' || K === 'moto' ? 1100 : 650, now);
    if (!v.loops || !this.S[v.loops[0]] || !this.S[v.loops[2]]) return;
    for (const [name, ref] of [[v.loops[0], v.loops[1]], [v.loops[2], v.loops[3]]]) {
      const g = this.mk.gain(0); g.connect(v.eLP);
      v.srcs.push({ src: loopSource(this.ctx, this.S[name], g), g, ref });
    }
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
  /** speed-camera shutter */
  shutter() { if (!this.ctx) return; this.noise({ dur: 0.025, f: 3800, type: 'highpass', gain: 0.3 }); this.noise({ dur: 0.04, f: 2200, type: 'bandpass', q: 3, gain: 0.22, at: 0.08 }); this.tone({ f: 3400, slide: 1800, dur: 0.25, gain: 0.03, at: 0.12 }); }
  /** the blind-assist ticker on a crossing's green man */
  pedTick(fast = false, pan = 0) { if (!this.ctx) return; this.tone({ f: fast ? 1250 : 980, dur: 0.025, gain: 0.05, type: 'square', lp: 2400, pan }); }
  meow() { this.voice([{ v: 'i', dur: 0.1, f0: 720, f1: 820 }, { v: 'a', dur: 0.22, f0: 820, f1: 640 }, { v: 'u', dur: 0.15, f0: 640, f1: 520 }], 0.16, 0.2); }
  woof() { for (const at of [0, 0.22]) this.voice([{ v: 'u', dur: 0.04, f0: 190, f1: 230 }, { v: 'a', dur: 0.1, f0: 230, f1: 160 }], 0.3, -0.1, at); }

  // ------------------------------------------------------------------ game events
  crash(kind, severity = 1) {
    if (!this.ctx) return;
    this.duck(0.9 * severity + 0.3);
    const heavy = kind === 'heavy', r = 0.92 + Math.random() * 0.16;
    // body thud under the recorded impact, for weight
    this.tone({ f: heavy ? 110 : 170, slide: heavy ? 40 : 65, dur: 0.3, gain: (heavy ? 0.4 : 0.25) * severity, type: 'sine' });
    const g = Math.min(1, 0.35 + 0.75 * severity);
    if (heavy) {
      if (this.sample(Math.random() < 0.5 ? 'crash-heavy' : 'crash-medium', { gain: 0.75 * g, rate: r })) { if (severity > 0.5) this.sample('crash-glass', { gain: 0.45 * g, rate: r, at: 0.03 }); return; }
    } else if (this.sample(severity > 0.45 ? 'hit-clank' : 'hit-fast', { gain: 0.7 * g, rate: r })) return;
    // synthesized fallback until the recordings load
    this.noise({ dur: heavy ? 0.4 : 0.2, f: heavy ? 600 : 1400, type: 'lowpass', gain: 0.45 * severity });
    if (heavy) {
      for (let i = 0; i < 3; i++) this.noise({ dur: 0.08, f: 1300 + Math.random() * 1500, type: 'bandpass', q: 3, gain: 0.22, at: 0.03 + i * 0.05 });
      for (let i = 0; i < 6; i++) this.tone({ f: 2600 + Math.random() * 3600, dur: 0.12 + Math.random() * 0.3, gain: 0.04, type: 'sine', at: 0.08 + Math.random() * 0.25 }); // glass tinkle
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
  ui(up = true) { this.pluck(up ? MIDI(74) : MIDI(69), 0, 0.1); }
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
  /** glide the radio's speed (and pitch) to `rate` over `secs` */
  tapeStop(rate, secs) {
    clearInterval(this.tapeT);
    const r0 = this.radio.el.playbackRate, t0 = performance.now();
    this.tapeT = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / 1000 / secs); this.radio.rate = r0 + (rate - r0) * k; if (k >= 1) clearInterval(this.tapeT); }, 50);
  }
  restart() {
    if (!this.ctx) return;
    this.nextExhaustRattle = 0;
    this.lastSpeed = 0; this.requestIgnition();
    const now = this.ctx.currentTime;
    this.tapeStop(1, 0.3);
    this.musicLP.frequency.setTargetAtTime(12000, now, 0.4);
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
Audio.prototype.setVolumes = function ({ master = this.vol.master, music = this.vol.music, sfx = this.vol.sfx } = {}) {
  this.vol = { master, music, sfx };
  if (!this.ctx) return;
  const t = this.ctx.currentTime;
  this.mainOut.gain.setTargetAtTime(master, t, 0.01); this.musicVol.gain.setTargetAtTime(music, t, 0.01); this.master.gain.setTargetAtTime(0.9 * sfx, t, 0.01);
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
