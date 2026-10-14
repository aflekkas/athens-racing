// Shared appearance/photo gate (owner: MP session/modes; caller: customization owner).
// Photo layers reference signed asset ids (32 hex, max 8 layers per the pack
// format). A photo survives only when the injected appearance service
// confirms the sender owns the asset; guests, unknown owners and
// service-less transports keep photos local-only. Library decals and
// transforms are never touched here.
export function stripUnownedPhotos(unpackedDecals, service, owner) {
  if (!Array.isArray(unpackedDecals)) return [];
  return unpackedDecals.filter((d) => {
    if (!d || d.id !== 'photo') return true;
    if (typeof owner !== 'string' || !owner || !service || typeof service.owns !== 'function') return false;
    try { return service.owns(owner, d.assetId) === true; } catch { return false; }
  });
}
