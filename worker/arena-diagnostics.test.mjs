import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '../.deploy/catalogue.json') return { url: 'data:text/javascript,export default {maps:[],cars:[]}', shortCircuit: true };
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
  return next(specifier, context);
} });
const { GameArena } = await import('./index.mjs');
const arena = () => Object.assign(Object.create(GameArena.prototype), { instanceId: 'instance-test', startedAt: 123, core: { clients: new Set(), lobbies: new Map(), track: {} } });
test('arena health identifies the live incarnation without exposing connection tokens', async () => {
  const a = arena(), response = await a.fetch(new Request('https://race.test/health')), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.instanceId, 'instance-test'); assert.equal(data.startedAt, 123);
  assert.equal(data.clients, 0); assert.equal(data.lobbies, 0); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!('sessions' in data)); assert.ok(!('tokens' in data));
});
test('message persistence and alarm failures retain their original exception and log their phase', async t => {
  const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const phase of ['message', 'alarm']) {
    const a = arena(), failure = new Error('simulated storage failure');
    a.core.clientData = () => ({ finish: null }); a.core.message = () => {}; a.core.tick = () => {};
    a.attach = () => {}; a.persist = async () => { throw failure; }; a.relay = () => assert.fail('must not relay after failed persistence');
    await assert.rejects(phase === 'message' ? a.webSocketMessage({}, '{"type":"loaded"}') : a.alarm(), error => error === failure);
    const [label, record] = logs.at(-1); assert.equal(label, 'Multiplayer arena event failed');
    assert.equal(record.instanceId, a.instanceId); assert.equal(record.phase, phase); assert.equal(record.message, failure.message);
    assert.match(record.stack, /simulated storage failure/);
  }
});

test('telemetry checkpoints the whole arena at most once per two seconds, while transitions persist immediately', async t => {
 let now=100000;t.mock.method(Date,'now',()=>now);const a=arena();let writes=0;
 a.core.clientData=()=>({finish:null,state:{s:20}});a.core.message=()=>{};a.attach=()=>{};a.relay=()=>{};
 a.persist=async()=>{writes++;a.persistedAt=Date.now();};
 for(let i=0;i<100;i++)await a.webSocketMessage({},'{"type":"state"}');assert.equal(writes,1);
 now+=1999;await a.webSocketMessage({},'{"type":"states"}');assert.equal(writes,1);
 now++;await a.webSocketMessage({},'{"type":"states"}');assert.equal(writes,2);
 now++;await a.webSocketMessage({},'{"type":"loaded"}');assert.equal(writes,3);
 now+=1000;await a.webSocketMessage({},'{"type":"ping"}');assert.equal(writes,3);
});
