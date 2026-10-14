import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from './core.mjs';
import { MULTIPLAYER_PROTOCOL, UPDATE_CLOSE_CODE, connectionProtocol } from '../src/multiplayer-protocol.js';
const options = { maps: new Map([['riviera', { track: { version: 'test' }, definitions: new Map([['quick', { id: 'quick', type: 'sprint', s0: 0, s1: 100, dir: 1, len: 100 }]]) }]]), cars: new Set(['mini']), leaderboard: { submit: async () => {} } };
const socket = () => ({ readyState: 1, messages: [], send(data) { this.messages.push(JSON.parse(data)); }, close(code, reason) { this.closed = { code, reason }; this.readyState = 3; } });
for (const protocol of [undefined, 0, MULTIPLAYER_PROTOCOL + 1, '1']) {
  test(`connection protocol ${String(protocol)} reloads before greeting or allocating a session`, () => {
    const core = createGameCore(options), ws = socket();
    assert.equal(core.connect(ws, 'test', { protocol }), false);
    assert.deepEqual(ws.messages, [{ type: 'reload', reason: 'update' }]);
    assert.equal(ws.closed.code, UPDATE_CLOSE_CODE);
    assert.equal(core.sessions.size, 0); assert.equal(core.clients.size, 0);
  });
}
test('matching protocol accepts different builds and persists its negotiation through DO restore', () => {
  let core = createGameCore(options); const ws = socket();
  core.connect(ws, 'test', { protocol: MULTIPLAYER_PROTOCOL, build: 'old-tab-build' });
  assert.equal(ws.messages[0].protocol, MULTIPLAYER_PROTOCOL);
  core.message(ws, JSON.stringify({ type: 'hello', protocol: MULTIPLAYER_PROTOCOL, build: 'different-build' }));
  assert.equal(core.clientData(ws).build, 'different-build'); assert.equal(ws.closed, undefined);
  const saved = JSON.parse(JSON.stringify(core.exportState()));
  core = createGameCore(options); core.restore(saved, new Map([[saved.sessions[0].token, ws]]));
  core.message(ws, JSON.stringify({ type: 'create' })); assert.equal(core.lobbies.size, 1);
});
for (const protocol of [undefined, MULTIPLAYER_PROTOCOL + 1]) {
  test(`hello protocol ${String(protocol)} cannot operate an already connected lobby`, () => {
    const core = createGameCore(options), ws = socket();
    core.connect(ws, 'test', { protocol: MULTIPLAYER_PROTOCOL });
    core.message(ws, JSON.stringify({ type: 'hello', protocol }));
    assert.deepEqual(ws.messages.at(-1), { type: 'reload', reason: 'update' });
    assert.equal(ws.closed.code, UPDATE_CLOSE_CODE); assert.equal(core.sessions.size, 0);
  });
}
test('old hibernated socket without a stored protocol reloads on restore before its next command', () => {
  let core = createGameCore(options); const ws = socket();
  core.connect(ws, 'test', { protocol: MULTIPLAYER_PROTOCOL });
  const saved = JSON.parse(JSON.stringify(core.exportState())); delete saved.sessions[0].protocol;
  core = createGameCore(options); core.restore(saved, new Map([[saved.sessions[0].token, ws]]));
  assert.equal(ws.closed.code, UPDATE_CLOSE_CODE);
  core.message(ws, JSON.stringify({ type: 'create' }));
  assert.deepEqual(ws.messages.at(-1), { type: 'reload', reason: 'update' });
  assert.equal(core.lobbies.size, 0); assert.equal(core.sessions.size, 0);
});
test('connection metadata treats absent/malformed protocol as zero and build as informational', () => {
  assert.deepEqual(connectionProtocol(new URL('http://game/ws')), { protocol: 0, build: null });
  assert.equal(connectionProtocol(new URL('http://game/ws?protocol=bad')).protocol, 0);
  assert.deepEqual(connectionProtocol(new URL('http://game/ws?protocol=1&build=another-release')), { protocol: 1, build: 'another-release' });
});
