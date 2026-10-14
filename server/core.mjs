import { packDecals, unpackDecals } from '../src/vehicle-decal-data.js';
import { normalizeDriverAppearance } from '../src/driver-appearance-data.js';
import { stripUnownedPhotos } from './appearance-state.mjs';
import { rememberRecoveryRoad, requestRecovery, recoveryStateAllowed } from './race-recovery.mjs';
import { isMapEnabled } from '../src/enabled-maps.js';
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
  const onlineEvent = (id, mapId = 'riviera') => ['sprint', 'timetrial'].includes(maps.get(mapId)?.definitions.get(id)?.type);
  const options = (mapId = 'riviera') => [...maps.get(mapId).definitions.values()].filter(e => onlineEvent(e.id, mapId)).map(({ id, name, s0, s1, dir, len, routeKey }) => ({ id, name, mapId, s0, s1, dir, len, routeKey }));
  const catalogue = () => [...maps].filter(([id]) => isMapEnabled(id)).map(([id, m]) => ({ id, name: m.name, track: m.track, events: options(id) }));
  const publicLobby = (l) => ({ code: l.code, name: l.name, host: l.host, status: l.status, capacity: 8, players: [...l.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, ready: p.ready, finish: p.finish, dnf: p.dnf, connected: p.connected, plate: p.plate || null })), eventId: l.eventId, traffic: l.traffic, event: lobbyEvent(l), results: l.status === 'results' ? [...l.racers.values()] : null, startAt: l.startAt, raceId: l.raceId, mapId: l.mapId, track: maps.get(l.mapId).track, allowedCars: [...(l.allowedCars || CARS)] });
  const discover = () => ({ type: 'discovery', lobbies: [...lobbies.values()].filter(l => !l.private && isMapEnabled(l.mapId)).map(publicLobby) });
  const publish = (l) => { l.touched = Date.now(); for (const p of l.players.values()) send(p.ws, { type: 'lobby', lobby: publicLobby(l) }); for (const c of clients) if (!c.lobby) send(c.ws, discover()); };
  const results = (l) => {
    if (l.status === 'results') return;
    l.status = 'results';
    for (const p of l.players.values()) if (p.finish === null && !p.dnf) p.dnf = true;
    for (const p of l.racers.values()) if (p.finish === null && !p.dnf) p.dnf = true;
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
    l.players.delete(c.id); c.lobby = null; c.ready = false; c.state = null; c.stateAt = null;
    if (!l.players.size) lobbies.delete(l.code);
    else {
      if (l.status === 'countdown' && [...l.players.values()].filter(p => p.connected).length < 2) { l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null; for (const p of l.players.values()) p.ready = false; }
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
      const error = message => send(ws, { type: 'error', message });
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
            if (m.eventId !== undefined && !onlineEvent(m.eventId, mapId)) return error('Unknown race route for this map.');
            if (!isMapEnabled(mapId)) return error('Map unavailable.');
            if (lobbies.size >= 64) return error('Lobby limit reached. Join an existing lobby.');
            let code; do { code = randomHex(3).toUpperCase(); } while (lobbies.has(code));
            dest = { code, name: clean(m.lobbyName, `${c.name}'S RACE`), host: c.id, private: m.private === true, players: new Map(), status: 'waiting', startAt: null, raceId: null, mapId, eventId: m.eventId || options(mapId)[0]?.id, traffic: m.traffic === true, allowedCars: sanitizeCarList(m.allowedCars) || [...CARS] };
            lobbies.set(code, dest);
          } else {
            dest = lobbies.get(String(m.code).trim().toUpperCase());
            if (!dest) return error('Lobby not found. Check the code or refresh the list.');
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
          if (l.host !== c.id || l.status !== 'waiting') return error('Only the host can change a waiting lobby.');
          const mapId = m.mapId ?? l.mapId;
          if (!maps.has(mapId)) return error('Unknown map.');
          const eventId = m.eventId ?? (mapId === l.mapId ? l.eventId : options(mapId)[0]?.id);
          if (!onlineEvent(eventId, mapId)) return error('Unknown race route for this map.');
          if (!isMapEnabled(mapId)) return error('Map unavailable.');
          if (m.allowedCars !== undefined) {
            const list = sanitizeCarList(m.allowedCars);
            if (!list) return error('Allow at least one car.');
            l.allowedCars = list;
          }
          l.mapId = mapId; l.eventId = eventId; l.traffic = m.traffic === true;
          for (const p of l.players.values()) p.ready = false;
          publish(l); return;
        }
        if (m.type === 'ready') {
          if (l.status !== 'waiting') return error('The race has already started.');
          if ((m.mapId !== undefined && m.mapId !== l.mapId) || m.version !== maps.get(l.mapId).track.version) return error('The track changed. Reload the game to join this race.');
          if (m.car !== undefined && CARS.has(m.car) && !l.allowedCars.includes(m.car)) return error('That car is not allowed in this lobby.');
          if (CARS.has(m.car)) c.car = m.car;
          if (m.ready === true && !l.allowedCars.includes(c.car)) return error('Your car is not allowed in this lobby. Pick an allowed car.');
          c.ready = m.ready === true; publish(l); return;
        }
        if (m.type === 'start') {
          if (l.host !== c.id) return error('Only the host can start the race.');
          if (![...l.players.values()].every(p => l.allowedCars.includes(p.car))) return error('A driver picked a car the host disallowed.');
          if (l.status !== 'waiting' || l.players.size < 2 || ![...l.players.values()].every(p => p.ready && p.connected)) return error('At least two drivers must be ready.');
          l.status = 'countdown'; l.startAt = now + countdownMs; l.raceId = randomUUID();
          presencePush([...l.players.values()].map(p => p.accountSub));
          for (const p of l.players.values()) { p.state = null; p.stateAt = null; p.finish = null; p.dnf = false; }
          l.racers = new Map([...l.players.values()].map(p => [p.id, { id: p.id, name: p.name, car: p.car, finish: null, dnf: false, disconnected: false }]));
          publish(l); return;
        }
        if (m.type === 'rematch') {
          if (l.host !== c.id || l.status !== 'results') return error('The host can arrange a rematch after the race.');
          l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null;
          for (const p of l.players.values()) { p.ready = false; p.finish = null; p.dnf = false; p.state = null; p.stateAt = null; }
          publish(l); return;
        }
        if (m.type === 'recover') {
          if (l.status !== 'race' || m.raceId !== l.raceId || m.generation !== undefined && m.generation !== l.generation || c.finish !== null || c.dnf) return;
          const recovery = requestRecovery(c, publicLobby(l).event, l.raceId, m.motionEpoch, now);
          if (!recovery) return error('Recovery needs a current race position.');
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
        if (m.type === 'state' && !c.dnf && ['countdown', 'race'].includes(l.status) && now >= l.startAt && m.raceId === l.raceId ) {
          const fields = ['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear'];
          if (!m.state || fields.some(k => !Number.isFinite(m.state[k]))) return;
          const s = m.state, event = lobbyEvent(l);
          if (!recoveryStateAllowed(c, s, l.raceId, now)) return;
          const zones = ['front', 'rear', 'left', 'right'];
          if (s.nitro !== undefined && (!Number.isFinite(s.nitro) || s.nitro < 0 || s.nitro > 1)) return;
          if (s.damage !== undefined && (!s.damage || zones.some(k => !Number.isFinite(s.damage[k]) || s.damage[k] < 0 || s.damage[k] > 1))) return;
          if (Math.abs(s.x) > 100000 || Math.abs(s.z) > 100000 || Math.abs(s.y) > 10000 || Math.abs(s.u) > 500 || s.s < Math.min(event.s0, event.s1) - 500 || s.s > Math.max(event.s0, event.s1) + 500 || Math.abs(s.vLong) > 150 || Math.abs(s.vLat) > 150 || s.rpm < 0 || s.rpm > 20000 || s.gear < 1 || s.gear > 10) return;
          // Client physics with bounded progress; the server owns race timing/results.
          const prevS = c.state?.s ?? event.s0;
          const elapsed = Math.max(0, (now - Math.max(c.stateAt ?? l.startAt, c.recovery?.raceId === l.raceId ? c.recovery.until : l.startAt)) / 1000);
          if (Math.abs(s.s - prevS) > 30 + 150 * elapsed) return;
          c.state = { ...Object.fromEntries(fields.map(k => [k, s[k]])), nitro: nitrousCars.has(c.car) ? s.nitro ?? c.state?.nitro ?? 0.4 : 0, damage: s.damage ? Object.fromEntries(zones.map(k => [k, s.damage[k]])) : c.state?.damage ?? Object.fromEntries(zones.map(k => [k, 0])), reverse: s.reverse === true, ...(typeof s.paint === 'string' && /^#[a-f\d]{6}$/i.test(s.paint) ? {paint:s.paint.toLowerCase()} : c.state?.paint ? {paint:c.state.paint} : {}), decals: packDecals(stripUnownedPhotos(unpackDecals(s.decals === undefined ? c.state?.decals : s.decals), appearance, c.accountSub)), driver: normalizeDriverAppearance(s.driver === undefined ? c.state?.driver : s.driver) }; c.stateAt = now; l.dirty = true;
          // Optional render clock only; progress checks and finishes use server receipt time.
          if (Number.isFinite(s.sampleTime) && s.sampleTime >= 0 && s.sampleTime <= 1e12) {
            c.state.sampleTime = s.sampleTime;
            c.state.sampleAge = Number.isFinite(s.sampleAge) ? Math.max(0, Math.min(1000, s.sampleAge)) : 0;
            if (Number.isSafeInteger(s.motionEpoch) && s.motionEpoch >= 0) c.state.motionEpoch = s.motionEpoch;
          }
          rememberRecoveryRoad(c, event, l.raceId);
          if (c.finish === null && (s.s - event.s1) * event.dir >= 0 && Math.abs(s.u) < 30) {
            c.finish = (now - l.startAt) / 1000; l.racers.get(c.id).finish = c.finish; publish(l);
            leaderboard.submit({ driverId: c.driverId || c.id, name: c.name, car: c.car, eventId: l.eventId, mapId: l.mapId, traffic: l.traffic, time: c.finish, source: 'online' }).catch(e => { if (!e.status) console.error('Leaderboard save failed:', e.message); });
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
        if (l.status === 'countdown' && [...l.players.values()].filter(p => p.connected).length < 2) { l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null; for (const p of l.players.values()) p.ready = false; }
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
        if (now > l.startAt + raceLimitMs) { results(l); continue; }
        if (!l.dirty) continue; l.dirty = false;
        const players = [...l.players.values()].map(p => ({ id: p.id, state: p.state, stateAt: p.stateAt, finish: p.finish, dnf: p.dnf }));
        for (const p of l.players.values()) send(p.ws, { type: 'snapshot', raceId: l.raceId, now, players });
      }
    }
  };
  const clientData = c => { const { ws, lobby, ...data } = c; return { ...data, lobbyCode: lobby?.code || null }; };
  const exportState = () => ({ sessions: [...sessions.values()].map(clientData), lobbies: [...lobbies.values()].map(l => { const { players, racers, ...data } = l; return { ...data, playerIds: [...players.keys()], racers: racers ? [...racers] : null }; }) });
  const restore = (saved, sockets = new Map()) => {
    for (const data of saved?.sessions || []) {
      const ws = sockets.get(data.token) || { readyState: 3, close() {} };
      const c = { ...data, ws, lobby: null, connected: sockets.has(data.token) };
      if (c.state && !nitrousCars.has(c.car)) c.state = { ...c.state, nitro: 0 };
      sessions.set(c.token, c); if (c.connected) { clients.add(c); bind(c, ws, c.ip); }
    }
    const byId = new Map([...sessions.values()].map(c => [c.id, c]));
    for (const data of saved?.lobbies || []) {
      if (!maps.has(data.mapId) || !maps.get(data.mapId).definitions.has(data.eventId)) continue;
      const l = { ...data, players: new Map(), racers: data.racers ? new Map(data.racers) : null };
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
      if (['countdown', 'race'].includes(l.status)) at = Math.min(at, l.startAt + raceLimitMs + 1);
      else at = Math.min(at, l.touched + idleLobbyMs + 1);
    }
    return Number.isFinite(at) ? at : null;
  };
  return { connect, message: (ws, bytes) => handlers.get(ws)?.message(bytes), disconnect: ws => { handlers.get(ws)?.close(); handlers.delete(ws); }, pong: ws => handlers.get(ws)?.pong(), tick, nextWake, exportState, restore, linkSession, refreshAccount, presenceOf, presencePush, notify, clientData: ws => { const c = [...clients].find(c => c.ws === ws); return c && clientData(c); }, discover, publicLobby, lobbies, clients, sessions, track };
}
