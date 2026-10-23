import { decodeRecoverySidecar, recoveryDataBytes, recoveryCanonicalSize, recoveryCanonicalBytes } from './route-road-wire.mjs';
import { canonicalJSON } from '../src/route-definition.js';
import { ROUTE_HASH } from '../src/route-network.js';
import { recoveryRoadGroup } from '../src/world-road-group.js';
import { routeSurfaceAllowed } from '../src/route-surface.js';
import { projectEdge, edgeLength } from '../src/route-geometry.js';
const finite = Number.isFinite;
export const recoveryFootprints = anchor => anchor.footprints || [{ halfWidth: anchor.halfWidth, halfLength: anchor.halfLength }];
export const footprintCertified = (anchor, footprint) => recoveryFootprints(anchor).some(p => p.halfWidth >= footprint.halfWidth && p.halfLength >= footprint.halfLength);
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
// The release builder signs exact emitted edges and individually contact/obstacle
// proven anchors. The request never contributes geometry or an unproved pose.
async function authenticateRouteRoads(body, { expectedHash, worldSetRevision, maxCombinedBytes, liveBufferBytes, memoryStats }) {
  let size;
  if (body?.schemaVersion === 2) {
    size = recoveryCanonicalSize(body);
    if (size.bytes > 2 * 1024 * 1024) throw Error('Invalid authoritative recovery artifact');
    // Charge the output plus a conservative digest input copy. Neither is
    // retained after this helper; token writing avoids a full UTF-16 copy.
    const bytes = recoveryDataBytes(body) + liveBufferBytes + size.maxTokenCodeUnits * 2 + size.bytes * 2;
    if (bytes > maxCombinedBytes) throw Error('Recovery authentication memory budget exceeded');
    if (memoryStats) memoryStats.authenticationBytes = bytes;
  }
  const encoded = size ? recoveryCanonicalBytes(body, size) : new TextEncoder().encode(canonicalJSON(body));
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)), v => v.toString(16).padStart(2, '0')).join('');
  if (!body || ![1, 2].includes(body.schemaVersion) || body.worldId !== 'athens' || body.projectionId !== 'athens-v1' || !ROUTE_HASH.test(expectedHash || '') || body.worldSetRevision !== worldSetRevision || !ROUTE_HASH.test(worldSetRevision || '') || encoded.length > 2 * 1024 * 1024 || digest !== expectedHash) throw Error('Invalid authoritative recovery artifact');
}
export async function validateRouteRoads(body, { expectedHash, worldSetRevision, maxCombinedBytes = 12 * 1024 * 1024, liveBufferBytes = 0, consumePacked = false, memoryStats = null } = {}) {
  await authenticateRouteRoads(body, { expectedHash, worldSetRevision, maxCombinedBytes, liveBufferBytes, memoryStats });
  // Authenticate the immutable packed representation before any expansion.
  if (body.schemaVersion === 2) {
    const decoded = decodeRecoverySidecar(body, { maxCombinedBytes, liveBufferBytes, consume: consumePacked });
    body = decoded.body;
    if (memoryStats) memoryStats.expansionBytes = decoded.metrics.peakBytes;
  }
  if (!Array.isArray(body.edges) || !body.edges.length || !Array.isArray(body.anchors) || !body.anchors.length || !Array.isArray(body.sourceHashes) || !body.sourceHashes.length || !body.sourceHashes.every(([cell, hash]) => /^-?\d+,-?\d+$/.test(cell) && ROUTE_HASH.test(hash))) throw Error('Incomplete authoritative recovery artifact');
  const edges = new Map();
  for (const edge of body.edges) {
    if (typeof edge.id !== 'string' || !edge.id || typeof edge.from !== 'string' || !edge.from || typeof edge.to !== 'string' || !edge.to || edges.has(edge.id) || edge.flags & 8 || !Number.isInteger(edge.layer) || typeof edge.surface !== 'string' || !Array.isArray(edge.points) || edge.points.length < 2 || !edge.points.every(p => p.length === 3 && p.every(finite))) throw Error('Invalid emitted recovery edge');
    edges.set(edge.id, edge);
  }
  const graph = { edges: new Map([...edges].map(([id, value]) => [id, { value }])) };
  const seen = new Set();
  for (const a of body.anchors) {
    const e = edges.get(a.edgeId), group = e && recoveryRoadGroup(graph, e), key = canonicalJSON([a.edgeId, a.offsetM]);
    if ((group ? a.roadId !== group.roadId : a.roadId !== undefined)) throw Error('Recovery anchor road group differs from emitted reverse edges');
    if (!e || seen.has(key) || !['x', 'y', 'z', 'yaw', 'offsetM', 'leftM', 'rightM', 'halfWidth', 'halfLength'].every(k => finite(a[k])) || a.offsetM < 0 || a.offsetM > edgeLength(e) + .025 || a.halfWidth <= 0 || a.halfLength <= 0 || a.leftM < a.halfWidth + .15 || a.rightM < a.halfWidth + .15 || a.layer !== e.layer || typeof a.surfaceId !== 'string') throw Error('Invalid proven recovery anchor');
    if (!Array.isArray(recoveryFootprints(a)) || !recoveryFootprints(a).length || recoveryFootprints(a).length > 64 || !recoveryFootprints(a).every(p => finite(p.halfWidth) && p.halfWidth > 0 && p.halfWidth <= 3 && finite(p.halfLength) && p.halfLength > 0 && p.halfLength <= 12 && a.leftM >= p.halfWidth + .15 && a.rightM >= p.halfWidth + .15)) throw Error('Invalid certified recovery footprint');
    const q = projectEdge(e, a.x, a.z);
    if (!routeSurfaceAllowed(e, a, graph) || Math.abs(q.offsetM - a.offsetM) > .025 || q.distance > Math.max(a.leftM, a.rightM) || Math.abs(q.y - a.y) > .75 || Math.cos(q.yaw - a.yaw) < Math.cos(5 * Math.PI / 180)) throw Error('Recovery anchor left its emitted edge');
    seen.add(key);
  }
  return freeze(body);
}
export function routeRoadAuthority(body) {
  const index = new Map(), size = 64;
  for (const a of body.anchors) { const key = `${Math.floor(a.x / size)},${Math.floor(a.z / size)}`; if (!index.has(key)) index.set(key, []); index.get(key).push(a); }
  const near = (pose, footprint, radius = 192) => {
    if (!['x', 'y', 'z'].every(k => finite(pose[k]))) return [];
    const out = [], n = Math.ceil(radius / size), cx = Math.floor(pose.x / size), cz = Math.floor(pose.z / size);
    for (let x = cx - n; x <= cx + n; x++) for (let z = cz - n; z <= cz + n; z++) for (const a of index.get(`${x},${z}`) || []) {
      if (footprintCertified(a, footprint) && Math.hypot(a.x - pose.x, a.z - pose.z) <= radius) out.push(a);
    }
    // No route-anchor fallback when the release has no surveyed road nearby.
    return out;
  };
  return { candidates: near, contactAt(x, z, { referenceY = 0 } = {}) { return near({ x, y: referenceY, z }, { halfWidth: 0, halfLength: 0 }, 2).find(a => Math.abs(a.y - referenceY) < .75) || null; } };
}
