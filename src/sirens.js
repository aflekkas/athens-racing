import { spatialAudio } from './world-sounds.js';

// Police sirens on top of Audio (audio.js). Electronic sirens are oscillators through a horn speaker, so they are
// synthesized: a centre frequency plus an LFO sweep (wail far off, yelp up close, hi-lo two-tone on some units)
// drive a square + saw pair through a driver-distortion and horn band. Doppler scales the whole frequency signal.
// Two voices follow the nearest units with their siren on, audible out to ~400 m; a "whoop" marks a siren starting.
const MODES = {
  wail: { type: 'triangle', rate: 0.19, center: 950, depth: 430 },
  yelp: { type: 'sawtooth', rate: 3.3, center: 980, depth: 420 },
  hilo: { type: 'square', rate: 0.75, center: 560, depth: 95 },
};

export class Sirens {
  constructor(audio) { this.A = audio; this.voices = null; this.seen = new Map(); }

  build() {
    const A = this.A, ctx = A.ctx, { gain, filt, osc } = A.mk;
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * 2.5) / Math.tanh(2.5); }
    this.voices = [0, 1].map(() => {
      const v = { id: -1, mode: null };
      v.center = ctx.createConstantSource(); v.center.offset.value = MODES.wail.center; v.center.start();
      v.lfo = osc('triangle', MODES.wail.rate); v.lfoG = gain(MODES.wail.depth);
      v.dop = gain(1); v.center.connect(v.dop); v.lfo.connect(v.lfoG); v.lfoG.connect(v.dop);
      v.o1 = osc('square', 0); v.o2 = osc('sawtooth', 0); v.o2.detune.value = 7;
      v.dop.connect(v.o1.frequency); v.dop.connect(v.o2.frequency);
      v.g1 = gain(0.5); v.g2 = gain(0.35); v.drive = ctx.createWaveShaper(); v.drive.curve = curve;
      v.horn = filt('bandpass', 1150, 0.6); v.bite = filt('peaking', 2400, 1); v.bite.gain.value = -2;
      v.air = filt('lowpass', 9000, 0.5); v.out = gain(0); v.pan = ctx.createStereoPanner();
      v.o1.connect(v.g1); v.o2.connect(v.g2); v.g1.connect(v.drive); v.g2.connect(v.drive);
      A.mk.chain(v.drive, v.horn, v.bite, v.air, v.out, v.pan, A.trafficBus);
      return v;
    });
  }

  setMode(v, name, now) {
    if (v.mode === name) return;
    const M = MODES[name]; v.mode = name;
    v.lfo.type = M.type; v.lfo.frequency.setTargetAtTime(M.rate, now, 0.05);
    v.center.offset.setTargetAtTime(M.center, now, 0.08); v.lfoG.gain.setTargetAtTime(M.depth, now, 0.08);
  }

  /** list: the traffic entries passed to Audio.update; uses those with cop && siren */
  update(list, now, mute) {
    const A = this.A;
    const on = list.filter((o) => o.cop && o.siren && o.d < 450).sort((a, b) => a.d - b.d).slice(0, 2);
    if (!on.length && !this.voices) return;
    if (!this.voices) this.build();
    for (const o of on) {
      // a whoop when a unit lights up (or comes back after a while)
      if (now - (this.seen.get(o.id) ?? -1e9) > 5) this.whoop(o, now);
      this.seen.set(o.id, now);
    }
    const ids = new Set(on.map((o) => o.id));
    for (const v of this.voices) if (v.id >= 0 && !ids.has(v.id)) { v.id = -1; v.out.gain.setTargetAtTime(0, now, 0.15); }
    for (const o of on) {
      let v = this.voices.find((q) => q.id === o.id);
      if (!v) { v = this.voices.find((q) => q.id < 0); if (!v) continue; v.id = o.id; v.mode = null; v.spatialTime = null; v.doppler = 1; }
      this.setMode(v, o.d < 40 ? 'yelp' : o.id % 3 === 2 ? 'hilo' : 'wail', now);
      const spatial = spatialAudio(v, o, now, 30), dop = spatial.doppler;
      v.dop.gain.setTargetAtTime(dop, now, 0.05);
      v.lfo.frequency.setTargetAtTime(MODES[v.mode].rate * dop, now, 0.05);
      const att = 1 / (1 + Math.pow(o.d / 30, 1.25));
      v.out.gain.setTargetAtTime(0.23 * att * mute, now, 0.08);
      v.air.frequency.setTargetAtTime(spatial.cutoff, now, 0.1);
      v.pan.pan.setTargetAtTime(Math.max(-0.95, Math.min(0.95, o.pan)), now, 0.05);
    }
    if (this.seen.size > 32) for (const [id, t] of this.seen) if (now - t > 30) this.seen.delete(id);
  }

  whoop(o, now) {
    const att = 1 / (1 + Math.pow(o.d / 30, 1.25));
    if (att < 0.03) return;
    const spatial = spatialAudio({}, o, now, 30), lp = spatial.cutoff;
    for (const [type, g] of [['square', 0.035], ['sawtooth', 0.025]]) this.A.tone({ f: 420 * spatial.doppler, slide: 1500 * spatial.doppler, dur: 0.42, gain: g * att, type, attack: 0.02, lp, pan: o.pan, bus: this.A.trafficBus });
  }
}
