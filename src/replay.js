// Camera-independent recording, versioned interchange and best-ghost storage. No DOM/three dependency.
// v1 little-endian, frame-major: 44 bytes/car at 20 Hz (317 KB per six-minute solo run).
export const REPLAY_HZ = 20, REPLAY_STRIDE = 44, REPLAY_VERSION = 1;
export const MAX_REPLAY_BYTES = 6 * 1024 * 1024;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Keep overlapping cars out of the cockpit/chase sightline; reach full translucency at 10 metres.
export function ghostOpacity(distance) {
  const t = clamp((distance - 2) / 8, 0, 1);
  return .28 * t * t * (3 - 2 * t);
}
const zones = ['front', 'rear', 'left', 'right'];
const norm = q => { const l = Math.hypot(...q) || 1; return q.map(v => v / l); };
export function slerp(a, b, t) {
  let d = a.reduce((v, x, i) => v + x * b[i], 0);
  if (d < 0) { b = b.map(v => -v); d = -d; }
  if (d > .9995) return norm(a.map((v, i) => v + (b[i] - v) * t));
  const angle = Math.acos(clamp(d, -1, 1)), s = Math.sin(angle);
  return a.map((v, i) => (v * Math.sin((1 - t) * angle) + b[i] * Math.sin(t * angle)) / s);
}
export function interpolate(a, b, t) {
  const lerp = (x, y) => x + (y - x) * t;
  return { position: a.position.map((x, i) => lerp(x, b.position[i])), quaternion: slerp(a.quaternion, b.quaternion, t),
    speed: lerp(a.speed, b.speed), steer: lerp(a.steer, b.steer), spin: lerp(a.spin, b.spin), s: lerp(a.s, b.s),
    pitch: lerp(a.pitch, b.pitch), roll: lerp(a.roll, b.roll), heave: lerp(a.heave, b.heave),
    brake: (t < .5 ? a : b).brake, damage: Object.fromEntries(zones.map(z => [z, lerp(a.damage[z], b.damage[z])])) };
}
function snapshot(s) {
  return { position: [...s.position], quaternion: norm(s.quaternion), speed: s.speed || 0, steer: s.steer || 0,
    spin: s.spin || 0, s: s.s || 0, pitch: s.pitch || 0, roll: s.roll || 0, heave: s.heave || 0,
    brake: !!s.brake, damage: Object.fromEntries(zones.map(z => [z, s.damage?.[z] || 0])) };
}
function write(v, o, s) {
  s.position.forEach((x, i) => v.setInt32(o + i * 4, Math.round(x * 100), true));
  norm(s.quaternion).forEach((x, i) => v.setInt16(o + 12 + i * 2, Math.round(x * 32767), true));
  v.setInt16(o + 20, Math.round(clamp(s.speed * 100, -32767, 32767)), true);
  v.setInt16(o + 22, Math.round(clamp(s.steer * 10000, -32767, 32767)), true);
  v.setInt32(o + 24, Math.round(s.spin * 1000), true); // unwrapped: no high-speed wheel aliasing
  v.setUint8(o + 28, s.brake ? 1 : 0);
  zones.forEach((z, i) => v.setUint8(o + 29 + i, Math.round(clamp(s.damage[z], 0, 1) * 255)));
  [s.pitch, s.roll, s.heave].forEach((x, i) => v.setInt16(o + 34 + i * 2, Math.round(clamp(x * 10000, -32767, 32767)), true));
  v.setInt32(o + 40, Math.round(s.s * 100), true);
}
function read(v, o) {
  return { position: [0, 1, 2].map(i => v.getInt32(o + i * 4, true) / 100),
    quaternion: norm([0, 1, 2, 3].map(i => v.getInt16(o + 12 + i * 2, true) / 32767)),
    speed: v.getInt16(o + 20, true) / 100, steer: v.getInt16(o + 22, true) / 10000,
    spin: v.getInt32(o + 24, true) / 1000, brake: !!v.getUint8(o + 28),
    damage: Object.fromEntries(zones.map((z, i) => [z, v.getUint8(o + 29 + i) / 255])),
    pitch: v.getInt16(o + 34, true) / 10000, roll: v.getInt16(o + 36, true) / 10000,
    heave: v.getInt16(o + 38, true) / 10000, s: v.getInt32(o + 40, true) / 100 };
}
export class Recorder {
  constructor(tracks, metadata = {}, { hz = REPLAY_HZ, maxSeconds = 720 } = {}) {
    if (!tracks.length || tracks.length > 9) throw new Error('Expected one to nine recorded cars');
    this.tracks = tracks.map(t => ({ ...t })); this.metadata = { ...metadata }; this.hz = hz;
    this.maxFrames = Math.min(Math.floor(maxSeconds * hz) + 1, Math.floor(MAX_REPLAY_BYTES / (tracks.length * REPLAY_STRIDE)));
    this.capacity = Math.min(1024, this.maxFrames); this.data = new Uint8Array(this.capacity * tracks.length * REPLAY_STRIDE);
    this.view = new DataView(this.data.buffer); this.frames = 0; this.elapsed = 0; this.previous = null; this.truncated = false;
  }
  append(states) {
    if (this.frames >= this.maxFrames) { this.truncated = true; return; }
    if (this.frames === this.capacity) {
      this.capacity = Math.min(this.maxFrames, this.capacity * 2);
      const data = new Uint8Array(this.capacity * this.tracks.length * REPLAY_STRIDE); data.set(this.data);
      this.data = data; this.view = new DataView(data.buffer);
    }
    states.forEach((s, i) => write(this.view, (this.frames * this.tracks.length + i) * REPLAY_STRIDE, s)); this.frames++;
  }
  // Called from the bounded physics step, never requestAnimationFrame or the visual wheel update.
  tick(dt, states) {
    if (!Number.isFinite(dt) || dt < 0 || states.length !== this.tracks.length) throw new Error('Invalid recorder step');
    const current = states.map(snapshot);
    if (!this.previous) { this.previous = current; this.append(current); }
    const end = this.elapsed + dt;
    while (!this.truncated && this.frames / this.hz <= end + 1e-9) {
      const t = dt ? clamp((this.frames / this.hz - this.elapsed) / dt, 0, 1) : 0;
      this.append(this.previous.map((s, i) => interpolate(s, current[i], t)));
    }
    this.previous = current; this.elapsed = end;
  }
  finish(metadata = {}) {
    return { format: 'paraliaki-replay', version: REPLAY_VERSION, hz: this.hz, stride: REPLAY_STRIDE,
      tracks: this.tracks, frames: this.frames, duration: Math.max(0, (this.frames - 1) / this.hz),
      ...this.metadata, ...metadata, truncated: this.truncated, data: this.data.slice(0, this.frames * this.tracks.length * REPLAY_STRIDE) };
  }
}
export function sampleReplay(replay, time, track = 0) {
  if (track < 0 || track >= replay.tracks.length || !replay.frames) return null;
  const at = clamp(time * replay.hz, 0, replay.frames - 1), i = Math.floor(at), j = Math.min(i + 1, replay.frames - 1);
  const v = new DataView(replay.data.buffer, replay.data.byteOffset, replay.data.byteLength), n = replay.tracks.length;
  return interpolate(read(v, (i * n + track) * REPLAY_STRIDE), read(v, (j * n + track) * REPLAY_STRIDE), at - i);
}
function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s);
}
export function encodeReplay(replay) { return JSON.stringify({ ...replay, data: base64(replay.data) }); }
export function decodeReplay(text) {
  if (typeof text !== 'string' || text.length > MAX_REPLAY_BYTES * 1.4 + 65536) throw new Error('Ghost file is too large');
  const r = JSON.parse(text);
  if (r.format !== 'paraliaki-replay' || r.version !== REPLAY_VERSION || r.stride !== REPLAY_STRIDE || r.hz !== REPLAY_HZ ||
    !Array.isArray(r.tracks) || !r.tracks.length || r.tracks.length > 9 || !Number.isInteger(r.frames) || r.frames < 1 ||
    typeof r.eventId !== 'string' || typeof r.car !== 'string' || typeof r.routeKey !== 'string' ||
    !Number.isFinite(r.duration) || Math.abs(r.duration - (r.frames - 1) / r.hz) > .001 ||
    !Number.isFinite(r.time) || r.time < 0 || r.time > 86400 || !Array.isArray(r.splits) || r.splits.length > 100 ||
    r.splits.some(t => !Number.isFinite(t) || t < 0) || typeof r.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data) ||
    r.frames * r.tracks.length * REPLAY_STRIDE > MAX_REPLAY_BYTES) throw new Error('Invalid or unsupported ghost file');
  r.data = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(r.data, 'base64')) : Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
  if (r.data.length !== r.frames * r.tracks.length * REPLAY_STRIDE) throw new Error('Ghost data length mismatch');
  // Render/storage metadata is allow-listed; imported files never contribute arbitrary result fields.
  return { format: r.format, version: r.version, stride: r.stride, hz: r.hz, frames: r.frames, duration: r.duration,
    eventId: r.eventId.slice(0, 100), car: r.car.slice(0, 100), routeKey: r.routeKey.slice(0, 100), time: r.time,
    splits: r.splits, tracks: r.tracks.map(t => ({ car: String(t.car || '').slice(0, 100), name: String(t.name || '').slice(0, 100) })),
    trackVersion: String(r.trackVersion || '').slice(0, 100), data: r.data, truncated: !!r.truncated };
}
export const ghostKey = (eventId, car) => `${eventId}:${car}`;
export class GhostStore {
  constructor({ indexedDB = globalThis.indexedDB, storage, fallbackLimit = 1500000 } = {}) {
    this.idb = indexedDB; this.fallbackLimit = fallbackLimit; this.cache = new Map();
    try { this.storage = storage ?? globalThis.localStorage; } catch {}
  }
  async database() {
    if (!this.idb) return null;
    if (!this.db) this.db = new Promise(resolve => {
      const req = this.idb.open('paraliaki-ghosts', 1); const timer = setTimeout(() => resolve(null), 1500);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('ghosts')) req.result.createObjectStore('ghosts'); };
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
      req.onerror = req.onblocked = () => { clearTimeout(timer); resolve(null); };
    });
    return this.db;
  }
  async operation(mode, fn) {
    const db = await this.database(); if (!db) throw new Error('IndexedDB unavailable');
    return new Promise((resolve, reject) => {
      const tx = db.transaction('ghosts', mode), req = fn(tx.objectStore('ghosts')); let result;
      req.onsuccess = () => { result = req.result; }; tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Ghost transaction failed'));
    });
  }
  async load(eventId, car) {
    const key = ghostKey(eventId, car); let r = this.cache.get(key);
    if (r) return r;
    try { r = await this.operation('readonly', s => s.get(key)); } catch {}
    if (!r) { try { const raw = this.storage?.getItem('paraliaki.ghost.' + key); if (raw) r = decodeReplay(raw); } catch {} }
    if (r) this.cache.set(key, r); return r || null;
  }
  async saveBest(replay) {
    const key = ghostKey(replay.eventId, replay.car), old = await this.load(replay.eventId, replay.car);
    if (old && old.time <= replay.time && old.routeKey === replay.routeKey && old.trackVersion === replay.trackVersion) return { saved: false, best: old, persistent: true };
    let persistent = false;
    try { await this.operation('readwrite', s => s.put(replay, key)); persistent = true; } catch {
      const raw = encodeReplay(replay);
      if (raw.length <= this.fallbackLimit) try { this.storage?.setItem('paraliaki.ghost.' + key, raw); persistent = !!this.storage; } catch {}
    }
    this.cache.set(key, replay); return { saved: true, best: replay, persistent };
  }
  async all() {
    try { for (const r of await this.operation('readonly', s => s.getAll())) this.cache.set(ghostKey(r.eventId, r.car), r); } catch {}
    try { for (let i = 0; i < (this.storage?.length || 0); i++) { const key = this.storage.key(i); if (key?.startsWith('paraliaki.ghost.')) { try { const r = decodeReplay(this.storage.getItem(key)); if (!this.cache.has(ghostKey(r.eventId, r.car))) this.cache.set(ghostKey(r.eventId, r.car), r); } catch {} } } } catch {}
    return [...this.cache.values()];
  }
}
