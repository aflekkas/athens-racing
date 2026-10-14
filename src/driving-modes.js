import { events } from './events.js';
import { buildDrivingRoutes, createObjectiveState, stepObjectives, objectiveResult, objectiveSnapshot, resolveDrivingMode, objectiveTarget, DRIVING_MODES } from './driving-objectives.js';
export { drivingModeDefinition, isDrivingMode, resolveDrivingMode, DRIVING_MODES } from './driving-objectives.js';

// EventRun-compatible adapter. Main owns simulation/pause/reset; no second update loop.
export class DrivingModeRun {
  constructor(def, ctx, { car = null, map = null, routes = null } = {}) {
    this.def = def; this.car = car; this.r = resolveDrivingMode(def, ctx);
    this.routes = routes || buildDrivingRoutes(map?.data || { route: ctx.route, marks: ctx.marks }, def.type, { seed: def.objectiveSeed || 1 });
    this.reset();
  }
  reset() {
    this.state = createObjectiveState({ mode: this.type, duration: this.r.timeLimit });
    this.t = 0; this.started = false; this.done = false; this.result = null; this.best = {};
    this.splits = []; this.lapTimes = []; this.maxProg = 0; this.cpIdx = 0;
  }
  get id() { return this.def.id; }
  get type() { return this.def.type; }
  get lap() { return 0; }
  get lapTime() { return 0; }
  get objective() { return objectiveSnapshot(this.state); }
  get target() { return objectiveTarget(this.state, this.routes); }
  progress() { return this.state.completed; }
  frac() { return this.state.elapsed / (this.r.timeLimit || 300); }
  timeLeft() { return this.state.remaining; }
  start(payload = {}) { this.started = true; events.emit('start', { eventId: this.id, type: this.type, car: this.car, def: this.def, run: this, ...payload }); }
  update(dt, pose) {
    if (!this.started || this.done) return [];
    // Penalties and route crossings do not alter a driving session's clock.
    this.t += Math.max(0, Math.min(.25, Number.isFinite(dt) ? dt : 0));
    const out = stepObjectives(this.state, this.routes, this.t, pose);
    for (const e of out) if (e.kind.startsWith('objective-')) events.emit(e.kind, { eventId: this.id, ...e, run: this });
    return out;
  }
  finish(extra = {}) {
    if (this.done) return this.result;
    this.done = true;
    this.result = { eventId: this.id, mapId: this.def.mapId, type: this.type, car: this.car, ...extra, ...objectiveResult(this.state), position: null, field: extra.field || 1 };
    // Session counts stay out of race records and leaderboard submissions.
    events.emit('finish', this.result); return this.result;
  }
  abort(reason = 'restart') { if (this.done) return; this.done = true; if (this.started) events.emit('abort', { eventId: this.id, type: this.type, reason }); }
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const clock = seconds => { const total = Math.ceil(Math.max(0, seconds)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
/** Also accepts a server snapshot + manifest for MP and selected spectator targets. */
export function drivingModeHud(objective, trips, pose = {}) {
  if (!objective) return '';
  const target = objectiveTarget(objective, trips), mode = objective.mode, completed = Number(objective.completed) || 0;
  const action = objective.phase === 'pickup' ? (mode === 'taxi' ? 'PICK UP PASSENGER' : 'REACH BANK PICKUP') : objective.phase === 'dropoff' ? (mode === 'taxi' ? 'TAKE PASSENGER TO DESTINATION' : 'ESCAPE TO DROPOFF') : objective.phase === 'cooldown' ? 'NEXT JOB IN A MOMENT' : 'SESSION COMPLETE';
  const distance = target && Number.isFinite(pose.x) && Number.isFinite(pose.z) ? Math.hypot(target.x - pose.x, target.z - pose.z) : null;
  const nearby = distance !== null && distance <= 10;
  const detail = nearby ? `STOP BELOW 8 KM/H · ${Math.min(1.5, objective.holdSeconds || 0).toFixed(1)} / 1.5 S` : target ? `${esc(target.district)}${distance !== null ? ` · ${distance >= 1000 ? (distance / 1000).toFixed(1) + ' KM' : Math.round(distance) + ' M'}` : ''} · FOLLOW THE ROAD` : '';
  return `<div class="e-k">${DRIVING_MODES[mode]?.label || 'DRIVING'} · ${completed} ${mode === 'taxi' ? 'FARES' : 'MISSIONS'} · ${clock(objective.remaining)}</div><b style="font-size:14px">${action}</b><div style="font-size:11px;margin-top:5px">${detail}</div>`;
}
export function drivingModeResults(run, res, fmtTime) {
  const noun = run.type === 'taxi' ? 'FARES' : 'MISSIONS';
  return { title: `${res.completed || 0} ${noun} COMPLETED`, sub: res.wrecked ? 'Session ended after a heavy impact.' : res.busted ? 'Session ended when caught.' : 'Session complete. Replay to start a fresh itinerary.', kick: DRIVING_MODES[run.type].label,
    rows: [['COMPLETED ' + noun, res.completed || 0], ['SESSION TIME', fmtTime(res.time || 0)], ['FASTEST TRIP', res.bestTrip == null ? '—' : fmtTime(res.bestTrip)]], splits: null, field: null, win: !res.wrecked && !res.busted && res.completed > 0, next: null };
}
