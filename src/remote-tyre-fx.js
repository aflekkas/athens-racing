// Tyre smoke, rubber marks and burnout blur for other drivers. Their cars are display proxies with no wheel physics, so the
// handful of flags the driver's own physics reports (burnout, drift, lock-up, wheelspin) ride the state packet and are turned
// back into the wheel speeds Fx reads. Owner playtest 2026-10-18: "do you not see my tyre smoke?".
const round2 = value => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
/** the cosmetic flags a driver's physics vehicle publishes */
export function tyreFxState(vehicle) {
  return { burnout: !!vehicle.burnout, drift: round2(vehicle.drift), lockup: round2(vehicle.lockup), wheelspin: round2(vehicle.wheelspin) };
}
/** copy a received snapshot onto a remote vehicle and rebuild the wheel speeds Fx needs */
export function applyTyreFx(vehicle, snapshot) {
  vehicle.burnout = snapshot.burnout === true;
  vehicle.drift = Number.isFinite(snapshot.drift) ? snapshot.drift : 0;
  vehicle.lockup = Number.isFinite(snapshot.lockup) ? snapshot.lockup : 0;
  vehicle.wheelspin = Number.isFinite(snapshot.wheelspin) ? snapshot.wheelspin : 0;
  const corners = vehicle.corners; if (!corners || corners.length < 4) return;
  // Rear axle drives the smoke: a burnout spins it well past road speed, a hard launch by its wheelspin amount.
  const spin = vehicle.burnout ? 14 : 12 * Math.min(1, vehicle.wheelspin), locked = vehicle.lockup > 0.4;
  const load = (vehicle.m || 1200) * 9.81 * 0.25;
  for (let i = 0; i < 4; i++) {
    const driven = i >= 2;
    corners[i].vw = locked ? 0 : vehicle.vLong + (driven ? spin : 0);
    corners[i].sN = vehicle.burnout && driven ? 2 : 1;
    corners[i].Fz = load;
  }
}
