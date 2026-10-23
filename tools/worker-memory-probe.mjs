// Observe a real LOCAL workerd isolate during independently recorded gameplay /
// recovery exercises. This is not a production memory-limit enforcement test.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { canonicalJSON, sha256 } from '../src/route-definition.js';
import { routeGeometryHash } from '../src/route-compile.js';
import { validateOnlineGrid } from '../src/online-grid.js';
import { validateRecoveryManifest } from '../server/route-road-stream.mjs';
export const MEMORY_FIELDS = Object.freeze(['usedSize', 'totalSize', 'embedderHeapUsedSize', 'backingStorageSize']);
export function loopbackURL(value, protocols = ['http:', 'https:']) {
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw Error('Inspector and fixture endpoints must be explicit loopback URLs');
  return url;
}
export function heapSample(raw, elapsedMs) {
  const missing = [], values = {};
  for (const key of MEMORY_FIELDS) {
    if (!Number.isFinite(raw?.[key]) || raw[key] < 0) { missing.push(key); values[key] = null; }
    else values[key] = raw[key];
  }
  if (values.usedSize === null || values.totalSize === null || values.usedSize > values.totalSize) throw Error('Invalid inspector heap counters');
  const complete = missing.length === 0;
  return { elapsedMs, ...values, missing, accountedUsedBytes: complete ? values.usedSize + values.embedderHeapUsedSize + values.backingStorageSize : null, accountedCommittedBytes: complete ? values.totalSize + values.embedderHeapUsedSize + values.backingStorageSize : null };
}
export function summarizeHeap(samples) {
  if (!samples.length) throw Error('No Worker memory samples');
  const peaks = Object.fromEntries([...MEMORY_FIELDS, 'accountedUsedBytes', 'accountedCommittedBytes'].map(key => [key, samples.every(s => s[key] !== null) ? samples.reduce((peak, sample) => Math.max(peak, sample[key]), 0) : null]));
  return { samples: samples.length, missingFields: [...new Set(samples.flatMap(s => s.missing))], peaks,
    productionLimitEnforced: false, conclusion: 'Observed isolate samples only; unsampled transients, unsupported native allocations and production enforcement are outside this measurement.' };
}
export async function inspectorClient(url, { timeoutMs = 10000 } = {}) {
  loopbackURL(url, ['ws:', 'wss:']);
  const socket = new WebSocket(url, { maxPayload: 24 * 1024 * 1024 }), pending = new Map(), listeners = new Set(); let nextId = 0;
  const rejectPending = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  socket.on('message', bytes => {
    let packet; try { packet = JSON.parse(bytes); } catch { rejectPending(Error('Malformed inspector response')); socket.close(); return; }
    if (packet.method) { for (const listener of listeners) listener(packet); return; }
    const item = pending.get(packet.id); if (!item) return; pending.delete(packet.id); clearTimeout(item.timer);
    if (packet.error) item.reject(Error(`Inspector ${item.method}: ${packet.error.message || JSON.stringify(packet.error)}`)); else item.resolve(packet.result);
  });
  socket.on('error', rejectPending); socket.on('close', () => rejectPending(Error('Inspector disconnected')));
  await new Promise((yes, no) => { const timer = setTimeout(() => { socket.terminate(); no(Error('Inspector connection timed out')); }, timeoutMs); socket.once('open', () => { clearTimeout(timer); yes(); }); socket.once('error', error => { clearTimeout(timer); no(error); }); });
  return { onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); }, async call(method, params = {}) {
    if (socket.readyState !== WebSocket.OPEN) throw Error('Inspector is not open');
    const id = ++nextId;
    return new Promise((yes, no) => {
      const timer = setTimeout(() => { pending.delete(id); no(Error(`Inspector ${method} timed out`)); }, timeoutMs);
      pending.set(id, { resolve: yes, reject: no, timer, method }); socket.send(JSON.stringify({ id, method, params }));
    });
  }, close() { socket.close(); rejectPending(Error('Inspector sampling finished')); } };
}
export async function selectInspector(inspector, targetId) {
  const base = loopbackURL(inspector), response = await fetch(new URL('/json/list', base), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Inspector target list returned ${response.status}`);
  const targets = await response.json(); if (!Array.isArray(targets)) throw Error('Invalid inspector target list');
  const possible = targets.filter(t => t.webSocketDebuggerUrl && (!targetId || t.id === targetId));
  if (possible.length !== 1) throw Error(`Choose an exact --target from: ${targets.map(t => `${t.id} (${t.title})`).join(', ')}`);
  loopbackURL(possible[0].webSocketDebuggerUrl, ['ws:', 'wss:']);
  return possible[0];
}
export async function fixtureIdentity({ worldFile, compiledFile, catalogueFile, worldRevision, routeHash }) {
  const [world, compiled, catalogue] = await Promise.all([worldFile, compiledFile, catalogueFile].map(async path => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)))));
  if (world.developmentOnly !== true || world.fixture?.publish !== false || world.fixture?.kind !== 'local-online-parity') throw Error('Only explicitly unpublished local parity fixtures are supported');
  if (!/^[a-f0-9]{64}$/.test(worldRevision || '') || !/^[a-f0-9]{64}$/.test(routeHash || '') || world.revision !== worldRevision || compiled.worldSetRevision !== worldRevision || compiled.routeHash !== routeHash) throw Error('Fixture identity differs from pinned world/route hashes');
  if (await routeGeometryHash(compiled) !== compiled.geometryHash || await sha256({ definition: compiled.definition, geometryHash: compiled.geometryHash, worldSetRevision: worldRevision }) !== routeHash) throw Error('Compiled fixture content differs from its immutable hashes');
  const entry = catalogue.routeConfig?.routes?.find(e => e.id === compiled.id);
  if (catalogue.routeConfig.online !== true || !entry || ['routeHash', 'geometryHash', 'worldSetRevision'].some(k => entry[k] !== compiled[k])) throw Error('Fixture catalogue is not bound to the pinned route');
  const sources = Object.entries(world.tiles).map(([key, tile]) => [key, tile.sha256]).sort(([a], [b]) => a.localeCompare(b));
  const actual = [...(catalogue.recoveryWorld?.sourceHashes || [])].sort(([a], [b]) => a.localeCompare(b));
  if (catalogue.recoveryWorld?.worldSetRevision !== worldRevision || canonicalJSON(sources) !== canonicalJSON(actual)) throw Error('Fixture catalogue omits or changes world cells');
  const recovery = catalogue.routeRoads?.find(r => r.hash === entry.recovery?.hash), grid = catalogue.routeGrids?.find(g => g.hash === entry.onlineGrid?.hash);
  if (!recovery || !grid || entry.recovery.streamed !== true) throw Error('Fixture recovery/grid artifacts unavailable');
  await validateRecoveryManifest(recovery.body, { expectedHash: recovery.hash, worldSetRevision: worldRevision, sourceHashes: sources });
  await validateOnlineGrid(grid.body, compiled, { expectedHash: grid.hash });
  return { worldRevision, routeId: compiled.id, routeHash, geometryHash: compiled.geometryHash, worldCells: sources.length, gridHash: grid.hash, recoveryHash: recovery.hash, catalogueHash: await sha256(catalogue), scope: world.fixture.scope, sidecarAdmission: 'Must be supplied by the separate exact artifact audit; not inferred from this sampler.' };
}
export async function verifyFixtureEndpoint(base, fixture) {
  const url = loopbackURL(base), response = await fetch(new URL('/api/routes', url), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Fixture route API returned ${response.status}`);
  const body = await response.json(), entry = body.routes?.find(e => e.id === fixture.routeId);
  if (body.onlineAvailable !== true || !entry || entry.routeHash !== fixture.routeHash || entry.geometryHash !== fixture.geometryHash || entry.worldSetRevision !== fixture.worldRevision || entry.onlineGrid?.hash !== fixture.gridHash || entry.recovery?.hash !== fixture.recoveryHash) throw Error('Running Worker route API differs from the pinned fixture');
}
export async function bindWorkerSource(client, identity) {
  if (!identity || !['routeHash', 'worldRevision', 'geometryHash'].every(key => /^[a-f0-9]{64}$/.test(identity[key] || ''))) throw Error('Pinned inspector fixture identity required');
  const scripts = [], unsubscribe = client.onEvent(packet => { if (packet.method === 'Debugger.scriptParsed' && scripts.length < 256) scripts.push(packet.params); });
  try {
    await client.call('Debugger.enable');
    for (const script of scripts) {
      const { scriptSource } = await client.call('Debugger.getScriptSource', { scriptId: script.scriptId });
      if (typeof scriptSource !== 'string' || scriptSource.length > 16 * 1024 * 1024) continue;
      if (['routeHash', 'worldRevision', 'geometryHash'].every(key => scriptSource.includes(identity[key]))) return { scriptId: script.scriptId, url: script.url, sourceHash: await sha256(scriptSource), containsPinnedFixtureHashes: true };
    }
    throw Error('Inspector Worker source does not contain the pinned fixture catalogue identity');
  } finally { unsubscribe(); await client.call('Debugger.disable'); }
}
export async function sampleWorker({ inspector, targetId, identity, seconds = 60, intervalMs = 50, onSample = () => {} }) {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600 || !Number.isFinite(intervalMs) || intervalMs < 20 || intervalMs > 1000) throw Error('Sampling duration/interval out of bounds');
  const target = await selectInspector(inspector, targetId), client = await inspectorClient(target.webSocketDebuggerUrl), samples = [];
  try {
    await client.call('Runtime.enable');
    const evaluated = await client.call('Runtime.evaluate', { expression: `({workerGlobal:typeof WebSocketPair==='function'&&typeof caches==='object',userAgent:typeof navigator==='object'?navigator.userAgent:null})`, returnByValue: true });
    const runtime = evaluated.result?.value;
    if (runtime?.workerGlobal !== true) throw Error('Inspector target is not a Worker global; refusing Node-process memory proxy');
    const sourceBinding = await bindWorkerSource(client, identity);
    const start = performance.now();
    do {
      const sample = heapSample(await client.call('Runtime.getHeapUsage'), performance.now() - start); samples.push(sample); await onSample(sample);
      await delay(intervalMs);
    } while (performance.now() - start < seconds * 1000);
    return { target: { id: target.id, title: target.title, url: target.url }, runtime, sourceBinding, intervalMs, durationMs: performance.now() - start, ...summarizeHeap(samples), measurements: samples };
  } finally { client.close(); }
}
async function main() {
  const args = new Map(process.argv.slice(2).map(arg => { const index = arg.indexOf('='); if (!arg.startsWith('--') || index < 3) throw Error('Use --name=value arguments'); return [arg.slice(2, index), arg.slice(index + 1)]; }));
  const required = ['inspector', 'base', 'world', 'compiled', 'catalogue', 'world-revision', 'route-hash', 'out'];
  for (const key of required) if (!args.get(key)) throw Error(`Missing --${key}`);
  const fixture = await fixtureIdentity({ worldFile: args.get('world'), compiledFile: args.get('compiled'), catalogueFile: args.get('catalogue'), worldRevision: args.get('world-revision'), routeHash: args.get('route-hash') });
  await verifyFixtureEndpoint(args.get('base'), fixture);
  const out = resolve(args.get('out')); await mkdir(dirname(out), { recursive: true });
  let lastProgress = -Infinity;
  const proof = await sampleWorker({ inspector: args.get('inspector'), identity: fixture, targetId: args.get('target'), seconds: Number(args.get('seconds') || 60), intervalMs: Number(args.get('interval-ms') || 50), onSample: sample => { if (sample.elapsedMs - lastProgress >= 10000) { console.log(JSON.stringify({ elapsedMs: Math.round(sample.elapsedMs), usedSize: sample.usedSize, backingStorageSize: sample.backingStorageSize, missing: sample.missing })); lastProgress = sample.elapsedMs; } } });
  await verifyFixtureEndpoint(args.get('base'), fixture);
  await writeFile(out, JSON.stringify({ fixture, ...proof }, null, 2) + '\n');
  console.log(JSON.stringify({ file: out, fixture, ...summarizeHeap(proof.measurements) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
