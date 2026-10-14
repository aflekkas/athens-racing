// Conservative advisory, not an autopilot or a guarantee: ignores traffic and local puddles.
// Route.point supplies surveyed surface height/camber; no interpolation across a bend or terrain shortcut.
const G = 9.81;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const point = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
export function routeLineU(route, s, dir = 1, lane = 0) {
  const edge = Math.max(.2, finite(route.edge?.(s), 3.5) - .6);
  if (route.closed) return clamp(finite(route.racingU?.(s), 0), -edge, edge);
  const inner = Math.max(.25, finite(route.medHalf?.(s), 0) + .3);
  return (dir < 0 ? -1 : 1) * clamp(finite(route.laneU?.(s, lane), edge * .5), Math.min(inner, edge), edge);
}
export function curvature(a, b, c) {
  const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ac = Math.hypot(c.x - a.x, c.z - a.z);
  return ab * bc * ac > 1e-6 ? 2 * Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / (ab * bc * ac) : 0;
}
export function brakingDistance(speed, target, decel, reaction = .65) {
  if (speed <= target) return 0;
  return speed * reaction + (speed * speed - target * target) / (2 * Math.max(.5, decel));
}
export function guidanceTone(speed, allowed) { return speed > allowed * 1.08 + .8 ? 'brake' : speed > allowed * .94 ? 'prepare' : 'go'; }
export class DrivingGuidance {
  constructor({ horizon = 300, step = 4 } = {}) {
    this.step = step; this.capacity = Math.ceil(horizon / step) + 1;
    this.nodes = Array.from({ length: this.capacity }, () => ({ s: 0, distance: 0, u: 0, x: 0, y: 0, z: 0, safeSpeed: 0, allowedSpeed: 0, tone: 'go' }));
    this.a = point(); this.b = point(); this.c = point();
    this.result = { available: false, nodes: this.nodes, count: 0 };
  }
  update(vehicle, route, { dir = 1, wetGrip = 1, endS } = {}) {
    const result = this.result; result.available = false; result.count = 0;
    if (!vehicle || !route?.point || !Number.isFinite(vehicle.s) || vehicle._network || Math.abs(vehicle.u || 0) > finite(route.edge?.(vehicle.s), 5) + 1) return result;
    dir = dir < 0 ? -1 : 1;
    const speed = Math.abs(finite(vehicle.vLong, finite(vehicle.kmh, 0) / 3.6));
    const spec = vehicle.spec || {}, top = Math.max(15, finite(spec.vmax, 250) / 3.6);
    // The live capability API already includes weather. Fallback remote snapshots use catalogue grip + wetness.
    const ay = Math.max(1, finite(vehicle.maxLatAccel?.(speed), finite(spec.grip, .85) * G * wetGrip) * .78);
    const brake = Math.max(1, finite(vehicle.maxBrakeDecel?.(speed), finite(spec.brake, .85) * finite(spec.grip, .85) * G * wetGrip) * .75);
    const lane = route.closed ? 0 : clamp(Math.floor((Math.abs(vehicle.u || 0) - finite(route.medHalf?.(vehicle.s), 0)) / 3.5), 0, Math.max(0, (route.lanes?.(vehicle.s) || 1) - 1));
    const room = route.closed && !Number.isFinite(endS) ? this.capacity * this.step : Math.max(0, (finite(endS, dir > 0 ? route.length : 0) - vehicle.s) * dir);
    const count = Math.min(this.capacity, Math.floor(room / this.step) + 1);
    if (count < 3) return result;
    const sample = (s, out) => {
      const rs = route.closed ? route.wrap(s) : clamp(s, 0, route.length);
      route.point(rs, routeLineU(route, rs, dir, lane), out); return out;
    };
    for (let i = 0; i < count; i++) {
      const n = this.nodes[i], s = vehicle.s + dir * i * this.step, rs = route.closed ? route.wrap(s) : s;
      sample(s - this.step, this.a); sample(s, this.b); sample(s + this.step, this.c);
      const k = curvature(this.a, this.b, this.c);
      Object.assign(n, { s: rs, distance: i * this.step, u: routeLineU(route, rs, dir, lane), x: this.b.x, y: this.b.y + .065, z: this.b.z,
        safeSpeed: k > .00005 ? Math.min(top, Math.sqrt(ay / k)) : top });
      n.allowedSpeed = n.safeSpeed;
    }
    // Backward braking envelope follows height/grade in travel direction, including reverse and downhill.
    for (let i = count - 2; i >= 0; i--) {
      const n = this.nodes[i], next = this.nodes[i + 1], grade = (next.y - n.y) / this.step;
      const decel = Math.max(1, brake + G * clamp(grade, -.3, .3));
      n.allowedSpeed = Math.min(n.safeSpeed, Math.sqrt(next.allowedSpeed ** 2 + 2 * decel * this.step));
    }
    // Include reaction room in the displayed current recommendation.
    const reactionIndex = Math.min(count - 1, Math.ceil(speed * .65 / this.step));
    const allowed = this.nodes[reactionIndex].allowedSpeed;
    let targetIndex = reactionIndex;
    for (let i = reactionIndex + 1; i < count; i++) if (this.nodes[i].safeSpeed < this.nodes[targetIndex].safeSpeed - .25) targetIndex = i;
    const target = this.nodes[targetIndex];
    for (let i = 0; i < count; i++) this.nodes[i].tone = guidanceTone(speed, this.nodes[Math.min(count - 1, i + reactionIndex)].allowedSpeed);
    Object.assign(result, { available: true, count, speed, allowedSpeed: allowed, targetSpeed: target.safeSpeed,
      corner: target.safeSpeed < top * .98, targetDistance: target.safeSpeed < top * .98 ? target.distance : 0,
      brakingDistance: brakingDistance(speed, target.safeSpeed, brake), tone: guidanceTone(speed, allowed) });
    return result;
  }
}
