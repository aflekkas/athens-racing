// Keep the direction of actual travel on tarmac, before an excursion or impact spins the body.
export function travelHeading(p) {
  const along = Number(p.vLong) || 0, across = Number(p.vLat) || 0;
  if (Math.hypot(along, across) < 2) return p.yaw;
  return Math.atan2(Math.sin(p.yaw) * along - Math.cos(p.yaw) * across,
    Math.cos(p.yaw) * along + Math.sin(p.yaw) * across);
}
export function rememberTowHeading(p, onRoad) {
  if (onRoad && !p.air && !p.bodyDynamic && !p.crashRecover && !p.wallHit &&
      Math.abs(p.w || p.angularY || 0) < .8 && Math.hypot(p.vLong, p.vLat) >= 2) {
    p.towHeading = travelHeading(p);
  }
}
export const towHeading = p => Number.isFinite(p.towHeading) ? p.towHeading : travelHeading(p);
