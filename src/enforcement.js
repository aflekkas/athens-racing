// POLICE & LAWS — optional game rules, shared by single-player and multiplayer.
//
// What this is: when enforcement is ON (the police toggle), breaking a traffic
// law where enforcement actually exists costs TIME (seconds added to the race
// clock) and is logged in an in-game fine history. Fines are plain race stats —
// seconds, not money — and are never real SMS/email/payment. Default penalties
// are game rules, not real legal advice.
//
// What this is NOT: no XP/progression/points, no character dialogue, no bounty.
// Heat/pursuit AI stays in src/police.js (mode owner); tow/time-penalty recovery
// stays with the recovery owner; taxi/getaway modes stay with the modes owner.
//
// Enforcement exists ONLY where it physically exists in the world:
//   - speed cameras: a mapped camera post on the route (data.speedCameras),
//     enforced for the travel direction it faces, with a per-camera cooldown so
//     one pass = one fine (never a fine per frame);
//   - red lights: a stop-line crossing during red counts ONLY when that
//     junction is enforced — a red-light camera site or a police unit that
//     witnessed it. No omniscient checks: unenforced junctions are free.
// Police capture (busted) is a time penalty + roadside hold, then you keep
// driving — not a permanent DNF — except in pursuit-type events where being
// caught fails the event's own objective (existing semantics, kept).
//
// Modes interface (agreed with taxi/getaway owner):
//   - master switch `laws` (event rules.laws, default follows the police
//     toggle): OFF means no fines, no forced chase from this module.
//   - getaway: wanted escalation only after the objective pickup, and only
//     when laws+police are on. This module consumes the controller's
//     pickup/dropoff objective events via modeArmed(true/false).
//   - taxi: never auto-wanted. This module never arms heat for taxi mode;
//     ordinary witnessed offences still follow the police module's rules.
//
// No DOM, no three.js: node can import this. tools/enforcement-test.mjs covers:
// directional trigger, speed threshold, cooldown, red-phase stop line, single
// fine per pass, off-toggle silence, no enforcement when absent, mode reset.
import { routeLimitAt } from './speed-limit.js';

export const ENF = {
  cameraMarginKmh: 10, // over the posted limit before a camera fires
  cameraCooldownSec: 60, // per-camera re-arm time (s): one pass = one fine
  cameraRadiusM: 12, // trigger window around the camera's route s
  redGraceSec: 0.3, // grace at both ends of the red (mirrors main.js)
  redPenaltySec: 2, // default red-light time penalty (rules.penalty overrides)
  cameraPenaltySec: 3, // default speed-camera time penalty (game seconds)
  capturePenaltySec: 15, // police capture: added time, then keep driving
  captureHoldSec: 5, // roadside hold with the clock running
};

/**
 * A fixed speed camera. dir: +1 enforces travel direction +s, -1 enforces -s,
 * 0 (or undefined) enforces both. limitKmh: posted limit at the post.
 */
export function cameraFires(cam, vehS, dir, kmh, now, margin = ENF.cameraMarginKmh) {
  if (cam.dir !== undefined && cam.dir !== 0 && dir !== 0 && cam.dir !== dir) return false;
  return kmh > (cam.limitKmh ?? 50) + margin;
}

/** Per-camera trigger state: directional, thresholded, single fine per pass. */
export class CameraWatch {
  constructor(opts = {}) {
    this.cfg = { ...ENF, ...opts };
    this.lastFire = new Map(); // camera index -> last fire time (s)
    this.inside = new Set(); // camera indexes currently within the window
  }
  reset() { this.lastFire.clear(); this.inside.clear(); }
  /**
   * Step one camera. Returns 'fire' once per pass, 'cooldown'/'absent' silent.
   * st: { s (route s), dir (+1/-1), kmh, now (s), limitKmh }.
   */
  step(i, cam, st) {
    const near = Math.abs(st.s - cam.s) < this.cfg.cameraRadiusM;
    if (!near) { this.inside.delete(i); return 'absent'; }
    const wasInside = this.inside.has(i);
    this.inside.add(i);
    if (wasInside) return 'held'; // same pass: never a second fine
    if (!cameraFires(cam, st.s, st.dir, st.kmh, st.now, this.cfg.cameraMarginKmh)) return 'under';
    const last = this.lastFire.get(i) ?? -1e9;
    if (st.now - last < this.cfg.cameraCooldownSec) return 'cooldown';
    this.lastFire.set(i, st.now);
    return 'fire';
  }
}

/**
 * Red-light judge. A crossing counts ONLY when the junction is enforced:
 * a red-light camera site, or a police unit that saw it (witnessed=true).
 * Crossing detected by the caller via signals.crossed(); phase from the
 * junction state ({ main === 'R', redT, toGreen }).
 */
export function redViolation(junction, enforcement) {
  if (!junction || junction.main !== 'R') return false;
  if (!(junction.redT > ENF.redGraceSec && junction.toGreen > ENF.redGraceSec)) return false;
  return !!(enforcement && (enforcement.camera || enforcement.witnessed));
}

/** In-game fine ledger: plain race stats (seconds), with history. Mode reset clears it. */
export class FineLedger {
  constructor() { this.reset(); }
  reset() { this.fines = []; this.totalSec = 0; }
  /**
   * Record a fine. kind: 'camera' | 'red' | 'capture'. Returns the entry.
   * Dedupes exact repeats (same kind+site within 2 s) so multi-frame callers
   * cannot stack fines.
   */
  add(kind, label, penaltySec, site = null, now = 0) {
    const last = this.fines[this.fines.length - 1];
    if (last && last.kind === kind && last.site === site && now - last.now < 2) return last;
    const entry = { kind, label, penaltySec, site, now };
    this.fines.push(entry);
    this.totalSec += penaltySec;
    return entry;
  }
  get count() { return this.fines.length; }
}

/**
 * Police capture resolution. Standard races: time penalty + hold, keep
 * driving (no DNF). Pursuit events: busted fails the event objective.
 */
export function resolveCapture(eventType) {
  if (eventType === 'pursuit') return { dnf: true, penaltySec: 0, holdSec: 0 };
  return { dnf: false, penaltySec: ENF.capturePenaltySec, holdSec: ENF.captureHoldSec };
}

/** Posted limit lookup helper for camera sites (reuses the speed owner data). */
export function limitFor(speeds, s) {
  const q = routeLimitAt(speeds, s);
  return q ? q.v : 50;
}

/**
 * Mode arming for the laws interaction (taxi/getaway owner interface):
 * ctx = { mode: 'taxi'|'getaway'|string, laws: bool, police: bool }.
 * Returns { enforce: bool, wantedArmed: bool }.
 * - laws off (or police off): nothing enforces, nothing arms. laws defaults
 *   to true when police is on (matches the getaway hook's rules.laws ?? true).
 * - taxi: never auto-wanted (wantedArmed always false).
 * - getaway: wanted escalation only after pickup (pickup=true) with laws+police.
 */
export function modeEnforcement(ctx = {}) {
  const enforce = ctx.police === true && ctx.laws !== false;
  const wantedArmed = enforce && ctx.mode === 'getaway' && ctx.pickup === true;
  return { enforce, wantedArmed };
}
