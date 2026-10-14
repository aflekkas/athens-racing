// Live workerd/SQLite contract. Start wrangler on a private port and set
// ASR_TEST_BASE; ordinary npm test still runs the shared account/store tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';

const base = process.env.ASR_TEST_BASE;
test('Worker username accounts, cookies, device restore, recovery, limits, plates and friend presence', { skip: !base, timeout: 60000 }, async () => {
  const suffix = randomBytes(4).toString('hex').toUpperCase();
  const names = ['A-' + suffix, 'B-' + suffix];
  const ip = '2001:db8:' + suffix.slice(0, 4) + ':' + suffix.slice(4) + '::1';
  const call = async (path, data, cookie = '', source = ip, extra = {}) => {
    const res = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), 'CF-Connecting-IP': source, ...(cookie ? { Cookie: cookie } : {}), ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const body = await res.json();
    return { res, body, cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  assert.deepEqual((await call('/api/me')).body, { guest: true });
  const a = await call('/api/accounts/create', { username: names[0].toLowerCase() });
  assert.equal(a.res.status, 200); assert.equal(a.body.username, names[0]);
  assert.match(a.body.deviceSecret, /^[a-f0-9]{64}$/); assert.match(a.body.recoveryCode, /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  assert.match(a.res.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(a.res.headers.get('cache-control'), 'no-store');
  assert.equal(a.body.sub, undefined);
  assert.equal((await call('/api/accounts/create', { username: names[0] })).res.status, 409);
  const b = await call('/api/accounts/create', { username: names[1] }); assert.equal(b.res.status, 200);
  assert.equal((await call('/api/accounts/recover', { username: names[0], code: 'bad' })).res.status, 401);
  const recovered = await call('/api/accounts/recover', { username: names[0].toLowerCase(), code: a.body.recoveryCode });
  assert.equal(recovered.res.status, 200); assert.equal(recovered.body.username, names[0]);
  assert.notEqual(recovered.body.deviceSecret, a.body.deviceSecret);
  const next = await call('/api/accounts/recovery-code', {}, recovered.cookie);
  assert.equal(next.res.status, 200); assert.notEqual(next.body.recoveryCode, a.body.recoveryCode);
  assert.equal((await call('/api/accounts/recover', { username: names[0], code: a.body.recoveryCode })).res.status, 401);
  assert.equal((await call('/api/accounts/recover', { username: names[0], code: next.body.recoveryCode })).res.status, 200);
  assert.equal((await call('/api/accounts/recovery-code', {})).res.status, 401);
  const restored = await call('/api/accounts/device', { deviceSecret: a.body.deviceSecret });
  assert.equal(restored.res.status, 200); assert.equal((await call('/api/me', undefined, restored.cookie)).body.username, names[0]);
  assert.equal((await call('/auth/logout', undefined, restored.cookie)).res.status, 405);
  assert.equal((await call('/api/accounts/create', { username: 'SAFE' }, '', ip, { Origin: 'https://elsewhere.invalid' })).res.status, 403);
  assert.equal((await call('/auth/google/start')).res.status, 404);
  assert.equal((await call('/api/accounts/device', { deviceSecret: 'x'.repeat(1100) })).res.status, 413);
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/accounts/create', { username: '!' }, '', ip.replace('::1', '::2'))).res.status, 400);
  assert.equal((await call('/api/accounts/create', { username: '!' }, '', ip.replace('::1', '::2'))).res.status, 429);
  for (let i = 0; i < 10; i++) assert.equal((await call('/api/accounts/recover', { username: names[0], code: 'bad' }, '', ip.replace('::1', '::3'))).res.status, 401);
  assert.equal((await call('/api/accounts/recover', { username: names[0], code: next.body.recoveryCode }, '', ip.replace('::1', '::3'))).res.status, 429);
  console.log('PASS create, case collision, cookie, recover, regenerate, restore, request bounds, CSRF and IP limits');

  const sockets = [];
  const connect = async cookie => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws?protocol=' + MULTIPLAYER_PROTOCOL);
    const messages = []; ws.on('message', raw => messages.push(JSON.parse(String(raw))));
    sockets.push(ws);
    const wait = async predicate => {
      const end = Date.now() + 8000;
      while (Date.now() < end) { const found = messages.find(predicate); if (found) return found; await new Promise(resolve => setTimeout(resolve, 15)); }
      throw new Error('WebSocket message timeout: ' + JSON.stringify(messages));
    };
    await wait(m => m.type === 'hello');
    const ticket = await call('/api/auth/ticket', {}, cookie); assert.equal(ticket.res.status, 200);
    ws.send(JSON.stringify({ type: 'auth', ticket: ticket.body.ticket }));
    await wait(m => m.type === 'account');
    return { ws, messages, wait, send: data => ws.send(JSON.stringify(data)) };
  };
  try {
    const sa = await connect(recovered.cookie), sb = await connect(b.cookie);
    assert.equal((await call('/api/friends/request', { username: names[1] }, recovered.cookie)).res.status, 200);
    assert.equal((await call('/api/friends/accept', { username: names[0] }, b.cookie)).res.status, 200);
    const list = (await call('/api/friends', undefined, recovered.cookie)).body;
    assert.equal(list.friends[0].username, names[1]); assert.equal(list.friends[0].presence.online, true);
    sa.send({ type: 'create', name: 'Account QA', car: 'mini', private: false });
    const lobby = (await sa.wait(m => m.type === 'lobby')).lobby;
    assert.equal(lobby.players[0].plate, names[0]);
    sb.send({ type: 'join', code: lobby.code, name: 'Friend QA', car: 'mini' });
    const joined = (await sb.wait(m => m.type === 'lobby' && m.lobby.players.length === 2)).lobby;
    assert.equal(joined.players.find(p => p.name === 'Friend QA').plate, names[1]);
    await sa.wait(m => m.type === 'friends' && m.friends.some(f => f.username === names[1] && f.presence.activity === 'lobby'));
    const renamed = 'R-' + suffix;
    assert.equal((await call('/api/username', { username: renamed }, recovered.cookie)).res.status, 200);
    await sb.wait(m => m.type === 'lobby' && m.lobby.players.some(p => p.plate === renamed));
    const me = (await call('/api/me', undefined, recovered.cookie)).body;
    assert.equal(me.username, renamed); assert.equal(me.stats.started, 0);
    sb.send({ type: 'auth', logout: true });
    await sa.wait(m => m.type === 'friends' && m.friends.some(f => f.username === names[1] && !f.presence.online));
    for (const socket of [sa, sb]) socket.send({ type: 'leave' });
    console.log('PASS cookie-free WS tickets, two username plates, friends, live presence, rename propagation and stats profile');
  } finally { for (const ws of sockets) ws.close(); }
  const logout = await call('/auth/logout', { deviceSecret: a.body.deviceSecret }, restored.cookie);
  assert.equal(logout.res.status, 200);
  assert.equal((await call('/api/accounts/device', { deviceSecret: a.body.deviceSecret })).res.status, 401);
  assert.deepEqual((await call('/api/me', undefined, restored.cookie)).body, { guest: true });
});
