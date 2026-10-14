import { settings, setSetting } from './settings.js';

// Only the electronic aids change; car, gearbox, wheel and suspension state stay live.
export function aidSpec(spec, preferences = settings) {
  if (preferences.aids && preferences.abs !== false) return spec;
  return { ...spec, ...(!preferences.aids ? { tc: 0, esc: 0, edl: 0 } : {}),
    ...(preferences.abs === false ? { abs: false } : {}) };
}
export function applyVehicleAids(vehicle, stock, preferences = settings) {
  const wasDisabled = (vehicle.spec.tc ?? 0.5) <= 0 && (vehicle.spec.esc ?? 0.4) <= 0;
  vehicle.spec = aidSpec(stock, preferences);
  // Enabling TC resumes intervention after a power slide; an ongoing deliberate
  // handbrake turn keeps its exception until alignment. Never change motion/gear.
  if (preferences.aids && wasDisabled && !vehicle.handbrakeTurn && !vehicle.handbrakeInput) {
    vehicle.driftLatch = 0; vehicle.powerT = 0;
  }
  if (!preferences.aids) {
    vehicle.tcCut = vehicle.escCut = 0; vehicle.tcOn = vehicle.escOn = false;
    for (const corner of vehicle.corners || []) corner.esc = corner.edl = 0;
  }
  if (preferences.abs === false) {
    vehicle.absOn = false;
    for (const corner of vehicle.corners || []) corner.abs = 1;
  }
}
export function toggleTractionControl({ preferences = settings, change = setSetting,
  notifications = globalThis.window?.__notifications, toast } = {}) {
  const enabled = !preferences.aids;
  change('aids', enabled);
  const message = enabled ? 'TC ON' : 'TC OFF';
  const options = { id: 'traction-control', ms: 1600, priority: 40 };
  if (typeof notifications?.toast === 'function') notifications.toast(message, options);
  else toast?.(message, options);
  return enabled;
}
