import {buildTileObstacleIndex,obstacleBytes} from './world-tile-obstacles.js';
import {psychikoMappedBuildings,psychikoInfillBlocked} from './world-tile-psychiko.js';
import {coastalMappedBuildings,coastalInfillTables,clearCoastalStreetTrees,coastalRecipe,coastalRows,appendCoastalSurfaces,dressCoastalGround} from './world-tile-coast.js';
// Building meshes are DERIVED from the `buildings`, `buildingCorners` and `buildingHeights` tables when a tile declares
// `extensions.derivedBuildings`: the wire format stores each footprint once instead of a second time as flat-shaded
// triangles. Walls are one quad per footprint edge (4 vertices), the roof one fan of ear-clipped triangles sharing the
// footprint's top ring. A vertex is 16 bytes: position (3 floats) and `aFacade` (2 Uint16). There is no colour attribute:
// the facade material shades each face from its own normal (`FACADE_GLSL`, `wallShade`, the bake's old face_shaded() values).
import { LANDMARK_HIDDEN, osmBuildingId } from './athens-landmark-hide.js';
import { inOldQuarter } from './athens-quarters.js';
import { deriveStreetTrees,deriveLegacyStreetTreeSeeds } from './world-tile-trees.js';
import { deriveParking } from './world-tile-parking.js';
import { deriveStreetArt } from './world-tile-street-art.js';
export const BUILDING_MESH_TRIANGLES = 16384;
export const ROOFTOP_LIMIT = 1400;
/** A hipped house: four walls (8 triangles) and six roof triangles. */
export const PITCHED_TRIANGLES = 14;
const MAX_VERTICES = 65535;
/** Triangles one footprint of `n` corners draws: 2n wall triangles and n-2 roof triangles. */
export const buildingTriangleCount = n => 3 * n - 2;
const linear = level => level <= .04045 ? level / 12.92 : ((level + .055) / 1.055) ** 2.4;
/** Linear-space brightness of a wall whose outward normal has horizontal components (nx, nz): about 15-35% darker than a roof
 * in display space, under a fixed NW sun. Roofs (normal up) are 1. The facade fragment shader computes the same value per face
 * from screen-space derivatives of the local position; this is the reference its constants are tested against. */
export function wallShade(nx, nz) { return linear(.75 + .10 * (nx * -.6 + nz * -.8)); }
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
/** Facade style for the shader (0 plaster, 1 balconies, 2 shutters, 3 awnings, 4 shops, 5 offices, 6 masonry, 7 industrial).
 * A bake that knows the building type (OSM tags) stores it; style 0 means "unknown", so a rule on height and a footprint
 * hash picks one: houses get shutters, mid-rise blocks balconies or awnings, tall blocks balconies with a shop floor. */
export function facadeStyleFor(stored, height, hash) {
  if (stored) return stored;
  if (height < 6.5) return hash % 3 === 0 ? 0 : 2;
  if (height < 12) return [1, 3, 1, 4][hash % 4];
  return hash % 5 === 0 ? 5 : hash % 5 === 1 ? 4 : 1;
}
/** FNV-1a of the whole building's id (a piece id is `<part id>/<cx>:<cz>`), so the pieces of one building in two cells agree. */
const idHash = id => { let h = 2166136261; const part = String(id || '').split('/')[0]; for (let i = 0; i < part.length; i++) h = Math.imul(h ^ part.charCodeAt(i), 16777619); return h >>> 0; };
/** Richer facade styles, 8 to 15 (bit 15 of the style field): the polykatoikia and the neoclassical house. */
export const STYLE = Object.freeze({ pilotis: 8, continuous: 9, neoclassical: 10, veranda: 11 });
/** Turn a base style (0..7: the bake's building type or the height rule) into one of the Athens types. A polykatoikia (the 1950s-70s concrete
 * apartment block that is most of the city) gets an open pilotis ground floor, continuous balcony slabs with awnings, or glazed verandas; the old
 * quarters get neoclassical facades (tall shuttered windows, lintels, plain stucco). Shops, offices, masonry and industry are left as they are. */
export function richStyleFor(style, height, hash, quarter, historic = false) {
  const r = (hash >>> 8) % 100;
  if ((quarter || historic) && height <= 15 && [0, 1, 2, 3, 6].includes(style)) return r < (historic ? 95 : 70) ? STYLE.neoclassical : style;
  if (height < 7.5) return style;
  if (style === 1 || style === 3 || (style === 0 && height >= 9)) return r < 34 ? STYLE.pilotis : r < 68 ? STYLE.continuous : r < 84 ? STYLE.veranda : style;
  return style;
}
/** Wall colour family of a building (2 bits, the facade shader turns it into an Athens palette): 0 white, 1 cream, 2 ochre, 3 pale pink / terracotta. The old quarters lean warm. */
export function paletteFor(hash, quarter) {
  const r = (hash >>> 16) % 100;
  return quarter ? (r < 18 ? 0 : r < 50 ? 1 : r < 78 ? 2 : 3) : (r < 40 ? 0 : r < 68 ? 1 : r < 83 ? 2 : 3);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = a => Math.hypot(a[0], a[1]);
/** The footprint as a rectangle (corners rotated so that p0 -> p1 is a long side) if it has four right angles within about 13 degrees, else null. */
export function rectangleOf(ring) {
  if (ring.length !== 4) return null;
  for (let i = 0; i < 4; i++) { const e = sub(ring[(i + 1) % 4], ring[i]), f = sub(ring[(i + 2) % 4], ring[(i + 1) % 4]); if (Math.abs(e[0] * f[0] + e[1] * f[1]) > .22 * len(e) * len(f)) return null; }
  const k = len(sub(ring[1], ring[0])) >= len(sub(ring[2], ring[1])) ? 0 : 1, p = [0, 1, 2, 3].map(i => ring[(i + k) % 4]);
  return { p, l: len(sub(p[1], p[0])), s: len(sub(p[2], p[1])) };
}
/** Roof shapes a bake may store per building (OSM `roof:shape`, heritage tags): 0 unknown, 1 flat, 2 gabled, 3 hipped, 4 historic. */
export const ROOF = Object.freeze({ unknown: 0, flat: 1, gabled: 2, hipped: 3, historic: 4 });
/** Pitched (hipped) tile roof for a house, or null for the usual flat roof. Houses of up to three floors on a rectangular footprint get one:
 * nearly always in the old quarters, about half of the low houses elsewhere; a stored OSM roof shape wins. `rise` is the ridge height in metres. */
export function roofFor(ring, height, hash, quarter, stored = 0) {
  if (stored === ROOF.flat) return null;
  const rect = rectangleOf(ring); if (!rect || rect.s < 4.2 || rect.s > 15 || rect.l > 36) return null;
  const known = stored >= ROOF.gabled, p = known ? 1 : quarter ? .85 : height <= 7.5 ? .5 : height <= 10.6 ? .22 : .05;
  if ((known ? height > 20 : height > 13.5) || ((hash >>> 5) % 1000) / 1000 >= p) return null;
  return { rect, rise: Math.min(4.4, .3 * rect.s + .5) };
}
/** The kit on a flat roof, as rows { x, z, yaw, code } in tile-local metres; code = kind * 4 + tint, kind 0 stair head with a tank, 1 solar water heater, 2 TV antenna, 3 pergola.
 * Roofs of two floors and up on 45 m2 or more of footprint: about one heater per 80 m2 of roof (never more than eight), an antenna and one more per 250 m2, a stair head
 * on the bigger ones and a pergola on one in seven. They stand on a loose grid inside the roof, at least 1.5 m from its edge. Rows of a roof are kept in a fixed order,
 * so the same roof always gets the same kit. */
export function rooftopKit(ring, height, hash, area) {
  if (height < 6.5 || area < 45 || ((hash >>> 11) % 100) >= (height < 10 ? 70 : 92)) return [];
  const rect = rectangleOf(ring); let cx, cz, ax = [1, 0], L, Wd, yaw = 0;
  if (rect) {
    const m1 = [(rect.p[3][0] + rect.p[0][0]) / 2, (rect.p[3][1] + rect.p[0][1]) / 2], m2 = [(rect.p[1][0] + rect.p[2][0]) / 2, (rect.p[1][1] + rect.p[2][1]) / 2], d = sub(m2, m1), dl = len(d) || 1;
    cx = (m1[0] + m2[0]) / 2; cz = (m1[1] + m2[1]) / 2; ax = [d[0] / dl, d[1] / dl]; L = rect.l; Wd = rect.s; yaw = -Math.atan2(ax[1], ax[0]);
  } else {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    cx = (x0 + x1) / 2; cz = (z0 + z1) / 2; L = x1 - x0; Wd = z1 - z0;
  }
  const ay = [-ax[1], ax[0]], inside = (x, z) => { let r = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > z) !== (ring[j][1] > z) && x < (ring[j][0] - ring[i][0]) * (z - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) r = !r; return r; };
  const cells = [], gx = 4.6, gz = 3.6;
  for (let u = -Math.floor((L - 3) / 2 / gx); u <= Math.floor((L - 3) / 2 / gx); u++) for (let v = -Math.floor((Wd - 3) / 2 / gz); v <= Math.floor((Wd - 3) / 2 / gz); v++) {
    const x = cx + ax[0] * u * gx + ay[0] * v * gz, z = cz + ax[1] * u * gx + ay[1] * v * gz;
    if (inside(x, z) && [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].every(([a, b]) => inside(x + ax[0] * a + ay[0] * b, z + ax[1] * a + ay[1] * b))) cells.push({ x, z, k: ((Math.imul(u + 50, 73856093) ^ Math.imul(v + 50, 19349663) ^ hash) >>> 0) });
  }
  cells.sort((a, b) => a.k - b.k);
  const out = [], take = (kind, count) => { for (let i = 0; i < count && cells.length; i++) { const c = cells.shift(); out.push({ x: c.x, z: c.z, yaw: yaw + ((c.k >>> 7) % 5) * .02 - .04 + (kind === 2 ? (c.k % 3) * .6 : 0), code: kind * 4 + (c.k >>> 13) % 4 }); } };
  const frac = (area / 80) * .85, solar = Math.min(8, Math.floor(frac) + (((hash >>> 17) % 100) / 100 < frac - Math.floor(frac) ? 1 : 0));
  if (area > 150) take(0, 1);
  take(1, solar); take(2, 1 + Math.floor(area / 250));
  if (area > 110 && height < 24 && ((hash >>> 19) % 7) === 0) take(3, 1);
  return out;
}
/** Kept for the tests that name it: the first kit row of a roof, or null. */
export function rooftopFor(ring, height, hash, area) { const k = rooftopKit(ring, height, hash, area)[0]; return k ? { x: k.x, z: k.z, yaw: k.yaw } : null; }
const pieceVertices = piece => piece.roof ? 22 : 5 * piece.ring.length, pieceTriangles = piece => piece.roof ? PITCHED_TRIANGLES : buildingTriangleCount(piece.ring.length);
/** Meshes (shared vertices, Uint16 index) for every building row, grouped by palette entry. `styles` is the optional per-row Uint8 facade style
 * from the bake, `roofs` the optional per-row roof shape (ROOF). Each vertex also carries `aFacade`, two Uint16: the distance along the wall in
 * decimetres (65535 on a roof) and the height above the base in decimetres plus 4096 x style (0..15). On a roof vertex the low bits are free: bit 10
 * marks a pitched roof and bits 0..9 are the ridge's rise in decimetres, which World detail Off takes out in the vertex shader (the roof is flat
 * again). It is all derived here, so nothing extra travels on the wire. Pitched roofs add two vertices and two triangles per house; `extra` counts them. */
export function deriveBuildingMeshes(t, m, styles = null, roofs = null) {
  const groups = new Map(), landmarkGroups = new Map(), rooftops = [], extra = { vertices: 0, indices: 0, rings: [], infos: [] }, ox = m.origin?.[0] ?? 0, oz = m.origin?.[2] ?? 0;
  for (let row = 0; row < t.buildings.length / 4; row++) {
    const first = t.buildings[row * 4 + 1], n = t.buildings[row * 4 + 2], material = t.buildings[row * 4 + 3];
    const base = t.buildingHeights[row * 2], top = base + t.buildingHeights[row * 2 + 1];
    let ring = Array.from({ length: n }, (_, k) => [t.buildingCorners[(first + k) * 2], t.buildingCorners[(first + k) * 2 + 1]]);
    // The existing Psychiko detail recipe draws these exact shells and their tiled roofs.
    // Keep the same footprints in the worker's collision/tree exclusions, without a second facade/roof.
    if (m.ids?.[t.buildings[row * 4]]?.startsWith('building:psychiko:')) { extra.rings.push(ring); continue; }
    let area = 0; for (let k = 0; k < n; k++) { const a = ring[k], b = ring[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) ring = ring.reverse();
    // A building a landmark model replaces (LANDMARK_HIDDEN) is kept, but in its own meshes that the scene hides while World detail is on.
    const id = m.ids?.[t.buildings[row * 4]], hash = idHash(id), target = LANDMARK_HIDDEN.has(osmBuildingId(id)) ? landmarkGroups : groups;
    if (!target.has(material)) target.set(material, []);
    const height = top - base, centre = ring.reduce((c, p) => [c[0] + p[0] / n, c[1] + p[1] / n], [0, 0]), quarter = inOldQuarter(ox + centre[0], oz + centre[1]), stored = roofs ? roofs[row] : 0;
    const roof = target === groups ? roofFor(ring, height, hash, quarter, stored) : null;
    if (roof) { extra.vertices += 22 - 5 * n; extra.indices += 3 * (PITCHED_TRIANGLES - buildingTriangleCount(n)); }
    if (target === groups && !roof && rooftops.length < ROOFTOP_LIMIT * 5) for (const r of rooftopKit(ring, height, hash, Math.abs(area) / 2)) rooftops.push(r.x, top, r.z, r.yaw, r.code);
    const style = richStyleFor(facadeStyleFor(styles ? styles[row] : 0, height, hash), height, hash, quarter, stored === ROOF.historic);
    if (target === groups) { extra.rings.push(ring); extra.infos.push({ ring, base, top, style, hash, quarter }); }
    target.get(material).push({ ring, base, top, roof, pal: m.inferredCoastal ? (hash%4===0?2:0) : paletteFor(hash, quarter), style });
  }
  const arrays = [], meshes = [];
  const batches = [...[...groups.keys()].sort((a, b) => a - b).map(material => [material, groups.get(material), false]), ...[...landmarkGroups.keys()].sort((a, b) => a - b).map(material => [material, landmarkGroups.get(material), true])];
  for (const [material, pieces, landmarkBox] of batches) {
    let chunk = [], tris = 0, verts = 0;
    const flush = () => {
      if (!chunk.length) return;
      const position = new Float32Array(verts * 3), facade = new Uint16Array(verts * 2), index = new Uint16Array(tris * 3);
      let v = 0, ix = 0;
      const vertex = (x, y, z, u, w) => { position[v * 3] = x; position[v * 3 + 1] = y; position[v * 3 + 2] = z; facade[v * 2] = u; facade[v * 2 + 1] = w; return v++; };
      for (const { ring, base, top, style, roof, pal } of chunk) {
        const n = ring.length, high = Math.min(1023, Math.round((top - base) * 10)), roofTag = style * 4096, tag = roofTag + pal * 1024; let along = 0;
        for (let k = 0; k < n; k++) {
          const a = ring[k], b = ring[(k + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
          const u0 = Math.min(65534, Math.round(along * 10)), u1 = Math.min(65534, Math.round((along + length) * 10)); along += length;
          const a0 = vertex(a[0], base, a[1], u0, tag), a1 = vertex(a[0], top, a[1], u0, tag + high), b0 = vertex(b[0], base, b[1], u1, tag), b1 = vertex(b[0], top, b[1], u1, tag + high);
          index.set([a0, a1, b0, b0, a1, b1], ix); ix += 6;
        }
        if (!roof) {
          const flat = ring.map(p => vertex(p[0], top, p[1], 65535, roofTag));
          for (const [a, b, c] of earClip(ring)) { index.set([flat[a], flat[c], flat[b]], ix); ix += 3; }
        } else {
          // hipped roof: four eave corners at the wall top, a ridge `rise` higher along the long axis (a pyramid on a square)
          const { p, l, s } = roof.rect, m1 = [(p[3][0] + p[0][0]) / 2, (p[3][1] + p[0][1]) / 2], m2 = [(p[1][0] + p[2][0]) / 2, (p[1][1] + p[2][1]) / 2], c = [(m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2];
          const d = sub(m2, m1), dl = len(d) || 1, half = Math.max(0, (l - s) / 2), rise = Math.round(roof.rise * 10), pitched = roofTag + 1024;
          const eave = p.map(q => vertex(q[0], top, q[1], 65535, pitched)), P = vertex(c[0] - d[0] / dl * half, top + rise / 10, c[1] - d[1] / dl * half, 65535, pitched + rise), Q = vertex(c[0] + d[0] / dl * half, top + rise / 10, c[1] + d[1] / dl * half, 65535, pitched + rise);
          const at = i => [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]];
          for (const [a, b, c2] of [[eave[0], eave[1], Q], [eave[0], Q, P], [eave[2], eave[3], P], [eave[2], P, Q], [eave[3], eave[0], P], [eave[1], eave[2], Q]]) {
            const A = at(a), B = at(b), C = at(c2), nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]), ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
            void nx; void nz; index.set(ny >= 0 ? [a, b, c2] : [a, c2, b], ix); ix += 3;
          }
        }
      }
      const pi = arrays.push(position) - 1, fi = arrays.push(facade) - 1, ii = arrays.push(index) - 1;
      meshes.push({ name: 'probe', material, attributes: { position: { array: pi, itemSize: 3, normalized: false }, aFacade: { array: fi, itemSize: 2, normalized: false } }, index: ii, userData: landmarkBox ? { worldSurface: false, tileSurface: 'building', landmarkBox: true } : { worldSurface: false, tileSurface: 'building' }, layers: 1, drawRange: { start: 0, count: index.length } });
      chunk = []; tris = 0; verts = 0;
    };
    for (const piece of pieces) {
      const t3 = pieceTriangles(piece), v = pieceVertices(piece);
      if (chunk.length && (tris + t3 > BUILDING_MESH_TRIANGLES || verts + v > MAX_VERTICES)) flush();
      chunk.push(piece); tris += t3; verts += v;
    }
    flush();
  }
  extra.rooftops = new Float32Array(rooftops.slice(0, ROOFTOP_LIMIT * 5));
  return { arrays, meshes, extra };
}
/** Append the derived building meshes to a decoded pack (arrays after the wire arrays, meshes after the wire meshes). */
export function addDerivedBuildings(pack, tables) {
  const flag = pack.metadata.extensions?.derivedBuildings;
  if (!flag || flag.derived) return pack;
  const wd = pack.metadata.extensions?.worldDetail?.buildings, styleIndex = wd?.facadeStyle, roofIndex = wd?.roofShape;
  const psychiko=psychikoMappedBuildings(tables,pack.metadata),recipe=coastalRecipe(pack.metadata.cell),mapped=coastalMappedBuildings(psychiko.tables,pack.metadata,recipe),sourceRows=mapped.rows.map(i=>psychiko.rows[i]),styles=styleIndex==null?null:Uint8Array.from(sourceRows.map(i=>i<0?0:pack.arrays[styleIndex][i])),roofs=roofIndex==null?null:Uint8Array.from(sourceRows.map(i=>i<0?0:pack.arrays[roofIndex][i]));
  const { arrays, meshes, extra } = deriveBuildingMeshes(mapped.tables,pack.metadata,styles,roofs),offset=pack.arrays.length;
  if(mapped.removed||psychiko.removed||pack.metadata.psychikoShells?.length)pack.coastalObstacleTables=mapped.tables;
  const infill=coastalInfillTables(mapped.tables,recipe);
  const houses=deriveBuildingMeshes(infill,{...pack.metadata,ids:infill.ids,inferredCoastal:true},new Uint8Array(infill.ids.length).fill(2),new Uint8Array(infill.ids.map((_,i)=>i%2?1:3)));
  extra.rings.push(...houses.extra.rings);
  const ox = pack.metadata.origin?.[0] ?? 0, oz = pack.metadata.origin?.[2] ?? 0;
  const detail=pack.metadata.extensions?.worldDetail, occupiedTrees=[];
  for(const [index,stride]of [[detail?.props?.rows,5],[detail?.signals?.rows,6]])if(index!=null){const rows=pack.arrays[index];for(let i=0;i<rows.length;i+=stride)occupiedTrees.push([rows[i],rows[i+2]]);}
  const pavedGroundTriangles=new Uint8Array(tables.fineTriangles.length/3);
  for(const mesh of pack.metadata.meshes)if(mesh.userData?.tileSurface==='urban'&&pack.arrays[mesh.index]===tables.fineTriangles){const first=(mesh.drawRange?.start??0)/3,last=first+(mesh.drawRange?.count??tables.fineTriangles.length)/3;pavedGroundTriangles.fill(1,first,last);}
  const trees = clearCoastalStreetTrees(tables,deriveStreetTrees(tables,extra.rings,(x,z)=>inOldQuarter(ox+x,oz+z),{
    pavedGroundTriangles,setbacks:!recipe,landSurfaceIds:new Set(pack.metadata.ids.flatMap((id,i)=>id.startsWith('terrain:')?[i]:[])),
    blocked:(x,z,r)=>occupiedTrees.some(([px,pz])=>Math.hypot(px-x,pz-z)<r+2)||psychikoInfillBlocked([[x-r+ox,z-r+oz],[x+r+ox,z-r+oz],[x+r+ox,z+r+oz],[x-r+ox,z+r+oz]]),
  }),recipe);
  const coast=coastalRows(tables,extra.rings,coastalRecipe(pack.metadata.cell),trees,pack.arrays[pack.metadata.extensions?.worldDetail?.coastalTreeOccupancy??pack.metadata.extensions?.worldDetail?.vegetation?.positionHeight],pack.metadata.cell,pack.metadata.coastalLakes);
  const allTrees=new Float32Array(trees.length+coast.trees.length);allTrees.set(trees);allTrees.set(coast.trees,trees.length);
  const inQuarter = (x, z) => inOldQuarter(ox + x, oz + z), propsExt = pack.metadata.extensions?.worldDetail?.props, occupied = [];
  if (propsExt) { const rows = pack.arrays[propsExt.rows]; for (let i = 0; i < rows.length; i += 5) occupied.push(rows[i], rows[i + 2]); } // the bake's own props (parked cars, kiosks, benches...) keep their places
  // Collision-bearing parking keeps its original proposal inputs. Changing
  // visual foliage must not move parked cars or alter their collision walls.
  const parkingTrees=recipe?allTrees:deriveLegacyStreetTreeSeeds(tables,extra.rings,inQuarter);
  const parking = deriveParking(tables, extra.rings, inQuarter, occupied, parkingTrees);
  const propsKinds = propsExt ? pack.arrays[propsExt.kind] : null, art = deriveStreetArt(tables, pack.metadata, extra.infos, { ox, oz, propsRows: propsExt ? pack.arrays[propsExt.rows] : null, propsKinds });
  extra.infos.length = 0;
  pack.derivedExtraBytes = extra.vertices * 16 * 2 + extra.indices * 2 * 2 + (extra.rooftops.byteLength + allTrees.byteLength + coast.boats.byteLength + parking.byteLength + art.plates.byteLength + art.shops.byteLength + art.walls.byteLength + art.marks.byteLength) * 6 + art.plateNames.reduce((n, x) => n + x.length * 2 + 40, 0) + parking.length / 5 * 4 * 40; // + four collision walls per car or scooter // pitched roofs: CPU copy and GPU copy of the added vertices and indices; the rooftop rows and the prop records made from them
  for (const a of arrays) pack.arrays.push(a);
  const wdExt = recipe?{coastalTreeCount:coast.trees.length/5,replacedBasinInfill:mapped.removed}:{};
  if (extra.rooftops.length) { pack.arrays.push(extra.rooftops); wdExt.rooftops = pack.arrays.length - 1; }
  if (allTrees.length) { pack.arrays.push(allTrees); wdExt.streetTrees = pack.arrays.length - 1; }
  if(coast.boats.length){pack.arrays.push(coast.boats);wdExt.coastalBoats=pack.arrays.length-1;}
  if (parking.length) { pack.arrays.push(parking); wdExt.parking = pack.arrays.length - 1; }
  for (const [key, rows] of [['streetPlates', art.plates], ['shopSites', art.shops], ['wallSites', art.walls], ['roadMarks', art.marks]]) if (rows.length) { pack.arrays.push(rows); wdExt[key] = pack.arrays.length - 1; }
  if (art.plateNames.length) wdExt.plateNames = art.plateNames;
  if (Object.keys(wdExt).length) pack.metadata.extensions = { ...pack.metadata.extensions, worldDetail: { ...pack.metadata.extensions?.worldDetail, ...wdExt } };
  for (const mesh of meshes) {
    for (const a of Object.values(mesh.attributes)) a.array += offset;
    mesh.index += offset; pack.metadata.meshes.push(mesh);
  }
  if(infill.ids.length){
    const at=pack.arrays.length;pack.arrays.push(...houses.arrays);
    for(const mesh of houses.meshes){for(const a of Object.values(mesh.attributes))a.array+=at;mesh.index+=at;mesh.userData.tileSurface='coastalBuilding';pack.metadata.meshes.push(mesh);}
    pack.derivedExtraBytes+=houses.arrays.reduce((n,a)=>n+2*a.byteLength,0);
    pack.metadata.extensions.worldDetail.inferredHouses=infill.ids.length;
  }
  const coastalWalls=coast.surfaces.flatMap(s=>s.boxes||[]);
  if(infill.ids.length||coastalWalls.length){pack.detailObstacleIndex=buildTileObstacleIndex(infill,coastalWalls);pack.derivedExtraBytes+=obstacleBytes(pack.detailObstacleIndex);}
  pack.derivedExtraBytes+=appendCoastalSurfaces(pack,coast.surfaces)+dressCoastalGround(pack,tables,coastalRecipe(pack.metadata.cell));
  pack.metadata.extensions = { ...pack.metadata.extensions, derivedBuildings: { ...flag, derived: true } };
  return pack;
}
