// Transmission metadata is independent of rendering so physics, menus and benches agree.
export function carTransmission(car) {
  return ['manual', 'auto', 'both'].includes(car?.transmission) ? car.transmission : 'both';
}
export function manualMode(car, preference) {
  const type = carTransmission(car);
  return type === 'manual' || type === 'both' && !!preference;
}
export function toggleTransmission(vehicle) {
  const type = carTransmission(vehicle.spec);
  if (type !== 'both') return { locked: true, message: type === 'manual'
    ? 'MANUAL ONLY · M locked · E ↑ / Q ↓ to shift'
    : 'AUTO ONLY · M locked · E ↑ / Q ↓ paddle override' };
  vehicle.setManual(!vehicle.manual);
  return { locked: false, message: vehicle.manual ? 'MANUAL · E ↑ / Q ↓ · RB / LB' : 'AUTO · automatic shifting' };
}
// Pure feedback calculation, shared by the live HUD and its behavioural bench.
export function gearFeedback(st) {
  const ratio = (st.rpm || 0) / Math.max(1, st.redline || 1);
  const rev = Math.min(1, Math.max(0, ratio));
  return { rev, band: rev >= 0.97 ? 'red' : rev >= 0.82 ? 'yellow' : 'green',
    limiter: !!st.limiter || ratio > 1.005,
    upshift: !!st.manual && st.canUpshift !== false && !['N', 'R'].includes(st.gearLabel) && rev >= 0.9 };
}
