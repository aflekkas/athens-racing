import { BranchGate } from "./robust.js";
// Firing-order fallback; licensed recordings take precedence. No frame-time buffer generation.
// ------------------------------------------------------------------ engine models
// cyl: cylinders; f1/f2: exhaust resonances (Hz) with decay t1/t2 (s); b: rasp resonance level; thump: low pressure pulse;
// pat: per-cylinder pulse strength (uneven headers / firing order -> warble); jit: cycle-to-cycle variation;
// knock: diesel injection clatter; lp: tone filter range; whine: gearbox whine; pops: overrun crackle tendency
export const ENGINE_SOUND = {
  v8flat: { cyl: 8, f1: 270, f2: 2350, t1: .0038, t2: .001, b: .57, thump: .66, pat: [1,.98,.99,.97,1,.98,.99,.97], jit: .015, knock: 0, rasp: .29, lp: [1100,8500], whine: .13, pops: .28, idleWobble: .025, gain: 1 },
  v8na: { cyl: 8, f1: 115, f2: 1050, t1: .0072, t2: .0016, b: .34, thump: 1.12, pat: [1,.68,.91,.72,.98,.70,.88,.76], jit: .025, knock: 0, rasp: .16, lp: [620,6200], whine: .06, pops: .26, idleWobble: .035, gain: 1 },
  // Catalogue additions: synthesized firing pulses, not recordings of these models.
  na6: { cyl: 6, f1: 185, f2: 1600, t1: .0053, t2: .0012, b: .40, thump: .82, pat: [1,.98,.96,1,.97,.99], jit: .018, knock: 0, rasp: .19, lp: [850,7200], whine: .06, pops: .18, idleWobble: .02, gain: 1 },
  // Huracán 5.2 common-pin crank: alternating 54°/90°, not the older 5.0's even 72°.
  v10: { cyl: 10, angles:[0,54,144,198,288,342,432,486,576,630], f1: 290, f2: 2300, t1: .0035, t2: .001, b: .52, thump: .68, pat: [1,.92,.98,.94,1,.91,.97,.95,.99,.93], jit: .018, knock: 0, rasp: .26, lp: [1100,8500], whine: .10, pops: .70, idleWobble: .016, gain: 1 },
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

// Explicit layouts absent from the original fallback bank.
ENGINE_SOUND.na3 = { ...ENGINE_SOUND.turbo3, pops: 0, rasp: .2, lp: [900, 6500] };
ENGINE_SOUND.city4 = { ...ENGINE_SOUND.na4, pops: 0, gain: .8, thump: .65, lp: [800, 5800] };
ENGINE_SOUND.v6 = { ...ENGINE_SOUND.turbo6, f1: 130, f2: 1100, pat: [1,.72,.94,.78,1,.70], jit: .03, pops: .5 };
ENGINE_SOUND.v8 = { ...ENGINE_SOUND.turbo6, cyl: 8, f1: 105, f2: 950, t1: .008, pat: [1,.65,.85,.72,.95,.70,1,.68], thump: 1.15, pops: .6 };
ENGINE_SOUND.bus = { ...ENGINE_SOUND.diesel, cyl: 6, f1: 70, f2: 450, pat: [1,.97,.94,1,.96,.98], lp: [400,2200], pops: 0 };
ENGINE_SOUND.truck = { ...ENGINE_SOUND.diesel, f1: 85, f2: 950, thump: 1.25, knock: .9, lp: [600,3300], pops: 0 };
ENGINE_SOUND.bike = { ...ENGINE_SOUND.na4, cyl: 2, f1: 260, pat: [1,.8], pops: 0, gain: .65 };
ENGINE_SOUND.electric = { cyl: 0, whine: 0, knock: 0, pops: 0 };

export function rng32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** one looped buffer: `cycles` full 720-degree engine cycles at refRpm, on or off load */
function renderEngineCycle(ctx, E, refRpm, onLoad, cycles, seed) {
  const sr = ctx.sampleRate;
  const nc = Math.max(64, Math.round(120 / refRpm * sr)), N = nc * cycles;
  const out = new Float32Array(N);
  const rnd = rng32(seed);
  const ti = nc / E.cyl;
  // Exhaust valve opening: a broad pressure wave followed by a negative reflection,
  // not a ringing sine at each firing. Kernels are calculated once, outside pulse loops.
  const L1 = Math.ceil(sr * .028), kernel = new Float32Array(L1);
  const exotic=E.cyl>=10, smoothSix=E.cyl===6&&!E.knock;
  const width = onLoad ? (exotic?.00042:smoothSix?.0008:.00115) : .0018;
  for(let n=0;n<L1;n++){
    const t=n/sr;
    const pressure=(Math.exp(-t/width)-Math.exp(-t/.00016))*E.thump;
    const reflection=t>.0021?-(exotic?.15:.38)*Math.exp(-(t-.0021)/.0023):0;
    kernel[n]=pressure+reflection
      +.32*Math.exp(-t/E.t1)*Math.sin(2*Math.PI*E.f1*t)
      +E.b*(onLoad?(exotic?1.2:smoothSix?.75:.34):.09)*Math.exp(-t/E.t2)*Math.sin(2*Math.PI*E.f2*t);
  }
  // Bank arrival offsets/attenuation produce different engine orders. Cross-plane
  // V8 headers have adjacent firings on a bank; a flat-plane V8 alternates banks.
  const bankOrder=E.cyl===8&&E.f1<150?[0,1,1,0,1,0,0,1]:null;
  let smoothNoise=0;
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < E.cyl; k++) {
      const bank=bankOrder?bankOrder[k]:k%2;
      const phase=E.angles ? E.angles[k]/720 : k/E.cyl;
      const t0 = Math.round(c * nc + phase * nc + (rnd() - 0.5) * ti * E.jit*.22 + bank*sr*.00035);
      let amp = E.pat[k % E.pat.length] * (1 + (rnd() - 0.5) * 2 * E.jit);
      // No randomly embedded pops in loops (especially the SVJ). Overrun combustion
      // is a bounded, non-looping event selected by the trim in audio.js.
      if (!onLoad) amp *= .62 + rnd()*.15;
      amp*=bank?.84:1;
      for (let n = 0; n < L1; n++) {
        out[(t0+n)%N]+=kernel[n]*amp;
      }
      // Stochastic turbulent flow is strongest while the valve is open. Longer
      // cycle banks and independent noise remove the old six-cycle buzz pattern.
      const Lr=Math.ceil(ti*.85),rasp=E.rasp*(onLoad?1.1:.2)*amp;
      for(let n=0;n<Lr;n++){
        const w=rnd()*2-1;smoothNoise+=(w-smoothNoise)*.22;
        const envelope=(1-n/Lr)**2;
        out[(t0+n)%N]+=(w*.2+smoothNoise)*rasp*envelope;
      }
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
  // Match useful RMS rather than making a tiny off-load click as loud as combustion.
  let energy=0;for(const x of out)energy+=x*x;
  const k=Math.min(.82/pk,(onLoad?.20:.105)/Math.sqrt(energy/N+1e-12));
  for (let i = 0; i < N; i++) out[i] *= k;
  const buf = ctx.createBuffer(1, N, sr); buf.getChannelData(0).set(out);
  return { buf, ref: 120 * sr / nc };
}

/** multi-sample bank for an engine type: four RPM points, on and off load */
export function buildEngineBank(ctx, type, idle, red, profile = {}) {
  const base = ENGINE_SOUND[type] || ENGINE_SOUND.turbo4;
  if(type==='electric')return {E:base,type,electric:true,profile};
  const E={...base,jit:profile.rough??base.jit};
  const pts = [Math.max(400,idle) * 1.05, red * 0.34, red * 0.6, red * 0.88];
  const on = [], off = [];
  pts.forEach((r, i) => { on.push(renderEngineCycle(ctx, E, r, true, Math.ceil(r*1.7/120), 11 + i * 7)); off.push(renderEngineCycle(ctx, E, r, false, Math.ceil(r*2.3/120), 101 + i * 13)); });
  return { E, type, profile, pts: pts.map((_, i) => on[i].ref), on, off };
}

/** a playing engine built from a bank: 4 x 2 looping sources, crossfaded by RPM (equal power, log scale) and load */
export class EngineVoice {
  constructor(ctx, bank, dest, gain = 1) {
    if(bank.electric)return new ElectricMotorVoice(ctx,dest,gain,bank.profile);
    this.ctx = ctx; this.bank = bank;
    const E = bank.E;
    this.sum = ctx.createGain();
    this.src = []; this.gOn = []; this.gOff = [];
    const t = ctx.currentTime, crankPhase = Math.random();
    this.wander = rng32(413 + E.cyl); this.nextWander = 0; this.rpmWander = 0;
    for (let i = 0; i < bank.pts.length; i++) {
      for (const [list, gl, b] of [[this.src, this.gOn, bank.on[i]], [this.src, this.gOff, bank.off[i]]]) {
        const s = ctx.createBufferSource(); s.buffer = b.buf; s.loop = true; s.playbackRate.value = 1;
        const g = ctx.createGain(); g.gain.value = 0;
        s.connect(g); g.connect(this.sum); s.start(t, crankPhase * 120 / b.ref);
        list.push(s); gl.push(g);
      }
    }
    this.branches = []; for (let k = 0; k < bank.pts.length; k++) for (const g of [this.gOn[k], this.gOff[k]]) this.branches.push(new BranchGate(g, this.sum, .4, 1e-4)); // [on k, off k] pairs
    this.shaper = ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
    this.shaper.curve = curve; this.shaper.oversample = '2x';
    this.pre = ctx.createGain(); this.pre.gain.value = 0.8;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 0.7; this.lp.frequency.value = E.lp[0];
    this.body = ctx.createBiquadFilter(); this.body.type = 'peaking'; this.body.frequency.value = bank.profile?.body || E.f1; this.body.Q.value = 0.65; this.body.gain.value = 0;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.lim = ctx.createGain(); this.lim.gain.value = 1;
    this.sum.connect(this.pre); this.pre.connect(this.shaper); this.shaper.connect(this.lp); this.lp.connect(this.body); this.body.connect(this.lim); this.lim.connect(this.out);
    this.out.connect(dest);
    // limiter stutter LFO
    this.lfo = ctx.createOscillator(); this.lfo.type = 'square'; this.lfo.frequency.value = E.knock?9:13;
    this.lfoG = ctx.createGain(); this.lfoG.gain.value = 0; this.lfo.connect(this.lfoG); this.lfoG.connect(this.lim.gain); this.lfo.start();
    this.level = gain;
  }
  /** rpm, load (-1..1), level, doppler factor, limiter on/off */
  set(rpm, load, level, now, dop = 1, limiter = false, tc = 0.03) {
    if (this.stopped) return;
    const b = this.bank, P = b.pts, E = b.E;
    if(now >= this.nextWander){this.rpmWander=(this.wander()*2-1)*E.idleWobble;this.nextWander=now+.08+this.wander()*.14;}
    const r = Math.max(P[0] * 0.7, rpm) * (1 + this.rpmWander * Math.max(0,1-rpm/(P[0]*2)));
    let i = 0; while (i < P.length - 2 && r > P[i + 1]) i++;
    let x = Math.log(r / P[i]) / Math.log(P[i + 1] / P[i]); x = Math.max(0, Math.min(1, x));
    const wA = Math.cos(x * Math.PI / 2), wB = Math.sin(x * Math.PI / 2);
    const on = Math.max(0, Math.min(1, (load + 0.08) / 1.08));
    const gOn = Math.sqrt(on), gOff = Math.sqrt(1 - on);
    for (let k = 0; k < P.length; k++) {
      const w = k === i ? wA : k === i + 1 ? wB : 0;
      const rate = r / P[k] * dop;
      this.src[k * 2].playbackRate.setTargetAtTime(rate, now, tc);
      this.src[k * 2 + 1].playbackRate.setTargetAtTime(rate, now, tc);
      this.gOn[k].gain.setTargetAtTime(w * gOn, now, 0.03);
      this.gOff[k].gain.setTargetAtTime(w * gOff * .85, now, 0.03);
      this.branches[k * 2].use(w * gOn, now); this.branches[k * 2 + 1].use(w * gOff * .85, now);
    }
    const rn = Math.min(1.1, rpm / (P[3] / 0.88));
    this.lp.frequency.setTargetAtTime((E.lp[0] + (E.lp[1] - E.lp[0]) * Math.min(1, rn * (0.35 + 0.65 * on)))*(b.profile?.tone??1), now, 0.04);
    this.body.gain.setTargetAtTime(on*(b.profile?.growl??3),now,.045);
    this.pre.gain.setTargetAtTime(1 + on * .5, now, .045);
    this.out.gain.setTargetAtTime(level * this.level * .44 * (.62 + .38 * rn) * (.68 + .32 * on), now, .025);
    this.lim.gain.setTargetAtTime(limiter?.57:1,now,.008);
    this.lfoG.gain.setTargetAtTime(limiter ? -.43 : 0, now, .008);
  }
  stop() {
    if (this.stopped) return; this.stopped = true;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const s of this.src) s.stop(t + 0.3);
    this.lfo.stop(t + 0.3);
    this.lfo.onended = () => {
      for (const s of this.src) s.disconnect();
      for (const g of this.gOn) g.disconnect();
      for (const g of this.gOff) g.disconnect();
      for (const n of [this.sum, this.pre, this.shaper, this.lp, this.body, this.lim, this.out, this.lfo, this.lfoG]) n.disconnect();
    };
  }
}

/** Rotor orders only: no combustion, starter, idle, gear blips or exhaust at zero speed. */
export class ElectricMotorVoice {
  constructor(ctx,dest,gain=1,profile={}) {
    this.ctx=ctx;this.level=gain;this.order=profile.motorOrder??8;
    this.out=ctx.createGain();this.out.gain.value=0;this.out.connect(dest);
    this.rotor=ctx.createOscillator();this.rotor.type='sine';
    this.rotor.connect(this.out);this.rotor.start();
    if(!profile.distant){
      this.mesh=ctx.createOscillator();this.mesh.type='sine';
      this.meshGain=ctx.createGain();this.meshGain.gain.value=.18;
      this.mesh.connect(this.meshGain);this.meshGain.connect(this.out);this.mesh.start();
    }
  }
  set(rpm,load,level,now,dop=1) {
    if(this.stopped)return;
    const speed=Math.max(0,rpm),moving=Math.min(1,speed/900);
    this.rotor.frequency.setTargetAtTime(Math.max(20,speed/60*this.order)*dop,now,.05);
    this.mesh?.frequency.setTargetAtTime(Math.max(30,speed/60*this.order*2.05)*dop,now,.05);
    this.out.gain.setTargetAtTime(level*this.level*moving*(.009+.027*Math.sqrt(Math.abs(load))),now,.07);
  }
  stop(){
    if(this.stopped)return;this.stopped=true;const t=this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0,t,.03);this.rotor.stop(t+.2);this.mesh?.stop(t+.2);
    this.rotor.onended=()=>{for(const n of [this.rotor,this.mesh,this.meshGain,this.out])n?.disconnect();};
  }
}

