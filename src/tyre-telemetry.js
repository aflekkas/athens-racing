// Read-only snapshot of the forces already solved by Vehicle. No aid may feed
// these values back into the integrator or mutate corners through this API.
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
export function tyreTelemetry(vehicle) {
  const wheels = (vehicle.corners || []).map((c, i) => {
    const capacity = Math.max(0, finite(vehicle._cap?.[i]));
    const longitudinal = finite(c.Fx) / Math.max(1, capacity * finite(vehicle.muX, 1.1));
    const lateral = finite(c.Fy) / Math.max(1, capacity);
    return Object.freeze({ wheel: ['FL', 'FR', 'RL', 'RR'][i], loadN: Math.max(0, finite(c.Fz)),
      capacityN: capacity, forceLongN: finite(c.Fx), forceLatN: finite(c.Fy),
      utilization: Math.min(1, Math.hypot(longitudinal, lateral)),
      slipDemand: Math.max(0, finite(c.sN)), slipLong: finite(c.sx), slipLat: finite(c.sy),
      contact: finite(c.Fz) > 1, driven: (i < 2 ? 1 - vehicle.shareR : vehicle.shareR) > 0,
      surface: vehicle.wheelSurf?.[i] || vehicle._wsurf?.[i] || vehicle.surf || 'asphalt',
      travelM: finite(c.travel) });
  });
  const axle = offset => {
    const pair = wheels.slice(offset, offset + 2), loadN = pair.reduce((s, c) => s + c.loadN, 0);
    // A nearly lifted inside wheel must not hide the loaded outside wheel's limit.
    const loaded = pair.filter(c => c.loadN > Math.max(1, loadN * 0.05));
    return Object.freeze({ loadN, utilization: Math.max(0, ...loaded.map(c => c.utilization)),
      slipDemand: Math.max(0, ...loaded.map(c => c.slipDemand)),
      saturated: loaded.some(c => c.slipDemand >= 1),
      sliding: loaded.some(c => c.slipDemand > 1.15), contact: pair.some(c => c.contact) });
  };
  const front = axle(0), rear = axle(2);
  return Object.freeze({ version: 1, wheels: Object.freeze(wheels), front, rear,
    // Diagnostic front-limited state; not a measurement of the driver's intended line.
    understeer: front.sliding && front.slipDemand > rear.slipDemand + 0.2 && Math.abs(vehicle.steer || 0) > 0.02,
    speedMps: finite(vehicle.speed), steerRad: finite(vehicle.steer), yawRateRad: finite(vehicle.w),
    sideslipRad: Math.atan2(finite(vehicle.vLat), Math.max(1, Math.abs(finite(vehicle.vLong)))),
    effectiveGravity: vehicle.sus?.fresh ? 1 : finite(vehicle.contactFrame?.effectiveGravity, 1),
    tcActive: !!vehicle.tcOn, absActive: !!vehicle.absOn, escActive: !!vehicle.escOn });
}
