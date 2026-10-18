import { courseTowLimits, towCourseTo, coursePoseValid } from '../src/course.js';
import { planTow, rawRoute, RoadIndex, roadSegments } from '../src/tow-placement.js';
export const RECOVERY_MS = 250;
export const CAPTURE_RECOVERY_MS = 5000;
export const RECOVERY_COOLDOWN_MS = 1000;
const finite = Number.isFinite;
export function resetRecovery(driver, raceId) {
  driver.recoveryRace = raceId; driver.recovery = null;
}
export function rememberRecoveryRoad(driver, event, raceId) {
  if (driver.recoveryRace !== raceId) resetRecovery(driver, raceId);
  if (driver.recovery?.raceId === raceId) driver.state.recoveryUntil = driver.recovery.until;
}
// Immutable catalogue geometry: the route adapter and the street index are built once per map.
const towMaps = new WeakMap();
function towMap(geometry) {
  if (!towMaps.has(geometry)) towMaps.set(geometry, { route: rawRoute(geometry), index: new RoadIndex(roadSegments(geometry.network)) });
  return towMaps.get(geometry);
}
// Owner decision 2026-10-18 ("we just want to tow back onto the road"): the server puts a tow on the nearest road to
// the car's last accepted pose, by the same rule as the client (src/tow-placement.js). A race prefers its own route
// within 40 m and never places the car before its latest valid on-road pose; the course tracker still counts only
// continuous on-route movement, so a tow cannot advance progress. The client's claimed position is never used.
function towPose(driver, event, route) {
  const state = driver.state, course = driver.course;
  if (route?.x?.length && [state.x, state.z, state.yaw].every(finite)) {
    const map = towMap(route);
    return planTow({ x: state.x, z: state.z, yaw: state.yaw, route: map.route, index: map.index, dir: event.dir || 1, course: course ? courseTowLimits(course) : null });
  }
  // Without geometry (test fixtures) the car stays at its own station, never before its latest valid pose.
  let s = state.s;
  if (course) { const { s0, dir, floor } = courseTowLimits(course); s = s0 + dir * Math.max(floor, (s - s0) * dir); }
  return { kind: 'route', s, u: Math.abs(state.u) <= 8 ? state.u : 0 };
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
  const pose = towPose(driver, event, route), { kind, s, u } = pose;
  const recovery = { raceId, kind, s, u, ...(finite(pose.x) && finite(pose.z) ? { x: pose.x, z: pose.z, yaw: pose.yaw } : {}), ...(finite(pose.y) ? { y: pose.y } : {}),
    startedAt: now, until: now + (capture ? CAPTURE_RECOVERY_MS : RECOVERY_MS), motionEpoch: epoch };
  driver.recovery = recovery;
  const position = finite(pose.x) && finite(pose.z) ? { x: pose.x, z: pose.z, ...(finite(pose.y) ? { y: pose.y } : {}) } : {};
  // Receipt clock and course history reset at the placement; neither the fade nor
  // waiting for an acknowledgement can buy forward progress.
  driver.state = { ...driver.state, ...position, s, u,
    ...(finite(pose.yaw) ? { yaw: pose.yaw } : {}),
    vLong: 0, vLat: 0, steer: 0, gear: 1, rpm: 900, reverse: false,
    bodyDynamic: false, bodyQ: null, air: false, vy: 0, angularX: 0, angularY: 0, angularZ: 0,
    bodyHeave: 0, bodyPitch: 0, bodyRoll: 0,
    damage: { front: 0, rear: 0, left: 0, right: 0 }, impactMechanical: 0, maxImpactEbs: 0,
    engHealth: 1, engineDamage: 0, coolantTemp: 90, engineStalled: false, drivetrainBroken: false,
    engineFailureReason: null, mechanicalOverrevRpm: 0, motionEpoch: epoch, recoveryUntil: recovery.until };
  driver.stateAt = now;
  if (driver.course) towCourseTo(driver.course, { ...driver.state, kind }, now / 1000);
  return recovery;
}
export function recoveryStateAllowed(driver, state, raceId, now, { route = null, event = null } = {}) {
  const r = driver.recovery;
  if (!r || r.raceId !== raceId) return true;
  if (!Number.isSafeInteger(state.motionEpoch) || state.motionEpoch < r.motionEpoch) return false;
  if (now < r.until) {
    const still = Math.abs(state.vLong) < .1 && Math.abs(state.vLat) < .1;
    // A car placed on a side street is held where the server put it.
    if (r.kind === 'road' && finite(r.x)) return still && Math.hypot(state.x - r.x, state.z - r.z) <= 3;
    // The production placement helper can retreat a few metres on a folded
    // hairpin to keep the first physics projection on the same road leg.
    const delta = (state.s - r.s) * (event?.dir || 1);
    return delta <= .25 && delta >= -80 && still &&
      (route && driver.course ? coursePoseValid(driver.course, state, route) : Math.abs(state.u - r.u) < 1);
  }
  return true;
}
