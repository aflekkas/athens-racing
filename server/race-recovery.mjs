import { recoveryPosition } from '../src/race-lifecycle.js';
import { courseRecoveryPose, courseFrame, coursePoseValid, restartCourseAt } from '../src/course.js';
export const RECOVERY_MS = 250;
export const CAPTURE_RECOVERY_MS = 5000;
export const RECOVERY_COOLDOWN_MS = 1000;
export function resetRecovery(driver, raceId) {
  driver.recoveryRace = raceId; driver.recovery = null; driver.recoveryRoad = null;
}
export function rememberRecoveryRoad(driver, event, raceId) {
  if (driver.recoveryRace !== raceId) resetRecovery(driver, raceId);
  if (driver.recovery?.raceId === raceId) driver.state.recoveryUntil = driver.recovery.until;
  // A small u on a neighbouring street is not evidence of earned race progress; the course keeps the
  // latest valid on-road pose itself.
  if (driver.course) {
    const pose = courseRecoveryPose(driver.course);
    if (pose && driver.course.onRoute) driver.recoveryRoad = { s: pose.s, u: 0 };
  } else if (Math.abs(driver.state.u) <= 8) driver.recoveryRoad = { s: driver.state.s, u: driver.state.u };
}
export function requestRecovery(driver, event, raceId, epoch, now, { route = null, capture = false } = {}) {
  if (!driver.state || !Number.isSafeInteger(epoch) || epoch <= (driver.state.motionEpoch ?? -1)) return null;
  if (driver.recoveryRace !== raceId) resetRecovery(driver, raceId);
  // Idempotent repeated requests acknowledge the new epoch without extending a hold.
  if (driver.recovery && now < Math.max(driver.recovery.until, driver.recovery.startedAt + RECOVERY_COOLDOWN_MS)) {
    driver.recovery.motionEpoch = epoch; driver.state.motionEpoch = epoch;
    if (capture) {
      driver.recovery.until = Math.max(driver.recovery.until, now + CAPTURE_RECOVERY_MS);
      driver.state.recoveryUntil = driver.recovery.until;
    }
    return driver.recovery;
  }
  const road = driver.recoveryRoad || { s: event.s0, u: 0 };
  // Always the latest valid on-road pose (owner decision 2026-10-18), never an earlier course point.
  const s = driver.course ? (courseRecoveryPose(driver.course)?.s ?? road.s) : recoveryPosition(driver.state.s, road.s, event.dir);
  const frame = route ? courseFrame(route, s, event.dir) : null;
  const u = route?.closed ? 0 : route ? event.dir * ((frame.halfWidth - 2 + .12) / 2) : road.u;
  const recovery = { raceId, s, u, startedAt: now, until: now + (capture ? CAPTURE_RECOVERY_MS : RECOVERY_MS), motionEpoch: epoch };
  driver.recovery = recovery;
  const position = frame ? { x: frame.x - frame.tz * u, y: frame.y, z: frame.z + frame.tx * u } : {};
  // Receipt clock and course history reset at the anchor; neither the fade nor
  // waiting for an acknowledgement can buy forward progress.
  driver.state = { ...driver.state, ...position, s, u,
    ...(frame ? { yaw: Math.atan2(-frame.tx, -frame.tz) + (event.dir < 0 ? Math.PI : 0) } : {}),
    vLong: 0, vLat: 0, steer: 0, gear: 1, rpm: 900, reverse: false,
    bodyDynamic: false, bodyQ: null, air: false, vy: 0, angularX: 0, angularY: 0, angularZ: 0,
    bodyHeave: 0, bodyPitch: 0, bodyRoll: 0,
    damage: { front: 0, rear: 0, left: 0, right: 0 }, impactMechanical: 0, maxImpactEbs: 0,
    engHealth: 1, engineDamage: 0, coolantTemp: 90, engineStalled: false, drivetrainBroken: false,
    engineFailureReason: null, mechanicalOverrevRpm: 0, motionEpoch: epoch, recoveryUntil: recovery.until };
  driver.stateAt = now;
  if (driver.course) restartCourseAt(driver.course, driver.state, now / 1000);
  return recovery;
}
export function recoveryStateAllowed(driver, state, raceId, now, { route = null, event = null } = {}) {
  const r = driver.recovery;
  if (!r || r.raceId !== raceId) return true;
  if (!Number.isSafeInteger(state.motionEpoch) || state.motionEpoch < r.motionEpoch) return false;
  if (now < r.until) {
    // The production placement helper can retreat a few metres on a folded
    // hairpin to keep the first physics projection on the same road leg.
    const delta = (state.s - r.s) * (event?.dir || 1);
    return delta <= .25 && delta >= -80 && Math.abs(state.vLong) < .1 && Math.abs(state.vLat) < .1 &&
      (route && driver.course ? coursePoseValid(driver.course, state, route) : Math.abs(state.u - r.u) < .25);
  }
  return true;
}
