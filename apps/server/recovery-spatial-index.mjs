// Build-local broad phase only: every candidate still runs the original road
// contact, surface, footprint, height, polygon and clearance predicates.
const BIN = 32;
const MAX_BUILDING_BINS = 4096;

export function accelerateRecoveryWorld(world) {
  const roads = world.roads;
  if (roads.__recoverySpatialIndex) return world;
  const connected = roads.connected, safe = roads.safe, connectedCache = new Map();
  const buildRevision = roads.graph.revision;
  let revision = buildRevision;
  roads.connected = function (edge) {
    if (revision !== roads.graph.revision) { connectedCache.clear(); revision = roads.graph.revision; }
    if (!connectedCache.has(edge)) connectedCache.set(edge, new Map(connected.call(roads, edge)));
    // Original safe() augments this result with point.surfaceId.
    return new Map(connectedCache.get(edge));
  };

  const tiles = [...roads.stream.tiles.values()].filter(tile => tile.state === 'active');
  const bins = new Map(), unindexed = [], entries = [];
  for (const [tileIndex, tile] of tiles.entries()) {
    const { tables, metadata } = tile.packet;
    for (let offset = 0; offset < tables.buildings.length; offset += 4) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let row = tables.buildings[offset + 1]; row < tables.buildings[offset + 1] + tables.buildings[offset + 2]; row++) {
        const x = tables.buildingCorners[row * 2] + metadata.origin[0], z = tables.buildingCorners[row * 2 + 1] + metadata.origin[2];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const entry = { tileIndex, offset, minX, maxX, minZ, maxZ, order: entries.length };
      entries.push(entry);
      const x0 = Math.floor(minX / BIN), x1 = Math.floor(maxX / BIN), z0 = Math.floor(minZ / BIN), z1 = Math.floor(maxZ / BIN);
      if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || (x1 - x0 + 1) * (z1 - z0 + 1) > MAX_BUILDING_BINS) { unindexed.push(entry); continue; }
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = x + ',' + z; if (!bins.has(key)) bins.set(key, []); bins.get(key).push(entry);
      }
    }
  }

  roads.safe = function (point, options = {}) {
    const { halfWidth = 1, halfLength = 2.5, clearance = .15 } = options;
    if (roads.graph.revision !== buildRevision) return safe.call(roads, point, options);
    if (![point.x, point.z, point.yaw, halfWidth, halfLength, clearance].every(Number.isFinite) || halfWidth < 0 || halfLength < 0) return safe.call(roads, point, options);
    const sin = Math.sin(point.yaw), cos = Math.cos(point.yaw), corners = [];
    for (const along of [-halfLength, halfLength]) for (const across of [-halfWidth, halfWidth]) corners.push([point.x - sin * along + cos * across, point.z - cos * along - sin * across]);
    // A small outward numerical pad keeps this filter conservative at boundaries.
    const padding = Math.max(0, clearance) + 1e-6;
    const minX = Math.min(...corners.map(p => p[0])) - padding, maxX = Math.max(...corners.map(p => p[0])) + padding;
    const minZ = Math.min(...corners.map(p => p[1])) - padding, maxZ = Math.max(...corners.map(p => p[1])) + padding;
    const x0 = Math.floor(minX / BIN), x1 = Math.floor(maxX / BIN), z0 = Math.floor(minZ / BIN), z1 = Math.floor(maxZ / BIN);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_BUILDING_BINS) return safe.call(roads, point, options);
    const found = new Set(unindexed);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (const entry of bins.get(x + ',' + z) || []) {
      if (entry.maxX >= minX && entry.minX <= maxX && entry.maxZ >= minZ && entry.minZ <= maxZ) found.add(entry);
    }
    const grouped = new Map();
    for (const entry of [...found].sort((a, b) => a.order - b.order)) {
      if (!grouped.has(entry.tileIndex)) grouped.set(entry.tileIndex, []); grouped.get(entry.tileIndex).push(entry.offset);
    }
    const candidates = [];
    for (const [tileIndex, offsets] of grouped) {
      const tile = tiles[tileIndex], tables = tile.packet.tables;
      const buildings = new tables.buildings.constructor(offsets.length * 4), heights = new tables.buildingHeights.constructor(offsets.length * 2);
      offsets.forEach((offset, row) => { buildings.set(tables.buildings.subarray(offset, offset + 4), row * 4); heights.set(tables.buildingHeights.subarray(offset / 2, offset / 2 + 2), row * 2); });
      candidates.push({ ...tile, packet: { ...tile.packet, tables: { ...tables, buildings, buildingHeights: heights } } });
    }
    const view = Object.create(roads);
    // contact() remains bound to the original full nine-cell world. Only the
    // building iteration in the original safe predicate sees filtered tables.
    view.stream = Object.assign(Object.create(roads.stream), { contact: roads.stream.contact.bind(roads.stream), tiles: { values: () => candidates.values() } });
    return safe.call(view, point, options);
  };
  Object.defineProperty(roads, '__recoverySpatialIndex', { value: true });
  return world;
}
