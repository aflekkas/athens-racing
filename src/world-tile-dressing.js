// Run-time dressing of a decoded tile: which ground mesh is "ground" and which is "sea", and the render variants the
// dressed meshes add, so a world baked before the dressing existed still draws it. No data travels on the wire for this.
// Meshes keep any `tileSurface` a newer bake already wrote.
/** Tag ground (palette 0, vertex colours, no terrain decode) and sea (`water`) meshes in place; returns the pack. */
export function tagDressedSurfaces(pack) {
  for (const m of pack.metadata.meshes) {
    const u = m.userData || (m.userData = {});
    if (u.tileSurface) continue;
    if (u.water) u.tileSurface = 'sea';
    else if (u.worldSurface && m.material === 0 && m.attributes.color && !u.terrainDecode) u.tileSurface = 'ground';
  }
  return pack;
}
const POSITION = { type: 'Float32Array', itemSize: 3, normalized: false }, COLOUR = { type: 'Uint8Array', itemSize: 3, normalized: true };
const variant = (surface, attributes, index = 'Uint16Array') => { const v = { surface, attributes, index, terrain: false }; return { key: JSON.stringify(v), ...v }; };
/** Render layouts the dressing can produce. A manifest baked earlier does not list them, and an undeclared layout is refused after start-up. */
export const DRESSING_VARIANTS = Object.freeze([
  variant('ground', { color: COLOUR, position: POSITION }),
  variant('building', { aFacade: { type: 'Uint16Array', itemSize: 2, normalized: false }, color: COLOUR, position: POSITION }),
  variant('sea', { position: POSITION }),
  variant('foam', { aFoam: { type: 'Uint8Array', itemSize: 1, normalized: true }, position: POSITION }),
]);
/** Bytes the run-time facade attribute adds to a tile (CPU array and its GPU copy). A manifest baked before it existed
 * did not budget them; the stream's 20% headroom covers the ~1% involved. */
export function dressingBytes(pack) {
  let bytes = 0;
  for (const m of pack.metadata.meshes) if (m.attributes.aFacade) bytes += 2 * pack.arrays[m.attributes.aFacade.array].byteLength;
  return bytes;
}
