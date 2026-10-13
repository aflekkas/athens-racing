import { DurableObject } from 'cloudflare:workers';
import { rewriteShareMetadata } from './share-metadata.mjs';
import catalogue from '../.deploy/catalogue.json';
import { createGameCore } from '../server/core.mjs';
import { createSqlLeaderboard } from './leaderboard.mjs';

const maps = new Map(catalogue.maps.map(m => [m.id, { ...m, definitions: new Map(m.definitions) }]));
const cars = new Set(catalogue.cars);
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (['/ws', '/health', '/api/lobbies', '/api/leaderboard'].includes(url.pathname)) {
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return json({ error: 'Origin mismatch.' }, 403);
      // One arena shares discovery and connections. Idle rooms hibernate; games share duration.
      return env.GAME.get(env.GAME.idFromName('arena-v1')).fetch(request);
    }
    return rewriteShareMetadata(request, await env.ASSETS.fetch(request));
  }
};

export class GameArena extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.timer = null;
    this.leaderboard = createSqlLeaderboard(ctx.storage.sql, maps, cars);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS post_limits (ip TEXT PRIMARY KEY, at INTEGER NOT NULL, count INTEGER NOT NULL)');
    this.core = createGameCore({ maps, cars, leaderboard: this.leaderboard });
    // Auto-response avoids waking the object for optional idle keepalives.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('keepalive', 'alive'));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('arena');
      const sockets = new Map();
      for (const ws of ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment();
        if (!attachment?.token) { ws.close(1011, 'Missing session'); continue; }
        sockets.set(attachment.token, ws);
        const client = saved?.sessions?.find(c => c.token === attachment.token);
        if (client) for (const key of ['state', 'stateAt', 'messages', 'window']) client[key] = attachment[key];
      }
      this.core.restore(saved, sockets);
      // Connections absent from saved metadata cannot be recovered safely.
      for (const [token, ws] of sockets) if (!this.core.sessions.has(token)) ws.close(1012, 'Please reconnect');
    });
  }
  attach(ws) {
    const data = this.core.clientData(ws);
    if (data) ws.serializeAttachment(data);
  }
  async persist() {
    for (const ws of this.ctx.getWebSockets()) this.attach(ws);
    await this.ctx.storage.put('arena', this.core.exportState());
    const at = this.core.nextWake();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, at));
  }
  relay() {
    if (this.timer !== null || ![...this.core.lobbies.values()].some(l => l.dirty && ['countdown', 'race'].includes(l.status))) return;
    // Coalesce all drivers into one snapshot per lobby, at most 10 Hz. No idle interval.
    this.timer = setTimeout(() => { this.timer = null; this.core.tick(); }, 100);
  }
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required.' }, 426);
      if (this.core.clients.size >= 256) return json({ error: 'Connection limit reached.' }, 503);
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      this.core.connect(server, request.headers.get('CF-Connecting-IP') || 'unknown');
      this.attach(server);
      await this.persist();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === 'GET' && path === '/health') return json({ ok: true, transport: 'durable-object', clients: this.core.clients.size, lobbies: this.core.lobbies.size, track: this.core.track, maps: catalogue.maps.map(({ id, track }) => ({ id, track })) });
    if (request.method === 'GET' && path === '/api/lobbies') return json(this.core.discover().lobbies);
    if (path === '/api/leaderboard') {
      if (request.method === 'GET') return json(this.leaderboard.list({ mapId: url.searchParams.get('mapId') || 'riviera', eventId: url.searchParams.get('eventId'), car: url.searchParams.get('car'), traffic: url.searchParams.has('traffic') ? url.searchParams.get('traffic') === 'true' : undefined, limit: url.searchParams.get('limit') }));
      if (request.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown', now = Date.now();
      const sql = this.ctx.storage.sql;
      const old = [...sql.exec('SELECT at, count FROM post_limits WHERE ip = ?', ip)][0];
      const limit = old && now - old.at < 60000 ? { ...old, count: old.count + 1 } : { at: now, count: 1 };
      sql.exec('DELETE FROM post_limits WHERE at < ?', now - 60000);
      sql.exec('INSERT OR REPLACE INTO post_limits VALUES (?, ?, ?)', ip, limit.at, limit.count);
      if (limit.count > 12) return json({ error: 'Please wait before submitting more times.' }, 429);
      let size = 0, chunks = [];
      const reader = request.body?.getReader();
      if (reader) while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 4096) { await reader.cancel(); return json({ error: 'Result too large.' }, 413); }
        chunks.push(value);
      }
      try {
        const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
        const r = JSON.parse(new TextDecoder().decode(bytes));
        if (r.valid !== true) return json({ error: 'Only completed races can be submitted.' }, 400);
        return json(await this.leaderboard.submit({ ...r, source: 'solo', traffic: undefined }));
      } catch (e) { return json({ error: e.status || e instanceof SyntaxError ? e.message : 'Could not save the result.' }, e.status || (e instanceof SyntaxError ? 400 : 500)); }
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > 4096) { ws.close(1009, 'Message too large'); return; }
    let type; try { type = JSON.parse(message)?.type; } catch { type = 'invalid'; }
    const before = this.core.clientData(ws)?.finish;
    this.core.message(ws, message);
    this.attach(ws);
    // State lives in websocket attachments: avoid 500 SQLite writes/s for 50 racers.
    // Lobby transitions and finishes persist immediately; telemetry is coalesced in memory.
    if (!['state', 'states', 'ping', 'discover'].includes(type) || before !== this.core.clientData(ws)?.finish) await this.persist();
    this.relay();
  }
  async webSocketClose(ws, code, reason) {
    this.core.disconnect(ws);
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch {}
    await this.persist();
  }
  async webSocketError(ws) { this.core.disconnect(ws); try { ws.close(1011, 'WebSocket error'); } catch {} await this.persist(); }
  async alarm() { this.core.tick(); await this.persist(); }
}
