// User accounts, server sessions and per-account stats. Shared by the Node
// VPS server (guest-only stub) and the Cloudflare Worker (full Google
// sign-in); runs in both, so: no node: imports, no async crypto, no
// filesystem here. Storage lives behind server/social-store.mjs:
//
//   users    getUserBySub / getUserByKey (USERNAME) / saveUser / searchUsers
//   sessions saveSession / getSession / deleteSession / pruneSessions
//   tickets  saveTicket / consumeTicket (single-use WS login tickets)
//
// Identity model (passwordless by construction):
// - Google OpenID Connect is the only credential. The Worker verifies the
//   ID token against Google's JWKS (worker/oidc.mjs), keyed by `sub`.
// - Users are keyed by Google `sub` (stable). The USERNAME (the license
//   plate) is picked after first sign-in, is unique case-insensitively
//   (3-16 chars [A-Z0-9-]), and may be changed later without touching the
//   friend graph, which references `sub` everywhere.
// - Only the minimal profile is stored: sub, username, display name, avatar
//   URL. No email is displayed anywhere.
// - Sessions are random 256-bit ids, SHA-256 hashed server-side, carried in
//   an HttpOnly Secure SameSite=Lax cookie. The WebSocket handshake reads
//   the cookie; clients without cookie support fetch a 60-second single-use
//   ticket over HTTPS and pass it in { type: 'auth', ticket }.
// - Guests (no session) can always play: guest plates are random and no
//   stats or friends accrue.
//
// Stats (counts and best times only; NO XP/levels/points/progression):
//   started/finished/wins/podiums/dnfs count MULTIPLAYER races only and are
//   written server-side from validated race results (core results(), whose
//   finishes come from the existing server finish validation).
//   best: best time per "mapId|eventId|car|traffic", from multiplayer and
//   from solo leaderboard submissions that carry a session (those go through
//   the existing leaderboard/finish validation first).
//   km: total event kilometres. cars: finishes per car id; favouriteCar
//   derives from it (most finishes). Wins need placement 1 of a 2+ driver
//   field; podiums need top 3 of a 3+ field.
export const USERNAME_RE = /^[A-Z0-9-]{3,16}$/;

export const normalizeUsername = (v) => String(v ?? '').trim().toUpperCase();
export const validUsername = (v) => USERNAME_RE.test(normalizeUsername(v));

export function cleanDisplayName(v, fallback) {
  const s = String(v ?? '').replace(/[	-\r<>]/g, '').trim().slice(0, 28);
  return s || fallback;
}

const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };

// --- synchronous SHA-256 (hex). SubtleCrypto is async, but core message
// handling and the stores are synchronous, so hashing must be synchronous
// too. Standard FIPS 180-4, verified against the 'abc' vector in tests.
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
export function sha256Hex(message) {
  const bytes = new TextEncoder().encode(String(message ?? ''));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Int32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

const randomHex = (n) => [...globalThis.crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');

const blankStats = () => ({ started: 0, finished: 0, wins: 0, podiums: 0, dnfs: 0, km: 0, cars: {}, best: {} });
export const bestKey = (mapId, eventId, car, traffic) => `${mapId}|${eventId}|${car}|${traffic ? 1 : 0}`;
export function favouriteCar(stats) {
  let top = null;
  for (const [car, count] of Object.entries(stats?.cars || {})) {
    if (top === null || count > (stats.cars[top] || 0)) top = car;
  }
  return top;
}
const addKm = (stats, km) => { stats.km = Math.round((stats.km + (Number(km) || 0)) * 1000) / 1000; };
const noteCar = (stats, car, time, key) => {
  if (typeof car === 'string' && car) stats.cars[car] = (stats.cars[car] || 0) + 1;
  if (key && Number.isFinite(time) && (stats.best[key] === undefined || time < stats.best[key])) stats.best[key] = time;
};

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const TICKET_TTL_MS = 60 * 1000;

export function createAccountService(store, { now = () => Date.now(), sessionTtlMs = SESSION_TTL_MS, ticketTtlMs = TICKET_TTL_MS } = {}) {
  const publicUser = (row) => ({
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl || '',
    stats: { ...row.stats, cars: { ...row.stats.cars }, best: { ...row.stats.best }, favouriteCar: favouriteCar(row.stats) },
  });

  return {
    // First sign-in creates the row; later sign-ins refresh the Google
    // profile but never overwrite a claimed username.
    upsertGoogleUser({ sub, displayName, avatarUrl }) {
      if (typeof sub !== 'string' || !sub) fail('Unknown Google identity.', 400);
      const at = now();
      let row = store.getUserBySub(sub);
      if (!row) {
        row = { sub, username: '', displayName: cleanDisplayName(displayName, 'DRIVER'), avatarUrl: String(avatarUrl || ''), createdAt: at, stats: blankStats() };
      } else {
        row.displayName = cleanDisplayName(displayName, row.displayName);
        if (avatarUrl) row.avatarUrl = String(avatarUrl);
      }
      store.saveUser(row);
      return publicUser(row);
    },
    // Usernames are unique case-insensitively and may be changed; the
    // friend graph keys on `sub`, so renames orphan nothing.
    setUsername(sub, username) {
      const key = normalizeUsername(username);
      if (!validUsername(username)) fail('Username must be 3-16 characters: A-Z, 0-9, hyphen.', 400);
      const row = store.getUserBySub(sub);
      if (!row) fail('Sign in with Google first.', 401);
      const taken = store.getUserByKey(key);
      if (taken && taken.sub !== sub) fail('That username is taken.', 409);
      row.username = key;
      store.saveUser(row);
      return publicUser(row);
    },
    createSession(sub) {
      const id = randomHex(32), at = now();
      store.saveSession({ hash: sha256Hex('session-v1:' + id), sub, createdAt: at, expiresAt: at + sessionTtlMs });
      return { id, expiresAt: at + sessionTtlMs };
    },
    verifySession(id) {
      if (typeof id !== 'string' || !id) return null;
      const s = store.getSession(sha256Hex('session-v1:' + id));
      if (!s || s.expiresAt <= now()) return null;
      const row = store.getUserBySub(s.sub);
      return row ? { sub: row.sub, username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl } : null;
    },
    revokeSession(id) {
      if (typeof id !== 'string' || !id) return false;
      const hash = sha256Hex('session-v1:' + id);
      if (!store.getSession(hash)) return false;
      store.deleteSession(hash);
      return true;
    },
    // Short-lived single-use ticket binding a WebSocket to a session.
    createTicket(sub) {
      const ticket = randomHex(16), at = now();
      store.saveTicket({ hash: sha256Hex('ticket-v1:' + ticket), sub, expiresAt: at + ticketTtlMs });
      return { ticket, expiresIn: Math.round(ticketTtlMs / 1000) };
    },
    verifyTicket(ticket) {
      if (typeof ticket !== 'string' || !ticket) return null;
      const t = store.consumeTicket(sha256Hex('ticket-v1:' + ticket));
      if (!t || t.expiresAt <= now()) return null;
      const row = store.getUserBySub(t.sub);
      return row ? { sub: row.sub, username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl } : null;
    },
    get(subOrUsername) {
      const row = store.getUserBySub(subOrUsername) || store.getUserByKey(subOrUsername);
      return row ? publicUser(row) : null;
    },
    // Server-authoritative multiplayer results. entries: [{ sub, car,
    // finish (seconds | null), placement (1-based among finishers | null) }];
    // event: { mapId, eventId, traffic, km } with km = event length in km.
    recordMpResults(entries, event) {
      const fieldSize = (entries || []).length;
      for (const e of entries || []) {
        const row = e?.sub ? store.getUserBySub(e.sub) : null;
        if (!row) continue;
        const s = row.stats;
        s.started += 1;
        noteCar(s, e.car, e.finish, e.finish !== null && e.finish !== undefined
          ? bestKey(event.mapId, event.eventId, e.car, event.traffic) : null);
        if (e.finish !== null && e.finish !== undefined) {
          s.finished += 1;
          addKm(s, event.km);
          if (e.placement === 1 && fieldSize >= 2) s.wins += 1;
          if (e.placement !== null && e.placement <= 3 && fieldSize >= 3) s.podiums += 1;
        } else {
          s.dnfs += 1;
        }
        store.saveUser(row);
      }
    },
    // A validated solo leaderboard submission from a signed-in session.
    // Solo runs update best times, kilometres and car affinity only; the
    // started/finished/win/podium/DNF counters stay multiplayer-only.
    recordSolo({ sub, car, mapId, eventId, traffic, time, km }) {
      const row = sub ? store.getUserBySub(sub) : null;
      if (!row || !Number.isFinite(time)) return false;
      const s = row.stats;
      noteCar(s, car, time, bestKey(mapId, eventId, car, traffic));
      addKm(s, km);
      store.saveUser(row);
      return true;
    },
  };
}
