import { MAPS } from "../src/map-catalog.js";
import { session, json } from "./accounts.mjs";
export const visiblePresence = (s, now = Date.now()) =>
  s && now - s.at < 65000
    ? { status: s.status, map: s.map, lobby: s.lobby }
    : { status: "offline" };
export class FriendsPresence {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  sockets() {
    return this.ctx.getWebSockets();
  }
  send(ws, packet) {
    try {
      ws.send(JSON.stringify(packet));
    } catch {
      /* A closing tab cannot interrupt another friend's update. */
    }
  }
  async friends(user) {
    return (
      await this.env.ACCOUNTS.prepare(
        "SELECT CASE WHEN sender=? THEN recipient ELSE sender END AS id FROM friendships WHERE state='accepted' AND (sender=? OR recipient=?)",
      )
        .bind(user, user, user)
        .all()
    ).results.map((x) => x.id);
  }
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/host") {
      const a = this.sockets()
        .map((w) => w.deserializeAttachment())
        .filter(
          (a) =>
            a.user === u.searchParams.get("user") &&
            visiblePresence(a).status !== "offline",
        );
      return json(a.find((a) => a.lobby) || {});
    }
    if (u.pathname === "/notify") {
      const b = await request.json();
      for (const ws of this.sockets())
        if (ws.deserializeAttachment().user === b.user)
          this.send(ws, { type: b.type });
      return json({ ok: true });
    }
    const s = await session(request, this.env);
    if (!s) return json({ error: "Sign in" }, 401);
    if (new URL(request.url).origin !== request.headers.get("Origin"))
      return json({ error: "Origin mismatch" }, 403);
    if (request.headers.get("Upgrade") !== "websocket")
      return json({ error: "WebSocket required" }, 426);
    if (this.sockets().length >= 512)
      return json({ error: "Presence capacity" }, 503);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      user: s.user_id,
      session: s.token,
      expires: s.expires,
      at: Date.now() - 15001,
      status: "in-menu",
      map: null,
      lobby: null,
    });
    await this.sendSnapshot(server);
    await this.fanout(s.user_id);
    await this.ctx.storage.setAlarm(Date.now() + 30000);
    return new Response(null, { status: 101, webSocket: client });
  }
  async sendSnapshot(ws) {
    const a = ws.deserializeAttachment(),
      friends = await this.friends(a.user),
      states = {};
    for (const id of friends) {
      const entries = this.sockets()
        .map((w) => w.deserializeAttachment())
        .filter((v) => v.user === id)
        .sort((a, b) => b.at - a.at);
      states[id] = visiblePresence(entries[0]);
    }
    this.send(ws, { type: "presence", friends: states });
  }
  async fanout(user) {
    const ids = await this.friends(user);
    for (const ws of this.sockets())
      if (ids.includes(ws.deserializeAttachment().user))
        await this.sendSnapshot(ws);
  }
  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 1024) return;
    let b;
    try {
      b = JSON.parse(message);
    } catch {
      return;
    }
    if (b.type !== "heartbeat") return;
    const a = ws.deserializeAttachment(),
      now = Date.now();
    if (now - a.at < 15000) return;
    const valid = await this.env.ACCOUNTS.prepare(
      "SELECT 1 FROM sessions WHERE token=? AND expires>?",
    )
      .bind(a.session, now)
      .first();
    if (!valid) {
      ws.close(1008, "Session expired");
      return;
    }
    let lobby = null,
      map = MAPS.some((m) => m.id === b.map) ? b.map : null,
      status = b.status === "in-race" ? "in-race" : "in-menu";
    if (b.token) {
      const r = await this.env.GAME.get(
        this.env.GAME.idFromName("arena-v1"),
      ).fetch(
        new Request(
          "https://internal/api/account/live?token=" +
            encodeURIComponent(b.token),
        ),
      );
      const verified = await r.json();
      lobby = verified.host ? verified.code : null;
      map = verified.map || null;
      status = verified.status === "race" ? "in-race" : "in-menu";
    }
    const changed = a.status !== status || a.map !== map || a.lobby !== lobby;
    ws.serializeAttachment({ ...a, at: now, status, map, lobby });
    if (changed) await this.fanout(a.user);
    await this.sendSnapshot(ws);
  }
  async webSocketClose(ws) {
    const a = ws.deserializeAttachment();
    ws.serializeAttachment({
      ...a,
      at: 0,
      status: "offline",
      lobby: null,
      map: null,
    });
    try {
      ws.close();
    } catch {}
    await this.fanout(a.user);
  }
  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
  async alarm() {
    const now = Date.now();
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (now - a.at >= 65000 || a.expires <= now) {
        ws.serializeAttachment({
          ...a,
          at: 0,
          status: "offline",
          lobby: null,
          map: null,
        });
        ws.close(1000, "Presence expired");
        await this.fanout(a.user);
      }
    }
    if (this.sockets().length) await this.ctx.storage.setAlarm(now + 30000);
  }
}
