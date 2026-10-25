import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeReleaseHash } from './release-fingerprint.mjs';
import { WebSocket, WebSocketServer } from 'ws';
import { createGameServer } from '../../server/index.mjs';
import { pathIsWithin } from '../../server/path-containment.mjs';
import { DESKTOP_SERVICE, DEFAULT_DESKTOP_PORT, DEFAULT_LAN_PORT, MULTIPLAYER_PROTOCOL } from '../../packages/contracts/desktop.mjs';

export function privateAddress(host) {
  if (host === 'localhost') return true;
  if (isIP(host) === 4) {
    const a = host.split('.').map(Number);
    return a[0] === 10 || a[0] === 127 || a[0] === 192 && a[1] === 168 || a[0] === 172 && a[1] >= 16 && a[1] <= 31 || a[0] === 169 && a[1] === 254;
  }
  if (isIP(host) === 6) return host === '::1' || /^(fc|fd|fe[89ab])/i.test(host);
  return false;
}

export function parseLanAddress(address) {
  if (typeof address !== 'string' || address.length > 128 || address !== address.trim() || /[\\\s?#@]/.test(address)) throw Error('Enter a local IP address and port, such as 192.168.1.20:17834.');
  const value = address.startsWith('http://') ? address : 'http://' + address;
  let url;
  try { url = new URL(value); } catch { throw Error('Invalid LAN address.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !privateAddress(host)) throw Error('Use a private LAN IP address or localhost, with no path or credentials.');
  // A specified port is required: do not silently contact port 80.
  if (!url.port || Number(url.port) < 1 || Number(url.port) > 65535) throw Error('Include the host’s LAN port.');
  return url.origin;
}

const listen = (server, port, host) => new Promise((resolve, reject) => {
  const fail = error => { server.removeListener('listening', ready); reject(error); };
  const ready = () => { server.removeListener('error', fail); resolve(server.address()); };
  server.once('error', fail); server.once('listening', ready); server.listen(port, host);
});
const stop = server => new Promise(resolve => { if (!server?.listening) return resolve(); server.close(resolve); server.closeAllConnections?.(); });
const sendJSON = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const originForm = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\x00-\x20\x7f#]/.test(value);
// Match the backend's decoded static-file surface, never an extension guess.
export function immutableLocalRequest({ local, remote, method, path }) {
  if (!local || remote || !['GET', 'HEAD'].includes(method)) return false;
  let decoded; try { decoded = decodeURIComponent(path); } catch { return false; }
  return (['/', '/index.html', '/style.css'].includes(decoded) || /^\/(src|assets|data)\/[a-zA-Z0-9_./-]+$/.test(decoded)) && !decoded.split('/').some(part => part.startsWith('.'));
}
const sameOrigin = req => {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
};

export async function startDesktopRuntime({ root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), dataDir, port = DEFAULT_DESKTOP_PORT, lanPort = DEFAULT_LAN_PORT } = {}) {
  if (!dataDir) throw Error('A writable desktop data directory is required.');
  root = await realpath(resolve(root));
  const cataloguePath = resolve(root, 'catalogue.json');
  const builtCataloguePath = await stat(cataloguePath).then(() => cataloguePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const release = await runtimeReleaseHash({ gameRoot: root, codeRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../..') });
  const game = await createGameServer({ root, builtCataloguePath, dataDir, accountEnv: {} });
  let facade, lan, closed = false, mode = 'solo', upstream, queue = Promise.resolve();
  const tunnels = new Set(), upstreamTunnels = new Set(), requests = new Map();
  const info = () => ({ service: DESKTOP_SERVICE, protocol: MULTIPLAYER_PROTOCOL, release });
  const disconnect = async ({ allRequests = false } = {}) => {
    await Promise.allSettled([...upstreamTunnels].filter(ws => ws.readyState === WebSocket.OPEN).map(ws => new Promise(resolve => {
      let timer;
      const finish = () => { clearTimeout(timer); ws.off('message', receive); ws.off('close', finish); resolve(); };
      const receive = (bytes, binary) => { if (!binary) { try { if (JSON.parse(bytes).type === 'left') finish(); } catch {} } };
      timer = setTimeout(finish, 500); ws.on('message', receive); ws.once('close', finish);
      try { ws.send(JSON.stringify({ type: 'leave' }), error => { if (error) finish(); }); } catch { finish(); }
    })));
    game.endSessions();
    for (const ws of tunnels) ws.terminate(); tunnels.clear(); upstreamTunnels.clear();
    for (const [req, sessionBound] of requests) if (allRequests || sessionBound) { req.destroy(); requests.delete(req); }
  };
  const addresses = () => lan?.listening ? [...new Set(Object.values(networkInterfaces()).flat().filter(n => n && !n.internal && n.family === 'IPv4' && privateAddress(n.address)).map(n => `${n.address}:${lan.address().port}`))] : [];
  const getSession = () => ({ mode, address: mode === 'join' ? upstream : mode === 'host' ? addresses()[0] || `127.0.0.1:${lan.address().port}` : null, addresses: addresses(), port: mode === 'host' ? lan.address().port : facade.address().port, protocol: MULTIPLAYER_PROTOCOL });
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  let backend;
  const proxyHTTP = (req, res, target, { sessionBound = true } = {}) => {
    let remote;
    try { remote = new URL(req.url, target); if (remote.origin !== new URL(target).origin) throw Error('Invalid proxy authority.'); }
    catch { sendJSON(res, 400, { error: 'Invalid request target.' }); return; }
    const headers = { ...req.headers, host: remote.host };
    delete headers.cookie; delete headers.authorization; delete headers['proxy-authorization'];
    if (headers.origin) headers.origin = remote.origin;
    const pending = http.request(remote, { method: req.method, headers, timeout: 5000 }, response => {
      const responseHeaders = { ...response.headers }; delete responseHeaders['set-cookie'];
      res.writeHead(response.statusCode, responseHeaders); response.pipe(res);
    });
    requests.set(pending, sessionBound); pending.on('close', () => requests.delete(pending));
    pending.on('timeout', () => pending.destroy(Error('LAN host timed out.')));
    pending.on('error', () => { if (!res.headersSent) sendJSON(res, 502, { error: 'LAN host unavailable.' }); else res.destroy(); });
    res.on('close', () => pending.destroy()); req.pipe(pending);
  };
  const worldAsset = async (req, res, path) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return sendJSON(res, 405, { error: 'Use GET or HEAD.' });
      const decoded = decodeURIComponent(path);
      if (!/^\/world\/[a-zA-Z0-9_.,/-]+$/.test(decoded) || decoded.split('/').some(part => part.startsWith('.'))) return sendJSON(res, 404, { error: 'Not found.' });
      const file = await realpath(resolve(root, '.' + decoded));
      if (!pathIsWithin(resolve(root, 'world'), file)) return sendJSON(res, 404, { error: 'Not found.' });
      const metadata = await stat(file); if (!metadata.isFile()) return sendJSON(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': extname(file) === '.json' ? 'application/json' : 'application/octet-stream', 'Content-Length': metadata.size, 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); }
    } catch { sendJSON(res, 404, { error: 'Not found.' }); }
  };
  const makeProxy = local => {
    const validHost = req => {
      let host;
      try { host = new URL('http://' + req.headers.host); } catch { return false; }
      const hostname = host.hostname.replace(/^\[|\]$/g, '');
      return !host.username && !host.password && host.pathname === '/' && Number(host.port) === server.address().port && (local ? ['127.0.0.1', 'localhost'].includes(hostname) : privateAddress(hostname));
    };
    const server = http.createServer((req, res) => {
      if (!originForm(req.url)) return sendJSON(res, 400, { error: 'Invalid request target.' });
      if (!validHost(req)) return sendJSON(res, 403, { error: 'Invalid host.' });
      if (!sameOrigin(req)) return sendJSON(res, 403, { error: 'Origin mismatch.' });
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/health' || path === '/api/desktop/info') return sendJSON(res, 200, { ok: true, ...info(), track: game.track, lobbies: game.lobbies.size });
      // The installed game has local profiles and no account database. Its
      // existing launch prefetch must resolve cleanly without cloud auth retries.
      if (local && ['/api/auth/config', '/api/auth/session'].includes(path)) {
        if (req.method !== 'GET') return sendJSON(res, 405, { error: 'Use GET.' });
        return sendJSON(res, 200, path.endsWith('/config') ? { providers: [], required: false } : { user: null });
      }
      if (!local && !['/api/routes', '/api/lobbies', '/api/leaderboard'].includes(path)) return sendJSON(res, 404, { error: 'Not found.' });
      if (local && path.startsWith('/world/')) { void worldAsset(req, res, path); return; }
      const remote = local && mode === 'join' && ['/api/routes', '/api/lobbies', '/api/leaderboard'].includes(path);
      proxyHTTP(req, res, remote ? upstream : backend, { sessionBound: !immutableLocalRequest({ local, remote, method: req.method, path }) });
    });
    server.on('upgrade', (req, socket, head) => {
      if (!originForm(req.url) || !validHost(req) || !sameOrigin(req) || closed) { socket.destroy(); return; }
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path !== '/ws') { socket.destroy(); return; }
      const base = local && mode === 'join' ? upstream : backend;
      const target = new URL(req.url, base);
      if (target.origin !== new URL(base).origin) { socket.destroy(); return; }
      target.protocol = 'ws:';
      const peer = new WebSocket(target, { origin: target.origin.replace(/^ws:/, 'http:'), handshakeTimeout: 4000, maxPayload: 16384 });
      tunnels.add(peer); upstreamTunnels.add(peer);
      socket.once('close', () => peer.terminate());
      peer.once('open', () => {
        if (socket.destroyed) { peer.terminate(); return; }
        wsServer.handleUpgrade(req, socket, head, client => {
          tunnels.add(client);
          peer.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
          client.on('message', (data, binary) => { if (peer.readyState === WebSocket.OPEN) peer.send(data, { binary }); });
          client.on('close', () => { tunnels.delete(client); peer.terminate(); });
          client.on('error', () => client.terminate());
          peer.on('close', () => client.close(1012, 'LAN session ended'));
        });
      });
      peer.on('error', () => { socket.destroy(); peer.terminate(); });
      peer.on('close', () => { tunnels.delete(peer); upstreamTunnels.delete(peer); });
    });
    return server;
  };
  const change = action => {
    const result = queue.then(() => { if (closed) throw Error('Desktop runtime is closed.'); return action(); });
    queue = result.catch(() => {}); return result;
  };
  try {
    const address = await listen(game.server, 0, '127.0.0.1'); backend = `http://127.0.0.1:${address.port}`;
    facade = makeProxy(true); await listen(facade, port, '127.0.0.1');
  } catch (error) { await game.close(); throw error; }
  return {
    url: `http://127.0.0.1:${facade.address().port}`,
    getSession,
    host: () => change(async () => {
      if (mode === 'host') return getSession();
      const next = makeProxy(false);
      try { await listen(next, lanPort, '0.0.0.0'); } catch (error) { await stop(next); throw error; }
      await disconnect(); await stop(lan); lan = next; mode = 'host'; upstream = undefined; return getSession();
    }),
    join: address => change(async () => {
      const target = parseLanAddress(address);
      const parsed = new URL(target), host = parsed.hostname.replace(/^\[|\]$/g, '');
      const ownAddresses = new Set(['localhost', '127.0.0.1', '::1', ...Object.values(networkInterfaces()).flat().filter(Boolean).map(n => n.address)]);
      if (ownAddresses.has(host) && [facade.address().port, game.server.address().port, lan?.address()?.port].includes(Number(parsed.port))) throw Error('Choose another player’s LAN host.');
      let response, result;
      try { response = await fetch(target + '/api/desktop/info', { signal: AbortSignal.timeout(4000), redirect: 'error' }); let bytes = 0, text = ''; const decoder = new TextDecoder(); for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 4096) throw Error('LAN response too large.'); text += decoder.decode(chunk, { stream: true }); } text += decoder.decode(); result = JSON.parse(text); }
      catch { throw Error('Could not reach the LAN host. Check its address, port, and firewall.'); }
      if (!response.ok || result.service !== DESKTOP_SERVICE) throw Error('This address is not an Athens Racing LAN host.');
      if (result.protocol !== MULTIPLAYER_PROTOCOL || result.release !== release) throw Error('Game versions are incompatible. Install the same Athens Racing release.');
      await disconnect(); await stop(lan); lan = undefined; upstream = target; mode = 'join'; return getSession();
    }),
    solo: () => change(async () => { await disconnect(); await stop(lan); lan = undefined; upstream = undefined; mode = 'solo'; return getSession(); }),
    close: async () => {
      if (closed) return;
      closed = true; await queue; await disconnect({ allRequests: true }); await stop(lan); await stop(facade); await game.close(); await new Promise(resolve => wsServer.close(resolve));
    }
  };
}
