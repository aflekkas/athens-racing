import { LocalCarriageways } from './local-carriageways.js';
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
// The server receives raw geometry, while solo already has a Route. Reuse the
// same pure carriageway mapper so tunnel/transition gates lie on actual tarmac.
const layouts = new WeakMap();
function carriageways(route) {
  if (route?.localLayout) return { layout: route.localLayout, route };
  if (!route?.corridors?.length || !route.z?.length || !finite(route.step)) return null;
  if (layouts.has(route)) return layouts.get(route);
  const sample = (values, s) => {
    const f = Math.max(0, Math.min(values.length - 1.0001, s / route.step)), i = Math.floor(f), t = f - i;
    return values[i] * (1 - t) + values[i + 1] * t;
  };
  const adapter = {
    frame(s, out) { const f = roadFrame(route, s); return Object.assign(out, f, { rx: -f.tz, rz: f.tx }); },
    medHalf(s) { return .12 + 1.2 * sample(route.div, s); },
    edge(s) { return roadFrame(route, s).halfWidth - 2; },
    surfaceY(s) { return roadFrame(route, s).y; },
    _projectBase(x, z) {
      let distance = Infinity, s = 0;
      for (let i = 0; i < route.x.length - 1; i++) {
        const dx = route.x[i + 1] - route.x[i], dz = route.z[i + 1] - route.z[i];
        const t = Math.max(0, Math.min(1, ((x - route.x[i]) * dx + (z - route.z[i]) * dz) / (dx * dx + dz * dz || 1)));
        const d = (x - route.x[i] - dx * t) ** 2 + (z - route.z[i] - dz * t) ** 2;
        if (d < distance) { distance = d; s = (i + t) * route.step; }
      }
      return { s };
    },
  };
  const mapped = { layout: new LocalCarriageways(adapter, route.corridors), route: adapter };
  layouts.set(route, mapped); return mapped;
}
export function checkpointFrame(route, s, dir) {
  const mapped = carriageways(route);
  if (!mapped?.layout.contains(s)) return roadFrame(route, s);
  const lanes = [1, -1].map(direction => {
    const bore = mapped.layout.bore(s, direction);
    if (bore) return { ...bore.frame(s, {}), direction,
      halfWidth: (mapped.route.edge(s) - mapped.route.medHalf(s)) * mapped.layout.scale(bore, s) / 2 + 2 };
    // One transition can begin earlier than the other: retain the untouched
    // carriageway alongside the mapped bore rather than blocking that lane.
    const frame = mapped.route.frame(s, {}), u = mapped.layout.centreU(s, direction);
    return { ...frame, x: frame.x + frame.rx * u, z: frame.z + frame.rz * u, direction,
      halfWidth: (mapped.route.edge(s) - mapped.route.medHalf(s)) / 2 + 2 };
  });
  return lanes.length ? { ...(lanes.find(l => l.direction === dir) || lanes[0]), lanes } : roadFrame(route, s);
}
const courseRoutes = new WeakMap();
export function buildCourse(event, route) {
  const len = Math.abs(event.s1 - event.s0), dir = event.dir || 1;
  const distances = new Set([len]);
  for (let d = GATE_SPACING; d < len; d += GATE_SPACING) distances.add(d);
  for (const cp of event.checkpoints || []) { const d = (cp.s - event.s0) * dir; if (d > 0 && d < len) distances.add(d); }
  const gates = [...distances].sort((a, b) => a - b).map((d, i) => ({ id: `gate-${i + 1}`, d, s: event.s0 + dir * d, ...checkpointFrame(route, event.s0 + dir * d, dir) }));
  const start = roadFrame(route, event.s0);
  const course = { s0: event.s0, dir, gates, passed: 0, missed: false, gateTimes: [], previous: { s: event.s0, u: 0, x: start.x, y: start.y, z: start.z }, previousTime: null, validProgress: 0, onRoute: true };
  if (route) courseRoutes.set(course, route);
  return course;
}
// Current position on the earned route, including legitimate backwards travel.
// The gate cursor is a high-water mark; it must never itself rank a reversing car.
export function courseProgress(course) {
  return finite(course?.validProgress) ? course.validProgress : course?.gates[course.passed - 1]?.d ?? 0;
}
export function courseRecoveryStation(course, currentS) {
  const anchor = course.s0 + course.dir * courseProgress(course);
  // A local backwards excursion may retreat the anchor. A projection onto a
  // different lap/road leg must never drag a recovery kilometres backwards.
  return finite(currentS) && Math.abs(currentS - anchor) <= GATE_SPACING ?
    course.dir * Math.min(course.dir * currentS, course.dir * anchor) : anchor;
}
export function coursePoseValid(course, pose, route) {
  if (!finite(pose.s)) return false;
  if (!route || !finite(pose.x) || !finite(pose.z)) return Math.abs(pose.u || 0) <= 8;
  const length = route.length ?? (route.x?.length - 1) * route.step;
  const station = !route.closed && finite(length) ? Math.max(0, Math.min(length, pose.s)) : pose.s;
  const f = checkpointFrame(route, station, course.dir);
  if (!route.closed && station !== pose.s) for (const lane of f.lanes || [f]) {
    lane.x += (pose.s - station) * lane.tx; lane.z += (pose.s - station) * lane.tz;
  }
  return (f.lanes || [f]).some(lane => {
    const dx = pose.x - lane.x, dz = pose.z - lane.z;
    return Math.abs(dx * lane.tx + dz * lane.tz) <= 8 &&
      Math.abs(-dx * lane.tz + dz * lane.tx) <= lane.halfWidth && Math.abs((pose.y || 0) - lane.y) <= 8;
  });
}
export function courseStatus(course) {
  const gate = course.gates[course.passed];
  return { passed: course.passed, total: course.gates.length, missed: course.missed,
    next: gate ? { id: gate.id, s: gate.s, x: gate.x, y: gate.y, z: gate.z, halfWidth: gate.halfWidth } : null,
    message: course.missed ? MISSED_CHECKPOINT : '' };
}
export function observeCourse(course, pose, now, { initialTime = 0, recovery = false, route = courseRoutes.get(course) || null } = {}) {
  const prev = course.previous, dt = Math.max(0, Math.min(5, now - (course.previousTime ?? initialTime)));
  const d0 = progress(course, prev.s), d1 = progress(course, pose.s);
  const continuous = Math.abs(pose.s - prev.s) <= 30 + 150 * dt && (!finite(pose.x) || Math.hypot(pose.x - prev.x, pose.z - prev.z) <= 15 + 150 * dt);
  const onRoute = coursePoseValid(course, pose, route);
  // Rejoining a different leg/parallel street cannot buy the distance spent off
  // course. Go back to the departure point, or recover to that earned anchor.
  if (!recovery && (!onRoute || !continuous)) course.rejoinLimit ??= courseProgress(course) + 6;
  const rejoined = course.rejoinLimit == null || d1 <= course.rejoinLimit;
  if (onRoute && continuous && rejoined) delete course.rejoinLimit;
  let gate = course.gates[course.passed];
  if (!recovery && continuous && onRoute && rejoined) while (gate) {
    let crossed = false, valid = false, crossingFraction = 1;
    // Five metres of station tolerance accommodates curved lane projection;
    // the physical crossing still decides whether the gate was actually passed.
    if (finite(pose.x) && finite(pose.z)) {
      if (d1 < gate.d - 5 || d0 > gate.d + 5) break;
      for (const lane of gate.lanes || [gate]) {
        const signed = p => ((p.x - lane.x) * lane.tx + (p.z - lane.z) * lane.tz) * course.dir;
        const a = signed(prev), b = signed(pose), fraction = -a / (b - a);
        if (!(a <= 0 && b >= 0 && b > a && fraction >= 0 && fraction <= 1)) continue;
        crossed = true;
        const x = prev.x + (pose.x - prev.x) * fraction, z = prev.z + (pose.z - prev.z) * fraction;
        const y = (prev.y || 0) + ((pose.y || 0) - (prev.y || 0)) * fraction;
        const lateral = (x - lane.x) * -lane.tz + (z - lane.z) * lane.tx;
        if (Math.abs(lateral) <= lane.halfWidth && Math.abs(y - lane.y) <= 8) { valid = true; crossingFraction = Math.min(crossingFraction, fraction); }
      }
    } else {
      crossed = d0 < gate.d && d1 >= gate.d;
      crossingFraction = (gate.d - d0) / (d1 - d0);
      valid = Math.abs(pose.u ?? 0) <= gate.halfWidth; // geometry-free test fixtures
    }
    // Each carriageway has its own plane. Crossing the other bore's infinite
    // plane outside its width says nothing about the gate on our lane. Keep
    // the gate pending; the station tolerance below decides when it is missed.
    if (!crossed || !valid) break;
    (course.gateTimes ||= [])[course.passed] = now - dt + dt * crossingFraction;
    course.passed++; course.missed = false; gate = course.gates[course.passed];
  }
  if (gate && d1 > gate.d + 5 || !rejoined && onRoute) course.missed = true;
  if (onRoute && continuous && rejoined && (!gate || d1 <= gate.d + 5)) {
    course.validProgress = Math.min(d1, gate ? gate.d - .001 : course.gates.at(-1)?.d ?? d1);
    if (!recovery) course.missed = false;
  }
  course.onRoute = onRoute && continuous && rejoined;
  if (!continuous && d1 > d0) course.missed = true;
  course.previous = { s: pose.s, u: pose.u, x: pose.x, y: pose.y, z: pose.z };
  course.previousTime = now;
  return courseStatus(course);
}
