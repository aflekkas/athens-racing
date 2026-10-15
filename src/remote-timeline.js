// Rendering only: never use delayed/predicted poses for ranking or finish validation.
const fields = ['x', 'y', 'z', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm'];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const speed = p => Math.hypot(p.vLong, p.vLat);
const velocity = p => ({ x: -Math.sin(p.yaw) * p.vLong + Math.cos(p.yaw) * p.vLat, z: -Math.cos(p.yaw) * p.vLong - Math.sin(p.yaw) * p.vLat });
const valid = p => p && [...fields, 'yaw'].every(k => Number.isFinite(p[k]));
const samePose = (a, b) => [...fields, 'yaw', 'gear', 'reverse'].every(k => a[k] === b[k]);

export class RemoteTimeline {
  constructor() { this.samples = []; this.delay = 40; this.jitter = 0; this.cadence = 200; this.offset = null; this.playhead = null; this.renderAt = null; this.mode = 'empty'; this.resetCount = 0; }
  push(state, { receivedAt, serverNow, stateAt, car, stopped = false, networkDelay = 0 } = {}) {
    if (!valid(state)) return false;
    const previous = this.samples.at(-1);
    // The receipt stamp is per player: another driver's packet must not rejuvenate a held pose.
    const receipt = Number.isFinite(stateAt) ? stateAt : null;
    const source = Number.isFinite(state.sampleTime) ? state.sampleTime : receipt ?? serverNow ?? receivedAt;
    const age = receipt !== null && Number.isFinite(serverNow) ? clamp(serverNow - receipt + (state.sampleAge || 0), 0, 10000) : 0;
    const local = receivedAt - age - (Number.isFinite(networkDelay) ? clamp(networkDelay, 0, 150) : 0);
    const restart = previous && receipt !== null && receipt > previous.receipt && source < previous.time - 500;
    if (previous && !restart && (source <= previous.time || (receipt === null && !Number.isFinite(state.sampleTime) && samePose(state, previous.state)))) return false;
    const gap = previous ? (source - previous.time) / 1000 : 0;
    const distance = previous ? Math.hypot(state.x - previous.state.x, state.z - previous.state.z) : 0;
    // Receiver stalls queue otherwise continuous snapshots. Only a gap on the
    // player's sample clock signals a stalled stream; receipt gaps cannot reset
    // the clock to the oldest packet in a queued burst.
    const discontinuity = previous && (restart || car !== previous.car || state.motionEpoch !== previous.state.motionEpoch || gap > 1.5 || distance > 3 + Math.max(speed(state), speed(previous.state)) * Math.max(0, gap) * 1.6);
    if (discontinuity) { this.samples = []; this.playhead = this.renderAt = null; this.offset = null; this.delay = 40; this.jitter = 0; this.cadence = 200; this.resetCount++; }
    const last = this.samples.at(-1);
    const candidate = local - source;
    if (this.offset === null) this.offset = candidate;
    // A queued burst reveals the correct clock in its freshest packet. Adopt
    // lower-delay observations immediately; delayed packets cannot drag it
    // forward. Playback stays monotonic even when this estimate improves.
    else this.offset = Math.min(candidate, this.offset + .2);
    if (last) {
      const interval = source - last.time;
      if (interval <= 600) this.cadence += (interval - this.cadence) * .1;
      const variation = Math.abs((local - last.local) - interval);
      this.jitter += (variation - this.jitter) * .1;
      this.delay = clamp(20 + 1.5 * this.jitter, 20, 100);
    }
    this.samples.push({ state: { ...state }, time: source, local, receivedAt, receipt, car, stopped });
    if (this.samples.length > 16) this.samples.shift();
    return true;
  }
  sample(now, stopped = false) {
    return this.poseAt(now, stopped);
  }
  poseAt(now, stopped = false) {
    if (!this.samples.length) return null;
    const target = now - this.offset - this.delay;
    const latest = this.samples.at(-1), previous = this.samples.at(-2);
    const moving = previous && Math.hypot(latest.state.x - previous.state.x, latest.state.z - previous.state.z) > .01 && speed(latest.state) > .1 && !stopped && !latest.stopped;
    // Keep time at the last bounded prediction while frozen. On packet recovery
    // playback continues from there, rather than chasing a distant pose at 1.5x
    // speed. Growing jitter delay may slow the clock by 10%; it never speeds up.
    if (this.playhead === null) this.playhead = target;
    else { const dt = Math.max(0, now - this.renderAt); this.playhead += dt * clamp(1 + (target - this.playhead - dt) / 1000, .9, 1); }
    this.playhead = Math.min(this.playhead, latest.time + (moving ? 350 : 0));
    this.renderAt = now;
    const time = this.playhead;
    while (this.samples.length > 2 && this.samples[1].time <= time) this.samples.shift();
    if (this.samples.length === 1 || !moving && time >= latest.time) { this.mode = 'stopped'; return { ...latest.state, vLong: 0, vLat: 0 }; }
    if (time <= this.samples[0].time) { this.mode = 'buffering'; return { ...this.samples[0].state }; }
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1], b = this.samples[i];
      if (time > b.time) continue;
      this.mode = 'interpolate';
      const span = b.time - a.time, t = clamp((time - a.time) / span, 0, 1), p = { ...a.state };
      for (const key of fields) p[key] = a.state[key] + (b.state[key] - a.state[key]) * t;
      for (const key of ['bodyHeave', 'bodyPitch', 'bodyRoll']) if (Number.isFinite(a.state[key]) && Number.isFinite(b.state[key])) p[key] = a.state[key] + (b.state[key] - a.state[key]) * t;
      p.yaw = a.state.yaw + angle(b.state.yaw - a.state.yaw) * t;
      // Hermite positions retain acceleration/turning between collapsed 5 Hz batches.
      // Limit tangents to the segment's displacement so noisy speeds cannot overshoot.
      const va = velocity(a.state), vb = velocity(b.state), seconds = span / 1000;
      for (const key of ['x', 'z']) {
        const d = b.state[key] - a.state[key], limit = 3 * Math.abs(d);
        const ma = d === 0 ? 0 : clamp(va[key] * seconds * Math.sign(d), 0, limit) * Math.sign(d);
        const mb = d === 0 ? 0 : clamp(vb[key] * seconds * Math.sign(d), 0, limit) * Math.sign(d);
        p[key] = (2*t*t*t - 3*t*t + 1)*a.state[key] + (t*t*t - 2*t*t + t)*ma + (-2*t*t*t + 3*t*t)*b.state[key] + (t*t*t - t*t)*mb;
      }
      return p;
    }
    const p = { ...latest.state };
    if (!moving) { this.mode = 'stopped'; p.vLong = p.vLat = 0; return p; }
    // One missed packet can coast briefly. After 350ms the pose AND wheel speed freeze.
    const late = Math.max(0, time - latest.time), dt = Math.min(late, 350) / 1000;
    this.mode = late >= 350 ? 'freeze' : 'extrapolate';
    const vel = velocity(p), span = (latest.time - previous.time) / 1000;
    const yawRate = clamp(angle(p.yaw - previous.state.yaw) / span, -3, 3);
    const half = yawRate * dt / 2;
    p.x += (vel.x * Math.cos(half) + vel.z * Math.sin(half)) * dt;
    p.z += (vel.z * Math.cos(half) - vel.x * Math.sin(half)) * dt;
    p.yaw += yawRate * dt;
    p.s += clamp((p.s - previous.state.s) / span, -150, 150) * dt;
    p.u += clamp((p.u - previous.state.u) / span, -50, 50) * dt;
    if (late >= 350) p.vLong = p.vLat = 0;
    return p;
  }
}

export function receiveRemoteSnapshot(peers, message, { id, members = [], receivedAt = performance.now(), networkDelay = 0 } = {}) {
  for (const p of message.players) {
    if (p.id === id || !valid(p.state)) continue;
    const previous = peers.get(p.id), member = members.find(m => m.id === p.id);
    const timeline = previous?.timeline || new RemoteTimeline();
    const stopped = p.finish != null || !!p.dnf;
    const accepted = timeline.push(p.state, { receivedAt, serverNow: message.now, stateAt: p.stateAt, car: member?.car, stopped, networkDelay });
    // Keep the newest authoritative state separate from the delayed rendering pose.
    if (accepted || !previous) peers.set(p.id, { ...p, at: receivedAt, timeline });
    else { previous.finish = p.finish; previous.dnf = p.dnf; }
  }
}

export function applyRemotePose(peer, vehicle, now = performance.now(), stopped = false) {
  const p = peer.timeline?.sample(now, stopped || peer.finish != null || !!peer.dnf) || peer.state;
  for (const key of [...fields, 'yaw', 'gear', 'reverse']) if (p[key] !== undefined) vehicle[key] = p[key];
  return p;
}

export function resetRemoteTimelines(peers) { for (const peer of peers.values()) delete peer.timeline; }
