import { interpolateQuaternion, advanceQuaternion } from './rigid-pose.js';
// Rendering only: never use delayed/predicted poses for ranking or finish validation.
const fields = ['x', 'y', 'z', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm'];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const speed = p => Math.hypot(p.vLong, p.vLat);
const velocity = p => ({ x: -Math.sin(p.yaw) * p.vLong + Math.cos(p.yaw) * p.vLat, z: -Math.cos(p.yaw) * p.vLong - Math.sin(p.yaw) * p.vLat });
const valid = p => p && [...fields, 'yaw'].every(k => Number.isFinite(p[k]));
const samePose = (a, b) => [...fields, 'yaw', 'gear', 'reverse', 'vy', 'bodyDynamic', 'air'].every(k => a[k] === b[k]) && JSON.stringify(a.bodyQ) === JSON.stringify(b.bodyQ);
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

// Remote cars are drawn from a buffer of time-stamped samples, DELAY behind the newest data we could possibly hold. The
// delay is a jitter buffer: it grows with the observed spread of packet arrival and with the gap between samples, so a
// 15 fps sender or a jittery link is interpolated (Hermite on position+velocity, slerp on rotation) instead of extrapolated.
// Extrapolation is only the fallback for a late/lost packet, and it is capped.
export const MIN_DELAY = 100, START_DELAY = 180, MAX_DELAY = 280, COAST_MS = 350, WINDOW_MS = 3000, BASE_WINDOW_MS = 10000, MAX_SAMPLES = 24, STALE_MS = 700;

export class RemoteTimeline {
  constructor() {
    this.samples = []; this.delay = START_DELAY; this.jitter = 0; this.cadence = 50; this.offset = null; this.base = null;
    this.arrivals = []; this.pushed = 0; this.playhead = null; this.pinned = false; this.rate = 1; this.renderAt = null; this.mode = 'empty'; this.resetCount = 0; this.err = null; this.shown = null;
  }
  push(state, { receivedAt, serverNow, stateAt, car, stopped = false, networkDelay = 0 } = {}) {
    if (!valid(state)) return false;
    const previous = this.samples.at(-1);
    // The receipt stamp is per player: another driver's packet must not rejuvenate a held pose.
    const receipt = Number.isFinite(stateAt) ? stateAt : null;
    const source = Number.isFinite(state.sampleTime) ? state.sampleTime : receipt ?? serverNow ?? receivedAt;
    const held = receipt !== null && Number.isFinite(serverNow) ? clamp(serverNow - receipt + (state.sampleAge || 0), 0, 10000) : 0;
    const net = Number.isFinite(networkDelay) ? clamp(networkDelay, 0, 150) : 0;
    const local = receivedAt - held - net;
    const restart = previous && receipt !== null && receipt > previous.receipt && source < previous.time - 500;
    if (previous && !restart && (source <= previous.time || (receipt === null && !Number.isFinite(state.sampleTime) && samePose(state, previous.state)))) return false;
    const gap = previous ? (source - previous.time) / 1000 : 0;
    const distance = previous ? Math.hypot(state.x - previous.state.x, state.z - previous.state.z) : 0;
    // Receiver stalls queue otherwise continuous snapshots. Only a gap on the
    // player's sample clock signals a stalled stream; receipt gaps cannot reset
    // the clock to the oldest packet in a queued burst.
    const discontinuity = previous && (restart || car !== previous.car || state.motionEpoch !== previous.state.motionEpoch || gap > 1.5 || distance > 3 + Math.max(speed(state), speed(previous.state)) * Math.max(0, gap) * 1.6);
    if (discontinuity) { this.samples = []; this.arrivals = []; this.pushed = 0; this.playhead = this.renderAt = null; this.pinned = false; this.rate = 1; this.offset = this.base = null; this.delay = START_DELAY; this.jitter = 0; this.cadence = 50; this.err = this.shown = null; this.resetCount++; }
    const last = this.samples.at(-1);
    const candidate = local - source;
    if (this.offset === null) this.offset = candidate;
    // A queued burst reveals the correct clock in its freshest packet. Adopt lower-delay observations immediately; delayed packets cannot drag it forward.
    else this.offset = Math.min(candidate, this.offset + .2);
    // Arrival lag: how long after its own timestamp this sample became available here (clock offset + transit + every hold).
    // Its floor is the best the path can do; the excess over the floor is the jitter the buffer has to absorb.
    // A car that stood still sent nothing: the gap before its first moving sample is a stop, not a slow sender or a lossy link.
    this.arrivals.push({ at: receivedAt, lag: receivedAt - source, source, afterStop: !!last && speed(last.state) < .1 });
    while (this.arrivals.length > 1 && receivedAt - this.arrivals[0].at > BASE_WINDOW_MS) this.arrivals.shift();
    this.base = Math.min(...this.arrivals.map(a => a.lag));
    if (last) {
      const interval = source - last.time;
      if (interval <= 600) this.cadence += (interval - this.cadence) * .1;
      const variation = Math.abs((local - last.local) - interval);
      this.jitter += (variation - this.jitter) * .1;
    }
    this.pushed++; this.tuneDelay(receivedAt);
    // Newest-first correction: if the playhead was already past the old newest sample, the car was being extrapolated. Measure
    // how far that guess was from where the new data puts it, and bleed the difference off instead of snapping.
    const shown = this.shown, wasCoasting = shown && this.mode === 'extrapolate' && this.playhead !== null && last && this.playhead > last.time;
    this.samples.push({ state: { ...state }, time: source, local, receivedAt, receipt, car, stopped, held, net });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    if (wasCoasting) {
      const raw = this.pose(this.playhead, stopped, false);
      if (raw) {
        const dx = shown.x - raw.x, dz = shown.z - raw.z, dy = shown.y - raw.y;
        if (Math.hypot(dx, dz) < 4 && Math.hypot(dx, dz) > .005) this.err = { x: dx, y: Math.abs(dy) < 1 ? dy : 0, z: dz, yaw: angle(shown.yaw - raw.yaw) };
      }
    }
    return true;
  }
  tuneDelay(now) {
    const window = this.arrivals.filter(a => now - a.at <= WINDOW_MS);
    if (window.length < 3) return;
    const excess = window.map(a => a.lag - this.base);
    let gap = 0; for (let i = 1; i < window.length; i++) { const g = window[i].source - window[i - 1].source; if (g > 0 && g <= 600 && !window[i].afterStop) gap = Math.max(gap, g); }
    const wanted = clamp(percentile(excess, .9) + gap + 15, MIN_DELAY, MAX_DELAY);
    // Attack fast (a starving buffer is the visible bug), release slowly (a shrinking buffer re-times every car on screen).
    // A dead band either way: a buffer that twitches by a few tens of ms re-times every car on screen each time.
    if (wanted > this.delay + 25) this.delay = wanted; else if (wanted < this.delay - 60) this.delay += (wanted - this.delay) * .03;
  }
  sample(now, stopped = false) {
    return this.poseAt(now, stopped);
  }
  poseAt(now, stopped = false) {
    if (!this.samples.length) return null;
    const target = now - this.base - this.delay;
    const latest = this.samples.at(-1), previous = this.samples.at(-2);
    const moving = this.isMoving(stopped);
    // Keep time at the last bounded prediction while frozen. On packet recovery playback continues from there, rather than
    // chasing a distant pose. Playback may run up to 5% fast or 10% slow to settle a changed buffer depth.
    if (this.playhead === null) this.playhead = target;
    else if (this.pinned && moving) {
      // The car stood still (a stopped car sends nothing, so the playhead was held on its last sample) and is moving again. The wall
      // clock kept running: re-time to it now. Crawling at +5 % would draw it the whole hold (0.3 - 1 s) behind for many seconds.
      this.playhead = Math.max(this.playhead, target); this.rate = 1; this.pinned = false;
    } else {
      const dt = Math.max(0, now - this.renderAt), error = target - this.playhead - dt;
      if (error > 1000) { this.playhead = target; this.rate = 1; } // a stall long enough to be a reconnect: re-time rather than crawl
      else {
        // The rate itself changes slowly (<= 0.3/s), otherwise every re-timing is a visible speed step of the car on screen.
        const wanted = clamp(1 + error / 3000, .9, 1.05);
        this.rate += clamp(wanted - this.rate, -.3 * dt / 1000, .3 * dt / 1000);
        this.playhead += dt * this.rate;
      }
    }
    const cap = latest.time + (moving ? COAST_MS : 0);
    if (this.playhead > cap) { this.playhead = cap; this.pinned = !moving; }
    const dt = this.renderAt === null ? 0 : clamp(now - this.renderAt, 0, 200);
    this.renderAt = now;
    const time = this.playhead;
    while (this.samples.length > 2 && this.samples[1].time <= time) this.samples.shift();
    const p = this.pose(time, stopped, true);
    if (this.err) {
      const k = Math.exp(-dt / 250); this.err.x *= k; this.err.y *= k; this.err.z *= k; this.err.yaw *= k;
      if (Math.hypot(this.err.x, this.err.z) < .002) this.err = null;
      else if (this.mode === 'interpolate' || this.mode === 'extrapolate') { p.x += this.err.x; p.y += this.err.y; p.z += this.err.z; p.yaw += this.err.yaw; }
    }
    this.shown = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
    return p;
  }
  isMoving(stopped = false) {
    const latest = this.samples.at(-1), previous = this.samples.at(-2);
    return !!previous && (Math.hypot(latest.state.x - previous.state.x, latest.state.z - previous.state.z) > .01 && speed(latest.state) > .1 || Math.abs(latest.state.y - previous.state.y) > .01 && Math.abs(latest.state.vy || 0) > .1 || latest.state.bodyDynamic && Math.hypot(latest.state.angularX || 0, latest.state.angularY || 0, latest.state.angularZ || 0) > .01) && !stopped && !latest.stopped;
  }
  // Pose at a sender-clock time. `commit` records the render mode; the correction probe leaves it alone.
  pose(time, stopped, commit) {
    const latest = this.samples.at(-1), previous = this.samples.at(-2), moving = this.isMoving(stopped);
    const set = mode => { if (commit) this.mode = mode; };
    if (this.samples.length === 1 || !moving && time >= latest.time) { set('stopped'); return { ...latest.state, vLong: 0, vLat: 0 }; }
    if (time <= this.samples[0].time) { set('buffering'); return { ...this.samples[0].state }; }
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1], b = this.samples[i];
      if (time > b.time) continue;
      set('interpolate');
      const span = b.time - a.time, t = clamp((time - a.time) / span, 0, 1), p = { ...a.state };
      for (const key of fields) p[key] = a.state[key] + (b.state[key] - a.state[key]) * t;
      for (const key of ['bodyHeave', 'bodyPitch', 'bodyRoll', 'vy', 'angularX', 'angularY', 'angularZ']) if (Number.isFinite(a.state[key]) && Number.isFinite(b.state[key])) p[key] = a.state[key] + (b.state[key] - a.state[key]) * t;
      if (a.state.bodyDynamic && b.state.bodyDynamic && a.state.bodyQ && b.state.bodyQ)
        p.bodyQ = interpolateQuaternion(a.state.bodyQ, b.state.bodyQ, t);
      else if (t >= .5) { p.bodyDynamic = b.state.bodyDynamic; p.bodyQ = b.state.bodyQ; p.air = b.state.air; }
      // Vertical Hermite follows ballistic arcs without flattening the jump apex.
      if (Number.isFinite(a.state.vy) && Number.isFinite(b.state.vy)) {
        const seconds = span / 1000;
        p.y = (2*t**3-3*t*t+1)*a.state.y + (t**3-2*t*t+t)*seconds*a.state.vy +
          (-2*t**3+3*t*t)*b.state.y + (t**3-t*t)*seconds*b.state.vy;
      }
      p.yaw = a.state.yaw + angle(b.state.yaw - a.state.yaw) * t;
      // Hermite positions retain acceleration/turning between samples.
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
    const late = Math.max(0, time - latest.time);
    set(!moving ? 'stopped' : late >= COAST_MS ? 'freeze' : 'extrapolate');
    return this.coast(latest, previous, late, moving);
  }
  // Bounded dead reckoning from the newest sample. One missed packet can coast briefly; after the cap the pose AND wheel speed freeze.
  coast(latest, previous, lateMs, moving = true, cap = COAST_MS) {
    const p = { ...latest.state };
    if (!moving) { p.vLong = p.vLat = 0; return p; }
    const dt = Math.min(lateMs, cap) / 1000;
    const vel = velocity(p), span = (latest.time - previous.time) / 1000;
    const yawRate = clamp(angle(p.yaw - previous.state.yaw) / span, -3, 3);
    const half = yawRate * dt / 2;
    p.x += (vel.x * Math.cos(half) + vel.z * Math.sin(half)) * dt;
    p.z += (vel.z * Math.cos(half) - vel.x * Math.sin(half)) * dt;
    p.yaw += yawRate * dt;
    if (p.bodyDynamic && p.bodyQ) {
      p.bodyQ = advanceQuaternion(p.bodyQ, [p.angularX || 0, p.angularY || 0, p.angularZ || 0], dt);
      if (p.air) { p.y += (p.vy || 0)*dt - 4.905*dt*dt; p.vy = (p.vy || 0) - 9.81*dt; }
    }
    p.s += clamp((p.s - previous.state.s) / span, -150, 150) * dt;
    p.u += clamp((p.u - previous.state.u) / span, -50, 50) * dt;
    if (lateMs >= cap) p.vLong = p.vLat = 0;
    return p;
  }
  // Where the other car most likely is RIGHT NOW (not where it is drawn): the newest sample dead-reckoned across the time it
  // spent in flight and in holds. Used for contact detection so both drivers test the same physical moment. Never drawn.
  predict(now, stopped = false) {
    const latest = this.samples.at(-1), previous = this.samples.at(-2);
    if (!latest) return null;
    // A parked car stops sending (nothing changes), so its newest sample can be minutes old and is still exactly right: it is solid.
    const parked = !previous ? Math.hypot(latest.state.vLong, latest.state.vLat) < .1 : !this.isMoving(stopped);
    if (parked) return { ...latest.state, vLong: 0, vLat: 0, parked: true };
    if (!previous) return { ...latest.state, vLong: 0, vLat: 0, stale: true }; // one moving sample after a re-sync says nothing about velocity
    const age = (now - latest.receivedAt) + latest.held, ahead = age + 2 * latest.net;
    // Dead-reckon at most 500 ms, keeping the car's velocity. Only a genuinely old stream (no data for 700 ms) is not evidence of
    // where the driver is: say so, so nobody is hit by a stale stream. (A slow receiver sees old packets too; its own frame
    // delays must not make every car a ghost.)
    const pose = this.coast(latest, previous, clamp(ahead, 0, 500), true, 600);
    if (age >= STALE_MS) pose.stale = true;
    return pose;
  }
}

export function receiveRemoteSnapshot(peers, message, { id, members = [], receivedAt = performance.now(), networkDelay = 0 } = {}) {
  for (const p of message.players) {
    if (p.id === id || !valid(p.state)) continue;
    const previous = peers.get(p.id), member = members.find(m => m.id === p.id);
    const timeline = previous?.timeline || new RemoteTimeline();
    const stopped = p.finish != null || !!p.dnf;
    // The relay carries every sample accepted since its last snapshot (oldest first), then the newest as `state`.
    let accepted = false;
    for (const sample of p.trail || []) {
      const { stateAt, ...state } = sample;
      accepted = timeline.push(state, { receivedAt, serverNow: message.now, stateAt: stateAt ?? p.stateAt, car: member?.car, stopped, networkDelay }) || accepted;
    }
    accepted = timeline.push(p.state, { receivedAt, serverNow: message.now, stateAt: p.stateAt, car: member?.car, stopped, networkDelay }) || accepted;
    // Keep the newest authoritative state separate from the delayed rendering pose.
    if (accepted || !previous) peers.set(p.id, { ...p, at: receivedAt, timeline });
    else { previous.finish = p.finish; previous.dnf = p.dnf; }
  }
}

export function applyRemotePose(peer, vehicle, now = performance.now(), stopped = false) {
  const p = peer.timeline?.sample(now, stopped || peer.finish != null || !!peer.dnf) || peer.state;
  for (const key of [...fields, 'yaw', 'gear', 'reverse', 'vy', 'bodyDynamic', 'air', 'bodyQ']) if (p[key] !== undefined) vehicle[key] = p[key];
  return p;
}
// The other car's best-guess present pose for contact tests (see RemoteTimeline.predict); the drawn pose lags it on purpose.
export function remoteContactPose(peer, now = performance.now(), stopped = false) {
  return peer.timeline?.predict(now, stopped || peer.finish != null || !!peer.dnf) || peer.state;
}

export function resetRemoteTimelines(peers) { for (const peer of peers.values()) delete peer.timeline; }
