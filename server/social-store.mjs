// Social storage: users (Google sub -> profile + stats), server sessions,
// single-use WS tickets, OAuth login states, friend graph, blocks, recent
// players. One synchronous interface with two implementations:
//
// - createMemorySocialStore(): unit tests and ephemeral use.
// - createSqlSocialStore(sql): Cloudflare Durable Object SQLite. `sql` is
//   { exec(query, ...args) } (ctx.storage.sql in the Worker, node:sqlite
//   shim in tests). Small tables, indexed lookups, no KV/D1/R2.
//
// The friend graph is keyed by Google `sub` (stable), never by username, so
// renaming never orphans friendships. User rows carry the username for
// display, plates and search; '' means "signed in, username not picked yet".
//
// User row: { sub, username, displayName, avatarUrl, createdAt, stats }
// Stats shape is defined in server/accounts.mjs (counts + bests, no XP).
const nowSec = () => Math.floor(Date.now() / 1000);

export function createMemorySocialStore() {
  const users = new Map(), sessions = new Map(), tickets = new Map(), states = new Map();
  const requests = new Map(), blocks = new Set(), recent = new Map();
  const reqKey = (a, b) => a + '\n' + b;
  return {
    getUserBySub: (sub) => users.get(sub),
    getUserByKey: (key) => { const k = String(key || '').toUpperCase(); for (const u of users.values()) if (u.username === k) return u; return undefined; },
    saveUser: (user) => { users.set(user.sub, user); },
    searchUsers: (prefix, limit = 20) => {
      const p = String(prefix || '').toUpperCase();
      const out = [];
      for (const u of users.values()) {
        if (!u.username || !u.username.startsWith(p)) continue;
        out.push(u); if (out.length >= limit) break;
      }
      return out.sort((a, b) => a.username < b.username ? -1 : 1);
    },
    saveSession: (s) => { sessions.set(s.hash, s); },
    getSession: (hash) => sessions.get(hash),
    deleteSession: (hash) => sessions.delete(hash),
    pruneSessions: (at = nowSec()) => { for (const [h, s] of sessions) if (s.expiresAt <= at) sessions.delete(h); },
    saveTicket: (t) => { tickets.set(t.hash, t); },
    consumeTicket: (hash) => { const t = tickets.get(hash); if (t) tickets.delete(hash); return t; },
    saveState: (s) => { states.set(s.state, s); },
    consumeState: (state) => { const s = states.get(state); if (s) states.delete(state); return s; },
    pruneStates: (at = Date.now()) => { for (const [k, s] of states) if (s.expiresAt <= at) states.delete(k); },
    getRequest: (from, to) => requests.get(reqKey(from, to)),
    saveRequest: (r) => { requests.set(reqKey(r.from, r.to), r); },
    deleteRequest: (from, to) => { requests.delete(reqKey(from, to)); },
    requestsFor: (sub) => [...requests.values()].filter((r) => r.from === sub || r.to === sub),
    addBlock: (blocker, blocked) => { blocks.add(reqKey(blocker, blocked)); },
    removeBlock: (blocker, blocked) => { blocks.delete(reqKey(blocker, blocked)); },
    isBlocked: (a, b) => blocks.has(reqKey(a, b)) || blocks.has(reqKey(b, a)),
    blocksBy: (blocker) => [...blocks].filter((k) => k.startsWith(blocker + '\n')).map((k) => k.slice(blocker.length + 1)),
    touchRecent: (user, peer, at) => { recent.set(reqKey(user, peer), at); },
    recentFor: (user, limit = 20) => [...recent.entries()].filter(([k]) => k.startsWith(user + '\n')).map(([k, at]) => ({ peer: k.slice(user.length + 1), at })).sort((a, b) => b.at - a.at).slice(0, limit),
  };
}

export function createSqlSocialStore(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS users (sub TEXT PRIMARY KEY, username TEXT UNIQUE, displayName TEXT NOT NULL, avatarUrl TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, sub TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_sub ON sessions(sub);
    CREATE TABLE IF NOT EXISTS tickets (hash TEXT PRIMARY KEY, sub TEXT NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS friend_requests (fromUser TEXT NOT NULL, toUser TEXT NOT NULL, status TEXT NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY (fromUser, toUser));
    CREATE TABLE IF NOT EXISTS blocks (blocker TEXT NOT NULL, blocked TEXT NOT NULL, PRIMARY KEY (blocker, blocked));
    CREATE TABLE IF NOT EXISTS recent (user TEXT NOT NULL, peer TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user, peer));`);
  const decodeUser = (row) => row && { sub: row.sub, username: row.username || '', displayName: row.displayName, avatarUrl: row.avatarUrl || '', createdAt: row.createdAt, stats: JSON.parse(row.data) };
  const encodeUser = (u) => [u.sub, u.username || null, u.displayName, u.avatarUrl || '', u.createdAt, JSON.stringify(u.stats)];
  // Decoded to { from, to, status, updatedAt } like the memory store, so
  // the service never sees SQL column names.
  const decodeRequest = (row) => row && { from: row.fromUser, to: row.toUser, status: row.status, updatedAt: row.updatedAt };
  return {
    getUserBySub: (sub) => decodeUser([...sql.exec('SELECT * FROM users WHERE sub = ?', sub)][0]),
    getUserByKey: (key) => decodeUser([...sql.exec('SELECT * FROM users WHERE username = ?', String(key || '').toUpperCase())][0]),
    saveUser: (u) => { sql.exec('INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?, ?, ?)', ...encodeUser(u)); },
    searchUsers: (prefix, limit = 20) => [...sql.exec('SELECT * FROM users WHERE username LIKE ? ORDER BY username LIMIT ?', String(prefix || '').toUpperCase() + '%', Math.max(1, Math.min(50, limit || 20)))].map(decodeUser).filter((u) => u.username),
    saveSession: (s) => { sql.exec('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?)', s.hash, s.sub, s.createdAt, s.expiresAt); },
    getSession: (hash) => [...sql.exec('SELECT * FROM sessions WHERE hash = ?', hash)][0],
    deleteSession: (hash) => { sql.exec('DELETE FROM sessions WHERE hash = ?', hash); },
    pruneSessions: (at = nowSec()) => { sql.exec('DELETE FROM sessions WHERE expiresAt <= ?', at); sql.exec('DELETE FROM tickets WHERE expiresAt <= ?', at); },
    saveTicket: (t) => { sql.exec('INSERT OR REPLACE INTO tickets VALUES (?, ?, ?)', t.hash, t.sub, t.expiresAt); },
    consumeTicket: (hash) => { const t = [...sql.exec('SELECT * FROM tickets WHERE hash = ?', hash)][0]; if (t) sql.exec('DELETE FROM tickets WHERE hash = ?', hash); return t; },
    saveState: (s) => { sql.exec('INSERT OR REPLACE INTO oauth_states VALUES (?, ?)', s.state, JSON.stringify(s)); },
    consumeState: (state) => { const row = [...sql.exec('SELECT data FROM oauth_states WHERE state = ?', state)][0]; if (row) sql.exec('DELETE FROM oauth_states WHERE state = ?', state); return row && JSON.parse(row.data); },
    pruneStates: (at = Date.now()) => { for (const row of [...sql.exec('SELECT state, data FROM oauth_states')]) { try { if (JSON.parse(row.data).expiresAt <= at) sql.exec('DELETE FROM oauth_states WHERE state = ?', row.state); } catch {} } },
    getRequest: (from, to) => decodeRequest([...sql.exec('SELECT * FROM friend_requests WHERE fromUser = ? AND toUser = ?', from, to)][0]),
    saveRequest: (r) => { sql.exec('INSERT OR REPLACE INTO friend_requests VALUES (?, ?, ?, ?)', r.from, r.to, r.status, r.updatedAt); },
    deleteRequest: (from, to) => { sql.exec('DELETE FROM friend_requests WHERE fromUser = ? AND toUser = ?', from, to); },
    requestsFor: (sub) => [...sql.exec('SELECT * FROM friend_requests WHERE fromUser = ? OR toUser = ?', sub, sub)].map(decodeRequest),
    addBlock: (blocker, blocked) => { sql.exec('INSERT OR REPLACE INTO blocks VALUES (?, ?)', blocker, blocked); },
    removeBlock: (blocker, blocked) => { sql.exec('DELETE FROM blocks WHERE blocker = ? AND blocked = ?', blocker, blocked); },
    isBlocked: (a, b) => [...sql.exec('SELECT 1 FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)', a, b, b, a)].length > 0,
    blocksBy: (blocker) => [...sql.exec('SELECT blocked FROM blocks WHERE blocker = ?', blocker)].map((r) => r.blocked),
    touchRecent: (user, peer, at) => { sql.exec('INSERT OR REPLACE INTO recent VALUES (?, ?, ?)', user, peer, at); },
    recentFor: (user, limit = 20) => [...sql.exec('SELECT peer, at FROM recent WHERE user = ? ORDER BY at DESC LIMIT ?', user, Math.max(1, Math.min(50, limit || 20)))],
  };
}
