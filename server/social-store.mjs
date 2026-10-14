// Account and social stores share the arena SQLite database. All times are milliseconds.
export function createMemorySocialStore() {
  const users = new Map(), sessions = new Map(), tickets = new Map(), credentials = new Map(), devices = new Map(), limits = new Map();
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
    pruneSessions: (at = Date.now()) => { for (const [h, s] of sessions) if (s.expiresAt <= at) sessions.delete(h); for (const [h, t] of tickets) if (t.expiresAt <= at) tickets.delete(h); },
    saveTicket: (t) => { tickets.set(t.hash, t); },
    consumeTicket: (hash) => { const t = tickets.get(hash); if (t) tickets.delete(hash); return t; },
    saveCredential: (c) => credentials.set(c.sub, c),
    getCredential: (sub) => credentials.get(sub),
    saveDevice: (d) => devices.set(d.hash, d),
    getDevice: (hash) => devices.get(hash),
    deleteDevice: (hash) => devices.delete(hash),
    authLimit: (key, at, max, windowMs) => {
      for (const [k, l] of limits) if (l.until <= at) limits.delete(k);
      const l = limits.get(key) || { count: 0, until: at + windowMs };
      l.count++; limits.set(key, l); return l.count <= max;
    },
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
    CREATE TABLE IF NOT EXISTS account_credentials (sub TEXT PRIMARY KEY, recoveryHash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_devices (hash TEXT PRIMARY KEY, sub TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS social_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS friend_requests (fromUser TEXT NOT NULL, toUser TEXT NOT NULL, status TEXT NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY (fromUser, toUser));
    CREATE TABLE IF NOT EXISTS blocks (blocker TEXT NOT NULL, blocked TEXT NOT NULL, PRIMARY KEY (blocker, blocked));
    CREATE TABLE IF NOT EXISTS recent (user TEXT NOT NULL, peer TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user, peer));`);
  // One-time migration: preserve historical profiles/stats and graph under their
  // old IDs, but release plates and invalidate credentials from the retired provider.
  // Re-runnable statements make an interrupted migration safe to finish.
  if (![...sql.exec('SELECT version FROM social_migrations WHERE version = 1')].length) {
    sql.exec("UPDATE users SET username = NULL, displayName = 'ORPHANED DRIVER', avatarUrl = '' WHERE sub NOT IN (SELECT sub FROM account_credentials)");
    sql.exec('DELETE FROM sessions WHERE sub NOT IN (SELECT sub FROM account_credentials)');
    sql.exec('DELETE FROM tickets WHERE sub NOT IN (SELECT sub FROM account_credentials)');
    sql.exec('DROP TABLE IF EXISTS oauth_states');
    sql.exec('INSERT INTO social_migrations VALUES (1)');
  }
  const decodeUser = (row) => row && { sub: row.sub, username: row.username || '', displayName: row.displayName, avatarUrl: row.avatarUrl || '', createdAt: row.createdAt, stats: JSON.parse(row.data) };
  const encodeUser = (u) => [u.sub, u.username || null, u.displayName, u.avatarUrl || '', u.createdAt, JSON.stringify(u.stats)];
  // Decoded to { from, to, status, updatedAt } like the memory store, so
  // the service never sees SQL column names.
  const decodeRequest = (row) => row && { from: row.fromUser, to: row.toUser, status: row.status, updatedAt: row.updatedAt };
  return {
    getUserBySub: (sub) => decodeUser([...sql.exec('SELECT * FROM users WHERE sub = ?', sub)][0]),
    getUserByKey: (key) => decodeUser([...sql.exec('SELECT * FROM users WHERE username = ?', String(key || '').toUpperCase())][0]),
    saveUser: (u) => { sql.exec('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sub) DO UPDATE SET username=excluded.username, displayName=excluded.displayName, avatarUrl=excluded.avatarUrl, data=excluded.data', ...encodeUser(u)); },
    searchUsers: (prefix, limit = 20) => [...sql.exec('SELECT * FROM users WHERE username LIKE ? ORDER BY username LIMIT ?', String(prefix || '').toUpperCase() + '%', Math.max(1, Math.min(50, limit || 20)))].map(decodeUser).filter((u) => u.username),
    saveSession: (s) => { sql.exec('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?)', s.hash, s.sub, s.createdAt, s.expiresAt); },
    getSession: (hash) => [...sql.exec('SELECT * FROM sessions WHERE hash = ?', hash)][0],
    deleteSession: (hash) => { sql.exec('DELETE FROM sessions WHERE hash = ?', hash); },
    pruneSessions: (at = Date.now()) => { sql.exec('DELETE FROM sessions WHERE expiresAt <= ?', at); sql.exec('DELETE FROM tickets WHERE expiresAt <= ?', at); },
    saveTicket: (t) => { sql.exec('INSERT OR REPLACE INTO tickets VALUES (?, ?, ?)', t.hash, t.sub, t.expiresAt); },
    consumeTicket: (hash) => { const t = [...sql.exec('SELECT * FROM tickets WHERE hash = ?', hash)][0]; if (t) sql.exec('DELETE FROM tickets WHERE hash = ?', hash); return t; },
    saveCredential: (c) => { sql.exec('INSERT OR REPLACE INTO account_credentials VALUES (?, ?)', c.sub, c.recoveryHash); },
    getCredential: (sub) => [...sql.exec('SELECT * FROM account_credentials WHERE sub = ?', sub)][0],
    saveDevice: (d) => { sql.exec('INSERT INTO account_devices VALUES (?, ?)', d.hash, d.sub); },
    getDevice: (hash) => [...sql.exec('SELECT * FROM account_devices WHERE hash = ?', hash)][0],
    deleteDevice: (hash) => { sql.exec('DELETE FROM account_devices WHERE hash = ?', hash); },
    authLimit: (key, at, max, windowMs) => {
      sql.exec('DELETE FROM auth_limits WHERE until <= ?', at);
      sql.exec('INSERT INTO auth_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, at + windowMs);
      return [...sql.exec('SELECT count FROM auth_limits WHERE key = ?', key)][0].count <= max;
    },
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
