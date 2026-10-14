import { recoveryPosition } from '../src/race-lifecycle.js';
export const RECOVERY_MS = 5000;
export function resetRecovery(driver, raceId) {
  driver.recoveryRace = raceId; driver.recovery = null; driver.recoveryRoad = null;
}
export function rememberRecoveryRoad(driver, event, raceId) {
  if (driver.recoveryRace !== raceId) resetRecovery(driver, raceId);
  if (driver.recovery?.raceId === raceId) driver.state.recoveryUntil = driver.recovery.until;
  if (Math.abs(driver.state.u) <= 8) driver.recoveryRoad = { s: driver.state.s, u: driver.state.u };
}
export function requestRecovery(driver, event, raceId, epoch, now) {
  if (!driver.state || !Number.isSafeInteger(epoch) || epoch <= (driver.state.motionEpoch ?? -1)) return null;
  if (driver.recoveryRace !== raceId) resetRecovery(driver, raceId);
  if (driver.recovery && now < driver.recovery.until) return driver.recovery;
  const road = driver.recoveryRoad || { s: event.s0, u: 0 };
  const s = recoveryPosition(driver.state.s, road.s, event.dir);
  const recovery = { raceId, s, u: road.u, until: now + RECOVERY_MS, motionEpoch: epoch };
  driver.recovery = recovery;
  // Receipt clock is reset here, so time spent waiting cannot buy forward progress.
  driver.state = { ...driver.state, s, u: road.u, vLong: 0, vLat: 0, motionEpoch: epoch, recoveryUntil: recovery.until };
  driver.stateAt = now;
  return recovery;
}
export function recoveryStateAllowed(driver, state, raceId, now) {
  const r = driver.recovery;
  if (!r || r.raceId !== raceId) return true;
  if (!Number.isSafeInteger(state.motionEpoch) || state.motionEpoch < r.motionEpoch) return false;
  if (now < r.until) return Math.abs(state.s - r.s) < 0.25 && Math.abs(state.u - r.u) < 0.25 && Math.abs(state.vLong) < 0.1 && Math.abs(state.vLat) < 0.1;
  return true;
}
