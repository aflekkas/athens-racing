import { packDecals, unpackDecals } from '../src/vehicle-decal-data.js';
// Shared lobby/race protocol. Transports own sockets, persistence and wake-up scheduling.
const clean = (v, fallback, n = 28) => typeof v === 'string' ? v.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, n) || fallback : fallback;
const send = (ws, data) => { if (ws?.readyState === 1 && (ws.bufferedAmount || 0) < 65536) { try { ws.send(JSON.stringify(data)); } catch {} } };
const randomUUID = () => crypto.randomUUID();
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
export function createGameCore({ maps, cars: CARS, nitrousCars = new Set(), leaderboard, appearance = null, countdownMs = 4000, raceLimitMs = 600000, reconnectGraceMs = 90000, idleLobbyMs = 1800000 }) {
  const handlers = new Map();
  const track = maps.get('riviera').track;
  const lobbies = new Map(), clients = new Set(), sessions = new Map();
  const lobbyEvent = l => maps.get(l.mapId).definitions.get(l.eventId);
  const onlineEvent = (id, mapId = 'riviera') => ['sprint', 'timetrial'].includes(maps.get(mapId)?.definitions.get(id)?.type);
  const options = (mapId = 'riviera') => [...maps.get(mapId).definitions.values()].filter(e => onlineEvent(e.id, mapId)).map(({ id, name, s0, s1, dir, len, routeKey }) => ({ id, name, mapId, s0, s1, dir, len, routeKey }));
  const catalogue = () => [...maps].map(([id, m]) => ({ id, name: m.name, track: m.track, events: options(id) }));
  const publicLobby = (l) => ({ code: l.code, name: l.name, host: l.host, status: l.status, capacity: 8, players: [...l.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, ready: p.ready, finish: p.finish, dnf: p.dnf, connected: p.connected })), eventId: l.eventId, traffic: l.traffic, event: lobbyEvent(l), results: l.status === 'results' ? [...l.racers.values()] : null, startAt: l.startAt, raceId: l.raceId, mapId: l.mapId, track: maps.get(l.mapId).track });
  const discover = () => ({ type: 'discovery', lobbies: [...lobbies.values()].filter(l => !l.private).map(publicLobby) });
  const publish = (l) => { l.touched = Date.now(); for (const p of l.players.values()) send(p.ws, { type: 'lobby', lobby: publicLobby(l) }); for (const c of clients) if (!c.lobby) send(c.ws, discover()); };
  const results = (l) => {
    if (l.status === 'results') return;
    l.status = 'results';
    for (const p of l.players.values()) if (p.finish === null && !p.dnf) p.dnf = true;
    for (const p of l.racers.values()) if (p.finish === null && !p.dnf) p.dnf = true;
    publish(l);
  };
  const leave = (c) => {
    const l = c.lobby; if (!l) return;
    const racer = l.racers?.get(c.id); if (racer) { racer.disconnected = true; if (racer.finish === null && !racer.dnf) racer.dnf = true; }
    l.players.delete(c.id); c.lobby = null; c.ready = false; c.state = null; c.stateAt = null;
    if (!l.players.size) lobbies.delete(l.code);
    else {
      if (l.status === 'countdown' && [...l.players.values()].filter(p => p.connected).length < 2) { l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null; for (const p of l.players.values()) p.ready = false; }
      if (l.host === c.id) l.host = [...l.players.values()].find(p => p.connected)?.id || l.players.keys().next().value; if (['countdown', 'race'].includes(l.status) && [...l.players.values()].every(p => p.finish !== null || p.dnf)) results(l); publish(l); }
    for (const other of clients) if (!other.lobby) send(other.ws, discover());
  };
  const connect = (ws, ip) => {
    if ([...clients].filter(c => c.ip === ip).length >= 24) { ws.close(1013, 'Too many connections'); return; }
    let c = { ws, ip, token: randomHex(32), connected: true, touched: Date.now(), id: randomUUID(), name: 'DRIVER', car: 'mini', ready: false, finish: null, state: null, lobby: null, alive: true, messages: 0, window: Date.now() };
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
        if (m.type === 'leave') { leave(c); send(ws, { type: 'left' }); return; }
        if (m.type === 'create' || m.type === 'join') {
          if (l) return error('Leave your current lobby first.');
          c.name = clean(m.name, 'DRIVER'); c.car = CARS.has(m.car) ? m.car : 'mini';
          c.ready = false; c.finish = null; c.dnf = false; c.state = null; c.stateAt = null;
          c.driverId = /^[a-zA-Z0-9_-]{8,64}$/.test(m.driverId || '') ? m.driverId : c.id;
          let dest;
          if (m.type === 'create') {
            if (m.mapId !== undefined && !maps.has(m.mapId)) return error('Unknown map.');
            const mapId = m.mapId || 'riviera';
            if (m.eventId !== undefined && !onlineEvent(m.eventId, mapId)) return error('Unknown race route for this map.');
            if (lobbies.size >= 64) return error('Lobby limit reached. Join an existing lobby.');
            let code; do { code = randomHex(3).toUpperCase(); } while (lobbies.has(code));
            dest = { code, name: clean(m.lobbyName, `${c.name}'S RACE`), host: c.id, private: m.private === true, players: new Map(), status: 'waiting', startAt: null, raceId: null, mapId, eventId: m.eventId || options(mapId)[0]?.id, traffic: m.traffic === true };
            lobbies.set(code, dest);
          } else {
            dest = lobbies.get(String(m.code).trim().toUpperCase());
            if (!dest) return error('Lobby not found. Check the code or refresh the list.');
            if (dest.status !== 'waiting') return error('This lobby is already racing.');
            if (dest.players.size >= 8) return error('This lobby is full.');
          }
          c.lobby = dest; dest.players.set(c.id, c); publish(dest); return;
        }
        if (!l) return error('Join a lobby first.');
        if (m.type === 'options') {
          if (l.host !== c.id || l.status !== 'waiting') return error('Only the host can change a waiting lobby.');
          const mapId = m.mapId ?? l.mapId;
          if (!maps.has(mapId)) return error('Unknown map.');
          const eventId = m.eventId ?? (mapId === l.mapId ? l.eventId : options(mapId)[0]?.id);
          if (!onlineEvent(eventId, mapId)) return error('Unknown race route for this map.');
          l.mapId = mapId; l.eventId = eventId; l.traffic = m.traffic === true;
          for (const p of l.players.values()) p.ready = false;
          publish(l); return;
        }
        if (m.type === 'ready') {
          if (l.status !== 'waiting') return error('The race has already started.');
          if ((m.mapId !== undefined && m.mapId !== l.mapId) || m.version !== maps.get(l.mapId).track.version) return error('The track changed. Reload the game to join this race.');
          c.ready = m.ready === true; if (CARS.has(m.car)) c.car = m.car; publish(l); return;
        }
        if (m.type === 'start') {
          if (l.host !== c.id) return error('Only the host can start the race.');
          if (l.status !== 'waiting' || l.players.size < 2 || ![...l.players.values()].every(p => p.ready && p.connected)) return error('At least two drivers must be ready.');
          l.status = 'countdown'; l.startAt = now + countdownMs; l.raceId = randomUUID();
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
        if (m.type === 'dnf') {
          if (!['countdown', 'race'].includes(l.status) || now < l.startAt || m.raceId !== l.raceId || c.finish !== null || c.dnf) return;
          if (m.reason !== 'wrecked') return error('Unknown DNF reason.');
          if (l.status === 'countdown') l.status = 'race';
          c.dnf = 'wrecked'; c.finish = null;
          const racer = l.racers.get(c.id); racer.dnf = 'wrecked'; racer.finish = null;
          l.dirty = true; publish(l);
          if ([...l.players.values()].every(p => p.finish !== null || p.dnf)) results(l);
          return;
        }
        if (m.type === 'state' && !c.dnf && ['countdown', 'race'].includes(l.status) && now >= l.startAt && m.raceId === l.raceId ) {
          const fields = ['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear'];
          if (!m.state || fields.some(k => !Number.isFinite(m.state[k]))) return;
          const s = m.state, event = lobbyEvent(l);
          const zones = ['front', 'rear', 'left', 'right'];
          if (s.nitro !== undefined && (!Number.isFinite(s.nitro) || s.nitro < 0 || s.nitro > 1)) return;
          if (s.damage !== undefined && (!s.damage || zones.some(k => !Number.isFinite(s.damage[k]) || s.damage[k] < 0 || s.damage[k] > 1))) return;
          if (Math.abs(s.x) > 100000 || Math.abs(s.z) > 100000 || Math.abs(s.y) > 10000 || Math.abs(s.u) > 500 || s.s < Math.min(event.s0, event.s1) - 500 || s.s > Math.max(event.s0, event.s1) + 500 || Math.abs(s.vLong) > 150 || Math.abs(s.vLat) > 150 || s.rpm < 0 || s.rpm > 20000 || s.gear < 1 || s.gear > 10) return;
          // Client physics with bounded progress; the server owns race timing/results.
          const prevS = c.state?.s ?? event.s0;
          const elapsed = (now - (c.stateAt ?? l.startAt)) / 1000;
          if (Math.abs(s.s - prevS) > 30 + 150 * elapsed) return;
          c.state = { ...Object.fromEntries(fields.map(k => [k, s[k]])), nitro: nitrousCars.has(c.car) ? s.nitro ?? c.state?.nitro ?? 0.4 : 0, damage: s.damage ? Object.fromEntries(zones.map(k => [k, s.damage[k]])) : c.state?.damage ?? Object.fromEntries(zones.map(k => [k, 0])), reverse: s.reverse === true, ...(typeof s.paint === 'string' && /^#[a-f\d]{6}$/i.test(s.paint) ? {paint:s.paint.toLowerCase()} : c.state?.paint ? {paint:c.state.paint} : {}), decals: s.decals === undefined ? c.state?.decals ?? [] : packDecals(unpackDecals(s.decals)) }; c.stateAt = now; l.dirty = true;
          // Optional render clock only; progress checks and finishes use server receipt time.
          if (Number.isFinite(s.sampleTime) && s.sampleTime >= 0 && s.sampleTime <= 1e12) {
            c.state.sampleTime = s.sampleTime;
            c.state.sampleAge = Number.isFinite(s.sampleAge) ? Math.max(0, Math.min(1000, s.sampleAge)) : 0;
            if (Number.isSafeInteger(s.motionEpoch) && s.motionEpoch >= 0) c.state.motionEpoch = s.motionEpoch;
          }
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
  return { connect, message: (ws, bytes) => handlers.get(ws)?.message(bytes), disconnect: ws => { handlers.get(ws)?.close(); handlers.delete(ws); }, pong: ws => handlers.get(ws)?.pong(), tick, nextWake, exportState, restore, clientData: ws => { const c = [...clients].find(c => c.ws === ws); return c && clientData(c); }, discover, publicLobby, lobbies, clients, sessions, track };
}
