import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { accounts, session, hash, providers } from "../worker/accounts.mjs";
import { FriendsPresence, visiblePresence } from "../worker/presence.mjs";
import {
  AccountsClient,
  guestProgress,
  restoreProgress,
  offlineAllowed,
} from "../src/accounts-client.js";
let signingKeys;
async function googleToken(claims) {
  signingKeys ||= await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const encoded = (value) => Buffer.from(value).toString("base64url");
  const input =
    encoded(JSON.stringify({ alg: "RS256", kid: "test-key" })) +
    "." +
    encoded(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKeys.privateKey,
    new TextEncoder().encode(input),
  );
  return input + "." + encoded(new Uint8Array(signature));
}
async function jwks() {
  return Response.json({
    keys: [
      {
        ...(await crypto.subtle.exportKey("jwk", signingKeys.publicKey)),
        kid: "test-key",
        alg: "RS256",
      },
    ],
  });
}
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_accounts.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...values) || null;
            },
            async all() {
              return { results: sqlite.prepare(sql).all(...values) };
            },
            async run() {
              return sqlite.prepare(sql).run(...values);
            },
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const r = [];
        for (const s of statements) r.push(await s.run());
        sqlite.exec("COMMIT");
        return r;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sqlite };
}
function fixture() {
  const { db, sqlite } = database();
  const notices = [];
  const env = {
    ACCOUNTS: db,
    SESSION_SECRET: "test-only-secret-32-random-test-bytes",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GAME: {
      idFromName: (x) => x,
      get: () => ({
        fetch: async (r) => {
          const u = new URL(r.url);
          return Response.json(
            u.searchParams.get("token") === "host-token"
              ? { live: true, host: true, code: "ABC123", map: "riviera" }
              : { live: u.searchParams.get("code") === "ABC123" },
          );
        },
      }),
    },
    PRESENCE: {
      idFromName: (x) => x,
      get: () => ({
        fetch: async (r) => {
          notices.push(await r.json());
          return Response.json({ ok: true });
        },
      }),
    },
  };
  let ip = 0;
  const call = async (
    path,
    data,
    auth = {},
    origin = "https://staging.athensracing.com",
    fetcher,
  ) =>
    accounts(
      new Request(origin + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "CF-Connecting-IP": String(auth.ip || ++ip),
          ...(auth.cookie ? { Cookie: auth.cookie } : {}),
          ...(auth.csrf ? { "X-CSRF-Token": auth.csrf } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      env,
      fetcher,
    );
  const login = async (subject) => {
    const start = await call("/api/auth/google/start");
    const dest = new URL(start.headers.get("location"));
    const r = await call(
      "/api/auth/google/callback?state=" +
        dest.searchParams.get("state") +
        "&code=mock",
      undefined,
      { cookie: start.headers.get("set-cookie").split(";")[0] },
      undefined,
      async (url) => {
        if (url.includes("/certs")) return jwks();
        if (url.includes("/token"))
          return Response.json({
            access_token: "mock",
            id_token: await googleToken({
              sub: subject,
              nonce: dest.searchParams.get("nonce"),
              aud: "client",
              iss: "https://accounts.google.com",
              exp: Date.now() / 1000 + 60,
            }),
          });
        return Response.json({ sub: subject });
      },
    );
    assert.equal(r.status, 302);
    assert.match(r.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const s = await (
      await call("/api/auth/session", undefined, { cookie })
    ).json();
    return { cookie, csrf: s.csrf, id: s.user.id };
  };
  return { env, db, sqlite, call, login, notices };
}
test("CSRF, expiry, revocation and export/delete cascade", async () => {
  const f = fixture(),
    a = await f.login("one-google-subject");
  assert.equal(
    (
      await f.call(
        "/api/account/profile",
        { displayName: "DRIVER", plate: "GR-123" },
        { cookie: a.cookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/api/account/profile",
        { displayName: "DRIVER", plate: "GR-123" },
        a,
      )
    ).status,
    200,
  );
  const foreign = await accounts(
    new Request("https://staging.athensracing.com/api/account/delete", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        Cookie: a.cookie,
        "X-CSRF-Token": a.csrf,
      },
      body: '{"confirm":"DELETE"}',
    }),
    f.env,
  );
  assert.equal(foreign.status, 403);
  const b = await f.login("two-google-subject");
  assert.equal(
    (
      await f.call(
        "/api/account/profile",
        { displayName: "driver", plate: "GR-999" },
        b,
      )
    ).status,
    400,
  );
  assert.equal((await f.call("/api/account/export", undefined, a)).status, 200);
  f.sqlite.prepare("UPDATE sessions SET expires=0 WHERE user_id=?").run(b.id);
  assert.equal(
    (await f.call("/api/account/friends", undefined, b)).status,
    401,
  );
  assert.equal((await f.call("/api/auth/logout", {}, a)).status, 200);
  assert.equal((await f.call("/api/account/export", undefined, a)).status, 401);
  const a2 = await f.login("one-google-subject");
  assert.equal(
    (await f.call("/api/account/delete", { confirm: "DELETE" }, a2)).status,
    200,
  );
  assert.equal(
    f.sqlite
      .prepare("SELECT count(*) n FROM identities WHERE user_id=?")
      .get(a.id).n,
    0,
  );
});
test("OAuth state browser binding, PKCE exchange, nonce validation, replay and configured redirect", async () => {
  const f = fixture();
  Object.assign(f.env, {
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
  });
  const start = await f.call("/api/auth/google/start"),
    dest = new URL(start.headers.get("location")),
    state = dest.searchParams.get("state"),
    cookie = start.headers.get("set-cookie").split(";")[0];
  assert.equal(dest.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    dest.searchParams.get("redirect_uri"),
    "https://staging.athensracing.com/api/auth/google/callback",
  );
  assert.equal(
    (await f.call("/api/auth/google/callback?state=" + state + "&code=x"))
      .status,
    302,
  );
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    if (url.includes("/certs")) return jwks();
    if (url.includes("/token")) {
      assert.equal(
        await hash(options.body.get("code_verifier")),
        dest.searchParams.get("code_challenge"),
      );
      const claims = {
        nonce: dest.searchParams.get("nonce"),
        sub: "google-sub",
        aud: "client",
        iss: "https://accounts.google.com",
        exp: Date.now() / 1000 + 60,
      };
      return Response.json({
        access_token: "mock",
        id_token: await googleToken(claims),
      });
    }
    return Response.json({ sub: "google-sub" });
  };
  const cb = "/api/auth/google/callback?state=" + state + "&code=x";
  const r = await f.call(cb, undefined, { cookie }, undefined, fetcher);
  assert.equal(r.status, 302);
  assert.ok([2, 3].includes(calls));
  assert.equal(
    (await f.call(cb, undefined, { cookie }, undefined, fetcher)).status,
    302,
  );
  const bad = await f.call("/api/auth/google/start"),
    badState = new URL(bad.headers.get("location")).searchParams.get("state");
  const badResponse = await f.call(
    "/api/auth/google/callback?state=" + badState + "&code=x",
    undefined,
    { cookie: bad.headers.get("set-cookie").split(";")[0] },
    undefined,
    async () =>
      Response.json({
        id_token: "x." + btoa(JSON.stringify({ nonce: "wrong" })) + ".x",
      }),
  );
  assert.equal(badResponse.status, 302);
  assert.equal(badResponse.headers.get("location"), "/?signin_error=1");
});
test("friendship state machine, block and invite to existing lobby join code", async () => {
  const f = fixture(),
    a = await f.login("host-google-subject"),
    b = await f.login("friend-google-subject");
  for (const [auth, displayName] of [
    [a, "HOST"],
    [b, "FRIEND"],
  ])
    await f.call(
      "/api/account/profile",
      { displayName, plate: "GR-123" },
      auth,
    );
  const friend = (auth, action, name) =>
    f.call("/api/account/friends", { action, name }, auth);
  await friend(a, "request", "FRIEND");
  await friend(b, "request", "HOST");
  assert.equal(
    f.sqlite.prepare("SELECT count(*) n FROM friendships").get().n,
    1,
  );
  await friend(a, "accept", "FRIEND");
  assert.equal(
    f.sqlite.prepare("SELECT state FROM friendships").get().state,
    "pending",
  );
  await friend(b, "accept", "HOST");
  assert.equal(
    f.sqlite.prepare("SELECT state FROM friendships").get().state,
    "accepted",
  );
  assert.equal(
    (
      await f.call(
        "/api/account/invites",
        { recipient: b.id, token: "bogus" },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/account/invites",
        { recipient: b.id, token: "host-token" },
        a,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    f.notices.filter((n) => n.type === "invite"),
    [{ user: b.id, type: "invite" }],
  );
  const list = await (
    await f.call("/api/account/invites", undefined, b)
  ).json();
  assert.equal(list.length, 1);
  const joined = await (
    await f.call(
      "/api/account/invites",
      { action: "accept", id: list[0].id },
      b,
    )
  ).json();
  assert.equal(joined.lobby, "ABC123");
  assert.equal(
    (
      await f.call(
        "/api/account/invites",
        { action: "accept", id: list[0].id },
        b,
      )
    ).status,
    410,
  );
  await friend(b, "block", "HOST");
  await friend(a, "request", "FRIEND");
  assert.equal(
    f.sqlite.prepare("SELECT state FROM friendships").get().state,
    "blocked",
  );
  assert.equal(
    (
      await f.call(
        "/api/account/invites",
        { recipient: b.id, token: "host-token" },
        a,
      )
    ).status,
    400,
  );
});
test("expired and dead lobby invites are invisible, decline removes pending request", async () => {
  const f = fixture(),
    a = await f.login("a-google-subject"),
    b = await f.login("b-google-subject");
  await f.call(
    "/api/account/profile",
    { displayName: "AAA", plate: "AA-123" },
    a,
  );
  await f.call(
    "/api/account/profile",
    { displayName: "BBB", plate: "BB-123" },
    b,
  );
  await f.call("/api/account/friends", { action: "request", name: "BBB" }, a);
  await f.call("/api/account/friends", { action: "decline", name: "AAA" }, b);
  assert.equal(
    f.sqlite.prepare("SELECT count(*) n FROM friendships").get().n,
    0,
  );
  for (const [id, lobby, expires] of [
    ["old", "ABC123", 0],
    ["dead", "ZZZZZZ", Date.now() + 1000],
  ])
    f.sqlite
      .prepare("INSERT INTO invites VALUES (?,?,?,?,?)")
      .run(id, a.id, b.id, lobby, expires);
  assert.deepEqual(
    await (await f.call("/api/account/invites", undefined, b)).json(),
    [],
  );
});
test("presence fans out only to accepted friends, expires and rejects revoked sessions", async () => {
  const f = fixture(),
    a = await f.login("presence-a-google-subject"),
    b = await f.login("presence-b-google-subject"),
    c = await f.login("stranger-google-subject");
  f.sqlite
    .prepare("INSERT INTO friendships VALUES (?,?,?)")
    .run(a.id, b.id, "accepted");
  const sockets = [];
  const ws = (auth, status = "in-menu") => {
    let data = {
      user: auth.id,
      session: "invalid",
      expires: Date.now() + 100000,
      at: Date.now(),
      status,
      map: "riviera",
    };
    const out = {
      messages: [],
      deserializeAttachment: () => data,
      serializeAttachment: (v) => (data = v),
      send: (v) => out.messages.push(JSON.parse(v)),
      close: () => (out.closed = true),
    };
    sockets.push(out);
    return out;
  };
  const aw = ws(a, "in-race"),
    bw = ws(b),
    cw = ws(c);
  const ctx = {
    getWebSockets: () => sockets,
    storage: { setAlarm: async () => {} },
  };
  const hub = new FriendsPresence(ctx, f.env);
  await hub.fanout(a.id);
  assert.equal(aw.messages.length, 0);
  assert.equal(cw.messages.length, 0);
  assert.equal(bw.messages[0].friends[a.id].status, "in-race");
  aw.serializeAttachment({ ...aw.deserializeAttachment(), at: 0 });
  await hub.fanout(a.id);
  assert.equal(bw.messages.at(-1).friends[a.id].status, "offline");
  await hub.webSocketMessage(aw, JSON.stringify({ type: "heartbeat" }));
  assert.equal(aw.closed, true);
  aw.serializeAttachment({
    ...aw.deserializeAttachment(),
    at: Date.now(),
    status: "in-race",
  });
  await hub.webSocketClose(aw);
  assert.equal(bw.messages.at(-1).friends[a.id].status, "offline");
  assert.equal(visiblePresence({ at: 0, status: "in-race" }).status, "offline");
});
test("guest migration is idempotent, retains local data and excludes credentials; auth outage degrades", async () => {
  const f = fixture(),
    a = await f.login("migrate-google-subject");
  const values = new Map([
    ["paraliaki.settings", '{"volume":1}'],
    ["paraliaki.personalBests.v1", '{"best":10}'],
    ["paraliaki.car", "mini"],
    ["paraliaki.paint.mini", "#ffffff"],
    ["paraliaki.session", "never-copy"],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i],
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
  const progress = guestProgress(storage);
  assert.equal(progress["paraliaki.session"], undefined);
  await f.call("/api/account/migrate", { progress }, a);
  await f.call("/api/account/migrate", { progress: {} }, a);
  const s = await (await f.call("/api/auth/session", undefined, a)).json();
  assert.deepEqual(s.progress, progress);
  restoreProgress(storage, {
    "paraliaki.car": "other",
    "paraliaki.graphics": "low",
    secret: "no",
  });
  assert.equal(values.get("paraliaki.car"), "mini");
  assert.equal(values.get("paraliaki.graphics"), "low");
  assert.equal(values.has("secret"), false);
  const client = new AccountsClient({
    storage,
    fetcher: async () => {
      throw new TypeError("Offline");
    },
  });
  await client.init();
  assert.equal(client.offline, true);
  assert.equal(client.blocked, true);
  assert.equal(client.ready, true);
  assert.equal(offlineAllowed({ status: 401 }, true), false);
});
test("accepted invitation joins the verified host’s actual core lobby with the existing code protocol", async () => {
  const { createGameCore } = await import("./core.mjs");
  const { MULTIPLAYER_PROTOCOL } =
    await import("../src/multiplayer-protocol.js");
  const { arenaAccountStatus } = await import("../worker/account-arena.mjs");
  const core = createGameCore({
    maps: new Map([
      [
        "riviera",
        {
          track: { version: "v" },
          definitions: new Map([
            [
              "quick",
              { id: "quick", type: "sprint", s0: 0, s1: 200, dir: 1, len: 200 },
            ],
          ]),
        },
      ],
    ]),
    cars: new Set(["mini"]),
    leaderboard: { submit: async () => {} },
  });
  const socket = () => ({
    readyState: 1,
    messages: [],
    send(m) {
      this.messages.push(JSON.parse(m));
    },
    close() {},
  });
  const host = socket(),
    guest = socket();
  core.connect(host, "host", { protocol: MULTIPLAYER_PROTOCOL });
  core.connect(guest, "guest", { protocol: MULTIPLAYER_PROTOCOL });
  core.message(
    host,
    JSON.stringify({ type: "create", name: "HOST", car: "mini" }),
  );
  const token = core.clientData(host).token,
    code = core.clientData(host).lobbyCode;
  const f = fixture(),
    a = await f.login("real-host-google-subject"),
    b = await f.login("real-guest-google-subject");
  f.env.GAME.get = () => ({
    fetch: async (request) =>
      Response.json(arenaAccountStatus(core, new URL(request.url))),
  });
  f.sqlite
    .prepare("INSERT INTO friendships VALUES (?,?,?)")
    .run(a.id, b.id, "accepted");
  assert.equal(
    (await f.call("/api/account/invites", { recipient: b.id, token }, a))
      .status,
    200,
  );
  const invite = (
    await (await f.call("/api/account/invites", undefined, b)).json()
  )[0];
  const accepted = await (
    await f.call("/api/account/invites", { action: "accept", id: invite.id }, b)
  ).json();
  assert.equal(accepted.lobby, code);
  core.message(
    guest,
    JSON.stringify({
      type: "join",
      code: accepted.lobby,
      name: "FRIEND",
      car: "mini",
    }),
  );
  assert.equal(core.clientData(guest).lobbyCode, code);
  assert.equal(core.lobbies.get(code).players.size, 2);
});

test("Google signature verification rejects a tampered signature and expired identity", async () => {
  const { verifyGoogleToken } = await import("../worker/google-token.mjs");
  const options = {
    audience: "client",
    nonce: "nonce",
    fetcher: async () => jwks(),
  };
  const claims = {
    sub: "sub",
    iss: "https://accounts.google.com",
    aud: "client",
    nonce: "nonce",
    exp: Date.now() / 1000 + 60,
  };
  const token = await googleToken(claims);
  assert.equal((await verifyGoogleToken(token, options)).sub, "sub");
  const parts = token.split("."),
    signature = Buffer.from(parts[2], "base64url");
  signature[0] ^= 1;
  parts[2] = signature.toString("base64url");
  await assert.rejects(verifyGoogleToken(parts.join("."), options), {
    status: 401,
  });
  await assert.rejects(
    verifyGoogleToken(await googleToken({ ...claims, exp: 1 }), options),
    { status: 401 },
  );
});

test("no real provider leaves legacy play enabled and configuration needs neither tables nor secrets", async () => {
  const url = "https://athensracing.com/api/auth/config";
  const noBindings = await accounts(new Request(url), {});
  assert.deepEqual(await noBindings.json(), { providers: [], required: false });
  const noTables = {
    SESSION_SECRET: "test-secret",
    ACCOUNTS: {
      prepare() {
        assert.fail("config must not query missing tables");
      },
    },
  };
  assert.deepEqual(await (await accounts(new Request(url), noTables)).json(), {
    providers: [],
    required: false,
  });
  const configOnly = {
    ...noTables,
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
  };
  assert.deepEqual(
    await (await accounts(new Request(url), configOnly)).json(),
    { providers: ["google"], required: true },
  );
  const staging = await (
    await accounts(
      new Request("https://staging.athensracing.com/api/auth/config"),
      noTables,
    )
  ).json();
  assert.deepEqual(staging, { providers: [], required: false });
  const calls = [];
  const client = new AccountsClient({
    storage: null,
    fetcher: async (path) => {
      calls.push(path);
      if (path === "/api/auth/config")
        return Response.json({ providers: [], required: false });
      assert.fail("unconfigured auth must not query session/migration APIs");
    },
  });
  await client.init();
  assert.equal(client.required, false);
  assert.equal(client.offline, false);
  assert.equal(client.ready, true);
  assert.deepEqual(calls, ["/api/auth/config"]);
});

test("Google login attempts are rate limited and SESSION_SECRET rotation revokes sessions", async () => {
  const f = fixture(),
    a = await f.login("rotation-subject");
  for (let i = 0; i < 20; i++)
    assert.equal(
      (
        await f.call("/api/auth/google/start", undefined, {
          ip: "fixed-rate-ip",
        })
      ).status,
      302,
    );
  const limited = await f.call("/api/auth/google/start", undefined, { ip: "fixed-rate-ip" });
  assert.equal(limited.status, 302);
  assert.equal(limited.headers.get("location"), "/?signin_error=1");
  assert.equal(f.sqlite.prepare("SELECT count FROM limits WHERE id LIKE 'oauth:%' ORDER BY count DESC").get().count, 21);
  f.env.SESSION_SECRET = "rotated-test-secret-32-random-test-bytes";
  assert.equal((await f.call("/api/account/export", undefined, a)).status, 401);
  f.env.SESSION_SECRET = "";
  assert.deepEqual(await (await f.call("/api/auth/config")).json(), {
    providers: ["google"],
    required: true,
  });
});


test('configured game policy rejects anonymous/invalid/expired sessions and binds leaderboard identity', async () => {
  const { authorizeGame, accountResult, identityActive } = await import('./auth-policy.mjs');
  const f = fixture(), a = await f.login('policy-driver');
  const request = cookie => new Request('https://staging.athensracing.com/api/leaderboard', { headers: cookie ? { Cookie: cookie } : {} });
  for (const cookie of [null, 'ar_session=invalid']) assert.equal((await authorizeGame(request(cookie), f.env)).response.status, 401);
  const auth = await authorizeGame(request(a.cookie), f.env);
  assert.ok(auth.identity); assert.equal(await identityActive(auth.identity, f.env), true);
  const { onlineLeaderboardResult } = await import('./leaderboard-online.mjs');
  const online = onlineLeaderboardResult({ identity: auth.identity, driverId: 'spoof-123', name: 'DUPLICATE-2' }, {}, {});
  assert.equal(online.name, auth.identity.name); assert.equal(online.driverId, auth.identity.userId);
  assert.equal(accountResult({ name: 'SPOOF', driverId: 'spoof-123' }, auth.identity).driverId, auth.identity.userId);
  assert.equal(accountResult({ name: 'SPOOF' }, auth.identity).name, auth.identity.name);
  f.sqlite.exec('DELETE FROM sessions');
  assert.equal(await identityActive(auth.identity, f.env), false);
  assert.equal((await authorizeGame(request(a.cookie), f.env)).response.status, 401);
  assert.equal((await authorizeGame(request(), {})).response, undefined);
});

test('Node configured OAuth rejects gameplay APIs and websocket upgrades; unconfigured local play stays enabled', async t => {
  const { createGameServer } = await import('./index.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { WebSocket } = await import('ws');
  const dataDir = await mkdtemp(join(tmpdir(), 'google-required-test-'));
  const env = { GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test' };
  const app = await createGameServer({ accountEnv: env, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  for (const path of ['/api/lobbies', '/api/leaderboard', '/api/account/export']) {
    const response = await fetch(base + path); assert.equal(response.status, 401, path);
  }
  assert.equal((await fetch(base + '/api/leaderboard', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await (await fetch(base + '/api/auth/config')).json()).required, true);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
    ws.on('unexpected-response', (_, response) => { try { assert.equal(response.statusCode, 401); response.resume(); ws.terminate(); resolve(); } catch (e) { reject(e); } });
    ws.on('open', () => { ws.terminate(); reject(Error('Anonymous upgrade accepted')); }); ws.on('error', () => {});
  });
  delete env.GOOGLE_CLIENT_ID; delete env.GOOGLE_CLIENT_SECRET;
  assert.equal((await fetch(base + '/api/lobbies')).status, 200);
  assert.equal((await (await fetch(base + '/api/auth/config')).json()).required, false);
});

test('client gate reappears on session expiry and connection loss, and clears after a retry', async () => {
  let signedIn = true;
  const client = new AccountsClient({ storage: null, fetcher: async () => Response.json({ user: signedIn ? { id: 'driver', displayName: 'ATHENA' } : null }) });
  client.ready = true;
  await client.revalidate(); assert.equal(client.blocked, false);
  signedIn = false; await client.revalidate(); assert.equal(client.blocked, true); assert.match(client.error, /expired/);
  signedIn = true; await client.revalidate(); assert.equal(client.blocked, false);
  client.connectionLost(); assert.equal(client.blocked, true); assert.match(client.error, /internet/);
  await client.revalidate(); assert.equal(client.blocked, false);
});

test('public Worker denies anonymous gameplay before forwarding to the arena', async () => {
  const { build } = await import('esbuild');
  const bundled = await build({ entryPoints: ['worker/index.mjs'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'worker-test-bindings', setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare', namespace: 'stub' }));
    b.onResolve({ filter: /\.deploy\/catalogue\.json$/ }, () => ({ path: 'catalogue', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'cloudflare' ? 'export class DurableObject {}' : 'export default {maps:[],cars:[]}', loader: 'js' }));
  } }] });
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))).default;
  let forwarded = 0;
  const env = { GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test', GAME: { idFromName: x => x, get: () => ({ fetch: () => { forwarded++; return Response.json([]); } }) } };
  for (const path of ['/ws', '/api/lobbies', '/api/leaderboard', '/api/account/presence', '/api/account/export']) {
    const response = await worker.fetch(new Request('https://staging.athensracing.com' + path), env); assert.equal(response.status, 401, path);
  }
  assert.equal((await worker.fetch(new Request('https://staging.athensracing.com/api/leaderboard', { method: 'POST', body: '{}' }), env)).status, 401);
  assert.equal(forwarded, 0);
  delete env.GOOGLE_CLIENT_ID;
  assert.equal((await worker.fetch(new Request('https://staging.athensracing.com/api/lobbies'), env)).status, 200);
  assert.equal(forwarded, 1);
});


test('the client closes the gate at the session expiry deadline', async () => {
  const client = new AccountsClient({ storage: null }); client.ready = true;
  client.setSession({ user: { id: 'driver', displayName: 'ATHENA' }, expires: Date.now() + 10 });
  assert.equal(client.blocked, false);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(client.blocked, true); assert.match(client.error, /expired/);
});
