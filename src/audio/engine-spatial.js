import { engineProfile, TRAFFIC_PROFILES } from './engine-profiles.js';
import { buildEngineBank, EngineVoice } from './engine-synth.js';
import { loadRecordedEngine, RecordedEngineVoice } from '../engine-recordings.js';
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : 0));
/** Radial relative velocity in m/s, positive closing. Guard network teleports. */
export function dopplerFactor(closing) { return clamp(343 / (343 - clamp(closing, -100, 100)), .72, 1.4); }
/** Mutates caller-owned state. No frame-time temporary object or closure. */
export function spatialEngine(state, source, now, reference = 16) {
  const distance = clamp(source.d ?? source.dist, 0, 100000);
  const dt = state.spatialTime == null ? 1 / 60 : clamp(now - state.spatialTime, 0, .1);
  state.doppler = (state.doppler ?? 1) + clamp(dopplerFactor(source.vr) - (state.doppler ?? 1), -1.8 * dt, 1.8 * dt);
  state.spatialTime = now;
  state.gain = 1 / (1 + (distance / reference) ** 1.6);
  state.cutoff = 600 + 15000 * Math.exp(-distance / 85);
  state.panValue = clamp(source.pan, -.95, .95);
  return state;
}
/** Fixed insertion list: six full voices + two one-layer distant voices.
 * Pool kind participates in identity (traffic and rivals can share numeric IDs).
 */
export class NearestEngines {
  constructor(detail = 6, far = 2) {
    this.detail = detail; this.capacity = detail + far;
    this.sources = new Array(this.capacity).fill(null);
    this.kinds = new Uint8Array(this.capacity); this.distances = new Float64Array(this.capacity);
    this.count = 0;
  }
  select(rivals, traffic) {
    this.sources.fill(null); this.distances.fill(Infinity); this.count = 0;
    this.add(rivals, 0); this.add(traffic, 1); return this;
  }
  add(list, kind) {
    if (!list) return;
    for (let n = 0; n < list.length; n++) {
      const s = list[n], d = s.d ?? s.dist;
      if (!Number.isFinite(d) || d < 0 || d >= 260) continue;
      let i = 0;
      while (i < this.capacity && (this.distances[i] < d ||
        (this.distances[i] === d && (this.kinds[i] < kind ||
          (this.kinds[i] === kind && this.sources[i]?.id <= s.id))))) i++;
      if (i === this.capacity) continue;
      for (let j = this.capacity - 1; j > i; j--) {
        this.sources[j] = this.sources[j - 1]; this.kinds[j] = this.kinds[j - 1]; this.distances[j] = this.distances[j - 1];
      }
      this.sources[i] = s; this.kinds[i] = kind; this.distances[i] = d;
      this.count = Math.min(this.capacity, this.count + 1);
    }
  }
}
/** One loop + low-pass for distant LOD; no waveshaper or eight silent layers. */
export class DistantEngineVoice {
  constructor(ctx, bank, dest, spec) {
    this.ctx = ctx; this.spec = spec;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.source = ctx.createBufferSource(); this.source.loop = true;
    this.source.buffer = bank.recorded ? bank.loops[1].buffer : bank.on[1].buf;
    this.ref = bank.recorded ? bank.loops[1].rpm : bank.pts[1];
    this.source.connect(this.out); this.out.connect(dest); this.source.start(ctx.currentTime);
  }
  set(rpm, load, level, now, dop = 1) {
    if (this.stopped) return;
    this.source.playbackRate.setTargetAtTime(clamp(rpm / this.ref * dop, .25, 4), now, .08);
    this.out.gain.setTargetAtTime(level * .17 * (.6 + .4 * Math.max(0, load)), now, .08);
  }
  stop() {
    if (this.stopped) return; this.stopped = true;
    const now = this.ctx.currentTime; this.out.gain.setTargetAtTime(0, now, .045);
    this.source.stop(now + .3); this.source.onended = () => { this.source.disconnect(); this.out.disconnect(); };
  }
}
export class ExternalEngines {
  constructor(ctx, dest, passBy) {
    this.ctx = ctx; this.selection = new NearestEngines(); this.banks = new Map(); this.recorded = new Map(); this.pending = new Set();
    this.passBy = passBy; this.slots = [];
    for (let i = 0; i < 8; i++) {
      const air = ctx.createBiquadFilter(), panner = ctx.createStereoPanner(), gate = ctx.createGain();
      air.type = 'lowpass'; air.Q.value = .5; gate.gain.value = 0;
      air.connect(gate); gate.connect(panner); panner.connect(dest);
      this.slots.push({air, panner, gate, voice: null, source: null, id: null, kind: -1, nextSwap: 0, nextPass: 0});
    }
  }
  update(rivals, traffic, now) {
    const chosen = this.selection.select(rivals, traffic);
    // Keep existing owners even when distance ordering changes.
    for (let i = 0; i < 8; i++) {
      const slot = this.slots[i]; slot.source = null;
      for (let j = 0; j < chosen.count; j++) {
        if (slot.id === chosen.sources[j].id && slot.kind === chosen.kinds[j]) {
          slot.source = chosen.sources[j]; slot.wantDetail = j < 6; break;
        }
      }
      if (!slot.source) slot.gate.gain.setTargetAtTime(0, now, .06);
    }
    for (let j = 0; j < chosen.count; j++) {
      const source = chosen.sources[j], kind = chosen.kinds[j]; let slot = null, owned = false;
      for (let i = 0; i < 8; i++) {
        const v = this.slots[i];
        if (v.source === source && v.kind === kind) { owned = true; break; }
        if (!v.source && now >= v.nextSwap) slot = v;
      }
      if (owned || !slot) continue;
      // New owner waits for the outgoing signal to fade before its gate opens.
      slot.voice?.stop(); slot.voice = null; slot.source = source; slot.id = source.id; slot.kind = kind;
      slot.nextSwap = now + .4; slot.spatialTime = null; slot.doppler = 1; slot.lastVr = 0; slot.approachPeak = 0;
      slot.wantDetail = j < 6; slot.spec = null;
    }
    for (let i = 0; i < 8; i++) {
      const slot = this.slots[i], source = slot.source;
      if (!source) {
        if (slot.voice && now >= slot.nextSwap) { slot.voice.stop(); slot.voice = null; slot.id = null; slot.kind = -1; slot.nextSwap = now + .4; }
        continue;
      }
      const spec = source.spec || TRAFFIC_PROFILES[source.electric ? 'electric' : source.kind] || TRAFFIC_PROFILES.car;
      const profile = engineProfile(spec), detail = slot.wantDetail;
      let bank = this.recorded.get(profile);
      if (!bank) {
        bank = this.banks.get(profile);
        if (!bank) { bank = buildEngineBank(this.ctx, profile.synth, spec.idle || 800, spec.redline || 6500); this.banks.set(profile, bank); }
        if (profile.sample && !this.pending.has(profile)) {
          this.pending.add(profile);
          loadRecordedEngine(this.ctx, spec).then(b => { if (b) this.recorded.set(profile, b); }).catch(() => {});
        }
      }
      if (!slot.voice || (now >= slot.nextSwap && (slot.spec !== spec || slot.detail !== detail || slot.bank !== bank))) {
        slot.voice?.stop(); slot.detail = detail; slot.spec = spec; slot.bank = bank; slot.nextSwap = now + .4;
        slot.voice = detail ? bank.recorded ? new RecordedEngineVoice(this.ctx, bank, slot.air, spec, .65 * profile.gain)
          : new EngineVoice(this.ctx, bank, slot.air, .65 * profile.gain) : new DistantEngineVoice(this.ctx, bank, slot.air, spec);
      }
      spatialEngine(slot, source, now, spec.kind === 'bus' ? 20 : 14);
      const speed = Math.max(0, source.v || 0), diesel = profile.diesel;
      const rpm = source.rpm || (spec.idle + Math.min(1, speed / 7) * (diesel ? 1000 : 1800) + speed % (diesel ? 7 : 11) * 65);
      const load = source.load ?? clamp(.3 + (source.acc || 0) * .4, 0, 1);
      slot.voice.set(rpm, load, 1, now, slot.doppler, !!source.limiter);
      slot.gate.gain.setTargetAtTime(slot.gain * (detail ? .65 : .22), now, .08);
      slot.air.frequency.setTargetAtTime(slot.cutoff * (detail ? 1 : .55), now, .08);
      slot.panner.pan.setTargetAtTime(slot.panValue, now, .05);
      const vr = source.vr || 0;
      slot.approachPeak = Math.max(slot.approachPeak || 0, vr);
      if (slot.lastVr > 0 && vr <= 0 && slot.approachPeak > 8 && (source.d ?? source.dist) < 15 && now >= slot.nextPass) {
        this.passBy?.(Math.min(1, slot.approachPeak / 40), slot.panValue); slot.nextPass = now + 2;
      }
      if (vr <= 0) slot.approachPeak = 0;
      slot.lastVr = vr;
    }
  }
}
