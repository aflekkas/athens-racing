import { LocalCarriageways } from './local-carriageways.js';
// Shared course rule (owner decision 2026-10-18: no checkpoints). Progress along the route is tracked
// invisibly: only continuous, on-road movement advances it, a shortcut off the route buys nothing, and a
// finish needs the whole route covered. A tow puts the car on the nearest road (owner decision 2026-10-18: "we just
// want to tow back onto the road", src/tow-placement.js); this module only bounds where on the route that may be.
// No DOM, timers or network. The Worker uses receipt time; solo uses simulation time.
// Station spacing for the dense on-road check between two consecutive poses (metres).
export const PATH_SAMPLE = 8;
// Interior samples of a chord may sit this far outside the lane: a straight chord across a bend is not a shortcut.
export const CHORD_MARGIN = 5;
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
export function courseFrame(route, s, dir) {
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
// event: { s0, s1, dir, sectors?: [{ d }] }. Sector distances only time the run; they never gate it.
export function buildCourse(event, route) {
  const len = Math.abs(event.s1 - event.s0), dir = event.dir || 1;
  const marks = [...new Set([...(event.sectors || []).map(sector => sector.d).filter(d => d > 0 && d < len), len])].sort((a, b) => a - b);
  const start = roadFrame(route, event.s0);
  const pose = { s: event.s0, u: 0, x: start.x, y: start.y, z: start.z };
  const course = { s0: event.s0, dir, len, marks, markTimes: [], reached: 0, validProgress: 0, finishedAt: null,
    previous: { ...pose }, previousTime: null, lastRoad: { ...pose }, onRoute: true };
  if (route) courseRoutes.set(course, route);
  return course;
}
// Current position on the earned route, including legitimate backwards travel. The high-water mark
// (`reached`) is what a finish needs; this is what ranks a reversing car against another.
export function courseProgress(course) {
  return finite(course?.validProgress) ? course.validProgress : 0;
}
export const courseComplete = course => course?.finishedAt != null;
// True while progress is held because the car left the route and rejoined further on than it drove.
export const courseHeld = course => course?.rejoinLimit != null;
// Where on the route a tow may land, in route progress: never before the latest valid on-road pose, so a tow never
// moves a car back along the course. Nothing caps it above: a car towed onto a later stretch than it earned stays
// held by the rejoin rule below, so the placement itself grants no progress.
export function courseTowLimits(course) {
  const pose = course?.lastRoad;
  return { s0: course.s0, dir: course.dir, floor: courseProgress(course), ref: pose && finite(pose.s) ? pose.s : course.s0 };
}
function laneContains(lane, pose, margin = 0) {
  const dx = pose.x - lane.x, dz = pose.z - lane.z;
  return Math.abs(dx * lane.tx + dz * lane.tz) <= 8 &&
    Math.abs(-dx * lane.tz + dz * lane.tx) <= lane.halfWidth + margin && Math.abs((pose.y || 0) - lane.y) <= 8 + margin;
}
export function coursePoseValid(course, pose, route, margin = 0) {
  if (!finite(pose.s)) return false;
  if (!route || !finite(pose.x) || !finite(pose.z)) return Math.abs(pose.u || 0) <= 8;
  const length = route.length ?? (route.x?.length - 1) * route.step;
  const station = !route.closed && finite(length) ? Math.max(0, Math.min(length, pose.s)) : pose.s;
  const f = courseFrame(route, station, course.dir);
  if (!route.closed && station !== pose.s) for (const lane of f.lanes || [f]) {
    lane.x += (pose.s - station) * lane.tx; lane.z += (pose.s - station) * lane.tz;
  }
  return (f.lanes || [f]).some(lane => laneContains(lane, pose, margin));
}
// The straight chord between two consecutive accepted poses must itself stay on the route: this is what
// makes a cut through a block, a parallel street or a teleport worthless even when both ends are on tarmac.
function chordOnRoute(course, a, b, route) {
  if (!route || !finite(a.x) || !finite(a.z) || !finite(b.x) || !finite(b.z)) return true;
  const length = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(length / PATH_SAMPLE);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const pose = { s: a.s + (b.s - a.s) * t, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t };
    if (!coursePoseValid(course, pose, route, CHORD_MARGIN)) return false;
  }
  return true;
}
export function observeCourse(course, pose, now, { initialTime = 0, recovery = false, route = courseRoutes.get(course) || null } = {}) {
  const prev = course.previous, dt = Math.max(0, Math.min(5, now - (course.previousTime ?? initialTime)));
  const d0 = progress(course, prev.s), d1 = progress(course, pose.s);
  const continuous = Math.abs(pose.s - prev.s) <= 30 + 150 * dt && (!finite(pose.x) || Math.hypot(pose.x - prev.x, pose.z - prev.z) <= 15 + 150 * dt);
  const onRoute = coursePoseValid(course, pose, route);
  const followed = onRoute && continuous && chordOnRoute(course, prev, pose, route);
  // Rejoining a different leg/parallel street cannot buy the distance spent off the route. Go back
  // to the departure point, or tow to the latest valid pose.
  // Distance actually driven while off the route is credited towards the rejoin point, so a short
  // excursion that comes straight back costs nothing, while a cut that skips more route than it drives
  // (a shortcut) rejoins beyond the limit and earns nothing until the car goes back or is towed.
  if (!recovery && !followed) {
    const driven = continuous && finite(pose.x) ? Math.hypot(pose.x - prev.x, pose.z - prev.z) : 0;
    course.rejoinLimit = (course.rejoinLimit ?? course.validProgress + 6) + driven;
  }
  const rejoined = course.rejoinLimit == null || d1 <= course.rejoinLimit;
  if (followed && rejoined) delete course.rejoinLimit;
  const valid = followed && rejoined;
  if (valid) {
    const before = course.reached;
    course.validProgress = d1;
    course.lastRoad = { s: pose.s, u: pose.u, x: pose.x, y: pose.y, z: pose.z };
    if (!recovery && d1 > before) {
      course.reached = d1;
      // Interpolate the crossing time between the two poses, never the end of the frame.
      const fraction = d => d1 > d0 ? Math.max(0, Math.min(1, (d - d0) / (d1 - d0))) : 1;
      course.marks.forEach((d, i) => { if (course.markTimes[i] == null && d1 >= d) course.markTimes[i] = now - dt + dt * fraction(d); });
      if (course.finishedAt == null && d1 >= course.len) course.finishedAt = course.markTimes.at(-1);
    }
  }
  course.onRoute = valid;
  course.previous = { s: pose.s, u: pose.u, x: pose.x, y: pose.y, z: pose.z };
  course.previousTime = now;
  return course;
}
// A tow places the car on the nearest road: history restarts at the placement, so neither the placement nor the
// drive to it is a discontinuity. Earned progress (`validProgress`, `reached`, the rejoin limit and the latest valid
// on-road pose) is untouched: only driving moves it, and a tow never grants any.
export function towCourseTo(course, pose, now) {
  course.previous = { s: pose.s, u: pose.u, x: pose.x, y: pose.y, z: pose.z }; course.previousTime = now;
  course.onRoute = pose.kind !== 'road';
}
