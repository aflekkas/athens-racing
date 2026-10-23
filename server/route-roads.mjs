import { canonicalJSON, sha256 } from '../src/route-definition.js';
import { ROUTE_HASH } from '../src/route-network.js';
import { routeSurfaceAllowed } from '../src/route-surface.js';
import { projectEdge, edgeLength } from '../src/route-geometry.js';
const finite = Number.isFinite;
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
// The release builder signs exact emitted edges and individually contact/obstacle
// proven anchors. The request never contributes geometry or an unproved pose.
export async function validateRouteRoads(body, { expectedHash, worldSetRevision } = {}) {
  if (!body || body.schemaVersion !== 1 || body.worldId !== 'athens' || body.projectionId !== 'athens-v1' || !ROUTE_HASH.test(expectedHash || '') || body.worldSetRevision !== worldSetRevision || !ROUTE_HASH.test(worldSetRevision || '') || new TextEncoder().encode(canonicalJSON(body)).length > 2 * 1024 * 1024 || await sha256(body) !== expectedHash) throw Error('Invalid authoritative recovery artifact');
  if (!Array.isArray(body.edges) || !body.edges.length || !Array.isArray(body.anchors) || !body.anchors.length || !Array.isArray(body.sourceHashes) || !body.sourceHashes.length || !body.sourceHashes.every(([cell, hash]) => /^-?\d+,-?\d+$/.test(cell) && ROUTE_HASH.test(hash))) throw Error('Incomplete authoritative recovery artifact');
  const edges = new Map();
  for (const edge of body.edges) {
    if (typeof edge.id !== 'string' || edges.has(edge.id) || edge.flags & 8 || !Number.isInteger(edge.layer) || typeof edge.surface !== 'string' || !Array.isArray(edge.points) || edge.points.length < 2 || !edge.points.every(p => p.length === 3 && p.every(finite))) throw Error('Invalid emitted recovery edge');
    edges.set(edge.id, edge);
  }
  const graph = { edges: new Map([...edges].map(([id, value]) => [id, { value }])) };
  const seen = new Set();
  for (const a of body.anchors) {
    const e = edges.get(a.edgeId), key = canonicalJSON([a.edgeId, a.offsetM]);
    if (!e || seen.has(key) || !['x', 'y', 'z', 'yaw', 'offsetM', 'leftM', 'rightM', 'halfWidth', 'halfLength'].every(k => finite(a[k])) || a.offsetM < 0 || a.offsetM > edgeLength(e) + .025 || a.halfWidth <= 0 || a.halfLength <= 0 || a.leftM < a.halfWidth + .15 || a.rightM < a.halfWidth + .15 || a.layer !== e.layer || typeof a.surfaceId !== 'string') throw Error('Invalid proven recovery anchor');
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
      if (a.halfWidth >= footprint.halfWidth && a.halfLength >= footprint.halfLength && Math.hypot(a.x - pose.x, a.z - pose.z) <= radius) out.push(a);
    }
    // No route-anchor fallback when the release has no surveyed road nearby.
    return out;
  };
  return { candidates: near, contactAt(x, z, { referenceY = 0 } = {}) { return near({ x, y: referenceY, z }, { halfWidth: 0, halfLength: 0 }, 2).find(a => Math.abs(a.y - referenceY) < .75) || null; } };
}
