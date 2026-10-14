// Accounts (username identities, sessions, tickets, stats) + friends +
// social stores. Covers username validation/claim/collision/rename,
// sessions and single-use tickets (hashes only), MP result accounting
// (wins/podiums need a real field), solo bests, the friend lifecycle
// (request/auto-accept/accept/decline/remove/block/search/recent) and the
// memory + DO-SQLite stores behind one contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  sha256Hex, validUsername, normalizeUsername,
  createAccountService, favouriteCar, bestKey,
} from './accounts.mjs';
import { createFriendService } from './friends.mjs';
import { createMemorySocialStore, createSqlSocialStore } from './social-store.mjs';

const sqlShim = (db) => ({ exec(query, ...args) { if (query.includes(';')) { db.exec(query); return []; } const q = db.prepare(query); return q.columns().length ? q.all(...args) : (q.run(...args), []); } });
const stores = [
  ['memory', () => createMemorySocialStore()],
  ['sql', () => { const db = new DatabaseSync(':memory:'); return createSqlSocialStore(sqlShim(db)); }],
];

test('sha256 matches the FIPS vector and usernames validate case-insensitively', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(validUsername('abc-123')); assert.ok(validUsername('  z4-racer  '));
  assert.equal(normalizeUsername('z4-racer'), 'Z4-RACER');
  for (const bad of ['ab', 'a'.repeat(17), 'has space', 'under_score', '', null]) assert.equal(validUsername(bad), false);
});

for (const [name, makeStore] of stores) {
  test(`[${name}] create, collide, filter, recover, rotate and rename`, () => {
    const store = makeStore(), svc = createAccountService(store, { now: () => 1000 });
    const first = svc.createAccount('speed-queen');
    assert.equal(first.user.username, 'SPEED-QUEEN');
    assert.match(first.deviceSecret, /^[a-f0-9]{64}$/);
    assert.equal(svc.signInDevice(first.deviceSecret).sub, first.sub);
    assert.throws(() => svc.createAccount('Speed-Queen'), /taken/);
    for (const bad of ['no', 'ADMIN', 'admin-racer', 'SH1T', 'N-A-Z-I']) assert.throws(() => svc.createAccount(bad));
    assert.throws(() => svc.recover('SPEED-QUEEN', 'bad'), /incorrect/);
    const recovered = svc.recover('speed-queen', first.recoveryCode.toLowerCase());
    assert.equal(recovered.sub, first.sub);
    assert.notEqual(recovered.deviceSecret, first.deviceSecret);
    const next = svc.regenerateRecovery(first.sub);
    assert.throws(() => svc.recover('SPEED-QUEEN', first.recoveryCode), /incorrect/);
    assert.equal(svc.recover('speed-queen', next.recoveryCode).sub, first.sub);
    assert.equal(svc.signInDevice(first.deviceSecret).sub, first.sub);
    svc.setUsername(first.sub, 'queen-v2');
    assert.equal(svc.get(first.sub).username, 'QUEEN-V2');
    assert.throws(() => svc.recover('SPEED-QUEEN', next.recoveryCode), /incorrect/);
    assert.equal(svc.recover('queen-v2', next.recoveryCode).sub, first.sub);
    svc.revokeDevice(first.deviceSecret);
    assert.throws(() => svc.signInDevice(first.deviceSecret), /expired/);
    assert.equal(svc.createAccount('speed-queen').user.username, 'SPEED-QUEEN');
    assert.throws(() => svc.setUsername('missing', 'fresh-name'), /Sign in/);
    const credential = store.getCredential(first.sub);
    assert.notEqual(credential.recoveryHash, next.recoveryCode);
    assert.equal(store.getDevice(first.deviceSecret), undefined);
  });

  test(`[${name}] persistent rate windows count failed attempts and expire`, () => {
    const store = makeStore();
    for (let i = 0; i < 5; i++) assert.ok(store.authLimit('create:ip', 1000, 5, 3600000));
    assert.equal(store.authLimit('create:ip', 1001, 5, 3600000), false);
    assert.ok(store.authLimit('create:other-ip', 1001, 5, 3600000));
    assert.ok(store.authLimit('create:ip', 3601000, 5, 3600000));
  });

  test(`[${name}] sessions verify/revoke/expire; tickets are single-use`, () => {
    let at = 1000;
    const svc = createAccountService(makeStore(), { now: () => at });
    const { sub } = svc.createAccount('seven');
    const { id } = svc.createSession(sub);
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(svc.verifySession(id).sub, sub);
    assert.equal(svc.verifySession('bogus'), null);
    const { ticket } = svc.createTicket(sub);
    assert.equal(svc.verifyTicket(ticket).sub, sub);
    assert.equal(svc.verifyTicket(ticket), null, 'consumed tickets never verify twice');
    at += 61 * 1000;
    const { ticket: fresh } = svc.createTicket(sub);
    at += 61 * 1000;
    assert.equal(svc.verifyTicket(fresh), null, 'expired tickets are rejected');
    assert.ok(svc.revokeSession(id) && svc.verifySession(id) === null);
    assert.equal(svc.revokeSession(id), false);
  });

  test(`[${name}] multiplayer results need a field for wins/podiums`, () => {
    const svc = createAccountService(makeStore(), { now: () => 1000 });
    const subs = ['r-s1', 'r-s2', 'r-s3'].map(name => svc.createAccount(name).sub);
    const event = { mapId: 'riviera', eventId: 'quick', traffic: false, km: 1.5 };
    svc.recordMpResults([
      { sub: subs[0], car: 'mini', finish: 90, placement: 1 },
      { sub: subs[1], car: 'z4', finish: 95, placement: 2 },
      { sub: subs[2], car: 'mini', finish: null, placement: null },
    ], event);
    const p1 = svc.get(subs[0]).stats, p2 = svc.get(subs[1]).stats, p3 = svc.get(subs[2]).stats;
    assert.deepEqual([p1.started, p1.finished, p1.wins, p1.podiums, p1.dnfs, p1.km], [1, 1, 1, 1, 0, 1.5]);
    assert.equal(p1.best[bestKey('riviera', 'quick', 'mini', false)], 90);
    assert.equal(p1.favouriteCar, 'mini');
    assert.deepEqual([p2.wins, p2.podiums], [0, 1]);
    assert.deepEqual([p3.dnfs, p3.finished], [1, 0]);
    svc.recordMpResults([{ sub: subs[0], car: 'mini', finish: 80, placement: 1 }, { sub: subs[1], car: 'z4', finish: 85, placement: 2 }], { ...event, km: 2 });
    const p1b = svc.get(subs[0]).stats;
    assert.equal(p1b.wins, 2); assert.equal(p1b.podiums, 1, 'a two-driver 1-2 is a win, not a podium');
    assert.equal(p1b.best[bestKey('riviera', 'quick', 'mini', false)], 80);
    svc.recordMpResults([{ sub: 'ghost', car: 'mini', finish: 1, placement: 1 }], event);
  });

  test(`[${name}] solo submissions update bests/km/affinity, never counters`, () => {
    const svc = createAccountService(makeStore(), { now: () => 1000 });
    const { sub } = svc.createAccount('solo');
    assert.ok(svc.recordSolo({ sub, car: 'carrera', mapId: 'riviera', eventId: 'quick', traffic: false, time: 100, km: 1.5 }));
    assert.ok(!svc.recordSolo({ sub: 'nobody', car: 'mini', mapId: 'riviera', eventId: 'quick', traffic: false, time: 1, km: 1 }));
    const s = svc.get(sub).stats;
    assert.deepEqual([s.started, s.finished, s.wins, s.dnfs], [0, 0, 0, 0]);
    assert.equal(s.km, 1.5); assert.equal(s.favouriteCar, 'carrera');
    svc.recordSolo({ sub, car: 'carrera', mapId: 'riviera', eventId: 'quick', traffic: false, time: 120, km: 1.5 });
    assert.equal(svc.get(sub).stats.best[bestKey('riviera', 'quick', 'carrera', false)], 100);
    assert.equal(favouriteCar({ cars: {} }), null);
  });

  test(`[${name}] friend lifecycle: request/accept/decline/remove/block/search`, () => {
    const store = makeStore();
    const svc = createAccountService(store, { now: () => 1000 });
    const fr = createFriendService(store, { now: () => 1000 });
    const subs = ['alpha', 'alpine', 'bravo', 'noname'].map(name => svc.createAccount(name).sub);
    const unnamed = store.getUserBySub(subs[3]); unnamed.username = ''; store.saveUser(unnamed);
    assert.throws(() => fr.request(subs[0], 'alpha'), /yourself/);
    assert.throws(() => fr.request(subs[3], 'alpha'), /username/);
    assert.throws(() => fr.request(subs[0], 'nobody'), /Unknown driver/);
    const req = fr.request(subs[0], 'alpine');
    assert.ok(req.requested && req.affected.includes(subs[1]));
    assert.throws(() => fr.request(subs[0], 'alpine'), /already sent/);
    assert.deepEqual(fr.list(subs[1]).incoming.map((u) => u.username), ['ALPHA']);
    // Reverse request auto-accepts instead of duplicating.
    assert.ok(fr.request(subs[1], 'alpha').accepted);
    assert.deepEqual(fr.list(subs[0]).friends.map((u) => u.username), ['ALPINE']);
    assert.throws(() => fr.request(subs[0], 'alpine'), /Already friends/);
    // Search sees the relation and skips blocked users.
    assert.equal(fr.search(subs[0], 'alp')[0].relation, 'friend');
    fr.block(subs[0], 'bravo');
    assert.deepEqual(fr.search(subs[0], 'br'), []);
    assert.throws(() => fr.request(subs[2], 'alpha'), /unavailable/);
    fr.unblock(subs[0], 'bravo');
    assert.equal(fr.search(subs[0], 'br')[0].relation, 'none');
    fr.request(subs[2], 'alpha'); fr.decline(subs[0], 'bravo');
    assert.deepEqual(fr.list(subs[0]).incoming, []);
    assert.throws(() => fr.decline(subs[0], 'bravo'), /No pending/);
    fr.remove(subs[0], 'alpine');
    assert.deepEqual(fr.list(subs[0]).friends, []);
    assert.throws(() => fr.remove(subs[0], 'alpine'), /Not friends/);
  });

  test(`[${name}] recent players come from shared races, excluding friends`, () => {
    const store = makeStore();
    const svc = createAccountService(store, { now: () => 1000 });
    const fr = createFriendService(store, { now: () => 1000 });
    const subs = ['racer1', 'racer2', 'racer3'].map(name => svc.createAccount(name).sub);
    fr.recordMatch([subs[0], subs[1], subs[2]], 5000);
    fr.recordMatch([subs[0], subs[1]], 6000);
    assert.deepEqual(fr.recent(subs[0]).map((u) => u.username), ['RACER2', 'RACER3']);
    fr.request(subs[0], 'racer2'); fr.accept(subs[1], 'racer1');
    assert.deepEqual(fr.recent(subs[0]).map((u) => u.username), ['RACER3']);
  });
}

test('SQL migration orphans legacy accounts, releases plates, revokes sessions and is repeatable', () => {
  const db = new DatabaseSync(':memory:'), sql = sqlShim(db);
  db.exec(`CREATE TABLE users (sub TEXT PRIMARY KEY, username TEXT UNIQUE, displayName TEXT NOT NULL, avatarUrl TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE sessions (hash TEXT PRIMARY KEY, sub TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE tickets (hash TEXT PRIMARY KEY, sub TEXT NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE oauth_states (state TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run('legacy', 'QUEEN', 'Old Driver', '', 1, JSON.stringify({ started: 7, cars: {}, best: {} }));
  db.prepare('INSERT INTO sessions VALUES (?, ?, 1, 9999999999999)').run(sha256Hex('session-v1:old'), 'legacy');
  db.prepare('INSERT INTO tickets VALUES (?, ?, 9999999999999)').run(sha256Hex('ticket-v1:old'), 'legacy');
  const store = createSqlSocialStore(sql), svc = createAccountService(store);
  assert.equal(store.getUserBySub('legacy').stats.started, 7);
  assert.equal(store.getUserBySub('legacy').username, '');
  assert.equal(svc.verifySession('old'), null); assert.equal(svc.verifyTicket('old'), null);
  assert.equal(svc.get('legacy'), null); assert.deepEqual(store.searchUsers('QUE'), []);
  assert.throws(() => svc.createSession('legacy'), /Sign in/);
  const fresh = svc.createAccount('queen');
  assert.equal(fresh.user.stats.started, 0);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='oauth_states'").get(), undefined);
  const restarted = createAccountService(createSqlSocialStore(sql));
  assert.equal(restarted.signInDevice(fresh.deviceSecret).sub, fresh.sub);
});
