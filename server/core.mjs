import { sameRouteIdentity } from '../src/route-network.js';
import { captureRecordMeta, onlineLeaderboardResult } from './leaderboard-online.mjs';
import { canSaveResults } from './smoke-session.mjs';
import { createSharedWorldRelay } from './mp-shared-world.mjs';
import { worldOwner } from '../src/shared-world-protocol.js';
import { arenaEnvironment } from './mp-environment.mjs';
import { raceStandings } from './mp-standings.mjs';
import { formatPlate } from '../src/plate.js';
import { normalizeDriverName } from '../src/driver-name.js';
import { isTerminalImpact } from '../src/damage-math.js';
import { MULTIPLAYER_PROTOCOL, UPDATE_CLOSE_CODE, protocolVersion } from '../src/multiplayer-protocol.js';
import { buildCourse, observeCourse, courseComplete } from '../src/course.js';
import { defaultConfig, sanitizeConfig, effectiveEvent, configInvalidates, nextGeneration, cancelToWaiting, restartRace, startObjectiveRound, stepPlayerObjective, snapshotPlayerObjective, resultPlayerObjective, objectiveRoundDone, clearObjectiveHold, raceLimitFor, isObjectiveMode, assertModeAllowed, validateStateExtras } from './mp-lifecycle.mjs';
import { isMapEnabled } from '../src/enabled-maps.js';
import { canReverse } from '../src/map-catalog.js';
import { carCategory, CAR_CLASSES } from '../src/car-catalog.js';
import { canonicalCarId, DEFAULT_CAR_ID } from '../src/car-ids.js';
import { classifyCar, PI_CLASSES } from '../src/car-performance.js';
import { defaultCarRules, sanitizeCarRules, carEligibility, eligibleIds, balanceTable } from '../src/mp-car-rules.js';
import { normalizeDriverAppearance } from '../src/driver-appearance-data.js';
import { rememberRecoveryRoad, requestRecovery, recoveryStateAllowed } from './race-recovery.mjs';
// Shared lobby/race protocol. Transports own sockets, persistence and wake-up scheduling.
const routePacketMatches = (map, message) => !map?.routeIdentity || message.mapId === map.id && sameRouteIdentity(message.routeIdentity, map.routeIdentity);
const clean = (v, fallback, n = 28) => typeof v === 'string' ? v.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, n) || fallback : fallback;
const send = (ws, data) => { if (ws?.readyState === 1 && (ws.bufferedAmount || 0) < 65536) { try { ws.send(typeof data === 'string' ? data : JSON.stringify(data)); } catch {} } };
const randomUUID = () => crypto.randomUUID();
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
export function createGameCore({ maps, cars: CARS, carSpecs = null, nitrousCars = new Set(), leaderboard, countdownMs = 4000, raceLimitMs = 600000, reconnectGraceMs = 90000, idleLobbyMs = 1800000 }) {
  // Pace data for the car rulesets: id -> { power, mass, torque, drive, vmax,
  // grip, brake, zeroTo100, name, short } (parsed from the catalogue text by
  // server/car-capabilities.mjs and shipped to the worker in catalogue.json).
  // Without specs only open rulesets validate; every other preset is rejected.
  const specOf = (id) => carSpecs instanceof Map ? (carSpecs.get(id) || null) : (carSpecs?.[id] || null);
  const haveSpecs = carSpecs instanceof Map ? carSpecs.size > 0 : !!carSpecs && Object.keys(carSpecs).length > 0;
  const paceCache = new Map();
  const paceEntry = (id) => {
    if (!paceCache.has(id)) {
      const s = specOf(id);
      paceCache.set(id, s ? (() => { const { pi, class: cls } = classifyCar({ id, ...s }); return { id, ...s, category: carCategory({ id }), pi, class: cls }; })()
        : { id, name: id, short: id, pi: null, class: null, category: null });
    }
    return paceCache.get(id);
  };
  const rulesCtx = () => ({ classes: [...PI_CLASSES], categories: [...CAR_CLASSES], knownIds: [...CARS], haveSpecs });
  // The ruleset plus the Advanced per-car override merge to one active rule:
  // each narrows, so two lists intersect and a single list (or none) applies.
  const activeRules = (rules, advanced) => {
    const r = { ...(rules || defaultCarRules()) };
    const a = advanced || null, b = r.allowedCars || null;
    r.allowedCars = a && b ? a.filter((id) => b.includes(id)) : (a || b);
    return r;
  };
  const lobbyRules = (l) => activeRules(l.carRules, l.advancedCars);
  // Effective allow-list in catalogue order so first-eligible coercion is deterministic.
  const effectiveCars = (rules, advanced) => eligibleIds([...CARS].map(paceEntry), activeRules(rules, advanced));
  // Authoritative Balance of Performance for the entered cars; synced to every
  // client via the lobby publish so each driver sees the same effect line.
  const refreshBalance = (l) => {
    if (!l.carRules?.balanced || !haveSpecs) {
      l.balance = null;
      for (const p of l.players.values()) p.balance = null;
      return;
    }
    const table = balanceTable([...l.players.values()].map((p) => paceEntry(p.car)));
    l.balance = table;
    for (const p of l.players.values()) p.balance = table.cars[p.car] || null;
  };
  const sharedWorld = createSharedWorldRelay(send, { period: l => maps.get(l.mapId)?.closed ? maps.get(l.mapId).track.finish - maps.get(l.mapId).track.start : 0 });
  const handlers = new Map();
  // Every accepted car sample since the last snapshot, so a receiver interpolates the sender's real 20 Hz data instead of only
  // the newest sample. Motion fields only (cosmetics ride on the newest `state`); keyed by race so an old race can never leak in.
  const trails = new WeakMap();
  const TRAIL_KEYS = ['layer', 'surfaceId', 'edgeId', 'x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear', 'vy', 'bodyDynamic', 'air', 'bodyQ', 'angularX', 'angularY', 'angularZ', 'bodyHeave', 'bodyPitch', 'bodyRoll', 'motionEpoch', 'sampleTime', 'sampleAge'];
  const rememberSample = (c, raceId, state, now) => {
    let trail = trails.get(c); if (trail?.raceId !== raceId) trails.set(c, trail = { raceId, list: [] });
    trail.list.push({ ...Object.fromEntries(TRAIL_KEYS.filter(k => state[k] !== undefined).map(k => [k, state[k]])), stateAt: now });
    if (trail.list.length > 6) trail.list.shift();
  };
  const takeTrail = (c, raceId) => { const trail = trails.get(c); trails.delete(c); return trail?.raceId === raceId && trail.list.length > 1 ? trail.list.slice(0, -1) : null; };
  const defaultMapId = maps.onlineMapIds?.values().next().value || 'riviera';
  const track = maps.get(defaultMapId).track;
  const mapEnabled = id => maps.onlineMapIds ? maps.onlineMapIds.has(id) : maps.get(id)?.routeIdentity ? maps.routeConfig?.online === true : isMapEnabled(id);
  const mapSupportsCar = (mapId, car) => { const map = maps.get(mapId); if (!map?.routeIdentity) return true; try { map.gridPose(0, car); const spec = specOf(car); return Number.isFinite(spec?.width) && Number.isFinite(spec?.length) && map.supportsCar?.(car) !== false; } catch { return false; } };
  const eligibleForMap = (mapId, ids) => ids.filter(car => mapSupportsCar(mapId, car));
  const lobbies = new Map(), clients = new Set(), sessions = new Map();
  const lobbyEvent = l => maps.get(l.mapId).definitions.get(l.eventId);
  // Removed modes stay unavailable even when a legacy catalogue is supplied.
  const onlineEvent = (id, mapId = defaultMapId) => ['sprint', 'free'].includes(maps.get(mapId)?.definitions.get(id)?.type);
  const options = (mapId = defaultMapId) => [...maps.get(mapId).definitions.values()].filter(e => onlineEvent(e.id, mapId)).map(({ id, name, type, s0, s1, dir, len, routeKey }) => ({ id, name, type, mapId, s0, s1, dir, len, routeKey }));
  const catalogue = () => [...maps].filter(([id]) => mapEnabled(id)).map(([id, m]) => ({ id, name: m.name, track: m.track, events: options(id), trips: m.trips || { taxi: null, getaway: null } }));
  const uniqueName = (l, name, id) => {
    const used = new Set([...l.players.values()].filter(p => p.id !== id).map(p => p.name.toUpperCase()));
    let result = name, n = 2; while (used.has(result.toUpperCase())) result = `${name.slice(0, 16 - String(n).length - 1)}#${n++}`;
    return result;
  };
  const publicLobby = (l, manifest = true) => {
    const def = lobbyEvent(l), event = { ...effectiveEvent(def, l.config), police: l.config?.police === true, traffic: l.config?.traffic || 0, conditions: { time: l.config?.time || 'afternoon', weather: l.config?.weather || 'clear' } };
    const trips = manifest && isObjectiveMode(event?.type) ? (maps.get(l.mapId).trips || {})[event.type] || null : null;
    return { standings: raceStandings(l, event), world: arenaEnvironment(l, event, Date.now()), code: l.code, name: l.name, host: l.host, status: l.status, capacity: 8, players: [...l.players.values()].map(p => { const pace = haveSpecs ? paceEntry(p.car) : null; return { id: p.id, name: p.name, car: p.car, paint: p.paint || null, driver: p.driver || null, gridSlot: p.gridSlot, ...(maps.get(l.mapId).routeIdentity ? { gridPose: maps.get(l.mapId).gridPose(p.gridSlot, p.car) } : {}), loaded: p.loaded === true, ready: p.ready, finish: p.finish, dnf: p.dnf, connected: p.connected, plate: p.plate || null, pi: pace?.pi ?? null, class: pace?.class ?? null, balance: p.balance || null, objective: snapshotPlayerObjective(l, p.id) }; }), blockedPlayers: manifest ? (l.blocks || []).filter(b => b.until > Date.now()).map(({ id, name, until }) => ({ id, name, until })) : undefined, eventId: l.eventId, traffic: (l.config?.traffic || 0) > 0, trafficPolicy: 'shared-authority', worldOwner: worldOwner(l), event: trips ? { ...event, objectiveRoutes: trips } : event, mode: event?.type || 'sprint', config: { ...(l.config || {}) }, generation: l.generation || 0, results: l.status === 'results' ? [...l.racers.values()] : null, startAt: l.startAt, raceId: l.raceId, mapId: l.mapId, routeIdentity: l.routeIdentity || null, track: maps.get(l.mapId).track, allowedCars: [...(l.allowedCars || CARS)], carRules: { ...(l.carRules || defaultCarRules()) }, balance: l.balance || null };
  };
  // Smoke-hosted lobbies are deployment tests, not public races.
  const discover = () => ({ type: 'discovery', lobbies: [...lobbies.values()].filter(l => !l.private && mapEnabled(l.mapId) && !l.players.get(l.host)?.identity?.smoke).map(l => publicLobby(l, false)) });
  const publish = (l) => { l.touched = Date.now(); const lobby = publicLobby(l); for (const p of l.players.values()) send(p.ws, { type: 'lobby', lobby }); for (const c of clients) if (!c.lobby) send(c.ws, discover()); };
  const results = (l) => {
    if (l.status === 'results') return;
    l.status = 'results';
    // Objective drivers are never DNF merely for finish===null: only drivers
    // whose round is not done get DNF. Objective results sort by completed
    // desc, then best trip, then elapsed; they never touch race leaderboards.
    for (const p of l.players.values()) if (p.finish === null && !p.dnf && !objectiveRoundDone(l, p.id)) p.dnf = true;
    for (const p of l.racers.values()) if (p.finish === null && !p.dnf && !objectiveRoundDone(l, p.id)) p.dnf = true;
    for (const r of l.racers.values()) { const o = resultPlayerObjective(l, r.id); if (o) r.objective = o; }
    if (l.objectives) l.racers = new Map([...l.racers.values()].sort((a, b) => ((b.objective?.completed || 0) - (a.objective?.completed || 0)) || ((a.objective?.bestTrip ?? Infinity) - (b.objective?.bestTrip ?? Infinity)) || ((a.objective?.elapsed ?? Infinity) - (b.objective?.elapsed ?? Infinity))).map((r) => [r.id, r]));
    publish(l);
  };
  // Host-submitted car lists must be a non-empty deduped subset of the
  // Host-submitted car lists must be a non-empty deduped subset of the
  // server catalogue; anything else is rejected, never coerced silently.
  const fallbackCar = () => CARS.has(DEFAULT_CAR_ID) ? DEFAULT_CAR_ID : [...CARS][0];
  const sanitizeCarList = (ids) => {
    if (!Array.isArray(ids)) return null;
    const list = [...new Set(ids.map(id => canonicalCarId(id, CARS)).filter(id => CARS.has(id)))].slice(0, 64);
    return list.length ? list : null;
  };
  const leave = (c) => {
    const l = c.lobby; if (!l) return;
    const racer = l.racers?.get(c.id); if (racer) { racer.disconnected = true; if (racer.finish === null && !racer.dnf) racer.dnf = true; }
    l.players.delete(c.id); c.lobby = null; c.ready = false; c.state = null; c.stateAt = null; clearObjectiveHold(l, c.id); l.objectives?.delete(c.id);
    if (!l.players.size) lobbies.delete(l.code);
    else {
      if (l.status === 'countdown' && [...l.players.values()].filter(p => p.connected).length < 2) { l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null; l.objectives = null; l.objectiveTrips = null; for (const p of l.players.values()) p.ready = false; }
      if (l.host === c.id) l.host = [...l.players.values()].find(p => p.connected)?.id || l.players.keys().next().value; if (['countdown', 'race'].includes(l.status) && [...l.players.values()].every(p => p.finish !== null || p.dnf)) results(l); refreshBalance(l); publish(l); }
    for (const other of clients) if (!other.lobby) send(other.ws, discover());

  };
  const reload = ws => {
    send(ws, { type: 'reload', reason: 'update' });
    try { ws.close(UPDATE_CLOSE_CODE, 'Game updated, reload'); } catch {}
  };
  const connect = (ws, ip, connection = {}) => {
    const protocol = protocolVersion(connection.protocol);
    if (protocol !== MULTIPLAYER_PROTOCOL) { reload(ws); return false; }
    if ([...clients].filter(c => c.ip === ip).length >= 24) { ws.close(1013, 'Too many connections'); return; }
    const defaultName = 'GR-' + (1000 + Math.floor(Math.random() * 9000));
    let c = { ws, ip, identity: connection.identity, protocol, build: clean(connection.build, null, 80), token: randomHex(32), connected: true, touched: Date.now(), id: randomUUID(), name: defaultName, car: 'mini', ready: false, finish: null, state: null, lobby: null, alive: true, messages: 0, window: Date.now(), plate: defaultName };
    sessions.set(c.token, c); clients.add(c); send(ws, { type: 'hello', protocol: MULTIPLAYER_PROTOCOL, features: { stateBatching: true, wreckDnf: true }, id: c.id, token: c.token, now: Date.now(), track, maps: catalogue(), events: [...maps.keys()].filter(mapEnabled).flatMap(options) }); send(ws, discover());
    bind(c, ws, ip); return true;
  };
  const bind = (initial, ws, ip) => {
    let c = initial;
    handlers.set(ws, { pong: () => { c.alive = true; },
    message: bytes => {
      if (c.ws !== ws) return;
      // Hibernated sockets from a prior release have no protocol (version 0).
      // Reject them before parsing or executing a resume/state/lobby packet.
      if (protocolVersion(c.protocol) !== MULTIPLAYER_PROTOCOL) {
        reload(ws); leave(c); clients.delete(c); sessions.delete(c.token); c.connected = false; return;
      }
      const now = Date.now(); if (now - c.window > 1000) { c.window = now; c.messages = 0; } if (++c.messages > 80) { ws.close(1008, 'Rate limit'); return; }
      const error = (message, extra = {}) => send(ws, { type: 'error', message, ...extra });
      const hostRate = (l, action) => {
        l.hostActions ||= {};
        if (now - (l.hostActions[action] ?? -Infinity) < 1000) { error('Please wait before repeating this host action.'); return false; }
        l.hostActions[action] = now; return true;
      };
      try {
        const m = JSON.parse(bytes); if (!m || typeof m !== 'object') return;
        if (c.identity && ['name', 'create', 'join'].includes(m.type)) { m.name = c.identity.name; m.driverId = c.identity.userId; }
        if (m.type === 'hello') {
          if (protocolVersion(m.protocol) !== MULTIPLAYER_PROTOCOL) { reload(ws); leave(c); clients.delete(c); sessions.delete(c.token); c.connected = false; return; }
          c.build = clean(m.build, c.build, 80); return;
        }
        // A packet carries up to two 10 Hz samples. Keep the legacy single-sample
        // protocol for old clients; apply identical validation and receipt-clock timing.
        if (m.type === 'states') {
          if (c.lobby && !routePacketMatches(maps.get(c.lobby.mapId), m)) return error('Route identity mismatch.');
          if (!Array.isArray(m.states) || !m.states.length || m.states.length > 2) return error('Invalid state batch.');
          for (const state of m.states) handlers.get(ws).message(JSON.stringify({ type: 'state', raceId: m.raceId, generation: m.generation, mapId: m.mapId, routeIdentity: m.routeIdentity, state }));
          return;
        }
        if (m.type === 'resume') {
          if (c.lobby) return error('Leave your current lobby before resuming another session.');
          const prior = sessions.get(m.token);
          if (!prior || prior === c || (!prior.connected && Date.now() - prior.touched > reconnectGraceMs)) { send(ws, { type: 'session', id: c.id, token: c.token, resumed: false }); return; }
          // A token from another account (or from before sign-in) is simply an expired session: answer it so the client
          // adopts this fresh session instead of waiting for a reply that never comes.
          if ((c.identity?.userId || prior.identity?.userId) && c.identity?.userId !== prior.identity?.userId) { send(ws, { type: 'session', id: c.id, token: c.token, resumed: false }); return; }
          if (prior.lobby && maps.get(prior.lobby.mapId)?.routeIdentity && (!sameRouteIdentity(prior.lobby.routeIdentity, maps.get(prior.lobby.mapId).routeIdentity) || !routePacketMatches(maps.get(prior.lobby.mapId), m))) { send(ws, { type: 'session', id: c.id, token: c.token, resumed: false, reason: 'Route identity changed.' }); return; }
          if (c.identity) prior.identity = c.identity;
          sessions.delete(c.token); clients.delete(c);
          const previousWs = prior.ws, protocol = c.protocol, build = c.build; c = prior; c.protocol = protocol; c.build = build; c.ws = ws; c.ip = ip; c.connected = true; c.alive = true; c.messages = 0; c.window = now; c.touched = now;
          clients.add(c); if (previousWs !== ws) previousWs.close(1000, 'Session resumed elsewhere');
          const racer = c.lobby?.racers?.get(c.id); if (racer) racer.disconnected = false;
          send(ws, { type: 'session', id: c.id, token: c.token, resumed: true, lobby: !!c.lobby });
          if (c.lobby) { send(ws, { type: 'lobby', lobby: publicLobby(c.lobby), resume: true, state: c.state }); publish(c.lobby); sharedWorld.deliver(ws, c.lobby); }
          return;
        }
        const l = c.lobby;
        if (m.type === 'ping') { send(ws, { type: 'pong', now, sent: m.sent }); return; }
        if (m.type === 'discover') { send(ws, discover()); return; }
        if (m.type === 'name') {
          const name = normalizeDriverName(m.name); c.name = c.lobby ? uniqueName(c.lobby, name, c.id) : name; c.plate = formatPlate(name);
          if (c.lobby) { const racer = c.lobby.racers?.get(c.id); if (racer) racer.name = c.name; publish(c.lobby); }
          return;
        }
        if (m.type === 'leave') { leave(c); send(ws, { type: 'left' }); return; }
        if (['create', 'options'].includes(m.type) && m.mode !== undefined && !['sprint', 'free'].includes(m.mode)) return error('Mode unavailable. Choose Quick Race or Free Roam.');
        if (m.type === 'create' || m.type === 'join') {
          // A second click or a retried message for the lobby the driver is already in is the same request: answer with the lobby, not an error toast.
          if (l && m.type === 'join' && String(m.code ?? '').trim().toUpperCase() === l.code) { publish(l); return; }
          if (l) return error('Leave your current lobby first.');
          c.name = clean(m.name, c.name, 16); c.plate = formatPlate(c.name); c.car = CARS.has(canonicalCarId(m.car, CARS)) ? canonicalCarId(m.car, CARS) : fallbackCar();
          c.ready = false; c.loaded = false; c.finish = null; c.dnf = false; c.state = null; c.stateAt = null; c.course = null; c.recovery = null;
          c.paint = /^#[a-f\d]{6}$/i.test(m.paint || '') ? m.paint.toLowerCase() : null; c.driver = normalizeDriverAppearance(m.driver);
          c.driverId = /^[a-zA-Z0-9_-]{8,64}$/.test(m.driverId || '') ? m.driverId : c.id;
          let dest;
          if (m.type === 'create') {
            if (m.mapId !== undefined && !maps.has(m.mapId)) return error(maps.routeIssues?.get(m.mapId) || 'Unknown map.');
            const mapId = m.mapId || defaultMapId;
            const defs = maps.get(mapId).definitions;
            const wantedEvent = m.eventId ?? options(mapId)[0]?.id;
            if (wantedEvent === undefined || !defs.has(wantedEvent)) return error('Unknown race route for this map.');
            const modeBlock = assertModeAllowed(defs.get(wantedEvent), maps.get(mapId).closed === true);
            if (modeBlock) return error(modeBlock);
            if (!mapEnabled(mapId)) return error('Map unavailable.');
            if (lobbies.size >= 64) return error('Lobby limit reached. Join an existing lobby.');
            let code; do { code = randomHex(3).toUpperCase(); } while (lobbies.has(code));
            dest = { code, name: clean(m.lobbyName, `${c.name}'S RACE`), host: c.id, private: m.private === true, players: new Map(), status: 'waiting', startAt: null, raceId: null, generation: 0, mapId, routeIdentity: maps.get(mapId).routeIdentity || null, eventId: wantedEvent, traffic: true, config: null, allowedCars: [...CARS], carRules: defaultCarRules(), advancedCars: null, balance: null };
            // Host car rules validate like any other host write: an invalid
            // ruleset rejects the create, never coerces silently.
            if (m.carRules !== undefined) {
              const rc = sanitizeCarRules(m.carRules, rulesCtx());
              if (rc.error) return error(rc.error);
              dest.carRules = rc.rules;
            }
            if (m.allowedCars !== undefined && m.allowedCars !== null) {
              const adv = sanitizeCarList(m.allowedCars);
              if (!adv) return error('Allow at least one car.');
              dest.advancedCars = adv;
            }
            {
              const eff = effectiveCars(dest.carRules, dest.advancedCars);
              if (!eff.length) return error('No cars are eligible under these car rules.');
              dest.allowedCars = eligibleForMap(mapId, eff);
              if (!dest.allowedCars.length) return error('Unsupported online capacity for the selected cars.');
            }
            const cfg = sanitizeConfig(m.config ?? {}, defs.get(wantedEvent));
            if (cfg.error) return error(cfg.error);
            dest.config = { ...defaultConfig(defs.get(wantedEvent)), ...cfg.config };
            if (m.traffic !== undefined && m.config?.traffic === undefined) dest.config.traffic = m.traffic === true ? 1 : 0;
            dest.traffic = dest.config.traffic > 0; dest.police = dest.config.police === true;
            if (isObjectiveMode(defs.get(wantedEvent).type)) dest.objectiveTrips = (maps.get(mapId).trips || {})[defs.get(wantedEvent).type] || null;
            lobbies.set(code, dest);
          } else {
            dest = lobbies.get(String(m.code).trim().toUpperCase());
            if (!dest) return error('Lobby not found. Check the code or refresh the list.');
            dest.blocks = (dest.blocks || []).filter(b => b.until > now);
            const block = dest.blocks.find(b => b.token === c.token || b.driverId === c.driverId);
            if (block) return error('The host blocked you from this lobby.', { code: 'LOBBY_BLOCKED', until: block.until, lobbyCode: dest.code });
            if (dest.players.size >= 8) return error('This lobby is full.');
            if (!mapEnabled(dest.mapId)) return error('Map unavailable.');
          }
          if (!dest.carRules || typeof dest.carRules !== 'object') dest.carRules = defaultCarRules();
          if (!Array.isArray(dest.allowedCars)) dest.allowedCars = effectiveCars(dest.carRules, dest.advancedCars);
          // Joining validates the requested car against the ruleset: an
          // ineligible pick falls back to the first eligible car, so the join
          // itself always succeeds and the lobby publish shows the real car.
          if (!dest.allowedCars.includes(c.car)) c.car = dest.allowedCars[0];
          c.name = uniqueName(dest, c.name, c.id);
          c.gridSlot = Array.from({ length: 8 }, (_, i) => i).find(i => ![...dest.players.values()].some(p => p.gridSlot === i));
          if (!Number.isInteger(c.gridSlot)) return error('This lobby is full.');
          c.joinedAt = now; c.lobby = dest; dest.players.set(c.id, c); refreshBalance(dest);
          if (dest.racers) dest.racers.set(c.id, { id: c.id, name: c.name, car: c.car, finish: null, dnf: dest.status === 'results', disconnected: false });
          publish(dest); return;
        }
        if (!l) return error('Join a lobby first.');
        const routeMap = maps.get(l.mapId);
        if (routeMap?.routeIdentity && ['loaded', 'ready', 'state', 'recover', 'contact', 'dnf', 'world-frame', 'world-contact'].includes(m.type) && !routePacketMatches(routeMap, m)) {
          if (m.type === 'loaded' || m.type === 'ready') { c.loaded = false; c.ready = false; publish(l); }
          if (m.type === 'recover') { send(c.ws, { type: 'recover-denied', raceId: m.raceId, generation: l.generation || 0, motionEpoch: m.motionEpoch, routeIdentity: l.routeIdentity, message: 'Route identity mismatch.' }); return; }
          return error('Route identity mismatch.');
        }
        if (routeMap?.routeIdentity && ['state', 'recover', 'contact', 'dnf'].includes(m.type) && m.generation !== l.generation) {
          if (m.type === 'recover') { send(c.ws, { type: 'recover-denied', raceId: m.raceId, generation: l.generation || 0, motionEpoch: m.motionEpoch, routeIdentity: l.routeIdentity, message: 'Race generation mismatch.' }); return; }
          return error('Race generation mismatch.');
        }
        if (m.type === 'world-frame') { sharedWorld.frame(c, l, m, now); return; }
        if (m.type === 'world-contact') { sharedWorld.contact(c, l, m, now); return; }
        if (m.type === 'options') {
          if (l.host !== c.id) return error('Only the host can change the lobby setup.');
          const mapId = m.mapId ?? l.mapId;
          if (!maps.has(mapId)) return error(maps.routeIssues?.get(mapId) || 'Unknown map.');
          const defs = maps.get(mapId).definitions;
          const eventId = m.eventId ?? (mapId === l.mapId ? l.eventId : options(mapId)[0]?.id);
          if (eventId === undefined || !defs.has(eventId)) return error('Unknown race route for this map.');
          const modeBlock = assertModeAllowed(defs.get(eventId), maps.get(mapId).closed === true);
          if (modeBlock) return error(modeBlock);
          if (!mapEnabled(mapId)) return error('Map unavailable.');
          // Car rules and the Advanced per-car override resolve to one effective
          // allow-list. Both validate before anything mutates: an empty field
          // or a ruleset with no eligible cars rejects the whole edit.
          let nextRules = l.carRules || defaultCarRules(), nextAdvanced = l.advancedCars || null, rulesChanged = false;
          if (m.carRules !== undefined) {
            const rc = sanitizeCarRules(m.carRules, rulesCtx());
            if (rc.error) return error(rc.error);
            nextRules = rc.rules;
          }
          if (m.allowedCars !== undefined) {
            if (m.allowedCars === null) nextAdvanced = null;
            else {
              const list = sanitizeCarList(m.allowedCars);
              if (!list) return error('Allow at least one car.');
              nextAdvanced = list;
            }
          }
          const effective = eligibleForMap(mapId, effectiveCars(nextRules, nextAdvanced));
          if (!effective.length) return error('No cars are eligible under these car rules.');
          const newlyDisallowed = [];
          if (JSON.stringify(nextRules) !== JSON.stringify(l.carRules || defaultCarRules()) || JSON.stringify(nextAdvanced) !== JSON.stringify(l.advancedCars || null)) {
            for (const p of l.players.values()) if (!effective.includes(p.car)) newlyDisallowed.push(p.id);
            rulesChanged = true;
          }
          const incoming = { ...(m.config || {}) };
          if (m.traffic !== undefined && incoming.traffic === undefined) incoming.traffic = m.traffic === true ? 1 : 0;
          const cfg = sanitizeConfig(incoming);
          if (cfg.error) return error(cfg.error);
          if (rulesChanged) {
            l.carRules = nextRules; l.advancedCars = nextAdvanced; l.allowedCars = effective;
            for (const id of newlyDisallowed) { const p = l.players.get(id); p.car = l.allowedCars[0]; p.ready = false; }
            refreshBalance(l);
          }
          const prevConfig = l.config || {};
          const mapChanged = mapId !== l.mapId, eventChanged = eventId !== l.eventId;
          // A different track brings its own defaults: a Riviera lobby's traffic, time, weather and police must not follow the host
          // to Megara ("why is there traffic on Megara"). What the host sets in this same message still wins.
          const trackDefaults = mapChanged ? (({ traffic, time, weather, police, reverse }) => ({ traffic, time, weather, police, reverse }))(defaultConfig(defs.get(eventId))) : {};
          const nextConfig = { ...prevConfig, ...trackDefaults, ...cfg.config };
          if (!canReverse(mapId)) nextConfig.reverse = false;
          const raceChanged = mapChanged || eventChanged || configInvalidates(prevConfig, nextConfig);
          if (mapChanged) for (const p of l.players.values()) p.loaded = false;
          if (mapChanged) { l.allowedCars = effective; for (const p of l.players.values()) if (!effective.includes(p.car)) { p.car = effective[0]; p.ready = false; } refreshBalance(l); }
          l.mapId = mapId; l.routeIdentity = maps.get(mapId).routeIdentity || null; l.eventId = eventId; l.config = nextConfig; l.traffic = nextConfig.traffic > 0; l.police = nextConfig.police === true;
          if (isObjectiveMode(defs.get(eventId).type)) l.objectiveTrips = (maps.get(mapId).trips || {})[defs.get(eventId).type] || null; else l.objectiveTrips = null;
          // A setup edit during a live or finished race cancels cleanly to a
          // waiting lobby on the same room code; waiting-room edits invalidate
          // readiness only when the offered race actually changed, and an
          // allow-list shrink unreadies only drivers it disallows.
          if (['countdown', 'race', 'results'].includes(l.status) && (mapChanged || eventChanged || raceChanged || rulesChanged)) cancelToWaiting(l);
          else if (raceChanged) for (const p of l.players.values()) p.ready = false;
          publish(l); return;
        }
        if (m.type === 'appearance') {
          if (/^#[a-f\d]{6}$/i.test(m.paint || '')) c.paint = m.paint.toLowerCase();
          if (m.driver !== undefined) c.driver = normalizeDriverAppearance(m.driver);
          publish(l); return;
        }
        if (m.type === 'loaded') {
          const loaded = m.loaded === true && m.mapId === l.mapId && m.version === maps.get(l.mapId).track.version;
          c.loaded = loaded; if (!loaded) c.ready = false;
          if (loaded && ['countdown', 'race'].includes(l.status) && !c.state) c.enteredAt = now;
          publish(l); if (loaded) sharedWorld.deliver(ws, l); return;
        }
        if (m.type === 'car' || m.type === 'ready') {
          const carOnly = m.type === 'car' || m.car !== undefined && m.ready !== true;
          if (l.status !== 'waiting' && !(l.status === 'results' && carOnly)) return error('The race has already started.');
          // Car-only updates (ready:false/undefined) never need the track
          // version, so guests keep choosing cars while the lobby track loads.
          if (m.ready === true && ((m.mapId !== undefined && m.mapId !== l.mapId) || m.version !== maps.get(l.mapId).track.version)) return error('The track changed. Reload the game to join this race.');
          // Owner decision 2026-10-20: an older client may still name a removed trim; it drives the model's top trim.
          if (m.car !== undefined) m.car = canonicalCarId(m.car, CARS);
          if (m.car !== undefined && !CARS.has(m.car)) return error('Unknown car.');
          // Car and ready votes validate against the host ruleset, with the
          // reason in the message so the garage can show why a pick failed.
          if (m.car !== undefined) {
            if (!mapSupportsCar(l.mapId, m.car)) return error('This car exceeds the certified online grid footprint.');
            const v = carEligibility(paceEntry(m.car), lobbyRules(l));
            if (!v.ok) return error(`That car is not allowed in this lobby. ${v.reason}`);
          }
          if (CARS.has(m.car) && m.car !== c.car) { c.car = m.car; refreshBalance(l); }
          // A valid explicit ready vote also acknowledges the loaded track.
          if (m.ready === true) { c.loaded = true; c.enteredAt = now; }
          if (m.ready === true) {
            const v = carEligibility(paceEntry(c.car), lobbyRules(l));
            if (!v.ok) return error(`Your car is not allowed in this lobby. ${v.reason} Pick an allowed car.`);
          }
          c.ready = m.ready === true; publish(l); return;
        }
        if (m.type === 'kick' || m.type === 'block' || m.type === 'unblock') {
          if (l.host !== c.id) return error('Only the host can moderate the lobby.');
          if (!['waiting', 'results'].includes(l.status)) return error('Return to the lobby before removing a driver.');
          if (m.type === 'unblock') {
            if (!hostRate(l, 'unblock')) return;
            l.blocks = (l.blocks || []).filter(b => b.id !== m.id && b.until > now); publish(l); return;
          }
          const target = l.players.get(m.id);
          if (!target || target === c) return error('Choose another lobby driver.');
          if (!hostRate(l, m.type)) return;
          const until = m.type === 'block' ? now + idleLobbyMs : null;
          if (until) {
            l.blocks = (l.blocks || []).filter(b => b.until > now && b.id !== target.id).slice(-63);
            l.blocks.push({ id: target.id, name: target.name, until, token: target.token, driverId: target.driverId });
          }
          leave(target); send(target.ws, { type: 'kicked', lobbyCode: l.code, until, blocked: !!until, message: until ? 'The host blocked you from this lobby.' : 'The host removed you. You can rejoin this lobby.' });
          publish(l); return;
        }
        if (m.type === 'start') {
          if (l.host !== c.id) return error('Only the host can start the race.');
          // A stale client retrying start after results converges to waiting
          // instead of erroring: the host presses start again to launch.
          if (l.status === 'results') { cancelToWaiting(l); publish(l); return; }
          for (const p of l.players.values()) {
            const v = carEligibility(paceEntry(p.car), lobbyRules(l));
            if (!v.ok) return error(`A driver picked a car the host disallowed. ${v.reason}`);
          }
          const connected = [...l.players.values()].filter(p => p.connected);
          if (l.status !== 'waiting' || connected.length < 2 || m.force !== true && ![...l.players.values()].every(p => p.ready && p.loaded && p.connected)) return error('At least two drivers must be ready, or the host can force start two connected drivers.');
          if (m.force === true && !hostRate(l, 'start')) return;
          // Reservations and loading drivers remain members; they enter at their grid slot.
          if (m.force === true) for (const p of l.players.values()) if (p.connected && p.loaded) p.ready = true;
          l.status = 'countdown'; l.startAt = now + countdownMs; l.raceId = randomUUID(); nextGeneration(l);

          for (const p of l.players.values()) { p.state = null; p.stateAt = null; p.finish = null; p.dnf = false; p.course = null; }
          l.racers = new Map([...l.players.values()].map(p => [p.id, { id: p.id, name: p.name, car: p.car, finish: null, dnf: false, disconnected: false }]));
          if (isObjectiveMode(lobbyEvent(l)?.type)) { l.objectiveTrips = (maps.get(l.mapId).trips || {})[lobbyEvent(l).type] || null; startObjectiveRound(l, { mode: lobbyEvent(l).type, raceId: l.raceId, startAtMs: l.startAt }); } else { l.objectives = null; l.objectiveTrips = null; }
          publish(l); return;
        }
        if (m.type === 'rematch') {
          if (l.host !== c.id) return error('The host can arrange a rematch after the race.');
          if (l.status !== 'results') { publish(l); return; }
          cancelToWaiting(l);
          publish(l); return;
        }
        if (m.type === 'restart') {
          if (l.host !== c.id) return error('Only the host can restart the race.');
          if (!['countdown', 'race', 'results'].includes(l.status)) return error('Nothing to restart yet.');
          restartRace(l, randomUUID(), now + countdownMs);
          if (isObjectiveMode(lobbyEvent(l)?.type)) startObjectiveRound(l, { mode: lobbyEvent(l).type, raceId: l.raceId, startAtMs: l.startAt });

          publish(l); return;
        }
        if (m.type === 'to-lobby') {
          if (l.host !== c.id) return error('Only the host can return the lobby.');
          if (l.status !== 'waiting') cancelToWaiting(l);
          publish(l); return;
        }
        if (m.type === 'transfer') {
          if (l.host !== c.id) return error('Only the host can transfer control.');
          const target = l.players.get(m.to);
          if (!target || !target.connected) return error('Choose a connected driver.');
          l.host = target.id; publish(l); return;
        }
        if (m.type === 'recover') {
          // Every request is answered: a silent drop leaves the driver's screen black until the client gives up.
          const deny = (message, extra = {}) => send(c.ws, { type: 'recover-denied', raceId: m.raceId, generation: l.generation || 0, motionEpoch: m.motionEpoch, message, ...extra });
          if (l.status !== 'race' || m.raceId !== l.raceId || m.generation !== undefined && m.generation !== l.generation || c.finish !== null || c.dnf) return deny('Recovery is unavailable.');
          const event = publicLobby(l).event;
          const recovery = requestRecovery(c, event, l.raceId, m.motionEpoch, now, { route: maps.get(l.mapId).geometry, capture: m.capture === true });
          if (!recovery) return deny(c.state ? 'Recovery needs a fresh position. Try again.' : 'Recovery needs a current race position.', Number.isSafeInteger(c.state?.motionEpoch) ? { epoch: c.state.motionEpoch } : {});
          clearObjectiveHold(l, c.id); trails.delete(c);
          l.dirty = true; send(c.ws, { type: 'recovered', generation: l.generation, mapId: l.mapId, routeIdentity: l.routeIdentity || null, ...recovery }); return;
        }
        if (m.type === 'contact') {
          // A driver reports a car-to-car contact so the other driver applies the matching impulse (src/multiplayer-contact.js).
          // The arena only relays what could have happened: both cars racing and near each other, bounded numbers, bounded rate.
          if (l.status !== 'race' || m.raceId !== l.raceId || m.generation !== undefined && m.generation !== l.generation || c.finish !== null || c.dnf || !c.state) return;
          const target = l.players.get(m.to);
          if (!target || target === c || !target.state || target.connected === false || target.finish !== null || target.dnf) return;
          if (c.contactRaceId !== l.raceId) { c.contactRaceId = l.raceId; c.contactNonce = -1; }
          if (!Number.isSafeInteger(m.nonce) || m.nonce <= c.contactNonce) return;
          if (!(c.contactWindow > now - 1000)) { c.contactWindow = now; c.contactCount = 0; }
          if (++c.contactCount > 10) return;
          const numbers = ['x', 'z', 'vx', 'vz', 'm', 'nx', 'nz', 'closing'];
          if (numbers.some(k => !Number.isFinite(m[k])) || Math.abs(m.vx) > 150 || Math.abs(m.vz) > 150 || m.m < 100 || m.m > 100000 || m.closing < 0 || m.closing > 150) return;
          // Both last accepted poses are at most a few hundred ms old: 30 m covers two cars closing at 100 m/s plus their length.
          if (Math.hypot(c.state.x - target.state.x, c.state.z - target.state.z) > 30) return;
          const length = Math.hypot(m.nx, m.nz);
          c.contactNonce = m.nonce;
          send(target.ws, { type: 'contact', raceId: l.raceId, generation: l.generation || 0, from: c.id, nonce: m.nonce, at: now, x: m.x, z: m.z, vx: m.vx, vz: m.vz, m: m.m, nx: length ? m.nx / length : 0, nz: length ? m.nz / length : 0, closing: m.closing });
          return;
        }
        if (m.type === 'world') return; // Environment belongs to the arena clock.

        if (m.type === 'dnf') {
          if (!['countdown', 'race'].includes(l.status) || now < l.startAt || m.raceId !== l.raceId || m.generation !== undefined && m.generation !== l.generation || c.finish !== null || c.dnf) return;
          if (!['retired', 'wrecked'].includes(m.reason)) return error('Unknown DNF reason.');
          if (m.reason === 'wrecked' && !isTerminalImpact(m.impactEbs, m.impactMechanical)) return error('Impact is recoverable; tow and repair.');
          if (l.status === 'countdown') l.status = 'race';
          c.dnf = m.reason; c.finish = null;
          const racer = l.racers.get(c.id); racer.dnf = m.reason; racer.finish = null;
          l.dirty = true; publish(l);
          if ([...l.players.values()].every(p => p.finish !== null || p.dnf)) results(l);
          return;
        }
        if (m.type === 'state' && !c.dnf && ['countdown', 'race'].includes(l.status) && now >= l.startAt && m.raceId === l.raceId && (m.generation === undefined || m.generation === l.generation)) {
          const fields = ['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear'];
          if (!m.state || fields.some(k => !Number.isFinite(m.state[k]))) return;
          const s = m.state, event = effectiveEvent(lobbyEvent(l), l.config);
          const worldFree = routeMap?.routeIdentity && event.type === 'free';
          if (routeMap?.routeIdentity && (!Number.isInteger(s.layer) || typeof s.surfaceId !== 'string' || s.surfaceId.length > 200 || typeof s.edgeId !== 'string' || s.edgeId.length > 200)) return;
          if (!recoveryStateAllowed(c, s, l.raceId, now, { route: maps.get(l.mapId).geometry, event })) return;
          const zones = ['front', 'rear', 'left', 'right'];
          if (s.nitro !== undefined && (!Number.isFinite(s.nitro) || s.nitro < 0 || s.nitro > 1)) return;
          if (s.damage !== undefined && (!s.damage || zones.some(k => !Number.isFinite(s.damage[k]) || s.damage[k] < 0 || s.damage[k] > 1))) return;
          if (Math.abs(s.x) > 100000 || Math.abs(s.z) > 100000 || Math.abs(s.y) > 10000 || (worldFree ? Math.abs(s.u) > 1e7 || Math.abs(s.s) > 1e7 : Math.abs(s.u) > 500 || s.s < Math.min(event.s0, event.s1) - 500 || s.s > Math.max(event.s0, event.s1) + 500) || Math.abs(s.vLong) > 150 || Math.abs(s.vLat) > 150 || s.rpm < 0 || s.rpm > 20000 || s.gear < 1 || s.gear > 10) return;
          // Client physics with bounded progress; the server owns race timing/results.
          const prevS = c.state?.s ?? (routeMap?.routeIdentity ? routeMap.gridPose(c.gridSlot, c.car).s : event.s0);
          const elapsed = Math.max(0, (now - Math.max(c.stateAt ?? Math.max(l.startAt, c.enteredAt || 0), c.recovery?.raceId === l.raceId ? c.recovery.until : l.startAt)) / 1000);
          const courseEnabled = !isObjectiveMode(event.type) && event.type !== 'free';
          if (courseEnabled && c.course?.raceId !== l.raceId) {
            c.course = { ...buildCourse(event, maps.get(l.mapId).geometry), raceId: l.raceId };
            if (routeMap?.routeIdentity) {
              const pose = routeMap.gridPose(c.gridSlot, c.car);
              const projected = routeMap.geometry.project(pose.x, pose.z, { hint: pose.s, referenceY: pose.y, layer: pose.layer, maxTravel: 8 });
              c.course.previous = { ...pose, u: projected.u };
            }
          }
          const recovered = c.recovery?.raceId === l.raceId && now <= c.recovery.until;
          const previousPose = c.state || c.course?.previous || (routeMap?.routeIdentity ? routeMap.gridPose(c.gridSlot, c.car) : null);
          const discontinuous = !worldFree && Math.abs(s.s - prevS) > 30 + 150 * (courseEnabled ? Math.min(5, elapsed) : elapsed) || !recovered && previousPose && Math.hypot(s.x - previousPose.x, s.z - previousPose.z) > 15 + 150 * (courseEnabled ? Math.min(5, elapsed) : elapsed);
          // A jump is never accepted as movement; progress simply stays where it was (and the course's
          // rejoin rule keeps it there until the driver returns to the route or is recovered).
          if (discontinuous) return;
          if (courseEnabled) observeCourse(c.course, s, now / 1000, { initialTime: Math.max(l.startAt, c.enteredAt || 0) / 1000, recovery: recovered, route: maps.get(l.mapId).geometry });
          const recordMeta = captureRecordMeta(s.recordMeta, c.state?.recordMeta, l.raceId);
          c.state = { ...Object.fromEntries(fields.map(k => [k, s[k]])), nitro: nitrousCars.has(c.car) ? s.nitro ?? c.state?.nitro ?? 0.4 : 0, damage: s.damage ? Object.fromEntries(zones.map(k => [k, s.damage[k]])) : c.state?.damage ?? Object.fromEntries(zones.map(k => [k, 0])), reverse: s.reverse === true, ...(typeof s.paint === 'string' && /^#[a-f\d]{6}$/i.test(s.paint) ? {paint:s.paint.toLowerCase()} : c.state?.paint ? {paint:c.state.paint} : {}), driver: normalizeDriverAppearance(s.driver === undefined ? c.state?.driver : s.driver) }; c.stateAt = now; l.dirty = true;
          Object.assign(c.state, validateStateExtras(s));
          if (routeMap?.routeIdentity) Object.assign(c.state, { ...(c.course ? { s: c.course.previous.s, u: c.course.previous.u } : {}), layer: s.layer, surfaceId: s.surfaceId, edgeId: s.edgeId });
          if (recordMeta) c.state.recordMeta = recordMeta;
          if (l.objectives && c.finish === null && !c.dnf && stepPlayerObjective(l, c.id, now, { x: s.x, y: s.y, z: s.z, vLong: s.vLong, vLat: s.vLat }).length) publish(l);
          // Epoch authority is independent of the optional render clock. A
          // packet without sampleTime must not erase the recovery high-water mark.
          if (Number.isSafeInteger(s.motionEpoch) && s.motionEpoch >= 0) c.state.motionEpoch = s.motionEpoch;
          // Optional render clock only; progress checks and finishes use server receipt time.
          if (Number.isFinite(s.sampleTime) && s.sampleTime >= 0 && s.sampleTime <= 1e12) {
            c.state.sampleTime = s.sampleTime;
            c.state.sampleAge = Number.isFinite(s.sampleAge) ? Math.max(0, Math.min(1000, s.sampleAge)) : 0;
          }
          rememberSample(c, l.raceId, c.state, now);
          rememberRecoveryRoad(c, event, l.raceId, maps.get(l.mapId).geometry);
          // Objective modes never take the crossing finish; reversed runs keep
          // their time but stay off the leaderboard.
          if (c.finish === null && event.type === 'sprint' && courseComplete(c.course) && (s.s - event.s1) * event.dir >= 0 && Math.abs(s.u) < 30) {
            c.finish = Math.max(0, (c.course.finishedAt ?? now / 1000) - l.startAt / 1000); l.racers.get(c.id).finish = c.finish; publish(l);
            if (!l.config?.reverse && canSaveResults(c.identity)) leaderboard.submit(onlineLeaderboardResult(c, l, event)).catch(e => { if (!e.status) console.error('Leaderboard save failed:', e.message); });
            if ([...l.players.values()].every(p => p.finish !== null || p.dnf)) results(l);
          }
        }
      } catch (e) { console.error('Multiplayer handler failed', { type: (() => { try { return JSON.parse(bytes)?.type; } catch { return 'invalid'; } })(), message: e.message }); error('Invalid message.'); }
    },
    close: () => {
      if (c.ws !== ws) return;
      clients.delete(c); c.connected = false; c.touched = Date.now();

      if (reconnectGraceMs === 0) { leave(c); sessions.delete(c.token); return; }
      const l = c.lobby;
      if (l) {
        const racer = l.racers?.get(c.id); if (racer) racer.disconnected = true;
        if (l.host === c.id) l.host = [...l.players.values()].find(p => p.connected)?.id || c.id;
        if (l.status === 'countdown' && [...l.players.values()].filter(p => p.connected).length < 2) { l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null; l.objectives = null; l.objectiveTrips = null; for (const p of l.players.values()) p.ready = false; }
        publish(l);
      }
    } });
  };
  const tick = () => {
    const now = Date.now();
    for (const c of sessions.values()) if (!c.connected && now - c.touched > reconnectGraceMs) { leave(c); sessions.delete(c.token); }
    for (const l of lobbies.values()) {
      if (['waiting', 'results'].includes(l.status) && now - l.touched > idleLobbyMs) { for (const p of [...l.players.values()]) { leave(p); send(p.ws, { type: 'left', reason: 'Idle lobby expired.' }); } continue; }
      if (l.status === 'countdown' && now >= l.startAt) { l.status = 'race'; publish(l); }
      if (['countdown', 'race'].includes(l.status)) {
        if (lobbyEvent(l)?.type !== 'free' && now > l.startAt + raceLimitFor(l, raceLimitMs)) { results(l); continue; }
        // Objective rounds advance on the receipt clock even for parked
        // drivers; an all-done round ends the race like a full finish.
        if (l.objectives && l.status === 'race') {
          let moved = false;
          for (const id of [...l.objectives.keys()]) { if (stepPlayerObjective(l, id, now, null).length) moved = true; }
          if (moved) { l.dirty = true; publish(l); }
          if ([...l.objectives.values()].every(o => o.done)) { results(l); continue; }
        }
        if (!l.dirty) continue; l.dirty = false;
        const world = arenaEnvironment(l, effectiveEvent(lobbyEvent(l), l.config), now);
        const standings = raceStandings(l, effectiveEvent(lobbyEvent(l), l.config));
        const players = [...l.players.values()].map(p => { const trail = p.state ? takeTrail(p, l.raceId) : null; return { id: p.id, state: p.state, stateAt: p.stateAt, ...(trail ? { trail } : {}), finish: p.finish, dnf: p.dnf, objective: snapshotPlayerObjective(l, p.id) }; });
        // One encoding for every recipient.
        const text = JSON.stringify({ type: 'snapshot', mapId: l.mapId, routeIdentity: l.routeIdentity || null, raceId: l.raceId, generation: l.generation || 0, now, players, standings, world });
        for (const p of l.players.values()) send(p.ws, text);
      }
    }
  };
  const clientData = c => { const { ws, lobby, ...data } = c; return { ...data, lobbyCode: lobby?.code || null }; };
  const exportState = () => ({ sessions: [...sessions.values()].map(c => {
    const data = clientData(c);
    // Course geometry is immutable catalogue data. Persist the accepted cursor
    // once per driver instead of duplicating it in the arena KV row.
    if (data.course) {
      const { raceId, reached, validProgress, onRoute, rejoinLimit, previousTime, finishedAt, markTimes, lastRoad, excursion } = data.course;
      data.courseCursor = { raceId, reached, validProgress, onRoute, rejoinLimit, previousTime, finishedAt, markTimes, lastRoad, ...(excursion ? { excursion } : {}) };
      delete data.course;
    }
    return data;
  }), lobbies: [...lobbies.values()].map(l => { const { players, racers, objectives, ...data } = l; return { ...data, playerIds: [...players.keys()], racers: racers ? [...racers] : null, objectives: objectives ? [...objectives] : null }; }) });
  const restore = (saved, sockets = new Map()) => {
    for (const data of saved?.sessions || []) {
      const ws = sockets.get(data.token) || { readyState: 3, close() {} };
      if (sockets.has(data.token) && protocolVersion(data.protocol) !== MULTIPLAYER_PROTOCOL) { reload(ws); continue; }
      const connection = { ...data };
      for (const key of ['accountSub', 'accountName', 'friendsSent']) delete connection[key];
      const c = { ...connection, name: clean(data.name, 'GR-1000', 16), plate: formatPlate(data.name || 'GR-1000'), ws, lobby: null, connected: sockets.has(data.token) };
      // Catalogue removals must not resurrect a retired vehicle after Worker hibernation.
      if(!CARS.has(c.car)){
        const kept = canonicalCarId(c.car, CARS);
        if(CARS.has(kept))c.car=kept;
        else{c.car=fallbackCar();c.ready=false;c.loaded=false;c.state=null;c.courseCursor=null;c.recovery=null;}
      }
      // A platform replacement can drop every socket without close callbacks.
      // Start the reservation when that loss is discovered, not at race creation.
      if (data.connected && !c.connected) c.touched = Date.now();
      if (c.state) { const { decals, ...state } = c.state; c.state = state; }
      if (c.state && !nitrousCars.has(c.car)) c.state = { ...c.state, nitro: 0 };
      sessions.set(c.token, c); if (c.connected) { clients.add(c); bind(c, ws, c.ip); }
    }
    const byId = new Map([...sessions.values()].map(c => [c.id, c]));
    for (const data of saved?.lobbies || []) {
      if (!maps.has(data.mapId) || !mapEnabled(data.mapId) || !onlineEvent(data.eventId, data.mapId) || maps.get(data.mapId).routeIdentity && !sameRouteIdentity(data.routeIdentity, maps.get(data.mapId).routeIdentity)) {
        for (const id of data.playerIds || []) { const c = byId.get(id); if (c) { c.loaded = false; c.ready = false; c.state = null; c.courseCursor = null; c.recovery = null; } }
        continue;
      }
      const l = { ...data, players: new Map(), racers: data.racers ? new Map(data.racers) : null, objectives: data.objectives ? new Map(data.objectives) : null };
      l.blocks = (l.blocks || []).map(block => { const copy = { ...block }; delete copy.accountSub; return copy; });
      if (!l.config) l.config = defaultConfig(maps.get(data.mapId)?.definitions.get(data.eventId));
      if (l.objectives) l.objectiveTrips = (maps.get(data.mapId)?.trips || {})[maps.get(data.mapId)?.definitions.get(data.eventId)?.type] || null;
      // Legacy saves predate car rules: normalize to open so old lobbies keep racing.
      if (!l.carRules || typeof l.carRules !== 'object') l.carRules = defaultCarRules();
      else { const rc = sanitizeCarRules(l.carRules, rulesCtx()); l.carRules = rc.rules || defaultCarRules(); }
      l.advancedCars = sanitizeCarList(l.advancedCars) || null;
      l.allowedCars = eligibleForMap(l.mapId, effectiveCars(l.carRules, l.advancedCars));
      if (!l.allowedCars.length) { l.carRules = defaultCarRules(); l.advancedCars = null; l.allowedCars = eligibleForMap(l.mapId, [...CARS]); }
      for (const id of data.playerIds) { const c = byId.get(id); if (c) {
        if(!l.allowedCars.includes(c.car)){
          c.car=l.allowedCars[0];c.ready=false;c.loaded=false;c.state=null;c.courseCursor=null;c.recovery=null;
        }
        l.players.set(id, c); c.lobby = l;
        if (c.courseCursor?.raceId === l.raceId) {
          const course = buildCourse(effectiveEvent(lobbyEvent(l), l.config), maps.get(l.mapId).geometry);
          c.course = { ...course, ...c.courseCursor, previous: c.state || course.previous };
        }
        delete c.courseCursor;
      } }
      refreshBalance(l);
      if (l.players.size) lobbies.set(l.code, l);
    }
  };
  const prepareMessage = async (ws, bytes) => {
    let message; try { message = JSON.parse(bytes); } catch { return true; }
    if (message?.type !== 'recover') return true;
    const driver = [...clients].find(c => c.ws === ws), lobby = driver?.lobby, map = maps.get(lobby?.mapId);
    // Reject mismatched races before any asynchronous asset fetch. The normal
    // handler produces the protocol's explicit denial for these cases.
    if (!map?.prepareRecovery || !driver.state || !Number.isSafeInteger(message.motionEpoch) || message.motionEpoch <= (driver.state.motionEpoch ?? -1) || driver.finish !== null || driver.dnf || lobby.status !== 'race' || message.raceId !== lobby.raceId || message.generation !== lobby.generation || !routePacketMatches(map, message)) return true;
    const deny = text => send(ws, { type: 'recover-denied', raceId: message.raceId, generation: lobby.generation || 0, motionEpoch: message.motionEpoch, routeIdentity: lobby.routeIdentity, message: text });
    const now = Date.now();
    if (now - (driver.recoveryPrepareAt ?? -Infinity) < 1000) { deny('Recovery roads are preparing. Try again.'); return false; }
    driver.recoveryPrepareAt = now;
    const generation = lobby.generation;
    const poseKey = () => JSON.stringify(['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'layer', 'surfaceId', 'edgeId', 'motionEpoch'].map(k => driver.state?.[k]));
    const acceptedPose = poseKey();
    try {
      if (!await map.prepareRecovery(driver) || driver.ws !== ws || driver.lobby !== lobby || lobby.raceId !== message.raceId || lobby.generation !== generation || poseKey() !== acceptedPose || !routePacketMatches(map, message) || !sameRouteIdentity(lobby.routeIdentity, map.routeIdentity)) { deny('Recovery position changed. Try again.'); return false; }
      return true;
    } catch (error) { deny(error.message || 'Recovery roads unavailable. Try again.'); return false; }
  };
  const nextWake = () => {
    let at = Infinity;
    for (const c of sessions.values()) if (!c.connected) at = Math.min(at, c.touched + reconnectGraceMs + 1);
    for (const l of lobbies.values()) {
      if (l.status === 'countdown') at = Math.min(at, l.startAt);
      if (['countdown', 'race'].includes(l.status)) at = Math.min(at, l.startAt + raceLimitFor(l, raceLimitMs) + 1);
      else at = Math.min(at, l.touched + idleLobbyMs + 1);
    }
    return Number.isFinite(at) ? at : null;
  };
  return { connect, prepareMessage, message: (ws, bytes) => handlers.get(ws)?.message(bytes), disconnect: ws => { handlers.get(ws)?.close(); handlers.delete(ws); }, pong: ws => handlers.get(ws)?.pong(), tick, nextWake, exportState, restore, clientData: ws => { const c = [...clients].find(c => c.ws === ws); return c && clientData(c); }, discover, publicLobby, lobbies, clients, sessions, track };
}
