// Fully synthesized soundscape (WebAudio). Starts on the first key press / click (autoplay policy).
//  - player engine: per-engine-type "sampled" cycles rendered at start-up from firing-order pulse models
//    (inline-4 turbo, warbly 5-cylinder, flat-six howl, V12 scream, clattery turbo-diesel), four RPM points x on/off
//    load, equal-power crossfaded like a multi-sample engine; intake roar, turbo spool / blow-off / flutter,
//    transmission whine, rev-limiter stutter, shift clunks, overrun burble and exhaust pops
//  - tyres: scrub, squeal tied to slip, wheelspin chirp, lock-up howl; road roar per surface, suspension thumps over
//    joints and bumps, gravel; wind rising with speed (louder roof-down), cabin filtering when the roof is up
//  - traffic: a pool of positional voices on the nearest vehicles (cars, diesel taxis, buses, scooters, bikes) with
//    doppler, distance filtering and panning; horns, bus air brakes; the rival's engine through the same engine model
//  - ambience that follows the route: sea on the shore side (waves on sand in the bays, slap on the rocks along the
//    cliffs), city rumble and café murmur in Glyfada / Voula, beach crowds at Vouliagmeni / Limanakia, cicadas, gulls
//  - original bouzouki loop (Karplus-Strong) that ducks under the action; master bus compressor

// ------------------------------------------------------------------ engine models
// cyl: cylinders; f1/f2: exhaust resonances (Hz) with decay t1/t2 (s); b: rasp resonance level; thump: low pressure pulse;
// pat: per-cylinder pulse strength (uneven headers / firing order -> warble); jit: cycle-to-cycle variation;
// knock: diesel injection clatter; lp: tone filter range; whine: gearbox whine; pops: overrun crackle tendency
export const ENGINE_SOUND = {
  turbo4: { cyl: 4, f1: 165, f2: 1150, t1: 0.0062, t2: 0.0013, b: 0.36, thump: 0.95, pat: [1, 0.92, 0.97, 0.9], jit: 0.035, knock: 0, rasp: 0.12, lp: [700, 5200], whine: 0.05, pops: 0.6, idleWobble: 0.03, gain: 1 },
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
function buildEngineBank(ctx, type, idle, red) {
  const E = ENGINE_SOUND[type] || ENGINE_SOUND.turbo4;
  const pts = [idle * 1.05, red * 0.34, red * 0.6, red * 0.88];
  const on = [], off = [];
  pts.forEach((r, i) => { on.push(renderEngineCycle(ctx, E, r, true, 6, 11 + i * 7)); off.push(renderEngineCycle(ctx, E, r, false, 14, 101 + i * 13)); });
  return { E, type, pts: pts.map((_, i) => on[i].ref), on, off };
}

/** a playing engine built from a bank: 4 x 2 looping sources, crossfaded by RPM (equal power, log scale) and load */
class EngineVoice {
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
const NOTE = { D4: 62, Eb4: 63, E4: 64, F4: 65, Fs4: 66, G4: 67, A4: 69, Bb4: 70, B4: 71, C5: 72, Cs5: 73, D5: 74, Eb5: 75, E5: 76, Fs5: 78, G5: 79, A5: 81, B5: 83 };

// melody: per bar [note, 16ths, tremolo?]
const MEL_A = [
  [['A4', 2], ['D5', 2], ['D5', 1], ['Eb5', 1], ['D5', 1], ['C5', 1]],
  [['Bb4', 2], ['A4', 2], ['A4', 4, 1]],
  [['G4', 1], ['A4', 1], ['Bb4', 2], ['C5', 2], ['Bb4', 1], ['A4', 1]],
  [['G4', 1], ['Fs4', 1], ['Eb4', 2], ['D4', 4, 1]],
  [['Fs4', 1], ['G4', 1], ['A4', 2], ['D5', 2], ['Eb5', 1], ['D5', 1]],
  [['Fs5', 2], ['Eb5', 1], ['D5', 1], ['C5', 2], ['D5', 2]],
  [['Eb5', 2], ['D5', 1], ['C5', 1], ['Bb4', 2], ['C5', 1], ['Bb4', 1]],
  [['A4', 2], ['G4', 1], ['Fs4', 1], ['Eb4', 1], ['D4', 3, 1]],
];
const MEL_B = [
  [['D5', 1], ['E5', 1], ['Fs5', 2], ['Fs5', 1], ['E5', 1], ['D5', 2]],
  [['B4', 2], ['D5', 2], ['G5', 2], ['Fs5', 1], ['E5', 1]],
  [['E5', 1], ['Fs5', 1], ['E5', 1], ['D5', 1], ['Cs5', 2], ['A4', 2]],
  [['D5', 1], ['Cs5', 1], ['D5', 1], ['E5', 1], ['Fs5', 4, 1]],
  [['A5', 2], ['Fs5', 1], ['A5', 1], ['G5', 1], ['Fs5', 1], ['E5', 1], ['D5', 1]],
  [['B4', 1], ['D5', 1], ['G5', 1], ['D5', 1], ['B5', 2], ['G5', 2]],
  [['A4', 1], ['B4', 1], ['Cs5', 1], ['D5', 1], ['E5', 1], ['G5', 1], ['Fs5', 1], ['E5', 1]],
  [['D5', 2], ['A4', 2], ['D5', 4, 1]],
];
// chords per bar: [bass midi, chord midis]
const CH = {
  D: [50, [62, 66, 69]], Cm: [48, [60, 63, 67]], G: [43, [59, 62, 67]], A7: [45, [61, 64, 67]], Gm: [43, [58, 62, 67]],
};
const PROG_A = ['D', 'D', 'Cm', 'D', 'D', 'D', 'Cm', 'D'];
const PROG_B = ['D', 'G', 'A7', 'D', 'D', 'G', 'A7', 'D'];

function ksPluck(out, sr, t0, freq, dur, amp, o) {
  const D = sr / freq - 0.5;
  const N = Math.max(2, Math.floor(D));
  const frac = D - N, c = (1 - frac) / (1 + frac);
  const buf = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; lp += (w - lp) * o.bright; buf[i] = lp; }
  // pick-position comb for a nasal, metallic attack
  if (o.pick) { const p = Math.max(1, Math.floor(N * o.pick)); for (let i = N - 1; i >= p; i--) buf[i] -= buf[i - p] * 0.8; }
  let mean = 0; for (let i = 0; i < N; i++) mean += buf[i]; mean /= N; for (let i = 0; i < N; i++) buf[i] -= mean;
  const start = Math.floor(t0 * sr), len = Math.min(Math.floor(dur * sr), out.length - start);
  const rel = Math.floor(0.06 * sr);
  let idx = 0, lastX = 0, apx = 0, apy = 0;
  for (let n = 0; n < len; n++) {
    const x = buf[idx];
    const avg = 0.5 * (x + lastX); lastX = x;
    const ap = c * avg + apx - c * apy; apx = avg; apy = ap;
    const y = ap * o.decay;
    buf[idx] = y; idx++; if (idx >= N) idx = 0;
    const env = n > len - rel ? (len - n) / rel : 1;
    out[start + n] += x * amp * env;
  }
}


export class Audio {
  constructor() { this.ctx = null; this.musicOn = true; this.started = false; this.engineSpec = null; this.duckEv = 0; this.banks = {}; }

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
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
    this.master.connect(comp); comp.connect(ctx.destination);
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
    { const L = Math.floor(sr * 1.6), ir = ctx.createBuffer(2, L, sr); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < L; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 3.2) * 0.6; } this.verb.buffer = ir; }
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.35; this.verbIn.connect(this.verb); this.verb.connect(this.master);
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
    // squeal: two resonant noise bands + a wavering tone; scrub underneath
    t.sqN = loopSrc(this.white); t.sqBP1 = filt('bandpass', 950, 9); t.sqBP2 = filt('bandpass', 1450, 12); t.sqG = gain();
    t.sqN.connect(t.sqBP1); t.sqN.connect(t.sqBP2); t.sqBP1.connect(t.sqG); t.sqBP2.connect(t.sqG); t.sqG.connect(this.chassis);
    t.sqT = osc('triangle', 880); t.sqTL = osc('sine', 8.5); t.sqTLG = gain(28); chain(t.sqTL, t.sqTLG, t.sqT.frequency); t.sqTG = gain(); chain(t.sqT, t.sqTG, this.chassis);
    t.scrub = loopSrc(this.pink); t.scrubBP = filt('bandpass', 520, 1.1); t.scrubG = gain(); chain(t.scrub, t.scrubBP, t.scrubG, this.chassis);
    t.spinT = osc('sawtooth', 620); t.spinLP = filt('bandpass', 700, 4); t.spinG = gain(); chain(t.spinT, t.spinLP, t.spinG, this.chassis);
    t.lock = loopSrc(this.white); t.lockBP = filt('bandpass', 620, 7); t.lockG = gain(); chain(t.lock, t.lockBP, t.lockG, this.chassis);
    t.wind = loopSrc(this.pink, 0.8); t.windBP = filt('bandpass', 400, 0.5); t.windMod = gain(1); t.windG = gain(); chain(t.wind, t.windBP, t.windMod, t.windG, this.chassis);
    t.gust = osc('sine', 0.13); t.gustG = gain(0.3); chain(t.gust, t.gustG, t.windMod.gain);
    t.whistle = loopSrc(this.white); t.whistleBP = filt('bandpass', 2200, 14); t.whistleG = gain(); chain(t.whistle, t.whistleBP, t.whistleG, this.chassis);
    this.t = t;

    // --- AMBIENCE: sea (shore side), city, café / beach murmur, cicadas
    const a = {};
    a.seaPan = ctx.createStereoPanner(); a.seaPan.connect(this.amb);
    a.wash = loopSrc(this.pink, 0.55); a.washLP = filt('lowpass', 520, 0.6); a.washG = gain(); chain(a.wash, a.washLP, a.washG, a.seaPan);
    a.surf = loopSrc(this.pink, 0.9); a.surfBP = filt('bandpass', 900, 0.5); a.surfSwell = gain(0.2); a.surfG = gain(); chain(a.surf, a.surfBP, a.surfSwell, a.surfG, a.seaPan);
    a.city = loopSrc(this.brown, 0.7); a.cityLP = filt('lowpass', 240, 0.6); a.cityG = gain(); chain(a.city, a.cityLP, a.cityG, this.amb);
    a.far = loopSrc(this.pink, 0.7); a.farBP = filt('bandpass', 700, 0.7); a.farG = gain(); chain(a.far, a.farBP, a.farG, this.amb);
    // murmur: a few formant-ish noise bands with slow random amplitude (crowd babble)
    a.mur = []; a.murG = gain(); a.murPan = ctx.createStereoPanner(); chain(a.murG, a.murPan, this.amb);
    for (const f of [420, 760, 1250, 2300]) { const s = loopSrc(this.pink); const bp = filt('bandpass', f, 4); const g = gain(0.2); chain(s, bp, g, a.murG); a.mur.push(g); }
    a.cic = loopSrc(this.white); a.cicBP = filt('bandpass', 5400, 7); a.cicAM = gain(0);
    a.cicOsc = osc('square', 48); a.cicOscG = gain(0.5); chain(a.cicOsc, a.cicOscG, a.cicAM.gain);
    a.cicG = gain(); a.cicPan = ctx.createStereoPanner(); a.cicPan.pan.value = -0.4;
    chain(a.cic, a.cicBP, a.cicAM, a.cicG, a.cicPan, this.amb);
    this.a = a;
    const now = ctx.currentTime;
    this.nextWave = now + 1; this.nextGull = now + 3; this.nextHorn = now + 6; this.nextCic = now; this.nextMur = now; this.nextKid = now + 4; this.nextScoot = now + 5;

    // --- TRAFFIC voices (assigned each frame to the nearest vehicles)
    this.voices = [];
    for (let i = 0; i < 8; i++) {
      const v = { id: -1, kind: null, lvl: 0 };
      v.o1 = osc('sawtooth', 60); v.o2 = osc('square', 30); v.o3 = osc('triangle', 600);
      v.g1 = gain(0.5); v.g2 = gain(0.3); v.g3 = gain(0);
      v.eLP = filt('lowpass', 500, 1.2); v.eBP = filt('peaking', 1500, 1); v.eBP.gain.value = 0;
      v.o1.connect(v.g1); v.o2.connect(v.g2); v.o3.connect(v.g3);
      v.g1.connect(v.eLP); v.g2.connect(v.eLP); v.eLP.connect(v.eBP); v.g3.connect(v.eBP);
      v.eG = gain();
      v.nz = loopSrc(this.pink); v.nBP = filt('bandpass', 650, 0.8); v.nG = gain();
      chain(v.nz, v.nBP, v.nG);
      v.air = filt('lowpass', 8000, 0.5); v.out = gain(); v.pan = ctx.createStereoPanner();
      chain(v.eBP, v.eG, v.air); v.nG.connect(v.air); chain(v.air, v.out, v.pan, this.trafficBus);
      this.voices.push(v);
    }

    // --- MUSIC
    this.musicBus = gain(0);
    this.musicLP = filt('lowpass', 12000, 0.7);
    this.musicDuck = gain(1);
    chain(this.musicBus, this.musicDuck, this.musicLP, this.master);
    const mSend = gain(0.3); this.musicBus.connect(mSend); mSend.connect(this.verbIn);
    this.buildMusic();
    if (this.engineSpec) { const s = this.engineSpec; this.engineSpec = null; this.setEngine(s); }
  }

  /** (re)build the player's engine voice (and the rival's, which shares the bank) for a car spec */
  setEngine(spec) {
    if (this.engineSpec && this.engineSpec.engine === spec.engine && this.engineSpec.redline === spec.redline && this.engineVoice) { this.engineSpec = spec; return; }
    this.engineSpec = spec;
    if (!this.ctx) return;
    const key = spec.engine + '@' + spec.redline;
    const bank = this.banks[key] || (this.banks[key] = buildEngineBank(this.ctx, spec.engine, spec.idle, spec.redline));
    if (this.engineVoice) this.engineVoice.stop();
    if (this.rivalVoice) { this.rivalVoice.stop(); this.rivalPan.disconnect(); }
    this.engineVoice = new EngineVoice(this.ctx, bank, this.eng, ENGINE_SOUND[spec.engine]?.gain ?? 1);
    this.rivalPan = this.ctx.createStereoPanner(); this.rivalAir = this.mk.filt('lowpass', 6000, 0.5);
    this.rivalPan.connect(this.ext);
    this.rivalAir.connect(this.rivalPan);
    this.rivalVoice = new EngineVoice(this.ctx, bank, this.rivalAir, 0.8);
    this.E = bank.E;
  }

  // ------------------------------------------------------------------ music generation (time-sliced)
  buildMusic() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const bpm = 138, beat = 60 / bpm, s16 = beat / 4, bar = beat * 2;
    const bars = 32;
    const total = bars * bar;
    const L = new Float32Array(Math.ceil(total * sr) + sr), R = new Float32Array(L.length);
    const melody = new Float32Array(L.length), guitar = new Float32Array(L.length), bass = new Float32Array(L.length), perc = new Float32Array(L.length);
    const sections = [[MEL_A, PROG_A, 0], [MEL_B, PROG_B, 0], [MEL_A, PROG_A, 1], [MEL_B, PROG_B, 1]];
    const tasks = [];
    sections.forEach(([mel, prog, varn], si) => {
      for (let b = 0; b < 8; b++) {
        const t0 = (si * 8 + b) * bar;
        tasks.push(() => {
          // bouzouki melody (double course: unison + octave on low notes)
          let tt = t0;
          const notes = mel[b];
          for (let i = 0; i < notes.length; i++) {
            const [nm, len, trem] = notes[i];
            const f = MIDI(NOTE[nm] + (varn && nm.endsWith('4') ? 12 : 0));
            const dur = len * s16;
            const o = { bright: 0.85, decay: 0.9992, pick: 0.13 };
            if (trem) {
              const step = s16 / 2;
              for (let k = 0; k * step < dur - 0.01; k++) {
                const a = (k % 2 ? 0.55 : 0.75) * (0.8 + 0.2 * Math.random());
                ksPluck(melody, sr, tt + k * step, f, step + 0.07, a * 0.55, o);
                ksPluck(melody, sr, tt + k * step + 0.002, f * 1.0025, step + 0.07, a * 0.4, o);
              }
            } else {
              const sw = i % 2 ? 0.012 : 0;
              ksPluck(melody, sr, tt + sw, f, dur + 0.12, 0.6, o);
              ksPluck(melody, sr, tt + sw + 0.003, f * 1.0028, dur + 0.12, 0.45, o);
              if (f < 330) ksPluck(melody, sr, tt + sw + 0.004, f * 2, dur + 0.1, 0.25, o);
            }
            tt += dur;
          }
        });
        tasks.push(() => {
          const [bn, chord] = CH[prog[b]];
          // oom-pa: bass on the beat, strummed chord on the off-beat
          for (let k = 0; k < 2; k++) {
            const tb = t0 + k * beat;
            ksPluck(bass, sr, tb, MIDI(k === 0 ? bn : bn + 7), beat * 0.9, 0.9, { bright: 0.35, decay: 0.997 });
            for (let j = 0; j < chord.length; j++) ksPluck(guitar, sr, tb + beat / 2 + j * 0.011, MIDI(chord[j]), beat * 0.42, 0.32, { bright: 0.5, decay: 0.994 });
          }
          // toumbeleki-ish percussion: doum on 1, tek on the off-beats, light shaker
          const kick = (tk, g) => { const n0 = Math.floor(tk * sr), n1 = Math.min(perc.length, n0 + Math.floor(0.2 * sr)); let ph = 0; for (let n = n0; n < n1; n++) { const tt2 = (n - n0) / sr; const f = 55 + 70 * Math.exp(-tt2 * 30); ph += 2 * Math.PI * f / sr; perc[n] += Math.sin(ph) * Math.exp(-tt2 * 16) * g; } };
          const tek = (tk, g, f0) => { const n0 = Math.floor(tk * sr), n1 = Math.min(perc.length, n0 + Math.floor(0.05 * sr)); let lp = 0, ph = 0; for (let n = n0; n < n1; n++) { const tt2 = (n - n0) / sr; const w = Math.random() * 2 - 1; lp += (w - lp) * 0.5; ph += 2 * Math.PI * f0 / sr; perc[n] += (w - lp + Math.sin(ph) * 0.6) * Math.exp(-tt2 * 70) * g; } };
          kick(t0, 0.55); kick(t0 + beat, 0.3);
          tek(t0 + beat / 2, 0.22, 420); tek(t0 + beat * 1.5, 0.22, 420); tek(t0 + beat * 1.75, 0.12, 520);
          for (let k = 0; k < 8; k++) tek(t0 + k * s16, 0.035 * (k % 2 ? 0.6 : 1), 2600);
          if (b === 7) for (let k = 0; k < 4; k++) tek(t0 + beat + k * s16, 0.16, 380 + k * 40);
        });
      }
    });
    tasks.push(() => {
      for (let n = 0; n < L.length; n++) {
        const m = melody[n], g = guitar[n], bs = bass[n], p = perc[n];
        L[n] = m * 0.62 + g * 0.6 + bs * 0.55 + p * 0.85;
        R[n] = m * 0.8 + g * 0.38 + bs * 0.55 + p * 0.75;
      }
      const N = Math.floor(total * sr);
      // make the loop seamless: fold the tail into the start
      const tail = L.length - N;
      for (let n = 0; n < tail; n++) { L[n] += L[N + n]; R[n] += R[N + n]; }
      let peak = 0; for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
      const k = 0.9 / Math.max(peak, 1e-3);
      const buf = ctx.createBuffer(2, N, sr);
      const dl = buf.getChannelData(0), dr = buf.getChannelData(1);
      for (let n = 0; n < N; n++) { dl[n] = L[n] * k; dr[n] = R[n] * k; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 1500; body.Q.value = 1.4; body.gain.value = 3;
      src.connect(body); body.connect(this.musicBus);
      src.start();
      this.musicSrc = src;
      this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.8 : 0, ctx.currentTime, 1.2);
    });
    const run = () => {
      const t0 = performance.now();
      while (tasks.length && performance.now() - t0 < 6) tasks.shift()();
      if (tasks.length) setTimeout(run, 16);
    };
    setTimeout(run, 30);
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.8 : 0, this.ctx.currentTime, 0.3);
    return this.musicOn;
  }


  // ------------------------------------------------------------------ per-frame
  /**
   * p: { dt, rpm, redline, load (-1..1), throttle, gear, shift (+1/-1 event), limiter, boost, speed (m/s), skid, wheelspin, lockup,
   *      bump (0..1 event), rough, offroad, nitro, open (roof down / outside cam), muted, sea (0..1), seaPan, city, beach, cicadas,
   *      action (0..1), rival: {rpm, load, dist, pan, vr}, traffic: [{id, kind, d, pan, vr, v, acc}] }
   */
  update(p) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime, x = this.x, t = this.t, a = this.a;
    const v = Math.max(0, p.speed), red = p.redline || 7000, rn = Math.min(1.1, p.rpm / red);
    const load = p.muted ? 0 : p.load, E = this.E || ENGINE_SOUND.turbo4;
    const mute = p.muted ? 0.25 : 1;
    // ---- engine
    if (this.engineVoice) this.engineVoice.set(p.rpm, load, mute, now, 1, p.limiter);
    const on = Math.max(0, load);
    x.intakeBP.frequency.setTargetAtTime(260 + rn * 2600, now, 0.05);
    x.intakeG.gain.setTargetAtTime(mute * on * (0.02 + 0.07 * rn), now, 0.05);
    const boost = p.boost || 0, tb = E === ENGINE_SOUND.turbo4 ? 1 : E === ENGINE_SOUND.turbo5 ? 1.25 : E === ENGINE_SOUND.diesel ? 0.6 : 0;
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
    t.sqG.gain.setTargetAtTime(mute * sq * sq * 0.5, now, 0.04);
    t.sqTG.gain.setTargetAtTime(mute * sq * sq * 0.035, now, 0.04);
    t.sqBP1.frequency.setTargetAtTime(820 + sk * 260 + v * 2, now, 0.08);
    t.sqBP2.frequency.setTargetAtTime(1300 + sk * 300, now, 0.08);
    t.sqT.frequency.setTargetAtTime(760 + sk * 240, now, 0.08);
    t.scrubG.gain.setTargetAtTime(mute * Math.min(1, sk * 1.6) * 0.09 * Math.min(1, v / 12), now, 0.05);
    const ws = p.wheelspin || 0;
    t.spinG.gain.setTargetAtTime(mute * ws * 0.04, now, 0.04);
    t.spinT.frequency.setTargetAtTime(520 + ws * 260 + Math.random() * 40, now, 0.03);
    t.lockG.gain.setTargetAtTime(mute * (p.lockup || 0) * 0.25, now, 0.03);
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
    t.windG.gain.setTargetAtTime(mute * Math.min(0.3, v * v * 0.000045) * (0.45 + 0.55 * open), now, 0.25);
    t.windBP.frequency.setTargetAtTime(250 + v * (open ? 14 : 8), now, 0.3);
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

    // ---- ambience along the route
    const sea = p.sea || 0, city = p.city || 0, beach = p.beach || 0, cliff = p.cliff || 0;
    a.seaPan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, p.seaPan ?? 0.6)), now, 0.6);
    a.washG.gain.setTargetAtTime(0.13 * sea, now, 0.8);
    a.surfG.gain.setTargetAtTime(0.16 * sea, now, 0.8);
    a.surfBP.frequency.setTargetAtTime(cliff > 0.5 ? 1500 : 850, now, 1);
    a.cityG.gain.setTargetAtTime(0.09 * city, now, 1.0);
    a.farG.gain.setTargetAtTime(0.03 * city, now, 1.0);
    a.murG.gain.setTargetAtTime(0.05 * Math.max(city * 0.6, beach) * (open ? 1 : 0.6) * Math.max(0, 1 - v / 40), now, 1.0);
    a.cicG.gain.setTargetAtTime(0.03 * (p.cicadas || 0), now, 1.2);
    if (now > this.nextWave) {
      // waves: long swells breaking on sand in the bays, quicker slaps against rocks below the cliffs
      this.nextWave = now + (cliff > 0.5 ? 2 + Math.random() * 2.5 : 3.5 + Math.random() * 4);
      const g = a.surfSwell.gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
      if (cliff > 0.5) { g.linearRampToValueAtTime(1.2 + Math.random() * 0.6, now + 0.25); g.linearRampToValueAtTime(0.15, now + 1.6); }
      else { g.linearRampToValueAtTime(1.0 + Math.random() * 0.6, now + 1.1); g.linearRampToValueAtTime(0.2, now + 3.6); }
    }
    if (now > this.nextMur) { this.nextMur = now + 0.25 + Math.random() * 0.4; for (const g of a.mur) g.gain.setTargetAtTime(0.05 + Math.random() * 0.35, now, 0.12); a.murPan.pan.setTargetAtTime((Math.random() - 0.5) * 1.2, now, 1.5); }
    if (now > this.nextCic) {
      this.nextCic = now + 4 + Math.random() * 6;
      a.cicOscG.gain.setTargetAtTime(0.25 + Math.random() * 0.4, now, 1.5);
      a.cicBP.frequency.setTargetAtTime(4800 + Math.random() * 1200, now, 1);
    }
    if (now > this.nextGull) { this.nextGull = now + 4 + Math.random() * 9; if (sea > 0.3 && (open || v < 15)) this.gull(p.seaPan ?? 0.6); }
    if (now > this.nextKid) { this.nextKid = now + 2.5 + Math.random() * 5; if (beach > 0.4 && (open || v < 12)) this.kid(); }
    if (now > this.nextHorn) { this.nextHorn = now + 6 + Math.random() * 10; if (city > 0.3 && Math.random() < 0.7) this.carHorn(Math.random() < 0.15 ? 'taxi' : Math.random() < 0.3 ? 'scooter' : 'car', Math.random() < 0.3 ? 1 : 0, 0.18, (Math.random() - 0.5) * 1.6); }
    if (now > this.nextScoot) { this.nextScoot = now + 5 + Math.random() * 8; if (city > 0.4) this.moped((Math.random() - 0.5) * 1.6, 0.3); }

    // ---- music ducks under the action (crashes, horns, slides, speed)
    this.duckEv = Math.max(0, this.duckEv - p.dt * 0.7);
    const duck = Math.min(1, Math.max(this.duckEv, (p.action || 0) * 0.6, sq * 0.8));
    this.musicDuck.gain.setTargetAtTime(1 - 0.55 * duck, now, duck > (this.lastDuck || 0) ? 0.05 : 0.6);
    this.lastDuck = duck;
  }
  duck(amount = 1) { this.duckEv = Math.max(this.duckEv, amount); }

  updateTraffic(list, now, mute) {
    const V = this.voices;
    const want = list.slice(0, V.length);
    const wantIds = new Set(want.map((o) => o.id));
    for (const v of V) if (v.id >= 0 && !wantIds.has(v.id)) { v.id = -1; v.out.gain.setTargetAtTime(0, now, 0.08); }
    const have = new Set(V.map((v) => v.id));
    for (const o of want) {
      if (have.has(o.id)) continue;
      const v = V.find((q) => q.id < 0); if (!v) break;
      v.id = o.id; v.kind = o.kind; v.out.gain.setValueAtTime(0, now); have.add(o.id);
      this.voiceKind(v, o.kind, now);
    }
    for (const v of V) {
      if (v.id < 0) continue;
      const o = want.find((q) => q.id === v.id);
      const dop = Math.max(0.75, Math.min(1.35, 343 / (343 - Math.max(-70, Math.min(70, o.vr)))));
      const loadK = Math.max(0, Math.min(1, 0.3 + o.acc * 0.4));
      const K = v.kind;
      let fire, lvl;
      const sp = o.v;
      if (K === 'scooter' || K === 'delivery') {
        // CVT: revs climb quickly then hold while the speed rises
        const rpm = 3200 + Math.min(1, sp / 9) * 3800 + loadK * 900; fire = rpm / 120; lvl = 0.55 + 0.45 * loadK;
        v.o3.frequency.setTargetAtTime((520 + sp * 22) * dop, now, 0.05);
      } else if (K === 'moto') {
        const rpm = 2500 + ((sp / 9) % 1) * 4500 + loadK * 1500; fire = rpm / 60; lvl = 0.8 + 0.4 * loadK;
      } else if (K === 'bus') {
        const rpm = 750 + ((sp / 4.5) % 1) * 1000 + loadK * 300; fire = rpm / 20; lvl = 0.95;
      } else {
        const diesel = K === 'taxi' || K === 'van';
        const rpm = (diesel ? 800 : 900) + ((sp / (diesel ? 7 : 8)) % 1) * (diesel ? 1500 : 2000) + Math.min(1, sp / 6) * 300 + loadK * 500; fire = rpm / 30; lvl = 0.45 + 0.35 * loadK;
      }
      v.o1.frequency.setTargetAtTime(fire * dop, now, 0.06);
      v.o2.frequency.setTargetAtTime(fire * 0.5 * dop, now, 0.06);
      v.nz.playbackRate.setTargetAtTime(dop * (0.7 + Math.min(0.6, sp / 40)), now, 0.06);
      const big = K === 'bus' ? 1.6 : K === 'moto' ? 1.3 : K === 'scooter' || K === 'delivery' ? 1.1 : 1;
      const att = 1 / (1 + Math.pow(o.d / (9 * big), 1.6));
      v.eG.gain.setTargetAtTime(lvl * 0.16, now, 0.08);
      v.nG.gain.setTargetAtTime(Math.min(0.5, sp * 0.018) * (K === 'scooter' || K === 'delivery' ? 0.3 : K === 'bus' ? 1.3 : 1), now, 0.08);
      v.out.gain.setTargetAtTime(att * mute * 0.9, now, 0.06);
      v.air.frequency.setTargetAtTime(700 + 11000 / (1 + o.d / 25), now, 0.08);
      v.pan.pan.setTargetAtTime(Math.max(-0.95, Math.min(0.95, o.pan)), now, 0.05);
    }
  }
  voiceKind(v, K, now) {
    const bike = K === 'scooter' || K === 'delivery' || K === 'moto';
    v.o1.type = 'sawtooth'; v.o2.type = K === 'bus' || K === 'taxi' || K === 'van' ? 'square' : 'triangle';
    v.g1.gain.setValueAtTime(bike ? 0.6 : 0.45, now); v.g2.gain.setValueAtTime(K === 'bus' ? 0.7 : K === 'taxi' ? 0.45 : 0.25, now);
    v.g3.gain.setValueAtTime(K === 'scooter' || K === 'delivery' ? 0.12 : 0, now);
    v.eLP.frequency.setValueAtTime(K === 'bus' ? 320 : bike ? 2600 : K === 'taxi' ? 520 : 420, now);
    v.eBP.frequency.setValueAtTime(bike ? 1700 : 900, now); v.eBP.gain.setValueAtTime(bike ? 9 : 0, now);
    v.nBP.frequency.setValueAtTime(K === 'bus' ? 420 : bike ? 1100 : 650, now);
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
  /** a child shouting at the beach */
  kid() {
    if (!this.ctx) return;
    const p = 1.8 + Math.random() * 0.5;
    this.voiceBus = this.amb; this.shout(p, Math.floor(Math.random() * 5), (Math.random() - 0.5) * 1.4, 0.06); this.voiceBus = null;
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
  scream() { const p = 0.9 + Math.random() * 0.3; this.voice([{ v: 'a', dur: 0.12, f0: 330 * p, f1: 520 * p }, { v: 'ah', dur: 0.45, f0: 540 * p, f1: 380 * p }], 0.22, 0.3); }
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
    const heavy = kind === 'heavy';
    // body thud + crunch
    this.tone({ f: heavy ? 130 : 200, slide: heavy ? 42 : 70, dur: 0.35, gain: 0.55 * severity, type: 'sine' });
    this.noise({ dur: heavy ? 0.4 : 0.2, f: heavy ? 600 : 1400, type: 'lowpass', gain: 0.45 * severity });
    if (heavy) {
      for (let i = 0; i < 3; i++) this.noise({ dur: 0.08, f: 1300 + Math.random() * 1500, type: 'bandpass', q: 3, gain: 0.22, at: 0.03 + i * 0.05 });
      for (let i = 0; i < 6; i++) this.tone({ f: 2600 + Math.random() * 3600, dur: 0.12 + Math.random() * 0.3, gain: 0.04, type: 'sine', at: 0.08 + Math.random() * 0.25 }); // glass tinkle
    }
    // the cartoon layer
    const r = Math.random();
    if (r < 0.35) this.tone({ f: 260, slide: 620, dur: 0.5, gain: 0.12, type: 'sine', vib: 40, vibF: 17, at: 0.06 }); // boing
    else if (r < 0.6) this.tone({ f: 1700, slide: 260, dur: 0.6, gain: 0.08, type: 'sine', at: 0.05, vib: 10, vibF: 5 }); // slide whistle down
    else if (r < 0.8) { this.tone({ f: 690, dur: 0.09, gain: 0.2, type: 'sine', at: 0.04 }); this.tone({ f: 1380, dur: 0.06, gain: 0.08, at: 0.04 }); } // bonk
    else { this.tone({ f: 420, slide: 520, dur: 0.12, gain: 0.08, type: 'square', at: 0.05, lp: 1800 }); this.tone({ f: 520, slide: 380, dur: 0.18, gain: 0.08, type: 'square', at: 0.17, lp: 1800 }); } // clown honk
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
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(175, t); o.frequency.linearRampToValueAtTime(190, t + 0.35); o.frequency.exponentialRampToValueAtTime(125, t + 0.9);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * level, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    const pn = ctx.createStereoPanner(); pn.pan.setValueAtTime(pan * 0.3, t); pn.pan.linearRampToValueAtTime(pan, t + 0.9);
    o.connect(bp); bp.connect(g); g.connect(pn); pn.connect(this.trafficBus);
    o.start(t); o.stop(t + 1.05);
  }
  curb(strength = 0.5) { this.tone({ f: 90, slide: 50, dur: 0.15, gain: 0.25 * strength, type: 'sine' }); this.noise({ dur: 0.18, f: 2200, type: 'highpass', gain: 0.08 * strength }); }
  horn(big, level = 0.6, pan = 0, at = 0) {
    if (!this.ctx) return;
    const d = 0.25 + Math.random() * 0.35;
    const f1 = big ? 220 : 400, f2 = big ? 277 : 500;
    this.duck(0.35 * level);
    for (const f of [f1, f2]) this.tone({ f, dur: d, gain: 0.045 * level, type: 'square', attack: 0.01, lp: 2200, pan, at, bus: this.trafficBus });
  }
  /** a traffic horn: car (two-tone), taxi, bus (low, brassy), scooter / moto (thin "meep"). style 1 = long lean on it */
  carHorn(kind = 'car', style = 0, level = 1, pan = 0, at = 0) {
    if (!this.ctx || level < 0.02) return;
    const bus = kind === 'bus', bike = kind === 'scooter' || kind === 'delivery' || kind === 'moto';
    const f1 = bus ? 196 : bike ? 560 + Math.random() * 80 : kind === 'taxi' ? 415 : 360 + Math.random() * 90, f2 = bike ? f1 * 1.06 : f1 * 1.26;
    const pattern = style ? [[0, 0.75 + Math.random() * 0.5]] : Math.random() < 0.5 ? [[0, 0.12], [0.2, 0.16]] : [[0, 0.28]];
    const g = (bike ? 0.035 : bus ? 0.07 : 0.055) * Math.min(1, level);
    const lp = 900 + 2400 * Math.min(1, level); // distant horns lose their bite
    if (level > 0.3) this.duck(0.3 * Math.min(1, level));
    for (const [t0, d] of pattern) for (const f of bike ? [f1] : [f1, f2]) this.tone({ f, dur: d, gain: g, type: bike ? 'square' : 'sawtooth', attack: 0.012, lp, pan, at: at + t0, bus: this.trafficBus || this.amb });
  }
  gull(side = 0.6) {
    const pan = Math.max(-1, Math.min(1, side * (0.5 + Math.random() * 0.5)));
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
    if (this.musicSrc) { this.musicSrc.playbackRate.cancelScheduledValues(now); this.musicSrc.playbackRate.setValueAtTime(1, now); this.musicSrc.playbackRate.linearRampToValueAtTime(0.45, now + 2.2); }
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
  restart() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.musicSrc) { this.musicSrc.playbackRate.cancelScheduledValues(now); this.musicSrc.playbackRate.setTargetAtTime(1, now, 0.3); }
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
// debug helper: RMS (dBFS) per bus, to keep the mix balanced
Audio.prototype.busLevels = function () {
  if (!this.ctx) return null;
  if (!this.taps) {
    this.taps = {};
    for (const k of ['eng', 'chassis', 'trafficBus', 'amb', 'sfx', 'musicDuck']) { const an = this.ctx.createAnalyser(); an.fftSize = 2048; this[k].connect(an); this.taps[k] = an; }
    return null;
  }
  const out = {}, buf = new Float32Array(2048);
  for (const k in this.taps) { this.taps[k].getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; out[k] = +(10 * Math.log10(s / buf.length + 1e-12)).toFixed(1); }
  return out;
};
