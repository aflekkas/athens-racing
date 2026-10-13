// Rendering only: never use delayed/predicted poses for ranking or finish validation.
const fields = ['x', 'y', 'z', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm'];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const speed = p => Math.hypot(p.vLong, p.vLat);
const velocity = p => ({ x: -Math.sin(p.yaw) * p.vLong + Math.cos(p.yaw) * p.vLat, z: -Math.cos(p.yaw) * p.vLong - Math.sin(p.yaw) * p.vLat });
const valid = p => p && [...fields, 'yaw'].every(k => Number.isFinite(p[k]));
const samePose = (a, b) => [...fields, 'yaw', 'gear', 'reverse'].every(k => a[k] === b[k]);

export class RemoteTimeline {
  constructor() { this.samples = []; this.delay = 250; this.jitter = 0; this.cadence = 200; this.offset = null; this.playhead = null; this.renderAt = null; }
  push(state, { receivedAt, serverNow, stateAt, car, stopped = false } = {}) {
    if (!valid(state)) return false;
    const previous = this.samples.at(-1);
    // The receipt stamp is per player: another driver's packet must not rejuvenate a held pose.
    const receipt = Number.isFinite(stateAt) ? stateAt : null;
    const source = Number.isFinite(state.sampleTime) ? state.sampleTime : receipt ?? serverNow ?? receivedAt;
    const age = receipt !== null && Number.isFinite(serverNow) ? clamp(serverNow - receipt + (state.sampleAge || 0), 0, 10000) : 0;
    const local = receivedAt - age;
    const restart = previous && receipt !== null && receipt > previous.receipt && source < previous.time - 500;
    if (previous && !restart && (source <= previous.time || (receipt === null && !Number.isFinite(state.sampleTime) && samePose(state, previous.state)))) return false;
    const gap = previous ? (source - previous.time) / 1000 : 0;
    const distance = previous ? Math.hypot(state.x - previous.state.x, state.z - previous.state.z) : 0;
    const discontinuity = previous && (restart || car !== previous.car || state.motionEpoch !== previous.state.motionEpoch || receivedAt - previous.receivedAt > 1500 || distance > 3 + Math.max(speed(state), speed(previous.state)) * Math.max(0, gap) * 1.6);
    if (discontinuity) { this.samples = []; this.playhead = this.renderAt = null; this.lastPose = null; this.recovering = false; this.offset = null; this.delay = 250; this.jitter = 0; this.cadence = 200; }
    const last = this.samples.at(-1);
    const candidate = local - source;
    if (this.offset === null) this.offset = candidate;
    // Track clock drift slowly; delayed packets cannot drag the clock forward.
    else this.offset += clamp(candidate - this.offset, -2, .2);
    if (last) {
      const interval = source - last.time;
      if (interval <= 600) this.cadence += (interval - this.cadence) * .1;
      const variation = Math.abs((local - last.local) - interval);
      this.jitter += (variation - this.jitter) * .1;
      this.delay = clamp(this.cadence + 50 + 2 * this.jitter, 200, 400);
    }
    this.samples.push({ state: { ...state }, time: source, local, receivedAt, receipt, car, stopped });
    if (this.samples.length > 16) this.samples.shift();
    return true;
  }
  sample(now, stopped = false) {
    const previous = this.lastPose, elapsed = (now - this.lastPoseAt) / 1000;
    const p = this.poseAt(now, stopped);
    if (!p) return null;
    // Recover from a frozen stream at a bounded speed, rather than jumping to its
    // resumed timeline. Discontinuities explicitly clear this visual correction.
    if (previous && elapsed > 0 && elapsed < 1) {
      const distance = Math.hypot(p.x - previous.x, p.z - previous.z);
      const limit = Math.max(speed(p), speed(previous), 1) * elapsed * 1.5;
      if (distance > limit) {
        this.recovering = true;
        const fraction = limit / distance;
        for (const key of ['x', 'y', 'z', 's', 'u']) p[key] = previous[key] + (p[key] - previous[key]) * fraction;
        p.yaw = previous.yaw + angle(p.yaw - previous.yaw) * fraction;
      } else this.recovering = false;
    }
    this.lastPose = { ...p }; this.lastPoseAt = now;
    return p;
  }
  poseAt(now, stopped = false) {
    if (!this.samples.length) return null;
    const target = now - this.offset - this.delay;
    // A changing jitter buffer slows/speeds playback by at most 10%, never rewinds it.
    if (this.playhead === null || now - this.renderAt > 1000) this.playhead = target;
    else { const dt = Math.max(0, now - this.renderAt); this.playhead += dt * clamp(1 + (target - this.playhead - dt) / 1000, .9, 1.1); }
    this.renderAt = now;
    const time = this.playhead, latest = this.samples.at(-1);
    while (this.samples.length > 2 && this.samples[1].time <= time) this.samples.shift();
    if (time <= this.samples[0].time) return { ...this.samples[0].state };
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1], b = this.samples[i];
      if (time > b.time) continue;
      const span = b.time - a.time, t = clamp((time - a.time) / span, 0, 1), p = { ...a.state };
      for (const key of fields) p[key] = a.state[key] + (b.state[key] - a.state[key]) * t;
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
    const p = { ...latest.state }, previous = this.samples.at(-2);
    const moving = previous && Math.hypot(p.x - previous.state.x, p.z - previous.state.z) > .01 && speed(p) > .1;
    if (!moving || stopped || latest.stopped) { p.vLong = p.vLat = 0; return p; }
    // One missed packet can coast briefly. After 120ms the pose AND wheel speed freeze.
    const late = Math.max(0, time - latest.time), dt = Math.min(late, 120) / 1000;
    const vel = velocity(p), span = (latest.time - previous.time) / 1000;
    const yawRate = clamp(angle(p.yaw - previous.state.yaw) / span, -3, 3);
    const half = yawRate * dt / 2;
    p.x += (vel.x * Math.cos(half) + vel.z * Math.sin(half)) * dt;
    p.z += (vel.z * Math.cos(half) - vel.x * Math.sin(half)) * dt;
    p.yaw += yawRate * dt;
    p.s += clamp((p.s - previous.state.s) / span, -150, 150) * dt;
    p.u += clamp((p.u - previous.state.u) / span, -50, 50) * dt;
    if (late >= 120) p.vLong = p.vLat = 0;
    return p;
  }
}

export function receiveRemoteSnapshot(peers, message, { id, members = [], receivedAt = performance.now() } = {}) {
  for (const p of message.players) {
    if (p.id === id || !valid(p.state)) continue;
    const previous = peers.get(p.id), member = members.find(m => m.id === p.id);
    const timeline = previous?.timeline || new RemoteTimeline();
    const stopped = p.finish != null || !!p.dnf;
    const accepted = timeline.push(p.state, { receivedAt, serverNow: message.now, stateAt: p.stateAt, car: member?.car, stopped });
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
