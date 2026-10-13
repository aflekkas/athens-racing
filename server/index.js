import http from 'node:http';
import { stat } from 'node:fs/promises';
import { readFileSync, createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
const clean = (v, fallback, max = 24) => typeof v === 'string' ? v.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, max) || fallback : fallback;
const cars = ['mini', 'kastro', 'riviera', 'poseidon', 'taxi'];
const carId = (v) => cars.includes(v) ? v : cars[0];
const MAX_PLAYERS = 8;

export function createGameServer({ root = ROOT, countdownMs = 5000, raceLimitMs = 900000, finishGraceMs = 90000, tickMs = 50 } = {}) {
  const track = JSON.parse(readFileSync(resolve(root, 'data/map.json'), 'utf8')).route;
  const rooms = new Map(), clients = new Set();
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(data)); };
  const publicRoom = (r) => ({ code: r.code, name: r.name, public: r.public, capacity: r.capacity, phase: r.phase, hostId: r.hostId, raceId: r.raceId, startAt: r.startAt, endAt: r.endAt, track: { start: track.start, finish: track.finish }, players: [...r.players.values()].map(({ ws, lastUpdate, ...p }) => p) });
  const broadcastRoom = (r) => { const packet = { type: 'room', room: publicRoom(r), serverTime: Date.now() }; for (const p of r.players.values()) if (p.ws) send(p.ws, packet); };
  const list = () => [...rooms.values()].filter(r => r.public).map(r => ({ code: r.code, name: r.name, players: [...r.players.values()].filter(p => p.connected).length, capacity: r.capacity, phase: r.phase })).sort((a,b) => (a.phase !== 'waiting') - (b.phase !== 'waiting')).slice(0, 100);
  const discover = () => { for (const ws of clients) if (!ws.roomCode) send(ws, { type: 'lobbies', lobbies: list() }); };
  const error = (ws, message) => send(ws, { type: 'error', message });
  const endRace = (r) => { r.phase = 'results'; for (const p of r.players.values()) if (p.finish === null) p.dnf = true; broadcastRoom(r); discover(); };
  const maybeEnd = (r) => { if (r.phase === 'racing' && [...r.players.values()].every(p => p.finish !== null || p.dnf)) endRace(r); };
  function leave(ws) {
    const r = rooms.get(ws.roomCode); ws.roomCode = null;
    if (!r) return;
    const p = r.players.get(ws.playerId);
    if (r.phase === 'waiting' || r.phase === 'results') r.players.delete(ws.playerId);
    else if (p) { p.connected = false; p.dnf = true; p.ws = null; }
    const connected = [...r.players.values()].filter(p => p.connected);
    if (!connected.length) rooms.delete(r.code);
    else {
      if (r.hostId === ws.playerId) r.hostId = connected[0].id;
      if (r.phase === 'countdown' && connected.length < 2) { r.phase = 'waiting'; r.startAt = null; for (const [id, member] of r.players) { if (!member.connected) r.players.delete(id); else member.ready = false; } }
      maybeEnd(r); broadcastRoom(r);
    }
    discover();
  }
  function join(ws, r, message) {
    if (r.phase !== 'waiting') return error(ws, 'This lobby is already racing. Join after the race.');
    if (r.players.size >= r.capacity) return error(ws, 'This lobby is full.');
    leave(ws);
    const slot = [...Array(r.capacity).keys()].find(i => ![...r.players.values()].some(p => p.slot === i));
    const p = { id: ws.playerId, name: clean(message.name, 'Driver'), car: carId(message.car), ready: false, connected: true, slot, finish: null, dnf: false, state: null, lastUpdate: 0, ws };
    r.players.set(p.id, p); ws.roomCode = r.code; broadcastRoom(r); discover();
  }
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (pathname === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, lobbies: rooms.size, clients: clients.size })); return; }
      if (pathname === '/api/lobbies') { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ lobbies: list() })); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      // Serve only game assets; never expose source tools, dependencies, dotfiles or server code.
      if (!(pathname === '/' || pathname === '/index.html' || pathname === '/style.css' || /^\/(src|assets|data)\//.test(pathname)) || pathname.split('/').some(p => p.startsWith('.'))) { res.writeHead(404); res.end(); return; }
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end(); return; }
      const info = await stat(file); if (!info.isFile()) throw new Error('Not a file');
      res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', /\.(html|js|css)$/.test(file) ? 'no-cache' : 'public, max-age=3600');
      res.setHeader('Content-Length', info.size);
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let originOK = true;
    try { if (req.headers.origin) originOK = new URL(req.headers.origin).host === req.headers.host; } catch { originOK = false; }
    if (req.url !== '/ws' || !originOK || clients.size >= 400) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    clients.add(ws); ws.playerId = randomUUID(); ws.alive = true; ws.rateAt = Date.now(); ws.rateCount = 0;
    send(ws, { type: 'welcome', playerId: ws.playerId, serverTime: Date.now() }); send(ws, { type: 'lobbies', lobbies: list() });
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => { leave(ws); clients.delete(ws); });
    ws.on('message', (raw, binary) => {
      const now = Date.now();
      if (now - ws.rateAt > 1000) { ws.rateAt = now; ws.rateCount = 0; }
      if (++ws.rateCount > 100) { ws.close(1008, 'Too many messages'); return; }
      let m; try { if (binary) throw new Error(); m = JSON.parse(raw.toString()); if (!m || typeof m !== 'object') throw new Error(); } catch { return error(ws, 'Invalid message.'); }
      const r = rooms.get(ws.roomCode), p = r?.players.get(ws.playerId);
      if (m.type === 'ping') return send(ws, { type: 'pong', sentAt: m.sentAt, serverTime: now });
      if (m.type === 'list') return send(ws, { type: 'lobbies', lobbies: list() });
      if (m.type === 'leave') { leave(ws); send(ws, { type: 'left' }); return; }
      if (m.type === 'create') {
        if (ws.roomCode) return error(ws, 'Leave your current lobby first.');
        if (rooms.size >= 100) return error(ws, 'All lobby slots are in use. Try again later.');
        let code; do { code = randomBytes(4).toString('hex').slice(0,6).toUpperCase(); } while (rooms.has(code));
        const room = { code, name: clean(m.lobbyName, 'Riviera Sprint', 36), public: m.public !== false, capacity: MAX_PLAYERS, hostId: ws.playerId, phase: 'waiting', raceId: null, startAt: null, endAt: null, players: new Map() };
        rooms.set(code, room); join(ws, room, m); return;
      }
      if (m.type === 'join') { if (ws.roomCode) return error(ws, 'Leave your current lobby first.'); const room = rooms.get(String(m.code || '').toUpperCase()); return room ? join(ws, room, m) : error(ws, 'Lobby not found. Check the invite code.'); }
      if (!r || !p) return error(ws, 'Join a lobby first.');
      if (m.type === 'ready' && r.phase === 'waiting') { p.ready = m.ready === true; broadcastRoom(r); return; }
      if (m.type === 'car' && r.phase === 'waiting') { p.car = carId(m.car); p.ready = false; broadcastRoom(r); return; }
      if (m.type === 'start') {
        if (r.hostId !== p.id) return error(ws, 'Only the host can start the race.');
        if (r.phase !== 'waiting') return error(ws, 'The race has already started.');
        if (r.players.size < 2 || [...r.players.values()].some(p => !p.ready || !p.connected)) return error(ws, 'At least two drivers must be ready.');
        r.raceId = randomUUID(); r.startAt = now + countdownMs; r.endAt = r.startAt + raceLimitMs; r.phase = 'countdown';
        for (const p of r.players.values()) { p.state = null; p.finish = null; p.dnf = false; p.lastUpdate = r.startAt; }
        broadcastRoom(r); discover(); return;
      }
      if (m.type === 'rematch') {
        if (r.hostId !== p.id || r.phase !== 'results') return error(ws, 'Only the host can open a rematch after results.');
        r.phase = 'waiting'; r.startAt = null;
        for (const [id,p] of r.players) { if (!p.connected) r.players.delete(id); else { p.ready = false; p.finish = null; p.dnf = false; p.state = null; } }
        broadcastRoom(r); discover(); return;
      }
      if (m.type === 'state' && r.phase === 'racing' && m.raceId === r.raceId && p.finish === null && !p.dnf) {
        const s = m.state;
        const fields = ['s', 'u', 'yaw', 'vLong', 'vLat', 'steer', 'rpm', 'gear'];
        if (!s || !fields.every(k => typeof s[k] === 'number' && Number.isFinite(s[k]))) return;
        const elapsed = Math.max(0, (now - r.startAt) / 1000);
        const lastS = p.state?.s ?? track.start - Math.floor(p.slot / 2) * 7;
        const deltaT = Math.max(0, (now - p.lastUpdate) / 1000);
        if (s.s < track.start - 200 || s.s > track.finish + 200 || s.s > track.start + elapsed * 130 + 15 || Math.abs(s.s - lastS) > deltaT * 130 + 15 || Math.abs(s.u) > 50 || Math.abs(s.vLong) > 130 || Math.abs(s.vLat) > 80 || Math.abs(s.yaw) > 1e6 || s.rpm < 0 || s.rpm > 15000 || s.gear < 1 || s.gear > 8) return;
        p.state = Object.fromEntries(fields.map(k => [k, s[k]])); p.state.brake = s.brake === true; p.state.nitroOn = s.nitroOn === true; p.lastUpdate = now;
        if (s.s >= track.finish) { p.finish = (now - r.startAt) / 1000; r.endAt = Math.min(r.endAt, now + finishGraceMs); broadcastRoom(r); maybeEnd(r); }
        return;
      }
    });
  });
  const ticker = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) {
      if (r.phase === 'countdown' && now >= r.startAt) { r.phase = 'racing'; broadcastRoom(r); discover(); }
      if (r.phase !== 'racing') continue;
      if (now >= r.endAt) { endRace(r); continue; }
      // Background tabs stop simulating; classify stalled connections as DNF rather than hanging a race.
      for (const p of r.players.values()) if (!p.dnf && p.finish === null && now - p.lastUpdate > 30000) { p.dnf = true; broadcastRoom(r); }
      maybeEnd(r);
      const packet = { type: 'snapshot', raceId: r.raceId, serverTime: now, players: [...r.players.values()].map(p => ({ id: p.id, state: p.state, finish: p.finish, dnf: p.dnf })) };
      for (const p of r.players.values()) if (p.ws) send(p.ws, packet);
    }
  }, tickMs);
  const heartbeat = setInterval(() => { for (const ws of clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 15000);
  return { server, rooms, async close() { clearInterval(ticker); clearInterval(heartbeat); for (const ws of clients) ws.terminate(); await new Promise(r => wss.close(r)); if (server.listening) await new Promise(r => server.close(r)); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer();
  game.server.listen(Number(process.env.PORT || 8000), process.env.HOST || '0.0.0.0', () => console.log(`Paraliaki multiplayer listening on ${game.server.address().port}`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await game.close(); process.exit(0); });
}
