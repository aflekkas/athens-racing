import { gearboxMessage, bindingLabel } from './input-labels.js';
// Transmission metadata is independent of rendering so physics, menus and benches agree.
export function carTransmission(car) {
  return ['manual', 'auto', 'both'].includes(car?.transmission) ? car.transmission : 'both';
}
export function manualMode(car, preference) {
  const type = carTransmission(car);
  return type === 'manual' || !!preference;
}
export function toggleTransmission(vehicle, { bindings, device = 'keyboard' } = {}) {
  const type = carTransmission(vehicle.spec);
  if (type === 'manual') return { locked: true, message: gearboxMessage(type, vehicle.manual, bindings, device, { toggle: true }) };
  vehicle.setManual(!vehicle.manual);
  return { locked: false, message: gearboxMessage(type, vehicle.manual, bindings, device) };
}
// Pure feedback calculation, shared by the live HUD and its behavioural bench.
export function gearFeedback(st) {
  const ratio = (st.rpm || 0) / Math.max(1, st.redline || 1);
  const rev = Math.min(1, Math.max(0, ratio));
  return { rev, band: rev >= 0.97 ? 'red' : rev >= 0.82 ? 'yellow' : 'green',
    limiter: !!st.limiter || ratio > 1.005,
    upshift: !!st.manual && !st.engineStalled && st.engHealth !== 0 && st.canUpshift !== false && !['N', 'R'].includes(st.gearLabel) && rev >= 0.9 };
}

// A paddle press claims the gearbox until the driver explicitly returns to auto.
export function shiftTransmission(vehicle, direction, { bindings, device = 'keyboard' } = {}) {
  const switched = !vehicle.manual;
  vehicle.setManual(true);
  const shifted = vehicle.shiftManual(direction);
  return { switched, shifted, message: switched ? `MANUAL — press ${bindingLabel(bindings, 'transmission', device) === 'UNBOUND' ? 'M' : bindingLabel(bindings, 'transmission', device)} for auto` : null };
}
