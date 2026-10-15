import { DurableObject } from 'cloudflare:workers';
import { WheelRoom, validWheelCode, wheelCode } from '../server/phone-wheel.mjs';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function wheelRoute(request, env) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'Origin mismatch.' }, 403);
  if (url.pathname === '/api/wheel' && request.method === 'POST') {
    const code = wheelCode();
    const reply = await env.WHEEL.get(env.WHEEL.idFromName(code)).fetch(new Request(new URL('/create', url), { method: 'POST' }));
    if (!reply.ok) return reply;
    return json({ code, ...await reply.json() });
  }
  const code = url.searchParams.get('c');
  if (url.pathname !== '/api/wheel/ws' || !validWheelCode(code)) return json({ error: 'Invalid wheel code.' }, 400);
  return env.WHEEL.get(env.WHEEL.idFromName(code)).fetch(request);
}
export class PhoneWheelRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      this.room = new WheelRoom({ data: await ctx.storage.get('room') || null });
      for (const ws of ctx.getWebSockets()) this.room.sockets.set(ws.deserializeAttachment()?.role, ws);
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/create' && request.method === 'POST') {
      const data = this.room.create(); if (!data) return json({ error: 'Try again.' }, 409);
      await this.persist(); return json(data);
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required.' }, 426);
    const role = url.searchParams.get('role'), token = url.searchParams.get('token');
    if (!this.room.canJoin(role, token)) return json({ error: 'Code expired or already in use.' }, 409);
    const [client, server] = Object.values(new WebSocketPair());
    // Accept first so paired notification can be sent during join.
    this.ctx.acceptWebSocket(server); server.serializeAttachment({ role });
    this.room.join(server, role, token);
    await this.persist(); return new Response(null, { status: 101, webSocket: client });
  }
  async persist() { await this.ctx.storage.put('room', this.room.data); await this.ctx.storage.setAlarm(this.room.data.expires); }
  webSocketMessage(ws, message) { this.room.message(ws, message); }
  async webSocketClose(ws) {
    // A hibernation wake can omit the closing socket from getWebSockets().
    this.room.close(); try { ws.close(1000, 'Wheel unpaired'); } catch {}
    await this.ctx.storage.deleteAll();
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
  async alarm() { this.room.close(); await this.ctx.storage.deleteAll(); }
}
