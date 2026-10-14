// Accounts (Google identities, sessions, tickets, stats) + friends +
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
  test(`[${name}] google sign-in, username claim/collision/rename`, () => {
    const svc = createAccountService(makeStore(), { now: () => 1000 });
    const first = svc.upsertGoogleUser({ sub: 'google-1', displayName: 'Speed <Queen>', avatarUrl: 'https://img/x.png' });
    assert.equal(first.username, ''); assert.equal(first.displayName, 'Speed Queen');
    assert.deepEqual(svc.setUsername('google-1', 'speed-queen'), { ...first, username: 'SPEED-QUEEN' });
    // Re-sign-in refreshes the profile but never overwrites the username.
    assert.equal(svc.upsertGoogleUser({ sub: 'google-1', displayName: 'Other' }).username, 'SPEED-QUEEN');
    svc.upsertGoogleUser({ sub: 'google-2', displayName: 'Rival' });
    assert.throws(() => svc.setUsername('google-2', 'Speed-Queen'), /taken/);
    assert.throws(() => svc.setUsername('google-2', 'no'), /3-16/);
    assert.throws(() => svc.setUsername('google-9', 'fresh-name'), /Sign in/);
    // Rename works and frees the old name; the graph keys on sub.
    svc.setUsername('google-1', 'queen-v2');
    assert.equal(svc.get('google-1').username, 'QUEEN-V2');
    assert.equal(svc.setUsername('google-2', 'speed-queen').username, 'SPEED-QUEEN');
  });

  test(`[${name}] sessions verify/revoke/expire; tickets are single-use`, () => {
    let at = 1000;
    const svc = createAccountService(makeStore(), { now: () => at });
    svc.upsertGoogleUser({ sub: 'google-7', displayName: 'Seven' });
    const { id } = svc.createSession('google-7');
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(svc.verifySession(id).sub, 'google-7');
    assert.equal(svc.verifySession('bogus'), null);
    const { ticket } = svc.createTicket('google-7');
    assert.equal(svc.verifyTicket(ticket).sub, 'google-7');
    assert.equal(svc.verifyTicket(ticket), null, 'consumed tickets never verify twice');
    at += 61 * 1000;
    const { ticket: fresh } = svc.createTicket('google-7');
    at += 61 * 1000;
    assert.equal(svc.verifyTicket(fresh), null, 'expired tickets are rejected');
    assert.ok(svc.revokeSession(id) && svc.verifySession(id) === null);
    assert.equal(svc.revokeSession(id), false);
  });

  test(`[${name}] multiplayer results need a field for wins/podiums`, () => {
    const svc = createAccountService(makeStore(), { now: () => 1000 });
    for (const sub of ['s1', 's2', 's3']) { svc.upsertGoogleUser({ sub, displayName: sub }); svc.setUsername(sub, 'r-' + sub); }
    const event = { mapId: 'riviera', eventId: 'quick', traffic: false, km: 1.5 };
    svc.recordMpResults([
      { sub: 's1', car: 'mini', finish: 90, placement: 1 },
      { sub: 's2', car: 'z4', finish: 95, placement: 2 },
      { sub: 's3', car: 'mini', finish: null, placement: null },
    ], event);
    const p1 = svc.get('s1').stats, p2 = svc.get('s2').stats, p3 = svc.get('s3').stats;
    assert.deepEqual([p1.started, p1.finished, p1.wins, p1.podiums, p1.dnfs, p1.km], [1, 1, 1, 1, 0, 1.5]);
    assert.equal(p1.best[bestKey('riviera', 'quick', 'mini', false)], 90);
    assert.equal(p1.favouriteCar, 'mini');
    assert.deepEqual([p2.wins, p2.podiums], [0, 1]);
    assert.deepEqual([p3.dnfs, p3.finished], [1, 0]);
    svc.recordMpResults([{ sub: 's1', car: 'mini', finish: 80, placement: 1 }, { sub: 's2', car: 'z4', finish: 85, placement: 2 }], { ...event, km: 2 });
    const p1b = svc.get('s1').stats;
    assert.equal(p1b.wins, 2); assert.equal(p1b.podiums, 1, 'a two-driver 1-2 is a win, not a podium');
    assert.equal(p1b.best[bestKey('riviera', 'quick', 'mini', false)], 80);
    svc.recordMpResults([{ sub: 'ghost', car: 'mini', finish: 1, placement: 1 }], event);
  });

  test(`[${name}] solo submissions update bests/km/affinity, never counters`, () => {
    const svc = createAccountService(makeStore(), { now: () => 1000 });
    svc.upsertGoogleUser({ sub: 'solo', displayName: 'Solo' });
    assert.ok(svc.recordSolo({ sub: 'solo', car: 'carrera', mapId: 'riviera', eventId: 'quick', traffic: false, time: 100, km: 1.5 }));
    assert.ok(!svc.recordSolo({ sub: 'nobody', car: 'mini', mapId: 'riviera', eventId: 'quick', traffic: false, time: 1, km: 1 }));
    const s = svc.get('solo').stats;
    assert.deepEqual([s.started, s.finished, s.wins, s.dnfs], [0, 0, 0, 0]);
    assert.equal(s.km, 1.5); assert.equal(s.favouriteCar, 'carrera');
    svc.recordSolo({ sub: 'solo', car: 'carrera', mapId: 'riviera', eventId: 'quick', traffic: false, time: 120, km: 1.5 });
    assert.equal(svc.get('solo').stats.best[bestKey('riviera', 'quick', 'carrera', false)], 100);
    assert.equal(favouriteCar({ cars: {} }), null);
  });

  test(`[${name}] friend lifecycle: request/accept/decline/remove/block/search`, () => {
    const store = makeStore();
    const svc = createAccountService(store, { now: () => 1000 });
    const fr = createFriendService(store, { now: () => 1000 });
    for (const [sub, name] of [['f1', 'alpha'], ['f2', 'alpine'], ['f3', 'bravo']]) { svc.upsertGoogleUser({ sub, displayName: name }); svc.setUsername(sub, name); }
    svc.upsertGoogleUser({ sub: 'f4', displayName: 'NoName' });
    assert.throws(() => fr.request('f1', 'alpha'), /yourself/);
    assert.throws(() => fr.request('f4', 'alpha'), /username/);
    assert.throws(() => fr.request('f1', 'nobody'), /Unknown driver/);
    const req = fr.request('f1', 'alpine');
    assert.ok(req.requested && req.affected.includes('f2'));
    assert.throws(() => fr.request('f1', 'alpine'), /already sent/);
    assert.deepEqual(fr.list('f2').incoming.map((u) => u.username), ['ALPHA']);
    // Reverse request auto-accepts instead of duplicating.
    assert.ok(fr.request('f2', 'alpha').accepted);
    assert.deepEqual(fr.list('f1').friends.map((u) => u.username), ['ALPINE']);
    assert.throws(() => fr.request('f1', 'alpine'), /Already friends/);
    // Search sees the relation and skips blocked users.
    assert.equal(fr.search('f1', 'alp')[0].relation, 'friend');
    fr.block('f1', 'bravo');
    assert.deepEqual(fr.search('f1', 'br'), []);
    assert.throws(() => fr.request('f3', 'alpha'), /unavailable/);
    fr.unblock('f1', 'bravo');
    assert.equal(fr.search('f1', 'br')[0].relation, 'none');
    fr.request('f3', 'alpha'); fr.decline('f1', 'bravo');
    assert.deepEqual(fr.list('f1').incoming, []);
    assert.throws(() => fr.decline('f1', 'bravo'), /No pending/);
    fr.remove('f1', 'alpine');
    assert.deepEqual(fr.list('f1').friends, []);
    assert.throws(() => fr.remove('f1', 'alpine'), /Not friends/);
  });

  test(`[${name}] recent players come from shared races, excluding friends`, () => {
    const store = makeStore();
    const svc = createAccountService(store, { now: () => 1000 });
    const fr = createFriendService(store, { now: () => 1000 });
    for (const [sub, name] of [['r1', 'racer1'], ['r2', 'racer2'], ['r3', 'racer3']]) { svc.upsertGoogleUser({ sub, displayName: name }); svc.setUsername(sub, name); }
    fr.recordMatch(['r1', 'r2', 'r3'], 5000);
    fr.recordMatch(['r1', 'r2'], 6000);
    assert.deepEqual(fr.recent('r1').map((u) => u.username), ['RACER2', 'RACER3']);
    fr.request('r1', 'racer2'); fr.accept('r2', 'racer1');
    assert.deepEqual(fr.recent('r1').map((u) => u.username), ['RACER3']);
  });
}
