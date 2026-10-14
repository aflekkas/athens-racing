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
