import { connectionProtocol } from '../src/multiplayer-protocol.js';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { MAPS } from '../src/map-catalog.js';
import { resolveMap } from './map-definitions.mjs';
import { readCarCapabilities } from './car-capabilities.mjs';
import { createGameCore } from './core.mjs';
import { createLeaderboard } from './leaderboard.mjs';
// NOTE: this Node server is guest-only. Username accounts, sessions, stats,
// friends and presence live in the Cloudflare Worker (worker/index.mjs,
// server/accounts.mjs, server/friends.mjs); the routes below say so with
// 501. Multiplayer here works without accounts: plates are random and no
// stats accrue. createGameCore mirrors the protocol with accounts/friends
// left null, which core-level tests cover.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

export async function createGameServer({ root = ROOT, countdownMs = 4000, raceLimitMs = 600000, reconnectGraceMs = 90000, dataDir = resolve(root, '.data') } = {}) {
  const catalogue = await readFile(resolve(root, 'src/cars.js'), 'utf8').catch(() => readFile(resolve(ROOT, 'src/cars.js'), 'utf8'));
  const capabilities = readCarCapabilities(catalogue);
  const CARS = new Set(capabilities.cars), nitrousCars = new Set(capabilities.nitrousCars);
  const maps = new Map();
  for (const def of MAPS) {
    let data;
    try { data = JSON.parse(await readFile(resolve(root, def.dataUrl), 'utf8')); }
    catch (e) { if (def.id === 'riviera' || e.code !== 'ENOENT') throw e; console.warn(`Map ${def.id} unavailable: ${def.dataUrl}; skipping.`); continue; }
    maps.set(def.id, resolveMap(def, data));
  }
  const { track, definitions } = maps.get('riviera');
  const leaderboard = await createLeaderboard(resolve(dataDir, 'leaderboard.json'), definitions, CARS, track.version, maps);
  const core = createGameCore({ maps, cars: CARS, nitrousCars, leaderboard, countdownMs, raceLimitMs, reconnectGraceMs });
  const { clients, lobbies, discover } = core;
  // Guest-only stubs: the Cloudflare Worker owns these paths.
  const guestOnly = (json) => json(501, { error: 'Accounts and friends live on the Cloudflare game. This server is guest-only.' });
  const postLimits = new Map();
  const server = http.createServer(async (req, res) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      const json = (status, value) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (path === '/api/me') { json(200, { guest: true }); return; }
      if (path.startsWith('/api/accounts/') || path === '/auth/logout' || path === '/api/username' || path === '/api/auth/ticket' || path === '/api/friends' || path === '/api/recent' || path.startsWith('/api/friends/')) { guestOnly(json); return; }
      if (path === '/api/leaderboard') {
        if (req.method === 'GET') { json(200, leaderboard.list({ mapId: url.searchParams.get('mapId') || 'riviera', eventId: url.searchParams.get('eventId'), car: url.searchParams.get('car'), traffic: url.searchParams.has('traffic') ? url.searchParams.get('traffic') === 'true' : undefined, limit: url.searchParams.get('limit') })); return; }
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
      if (new URL(req.url, 'http://localhost').pathname !== '/ws' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) || clients.size >= 256) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } catch { socket.destroy(); }
  });
  wss.on('connection', (ws, req) => {
    if (!core.connect(ws, req.socket.remoteAddress, connectionProtocol(new URL(req.url, 'http://localhost')))) return;
    ws.on('pong', () => core.pong(ws));
    ws.on('message', bytes => core.message(ws, bytes));
    ws.on('close', () => core.disconnect(ws));
    ws.on('error', () => ws.close());
  });
  const tick = setInterval(() => { core.tick(); for (const [ip, limit] of postLimits) if (Date.now() - limit.at > 60000) postLimits.delete(ip); }, 100);
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
