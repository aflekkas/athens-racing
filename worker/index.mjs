import { DurableObject } from 'cloudflare:workers';
import { rewriteShareMetadata } from './share-metadata.mjs';
import catalogue from '../.deploy/catalogue.json';
import { createGameCore } from '../server/core.mjs';
import { createSqlLeaderboard } from './leaderboard.mjs';
import { createAccountService } from '../server/accounts.mjs';
import { createSqlSocialStore } from '../server/social-store.mjs';
import { createCustomizationService, handleCustomizationRequest } from '../server/customization.mjs';
import { createSqlCustomizationStore } from '../server/customization-store.mjs';
import { createFriendService } from '../server/friends.mjs';
import { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_JWKS_URL, newSecret, codeChallenge, buildAuthUrl, exchangeCode, verifyIdTokenLive } from './oidc.mjs';

const SESSION_COOKIE = 'asr_session';
const readSessionCookie = (request) => {
  const h = request.headers.get('Cookie') || '';
  const m = h.match(/(?:^|;\s*)asr_session=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
};
const sessionCookie = (id, maxAge) => `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

const maps = new Map(catalogue.maps.map(m => [m.id, { ...m, definitions: new Map(m.definitions) }]));
const cars = new Set(catalogue.cars);
const nitrousCars = new Set(catalogue.nitrousCars || []);
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/customization' || url.pathname.startsWith('/api/customization/')) {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return json({ error: 'Origin mismatch.' }, 403);
      return env.GAME.get(env.GAME.idFromName('arena-v1')).fetch(request);
    }
    if (['/ws', '/health', '/api/lobbies', '/api/leaderboard', '/api/me', '/api/username', '/api/auth/ticket', '/api/friends', '/api/friends/search', '/api/friends/request', '/api/friends/accept', '/api/friends/decline', '/api/friends/remove', '/api/friends/block', '/api/friends/unblock', '/api/recent', '/auth/google/start', '/auth/google/callback', '/auth/logout'].includes(url.pathname)) {
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
    // Accounts, sessions, friends and recent players share this DO's SQLite
    // (no KV/D1/R2, no new bindings): arena-v1 is the single global social
    // store on the free plan. Presence stays live (derived from sockets).
    this.store = createSqlSocialStore(ctx.storage.sql);
    this.accounts = createAccountService(this.store);
    this.customization = createCustomizationService(createSqlCustomizationStore(ctx.storage.sql), { cars });
    this.friends = createFriendService(this.store, { presenceOf: (subs) => this.core.presenceOf(subs) });
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS post_limits (ip TEXT PRIMARY KEY, at INTEGER NOT NULL, count INTEGER NOT NULL)');
    this.core = createGameCore({ maps, cars, nitrousCars, leaderboard: this.leaderboard, accounts: this.accounts, friends: this.friends, appearance: this.customization });
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
      // Same-origin browsers send the session cookie on the WS handshake,
      // so most clients arrive already linked (ticket auth covers the rest).
      const sid = readSessionCookie(request);
      const linked = sid && this.core.linkSession(server, sid);
      if (linked) this.core.presencePush([linked.sub]);
      this.attach(server);
      await this.persist();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === 'GET' && path === '/health') return json({ ok: true, transport: 'durable-object', clients: this.core.clients.size, lobbies: this.core.lobbies.size, track: this.core.track, maps: catalogue.maps.map(({ id, track }) => ({ id, track })) });
    if (request.method === 'GET' && path === '/api/lobbies') return json(this.core.discover().lobbies);
    const sessionId = readSessionCookie(request);
    const me = () => {
      const who = sessionId && this.accounts.verifySession(sessionId);
      if (!who) throw Object.assign(new Error('Sign in with Google first.'), { status: 401 });
      return who;
    };
    if (path === '/api/customization' || path.startsWith('/api/customization/')) return handleCustomizationRequest(request, { service: this.customization, who: me });
    if (path === '/auth/google/start' || path === '/auth/google/callback' || path === '/auth/logout') return this.auth(request, url);
    if (path === '/api/me') {
      if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
      const who = sessionId && this.accounts.verifySession(sessionId);
      if (!who) return json({ guest: true });
      let pendingRequests = 0;
      try { pendingRequests = this.friends.list(who.sub).incoming.length; } catch {}
      return json({ ...this.accounts.get(who.sub), pendingRequests });
    }
    if (path === '/api/username') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      try {
        if (Number(request.headers.get('Content-Length') || 0) > 512) return json({ error: 'Request too large.' }, 413);
        const r = await request.json().catch(() => null);
        const out = this.accounts.setUsername(me().sub, r?.username);
        this.core.refreshAccount(me().sub);
        await this.persist();
        return json({ ok: true, ...out });
      } catch (e) { return json({ error: e.message }, e.status || 500); }
    }
    if (path === '/api/auth/ticket') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      try { return json({ ok: true, ...this.accounts.createTicket(me().sub) }); }
      catch (e) { return json({ error: e.message }, e.status || 401); }
    }
    if (path === '/api/friends' || path === '/api/friends/search' || path === '/api/recent' || path.startsWith('/api/friends/')) {
      try {
        const who = me();
        const act = path.split('/').pop();
        if (path === '/api/friends' && request.method === 'GET') return json({ ok: true, ...this.friends.list(who.sub) });
        if (path === '/api/friends/search' && request.method === 'GET') return json({ ok: true, results: this.friends.search(who.sub, url.searchParams.get('q') || '') });
        if (path === '/api/recent' && request.method === 'GET') return json({ ok: true, recent: this.friends.recent(who.sub) });
        if (request.method !== 'POST' || !['request', 'accept', 'decline', 'remove', 'block', 'unblock'].includes(act)) return json({ error: 'Unknown friends action.' }, 404);
        if (Number(request.headers.get('Content-Length') || 0) > 512) return json({ error: 'Request too large.' }, 413);
        const r = await request.json().catch(() => null);
        const out = this.friends[act](who.sub, r?.username);
        this.core.presencePush(out.affected);
        if (act === 'request' && !out.accepted) this.core.notify(out.friend && this.store.getUserByKey(out.friend.username)?.sub, { kind: 'friend-request', from: who.username || who.displayName });
        if (act === 'accept') this.core.notify(out.friend && this.store.getUserByKey(out.friend.username)?.sub, { kind: 'friend-accepted', by: who.username });
        await this.persist();
        const { affected, ...rest } = out;
        return json({ ok: true, ...rest });
      } catch (e) { return json({ error: e.message }, e.status || 500); }
    }
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
        const out = await this.leaderboard.submit({ ...r, source: 'solo', traffic: undefined });
        try {
          // Same-origin browsers send the session cookie automatically.
          const who = readSessionCookie(request) && this.accounts.verifySession(readSessionCookie(request));
          if (who) {
            const mapId = r.mapId || 'riviera', event = maps.get(mapId)?.definitions.get(r.eventId);
            this.accounts.recordSolo({ sub: who.sub, car: r.car, mapId, eventId: r.eventId, traffic: event?.traffic === true, time: r.time, km: (event?.len || 0) / 1000 });
          }
        } catch (e) { console.error('Account solo stats save failed:', e.message); }
        return json(out);
      } catch (e) { return json({ error: e.status || e instanceof SyntaxError ? e.message : 'Could not save the result.' }, e.status || (e instanceof SyntaxError ? 400 : 500)); }
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  // Google sign-in: /auth/google/start -> Google -> /auth/google/callback.
  // GOOGLE_CLIENT_ID is a wrangler var, GOOGLE_CLIENT_SECRET a wrangler
  // secret (never committed); setup steps live in deploy/README.md.
  async auth(request, url) {
    const env = this.env;
    if (url.pathname === '/auth/logout') {
      const id = readSessionCookie(request);
      if (id) this.accounts.revokeSession(id);
      await this.persist();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie('expired', 0) } });
    }
    if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Google sign-in is not configured yet. See deploy/README.md.' }, 501);
    if (url.pathname === '/auth/google/start') {
      const next = url.searchParams.get('next') || '/';
      const redirect = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      const verifier = newSecret(32), state = newSecret(16), nonce = newSecret(16);
      this.store.pruneStates();
      this.store.saveState({ state, verifier, nonce, redirect, createdAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 });
      const challenge = await codeChallenge(verifier);
      return Response.redirect(buildAuthUrl({ authEndpoint: env.GOOGLE_AUTH_URL || GOOGLE_AUTH_URL, clientId: env.GOOGLE_CLIENT_ID, redirectUri: new URL('/auth/google/callback', url).href, state, nonce, challenge }), 302);
    }
    const fail = (reason) => Response.redirect(new URL('/?login=' + reason, url).href, 302);
    const saved = url.searchParams.get('state') && this.store.consumeState(url.searchParams.get('state'));
    if (url.searchParams.get('error') || !url.searchParams.get('code') || !saved || saved.expiresAt <= Date.now()) return fail('cancelled');
    try {
      const redirectUri = new URL('/auth/google/callback', url).href;
      const { id_token } = await exchangeCode({ tokenEndpoint: env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, code: url.searchParams.get('code'), redirectUri, verifier: saved.verifier });
      const claims = await verifyIdTokenLive({ idToken: id_token, jwksUri: env.GOOGLE_JWKS_URL || GOOGLE_JWKS_URL, clientId: env.GOOGLE_CLIENT_ID, nonce: saved.nonce });
      this.accounts.upsertGoogleUser({ sub: claims.sub, displayName: claims.name, avatarUrl: claims.picture });
      const session = this.accounts.createSession(claims.sub);
      await this.persist();
      // NOTE: Response.redirect() carries immutable headers in workerd, so
      // the session cookie needs a manually constructed redirect.
      return new Response(null, { status: 302, headers: { Location: new URL(saved.redirect || '/', url).href, 'Set-Cookie': sessionCookie(session.id, 30 * 24 * 3600) } });
    } catch (e) { console.error('Google sign-in failed:', e.message); return fail('error'); }
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
