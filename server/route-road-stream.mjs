import { createRecoveryQueryBuilder } from './recovery-query-context.mjs';
import { recoveryCellDescriptor, recoveryCellSourceHash, recoveryCellScratchBytes, MAX_RECOVERY_CELL_SCRATCH } from './recovery-manifest-wire.mjs';
import { canonicalJSON, sha256 } from '../src/route-definition.js';
import { ROUTE_HASH } from '../src/route-network.js';
import { validateRouteRoads, validateRecoveryRoadJSON, routeRoadAuthority } from './route-roads.mjs';
import { recoveryDataBytes, recoveryUTF8Bytes, scanRecoveryJSON, snapshotRecoverySidecar, recoveryJSONDataBytes } from './route-road-wire.mjs';
export { recoveryDataBytes } from './route-road-wire.mjs';
export const RECOVERY_ARTIFACT_BYTES = 2 * 1024 * 1024;
const cellOf = pose => `${Math.floor(pose.x / 512)},${Math.floor(pose.z / 512)}`;
const sidecarURL = (key, hash) => `/world/recovery/${key}.${hash}.json`;
export async function validateRecoveryManifest(body, { expectedHash, worldSetRevision, sourceHashes = null } = {}) {
  // Reserve both registry forms (including tuple strings) and a conservative
  // Map index before allocating either private snapshot. No caller accessors.
  let registryBytes = 0, registryIndexBytes = 0, expected = null;
  if (sourceHashes !== null) {
    registryBytes = recoveryJSONDataBytes(sourceHashes, RECOVERY_MEMORY.decoded / 2);
    if (!Array.isArray(sourceHashes) || !sourceHashes.length) throw Error('Recovery manifest omits or changes published world cells');
    registryIndexBytes = 96 + sourceHashes.length * 128;
  }
  const compact = body && Object.getOwnPropertyDescriptor(body, 'schemaVersion')?.value === 2;
  const descriptorScratchBytes = compact ? MAX_RECOVERY_CELL_SCRATCH : 0;
  const registryLiveBytes = registryBytes * 2 + registryIndexBytes + descriptorScratchBytes;
  const snapshot = snapshotRecoverySidecar(body, { maxCombinedBytes: RECOVERY_MEMORY.decoded, liveBufferBytes: registryLiveBytes }); body = snapshot.body;
  if (sourceHashes !== null) {
    sourceHashes = structuredClone(sourceHashes);
    expected = new Map();
    for (const tuple of sourceHashes) {
      if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== 'string' || !/^-?\d+,-?\d+$/.test(tuple[0]) || typeof tuple[1] !== 'string' || !ROUTE_HASH.test(tuple[1]) || expected.has(tuple[0])) throw Error('Recovery manifest omits or changes published world cells');
      expected.set(tuple[0], tuple[1]);
    }
  }
  if (!body || ![1, 2].includes(body.schemaVersion) || body.worldId !== 'athens' || body.projectionId !== 'athens-v1' || body.worldSetRevision !== worldSetRevision || !ROUTE_HASH.test(worldSetRevision || '') || !ROUTE_HASH.test(expectedHash || '') || snapshot.metrics.bytes > RECOVERY_ARTIFACT_BYTES || await sha256(body) !== expectedHash || !body.cells || Array.isArray(body.cells) || !Object.keys(body.cells).length) throw Error('Invalid authoritative recovery manifest');
  if (expected !== null && (expected.size !== Object.keys(body.cells).length || [...expected].some(([key, hash]) => recoveryCellSourceHash(body, key) !== hash))) throw Error('Recovery manifest omits or changes published world cells');
  for (const [key, raw] of Object.entries(body.cells)) {
    const cell = compact ? recoveryCellDescriptor(body, key) : raw;
    const multipart = Array.isArray(cell?.parts);
    if (!/^-?\d+,-?\d+$/.test(key) || !cell || cell.empty !== undefined && cell.empty !== true || !ROUTE_HASH.test(cell.sourceHash || '') || (cell.empty === true ? cell.hash !== undefined || cell.url !== undefined || cell.parts !== undefined : multipart ? cell.hash !== undefined || cell.url !== undefined || !cell.parts.length || cell.parts.length > 64 || new Set(cell.parts).size !== cell.parts.length || cell.parts.some(hash => !ROUTE_HASH.test(hash || '')) : cell.parts !== undefined || !ROUTE_HASH.test(cell.hash || '') || cell.url !== sidecarURL(key, cell.hash))) throw Error('Invalid immutable recovery sidecar');
    if (!compact) { if (multipart) Object.freeze(cell.parts); Object.freeze(cell); }
  }
  if (!Array.isArray(body.footprints) || !body.footprints.length || body.footprints.length > 64 || !body.footprints.every(p => Number.isFinite(p.halfWidth) && p.halfWidth > 0 && p.halfWidth <= 3 && Number.isFinite(p.halfLength) && p.halfLength > 0 && p.halfLength <= 12)) throw Error('Recovery manifest vehicle certificates unavailable');
  for (const p of body.footprints) Object.freeze(p); Object.freeze(body.footprints);
  Object.freeze(body.cells); return Object.freeze(body);
}
/** Pure preparse accounting, including all tokens even when over budget.
 * Does not parse, authenticate, or admit the artifact. Quoted punctuation is
 * excluded; UTF-16 storage and UTF-8 wire bytes are reported separately. */
export function estimateRecoveryJSON(raw) {
  if (typeof raw !== 'string' && !(raw instanceof Uint8Array)) throw TypeError('Recovery JSON must be text or bytes');
  const text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const wireBytes = typeof raw === 'string' ? recoveryUTF8Bytes(raw) : raw.byteLength;
  const estimate = scanRecoveryJSON(text);
  return Object.freeze({ ...estimate, wireBytes, decodedLimitBytes: RECOVERY_MEMORY.decoded,
    exceedsDecodedLimit: estimate.estimatedDecodedBytes > RECOVERY_MEMORY.decoded,
    artifactLimitBytes: RECOVERY_ARTIFACT_BYTES, exceedsArtifactLimit: wireBytes > RECOVERY_ARTIFACT_BYTES });
}
export const RECOVERY_MEMORY = Object.freeze({ cache: 16 * 1024 * 1024, decoded: 12 * 1024 * 1024, context: 2 * 1024 * 1024, contexts: 2 });
/** Pure admission shared by the offline release audit and request-time loader.
 * The compact body is server query data, never a replacement published artifact.
 * Source hashes are retained so callers can bind them to their full manifest. */
export async function admitRecoverySidecar(raw, { expectedHash, worldSetRevision } = {}) {
  let text, bytes, liveBufferBytes = 0;
  const objectInput = typeof raw !== 'string' && !(raw instanceof Uint8Array);
  if (!objectInput) {
    bytes = typeof raw === 'string' ? recoveryUTF8Bytes(raw) : raw.byteLength;
    if (bytes > RECOVERY_ARTIFACT_BYTES) throw Error('Recovery sidecar exceeds artifact budget');
    text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw);
    liveBufferBytes = text.length * 2 + (raw instanceof Uint8Array ? raw.byteLength : 0);
  }
  const memory = { liveBufferBytes };
  const options = { expectedHash, worldSetRevision, maxCombinedBytes: RECOVERY_MEMORY.decoded, liveBufferBytes, memoryStats: memory };
  const proven = objectInput ? await validateRouteRoads(raw, options) : await validateRecoveryRoadJSON(text, options);
  if (objectInput) bytes = memory.bytes;
  const edges = Object.freeze(proven.edges.map(({ id, layer, surface, flags }) => Object.freeze({ id, layer, surface, flags })));
  const compact = Object.freeze({ anchors: proven.anchors, edges, sourceHashes: proven.sourceHashes });
  const decodedBytes = recoveryDataBytes({ anchors: proven.anchors, edges }) * 2;
  if (decodedBytes > RECOVERY_MEMORY.cache) throw Error('Recovery sidecar exceeds cache budget');
  return Object.freeze({ body: compact, metrics: Object.freeze({ bytes, decodedBytes, memory: Object.freeze(memory) }) });
}
/** Fetch/parse admission is serial. Cached cells retain anchors and minimal edge
 * metadata only. Leased request snapshots survive LRU eviction; an incomplete
 * or over-budget snapshot never becomes eligible for recovery. */
export function createStreamedRoadAuthority(manifest, loadArtifact, { maxBytes = 12 * 1024 * 1024, maxEntries = 16, maxPending = 12, maxDecodedBytes = RECOVERY_MEMORY.cache, maxContextBytes = RECOVERY_MEMORY.context } = {}) {
  const cache = new Map(), pending = new Map(); let bytes = 0, decodedBytes = 0, serial = Promise.resolve(), parsing = 0, peakParsing = 0, leases = 0;
  const keysFor = pose => {
    if (!pose || !['x', 'y', 'z'].every(k => Number.isFinite(pose[k])) || !manifest.cells[cellOf(pose)]) return null;
    const [cx, cz] = cellOf(pose).split(',').map(Number), keys = []; let scratchBytes = 256;
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      const key = `${x},${z}`; if (!Object.hasOwn(manifest.cells, key)) continue;
      const descriptorBytes = recoveryCellScratchBytes(manifest, key); scratchBytes += descriptorBytes;
      if (scratchBytes > maxContextBytes) throw Error('Recovery candidate memory budget exceeded: descriptor context');
      const descriptor = recoveryCellDescriptor(manifest, key, { maxScratchBytes: descriptorBytes || MAX_RECOVERY_CELL_SCRATCH });
      if (descriptor.empty === true) continue;
      for (const hash of descriptor.parts || [descriptor.hash]) {
        const referenceBytes = 96 + (key.length + 1 + hash.length) * 2; scratchBytes += referenceBytes;
        if (scratchBytes > maxContextBytes) throw Error('Recovery candidate memory budget exceeded: reference context memory budget exceeded');
        keys.push(key + ':' + hash);
      }
    }
    Object.defineProperty(keys, 'scratchBytes', { value: scratchBytes });
    return keys;
  };
  const touch = key => { const value = cache.get(key); if (value) { cache.delete(key); cache.set(key, value); } return value; };
  const load = key => {
    const present = touch(key); if (present) return Promise.resolve(present);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= maxPending) return Promise.reject(Error('Recovery roads busy. Try again.'));
    const promise = serial.then(async () => {
      parsing++; peakParsing = Math.max(peakParsing, parsing);
      try {
        const separator = key.indexOf(':'), cell = key.slice(0, separator), hash = key.slice(separator + 1), descriptor = { cell, hash, url: sidecarURL(cell, hash) }, raw = await loadArtifact(descriptor.url, RECOVERY_ARTIFACT_BYTES);
        const { body: proven, metrics } = await admitRecoverySidecar(raw, { expectedHash: descriptor.hash, worldSetRevision: manifest.worldSetRevision });
        const source = new Map(proven.sourceHashes);
        if (source.get(descriptor.cell) !== recoveryCellSourceHash(manifest, descriptor.cell) || proven.sourceHashes.some(([cell, hash]) => recoveryCellSourceHash(manifest, cell) !== hash)) throw Error('Recovery sidecar source drift');
        const { bytes: size, decodedBytes: decoded } = metrics, edges = proven.edges;
        if (size > maxBytes || decoded > maxDecodedBytes) throw Error('Recovery sidecar exceeds cache budget');
        const value = { authority: routeRoadAuthority(proven), edges, size, decoded };
        cache.set(key, value); bytes += size; decodedBytes += decoded;
        while (bytes > maxBytes || decodedBytes > maxDecodedBytes || cache.size > maxEntries) { const oldest = cache.keys().next().value, item = cache.get(oldest); bytes -= item.size; decodedBytes -= item.decoded; cache.delete(oldest); }
        return value;
      } finally { parsing--; }
    }).finally(() => pending.delete(key));
    serial = promise.catch(() => {}); pending.set(key, promise); return promise;
  };
  const readyFor = pose => { const keys = keysFor(pose); return !!keys && keys.every(key => cache.has(key)); };
  return {
    async prepare(pose, footprint) {
      const keys = keysFor(pose); if (!keys) throw Error('Recovery roads are unavailable at this position');
      if (leases >= RECOVERY_MEMORY.contexts) throw Error('Recovery roads busy. Try again.');
      leases++; let released = false;
      const release = () => { if (!released) { released = true; leases--; } };
      try {
        const builder = createRecoveryQueryBuilder({maxBytes:maxContextBytes,initialBytes:keys.scratchBytes || 0});
        for (const key of keys) {
          const cell = await load(key);
          for (const a of cell.authority.iterateCandidates(pose, footprint)) builder.add(a);
          for (const e of cell.edges) builder.addEdge(e);
        }
        return { pose: JSON.stringify(pose), ...builder.finish(), release };
      } catch (error) { release(); throw error; }
    },
    async ensure(pose) { const keys = keysFor(pose); if (!keys) throw Error('Recovery roads are unavailable at this position'); for (const key of keys) await load(key); if (!readyFor(pose)) throw Error('Recovery safety set exceeds cache budget'); },
    readyFor,
    candidates(pose, footprint) {
      const keys = keysFor(pose); if (!keys || !readyFor(pose)) return [];
      const unique = new Map(); for (const key of keys) for (const a of touch(key).authority.candidates(pose, footprint)) unique.set(canonicalJSON([a.edgeId, a.offsetM, a.x, a.z]), a);
      return [...unique.values()];
    },
    contactAt(x, z, options = {}) { const pose = { x, z, y: options.referenceY || 0 }; if (!readyFor(pose)) return null; for (const key of keysFor(pose)) { const contact = touch(key).authority.contactAt(x, z, options); if (contact) return contact; } return null; },
    edgesFor(pose) { const keys = keysFor(pose); return !keys || !readyFor(pose) ? [] : keys.flatMap(key => touch(key).edges); },
    stats: () => ({ entries: cache.size, bytes, decodedBytes, pending: pending.size, parsing, peakParsing, leases })
  };
}
