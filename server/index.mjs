import { accounts } from '../worker/accounts.mjs';
import { authorizeGame, protectedPath, accountResult, identityActive } from './auth-policy.mjs';
import { canSaveResults } from './smoke-session.mjs';
import { leaderboardFilters } from './leaderboard-policy.mjs';
import { legalPage } from '../worker/legal-pages.mjs';
import { connectionProtocol, AUTH_CLOSE_CODE, RELAY_MS } from '../src/multiplayer-protocol.js';
import http from 'node:http';
import { readFile, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { MAPS } from '../src/map-catalog.js';
import { resolveMap } from './map-definitions.mjs';
import { installRouteMaps } from './route-maps.mjs';
import { readCarCapabilities } from './car-capabilities.mjs';
import { createGameCore } from './core.mjs';
import { createLeaderboard } from './leaderboard.mjs';
// Both transports run the same account-free lobby/race protocol.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

// The public asset root and the private build catalogue are separate paths.
// Native development may omit a build; an explicitly selected build must exist
// and parse successfully rather than silently publishing an empty route list.
export async function readBuiltCatalogue(root, builtCataloguePath, read = readFile) {
  const explicit = builtCataloguePath !== undefined;
  try {
    if (explicit && (typeof builtCataloguePath !== 'string' || !builtCataloguePath || builtCataloguePath.includes('\0'))) throw Error('Invalid catalogue path');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(explicit ? builtCataloguePath : resolve(root, '.deploy/catalogue.json'))));
    if (explicit && (!value || typeof value !== 'object' || Array.isArray(value) || !value.routeConfig || typeof value.routeConfig !== 'object' || Array.isArray(value.routeConfig) || !Array.isArray(value.routeConfig.routes) || !Array.isArray(value.routes))) throw Error('Invalid catalogue structure');
    return value;
  } catch (cause) {
    if (explicit) throw Error('Built route catalogue unavailable or malformed', { cause });
    return {};
  }
}

export async function createGameServer({ root = ROOT, builtCataloguePath, countdownMs = 4000, raceLimitMs = 600000, reconnectGraceMs = 90000, accountEnv = process.env, dataDir = resolve(root, '.data') } = {}) {
  const catalogue = await readFile(resolve(root, 'src/cars.js'), 'utf8').catch(() => readFile(resolve(ROOT, 'src/cars.js'), 'utf8'));
  const capabilities = readCarCapabilities(catalogue);
  const CARS = new Set(capabilities.cars), nitrousCars = new Set(capabilities.nitrousCars), carSpecs = capabilities.specs || {};
  const maps = new Map();
  for (const def of MAPS) {
    let data;
    try { data = JSON.parse(await readFile(resolve(root, def.dataUrl), 'utf8')); }
    catch (e) { if (def.id === 'riviera' || e.code !== 'ENOENT') throw e; console.warn(`Map ${def.id} unavailable: ${def.dataUrl}; skipping.`); continue; }
    maps.set(def.id, resolveMap(def, data));
  }
  const built = await readBuiltCatalogue(root, builtCataloguePath);
  await installRouteMaps(maps, built, { carSpecs, loadRoadArtifact: async (url, maxBytes) => {
    if (!/^\/world\/recovery\/-?\d+,-?\d+\.[a-f0-9]{64}\.json$/.test(url) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw Error('Recovery asset unavailable or too large');
    // One open handle binds stat/read to the same file, even across renames.
    const file = await open(resolve(root, '.' + url), 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > maxBytes) throw Error('Recovery asset unavailable or too large');
      const bytes = new Uint8Array(info.size); let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) throw Error('Recovery asset size mismatch');
        length += bytesRead;
      }
      // A bounded one-byte probe catches growth after the advertised-size stat.
      if ((await file.read(new Uint8Array(1), 0, 1, length)).bytesRead || (await file.stat()).size !== info.size) throw Error('Recovery asset size mismatch');
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return bytes;
    } finally { await file.close(); }
  } });
  const { track: legacyTrack, definitions } = maps.get('riviera');
  const leaderboard = await createLeaderboard(resolve(dataDir, 'leaderboard.json'), definitions, CARS, legacyTrack.version, maps);
  const core = createGameCore({ maps, cars: CARS, carSpecs, nitrousCars, leaderboard, countdownMs, raceLimitMs, reconnectGraceMs });
  const { clients, lobbies, discover, track } = core;
  const postLimits = new Map();
  const server = http.createServer(async (req, res) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
    try {
      const legal = legalPage(new Request(new URL(req.url, 'http://' + (req.headers.host || 'localhost')), { method: req.method }));
      if (legal) { res.writeHead(legal.status, Object.fromEntries(legal.headers)); res.end(Buffer.from(await legal.arrayBuffer())); return; }
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      const json = (status, value) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      const request = new Request(new URL(req.url, 'http://' + (req.headers.host || 'localhost')), { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) });
      if (path === '/api/routes') { json(200, maps.routeConfig); return; }
      if (/^\/api\/auth\/(config|session|logout|google\/(start|callback))$/.test(path) || path.startsWith('/api/account/') && accountEnv.ACCOUNTS) {
        const result = await accounts(request, accountEnv);
        res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
      }
      const auth = protectedPath(path) ? await authorizeGame(request, accountEnv) : {};
      if (auth.response) { json(auth.response.status, await auth.response.json()); req.resume(); return; }
      if (path === '/api/leaderboard') {
        if (req.method === 'GET') { json(200, leaderboard.list(leaderboardFilters(url.searchParams, CARS))); return; }
        if (req.method !== 'POST') { json(405, { error: 'Use GET or POST.' }); return; }
        if (!canSaveResults(auth.identity)) { json(403, { error: 'Smoke sessions cannot save results.' }); req.resume(); return; }
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { json(403, { error: 'Origin mismatch.' }); return; }
        const ip = req.socket.remoteAddress, now = Date.now(), limit = postLimits.get(ip) || { at: now, count: 0 };
        if (now - limit.at > 60000) { limit.at = now; limit.count = 0; }
        postLimits.set(ip, limit); if (++limit.count > 12) { json(429, { error: 'Please wait before submitting more times.' }); req.resume(); return; }
        let body = '', size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) { json(413, { error: 'Result too large.' }); req.resume(); return; } body += chunk; }
        try { const r = JSON.parse(body); if (r?.valid !== true) throw Object.assign(new Error('Only completed races can be submitted.'), { status: 400 }); json(200, await leaderboard.submit({ ...accountResult(r, auth.identity), source: 'solo' })); }
        catch (e) { json(e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.status || e instanceof SyntaxError ? e.message : 'Could not save the result.' }); }
        return;
      }
      if (path === '/health') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, clients: clients.size, lobbies: lobbies.size, track })); return; }
      if (path === '/api/lobbies') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(discover().lobbies)); return; }
      if (path.startsWith('/api/') || path.startsWith('/auth/')) { json(404, { error: 'Not found.' }); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }
      const allowed = path === '/' || path === '/index.html' || path === '/style.css' || /^\/(src|assets|data)\/[a-zA-Z0-9_./-]+$/.test(path);
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!allowed || path.split('/').some(s => s.startsWith('.')) || !file.startsWith(root + '/')) { res.writeHead(404, headers); res.end('Not found'); return; }
      const info = await stat(file); if (!info.isFile()) throw new Error('Not a file');
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': info.size });
      if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); }
    } catch { res.writeHead(404, headers); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  server.on('upgrade', async (req, socket, head) => {
    try {
      if (new URL(req.url, 'http://localhost').pathname !== '/ws' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) || clients.size >= 256) { socket.destroy(); return; }
      const auth = await authorizeGame(new Request(new URL(req.url, 'http://' + req.headers.host), { headers: req.headers }), accountEnv);
      if (auth.response) { socket.end('HTTP/1.1 ' + auth.response.status + ' Unauthorized\r\nConnection: close\r\n\r\n'); return; }
      req.accountIdentity = auth.identity;
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } catch { socket.destroy(); }
  });
  wss.on('connection', (ws, req) => {
    if (!core.connect(ws, req.socket.remoteAddress, { ...connectionProtocol(new URL(req.url, 'http://localhost')), identity: req.accountIdentity })) return;
    ws.on('pong', () => core.pong(ws));
    ws.on('message', async bytes => {
      try { if (!await identityActive(core.clientData(ws)?.identity, accountEnv)) { ws.close(AUTH_CLOSE_CODE, 'Sign in with Google'); core.disconnect(ws); return; } if (await core.prepareMessage(ws, bytes)) core.message(ws, bytes); }
      catch { ws.close(1011, 'Sign-in unavailable'); }
    });
    ws.on('close', () => core.disconnect(ws));
    ws.on('error', () => ws.close());
  });
  const tick = setInterval(() => { core.tick(); for (const [ip, limit] of postLimits) if (Date.now() - limit.at > 60000) postLimits.delete(ip); }, RELAY_MS);
  const heartbeat = setInterval(() => { for (const c of clients) { if (!c.alive) c.ws.terminate(); else { c.alive = false; c.ws.ping(); } } }, 15000);
  const close = async () => { clearInterval(tick); clearInterval(heartbeat); for (const c of clients) c.ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); await leaderboard.flush(); };
  return { server, close, lobbies, track, leaderboard, routeConfig: maps.routeConfig };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createGameServer();
  const port = Number(process.env.PORT || 8000), host = process.env.HOST || '0.0.0.0';
  app.server.listen(port, host, () => console.log(`Paraliaki multiplayer listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
