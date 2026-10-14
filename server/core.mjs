import { buildCourse, observeCourse, courseStatus } from '../src/checkpoints.js';
import { defaultConfig, sanitizeConfig, effectiveEvent, configInvalidates, nextGeneration, cancelToWaiting, restartRace, startObjectiveRound, stepPlayerObjective, snapshotPlayerObjective, resultPlayerObjective, objectiveRoundDone, clearObjectiveHold, applyObjectivePenalty, raceLimitFor, isObjectiveMode, assertModeAllowed, validateStateExtras } from './mp-lifecycle.mjs';
import { isMapEnabled } from '../src/enabled-maps.js';
import { validateViolation, penaltyFor, createEnforcementState, observeEnforcementState } from './enforcement.mjs';
import { normalizeDriverAppearance } from '../src/driver-appearance-data.js';
import { rememberRecoveryRoad, requestRecovery, recoveryStateAllowed } from './race-recovery.mjs';
// Shared lobby/race protocol. Transports own sockets, persistence and wake-up scheduling.
const clean = (v, fallback, n = 28) => typeof v === 'string' ? v.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, n) || fallback : fallback;
const send = (ws, data) => { if (ws?.readyState === 1 && (ws.bufferedAmount || 0) < 65536) { try { ws.send(JSON.stringify(data)); } catch {} } };
const randomUUID = () => crypto.randomUUID();
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
export function createGameCore({ maps, cars: CARS, nitrousCars = new Set(), leaderboard, accounts = null, friends = null, appearance = null, countdownMs = 4000, raceLimitMs = 600000, reconnectGraceMs = 90000, idleLobbyMs = 1800000 }) {
  const handlers = new Map();
  const track = maps.get('riviera').track;
  const lobbies = new Map(), clients = new Set(), sessions = new Map();
  const lobbyEvent = l => maps.get(l.mapId).definitions.get(l.eventId);
  // Any event the map defines is offered online (sprint, timetrial, pursuit,
  // taxi/getaway): no silent race-only coercion. Disabled maps leave every list.
  const onlineEvent = (id, mapId = 'riviera') => !!maps.get(mapId)?.definitions.get(id);
  const options = (mapId = 'riviera') => [...maps.get(mapId).definitions.values()].filter(e => onlineEvent(e.id, mapId)).map(({ id, name, type, s0, s1, dir, len, routeKey }) => ({ id, name, type, mapId, s0, s1, dir, len, routeKey }));
  const catalogue = () => [...maps].filter(([id]) => isMapEnabled(id)).map(([id, m]) => ({ id, name: m.name, track: m.track, events: options(id), trips: m.trips || { taxi: null, getaway: null } }));
  const publicLobby = (l, manifest = true) => {
    const def = lobbyEvent(l), event = effectiveEvent(def, l.config);
    const trips = manifest && isObjectiveMode(event?.type) ? (maps.get(l.mapId).trips || {})[event.type] || null : null;
    return { code: l.code, name: l.name, host: l.host, status: l.status, capacity: 8, players: [...l.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, ready: p.ready, finish: p.finish, dnf: p.dnf, connected: p.connected, plate: p.plate || null, objective: snapshotPlayerObjective(l, p.id), checkpoint: p.course ? courseStatus(p.course) : null })), blockedPlayers: manifest ? (l.blocks || []).filter(b => b.until > Date.now()).map(({ id, name, until }) => ({ id, name, until })) : undefined, eventId: l.eventId, traffic: l.traffic, event: trips ? { ...event, objectiveRoutes: trips } : event, mode: event?.type || 'sprint', config: { ...(l.config || {}) }, generation: l.generation || 0, results: l.status === 'results' ? [...l.racers.values()] : null, startAt: l.startAt, raceId: l.raceId, mapId: l.mapId, track: maps.get(l.mapId).track, allowedCars: [...(l.allowedCars || CARS)] };
  };
  const discover = () => ({ type: 'discovery', lobbies: [...lobbies.values()].filter(l => !l.private && isMapEnabled(l.mapId)).map(l => publicLobby(l, false)) });
  const publish = (l) => { l.touched = Date.now(); for (const p of l.players.values()) send(p.ws, { type: 'lobby', lobby: publicLobby(l) }); for (const c of clients) if (!c.lobby) send(c.ws, discover()); };
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
    // Server-authoritative multiplayer stats: placements come from the
    // validated finish times above, never from client claims.
    if (accounts) try {
      const event = lobbyEvent(l);
      const order = [...l.racers.values()].filter(p => p.finish !== null).sort((a, b) => a.finish - b.finish);
      const place = new Map(order.map((p, i) => [p.id, i + 1]));
      const subs = [...l.racers.values()].map(p => l.players.get(p.id)?.accountSub || null);
      accounts.recordMpResults([...l.racers.values()].map((p, i) => ({ sub: subs[i], car: p.car, finish: p.finish, placement: place.get(p.id) || null })), { mapId: l.mapId, eventId: l.eventId, traffic: l.traffic, km: (event?.len || 0) / 1000 });
      if (friends) try { friends.recordMatch(subs); } catch (e) { console.error('Recent-players save failed:', e.message); }
      presencePush(subs);
    } catch (e) { console.error('Account stats save failed:', e.message); }
    publish(l);
  };
  // A verified login links the connection to its Google identity. The
  // USERNAME becomes the license plate (p.plate) broadcast in lobby state;
  // connections without a username keep a random plate and accrue no stats.
  const linkAccount = (c, ticket) => {
    if (!accounts || typeof ticket !== 'string' || !ticket) return null;
    const a = accounts.verifyTicket(ticket);
    if (!a) return null;
    c.accountSub = a.sub; c.accountName = a.username || null; c.plate = a.username || null;
    return a;
  };
  const linkSession = (ws, id) => {
    const c = [...clients].find(c => c.ws === ws);
    if (!c || !accounts) return null;
    const a = accounts.verifySession(id);
    if (!a) return null;
    c.accountSub = a.sub; c.accountName = a.username || null; c.plate = a.username || null;
    return a;
  };
  // Presence is derived live from connections: online/menu/in-lobby/racing
  // plus a joinable lobby code. Nothing is stored or polled; snapshots are
  // pushed only when they change (see presencePush).
  const presenceOf = (subs) => {
    const out = new Map();
    for (const sub of subs || []) {
      const c = [...clients].find(c => c.connected && c.accountSub === sub);
      if (!c) { out.set(sub, { online: false }); continue; }
      const l = c.lobby;
      out.set(sub, {
        online: true, activity: !l ? 'menu' : l.status === 'waiting' || l.status === 'results' ? 'lobby' : 'racing',
        lobbyCode: l ? l.code : null, lobbyName: l ? l.name : null, mapId: l ? l.mapId : null,
        joinable: !!l && l.status === 'waiting' && !l.private && l.players.size < 8,
      });
    }
    return out;
  };
  const friendSnapshot = (sub) => ({ type: 'friends', self: sub, ...friends.list(sub, presenceOf(friends.peers(sub).concat([sub]))) });
  // Push fresh friend/presence snapshots to `subs` and everyone sharing a
  // friend edge with them (their snapshot embeds the changed presence).
  // Per-connection caching keeps repeated calls (e.g. lobby publishes)
  // silent unless something actually changed.
  const presencePush = (subs) => {
    if (!friends) return;
    const todo = new Set((subs || []).filter(Boolean));
    for (const sub of [...todo]) for (const peer of friends.peers(sub)) todo.add(peer);
    for (const sub of todo) {
      let snap;
      try { snap = friendSnapshot(sub); } catch { continue; }
      const text = JSON.stringify(snap);
      for (const c of clients) {
        if (!c.connected || c.accountSub !== sub || c.friendsSent === text) continue;
        c.friendsSent = text; send(c.ws, snap);
      }
    }
  };
  const notify = (sub, data) => {
    for (const c of clients) if (c.connected && c.accountSub === sub) send(c.ws, { type: 'notify', ...data });
  };
  // A username claim/rename refreshes plates in every lobby view showing
  // this connection, then re-pushes friends snapshots carrying the name.
  const refreshAccount = (sub) => {
    if (!accounts) return;
    const row = accounts.get(sub);
    for (const c of clients) {
      if (c.accountSub !== sub) continue;
      c.accountName = row?.username || null; c.plate = row?.username || null;
      if (c.lobby) publish(c.lobby);
    }
    presencePush([sub]);
  };
  // Host-submitted car lists must be a non-empty deduped subset of the
  // Host-submitted car lists must be a non-empty deduped subset of the
  // server catalogue; anything else is rejected, never coerced silently.
  const sanitizeCarList = (ids) => {
    if (!Array.isArray(ids)) return null;
    const list = [...new Set(ids.filter(id => CARS.has(id)))].slice(0, 64);
    return list.length ? list : null;
  };
  const leave = (c) => {
    const l = c.lobby; if (!l) return;
    const sub = c.accountSub;
    const racer = l.racers?.get(c.id); if (racer) { racer.disconnected = true; if (racer.finish === null && !racer.dnf) racer.dnf = true; }
    l.players.delete(c.id); c.lobby = null; c.ready = false; c.state = null; c.stateAt = null; clearObjectiveHold(l, c.id); l.objectives?.delete(c.id);
    if (!l.players.size) lobbies.delete(l.code);
    else {
      if (l.status === 'countdown' && [...l.players.values()].filter(p => p.connected).length < 2) { l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null; l.objectives = null; l.objectiveTrips = null; for (const p of l.players.values()) p.ready = false; }
      if (l.host === c.id) l.host = [...l.players.values()].find(p => p.connected)?.id || l.players.keys().next().value; if (['countdown', 'race'].includes(l.status) && [...l.players.values()].every(p => p.finish !== null || p.dnf)) results(l); publish(l); }
    for (const other of clients) if (!other.lobby) send(other.ws, discover());
    presencePush([sub]);
  };
  const connect = (ws, ip) => {
    if ([...clients].filter(c => c.ip === ip).length >= 24) { ws.close(1013, 'Too many connections'); return; }
    let c = { ws, ip, token: randomHex(32), connected: true, touched: Date.now(), id: randomUUID(), name: 'DRIVER', car: 'mini', ready: false, finish: null, state: null, lobby: null, alive: true, messages: 0, window: Date.now(), accountSub: null, accountName: null, plate: null, friendsSent: null };
    sessions.set(c.token, c); clients.add(c); send(ws, { type: 'hello', features: { stateBatching: true, wreckDnf: true }, id: c.id, token: c.token, now: Date.now(), track, maps: catalogue(), events: [...maps.keys()].flatMap(options) }); send(ws, discover());
    bind(c, ws, ip);
  };
  const bind = (initial, ws, ip) => {
    let c = initial;
    handlers.set(ws, { pong: () => { c.alive = true; },
    message: bytes => {
      if (c.ws !== ws) return;
      const now = Date.now(); if (now - c.window > 1000) { c.window = now; c.messages = 0; } if (++c.messages > 80) { ws.close(1008, 'Rate limit'); return; }
      const error = (message, extra = {}) => send(ws, { type: 'error', message, ...extra });
      const hostRate = (l, action) => {
        l.hostActions ||= {};
        if (now - (l.hostActions[action] ?? -Infinity) < 1000) { error('Please wait before repeating this host action.'); return false; }
        l.hostActions[action] = now; return true;
      };
      try {
        const m = JSON.parse(bytes); if (!m || typeof m !== 'object') return;
        // A packet carries up to two 10 Hz samples. Keep the legacy single-sample
        // protocol for old clients; apply identical validation and receipt-clock timing.
        if (m.type === 'states') {
          if (!Array.isArray(m.states) || !m.states.length || m.states.length > 2) return error('Invalid state batch.');
          for (const state of m.states) handlers.get(ws).message(JSON.stringify({ type: 'state', raceId: m.raceId, state }));
          return;
        }
        if (m.type === 'resume') {
          if (c.lobby) return error('Leave your current lobby before resuming another session.');
          const prior = sessions.get(m.token);
          if (!prior || prior === c || (!prior.connected && Date.now() - prior.touched > reconnectGraceMs)) { send(ws, { type: 'session', id: c.id, token: c.token, resumed: false }); return; }
          sessions.delete(c.token); clients.delete(c);
          const previousWs = prior.ws; c = prior; c.ws = ws; c.ip = ip; c.connected = true; c.alive = true; c.messages = 0; c.window = now; c.touched = now;
          clients.add(c); if (previousWs !== ws) previousWs.close(1000, 'Session resumed elsewhere');
          const racer = c.lobby?.racers?.get(c.id); if (racer) racer.disconnected = false;
          send(ws, { type: 'session', id: c.id, token: c.token, resumed: true, lobby: !!c.lobby });
          if (c.lobby) { send(ws, { type: 'lobby', lobby: publicLobby(c.lobby), resume: true, state: c.state }); publish(c.lobby); }
          return;
        }
        const l = c.lobby;
        if (m.type === 'ping') { send(ws, { type: 'pong', now, sent: m.sent }); return; }
        if (m.type === 'discover') { send(ws, discover()); return; }
        if (m.type === 'auth') {
          if (!accounts) return error('This server is guest-only. Sign in on the Cloudflare game.');
          const a = linkAccount(c, m.ticket);
          if (!a) return error('Unknown or expired login ticket. Fetch a new one.');
          send(ws, { type: 'account', account: { username: a.username, displayName: a.displayName } });
          if (c.lobby) publish(c.lobby);
          presencePush([c.accountSub]);
          return;
        }
        if (m.type === 'leave') { leave(c); send(ws, { type: 'left' }); return; }
        if (m.type === 'create' || m.type === 'join') {
          if (l) return error('Leave your current lobby first.');
          c.name = clean(m.name, 'DRIVER'); c.car = CARS.has(m.car) ? m.car : 'mini';
          c.ready = false; c.finish = null; c.dnf = false; c.state = null; c.stateAt = null;
          c.driverId = /^[a-zA-Z0-9_-]{8,64}$/.test(m.driverId || '') ? m.driverId : c.id;
          linkAccount(c, m.ticket);
          let dest;
          if (m.type === 'create') {
            if (m.mapId !== undefined && !maps.has(m.mapId)) return error('Unknown map.');
            const mapId = m.mapId || 'riviera';
            const defs = maps.get(mapId).definitions;
            const wantedEvent = m.eventId ?? options(mapId)[0]?.id;
            if (wantedEvent === undefined || !defs.has(wantedEvent)) return error('Unknown race route for this map.');
            const modeBlock = assertModeAllowed(defs.get(wantedEvent), maps.get(mapId).closed === true);
            if (modeBlock) return error(modeBlock);
            if (!isMapEnabled(mapId)) return error('Map unavailable.');
            if (lobbies.size >= 64) return error('Lobby limit reached. Join an existing lobby.');
            let code; do { code = randomHex(3).toUpperCase(); } while (lobbies.has(code));
            dest = { code, name: clean(m.lobbyName, `${c.name}'S RACE`), host: c.id, private: m.private === true, players: new Map(), status: 'waiting', startAt: null, raceId: null, generation: 0, mapId, eventId: wantedEvent, traffic: true, config: null, allowedCars: sanitizeCarList(m.allowedCars) || [...CARS] };
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
            const block = dest.blocks.find(b => b.token === c.token || b.driverId === c.driverId || c.accountSub && b.accountSub === c.accountSub || b.ip === c.ip);
            if (block) return error('You were kicked from this lobby. Wait for the cooldown or ask the host to unblock you.', { code: 'KICK_COOLDOWN', until: block.until, lobbyCode: dest.code });
            if (dest.status !== 'waiting') return error('This lobby is already racing.');
            if (dest.players.size >= 8) return error('This lobby is full.');
            if (!isMapEnabled(dest.mapId)) return error('Map unavailable.');
          }
          if (!Array.isArray(dest.allowedCars)) dest.allowedCars = [...CARS];
          if (!dest.allowedCars.includes(c.car)) c.car = dest.allowedCars[0];
          c.lobby = dest; dest.players.set(c.id, c); publish(dest); presencePush([c.accountSub]); return;
        }
        if (!l) return error('Join a lobby first.');
        if (m.type === 'options') {
          if (l.host !== c.id) return error('Only the host can change the lobby setup.');
          const mapId = m.mapId ?? l.mapId;
          if (!maps.has(mapId)) return error('Unknown map.');
          const defs = maps.get(mapId).definitions;
          const eventId = m.eventId ?? (mapId === l.mapId ? l.eventId : options(mapId)[0]?.id);
          if (eventId === undefined || !defs.has(eventId)) return error('Unknown race route for this map.');
          const modeBlock = assertModeAllowed(defs.get(eventId), maps.get(mapId).closed === true);
          if (modeBlock) return error(modeBlock);
          if (!isMapEnabled(mapId)) return error('Map unavailable.');
          let allowedChanged = false;
          const newlyDisallowed = [];
          if (m.allowedCars !== undefined) {
            const list = sanitizeCarList(m.allowedCars);
            if (!list) return error('Allow at least one car.');
            for (const p of l.players.values()) if (!list.includes(p.car)) newlyDisallowed.push(p.id);
            allowedChanged = list;
          }
          const incoming = { ...(m.config || {}) };
          if (m.traffic !== undefined && incoming.traffic === undefined) incoming.traffic = m.traffic === true ? 1 : 0;
          const cfg = sanitizeConfig(incoming);
          if (cfg.error) return error(cfg.error);
          if (allowedChanged) {
            l.allowedCars = allowedChanged;
            for (const id of newlyDisallowed) { const p = l.players.get(id); p.car = l.allowedCars[0]; p.ready = false; }
          }
          const prevConfig = l.config || {};
          const nextConfig = { ...prevConfig, ...cfg.config };
          const mapChanged = mapId !== l.mapId, eventChanged = eventId !== l.eventId;
          const raceChanged = mapChanged || eventChanged || configInvalidates(prevConfig, nextConfig);
          l.mapId = mapId; l.eventId = eventId; l.config = nextConfig; l.traffic = nextConfig.traffic > 0; l.police = nextConfig.police === true;
          if (isObjectiveMode(defs.get(eventId).type)) l.objectiveTrips = (maps.get(mapId).trips || {})[defs.get(eventId).type] || null; else l.objectiveTrips = null;
          // A setup edit during a live or finished race cancels cleanly to a
          // waiting lobby on the same room code; waiting-room edits invalidate
          // readiness only when the offered race actually changed, and an
          // allow-list shrink unreadies only drivers it disallows.
          if (['countdown', 'race', 'results'].includes(l.status) && (mapChanged || eventChanged || raceChanged || allowedChanged)) cancelToWaiting(l);
          else if (raceChanged) for (const p of l.players.values()) p.ready = false;
          else if (allowedChanged) for (const id of newlyDisallowed) { const p = l.players.get(id); if (p) p.ready = false; }
          publish(l); return;
        }
        if (m.type === 'car' || m.type === 'ready') {
          const carOnly = m.type === 'car' || m.car !== undefined && m.ready !== true;
          if (l.status !== 'waiting' && !(l.status === 'results' && carOnly)) return error('The race has already started.');
          // Car-only updates (ready:false/undefined) never need the track
          // version, so guests keep choosing cars while the lobby track loads.
          if (m.ready === true && ((m.mapId !== undefined && m.mapId !== l.mapId) || m.version !== maps.get(l.mapId).track.version)) return error('The track changed. Reload the game to join this race.');
          if (m.car !== undefined && !CARS.has(m.car)) return error('Unknown car.');
          if (m.car !== undefined && !l.allowedCars.includes(m.car)) return error('That car is not allowed in this lobby.');
          if (CARS.has(m.car)) c.car = m.car;
          if (m.ready === true && !l.allowedCars.includes(c.car)) return error('Your car is not allowed in this lobby. Pick an allowed car.');
          c.ready = m.ready === true; publish(l); return;
        }
        if (m.type === 'kick' || m.type === 'unblock') {
          if (l.host !== c.id) return error('Only the host can moderate the lobby.');
          if (!['waiting', 'results'].includes(l.status)) return error('Return to the lobby before removing a driver.');
          if (m.type === 'unblock') {
            if (!hostRate(l, 'unblock')) return;
            l.blocks = (l.blocks || []).filter(b => b.id !== m.id && b.until > now); publish(l); return;
          }
          const target = l.players.get(m.id);
          if (!target || target === c) return error('Choose another lobby driver.');
          if (!hostRate(l, 'kick')) return;
          const until = now + 30000;
          l.blocks = (l.blocks || []).filter(b => b.until > now && b.id !== target.id).slice(-63);
          l.blocks.push({ id: target.id, name: target.name, until, token: target.token, driverId: target.driverId, accountSub: target.accountSub, ip: target.ip });
          leave(target); send(target.ws, { type: 'kicked', lobbyCode: l.code, until, message: 'The host removed you from this lobby. You can rejoin in 30 seconds, or when the host unblocks you.' });
          publish(l); return;
        }
        if (m.type === 'start') {
          if (l.host !== c.id) return error('Only the host can start the race.');
          // A stale client retrying start after results converges to waiting
          // instead of erroring: the host presses start again to launch.
          if (l.status === 'results') { cancelToWaiting(l); publish(l); return; }
          if (![...l.players.values()].every(p => l.allowedCars.includes(p.car))) return error('A driver picked a car the host disallowed.');
          const connected = [...l.players.values()].filter(p => p.connected);
          if (l.status !== 'waiting' || connected.length < 2 || m.force !== true && ![...l.players.values()].every(p => p.ready && p.connected)) return error('At least two drivers must be ready, or the host can force start two connected drivers.');
          if (m.force === true && !hostRate(l, 'start')) return;
          // Force start pulls in connected drivers; stale reservations leave the room.
          if (m.force === true) for (const p of [...l.players.values()]) { if (!p.connected) leave(p); else p.ready = true; }
          l.status = 'countdown'; l.startAt = now + countdownMs; l.raceId = randomUUID(); nextGeneration(l);
          presencePush([...l.players.values()].map(p => p.accountSub));
          for (const p of l.players.values()) { p.state = null; p.stateAt = null; p.finish = null; p.dnf = false; p.enfPenalty = 0; p.enfSeen = null; p.course = null; }
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
          if (!['countdown', 'race'].includes(l.status)) return error('Nothing to restart yet.');
          restartRace(l, randomUUID(), now + countdownMs);
          if (isObjectiveMode(lobbyEvent(l)?.type)) startObjectiveRound(l, { mode: lobbyEvent(l).type, raceId: l.raceId, startAtMs: l.startAt });
          presencePush([...l.players.values()].map(p => p.accountSub));
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
        if (m.type === 'violation') {
          // Laws link follows the lobby police toggle; claims are bound to
          // the sender's live race, generation and accepted snapshot.
          if (l.status !== 'race' || now < l.startAt || m.raceId !== l.raceId || (m.generation !== undefined && m.generation !== (l.generation || 0)) || c.finish !== null || c.dnf) return;
          if (l.config?.police !== true || l.config?.enforcement?.enabled === false) return;
          const map = maps.get(l.mapId);
          const rules = { ...(lobbyEvent(l)?.rules || {}) };
          if (Number.isFinite(l.config?.enforcement?.penalty)) rules.penalty = l.config.enforcement.penalty;
          if (Number.isFinite(l.config?.enforcement?.cameraPenalty)) rules.cameraPenalty = l.config.enforcement.cameraPenalty;
          if (c.enforcement?.raceId !== l.raceId || c.enforcement?.generation !== (l.generation || 0) || !(c.enforcement?.claims instanceof Map)) c.enforcement = createEnforcementState(l.raceId, l.generation || 0);
          const v = validateViolation(m, {
            enabled: true, active: true, raceId: l.raceId, generation: l.generation || 0, mapId: l.mapId, now,
            state: c.state, stateAt: c.stateAt,
            dir: (publicLobby(l).event?.dir || 1) * (c.state?.reverse === true ? -1 : 1),
            enforcement: c.enforcement, rules,
            cameras: (map.enforcement || {}).cameras || [], redSites: (map.enforcement || {}).redSites || [],
            at: m.at,
          });
          if (!v.accept) return;
          const penaltySec = Number.isFinite(v.penaltySec) ? v.penaltySec : penaltyFor(m.kind, rules);
          let fine = penaltySec;
          if (isObjectiveMode(lobbyEvent(l)?.type) && l.objectives?.has(c.id)) fine = applyObjectivePenalty(l, c.id, penaltySec);
          else c.enfPenalty = (c.enfPenalty || 0) + penaltySec;
          l.dirty = true; send(c.ws, { type: 'violation-ack', id: m.id, kind: m.kind, label: v.label || v.siteId || m.kind, siteId: v.siteId || null, penaltySec: fine, penalty: c.enfPenalty || 0, raceId: l.raceId, generation: l.generation || 0 }); return;
        }
        if (m.type === 'recover') {
          if (l.status !== 'race' || m.raceId !== l.raceId || m.generation !== undefined && m.generation !== l.generation || c.finish !== null || c.dnf) return;
          const nextGate = c.course?.gates[c.course.passed], event = publicLobby(l).event;
          // Recovery must not place the car beyond an unpassed gate.
          if (nextGate && c.recoveryRoad && (c.recoveryRoad.s - nextGate.s) * event.dir >= 0) c.recoveryRoad = { s: nextGate.s - event.dir * 3, u: 0 };
          const recovery = requestRecovery(c, event, l.raceId, m.motionEpoch, now);
          if (!recovery) return error('Recovery needs a current race position.');
          clearObjectiveHold(l, c.id);
          l.dirty = true; send(c.ws, { type: 'recovered', generation: l.generation, ...recovery }); return;
        }
        if (m.type === 'dnf') {
          if (!['countdown', 'race'].includes(l.status) || now < l.startAt || m.raceId !== l.raceId || m.generation !== undefined && m.generation !== l.generation || c.finish !== null || c.dnf) return;
          if (!['retired', 'wrecked'].includes(m.reason)) return error('Unknown DNF reason.');
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
          if (!recoveryStateAllowed(c, s, l.raceId, now)) return;
          const zones = ['front', 'rear', 'left', 'right'];
          if (s.nitro !== undefined && (!Number.isFinite(s.nitro) || s.nitro < 0 || s.nitro > 1)) return;
          if (s.damage !== undefined && (!s.damage || zones.some(k => !Number.isFinite(s.damage[k]) || s.damage[k] < 0 || s.damage[k] > 1))) return;
          if (Math.abs(s.x) > 100000 || Math.abs(s.z) > 100000 || Math.abs(s.y) > 10000 || Math.abs(s.u) > 500 || s.s < Math.min(event.s0, event.s1) - 500 || s.s > Math.max(event.s0, event.s1) + 500 || Math.abs(s.vLong) > 150 || Math.abs(s.vLat) > 150 || s.rpm < 0 || s.rpm > 20000 || s.gear < 1 || s.gear > 10) return;
          // Client physics with bounded progress; the server owns race timing/results.
          const prevS = c.state?.s ?? event.s0;
          const elapsed = Math.max(0, (now - Math.max(c.stateAt ?? l.startAt, c.recovery?.raceId === l.raceId ? c.recovery.until : l.startAt)) / 1000);
          const courseEnabled = !isObjectiveMode(event.type) && event.type !== 'free';
          if (courseEnabled && c.course?.raceId !== l.raceId) c.course = { ...buildCourse(event, maps.get(l.mapId).geometry), raceId: l.raceId };
          const recovered = c.recovery?.raceId === l.raceId && now <= c.recovery.until;
          const previousPose = c.state || c.course?.previous;
          const discontinuous = Math.abs(s.s - prevS) > 30 + 150 * (courseEnabled ? Math.min(5, elapsed) : elapsed) || !recovered && previousPose && Math.hypot(s.x - previousPose.x, s.z - previousPose.z) > 15 + 150 * (courseEnabled ? Math.min(5, elapsed) : elapsed);
          if (discontinuous) {
            if (c.course && !c.course.missed) { c.course.missed = true; send(c.ws, { type: 'checkpoint', raceId: l.raceId, generation: l.generation, ...courseStatus(c.course) }); }
            return;
          }
          if (courseEnabled) {
            const before = JSON.stringify(courseStatus(c.course));
            observeCourse(c.course, s, now / 1000, { initialTime: l.startAt / 1000, recovery: recovered });
            const status = courseStatus(c.course);
            if (JSON.stringify(status) !== before) send(c.ws, { type: 'checkpoint', raceId: l.raceId, generation: l.generation, ...status });
          }
          c.state = { ...Object.fromEntries(fields.map(k => [k, s[k]])), nitro: nitrousCars.has(c.car) ? s.nitro ?? c.state?.nitro ?? 0.4 : 0, damage: s.damage ? Object.fromEntries(zones.map(k => [k, s.damage[k]])) : c.state?.damage ?? Object.fromEntries(zones.map(k => [k, 0])), reverse: s.reverse === true, ...(typeof s.paint === 'string' && /^#[a-f\d]{6}$/i.test(s.paint) ? {paint:s.paint.toLowerCase()} : c.state?.paint ? {paint:c.state.paint} : {}), driver: normalizeDriverAppearance(s.driver === undefined ? c.state?.driver : s.driver) }; c.stateAt = now; l.dirty = true;
          Object.assign(c.state, validateStateExtras(s));
          if (c.enforcement?.raceId !== l.raceId || c.enforcement?.generation !== (l.generation || 0) || !(c.enforcement?.claims instanceof Map)) c.enforcement = createEnforcementState(l.raceId, l.generation || 0);
          observeEnforcementState(c.enforcement, c.state, [...((maps.get(l.mapId).enforcement || {}).cameras || []), ...((maps.get(l.mapId).enforcement || {}).redSites || [])], now);
          if (l.objectives && c.finish === null && !c.dnf && stepPlayerObjective(l, c.id, now, { x: s.x, y: s.y, z: s.z, vLong: s.vLong, vLat: s.vLat }).length) publish(l);
          // Optional render clock only; progress checks and finishes use server receipt time.
          if (Number.isFinite(s.sampleTime) && s.sampleTime >= 0 && s.sampleTime <= 1e12) {
            c.state.sampleTime = s.sampleTime;
            c.state.sampleAge = Number.isFinite(s.sampleAge) ? Math.max(0, Math.min(1000, s.sampleAge)) : 0;
            if (Number.isSafeInteger(s.motionEpoch) && s.motionEpoch >= 0) c.state.motionEpoch = s.motionEpoch;
          }
          rememberRecoveryRoad(c, event, l.raceId);
          // Objective modes never take the crossing finish; reversed runs keep
          // their time but stay off the leaderboard. Fines add into the finish.
          if (c.finish === null && !isObjectiveMode(event.type) && c.course?.passed === c.course?.gates.length && (s.s - event.s1) * event.dir >= 0 && Math.abs(s.u) < 30) {
            c.finish = (now - l.startAt) / 1000 + (c.enfPenalty || 0); l.racers.get(c.id).finish = c.finish; publish(l);
            if (!l.config?.reverse) leaderboard.submit({ driverId: c.driverId || c.id, name: c.name, car: c.car, eventId: l.eventId, mapId: l.mapId, traffic: l.traffic, time: c.finish, source: 'online' }).catch(e => { if (!e.status) console.error('Leaderboard save failed:', e.message); });
            if ([...l.players.values()].every(p => p.finish !== null || p.dnf)) results(l);
          }
        }
      } catch { error('Invalid message.'); }
    },
    close: () => {
      if (c.ws !== ws) return;
      clients.delete(c); c.connected = false; c.touched = Date.now();
      presencePush([c.accountSub]);
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
        if (now > l.startAt + raceLimitFor(l, raceLimitMs)) { results(l); continue; }
        // Objective rounds advance on the receipt clock even for parked
        // drivers; an all-done round ends the race like a full finish.
        if (l.objectives && l.status === 'race') {
          let moved = false;
          for (const id of [...l.objectives.keys()]) { if (stepPlayerObjective(l, id, now, null).length) moved = true; }
          if (moved) { l.dirty = true; publish(l); }
          if ([...l.objectives.values()].every(o => o.done)) { results(l); continue; }
        }
        if (!l.dirty) continue; l.dirty = false;
        const players = [...l.players.values()].map(p => ({ id: p.id, state: p.state, stateAt: p.stateAt, finish: p.finish, dnf: p.dnf, objective: snapshotPlayerObjective(l, p.id), checkpoint: p.course ? courseStatus(p.course) : null }));
        for (const p of l.players.values()) send(p.ws, { type: 'snapshot', raceId: l.raceId, generation: l.generation || 0, now, players });
      }
    }
  };
  const clientData = c => { const { ws, lobby, ...data } = c; return { ...data, lobbyCode: lobby?.code || null }; };
  const exportState = () => ({ sessions: [...sessions.values()].map(clientData), lobbies: [...lobbies.values()].map(l => { const { players, racers, objectives, ...data } = l; return { ...data, playerIds: [...players.keys()], racers: racers ? [...racers] : null, objectives: objectives ? [...objectives] : null }; }) });
  const restore = (saved, sockets = new Map()) => {
    for (const data of saved?.sessions || []) {
      const ws = sockets.get(data.token) || { readyState: 3, close() {} };
      const c = { ...data, ws, lobby: null, connected: sockets.has(data.token) };
      if (c.state) { const { decals, ...state } = c.state; c.state = state; }
      if (c.state && !nitrousCars.has(c.car)) c.state = { ...c.state, nitro: 0 };
      sessions.set(c.token, c); if (c.connected) { clients.add(c); bind(c, ws, c.ip); }
    }
    const byId = new Map([...sessions.values()].map(c => [c.id, c]));
    for (const data of saved?.lobbies || []) {
      if (!maps.has(data.mapId) || !maps.get(data.mapId).definitions.has(data.eventId)) continue;
      const l = { ...data, players: new Map(), racers: data.racers ? new Map(data.racers) : null, objectives: data.objectives ? new Map(data.objectives) : null };
      if (!l.config) l.config = defaultConfig(maps.get(data.mapId)?.definitions.get(data.eventId));
      if (l.objectives) l.objectiveTrips = (maps.get(data.mapId)?.trips || {})[maps.get(data.mapId)?.definitions.get(data.eventId)?.type] || null;
      if (!Array.isArray(l.allowedCars)) l.allowedCars = [...CARS];
      for (const id of data.playerIds) { const c = byId.get(id); if (c) { l.players.set(id, c); c.lobby = l; } }
      if (l.players.size) lobbies.set(l.code, l);
    }
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
  return { connect, message: (ws, bytes) => handlers.get(ws)?.message(bytes), disconnect: ws => { handlers.get(ws)?.close(); handlers.delete(ws); }, pong: ws => handlers.get(ws)?.pong(), tick, nextWake, exportState, restore, linkSession, refreshAccount, presenceOf, presencePush, notify, clientData: ws => { const c = [...clients].find(c => c.ws === ws); return c && clientData(c); }, discover, publicLobby, lobbies, clients, sessions, track };
}
