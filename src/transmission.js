// Gearbox mode is a player preference, independent of the selected car.
export function manualMode(car, preference) { return !!preference; }
export function toggleTransmission(vehicle) {
  vehicle.setManual(!vehicle.manual);
  return { message: vehicle.manual ? 'MANUAL' : 'AUTOMATIC' };
}
// Pure feedback calculation, shared by the live HUD and its behavioural bench.
export function gearFeedback(st) {
  const ratio = (st.rpm || 0) / Math.max(1, st.redline || 1);
  const rev = Math.min(1, Math.max(0, ratio));
  return { rev, band: rev >= 0.97 ? 'red' : rev >= 0.82 ? 'yellow' : 'green',
    limiter: !!st.limiter || ratio > 1.005,
    upshift: !!st.manual && !st.engineStalled && st.engHealth !== 0 && st.canUpshift !== false && !['N', 'R'].includes(st.gearLabel) && rev >= 0.9 };
}

// Paddles temporarily hold a gear in Auto without changing the player preference.
export function shiftTransmission(vehicle, direction) {
  return { shifted: vehicle.shiftManual(direction) };
}

// Physical equipment, independent of the player's Auto / Manual shift policy.
// Values and estimation rules: tools/physics-test/POWERTRAIN.md. SI inertia kg m²;
// spoolTime/shiftTime seconds, maxFreeRevRate rpm/s, engineBraking fraction of peak Nm.
// Explicit coverage is intentional: the catalogue gate rejects an unconfigured trim.
export function powertrainFor(spec) {
  if (!spec.powertrain) return null; // controlled chassis fixtures retain their explicit legacy model
  const pt = { ...spec.powertrain };
  pt.revMatch ??= pt.gearboxType !== 'manual';
  pt.torqueConverter ??= pt.gearboxType === 'automatic';
  pt.limiterDrop ??= spec.engine === 'diesel' ? 180 : 220;
  return pt;
}

// A separated up/down schedule prevents hunting. Uphill/load raises cruise shift points;
// WOT uses the useful power band (diesel especially), while still approaching redline.
export function shiftSchedule(pt, throttle, load = 0) {
  const demand = Math.min(1, Math.max(throttle, Math.max(0, load) * 0.65));
  const t = Math.min(1, Math.max(0, (demand - 0.15) / 0.8));
  const blend = t * t * (3 - 2 * t);
  const cruise = pt.gearboxType === 'automatic' ? 0.34 : pt.gearboxType === 'dct' ? 0.38 : 0.43;
  const full = pt.spoolTime > 0 && pt.redlineRpm < 5200 ? 0.90 : 0.975;
  return { up: pt.redlineRpm * (cruise + (full - cruise) * blend),
    down: pt.redlineRpm * (0.20 + 0.28 * blend) };
}

// Preserve catalogue power/torque anchors, adding a plateau where sparse trim curves
// otherwise described a turbo as a peaky NA engine. End is power-consistent.
export function powertrainCurve(spec, pt) {
  if (!pt?.torquePlateau) return spec.torqueCurve;
  const [start, end] = pt.torquePlateau;
  const anchors = spec.torqueCurve || [[0, spec.torque * .35], [pt.idleRpm, spec.torque * .45],
    [pt.redlineRpm, Math.min(spec.torque * .65, spec.power * 1000 * 30 / (Math.PI * pt.redlineRpm))]];
  return [...anchors.filter(([rpm]) => rpm < start || rpm > end), [start, spec.torque], [end, spec.torque]]
    .sort((a,b) => a[0] - b[0]).filter((p,i,a) => !i || p[0] !== a[i-1][0]);
}
