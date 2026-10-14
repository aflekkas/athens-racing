import test from 'node:test';
import assert from 'node:assert/strict';
import { socketAttachment } from '../worker/socket-attachment.mjs';
import { MULTIPLAYER_PROTOCOL } from '../src/multiplayer-protocol.js';
test('Worker attachment excludes large course/friends replicas, retains protocol, identity and physical state', () => {
  const data = { id: 'driver', token: 'session', protocol: MULTIPLAYER_PROTOCOL, build: 'build', lobbyCode: 'ABCDEF',
    state: { x: 1, y: 2, z: 3, s: 4, u: 0 }, course: { passed: 2, gates: Array.from({ length: 1000 }, (_, i) => ({ s: i * 80, x: i, z: i, halfWidth: 8 })) },
    friendsSent: 'large derived presence'.repeat(2000) };
  assert.ok(Buffer.byteLength(JSON.stringify(data)) > 16384);
  const attachment = socketAttachment(data);
  assert.ok(Buffer.byteLength(JSON.stringify(attachment)) < 1024);
  assert.equal(attachment.protocol, MULTIPLAYER_PROTOCOL); assert.equal(attachment.token, 'session');
  assert.deepEqual(attachment.state, data.state); assert.equal(attachment.lobbyCode, 'ABCDEF');
  assert.ok(!('course' in attachment)); assert.ok(!('friendsSent' in attachment));
  assert.equal(data.course.passed, 2, 'full arena data is retained without mutation');
});
