import { verifyGoogleToken } from "./google-token.mjs";
import { cleanProgress } from "../src/account-progress.js";
import { normalizeDriverName } from "../src/driver-name.js";
// All tokens stored as hashes; provider tokens are used once and never persisted.
export const json = (v, status = 200, headers = {}) =>
  Response.json(v, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export const random = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const b64 = (a) =>
  btoa(String.fromCharCode(...new Uint8Array(a)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export const hash = async (s) =>
  b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export const cookie = (name, value, age) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const cookies = (r) =>
  Object.fromEntries(
    (r.headers.get("Cookie") || "").split(";").map((s) => s.trim().split("=")),
  );
const run = (db, q, ...v) => db.prepare(q).bind(...v);
const all = async (db, q, ...v) => (await run(db, q, ...v).all()).results;
export const devEmail = (env, url) =>
  !env.RESEND_API_KEY &&
  (url.hostname === "staging.athensracing.com" ||
    ["localhost", "127.0.0.1"].includes(url.hostname));
export const providers = (env, url) =>
  ["google", "discord"]
    .filter(
      (p) =>
        env[p.toUpperCase() + "_CLIENT_ID"] &&
        env[p.toUpperCase() + "_CLIENT_SECRET"],
    )
    .concat(env.RESEND_API_KEY || devEmail(env, url) ? ["email"] : []);
export async function session(request, env) {
  const token = cookies(request).ar_session;
  return token && env.ACCOUNTS
    ? run(
        env.ACCOUNTS,
        "SELECT s.*, u.display_name, u.plate, u.avatar, u.progress, u.migrated FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
        await hash(token),
        Date.now(),
      ).first()
    : null;
}
export function csrf(request, s, origin) {
  if (
    request.headers.get("Origin") !== origin ||
    !s ||
    request.headers.get("X-CSRF-Token") !== s.csrf
  )
    fail("Refresh the page and try again.", 403);
}
async function limit(db, key, max, duration = 600000) {
  const now = Date.now();
  const row = await run(
    db,
    "INSERT INTO limits VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count",
    key,
    now + duration,
    now,
    now,
  ).first();
  if (row.count > max) fail("Too many attempts. Please wait.", 429);
}
const oauth = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    profile: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    profile: "https://discord.com/api/users/@me",
    scope: "identify",
  },
};
async function identity(db, provider, subject) {
  const id = crypto.randomUUID();
  await db.batch([
    run(
      db,
      "INSERT OR IGNORE INTO users(id,created_at) VALUES (?,?)",
      id,
      Date.now(),
    ),
    run(
      db,
      "INSERT OR IGNORE INTO identities VALUES (?,?,?)",
      provider,
      subject,
      id,
    ),
  ]);
  const existing = await run(
    db,
    "SELECT user_id FROM identities WHERE provider=? AND subject=?",
    provider,
    subject,
  ).first();
  if (existing.user_id !== id)
    await run(db, "DELETE FROM users WHERE id=?", id).run();
  return existing.user_id;
}
async function login(db, user) {
  const token = random(),
    xsrf = random();
  await run(
    db,
    "INSERT INTO sessions VALUES (?,?,?,?)",
    await hash(token),
    user,
    xsrf,
    Date.now() + 2592000000,
  ).run();
  return cookie("ar_session", token, 2592000);
}
async function body(request) {
  const reader = request.body?.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 131072) {
        await reader.cancel();
        fail("Request too large", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
  try {
    return JSON.parse(text || "{}");
  } catch {
    fail("Invalid JSON");
  }
}
export async function accounts(request, env, fetcher = fetch) {
  try {
    const url = new URL(request.url),
      p = url.pathname,
      db = env.ACCOUNTS,
      now = Date.now();
    if (!db || !env.SESSION_SECRET)
      return json(
        { error: "Accounts are temporarily unavailable. Play offline." },
        503,
      );
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "Method not allowed" }, 405);
    if (
      request.method === "POST" &&
      request.headers.get("Origin") !== url.origin
    )
      fail("Origin mismatch", 403);
    const s = await session(request, env);
    if (p === "/api/auth/config")
      return json({ providers: providers(env, url) });
    if (p === "/api/auth/session")
      return json(
        s
          ? {
              user: {
                id: s.user_id,
                displayName: s.display_name,
                plate: s.plate,
                avatar: s.avatar,
              },
              csrf: s.csrf,
              progress: JSON.parse(s.progress),
              migrated: !!s.migrated,
            }
          : { user: null },
      );
    if (p === "/api/auth/email/request" && request.method === "POST") {
      if (!providers(env, url).includes("email"))
        fail("Email sign-in unavailable", 503);
      const b = await body(request),
        email = String(b.email || "")
          .trim()
          .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        fail("Enter your email address.");
      await limit(
        db,
        "code-ip:" +
          (await hash(request.headers.get("CF-Connecting-IP") || "local")),
        8,
      );
      await limit(db, "code-email:" + (await hash(email)), 3);
      const id = random(),
        code = String(
          crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
        ).padStart(6, "0");
      await run(
        db,
        "INSERT INTO challenges VALUES (?,?,?,?)",
        await hash(id),
        "email",
        JSON.stringify({
          email,
          code: await hash(env.SESSION_SECRET + id + code),
        }),
        now + 600000,
      ).run();
      if (env.RESEND_API_KEY) {
        const res = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM || "Athens Racing <accounts@athensracing.com>",
            to: [email],
            subject: "Your Athens Racing sign-in code",
            text: `Your code is ${code}. It expires in 10 minutes.`,
          }),
        });
        if (!res.ok) fail("Email delivery unavailable. Try again later.", 503);
      }
      return json({ id, ...(devEmail(env, url) ? { devCode: code } : {}) });
    }
    if (p === "/api/auth/email/verify" && request.method === "POST") {
      await limit(
        db,
        "login:" +
          (await hash(request.headers.get("CF-Connecting-IP") || "local")),
        15,
      );
      const b = await body(request),
        key = await hash(String(b.id)),
        c = await run(
          db,
          "SELECT * FROM challenges WHERE id=? AND kind=? AND expires>?",
          key,
          "email",
          now,
        ).first();
      if (!c) fail("Code expired. Request another.");
      const d = JSON.parse(c.data);
      await limit(db, "attempt:" + key, 5);
      if ((await hash(env.SESSION_SECRET + b.id + String(b.code))) !== d.code)
        fail("Incorrect code.");
      const consumed = await run(
        db,
        "DELETE FROM challenges WHERE id=? RETURNING id",
        key,
      ).first();
      if (!consumed) fail("Code already used.");
      return json({ ok: true }, 200, {
        "Set-Cookie": await login(db, await identity(db, "email", d.email)),
      });
    }
    const match = p.match(/^\/api\/auth\/(google|discord)\/(start|callback)$/);
    if (match && request.method === "GET") {
      const [, provider, step] = match,
        config = oauth[provider],
        prefix = provider.toUpperCase();
      if (!providers(env, url).includes(provider))
        fail("Provider unavailable", 404);
      if (
        ![
          "athensracing.com",
          "staging.athensracing.com",
          "localhost",
          "127.0.0.1",
        ].includes(url.hostname)
      )
        fail("Unregistered redirect host", 400);
      const redirect = url.origin + `/api/auth/${provider}/callback`;
      if (step === "start") {
        await limit(
          db,
          "oauth:" +
            (await hash(request.headers.get("CF-Connecting-IP") || "local")),
          20,
        );
        const state = random(),
          verifier = random(),
          nonce = random(),
          binding = random();
        await run(
          db,
          "INSERT INTO challenges VALUES (?,?,?,?)",
          await hash(state),
          "oauth",
          JSON.stringify({
            provider,
            verifier,
            nonce,
            binding: await hash(binding),
            redirect,
          }),
          now + 600000,
        ).run();
        const dest = new URL(config.authorize);
        dest.search = new URLSearchParams({
          client_id: env[prefix + "_CLIENT_ID"],
          redirect_uri: redirect,
          response_type: "code",
          scope: config.scope,
          state,
          nonce,
          code_challenge: await hash(verifier),
          code_challenge_method: "S256",
        });
        return new Response(null, {
          status: 302,
          headers: {
            Location: dest.href,
            "Set-Cookie": cookie("ar_oauth", binding, 600),
            "Cache-Control": "no-store",
          },
        });
      }
      const key = await hash(url.searchParams.get("state") || ""),
        c = await run(
          db,
          "SELECT * FROM challenges WHERE id=? AND kind=? AND expires>?",
          key,
          "oauth",
          now,
        ).first();
      if (!c) fail("Sign-in expired. Start again.");
      const d = JSON.parse(c.data);
      if (
        d.provider !== provider ||
        d.redirect !== redirect ||
        d.binding !== (await hash(cookies(request).ar_oauth || ""))
      )
        fail("Invalid sign-in state", 403);
      if (
        !(await run(
          db,
          "DELETE FROM challenges WHERE id=? RETURNING id",
          key,
        ).first())
      )
        fail("Sign-in already used");
      const tokenResponse = await fetcher(config.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env[prefix + "_CLIENT_ID"],
          client_secret: env[prefix + "_CLIENT_SECRET"],
          code: url.searchParams.get("code") || "",
          grant_type: "authorization_code",
          redirect_uri: redirect,
          code_verifier: d.verifier,
        }),
      });
      if (!tokenResponse.ok) fail("Provider rejected sign-in", 401);
      const token = await tokenResponse.json();
      let googleSubject;
      if (provider === "google") {
        const claims = await verifyGoogleToken(token.id_token, {
          audience: env.GOOGLE_CLIENT_ID,
          nonce: d.nonce,
          fetcher,
          now,
        });
        googleSubject = claims.sub;
      }
      const profileResponse = await fetcher(config.profile, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!profileResponse.ok) fail("Could not read provider identity", 401);
      const profile = await profileResponse.json(),
        subject = provider === "google" ? profile.sub : profile.id;
      if (!subject || (provider === "google" && subject !== googleSubject))
        fail("Missing or mismatched provider identity", 401);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/?account=1",
          "Set-Cookie": await login(db, await identity(db, provider, subject)),
          "Cache-Control": "no-store",
        },
      });
    }
    if (!s) fail("Sign in first", 401);
    if (request.method === "POST") csrf(request, s, url.origin);
    const user = s.user_id;
    if (p === "/api/auth/logout" && request.method === "POST") {
      await run(db, "DELETE FROM sessions WHERE token=?", s.token).run();
      return json({ ok: true }, 200, {
        "Set-Cookie": cookie("ar_session", "", 0),
      });
    }
    if (p === "/api/account/export" && request.method === "GET")
      return json({
        profile: await run(db, "SELECT * FROM users WHERE id=?", user).first(),
        identities: await all(
          db,
          "SELECT provider,subject FROM identities WHERE user_id=?",
          user,
        ),
        friendships: await all(
          db,
          "SELECT * FROM friendships WHERE sender=? OR recipient=?",
          user,
          user,
        ),
        invites: await all(
          db,
          "SELECT * FROM invites WHERE sender=? OR recipient=?",
          user,
          user,
        ),
      });
    if (p === "/api/account/delete" && request.method === "POST") {
      const b = await body(request);
      if (b.confirm !== "DELETE") fail("Type DELETE to confirm.");
      await db.batch(
        ["invites", "friendships", "sessions", "identities"]
          .map((t) =>
            run(
              db,
              `DELETE FROM ${t} WHERE ${t === "sessions" || t === "identities" ? "user_id=?" : "sender=? OR recipient=?"}`,
              ...(t === "sessions" || t === "identities"
                ? [user]
                : [user, user]),
            ),
          )
          .concat(run(db, "DELETE FROM users WHERE id=?", user)),
      );
      return json({ ok: true }, 200, {
        "Set-Cookie": cookie("ar_session", "", 0),
      });
    }
    if (p === "/api/account/profile" && request.method === "POST") {
      const b = await body(request);
      let name;
      try {
        name = normalizeDriverName(b.displayName);
      } catch (e) {
        fail(e.message);
      }
      if (!/^[A-Z0-9-]{2,10}$/.test(b.plate || ""))
        fail("Use 2–10 capital letters, numbers or hyphens for your plate.");
      try {
        await run(
          db,
          "UPDATE users SET display_name=?,plate=? WHERE id=?",
          name,
          b.plate,
          user,
        ).run();
      } catch {
        fail("That display name is taken.");
      }
      return json({ ok: true });
    }
    if (p === "/api/account/migrate" && request.method === "POST") {
      const b = await body(request);
      await run(
        db,
        "UPDATE users SET progress=?,migrated=1 WHERE id=? AND migrated=0",
        JSON.stringify(cleanProgress(b.progress)),
        user,
      ).run();
      return json({ ok: true });
    }
    if (p === "/api/account/friends" && request.method === "GET")
      return json(
        await all(
          db,
          "SELECT f.*,u.id,u.display_name,u.plate FROM friendships f JOIN users u ON u.id=CASE WHEN f.sender=? THEN f.recipient ELSE f.sender END WHERE (f.sender=? OR f.recipient=?) AND (f.state<>? OR f.sender=?)",
          user,
          user,
          user,
          "blocked",
          user,
        ),
      );
    if (p === "/api/account/friends" && request.method === "POST") {
      const b = await body(request),
        target = await run(
          db,
          "SELECT id FROM users WHERE display_name=? COLLATE NOCASE",
          String(b.name || ""),
        ).first();
      if (!target || target.id === user) fail("Driver not found.");
      const other = target.id;
      if (b.action === "block") {
        await db.batch([
          run(
            db,
            "DELETE FROM friendships WHERE sender=? AND recipient=? OR sender=? AND recipient=?",
            user,
            other,
            other,
            user,
          ),
          run(
            db,
            "INSERT INTO friendships VALUES (?,?,?)",
            user,
            other,
            "blocked",
          ),
          run(
            db,
            "DELETE FROM invites WHERE sender=? AND recipient=? OR sender=? AND recipient=?",
            user,
            other,
            other,
            user,
          ),
        ]);
      } else if (b.action === "accept") {
        await run(
          db,
          "UPDATE friendships SET state=? WHERE sender=? AND recipient=? AND state=?",
          "accepted",
          other,
          user,
          "pending",
        ).run();
      } else if (b.action === "decline") {
        await run(
          db,
          "DELETE FROM friendships WHERE sender=? AND recipient=? AND state=?",
          other,
          user,
          "pending",
        ).run();
      } else if (b.action === "request") {
        await run(
          db,
          "INSERT INTO friendships SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM friendships WHERE sender=? AND recipient=? OR sender=? AND recipient=?)",
          user,
          other,
          "pending",
          user,
          other,
          other,
          user,
        ).run();
      } else fail("Unknown friend action");
      await env.PRESENCE.get(env.PRESENCE.idFromName("friends-v1")).fetch(
        new Request("https://internal/notify", {
          method: "POST",
          body: JSON.stringify({ user: other, type: "social" }),
        }),
      );
      return json({ ok: true });
    }
    if (p.startsWith("/api/account/invites"))
      return await inviteRoute(request, env, s, url, fetcher);
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json(
      { error: e.status ? e.message : "Accounts are temporarily unavailable." },
      e.status || 503,
    );
  }
}
async function inviteRoute(request, env, s, url) {
  const db = env.ACCOUNTS,
    user = s.user_id,
    now = Date.now();
  const live = async (code) => {
    const r = await env.GAME.get(env.GAME.idFromName("arena-v1")).fetch(
      new Request(
        "https://internal/api/account/live?code=" + encodeURIComponent(code),
      ),
    );
    return r.ok && (await r.json()).live;
  };
  if (request.method === "GET") {
    const rows = await all(
      db,
      "SELECT i.*,u.display_name FROM invites i JOIN users u ON u.id=i.sender WHERE recipient=? AND expires>?",
      user,
      now,
    );
    return json(
      (
        await Promise.all(
          rows.map(async (i) => ((await live(i.lobby)) ? i : null)),
        )
      ).filter(Boolean),
    );
  }
  const b = await body(request);
  if (b.action === "accept") {
    const i = await run(
      db,
      "DELETE FROM invites WHERE id=? AND recipient=? AND expires>? RETURNING *",
      b.id,
      user,
      now,
    ).first();
    if (!i || !(await live(i.lobby))) fail("Lobby is no longer live", 410);
    return json({ lobby: i.lobby });
  }
  if (b.action === "decline") {
    await run(
      db,
      "DELETE FROM invites WHERE id=? AND recipient=?",
      b.id,
      user,
    ).run();
    return json({ ok: true });
  }
  const friend = await run(
    db,
    "SELECT 1 FROM friendships WHERE state=? AND (sender=? AND recipient=? OR sender=? AND recipient=?)",
    "accepted",
    user,
    b.recipient,
    b.recipient,
    user,
  ).first();
  if (!friend) fail("Invite an accepted friend.");
  await limit(db, "invite:" + user, 12, 60000);
  // Presence only records a lobby after the arena has verified the host's multiplayer token.
  const hub = env.PRESENCE.get(env.PRESENCE.idFromName("friends-v1"));
  const verified = await (
    await env.GAME.get(env.GAME.idFromName("arena-v1")).fetch(
      new Request(
        "https://internal/api/account/live?token=" +
          encodeURIComponent(String(b.token || "")),
      ),
    )
  ).json();
  const host = { lobby: verified.host ? verified.code : null };
  if (!host.lobby || !(await live(host.lobby)))
    fail("Create a live lobby first.");
  await run(
    db,
    "INSERT INTO invites VALUES (?,?,?,?,?)",
    crypto.randomUUID(),
    user,
    b.recipient,
    host.lobby,
    now + 120000,
  ).run();
  await hub.fetch(
    new Request("https://internal/notify", {
      method: "POST",
      body: JSON.stringify({ user: b.recipient, type: "invite" }),
    }),
  );
  return json({ ok: true });
}
