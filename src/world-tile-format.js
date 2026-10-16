// AWT/1 describes world data; ASR1/ASR2 remains owned by baked-geometry.js.
export const TILE_VERSION = 1;
export const TILE_METRES = 512;
export const TILE_TABLES = Object.freeze({
  nodes: ['Uint32Array', 2], nodePositions: ['Float32Array', 3],
  edges: ['Uint32Array', 10], edgePoints: ['Float32Array', 3], edgeLayers: ['Int8Array', 1],
  turns: ['Uint32Array', 4], ribbons: ['Uint32Array', 5], ribbonVertices: ['Float32Array', 5],
  junctions: ['Uint32Array', 5], junctionVertices: ['Float32Array', 3], markings: ['Float32Array', 7],
  contactPositions: ['Float32Array', 3], contactTriangles: ['Uint32Array', 5], contactLayers: ['Int8Array', 1],
  coarseHeights: ['Float32Array', 1], finePositions: ['Float32Array', 3], fineTriangles: ['Uint32Array', 3],
  buildings: ['Uint32Array', 4], buildingCorners: ['Float32Array', 2], buildingHeights: ['Float32Array', 2],
  signs: ['Uint32Array', 4], signTransforms: ['Float32Array', 5],
  anchors: ['Uint32Array', 5], anchorTransforms: ['Float32Array', 4],
});
const fail = message => { throw new Error(`AWT/1: ${message}`); };
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const idPattern = /^[a-z0-9][a-z0-9:._/-]*$/i;
export function tileKey(x, z) { return `${Math.floor(x / TILE_METRES)},${Math.floor(z / TILE_METRES)}`; }
export function tileTables(pack) {
  return Object.fromEntries(Object.keys(TILE_TABLES).map(k => [k, pack.arrays[pack.metadata.tables[k]]]));
}
/** Reject malformed data before any three.js or physics resources are allocated. */
export function validateWorldTile(pack, expected = {}) {
  const m = pack?.metadata, arrays = pack?.arrays;
  if (!m || !Array.isArray(arrays) || m.tileVersion !== TILE_VERSION) fail('unsupported tileVersion');
  if (typeof m.world !== 'string' || !m.world || typeof m.revision !== 'string' || !m.revision) fail('world/revision required');
  for (const key of ['world', 'revision']) if (expected[key] != null && expected[key] !== m[key]) fail(`${key} mismatch`);
  if (!Array.isArray(m.cell) || m.cell.length !== 2 || !m.cell.every(Number.isSafeInteger)) fail('cell');
  if (expected.cell && expected.cell.some((v, i) => v !== m.cell[i])) fail('cell mismatch');
  if (!Array.isArray(m.origin) || m.origin.length !== 3 || m.origin[0] !== m.cell[0] * TILE_METRES || m.origin[1] !== 0 || m.origin[2] !== m.cell[1] * TILE_METRES) fail('origin');
  if (!Array.isArray(m.ids) || m.ids[0] !== '' || m.ids.slice(1).some(id => typeof id !== 'string' || !idPattern.test(id)) || new Set(m.ids).size !== m.ids.length) fail('ids');
  if (!Array.isArray(m.strings) || m.strings[0] !== '' || m.strings.some(s => typeof s !== 'string')) fail('strings');
  if (!Array.isArray(m.palette) || !m.palette.length || m.palette.length > 256 || m.palette.some(c => !Array.isArray(c) || c.length !== 3 || c.some(v => !Number.isFinite(v) || v < 0 || v > 1))) fail('palette');
  if (!m.tables || Object.keys(TILE_TABLES).some(k => !integer(m.tables[k]) || !arrays[m.tables[k]])) fail('tables');
  const t = tileTables(pack), count = k => t[k].length / TILE_TABLES[k][1];
  for (const [k, [type, stride]] of Object.entries(TILE_TABLES)) {
    const a = t[k];
    if (a.constructor.name !== type || a.length % stride) fail(`table ${k} type/stride`);
    if (type === 'Float32Array') for (const v of a) if (!Number.isFinite(v)) fail(`table ${k} nonfinite`);
  }
  const ref = (v, n, label, nonzero = false) => { if (!integer(v) || v >= n || (nonzero && !v)) fail(label); };
  const id = (v, label) => ref(v, m.ids.length, label, true);
  const span = (first, size, n, label, min = 0) => { if (!integer(first) || !integer(size, min) || first + size > n) fail(label); };
  const unique = (k, stride) => { const seen = new Set(); for (let i = 0; i < t[k].length; i += stride) { const v = t[k][i]; id(v, `${k} id`); if (seen.has(v)) fail(`${k} duplicate id`); seen.add(v); } };
  for (const [k, stride] of [['nodes', 2], ['edges', 10], ['buildings', 4], ['signs', 4], ['anchors', 5]]) unique(k, stride);
  for (let i = 0; i < t.nodes.length; i += 2) ref(t.nodes[i + 1], count('nodePositions'), 'node position');
  if (count('edgeLayers') !== count('edges') || count('contactLayers') !== count('contactTriangles')) fail('layer row count');
  for (let i = 0; i < t.edges.length; i += 10) {
    const a = t.edges; id(a[i+1], 'from node'); id(a[i+2], 'to node'); span(a[i+3], a[i+4], count('edgePoints'), 'edge points', 2);
    ref(a[i+5], m.strings.length, 'edge name'); if (a[i+6] > 32 || a[i+7] > 400 || a[i+8] > 31) fail('edge attributes'); id(a[i+9], 'edge surface');
  }
  for (let i = 0; i < t.turns.length; i += 4) { for (let j = 0; j < 3; j++) id(t.turns[i+j], 'turn id'); if (t.turns[i+3] > 2) fail('turn rule'); }
  for (const [k, vertices] of [['ribbons', 'ribbonVertices'], ['junctions', 'junctionVertices']]) for (let i = 0; i < t[k].length; i += 5) {
    id(t[k][i], 'surface'); id(t[k][i+1], 'road/node'); span(t[k][i+2], t[k][i+3], count(vertices), k, 3); ref(t[k][i+4], m.palette.length, 'material'); if (k === 'ribbons' && t[k][i+3] % 3) fail('ribbon triangle list');
  }
  for (let i = 0; i < t.markings.length; i += 7) { id(t.markings[i], 'marking edge'); if (t.markings[i] >= 2**24 || t.markings[i+2] < t.markings[i+1] || t.markings[i+4] <= 0 || t.markings[i+5] < 0 || t.markings[i+6] < 0) fail('marking'); }
  for (const [k, vertices, stride] of [['contactTriangles', 'contactPositions', 5], ['fineTriangles', 'finePositions', 3]]) for (let i = 0; i < t[k].length; i += stride) {
    for (let j = 0; j < 3; j++) ref(t[k][i+j], count(vertices), `${k} vertex`);
    if (stride === 5) { id(t[k][i+3], 'contact surface'); if (t[k][i+4] > 15) fail('contact flags'); }
  }
  if (m.terrain?.coarseSize !== 33 || m.terrain?.spacing !== 16 || t.coarseHeights.length !== 1089) fail('coarse terrain');
  for (const [k, stride] of [['nodePositions',3], ['edgePoints',3], ['ribbonVertices',5], ['junctionVertices',3], ['contactPositions',3], ['finePositions',3]]) for (let i = 0; i < t[k].length; i += stride) {
    const z = stride === 2 ? 1 : 2;
    if (t[k][i] < 0 || t[k][i] > TILE_METRES || t[k][i+z] < 0 || t[k][i+z] > TILE_METRES) fail(`${k} outside tile`);
  }
  if (count('buildingHeights') !== count('buildings')) fail('building height count');
  for (let i = 0, row = 0; i < t.buildings.length; i += 4, row++) {
    span(t.buildings[i+1], t.buildings[i+2], count('buildingCorners'), 'building corners', 4);
    if (t.buildings[i+2] > 14 || t.buildingHeights[row*2+1] <= 0) fail('building budget/height'); ref(t.buildings[i+3], m.palette.length, 'building colour');
  }
  for (const [k, transforms, stride, maxKind] of [['signs', 'signTransforms', 4, 2], ['anchors', 'anchorTransforms', 5, 3]]) for (let i = 0; i < t[k].length; i += stride) {
    ref(t[k][i+1], count(transforms), `${k} transform`);
    if (k === 'anchors') id(t[k][i+2], 'anchor edge');
    if (t[k][i+stride-2] > maxKind) fail(`${k} kind`); ref(t[k][i+stride-1], m.strings.length, `${k} text`);
  }
  if (!m.budgets || !integer(m.budgets.triangles) || !integer(m.budgets.buildingTriangles) || m.budgets.buildingTriangles > 40) fail('triangle budgets');
  if (!Array.isArray(m.meshes)) fail('meshes');
  let triangles = 0;
  for (const mesh of m.meshes) {
    if (!mesh.attributes?.position || !integer(mesh.material) || mesh.material >= m.palette.length) fail('mesh');
    let vertices;
    for (const [name, a] of Object.entries(mesh.attributes)) {
      if (!integer(a.array) || !arrays[a.array] || !integer(a.itemSize, 1) || arrays[a.array].length % a.itemSize) fail('mesh attribute');
      const n = arrays[a.array].length / a.itemSize; if (name === 'position') { if (a.itemSize !== 3) fail('position stride'); vertices = n; }
    }
    if (vertices > 65535) fail('mesh vertex budget');
    let indices = vertices;
    if (mesh.index != null) {
      const index = arrays[mesh.index]; if (!index || !['Uint16Array','Uint32Array'].includes(index.constructor.name)) fail('mesh index');
      for (const v of index) ref(v, vertices, 'mesh vertex'); indices = index.length;
    }
    if (indices % 3 || indices / 3 > 16384) fail('mesh triangle budget'); triangles += indices / 3;
  }
  if (triangles !== m.budgets.triangles) fail('triangle accounting');
  return { metadata: m, arrays, tables: t, bytes: residentArrayBytes(arrays), triangles };
}
/** Underlying buffers, rather than views, determine retained heap. */
export function residentArrayBytes(arrays) { return [...new Set(arrays.map(a => a.buffer))].reduce((n, b) => n + b.byteLength, 0); }
export function validateWorldManifest(m) {
  if (!m || m.tileVersion !== 1 || m.tileMetres !== TILE_METRES || typeof m.world !== 'string' || !m.world || typeof m.revision !== 'string' || !m.revision || !m.tiles || !m.spawn) fail('manifest');
  for (const k of ['lat0','lon0','mlat','mlon']) if (!Number.isFinite(m.projection?.[k])) fail('projection');
  for (const [key, entry] of Object.entries(m.tiles)) {
    if (!/^-?\d+,-?\d+$/.test(key) || key.split(',').some(v => !Number.isSafeInteger(Number(v)))) fail('tile key');
    if (typeof entry.url !== 'string' || !entry.url || !/^[a-f0-9]{64}$/.test(entry.sha256) || !integer(entry.bytes,1) || entry.bytes > 25*1024*1024 || !integer(entry.decodedBytes,1) || !integer(entry.triangles)) fail(`entry ${key}`);
    if (!Array.isArray(entry.dependencies) || entry.dependencies.some(d => d === key || !m.tiles[d])) fail(`dependencies ${key}`);
    if (entry.range && (!integer(entry.range.offset) || !integer(entry.range.length,1) || entry.range.length !== entry.bytes || entry.range.offset + entry.range.length > 25*1024*1024)) fail('range');
  }
  if (!Array.isArray(m.spawn.cell) || m.spawn.cell.length !== 2 || !m.spawn.cell.every(Number.isSafeInteger) || !m.tiles[m.spawn.cell.join(',')] || typeof m.spawn.anchor !== 'string') fail('spawn');
  return m;
}
/** Canonical edge strings are small relative to a pack; CLI hashes and discards them per tile. */
export function tileEdgeSignatures(pack) {
  const m = pack.metadata, t = tileTables(pack);
  const number = v => Object.is(v, -0) ? '-0' : String(v);
  return [0,1,2,3].map(side => {
    const axis = side < 2 ? 0 : 2, value = (side % 2) * TILE_METRES, samples = new Set();
    for (const name of ['finePositions','contactPositions']) {
      const p = t[name];
      for (let i=0;i<p.length;i+=3) if (p[i+axis] === value) samples.add(`${name}:${number(p[i]+m.origin[0])},${number(p[i+2]+m.origin[2])},${number(p[i+1])}`);
    }
    const heights = [];
    for (let i=0;i<33;i++) heights.push(number(t.coarseHeights[side<2 ? i*33+(side%2)*32 : (side%2)*32*33+i]));
    return JSON.stringify([heights,[...samples].sort()]);
  });
}
/** Compare all canonical terrain/contact samples on the common edge, including missing vertices. */
export function validateTileSeam(a, b) {
  const am = a.metadata, bm = b.metadata, dx = bm.cell[0]-am.cell[0], dz = bm.cell[1]-am.cell[1];
  if (am.world !== bm.world || am.revision !== bm.revision || Math.abs(dx)+Math.abs(dz) !== 1) fail('seam neighbours');
  const at = tileTables(a), bt = tileTables(b);
  const boundary = (m, t, side) => {
    const samples = new Set(), axis = dx ? 0 : 2, boundaryValue = side * TILE_METRES;
    for (const name of ['finePositions', 'contactPositions']) {
      const p = t[name]; for (let i = 0; i < p.length; i += 3) if (p[i+axis] === boundaryValue) samples.add(`${name}:${p[i]+m.origin[0]},${p[i+2]+m.origin[2]},${p[i+1]}`);
    }
    const edge = [];
    for (let i = 0; i < 33; i++) edge.push(t.coarseHeights[dx ? i*33+side*32 : side*32*33+i]);
    return { samples, edge };
  };
  const av = boundary(am,at,dx+dz>0?1:0), bv = boundary(bm,bt,dx+dz>0?0:1);
  if (av.edge.some((v,i) => !Object.is(v,bv.edge[i])) || av.samples.size !== bv.samples.size || [...av.samples].some(v => !bv.samples.has(v))) fail('cracked seam');
  return true;
}
