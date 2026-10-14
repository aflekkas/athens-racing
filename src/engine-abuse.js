// Gameplay calibration, not a factory engine-life model. Fuel cut cannot prevent
// a lower gear forcing the crank faster; clutch engagement, not the key press,
// causes damage. Small overshoots and normal limiter bounce have an 8% grace.
export const ENGINE_ABUSE = Object.freeze({ safeRatio: 1.08, displayRatio: 2.5, warningTemp: 112, failureTemp: 142 });
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

export function resetEngineAbuse(v) {
  v.engineDamage = 0; v.engineFailureReason = null; v.engineThrottle = 0;
  v.mechanicalOverrevRpm = 0; v._unsafeShift = null; v._overrevGear = 0; v.shiftFeedback = null;
}
export function predictedGearRpm(v, gear) {
  const c = v.corners, rear = v.shareR;
  const wheelSpeed = (c[0].vw + c[1].vw) * 0.5 * (1 - rear) + (c[2].vw + c[3].vw) * 0.5 * rear;
  return Math.abs(wheelSpeed / v.spec.wheelR * v.ratio(gear) * 60 / (2 * Math.PI));
}
export function shiftFeedback(v, accepted, reason, to = v.gear, predictedRpm = null, unsafe = false, from = v.gear) {
  v.shiftFeedback = { serial: v._shiftFeedbackSerial = (v._shiftFeedbackSerial || 0) + 1,
    accepted, reason, from, to, predictedRpm, unsafe };
  return accepted;
}
function damageEngine(v, amount, reason) {
  v.engineDamage = clamp((v.engineDamage || 0) + amount, 0, 1);
  if (v.engineDamage >= 0.98) { v.engineDamage = 1; v.engineStalled = true; v.engineFailureReason = reason; v.kickT = 0; }
}
/** Called after actual clutch/RPM integration. Only a manual downshift arms
 * mechanical abuse, so ordinary powered wheelspin/limiter overshoot is safe. */
export function updateMechanicalOverrev(v, dt, wheelRpm, engaged) {
  if (!v.manual || v.reverse) { v._unsafeShift = null; v._overrevGear = 0; v.mechanicalOverrevRpm = 0; return false; }
  const ratio = clamp(Math.abs(wheelRpm) / v.spec.redline, 0, ENGINE_ABUSE.displayRatio);
  let changed = false;
  if (engaged && v._unsafeShift?.gear === v.gear) {
    const request = v._unsafeShift; v._unsafeShift = null;
    v._overrevGear = ratio > ENGINE_ABUSE.safeRatio ? v.gear : 0;
    if (v._overrevGear) {
      damageEngine(v, Math.min(1, 0.85 * ((ratio - ENGINE_ABUSE.safeRatio) / 0.62) ** 2), 'mechanical_overrev');
      changed = true;
      // Warn if acceleration during the shift made an initially safe request unsafe.
      if (!request.unsafe) shiftFeedback(v, true, 'mechanical_overrev', v.gear, Math.abs(wheelRpm), true, request.from);
    }
  }
  if (v._overrevGear !== v.gear || ratio <= ENGINE_ABUSE.safeRatio) v._overrevGear = 0;
  v.mechanicalOverrevRpm = v._overrevGear && engaged ? Math.abs(wheelRpm) : 0;
  if (v._overrevGear && engaged && !v.engineStalled) {
    damageEngine(v, clamp(dt, 0, 0.25) * 0.8 * ((ratio - ENGINE_ABUSE.safeRatio) / 0.62) ** 2, 'mechanical_overrev');
    changed = true;
  }
  return changed;
}
/** Additional player-manual heat only. Existing radiator heat/cooling remains
 * authoritative for AI/auto. Brief limiter use is harmless; sustained high revs
 * with little airflow heat gradually, and easing off/airflow cool through damageFx. */
export function updateManualHeat(v, dt) {
  if (!v.manual || !(dt > 0)) return;
  const rev = clamp(((v.rpm || 0) / v.spec.redline - 0.65) / 0.35, 0, 1);
  const pedal = clamp(v.engineThrottle || 0, 0, 1);
  const heat = v.engineStalled ? 0 : 1.5 * rev * rev * pedal * (1 + (v.engineDamage || 0));
  v.coolantTemp = clamp(v.coolantTemp + dt * heat, 90, 145);
  if (!v.engineStalled && v.coolantTemp > 125) damageEngine(v, dt * 0.0007 * (v.coolantTemp - 125), 'overheating');
}
export function engineWearFactor(v) {
  if (v.coolantTemp >= ENGINE_ABUSE.failureTemp && !v.engineFailureReason) v.engineFailureReason = 'overheating';
  if (v.engineStalled && !v.engineFailureReason) v.engineFailureReason = 'impact';
  if (v.drivetrainBroken && !v.engineFailureReason) v.engineFailureReason = 'drivetrain';
  return 1 - clamp(v.engineDamage || 0, 0, 1);
}
