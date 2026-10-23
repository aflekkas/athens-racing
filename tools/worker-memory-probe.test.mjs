import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { heapSample, summarizeHeap, loopbackURL, sampleWorker, selectInspector } from './worker-memory-probe.mjs';
const identity = { routeHash: 'a'.repeat(64), worldRevision: 'b'.repeat(64), geometryHash: 'c'.repeat(64) };
const counters = { usedSize: 1024, totalSize: 4096, embedderHeapUsedSize: 512, backingStorageSize: 2048 };
async function fakeInspector(t, { workerGlobal = true, raw = counters, targets = 1, matchingSource = true } = {}) {
  const methods = [], server = http.createServer(), sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => sockets.handleUpgrade(request, socket, head, peer => sockets.emit('connection', peer)));
  sockets.on('connection', peer => peer.on('message', bytes => {
    const packet = JSON.parse(bytes); methods.push(packet.method);
    if (packet.method === 'Debugger.enable') peer.send(JSON.stringify({ method: 'Debugger.scriptParsed', params: { scriptId: '1', url: 'UNIT ONLY' } }));
    const result = packet.method === 'Debugger.getScriptSource' ? { scriptSource: matchingSource ? JSON.stringify(identity) : 'unrelated worker catalogue' } : packet.method === 'Runtime.getHeapUsage' ? raw : packet.method === 'Runtime.evaluate' ? { result: { type: 'object', value: { workerGlobal, userAgent: 'UNIT PROTOCOL FIXTURE; NOT WORKER EVIDENCE' } } } : {};
    peer.send(JSON.stringify({ id: packet.id, result }));
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  server.on('request', (request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(Array.from({ length: targets }, (_, i) => ({ id: `target-${i}`, title: 'UNIT ONLY', webSocketDebuggerUrl: base.replace('http:', 'ws:') + '/inspect' })))); });
  t.after(async () => { for (const peer of sockets.clients) peer.close(); await new Promise(resolve => sockets.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  return { base, methods };
}
test('inspector observations count distinct heap/backing/embedder fields without claiming production enforcement', () => {
  const sample = heapSample(counters, 20); assert.equal(sample.accountedUsedBytes, 3584); assert.equal(sample.accountedCommittedBytes, 6656);
  const summary = summarizeHeap([sample, heapSample({ ...counters, backingStorageSize: 4096 }, 40)]);
  assert.equal(summary.peaks.backingStorageSize, 4096); assert.equal(summary.peaks.accountedUsedBytes, 5632); assert.equal(summary.productionLimitEnforced, false);
  assert.match(summary.conclusion, /unsampled transients/);
  assert.throws(() => heapSample({ ...counters, usedSize: 5000 }, 0), /Invalid/); assert.throws(() => summarizeHeap([]), /No Worker/);
});
test('unsupported allocation counters stay absent and cannot acquire an invented complete total', () => {
  const incomplete = heapSample({ usedSize: 10, totalSize: 20 }, 0), summary = summarizeHeap([heapSample(counters, 0), incomplete]);
  assert.deepEqual(incomplete.missing, ['embedderHeapUsedSize', 'backingStorageSize']); assert.equal(incomplete.accountedUsedBytes, null);
  assert.equal(summary.peaks.accountedUsedBytes, null); assert.equal(summary.peaks.backingStorageSize, null); assert.equal(summary.productionLimitEnforced, false);
});
test('inspector selection is loopback-only and requires an unambiguous exact target', async t => {
  for (const value of ['https://example.com:9242', 'http://127.0.0.1.evil.test:9242', 'http://user:password@localhost:9242']) assert.throws(() => loopbackURL(value), /loopback/);
  const { base } = await fakeInspector(t, { targets: 2 }); await assert.rejects(selectInspector(base), /exact --target/);
  assert.equal((await selectInspector(base, 'target-1')).id, 'target-1');
});
test('protocol sampler rejects a Node inspector before reading any heap measurements', async t => {
  const { base, methods } = await fakeInspector(t, { workerGlobal: false });
  await assert.rejects(sampleWorker({ inspector: base, identity, seconds: 1 }), /refusing Node-process/);
  assert.deepEqual(methods, ['Runtime.enable', 'Runtime.evaluate']);
});
test('CDP sampling preserves optional-counter gaps and the real response identifiers', async t => {
  const { base, methods } = await fakeInspector(t, { raw: { usedSize: 100, totalSize: 200, backingStorageSize: 50 } });
  const proof = await sampleWorker({ inspector: base, identity, seconds: 1, intervalMs: 50 });
  assert.ok(proof.samples >= 5); assert.equal(proof.peaks.usedSize, 100); assert.equal(proof.peaks.accountedUsedBytes, null);
  assert.deepEqual(proof.missingFields, ['embedderHeapUsedSize']); assert.equal(proof.productionLimitEnforced, false);
  assert.equal(methods.filter(m => m === 'Runtime.getHeapUsage').length, proof.samples);
});

test('a genuine Worker global with another catalogue cannot supply fixture memory evidence',async t=>{
 const {base,methods}=await fakeInspector(t,{matchingSource:false});await assert.rejects(sampleWorker({inspector:base,identity,seconds:1}),/pinned fixture catalogue/);
 assert.equal(methods.includes('Runtime.getHeapUsage'),false);assert.ok(methods.includes('Debugger.disable'));
});
