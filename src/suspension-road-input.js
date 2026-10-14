// Suspension support plane in the direction the contact patches actually travel.
// Keep kerb/hump steps in wheelBump; their response belongs to the corner springs.
import { wheelGround } from './wheel-ground.js';
const G = 9.81, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function suspensionRoadInput(v, road) {
  const route = v.route, outFrame = v._contactRouteFrame || (v._contactRouteFrame = {});
  const frame = route.contactFrame?.(v.s, v.u, outFrame) || route.frame(v.s, outFrame);
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
  const along = fx * frame.tx + fz * frame.tz, across = rx * frame.tx + rz * frame.tz;
  const speed = Math.hypot(v.vLong, v.vLat);
  const dsdt = v.vLong * along + v.vLat * across;
  let grade = v.gradeG, bank = Number.isFinite(v.bank) ? v.bank : (frame.bank || 0);
  if (!Number.isFinite(grade)) {
    const slope = route.contactFrame && Number.isFinite(frame.grade) ? frame.grade : route.lin(route.GR, v.s);
    const camber = frame.bank || 0;
    grade = slope * along + camber * (fx * frame.rx + fz * frame.rz);
    bank = slope * across + camber * (rx * frame.rx + rz * frame.rz);
  }
  let verticalAcceleration;
  // Ground.at is the same contact surface as Ground.resolve (including nearby
  // OSM roads); sample its plane, not the centre-line height of the race route.
  const mainRoad = frame.mapped !== true && v.gradeG === undefined && v._network !== true &&
    v.wheelSurf?.every(surface => surface === 'asphalt') && Math.abs(v.u) <= route.edge(v.s);
  if (typeof v.ground?.at === 'function' && speed > 0.01 && !mainRoad) {
    const dx = (fx * v.vLong + rx * v.vLat) / speed, dz = (fz * v.vLong + rz * v.vLat) / speed;
    const samples = v._contactSamples || (v._contactSamples = [{}, {}, {}]);
    const planes = v._contactPlanes || (v._contactPlanes = [0, 0, 0]);
    const wg = v._contactWheelGround || (v._contactWheelGround = {});
    for (let i = 0; i < 3; i++) {
      const distance = (i - 1) * 3, x = v.x + dx * distance, z = v.z + dz * distance;
      const q = route.project(x, z, v.s, 6);
      const surface = v.ground.at(x, z, q.s, q.u, samples[i]);
      planes[i] = wheelGround(route, road, surface, q.s, q.u, wg).plane;
    }
    verticalAcceleration = speed * speed * (planes[0] - 2 * planes[1] + planes[2]) / 9;
  } else {
    // Main-road/AI vehicles use the inexpensive route profile: curvature applies to their
    // actual progress speed, including reverse or sideways travel.
    verticalAcceleration = dsdt * dsdt * (route.y(v.s - 3) - 2 * route.y(v.s) + route.y(v.s + 3)) / 9;
  }
  if (!Number.isFinite(verticalAcceleration)) verticalAcceleration = 0;
  const normalGravity = 1 / Math.sqrt(1 + grade * grade + bank * bank);
  const effectiveGravity = clamp((1 + verticalAcceleration / G) * normalGravity, 0, 2.2);
  const out = v.contactFrame || (v.contactFrame = {});
  Object.assign(out, { effectiveGravity, verticalAcceleration, grade, bank, along, across });
  return out;
}
