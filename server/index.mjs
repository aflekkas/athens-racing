import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { trackVersion } from '../src/network-track.js';
import { EVENTS, QUICK_RACE, resolve as resolveEvent } from '../src/events.js';
import { createLeaderboard } from './leaderboard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const clean = (v, fallback, n = 28) => typeof v === 'string' ? v.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, n) || fallback : fallback;
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(data)); };

export async function createGameServer({ root = ROOT, countdownMs = 4000, raceLimitMs = 600000, reconnectGraceMs = 90000, dataDir = resolve(root, '.data') } = {}) {
  const catalogue = await readFile(resolve(root, 'src/cars.js'), 'utf8').catch(() => readFile(resolve(ROOT, 'src/cars.js'), 'utf8'));
  const CARS = new Set([...catalogue.split('export const CARS = [')[1].split('\n];')[0].matchAll(/\bid:\s*'([^']+)'/g)].map(m => m[1]));
  const mapBytes = await readFile(resolve(root, 'data/map.json'));
  const { route, marks = [] } = JSON.parse(mapBytes);
  const track = { start: route.start, finish: route.finish, version: trackVersion(route) };
  const definitions = new Map();
  for (const def of [QUICK_RACE, ...EVENTS]) {
    if (!['sprint', 'timetrial'].includes(def.type)) continue;
    try { const r = resolveEvent(def, { route, marks }); definitions.set(def.id, { id: def.id, name: def.name, ...r, routeKey: `${r.s0}>${r.s1}`, traffic: def.traffic > 0 }); } catch { /* Map fixtures may omit named marks. */ }
  }
  const leaderboard = await createLeaderboard(resolve(dataDir, 'leaderboard.json'), definitions, CARS, track.version);
  const lobbies = new Map(), clients = new Set(), sessions = new Map(), postLimits = new Map();
  const lobbyEvent = l => definitions.get(l.eventId);
  const options = () => [...definitions.values()].map(({ id, name, s0, s1, dir, len, routeKey }) => ({ id, name, s0, s1, dir, len, routeKey }));
  const publicLobby = (l) => ({ code: l.code, name: l.name, host: l.host, status: l.status, capacity: 8, players: [...l.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, ready: p.ready, finish: p.finish, dnf: p.dnf, connected: p.connected })), eventId: l.eventId, traffic: l.traffic, event: lobbyEvent(l), results: l.status === 'results' ? [...l.racers.values()] : null, startAt: l.startAt, raceId: l.raceId, track });
  const discover = () => ({ type: 'discovery', lobbies: [...lobbies.values()].filter(l => !l.private).map(publicLobby) });
  const publish = (l) => { for (const p of l.players.values()) send(p.ws, { type: 'lobby', lobby: publicLobby(l) }); for (const c of clients) if (!c.lobby) send(c.ws, discover()); };
  const results = (l) => {
    if (l.status === 'results') return;
    l.status = 'results';
    for (const p of l.players.values()) if (p.finish === null) p.dnf = true;
    for (const p of l.racers.values()) if (p.finish === null) p.dnf = true;
    publish(l);
  };
  const leave = (c) => {
    const l = c.lobby; if (!l) return;
    const racer = l.racers?.get(c.id); if (racer) { racer.disconnected = true; if (racer.finish === null) racer.dnf = true; }
    l.players.delete(c.id); c.lobby = null; c.ready = false; c.state = null; c.stateAt = null;
    if (!l.players.size) lobbies.delete(l.code);
    else {
      if (l.status === 'countdown' && l.players.size < 2) { l.status = 'waiting'; l.startAt = null; l.raceId = null; l.racers = null; for (const p of l.players.values()) p.ready = false; }
      if (l.host === c.id) l.host = l.players.keys().next().value; if (['countdown', 'race'].includes(l.status) && [...l.players.values()].every(p => p.finish !== null)) results(l); publish(l); }
    for (const other of clients) if (!other.lobby) send(other.ws, discover());
  };
  const server = http.createServer(async (req, res) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      const json = (status, value) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (path === '/api/leaderboard') {
        if (req.method === 'GET') { json(200, leaderboard.list({ eventId: url.searchParams.get('eventId'), car: url.searchParams.get('car'), traffic: url.searchParams.has('traffic') ? url.searchParams.get('traffic') === 'true' : undefined, limit: url.searchParams.get('limit') })); return; }
        if (req.method !== 'POST') { json(405, { error: 'Use GET or POST.' }); return; }
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { json(403, { error: 'Origin mismatch.' }); return; }
        const ip = req.socket.remoteAddress, now = Date.now(), limit = postLimits.get(ip) || { at: now, count: 0 };
        if (now - limit.at > 60000) { limit.at = now; limit.count = 0; }
        postLimits.set(ip, limit); if (++limit.count > 12) { json(429, { error: 'Please wait before submitting more times.' }); req.resume(); return; }
        let body = '', size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) { json(413, { error: 'Result too large.' }); req.resume(); return; } body += chunk; }
        try { const r = JSON.parse(body); if (r.valid !== true) throw Object.assign(new Error('Only completed races can be submitted.'), { status: 400 }); json(200, await leaderboard.submit({ ...r, source: 'solo', traffic: undefined })); }
        catch (e) { json(e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.status || e instanceof SyntaxError ? e.message : 'Could not save the result.' }); }
        return;
      }
      if (path === '/health') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, clients: clients.size, lobbies: lobbies.size, track })); return; }
      if (path === '/api/lobbies') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(discover().lobbies)); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }
      const allowed = path === '/' || path === '/index.html' || path === '/style.css' || /^\/(src|assets|data)\/[a-zA-Z0-9_./-]+$/.test(path);
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!allowed || path.split('/').some(s => s.startsWith('.')) || !file.startsWith(root + '/')) { res.writeHead(404, headers); res.end('Not found'); return; }
      const info = await stat(file); if (!info.isFile()) throw new Error('Not a file');
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': info.size });
      if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); }
    } catch { res.writeHead(404, headers); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    try {
      if (req.url !== '/ws' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) || clients.size >= 256) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } catch { socket.destroy(); }
  });
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    if ([...clients].filter(c => c.ip === ip).length >= 24) { ws.close(1013, 'Too many connections'); return; }
    let c = { ws, ip, token: randomBytes(32).toString('hex'), connected: true, touched: Date.now(), id: randomUUID(), name: 'DRIVER', car: 'mini', ready: false, finish: null, state: null, lobby: null, alive: true, messages: 0, window: Date.now() };
    sessions.set(c.token, c); clients.add(c); send(ws, { type: 'hello', id: c.id, token: c.token, now: Date.now(), track, events: options() }); send(ws, discover());
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', bytes => {
      if (c.ws !== ws) return;
      const now = Date.now(); if (now - c.window > 1000) { c.window = now; c.messages = 0; } if (++c.messages > 80) { ws.close(1008, 'Rate limit'); return; }
      const error = message => send(ws, { type: 'error', message });
      try {
        const m = JSON.parse(bytes); if (!m || typeof m !== 'object') return;
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
            if (lobbies.size >= 64) return error('Lobby limit reached. Join an existing lobby.');
            let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (lobbies.has(code));
            dest = { code, name: clean(m.lobbyName, `${c.name}'S RACE`), host: c.id, private: m.private === true, players: new Map(), status: 'waiting', startAt: null, raceId: null, eventId: definitions.has(m.eventId) ? m.eventId : 'quick', traffic: m.traffic === true };
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
          if (!definitions.has(m.eventId)) return error('Unknown race route.');
          l.eventId = m.eventId; l.traffic = m.traffic === true;
          for (const p of l.players.values()) p.ready = false;
          publish(l); return;
        }
        if (m.type === 'ready') {
          if (l.status !== 'waiting') return error('The race has already started.');
          if (m.version !== track.version) return error('The track changed. Reload the game to join this race.');
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
        if (m.type === 'state' && ['countdown', 'race'].includes(l.status) && now >= l.startAt && m.raceId === l.raceId ) {
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
          c.state = { ...Object.fromEntries(fields.map(k => [k, s[k]])), nitro: s.nitro ?? c.state?.nitro ?? 0.4, damage: s.damage ? Object.fromEntries(zones.map(k => [k, s.damage[k]])) : c.state?.damage ?? Object.fromEntries(zones.map(k => [k, 0])), reverse: s.reverse === true }; c.stateAt = now;
          if (c.finish === null && (s.s - event.s1) * event.dir >= 0 && Math.abs(s.u) < 30) {
            c.finish = (now - l.startAt) / 1000; l.racers.get(c.id).finish = c.finish; publish(l);
            leaderboard.submit({ driverId: c.driverId || c.id, name: c.name, car: c.car, eventId: l.eventId, traffic: l.traffic, time: c.finish, source: 'online' }).catch(e => { if (!e.status) console.error('Leaderboard save failed:', e.message); });
            if ([...l.players.values()].every(p => p.finish !== null)) results(l);
          }
        }
      } catch { error('Invalid message.'); }
    });
    ws.on('close', () => {
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
    });
    ws.on('error', () => ws.close());
  });
  const tick = setInterval(() => {
    const now = Date.now();
    for (const c of sessions.values()) if (!c.connected && now - c.touched > reconnectGraceMs) { leave(c); sessions.delete(c.token); }
    for (const [ip, limit] of postLimits) if (now - limit.at > 60000) postLimits.delete(ip);
    for (const l of lobbies.values()) {
      if (l.status === 'countdown' && now >= l.startAt) { l.status = 'race'; publish(l); }
      if (['countdown', 'race'].includes(l.status)) {
        if (now > l.startAt + raceLimitMs) { results(l); continue; }
        const players = [...l.players.values()].map(p => ({ id: p.id, state: p.state, finish: p.finish }));
        for (const p of l.players.values()) send(p.ws, { type: 'snapshot', raceId: l.raceId, now, players });
      }
    }
  }, 50);
  const heartbeat = setInterval(() => { for (const c of clients) { if (!c.alive) c.ws.terminate(); else { c.alive = false; c.ws.ping(); } } }, 15000);
  const close = async () => { clearInterval(tick); clearInterval(heartbeat); for (const c of clients) c.ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); await leaderboard.flush(); };
  return { server, close, lobbies, track, leaderboard };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createGameServer();
  const port = Number(process.env.PORT || 8000), host = process.env.HOST || '0.0.0.0';
  app.server.listen(port, host, () => console.log(`Paraliaki multiplayer listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
