// Multiplayer session/host lifecycle + shared mode settings.
//
// Pure helpers owned by the MP session/modes owner. server/core.mjs calls
// these from its create/options/ready/start/rematch/restart/to-lobby/
// transfer handlers; nothing here touches sockets, accounts or friends.
//
// A lobby carries:
//   generation  integer bumped on every new race or lobby reset. Clients
//               echo it on state/recover packets; handlers ignore packets
//               whose generation is present but stale (see isStaleGeneration).
//   config      shared mode setup, same semantics as src/race-setup.js:
//               { rivals, traffic, time, weather, reverse, police,
//                 sessionDuration, enforcement } plus the optional police setup
//               policeLevel ('relaxed' | 'normal' | 'tough') and busted (bool);
//               absent means NORMAL and can be busted.
//   mode        derived from the event (its type string), never set directly.
import { TIMES, WEATHERS, MAX_RIVALS, isPoliceLevel } from '../src/race-setup.js';
import { canReverse } from '../src/map-catalog.js';
import { isDrivingMode, createObjectiveState, stepObjectives, objectiveSnapshot, objectiveResult } from '../src/driving-objectives.js';

export const MP_RIVALS_MIN = 0;
export const MP_RIVALS_MAX = MAX_RIVALS;
export const MP_RIVALS_DEFAULT = 2;
export const MP_TRAFFIC_MIN = 0;
export const MP_TRAFFIC_MAX = 2;
export const MP_SESSION_DURATION_DEFAULT = 300;
export const MP_SESSION_DURATION_MIN = 30;
export const MP_SESSION_DURATION_MAX = 900;
const OPAQUE_MAX_BYTES = 2048;
const OPAQUE_MAX_KEYS = 32;

// Event defaults come from the map definition (server/map-definitions.mjs
// keeps trafficLevel/conditions/police next to the resolved route).
export function defaultConfig(def = {}) {
  return {
    rivals: MP_RIVALS_DEFAULT,
    traffic: typeof def.trafficLevel === 'number' ? def.trafficLevel : (def.traffic ? 1 : 0),
    time: def.conditions?.time || 'afternoon',
    weather: def.conditions?.weather || 'clear',
    reverse: false,
    police: def.police === true,
    sessionDuration: MP_SESSION_DURATION_DEFAULT,
    enforcement: null,
  };
}

const isTime = v => TIMES.some(([id]) => id === v);
const isWeather = v => WEATHERS.some(([id]) => id === v);

// Unknown keys are ignored (forward compatible with taxi/getaway schema).
// Returns { config } with only the supplied valid keys, or { error }.
export function sanitizeConfig(input, def = {}) {
  if (input === undefined) return { config: null };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid lobby setup.' };
  void def;
  const out = {};
  if (input.rivals !== undefined) {
    const n = Math.round(Number(input.rivals));
    if (!Number.isFinite(n) || n < MP_RIVALS_MIN || n > MP_RIVALS_MAX) return { error: `AI rivals must be 0-${MP_RIVALS_MAX}.` };
    out.rivals = n;
  }
  if (input.traffic !== undefined) {
    const t = Number(input.traffic);
    if (!Number.isFinite(t) || t < MP_TRAFFIC_MIN || t > MP_TRAFFIC_MAX) return { error: 'Traffic must be 0-2.' };
    out.traffic = t;
  }
  if (input.time !== undefined) {
    if (!isTime(input.time)) return { error: 'Unknown time of day.' };
    out.time = input.time;
  }
  if (input.weather !== undefined) {
    if (!isWeather(input.weather)) return { error: 'Unknown weather.' };
    out.weather = input.weather;
  }
  if (input.reverse !== undefined) out.reverse = input.reverse === true && canReverse(def?.mapId);
  if (input.police !== undefined) out.police = input.police === true;
  if (input.policeLevel !== undefined) {
    if (!isPoliceLevel(input.policeLevel)) return { error: 'Unknown police level.' };
    out.policeLevel = input.policeLevel;
  }
  if (input.busted !== undefined) out.busted = input.busted !== false;
  if (input.sessionDuration !== undefined) {
    const d = Math.round(Number(input.sessionDuration));
    if (!Number.isFinite(d) || d < MP_SESSION_DURATION_MIN || d > MP_SESSION_DURATION_MAX) return { error: 'Session length must be 30-900 seconds.' };
    out.sessionDuration = d;
  }
  if (input.enforcement !== undefined) {
    const opaque = sanitizeOpaque(input.enforcement);
    if (opaque === undefined) return { error: 'Invalid enforcement rules.' };
    out.enforcement = opaque;
  }
  return { config: out };
}

// Bounded pass-through for the future enforcement owner: plain JSON only,
// small and shallow. Null clears it.
export function sanitizeOpaque(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length > OPAQUE_MAX_KEYS) return undefined;
  const clean = {};
  for (const k of keys) {
    if (k.length > 64) return undefined;
    const v = value[k];
    if (v === null || typeof v === 'boolean') clean[k] = v;
    else if (typeof v === 'number') { if (!Number.isFinite(v)) return undefined; clean[k] = v; }
    else if (typeof v === 'string') { if (v.length > 280) return undefined; clean[k] = v; }
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = Object.keys(v);
      if (inner.length > OPAQUE_MAX_KEYS) return undefined;
      const sub = {};
      for (const k2 of inner) {
        const v2 = v[k2];
        if (v2 === null || typeof v2 === 'boolean') sub[k2] = v2;
        else if (typeof v2 === 'number') { if (!Number.isFinite(v2)) return undefined; sub[k2] = v2; }
        else if (typeof v2 === 'string') { if (v2.length > 280) return undefined; sub[k2] = v2; }
        else return undefined;
      }
      clean[k] = sub;
    }
    else return undefined;
  }
  let text;
  try { text = JSON.stringify(clean); } catch { return undefined; }
  if (text.length > OPAQUE_MAX_BYTES) return undefined;
  return JSON.parse(text);
}

// The race-facing geometry: a reversed lobby runs the same route backwards.
// Unreversed input returns the definition untouched.
export function effectiveEvent(def, config) {
  // One-way-only courses (Psychiko) never run backwards, whatever a stale or hand-made config says.
  if (!def || !config?.reverse || !canReverse(def.mapId)) return def;
  const dir = -def.dir, s0 = def.closed ? def.s0 : def.s1, s1 = def.closed ? s0 + dir * def.len : def.s0;
  const sectors = def.closed ? (def.sectors || []).map(cp => ({ ...cp, s: s0 + dir * cp.d })) :
    [...(def.sectors || []).filter(cp => cp.d < def.len).map(cp => ({ ...cp, d: def.len - cp.d }))
      .sort((a, b) => a.d - b.d).map(cp => ({ ...cp, s: s0 + dir * cp.d })), { id: 'finish', name: def.fromName || 'FINISH', s: s1, d: def.len }];
  return { ...def, s0, s1, dir, reverse: dir < 0, sectors, routeKey: `${s0}>${s1}` };
}

// Keys that offer a different race: everyone must re-ready. Time, weather,
// rivals, session length and enforcement never invalidate readiness.
const RACE_CHANGING_KEYS = ['traffic', 'reverse', 'police', 'policeLevel', 'busted'];
const KEY_DEFAULTS = { policeLevel: 'normal', busted: true };
export function configInvalidates(prev = {}, next = {}) {
  return RACE_CHANGING_KEYS.some(k => (prev[k] ?? KEY_DEFAULTS[k] ?? null) !== (next[k] ?? KEY_DEFAULTS[k] ?? null));
}

export function nextGeneration(lobby) {
  lobby.generation = (lobby.generation | 0) + 1;
  return lobby.generation;
}

// Stale-message gate shared with the recovery owner: a packet carrying a
// generation that is not the lobby's current one belongs to an older race.
export function isStaleGeneration(lobby, message) {
  return message?.generation !== undefined && message.generation !== (lobby.generation || 0);
}

const clearRun = (lobby) => {
  for (const p of lobby.players.values()) { p.state = null; p.stateAt = null; p.finish = null; p.dnf = false; p.course = null; }
};

// Host cancels an active or finished race back to a waiting lobby.
// Same room code, same config; everyone re-readies.
export function cancelToWaiting(lobby) {
  lobby.status = 'waiting'; lobby.startAt = null; lobby.raceId = null; lobby.racers = null;
  lobby.objectives = null; lobby.objectiveTrips = null;
  for (const p of lobby.players.values()) { p.ready = false; }
  clearRun(lobby);
  return nextGeneration(lobby);
}

// Host restarts an active race immediately. Same room code and config;
// ready votes stand (they were ready for this exact setup).
export function restartRace(lobby, raceId, startAt) {
  lobby.status = 'countdown'; lobby.startAt = startAt; lobby.raceId = raceId;
  clearRun(lobby);
  lobby.racers = new Map([...lobby.players.values()].map(p => [p.id, { id: p.id, name: p.name, car: p.car, finish: null, dnf: false, disconnected: false }]));
  return nextGeneration(lobby);
}

// Bounded extension point for engine/telemetry fields (negotiated with the
// engine owner; NOT wired into the state path yet). Core integration is one
// line in the state handler after the damage check:
//   const badExtra = validateTelemetryExtra(s); if (badExtra) return;
const telemetryFields = new Map();
export function registerTelemetryField(name, { min, max } = {}) {
  if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(name)) return false;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return false;
  if (!telemetryFields.has(name) && telemetryFields.size >= 16) return false;
  telemetryFields.set(name, { min, max });
  return true;
}
export function validateTelemetryExtra(state) {
  for (const [name, { min, max }] of telemetryFields) {
    const v = state?.[name];
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < min || v > max) return `Invalid ${name}.`;
  }
  return null;
}
export function clearTelemetryFields() { telemetryFields.clear(); }

// ---- Objective modes (taxi/getaway, owned with the modes owner) ----
// An objective mode is any driving mode from src/driving-objectives.js.
// Such races never take the s1-crossing finish path and never submit to
// the leaderboard; the reducer below owns duration, completions and results.
export const isObjectiveMode = (type) => isDrivingMode(type);

// Both the Node server and Worker reject removed modes, including legacy catalogues.
export function assertModeAllowed(eventDef, routeClosed) {
  void routeClosed;
  if (!['sprint', 'free'].includes(eventDef?.type)) return 'Mode unavailable. Choose Quick Race or Free Roam.';
  return null;
}

// (Re)creates per-driver reducer state for a race. startedAtMs is the
// server's race start in ms; the reducer works in seconds on receipt time.
export function startObjectiveRound(lobby, { mode, raceId, startAtMs }) {
  // Built locally first: a throw must never leave an empty map behind,
  // which would read as "every round done" and end the race instantly.
  const rounds = new Map();
  for (const p of lobby.players.values()) {
    rounds.set(p.id, createObjectiveState({
      mode, startedAt: startAtMs / 1000,
      duration: lobby.config?.sessionDuration ?? MP_SESSION_DURATION_DEFAULT,
      roundId: raceId,
    }));
  }
  lobby.objectives = rounds;
  return rounds;
}

// Steps one driver's reducer with a coordinator-validated pose.
// Pose carries x/y/z plus vLong/vLat (m/s); kmh is derived.
export function stepPlayerObjective(lobby, playerId, nowMs, pose) {
  const st = lobby.objectives?.get(playerId);
  if (!st) return [];
  return stepObjectives(st, lobby.objectiveTrips || [], nowMs / 1000, pose);
}

export function snapshotPlayerObjective(lobby, playerId) {
  const st = lobby.objectives?.get(playerId);
  if (!st) return null;
  return objectiveSnapshot(st);
}

export function resultPlayerObjective(lobby, playerId) {
  const st = lobby.objectives?.get(playerId);
  if (!st) return null;
  return objectiveResult(st);
}

export function objectiveRoundDone(lobby, playerId) {
  return lobby.objectives?.get(playerId)?.done === true;
}

// Drops inherited pickup dwell on disconnect/recovery so a new generation
// never completes from a previous round's held stop.
export function clearObjectiveHold(lobby, playerId) {
  const st = lobby.objectives?.get(playerId);
  if (!st) return;
  st.holdSeconds = 0; st.wasStopped = false;
}

// Objective deadlines outlive the default race cap: the effective limit is
// the longer of the two so a 15-minute mission is never cut at 10 minutes.
export function raceLimitFor(lobby, baseMs) {
  if (!lobby.objectives) return baseMs;
  return Math.max(baseMs, (lobby.config?.sessionDuration ?? MP_SESSION_DURATION_DEFAULT) * 1000 + 5000);
}

// ---- Validated state extras (relay, never rate) ----
// Optional telemetry/appearance fields ride the existing state packets at
// the existing 10 Hz cadence. Validation strips bad fields; it never
// rejects the packet, so a malformed extra cannot kill position updates.
const finiteIn = (v, min, max) => Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const bool = (v) => v === true ? true : v === false ? false : undefined;

const ENGINE_NUMERICS = { impactMechanical: [0, 1], maxImpactEbs: [0, 100], engHealth: [0, 1], engineDamage: [0, 1], coolantTemp: [90, 145], mechanicalOverrevRpm: [0, 20000] };
const ENGINE_FAILURE_REASONS = new Set(['overheating', 'impact', 'drivetrain', 'mechanical_overrev']);

function pickEngine(s) {
  const out = {};
  for (const [k, [min, max]] of Object.entries(ENGINE_NUMERICS)) {
    if (s[k] === undefined) continue;
    const v = finiteIn(Number(s[k]), min, max);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ['engineStalled', 'drivetrainBroken']) {
    if (s[k] === undefined) continue;
    const v = bool(s[k]);
    if (v !== undefined) out[k] = v;
  }
  if (s.engineFailureReason !== undefined && s.engineFailureReason !== null) {
    if (ENGINE_FAILURE_REASONS.has(s.engineFailureReason)) out.engineFailureReason = s.engineFailureReason;
  } else if (s.engineFailureReason === null) out.engineFailureReason = null;
  return out;
}

function pickAxle(a) {
  if (!a || typeof a !== 'object') return undefined;
  const out = {};
  if (a.utilization !== undefined) { const v = finiteIn(Number(a.utilization), 0, 1); if (v === undefined) return undefined; out.utilization = v; }
  if (a.slipDemand !== undefined) { const v = finiteIn(Number(a.slipDemand), 0, 10); if (v === undefined) return undefined; out.slipDemand = v; }
  for (const k of ['saturated', 'sliding', 'contact']) {
    if (a[k] === undefined) continue;
    const v = bool(a[k]);
    if (v === undefined) return undefined;
    out[k] = v;
  }
  return out;
}

export function pickTyreTelemetry(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const front = pickAxle(v.front), rear = pickAxle(v.rear);
  if (front === undefined || rear === undefined) return undefined;
  const out = { front, rear };
  if (v.understeer !== undefined) {
    const u = bool(v.understeer);
    if (u === undefined) return undefined;
    out.understeer = u;
  }
  return out;
}

// Photo ownership lives in server/appearance-state.mjs (the customization
// owner calls stripUnownedPhotos from the state path; this module never
// touches decals). One consolidated call for the core state path: returns extras safe to
// persist on c.state (numeric registry fields + engine/tyre objects).
export function validateStateExtras(s, ctx = {}) {
  const extras = {};
  if(Number.isSafeInteger(s?.exhaustSerial)&&s.exhaustSerial>=0&&s.exhaustSerial<=2147483647)extras.exhaustSerial=s.exhaustSerial;
  if(Number.isInteger(s?.exhaustKind)&&s.exhaustKind>=0&&s.exhaustKind<=3)extras.exhaustKind=s.exhaustKind;
  if(typeof s?.exhaustEnabled==='boolean')extras.exhaustEnabled=s.exhaustEnabled;
  if (typeof s?.braking === 'boolean') extras.braking = s.braking;
  // The driver's own police pursuit (src/police.js encodePursuit), for the world authority's shared units.
  if (Number.isSafeInteger(s?.pursuit) && s.pursuit >= 0 && s.pursuit <= 2047) extras.pursuit = s.pursuit;
  for (const [name, { min, max }] of telemetryFields) {
    const v = s?.[name];
    if (v === undefined) continue;
    if (Number.isFinite(v) && v >= min && v <= max) extras[name] = v;
  }
  for (const [key, limit] of [['bodyHeave', 3], ['bodyPitch', 6.3], ['bodyRoll', 6.3]]) if (Number.isFinite(s?.[key]) && Math.abs(s[key]) <= limit) extras[key] = s[key];
  for (const key of ['vy', 'angularX', 'angularY', 'angularZ'])
    if (Number.isFinite(s?.[key]) && Math.abs(s[key]) <= (key === 'vy' ? 100 : 40)) extras[key] = s[key];
  if (typeof s?.burnout === 'boolean') extras.burnout = s.burnout;
  for (const key of ['drift', 'lockup', 'wheelspin']) if (Number.isFinite(s?.[key]) && s[key] >= 0 && s[key] <= 3) extras[key] = s[key];
  for (const key of ['air', 'bodyDynamic']) if (typeof s?.[key] === 'boolean') extras[key] = s[key];
  if (Array.isArray(s?.bodyQ) && s.bodyQ.length === 4 && s.bodyQ.every(Number.isFinite)) {
    const length = Math.hypot(...s.bodyQ);
    if (Math.abs(length - 1) < .01) extras.bodyQ = s.bodyQ.map(x => x / length);
  }
  Object.assign(extras, pickEngine(s || {}));
  const tyres = pickTyreTelemetry(s?.tyreTelemetry);
  if (tyres !== undefined) extras.tyreTelemetry = tyres;
  void ctx;
  return extras;
}
