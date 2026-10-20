import { STATE_INTERVAL_MS } from './multiplayer-protocol.js';
// Sample at 20 Hz (STATE_INTERVAL_MS), send at most two samples per message, and avoid repeating parked state.
const tolerances = { vy: .05, angularX: .01, angularY: .01, angularZ: .01, x: .01, y: .01, z: .01, s: .02, u: .01, yaw: .001, steer: .005, vLong: .05, vLat: .05, rpm: 150, nitro: .02, bodyHeave: .005, bodyPitch: .005, bodyRoll: .005 };
function stationaryUnchanged(a, b) {
  if (!b || Math.abs(a.vLong) > .1 || Math.abs(a.vLat) > .1 || Math.abs(b.vLong) > .1 || Math.abs(b.vLat) > .1) return false;
  if (a.air !== b.air || a.bodyDynamic !== b.bodyDynamic) return false;
  // A stationary burnout is exactly the moment the tyres smoke: toggling it or the wheelspin must be sent.
  if (!!a.burnout !== !!b.burnout || Math.abs((a.wheelspin || 0) - (b.wheelspin || 0)) > .1) return false;
  if (JSON.stringify(a.bodyQ) !== JSON.stringify(b.bodyQ)) return false;
  if (JSON.stringify(a.recordMeta || null) !== JSON.stringify(b.recordMeta || null)) return false;
  if (a.gear !== b.gear || a.reverse !== b.reverse || a.braking !== b.braking || (a.pursuit ?? 0) !== (b.pursuit ?? 0)) return false;
  if (a.paint !== b.paint || JSON.stringify(a.driver || null) !== JSON.stringify(b.driver || null)) return false;
  for (const [key, tolerance] of Object.entries(tolerances)) if (Math.abs(a[key] - b[key]) > tolerance) return false;
  for (const zone of ['front', 'rear', 'left', 'right']) if (Math.abs((a.damage?.[zone] || 0) - (b.damage?.[zone] || 0)) > .001) return false;
  for (const key of ['engineDamage', 'engHealth', 'coolantTemp', 'engineStalled', 'drivetrainBroken', 'engineFailureReason', 'mechanicalOverrevRpm']) if (a[key] !== b[key]) return false;
  if (JSON.stringify(a.tyreTelemetry) !== JSON.stringify(b.tyreTelemetry)) return false;
  return true;
}

export class StateSender {
  constructor(send, { now = () => performance.now(), schedule = (fn, delay) => globalThis.setTimeout(fn, delay), cancel = id => globalThis.clearTimeout(id) } = {}) {
    this.send = send; this.now = now; this.schedule = schedule; this.cancel = cancel; this.reset();
  }
  reset() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null; this.pending = []; this.raceId = null; this.lastAt = -Infinity; this.last = null;
    this.motionEpoch = (this.motionEpoch || 0) + 1;
  }
  discontinuity() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null; this.pending = []; this.lastAt = -Infinity; this.last = null; this.motionEpoch++;
  }
  sample(state, raceId, { batching = false, force = false, at } = {}) {
    if (this.raceId !== raceId) { this.reset(); this.raceId = raceId; }
    const now = Number.isFinite(at) ? at : this.now();
    // 20 Hz when two samples share a message (same message budget as before); servers without batching keep 10 Hz single states.
    // A frame a hair early still counts: frame-quantised senders would otherwise wait for the next one.
    if (!force && now - this.lastAt < (batching ? STATE_INTERVAL_MS - 2 : 100)) return false;
    this.lastAt = now;
    if (!force && stationaryUnchanged(state, this.last)) return false;
    const {decals: legacyDecals, ...cleanState}=state;
    const snapshot = { ...cleanState, sampleTime: now, sampleAge: 0, motionEpoch: this.motionEpoch, damage: { ...state.damage }, ...(state.driver ? {driver:structuredClone(state.driver)} : {}) };
    this.last = snapshot;
    if (!batching) { this.send({ type: 'state', raceId, state: snapshot }); return true; }
    this.pending.push(snapshot);
    if (force || this.pending.length === 2) this.flush();
    else if (this.timer == null) this.timer = this.schedule(() => this.flush(), 2 * STATE_INTERVAL_MS);
    return true;
  }
  flush() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    if (!this.pending.length) return;
    const states = this.pending; this.pending = [];
    for (const state of states) state.sampleAge = Math.max(0, Math.min(1000, this.now() - state.sampleTime));
    this.send({ type: 'states', raceId: this.raceId, states });
  }
}
