import { canonicalJSON, sha256 } from '../src/route-definition.js';
import { ROUTE_HASH } from '../src/route-network.js';
import { validateRouteRoads, routeRoadAuthority } from './route-roads.mjs';
import { recoveryDataBytes, recoveryCanonicalSize } from './route-road-wire.mjs';
export { recoveryDataBytes } from './route-road-wire.mjs';
export const RECOVERY_ARTIFACT_BYTES = 2 * 1024 * 1024;
const cellOf = pose => `${Math.floor(pose.x / 512)},${Math.floor(pose.z / 512)}`;
const sidecarURL = (key, hash) => `/world/recovery/${key}.${hash}.json`;
export async function validateRecoveryManifest(body, { expectedHash, worldSetRevision, sourceHashes = null } = {}) {
  if (!body || body.schemaVersion !== 1 || body.worldId !== 'athens' || body.projectionId !== 'athens-v1' || body.worldSetRevision !== worldSetRevision || !ROUTE_HASH.test(worldSetRevision || '') || !ROUTE_HASH.test(expectedHash || '') || new TextEncoder().encode(canonicalJSON(body)).length > RECOVERY_ARTIFACT_BYTES || await sha256(body) !== expectedHash || !body.cells || Array.isArray(body.cells) || !Object.keys(body.cells).length) throw Error('Invalid authoritative recovery manifest');
  if (sourceHashes !== null) {
    const expected = new Map(sourceHashes);
    if (!Array.isArray(sourceHashes) || expected.size !== sourceHashes.length || expected.size !== Object.keys(body.cells).length || [...expected].some(([key, hash]) => !ROUTE_HASH.test(hash || '') || body.cells[key]?.sourceHash !== hash)) throw Error('Recovery manifest omits or changes published world cells');
  }
  for (const [key, cell] of Object.entries(body.cells)) {
    if (!/^-?\d+,-?\d+$/.test(key) || !cell || !ROUTE_HASH.test(cell.sourceHash || '') || (cell.empty === true ? cell.hash !== undefined || cell.url !== undefined : !ROUTE_HASH.test(cell.hash || '') || cell.url !== sidecarURL(key, cell.hash))) throw Error('Invalid immutable recovery sidecar');
    Object.freeze(cell);
  }
  if (!Array.isArray(body.footprints) || !body.footprints.length || body.footprints.length > 64 || !body.footprints.every(p => Number.isFinite(p.halfWidth) && p.halfWidth > 0 && p.halfWidth <= 3 && Number.isFinite(p.halfLength) && p.halfLength > 0 && p.halfLength <= 12)) throw Error('Recovery manifest vehicle certificates unavailable');
  for (const p of body.footprints) Object.freeze(p); Object.freeze(body.footprints);
  Object.freeze(body.cells); return Object.freeze(body);
}
// Scan untrusted JSON before allocation. This is conservative accounting, not
// a measurement of V8 heap usage. Keep the request-time early rejection while
// allowing offline audits to obtain every contribution without JSON.parse.
function scanRecoveryJSON(text, limit = Infinity) {
  let quoted = false, escaped = false, stringStarts = 0, arrayOpens = 0, objectOpens = 0, commas = 0, colons = 0;
  const stringStorageBytes = text.length * 2;
  let estimatedDecodedBytes = stringStorageBytes;
  for (const ch of text) {
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') { quoted = true; stringStarts++; estimatedDecodedBytes += 96; }
    else if ('[{,:'.includes(ch)) {
      if (ch === '[') arrayOpens++; else if (ch === '{') objectOpens++; else if (ch === ',') commas++; else colons++;
      estimatedDecodedBytes += 128;
    }
    if (estimatedDecodedBytes > limit) throw Error('Recovery decoded memory budget exceeded');
  }
  const structuralTokens = arrayOpens + objectOpens + commas + colons;
  return Object.freeze({ codeUnits: text.length, stringStorageBytes, stringStarts, stringTokenBytes: stringStarts * 96,
    arrayOpens, objectOpens, commas, colons, structuralTokens, structuralBytes: structuralTokens * 128, estimatedDecodedBytes });
}
/** Pure preparse accounting, including all tokens even when over budget.
 * Does not parse, authenticate, or admit the artifact. Quoted punctuation is
 * excluded; UTF-16 storage and UTF-8 wire bytes are reported separately. */
export function estimateRecoveryJSON(raw) {
  if (typeof raw !== 'string' && !(raw instanceof Uint8Array)) throw TypeError('Recovery JSON must be text or bytes');
  const text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const wireBytes = typeof raw === 'string' ? new TextEncoder().encode(raw).length : raw.byteLength;
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
  let body, bytes, liveBufferBytes = 0, consumePacked = false;
  if (typeof raw === 'string' || raw instanceof Uint8Array) {
    bytes = typeof raw === 'string' ? new TextEncoder().encode(raw).length : raw.byteLength;
    if (bytes > RECOVERY_ARTIFACT_BYTES) throw Error('Recovery sidecar exceeds artifact budget');
    const text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw);
    scanRecoveryJSON(text, RECOVERY_MEMORY.decoded); body = JSON.parse(text);
    liveBufferBytes = text.length * 2 + (raw instanceof Uint8Array ? raw.byteLength : 0); consumePacked = true;
  } else {
    body = raw;
    // Caller-owned objects have no wire buffer to inspect. Count before any
    // canonical serialization/encoding, including the authentication phase.
    const decoded = recoveryDataBytes(body, RECOVERY_MEMORY.decoded), size = recoveryCanonicalSize(body);
    bytes = size.bytes;
    if (bytes > RECOVERY_ARTIFACT_BYTES) throw Error('Recovery sidecar exceeds artifact budget');
    const tokenBytes = (body?.schemaVersion === 2 ? size.maxTokenCodeUnits : size.codeUnits) * 2;
    if (decoded + tokenBytes + size.bytes * 2 > RECOVERY_MEMORY.decoded) throw Error('Recovery authentication memory budget exceeded');
  }
  recoveryDataBytes(body, RECOVERY_MEMORY.decoded);
  const memory = { liveBufferBytes };
  const proven = await validateRouteRoads(body, { expectedHash, worldSetRevision, maxCombinedBytes: RECOVERY_MEMORY.decoded, liveBufferBytes, consumePacked, memoryStats: memory });
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
    const [cx, cz] = cellOf(pose).split(',').map(Number), keys = [];
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) { const key = `${x},${z}`; if (manifest.cells[key] && !manifest.cells[key].empty) keys.push(key); }
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
        const descriptor = manifest.cells[key], raw = await loadArtifact(descriptor.url, RECOVERY_ARTIFACT_BYTES);
        const { body: proven, metrics } = await admitRecoverySidecar(raw, { expectedHash: descriptor.hash, worldSetRevision: manifest.worldSetRevision });
        const source = new Map(proven.sourceHashes);
        if (source.get(key) !== descriptor.sourceHash || proven.sourceHashes.some(([cell, hash]) => manifest.cells[cell]?.sourceHash !== hash)) throw Error('Recovery sidecar source drift');
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
        const unique = new Map(), edges = new Map(); let contextBytes = 256;
        for (const key of keys) {
          const cell = await load(key);
          for (const a of cell.authority.candidates(pose, footprint)) {
            const id = canonicalJSON([a.edgeId, a.offsetM, a.x, a.z]); if (unique.has(id)) continue;
            // Copy anchors: a snapshot must not retain an evicted cell's arrays.
            const anchor = { ...a, footprints: a.footprints?.map(p => ({ ...p })) };
            contextBytes += recoveryDataBytes(anchor) * 2 + id.length * 2 + 128;
            if (contextBytes > maxContextBytes) throw Error('Recovery candidate memory budget exceeded');
            unique.set(id, anchor);
          }
          for (const e of cell.edges) if (!edges.has(e.id)) {
            contextBytes += recoveryDataBytes(e) * 2 + 128;
            if (contextBytes > maxContextBytes) throw Error('Recovery candidate memory budget exceeded');
            edges.set(e.id, e);
          }
        }
        return { pose: JSON.stringify(pose), candidates: [...unique.values()], edges: [...edges.values()], bytes: contextBytes, release };
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
