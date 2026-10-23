// Immutable multiplayer binding. Geometry and world releases are never inferred
// from map names, short hashes, or a client's selected route.
export const ROUTE_HASH = /^[a-f0-9]{64}$/;
export const ROUTE_IDENTITY_FIELDS = Object.freeze(['worldId', 'routeId', 'routeHash', 'geometryHash', 'worldSetRevision', 'projectionId', 'onlineGridHash']);
export function routeNetworkIdentity(compiled, onlineGridHash = compiled?.onlineGridHash) {
  const identity = { worldId: compiled?.worldId, routeId: compiled?.id ?? compiled?.routeId, routeHash: compiled?.routeHash, geometryHash: compiled?.geometryHash, worldSetRevision: compiled?.worldSetRevision, projectionId: 'athens-v1', ...(onlineGridHash === undefined ? {} : { onlineGridHash }) };
  if (!validRouteIdentity(identity, { online: onlineGridHash !== undefined })) throw Error('Invalid route network identity');
  return Object.freeze(identity);
}
export function validRouteIdentity(value, { online = true } = {}) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.worldId === 'athens' && value.projectionId === 'athens-v1' && /^[a-z][a-z0-9-]{2,63}$/.test(value.routeId || '') && ['routeHash', 'geometryHash', 'worldSetRevision', ...(online ? ['onlineGridHash'] : [])].every(k => ROUTE_HASH.test(value[k] || '')) && (value.onlineGridHash === undefined || ROUTE_HASH.test(value.onlineGridHash));
}
export function sameRouteIdentity(a, b) {
  return validRouteIdentity(a) && validRouteIdentity(b) && ROUTE_IDENTITY_FIELDS.every(k => a[k] === b[k]);
}
