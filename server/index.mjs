import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { trackVersion } from '../src/network-track.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const clean = (v, fallback, n = 28) => typeof v === 'string' ? v.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, n) || fallback : fallback;
const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(data)); };

export async function createGameServer({ root = ROOT, countdownMs = 4000, raceLimitMs = 600000 } = {}) {
  const catalogue = await readFile(resolve(root, 'src/cars.js'), 'utf8').catch(() => readFile(resolve(ROOT, 'src/cars.js'), 'utf8'));
  const CARS = new Set([...catalogue.split('export const CARS = [')[1].split('\n];')[0].matchAll(/\bid:\s*'([^']+)'/g)].map(m => m[1]));
  const mapBytes = await readFile(resolve(root, 'data/map.json'));
  const { route } = JSON.parse(mapBytes);
  const track = { start: route.start, finish: route.finish, version: trackVersion(route) };
  const lobbies = new Map(), clients = new Set();
  const publicLobby = (l) => ({ code: l.code, name: l.name, host: l.host, status: l.status, capacity: 8, players: [...l.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, ready: p.ready, finish: p.finish, dnf: p.dnf })), results: l.status === 'results' ? [...l.racers.values()] : null, startAt: l.startAt, raceId: l.raceId, track });
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
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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
    const c = { ws, ip, id: randomUUID(), name: 'DRIVER', car: 'mini', ready: false, finish: null, state: null, lobby: null, alive: true, messages: 0, window: Date.now() };
    clients.add(c); send(ws, { type: 'hello', id: c.id, now: Date.now(), track }); send(ws, discover());
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', bytes => {
      const now = Date.now(); if (now - c.window > 1000) { c.window = now; c.messages = 0; } if (++c.messages > 80) { ws.close(1008, 'Rate limit'); return; }
      const error = message => send(ws, { type: 'error', message });
      try {
        const m = JSON.parse(bytes); if (!m || typeof m !== 'object') return;
        const l = c.lobby;
        if (m.type === 'ping') { send(ws, { type: 'pong', now, sent: m.sent }); return; }
        if (m.type === 'discover') { send(ws, discover()); return; }
        if (m.type === 'leave') { leave(c); send(ws, { type: 'left' }); return; }
        if (m.type === 'create' || m.type === 'join') {
          if (l) return error('Leave your current lobby first.');
          c.name = clean(m.name, 'DRIVER'); c.car = CARS.has(m.car) ? m.car : 'mini';
          c.ready = false; c.finish = null; c.dnf = false; c.state = null; c.stateAt = null;
          let dest;
          if (m.type === 'create') {
            if (lobbies.size >= 64) return error('Lobby limit reached. Join an existing lobby.');
            let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (lobbies.has(code));
            dest = { code, name: clean(m.lobbyName, `${c.name}'S RACE`), host: c.id, private: m.private === true, players: new Map(), status: 'waiting', startAt: null, raceId: null };
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
        if (m.type === 'ready') {
          if (l.status !== 'waiting') return error('The race has already started.');
          if (m.version !== track.version) return error('The track changed. Reload the game to join this race.');
          c.ready = m.ready === true; if (CARS.has(m.car)) c.car = m.car; publish(l); return;
        }
        if (m.type === 'start') {
          if (l.host !== c.id) return error('Only the host can start the race.');
          if (l.status !== 'waiting' || l.players.size < 2 || ![...l.players.values()].every(p => p.ready)) return error('At least two drivers must be ready.');
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
        if (m.type === 'state' && ['countdown', 'race'].includes(l.status) && now >= l.startAt && m.raceId === l.raceId && c.finish === null) {
          const fields = ['x', 'y', 'z', 'yaw', 's', 'u', 'vLong', 'vLat', 'steer', 'rpm', 'gear'];
          if (!m.state || fields.some(k => !Number.isFinite(m.state[k]))) return;
          const s = m.state;
          if (Math.abs(s.x) > 100000 || Math.abs(s.z) > 100000 || Math.abs(s.y) > 10000 || Math.abs(s.u) > 500 || s.s < track.start - 500 || s.s > track.finish + 500 || Math.abs(s.vLong) > 150 || Math.abs(s.vLat) > 150 || s.rpm < 0 || s.rpm > 20000 || s.gear < 1 || s.gear > 10) return;
          // Client physics with bounded progress; the server owns race timing/results.
          const prevS = c.state?.s ?? track.start;
          const elapsed = (now - (c.stateAt ?? l.startAt)) / 1000;
          if (s.s - prevS > 30 + 150 * elapsed) return;
          c.state = Object.fromEntries(fields.map(k => [k, s[k]])); c.stateAt = now;
          if (s.s >= track.finish && Math.abs(s.u) < 30) {
            c.finish = (now - l.startAt) / 1000; l.racers.get(c.id).finish = c.finish; publish(l);
            if ([...l.players.values()].every(p => p.finish !== null)) results(l);
          }
        }
      } catch { error('Invalid message.'); }
    });
    ws.on('close', () => { leave(c); clients.delete(c); });
    ws.on('error', () => ws.close());
  });
  const tick = setInterval(() => {
    const now = Date.now();
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
  const close = async () => { clearInterval(tick); clearInterval(heartbeat); for (const c of clients) c.ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); };
  return { server, close, lobbies, track };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createGameServer();
  const port = Number(process.env.PORT || 8000), host = process.env.HOST || '0.0.0.0';
  app.server.listen(port, host, () => console.log(`Paraliaki multiplayer listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
