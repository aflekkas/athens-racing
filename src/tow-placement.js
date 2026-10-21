import { roadFrame, courseFrame } from './course.js';
import {towHeading} from './tow-heading.js';
// Where a tow, reset or server recovery puts a car (owner decision 2026-10-18: "we just want to tow back onto the
// road"). Free roam: the nearest drivable surface. Race: the nearest road too, but the race route wins when it is
// within ROUTE_PREFERENCE metres, and it is never placed behind the latest valid on-road pose. Progress is not
// granted by a placement: the course tracker still counts only continuous on-route movement.
// Pure maths shared by the client and the authoritative server: no DOM, three.js, timers or network.
export const ROUTE_PREFERENCE = 40;
const SLIDE_STEP = 4, SLIDE_MAX = 36, CELL = 64, SEARCH_MAX = 3000, CANDIDATES = 40;
// On a circuit the car belongs to the leg it was last on. Megara's straights pass 36 m apart, so a car 20 m off the infield
// side of one leg is nearer the other, 800 m further round: the tow looks for its own leg within this many metres of the car's last valid station first.
export const OWN_LEG_RANGE = 120;
// A street pose must leave the whole car off the route's own surface, gutter and kerb (car half width, gutter, margin).
const STREET_CLEARANCE = 2.5;
const finite = Number.isFinite;
// Right-hand traffic: the lane centre of a two-way road lies this fraction of the half width right of the axis.
const LANE_FRACTION = .5, MIN_LANE_WIDTH = 5;
const forward = yaw => [-Math.sin(yaw), -Math.cos(yaw)];
const oneway = seg => seg.oneway ?? !!seg.road?.oneway;
const faces = (yaw, tx, tz) => { const [fx, fz] = forward(yaw); return fx * tx + fz * tz >= 0 ? 1 : -1; };
// Straight street pieces from raw road polylines `{ p: [x0, z0, x1, z1, ...], w, oneway }`.
export function roadSegments(roads) {
  const segments = [];
  for (const road of roads || []) for (let i = 0; i + 3 < (road.p?.length || 0); i += 2) {
    const [ax, az, bx, bz] = road.p.slice(i, i + 4), dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < .01 || ![ax, az, bx, bz].every(finite)) continue;
    segments.push({ ax, az, bx, bz, dx, dz, L, hw: (road.w || 6) / 2, oneway: !!road.oneway, road });
  }
  return segments;
}
// Spatial hash over street segments: nearest drivable surface without scanning the map.
export class RoadIndex {
  constructor(segments) {
    this.cells = new Map(); this.segments = segments;
    for (const seg of segments) {
      const r = seg.hw;
      for (let x = Math.floor((Math.min(seg.ax, seg.bx) - r) / CELL); x <= Math.floor((Math.max(seg.ax, seg.bx) + r) / CELL); x++)
        for (let z = Math.floor((Math.min(seg.az, seg.bz) - r) / CELL); z <= Math.floor((Math.max(seg.az, seg.bz) + r) / CELL); z++) {
          const key = x + ',' + z; if (!this.cells.has(key)) this.cells.set(key, []); this.cells.get(key).push(seg);
        }
    }
  }
  // Closest streets first: [{ seg, t, edge }], where edge is the distance to the paved edge (0 on the tarmac).
  near(x, z, count = CANDIDATES, radius = 40) {
    if (!finite(x) || !finite(z) || !this.segments.length) return [];
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), seen = new Set(), found = [];
    let best = Infinity;
    for (let r = 0; r * CELL <= SEARCH_MAX; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j += Math.abs(i) === r ? 1 : 2 * r) {
        for (const seg of this.cells.get((cx + i) + ',' + (cz + j)) || []) {
          if (seen.has(seg)) continue; seen.add(seg);
          const t = Math.max(0, Math.min(1, ((x - seg.ax) * seg.dx + (z - seg.az) * seg.dz) / (seg.L * seg.L)));
          const edge = Math.max(0, Math.hypot(x - seg.ax - seg.dx * t, z - seg.az - seg.dz * t) - seg.hw);
          found.push({ seg, t, edge }); best = Math.min(best, edge);
        }
      }
      if (best < Infinity && r * CELL >= best + radius) break;
    }
    return found.sort((a, b) => a.edge - b.edge).slice(0, count);
  }
}
// Lane-centred pose on a street facing the heading's side of its axis (a one-way street faces its legal direction).
export function segmentPose(seg, t, yaw) {
  const tx = seg.dx / seg.L, tz = seg.dz / seg.L, d = oneway(seg) ? 1 : faces(yaw, tx, tz);
  const fx = tx * d, fz = tz * d, lane = !oneway(seg) && seg.hw * 2 >= MIN_LANE_WIDTH ? seg.hw * LANE_FRACTION : 0;
  return { x: seg.ax + seg.dx * t - fz * lane, z: seg.az + seg.dz * t + fx * lane, yaw: Math.atan2(-fx, -fz), d };
}
// The race route as seen by the server, which holds only raw geometry (arrays and a step). The client builds the
// same interface from its Route (road-recovery.js), so both place cars by the same rule.
export function rawRoute(route) {
  const n = route.x.length, step = route.step, length = (n - 1) * step, closed = !!route.closed;
  const lateral = (f, x, z) => (x - f.x) * -f.tz + (z - f.z) * f.tx;
  const medHalf = s => { const f = Math.max(0, Math.min(n - 1.0001, s / step)), i = Math.floor(f), t = f - i, d = route.div; return .12 + 1.2 * ((d[i] || 0) * (1 - t) + (d[i + 1] || 0) * t); };
  return {
    closed, length,
    edge: s => roadFrame(route, s).halfWidth - 2,
    centre: s => roadFrame(route, s),
    // A hint (a station) with a range (metres) searches only that stretch of a circuit and answers on the hint's lap.
    project(x, z, hint = null, range = OWN_LEG_RANGE) {
      let distance = Infinity, s = 0;
      const windowed = closed && finite(hint), reach = Math.ceil(range / step), first = windowed ? Math.floor(hint / step) - reach : 0, count = windowed ? Math.min(n - 1, 2 * reach + 1) : n - 1;
      for (let k = 0; k < count; k++) {
        const i = ((first + k) % (n - 1) + (n - 1)) % (n - 1);
        const dx = route.x[i + 1] - route.x[i], dz = route.z[i + 1] - route.z[i];
        const t = Math.max(0, Math.min(1, ((x - route.x[i]) * dx + (z - route.z[i]) * dz) / (dx * dx + dz * dz || 1)));
        const d = (x - route.x[i] - dx * t) ** 2 + (z - route.z[i] - dz * t) ** 2;
        if (d < distance) { distance = d; s = (i + t) * step; }
      }
      if (windowed) s += Math.round((hint - s) / length) * length;
      return { s, u: lateral(roadFrame(route, s), x, z) };
    },
    pose(s, d) {
      const station = closed ? s : Math.max(0, Math.min(length, s)), centre = roadFrame(route, station);
      const f = courseFrame(route, station, d), mapped = !!f.lanes && f.lanes.some(l => l.x !== centre.x || l.z !== centre.z);
      const u = closed ? 0 : mapped ? lateral(centre, f.x, f.z) : d * (centre.halfWidth - 2 + medHalf(station)) / 2;
      const lane = mapped ? f : centre, x = mapped ? f.x : centre.x - centre.tz * u, z = mapped ? f.z : centre.z + centre.tx * u;
      return { x, y: lane.y, z, s: station, u, yaw: Math.atan2(-centre.tx * d, -centre.tz * d) };
    },
  };
}
const unwrap = (route, s, ref) => route.closed && finite(ref) ? s + Math.round((ref - s) / route.length) * route.length : s;
// course: { s0, dir, floor, ref } in route progress; a tow never lands before `floor` along the route.
//   x, z, yaw: the car now. dir: race direction (retreat side). route: adapter (see rawRoute). index: RoadIndex of the surrounding streets, or null.
//   clear(pose): false when traffic or an obstacle blocks the spot. Returns the pose to place the car at:
//   { kind: 'route' | 'road', x, y?, z, yaw, s, u, d, distance, clear }. A 'road' pose leaves y to the caller.
export function planTow({ x, z, yaw, route, index = null, course = null, dir = 1, clear = null, preference = ROUTE_PREFERENCE }) {
  let here = route.project(x, z);
  // A car standing on another leg's tarmac is on that road; one beside the circuit belongs to its own leg.
  if (course && route.closed && finite(course.ref) && Math.abs(here.u) > route.edge(here.s)) {
    const own = route.project(x, z, course.ref, OWN_LEG_RANGE);
    if (own && Math.abs(own.u) <= route.edge(own.s) + ROUTE_PREFERENCE) here = own;
  }
  const centre = route.centre(here.s);
  const routeEdge = Math.max(0, Math.hypot(x - centre.x, z - centre.z) - route.edge(here.s));
  const streets = index?.near(x, z) || [];
  const ok = pose => !clear || clear(pose);
  // The helper may retreat a few metres on a folded hairpin; it only ever retreats away from the race direction.
  const retreat = course?.dir || dir;
  function onRoute(station) {
    const s0 = course?.s0 || 0, dir = course?.dir || 1, ref = course ? course.ref : here.s;
    let s = unwrap(route, station, ref);
    if (course) s = s0 + dir * Math.max(course.floor, (s - s0) * dir);
    const tangent = route.centre(route.closed ? ((s % route.length) + route.length) % route.length : s);
    const d = course ? dir : faces(yaw, tangent.tx, tangent.tz);
    let first = null;
    for (let k = 0; k <= SLIDE_MAX / SLIDE_STEP * 2; k++) {
      // 0, +4, -4, +8 ... along the road; in a race never before the floor.
      const offset = k % 2 ? Math.ceil(k / 2) * SLIDE_STEP * d : -k / 2 * SLIDE_STEP * d;
      let candidate = s + offset;
      if (course && (candidate - s0) * dir < course.floor - 1e-9) continue;
      if (!route.closed && (candidate < 0 || candidate > route.length)) continue;
      const pose = route.pose(route.closed ? ((candidate % route.length) + route.length) % route.length : candidate, d, retreat, course);
      const placed = { kind: 'route', ...pose, s: route.closed ? candidate : pose.s, d, distance: Math.hypot(pose.x - x, pose.z - z) };
      if (!first) first = { ...placed, clear: false };
      if (ok(placed)) return { ...placed, clear: true };
    }
    return first;
  }
  const preferred = course && routeEdge <= preference;
  const nearest = streets[0];
  if (preferred || !nearest || routeEdge <= nearest.edge) return onRoute(here.s);
  // Streets are short polyline pieces: the next-nearest pieces are the next spots along the same road (or the next road).
  const rejected = [];
  for (const { seg, t } of streets) {
    const pose = segmentPose(seg, t, yaw), q = route.project(pose.x, pose.z);
    // A street running along or into the route's edge is the route there: it is not a separate road.
    if (Math.abs(q.u) < route.edge(q.s) + STREET_CLEARANCE) continue;
    if (rejected.some(r => Math.hypot(r.x - pose.x, r.z - pose.z) < SLIDE_STEP * .75)) continue;
    const placed = { kind: 'road', x: pose.x, z: pose.z, yaw: pose.yaw, s: unwrap(route, q.s, course ? course.ref : here.s), u: q.u, d: pose.d, distance: Math.hypot(pose.x - x, pose.z - z) };
    if (ok(placed)) return { ...placed, clear: true };
    rejected.push(placed);
  }
  return rejected.length ? { ...rejected[0], clear: false } : onRoute(here.s);
}

/** Streamed-world candidates have already passed contacts, lane width, vehicle footprint and obstacle checks. */
export function planWorldTow({pose,course,route,roadCandidates,footprint,obstacles}){
 const ref=course?.lastRoad?.s??pose.s??0,floor=course?Math.max((course.s0||0)+(course.validProgress||0),course.lastRoad?.s??-Infinity):-Infinity;const here=route?.project(pose.x,pose.z,{hint:ref,referenceY:pose.y,maxTravel:OWN_LEG_RANGE}),routeDistance=here?Math.max(0,-(here.leftM||0)-here.u,here.u-(here.rightM||0)):Infinity;
 const candidates=roadCandidates.filter(p=>p.safe!==false&&(!obstacles||!obstacles(p,footprint))).map(p=>{const q=route?.project(p.x,p.z,{hint:ref,referenceY:p.y,layer:p.layer,maxTravel:OWN_LEG_RANGE}),onRoute=!!q&&q.distance<=Math.max(q.leftM||0,q.rightM||0)+1&&p.layer===q.layer&&(route.contactAllowed?route.contactAllowed(q,p):p.surfaceId===q.surfaceId);const f=q&&route.frame(q.s),aligned=f&&(-Math.sin(p.yaw)*f.tx-Math.cos(p.yaw)*f.tz)>=.5,preferred=onRoute&&q.edgeId===p.edgeId&&aligned;return{...p,kind:preferred?'route':'road',s:q?.s??pose.s,u:q?.u??0,distance:Math.hypot(p.x-pose.x,p.z-pose.z),onRoute:preferred,onRouteGeometry:onRoute,routeAligned:!!aligned};}).filter(p=>(!course||!p.onRouteGeometry||p.routeAligned)&&(!p.onRouteGeometry||p.s>=floor-.01));
 const preferred=course?candidates.filter(p=>p.onRoute&&routeDistance<=ROUTE_PREFERENCE&&Math.abs(p.s-ref)<=OWN_LEG_RANGE):[];
 // On two-way streets the graph contains both directed edges. Choose the travel direction
 // within that same carriageway before comparing lane-centre distances. Separate one-way
 // carriageways have no twin, so their legal direction is never reversed.
 const heading=towHeading(pose),alignment=p=>Math.cos(p.yaw-heading);
 const directions=new Map();
 const seenEdges=new Set();
 for(const p of candidates)if(p.roadId&&!seenEdges.has(p.edgeId)){seenEdges.add(p.edgeId);const best=directions.get(p.roadId);if(!best||alignment(p)>alignment(best))directions.set(p.roadId,p);}
 const legal=candidates.filter(p=>!p.roadId||alignment(p)>=-1e-6&&p.edgeId===directions.get(p.roadId).edgeId);
 const pool=preferred.length?preferred:legal;pool.sort((a,b)=>a.distance-b.distance||alignment(b)-alignment(a)||String(a.edgeId).localeCompare(String(b.edgeId)));
 return pool[0]||null;
}
