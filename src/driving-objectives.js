// Shared single-player / coordinator rules. No rendering, storage, dialogue or economy.
export const DRIVING_MODES = Object.freeze({
  taxi: { label: 'TAXI', short: 'TAXI', desc: 'Pick up passengers and take them to their destination. Complete fares in five minutes. Stop below 8 km/h in each marked zone for 1.5 seconds. Any car works; the taxi is recommended.' },
  getaway: { label: 'GETAWAY DRIVER', short: 'GETAWAY', desc: 'A fictional driving mission: reach the bank pickup, then escape to the marked dropoff. Complete missions in five minutes. Stop below 8 km/h in each zone for 1.5 seconds. Any car works. No combat.' },
});
export const isDrivingMode = mode => Object.hasOwn(DRIVING_MODES, typeof mode === 'object' ? mode?.type : mode);
export const OBJECTIVE_RULES = Object.freeze({ duration: 300, radius: 10, heightTolerance: 4, stopKmh: 8, holdSeconds: 1.5, cooldown: 3, maxSampleGap: .75 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function drivingModeDefinition(mode, mapId = 'riviera') {
  if (!isDrivingMode(mode)) throw new Error('Unknown driving mode');
  return { id: `${mode}:${mapId}`, mapId, name: DRIVING_MODES[mode].label, blurb: DRIVING_MODES[mode].desc, type: mode, from: 'start', to: 'finish', rivals: 0, traffic: 1, targets: {}, sessionDuration: 300, rules: { police: false, timeLimit: 300 }, objectiveMode: true };
}
export function resolveDrivingMode(def, ctx) {
  if (!isDrivingMode(def)) throw new Error('Unknown driving mode');
  if (ctx.route.closed) throw new Error('Driving missions need public roads; choose Riviera or Penteli.');
  return { s0: ctx.route.start, s1: ctx.route.finish, dir: 1, len: ctx.route.length || ctx.route.finish - ctx.route.start, fromName: ctx.route.from || 'ROAD', toName: 'OBJECTIVES', sectors: [], reverse: false, timeLimit: def.sessionDuration || 300, targetTimes: null, objectiveMode: true };
}
function roadPoint(route, s, direction) {
  const xs = route.x || route.X, zs = route.z || route.Z, ys = route.y && typeof route.y !== 'function' ? route.y : route.Y;
  if (!xs || !zs || !ys || !(route.step > 0)) throw new Error('Driving objectives require road geometry');
  const i = clamp(Math.round(s / route.step), 2, xs.length - 3), a = i - 2, b = i + 2;
  const dx = xs[b] - xs[a], dz = zs[b] - zs[a], L = Math.hypot(dx, dz) || 1;
  // Inside the outer traffic lane, away from medians/kerbs. Use actual catalogue road width.
  const lanes = route.lanes || route.LN, div = route.div || route.DV, widths = route.width || route.W;
  const edge = widths ? (typeof widths === 'number' ? widths : widths[i]) / 2 : .12 + 1.2 * (div?.[i] || 0) + (lanes?.[i] || 1) * 3.3;
  const u = direction * Math.max(1.3, edge - 1.8);
  return { s: i * route.step, u, x: xs[i] - dz / L * u, y: ys[i], z: zs[i] + dx / L * u, direction };
}
/** Deterministic road-attached itinerary; both transports derive this from the same map data.
 * Bank locations are fictional mission markers, never claims about real banks.
 * The existing connected main road guarantees reachable targets without offroad shortcuts.
 */
export function buildDrivingRoutes(data, mode, { seed = 1, count = 32 } = {}) {
  if (!isDrivingMode(mode)) throw new Error('Unknown driving mode');
  const route = data.route || data;
  if (route.closed) throw new Error('Driving missions need public roads');
  const length = (route.x || route.X)?.length * route.step - route.step;
  const lo = Math.max(20, route.start || 0), hi = Math.min(length - 20, route.finish ?? length);
  if (!(hi - lo > 300)) throw new Error('Road too short for driving missions');
  let rng = (Number(seed) >>> 0) || 1, at = lo + Math.min(120, (hi - lo) * .1), direction = 1;
  const rand = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const trips = [];
  for (let i = 0; i < clamp(Math.floor(count), 1, 128); i++) {
    const distance = Math.min((mode === 'taxi' ? 450 + rand() * 400 : 1400 + rand() * 700), (hi - lo) * .6);
    if (at + direction * (distance + 70) > hi || at + direction * (distance + 70) < lo) direction *= -1;
    const pickupS = clamp(at + direction * 60, lo, hi), dropS = clamp(pickupS + direction * distance, lo, hi);
    const pickup = { ...roadPoint(route, pickupS, direction), label: mode === 'taxi' ? 'PASSENGER PICKUP' : 'BANK PICKUP · FICTIONAL' };
    const dropoff = { ...roadPoint(route, dropS, direction), label: mode === 'taxi' ? 'PASSENGER DESTINATION' : 'ESCAPE DROPOFF' };
    const nameAt = s => [...(data.marks || [])].sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s))[0]?.name || route.from || 'ATHENS ROAD';
    pickup.district = nameAt(pickup.s); dropoff.district = nameAt(dropoff.s);
    trips.push({ id: `${mode}-${i}`, pickup, dropoff, distance: Math.abs(dropoff.s - pickup.s) });
    at = dropS;
  }
  return trips;
}
export function createObjectiveState({ mode, startedAt = 0, duration = 300, roundId = null } = {}) {
  if (!isDrivingMode(mode) || !Number.isFinite(startedAt)) throw new Error('Invalid objective round');
  const seconds = Number.isFinite(duration) ? clamp(duration, 30, 900) : 300;
  return { mode, roundId, startedAt, deadline: startedAt + seconds, phase: 'pickup', routeIndex: 0, completed: 0, holdSeconds: 0, elapsed: 0, remaining: seconds, lastAt: null, wasStopped: false, cooldownUntil: null, tripStartedAt: null, tripTimes: [], done: false };
}
export function objectiveTarget(state, trips) {
  const trip = trips[state.routeIndex % trips.length];
  return state.phase === 'pickup' ? trip?.pickup : state.phase === 'dropoff' ? trip?.dropoff : null;
}
/** `now` is monotonic seconds: simulation time in SP, server receipt time in MP.
 * Call only with coordinator-validated poses. Client completion claims are never an input.
 * Null poses are timer-only ticks: they never add dwell and clear it when the last pose is stale.
 * Identical receipt timestamps add no dwell; only accepted pose samples refresh lastAt.
 */
export function stepObjectives(state, trips, now, pose = null) {
  const events = [];
  if (state.done || !Number.isFinite(now) || now < state.startedAt || state.lastAt !== null && now < state.lastAt || !trips.length) return events;
  state.elapsed = Math.max(0, Math.min(now, state.deadline) - state.startedAt);
  state.remaining = Math.max(0, state.deadline - now);
  if (now >= state.deadline) { state.done = true; state.phase = 'finished'; state.holdSeconds = 0; events.push({ kind: 'timeup', completed: state.completed }); return events; }
  const dt = state.lastAt === null ? 0 : now - state.lastAt;
  if (state.phase === 'cooldown') {
    if (now < state.cooldownUntil) return events;
    state.phase = 'pickup'; state.routeIndex++; state.wasStopped = false;
    events.push({ kind: 'objective-ready', routeIndex: state.routeIndex });
  }
  if (!pose) {
    if (dt > OBJECTIVE_RULES.maxSampleGap) { state.holdSeconds = 0; state.wasStopped = false; }
    return events;
  }
  state.lastAt = now;
  const target = objectiveTarget(state, trips);
  const kmh = pose?.kmh ?? Math.hypot(pose?.vLong, pose?.vLat || 0) * 3.6;
  const stopped = !!target && !!pose && [pose.x, pose.y, pose.z, kmh].every(Number.isFinite) &&
    Math.hypot(pose.x - target.x, pose.z - target.z) <= OBJECTIVE_RULES.radius && Math.abs(pose.y - target.y) <= OBJECTIVE_RULES.heightTolerance && Math.abs(kmh) <= OBJECTIVE_RULES.stopKmh;
  if (!stopped || !state.wasStopped || dt > OBJECTIVE_RULES.maxSampleGap) state.holdSeconds = 0;
  else state.holdSeconds += Math.min(dt, .25);
  state.wasStopped = stopped;
  if (state.holdSeconds + 1e-9 < OBJECTIVE_RULES.holdSeconds) return events;
  state.holdSeconds = 0; state.wasStopped = false;
  if (state.phase === 'pickup') {
    state.phase = 'dropoff'; state.tripStartedAt = now;
    events.push({ kind: 'objective-pickup', mode: state.mode, routeIndex: state.routeIndex });
  } else {
    state.completed++; state.tripTimes.push(now - state.tripStartedAt); state.phase = 'cooldown'; state.cooldownUntil = now + OBJECTIVE_RULES.cooldown;
    events.push({ kind: 'objective-complete', mode: state.mode, routeIndex: state.routeIndex, completed: state.completed, time: state.tripTimes.at(-1) });
  }
  return events;
}
export function objectiveSnapshot(state) {
  return { mode: state.mode, roundId: state.roundId, phase: state.phase, routeIndex: state.routeIndex, completed: state.completed, remaining: state.remaining, elapsed: state.elapsed, holdSeconds: state.holdSeconds, done: state.done, bestTrip: state.tripTimes.length ? Math.min(...state.tripTimes) : null };
}
export function objectiveResult(state) {
  return { ...objectiveSnapshot(state), time: state.elapsed, tripTimes: [...state.tripTimes], objectiveMode: true, medal: null, valid: false, record: null, newBest: false, laps: 0, lapTimes: [], splits: [] };
}
