// Building meshes are DERIVED from the `buildings`, `buildingCorners` and `buildingHeights` tables when a tile declares
// `extensions.derivedBuildings`: the wire format stores each footprint once instead of a second time as flat-shaded
// triangles. Walls are one quad per footprint edge (4 vertices, flat shade), the roof one fan of ear-clipped triangles
// sharing the footprint's top ring. The shade factors are the bake's old face_shaded() values.
export const BUILDING_MESH_TRIANGLES = 16384;
const MAX_VERTICES = 65535;
/** Triangles one footprint of `n` corners draws: 2n wall triangles and n-2 roof triangles. */
export const buildingTriangleCount = n => 3 * n - 2;
const linear = level => level <= .04045 ? level / 12.92 : ((level + .055) / 1.055) ** 2.4;
const ROOF_SHADE = 255;
function shade(nx, nz) { return Math.round(linear(.75 + .10 * (nx * -.6 + nz * -.8)) * 255); }
/** Counter-clockwise (x right, z up) ring; ear clipping with a fan as the fallback for degenerate outlines. */
function earClip(points) {
  const n = points.length, next = Array.from({ length: n }, (_, i) => (i + 1) % n), prev = Array.from({ length: n }, (_, i) => (i + n - 1) % n);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (a, b, c, p) => cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;
  const triangles = []; let remaining = n, i = 0, guard = 0;
  while (remaining > 3 && guard++ < n * n) {
    const a = prev[i], b = i, c = next[i];
    let ear = cross(points[a], points[b], points[c]) > 1e-12;
    if (ear) for (let k = next[c]; k !== a; k = next[k]) if (inside(points[a], points[b], points[c], points[k])) { ear = false; break; }
    if (ear) { triangles.push([a, b, c]); next[a] = c; prev[c] = a; remaining--; i = c; guard = 0; } else i = next[i];
  }
  if (remaining === 3) { triangles.push([prev[i], i, next[i]]); return triangles; }
  return Array.from({ length: n - 2 }, (_, k) => [0, k + 1, k + 2]);
}
/** Meshes (shared vertices, Uint8 shade, Uint16 index) for every building row, grouped by palette entry. */
export function deriveBuildingMeshes(t, m) {
  const groups = new Map();
  for (let row = 0; row < t.buildings.length / 4; row++) {
    const first = t.buildings[row * 4 + 1], n = t.buildings[row * 4 + 2], material = t.buildings[row * 4 + 3];
    const base = t.buildingHeights[row * 2], top = base + t.buildingHeights[row * 2 + 1];
    let ring = Array.from({ length: n }, (_, k) => [t.buildingCorners[(first + k) * 2], t.buildingCorners[(first + k) * 2 + 1]]);
    let area = 0; for (let k = 0; k < n; k++) { const a = ring[k], b = ring[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) ring = ring.reverse();
    if (!groups.has(material)) groups.set(material, []);
    groups.get(material).push({ ring, base, top });
  }
  const arrays = [], meshes = [];
  for (const material of [...groups.keys()].sort((a, b) => a - b)) {
    let chunk = [], tris = 0, verts = 0;
    const flush = () => {
      if (!chunk.length) return;
      const position = new Float32Array(verts * 3), color = new Uint8Array(verts * 3), index = new Uint16Array(tris * 3);
      let v = 0, ix = 0;
      const vertex = (x, y, z, c) => { position[v * 3] = x; position[v * 3 + 1] = y; position[v * 3 + 2] = z; color[v * 3] = color[v * 3 + 1] = color[v * 3 + 2] = c; return v++; };
      for (const { ring, base, top } of chunk) {
        const n = ring.length;
        for (let k = 0; k < n; k++) {
          const a = ring[k], b = ring[(k + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
          const c = shade(dz / length, -dx / length);
          const a0 = vertex(a[0], base, a[1], c), a1 = vertex(a[0], top, a[1], c), b0 = vertex(b[0], base, b[1], c), b1 = vertex(b[0], top, b[1], c);
          index.set([a0, a1, b0, b0, a1, b1], ix); ix += 6;
        }
        const roof = ring.map(p => vertex(p[0], top, p[1], ROOF_SHADE));
        for (const [a, b, c] of earClip(ring)) { index.set([roof[a], roof[c], roof[b]], ix); ix += 3; }
      }
      const pi = arrays.push(position) - 1, ci = arrays.push(color) - 1, ii = arrays.push(index) - 1;
      meshes.push({ name: 'probe', material, attributes: { position: { array: pi, itemSize: 3, normalized: false }, color: { array: ci, itemSize: 3, normalized: true } }, index: ii, userData: { worldSurface: false }, layers: 1, drawRange: { start: 0, count: index.length } });
      chunk = []; tris = 0; verts = 0;
    };
    for (const piece of groups.get(material)) {
      const n = piece.ring.length, t3 = buildingTriangleCount(n), v = 5 * n;
      if (chunk.length && (tris + t3 > BUILDING_MESH_TRIANGLES || verts + v > MAX_VERTICES)) flush();
      chunk.push(piece); tris += t3; verts += v;
    }
    flush();
  }
  return { arrays, meshes };
}
/** Append the derived building meshes to a decoded pack (arrays after the wire arrays, meshes after the wire meshes). */
export function addDerivedBuildings(pack, tables) {
  const flag = pack.metadata.extensions?.derivedBuildings;
  if (!flag || flag.derived) return pack;
  const { arrays, meshes } = deriveBuildingMeshes(tables, pack.metadata), offset = pack.arrays.length;
  for (const a of arrays) pack.arrays.push(a);
  for (const mesh of meshes) {
    for (const a of Object.values(mesh.attributes)) a.array += offset;
    mesh.index += offset; pack.metadata.meshes.push(mesh);
  }
  pack.metadata.extensions = { ...pack.metadata.extensions, derivedBuildings: { ...flag, derived: true } };
  return pack;
}
