import { canonicalJSON, sha256 } from '../src/route-definition.js';
import { ROUTE_HASH } from '../src/route-network.js';
import { validateRouteRoads, routeRoadAuthority } from './route-roads.mjs';
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
/** Bounded server-owned cache. Missing, stale or incompletely admitted cells
 * never produce a partial set of tow candidates. No request-time bucket lists. */
export function createStreamedRoadAuthority(manifest, loadArtifact, { maxBytes = 12 * 1024 * 1024, maxEntries = 16, maxPending = 12 } = {}) {
  const cache = new Map(), pending = new Map(); let bytes = 0;
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
    const promise = (async () => {
      const descriptor = manifest.cells[key], raw = await loadArtifact(descriptor.url, RECOVERY_ARTIFACT_BYTES);
      let body;
      if (typeof raw === 'string' || raw instanceof Uint8Array) {
        const size = typeof raw === 'string' ? new TextEncoder().encode(raw).length : raw.byteLength;
        if (size > RECOVERY_ARTIFACT_BYTES) throw Error('Recovery sidecar exceeds artifact budget');
        body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      } else body = raw;
      const proven = await validateRouteRoads(body, { expectedHash: descriptor.hash, worldSetRevision: manifest.worldSetRevision });
      const source = new Map(proven.sourceHashes);
      if (source.get(key) !== descriptor.sourceHash || proven.sourceHashes.some(([cell, hash]) => manifest.cells[cell]?.sourceHash !== hash)) throw Error('Recovery sidecar source drift');
      const size = new TextEncoder().encode(canonicalJSON(proven)).length;
      if (size > maxBytes) throw Error('Recovery sidecar exceeds cache budget');
      const value = { body: proven, authority: routeRoadAuthority(proven), size };
      cache.set(key, value); bytes += size;
      while (bytes > maxBytes || cache.size > maxEntries) { const oldest = cache.keys().next().value; bytes -= cache.get(oldest).size; cache.delete(oldest); }
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  };
  const readyFor = pose => { const keys = keysFor(pose); return !!keys && keys.every(key => cache.has(key)); };
  return {
    async ensure(pose) { const keys = keysFor(pose); if (!keys) throw Error('Recovery roads are unavailable at this position'); for (const key of keys) await load(key); if (!readyFor(pose)) throw Error('Recovery safety set exceeds cache budget'); },
    readyFor,
    candidates(pose, footprint) {
      const keys = keysFor(pose); if (!keys || !readyFor(pose)) return [];
      const unique = new Map(); for (const key of keys) for (const a of touch(key).authority.candidates(pose, footprint)) unique.set(canonicalJSON([a.edgeId, a.offsetM, a.x, a.z]), a);
      return [...unique.values()];
    },
    contactAt(x, z, options = {}) { const pose = { x, z, y: options.referenceY || 0 }; if (!readyFor(pose)) return null; for (const key of keysFor(pose)) { const contact = touch(key).authority.contactAt(x, z, options); if (contact) return contact; } return null; },
    edgesFor(pose) { const keys = keysFor(pose); return !keys || !readyFor(pose) ? [] : keys.flatMap(key => touch(key).body.edges); },
    stats: () => ({ entries: cache.size, bytes, pending: pending.size })
  };
}
