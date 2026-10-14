// Shared course rule: ordered road-width gates, at most 80 m apart. No DOM,
// timers or network. The Worker uses receipt time; solo uses simulation time.
export const GATE_SPACING = 80;
export const MISSED_CHECKPOINT = 'MISSED CHECKPOINT — go back';
const finite = Number.isFinite;
const progress = (course, s) => (s - course.s0) * course.dir;
export function roadFrame(route, s) {
  if (typeof route?.frame === 'function') return { ...route.frame(s, {}), halfWidth: route.edge(s) + 2 };
  if (!route?.z?.length || !finite(route.step)) return { x: s, y: 0, z: 0, tx: 1, tz: 0, halfWidth: 30 };
  const n = route.x.length, length = (n - 1) * route.step;
  const wrapped = route.closed ? ((s % length) + length) % length : Math.max(0, Math.min(length - .0001, s));
  const f = wrapped / route.step, i = Math.min(n - 2, Math.floor(f)), t = f - i;
  const lerp = a => (a?.[i] || 0) * (1 - t) + (a?.[i + 1] || 0) * t;
  const tangent = j => {
    const a = route.closed ? (j - 2 + n - 1) % (n - 1) : Math.max(0, j - 2);
    const b = route.closed ? (j + 2) % (n - 1) : Math.min(n - 1, j + 2);
    const dx = route.x[b] - route.x[a], dz = route.z[b] - route.z[a], len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  const a = tangent(i), b = tangent(i + 1), tx = a[0] * (1 - t) + b[0] * t, tz = a[1] * (1 - t) + b[1] * t, norm = Math.hypot(tx, tz) || 1;
  const width = Array.isArray(route.width) ? lerp(route.width) : route.width;
  return { x: lerp(route.x), y: lerp(route.y), z: lerp(route.z), tx: tx / norm, tz: tz / norm,
    halfWidth: (finite(width) ? width / 2 : .12 + 1.2 * lerp(route.div) + 3.3 * (lerp(route.lanes) || 1)) + 2 };
}
export function buildCourse(event, route) {
  const len = Math.abs(event.s1 - event.s0), dir = event.dir || 1;
  const distances = new Set([len]);
  for (let d = GATE_SPACING; d < len; d += GATE_SPACING) distances.add(d);
  for (const cp of event.checkpoints || []) { const d = (cp.s - event.s0) * dir; if (d > 0 && d < len) distances.add(d); }
  const gates = [...distances].sort((a, b) => a - b).map((d, i) => ({ id: `gate-${i + 1}`, d, s: event.s0 + dir * d, ...roadFrame(route, event.s0 + dir * d) }));
  const start = roadFrame(route, event.s0);
  return { s0: event.s0, dir, gates, passed: 0, missed: false, previous: { s: event.s0, u: 0, x: start.x, y: start.y, z: start.z }, previousTime: null };
}
export function courseStatus(course) {
  const gate = course.gates[course.passed];
  return { passed: course.passed, total: course.gates.length, missed: course.missed,
    next: gate ? { id: gate.id, s: gate.s, x: gate.x, y: gate.y, z: gate.z, halfWidth: gate.halfWidth } : null,
    message: course.missed ? MISSED_CHECKPOINT : '' };
}
export function observeCourse(course, pose, now, { initialTime = 0, recovery = false } = {}) {
  const prev = course.previous, dt = Math.max(0, Math.min(5, now - (course.previousTime ?? initialTime)));
  const d0 = progress(course, prev.s), d1 = progress(course, pose.s);
  const continuous = Math.abs(pose.s - prev.s) <= 30 + 150 * dt && (!finite(pose.x) || Math.hypot(pose.x - prev.x, pose.z - prev.z) <= 15 + 150 * dt);
  let gate = course.gates[course.passed];
  if (!recovery && continuous) while (gate && d0 < gate.d && d1 >= gate.d) {
    // Intersect the actual movement segment with the gate's road-normal plane.
    // Claimed s/u alone cannot turn a land/side-road crossing into a checkpoint.
    let valid;
    if (finite(pose.x) && finite(pose.z)) {
      const signed = p => ((p.x - gate.x) * gate.tx + (p.z - gate.z) * gate.tz) * course.dir;
      const a = signed(prev), b = signed(pose), fraction = -a / (b - a);
      const x = prev.x + (pose.x - prev.x) * fraction, z = prev.z + (pose.z - prev.z) * fraction;
      const y = (prev.y || 0) + ((pose.y || 0) - (prev.y || 0)) * fraction;
      const lateral = (x - gate.x) * -gate.tz + (z - gate.z) * gate.tx;
      valid = a <= .5 && b >= -.5 && b > a && fraction >= 0 && fraction <= 1 && Math.abs(lateral) <= gate.halfWidth && Math.abs(y - gate.y) <= 8;
    } else valid = Math.abs(pose.u ?? 0) <= gate.halfWidth; // geometry-free event test fixtures
    if (!valid) { course.missed = true; break; }
    course.passed++; course.missed = false; gate = course.gates[course.passed];
  }
  if (gate && d1 > gate.d + 3) course.missed = true;
  if (!continuous && d1 > d0) course.missed = true;
  course.previous = { s: pose.s, u: pose.u, x: pose.x, y: pose.y, z: pose.z };
  course.previousTime = now;
  return courseStatus(course);
}
