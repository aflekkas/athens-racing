// Offline Greek barks only: no network synthesis, captions, or dialogue UI.
import { spatialAudio } from './world-sounds.js';
import { VOICE_LINES, VOICE_PROFILES } from './voice-lines.js';

export function chooseVoiceLine(lines, { category, cue, mildLanguage = false, last, random = Math.random }) {
  const pool = lines.filter(l => l.category === category && (!cue || l.cue === cue) && (!mildLanguage || !l.strong));
  const explicit = pool.filter(l => l.strong), clean = pool.filter(l => !l.strong);
  const group = explicit.length && clean.length ? (random() < .75 ? explicit : clean) : pool;
  const fresh = group.filter(l => l.id !== last), choices = fresh.length ? fresh : group;
  return choices.length ? choices[Math.floor(random() * choices.length)] : null;
}

export function voiceAcoustics(distance, cockpit = false, enclosed = false) {
  const d = Math.max(0, distance);
  const fade = Math.max(0, Math.min(1, (50 - d) / 20));
  return { gain: .75 / (1 + (d / 9) ** 1.6) * fade * fade * (cockpit ? .55 : 1) * (enclosed ? .62 : 1),
    cutoff: Math.min(12000 * Math.exp(-d / 42) + 700, cockpit ? 2200 : 16000, enclosed ? 2600 : 16000) };
}

export class VoiceReactions {
  constructor(audio, { settings = {}, random = Math.random, load } = {}) {
    this.audio = audio; this.settings = settings; this.random = random;
    this.load = load || (async url => { const r = await fetch(url); if (!r.ok) throw new Error(`Voice ${r.status}`); return this.audio.ctx.decodeAudioData(await r.arrayBuffer()); });
    this.cache = new Map(); this.speakers = new WeakMap(); this.last = new Map();
    this.next = 0; this.token = 0; this.active = null; this.pending = false; this.enabled = false;
  }
  update({ enabled, cockpit = false, relative }) {
    this.enabled = enabled; this.cockpit = cockpit; this.relative = relative;
    if (!enabled || this.settings.voice === 0 || (this.active?.line.strong && this.settings.mildLanguage)) this.stop();
    if (this.active) this.position(this.active);
  }
  async buffer(id, profile) {
    const key = `${id}-${profile}`;
    if (!this.cache.has(key)) {
      const request = this.load(new URL(`../assets/audio/voice/${key}.ogg`, import.meta.url).href).catch(e => { this.cache.delete(key); throw e; });
      this.cache.set(key, request);
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(key);
  }
  async trigger(category, speaker, locate, { enclosed = false, gender, older, cue, priority = false, cooldown = true } = {}) {
    const ctx = this.audio.ctx;
    if (priority && this.enabled) { this.stop(); this.next = 0; }
    if (!ctx || !this.audio.mix?.buses.voice || !this.enabled || this.settings.voice === 0 || this.active || this.pending || ctx.currentTime < this.next || !speaker || !locate) return false;
    let state = this.speakers.get(speaker);
    if (!state) {
      const choices = VOICE_PROFILES.filter(p => (!gender || p.id.startsWith(gender + '-')) && (older == null || p.id.endsWith(older ? '-older' : '-young')));
      state = { next: 0, profile: choices[Math.floor(this.random() * choices.length)].id };
      this.speakers.set(speaker, state);
    }
    if (cooldown && !priority && ctx.currentTime < state.next) return false;
    const pos = locate(), rel = pos && this.relative?.(pos);
    if (!rel || Math.hypot(rel.x, rel.y, rel.z) >= 50) return false;
    const line = chooseVoiceLine(VOICE_LINES, { category, cue, mildLanguage: this.settings.mildLanguage, last: this.last.get(category), random: this.random });
    if (!line) return false;
    const token = ++this.token;
    this.pending = true;
    try {
      const buffer = await this.buffer(line.id, state.profile);
      if (token !== this.token || !this.enabled || (this.settings.mildLanguage && line.strong) || this.settings.voice === 0) return false;
      const src = ctx.createBufferSource(), gain = ctx.createGain(), air = ctx.createBiquadFilter(), pan = ctx.createPanner();
      src.buffer = buffer; air.type = 'lowpass'; air.Q.value = .5;
      // Coordinates are camera-local. Existing listener stays at the origin; distance is applied once below.
      pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.rolloffFactor = 0;
      src.connect(air); air.connect(gain); gain.connect(pan); pan.connect(this.audio.mix.buses.voice);
      const active = { src, gain, air, pan, line, locate, enclosed, spatial: {}, rate: .98 + this.random() * .04 };
      this.active = active;
      if (!this.position(active, true)) { this.stop(); return false; }
      this.last.set(category, line.id); state.next = ctx.currentTime + 12 + this.random() * 6;
      this.next = ctx.currentTime + buffer.duration / .95 + 2.5;
      src.onended = () => { for (const n of [src, gain, air, pan]) n.disconnect(); if (this.active === active) this.active = null; };
      src.start(); return true;
    } catch { return false; } // Missing/blocked audio must not break simulation or repeatedly flood the console.
    finally { if (token === this.token) this.pending = false; }
  }
  position(a, immediate = false) {
    const p = a.locate(), r = p && this.relative?.(p);
    if (!r || ![r.x, r.y, r.z].every(Number.isFinite)) { this.stop(); return false; }
    const now = this.audio.ctx.currentTime, d = Math.hypot(r.x, r.y, r.z);
    const dt = now - (a.time ?? now), vr = dt > .005 && dt < .2 && Math.abs(d - (a.distance ?? d)) < 15 ? (a.distance - d) / dt : 0;
    const s = spatialAudio(a.spatial, { d, vr }, now, 9), mix = voiceAcoustics(d, this.cockpit, a.enclosed);
    const set = (param, value) => immediate ? param.setValueAtTime(value, now) : param.setTargetAtTime(value, now, .035);
    set(a.gain.gain, mix.gain); set(a.air.frequency, mix.cutoff); set(a.src.playbackRate, a.rate * s.doppler);
    for (const axis of ['X', 'Y', 'Z']) set(a.pan['position' + axis], r[axis.toLowerCase()]);
    a.time = now; a.distance = d;
    return true;
  }
  stop() {
    ++this.token; this.pending = false;
    const a = this.active; this.active = null;
    if (a) { try { a.src.stop(); } catch {} for (const n of [a.src, a.gain, a.air, a.pan]) n.disconnect(); }
  }
  reset() { this.stop(); this.speakers = new WeakMap(); this.next = 0; this.last.clear(); }
}
