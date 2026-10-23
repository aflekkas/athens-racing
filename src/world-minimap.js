// The driving map must not depend on the physics/render cell residency radius.
// Reuse the published world's street overview and the existing OSM coastline;
// no external tiles, extra world cells, or new map assets are needed.
import { MAP_ASSETS, MAP_LABELS } from './attica-map-data.js';
import { athensFromAttica, athensFromLonLat, atticaFromAthens, ATHENS_DISTRICTS, decodeSpawnRoads } from './spawn-spots.js';

export const MAP_CELL = 512;
export const intersectsMapView = (box, x, z, radius) => box[0] <= x + radius && box[2] >= x - radius && box[1] <= z + radius && box[3] >= z - radius;

/** Index whole lines by every intersected cell, including segments whose ends lie outside the view. */
export function indexMapRoads(roads, makePath = () => new Path2D()) {
  const cells = new Map();
  for (const road of roads) {
    const path = makePath(), box = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < road.pts.length; i += 2) {
      const [x, z] = athensFromAttica(road.pts[i], road.pts[i + 1]);
      if (i) path.lineTo(x, z); else path.moveTo(x, z);
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], z); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], z);
    }
    const item = { path, box, major: road.major };
    for (let x = Math.floor(box[0] / MAP_CELL); x <= Math.floor(box[2] / MAP_CELL); x++) for (let z = Math.floor(box[1] / MAP_CELL); z <= Math.floor(box[3] / MAP_CELL); z++) {
      const key = `${x},${z}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(item);
    }
  }
  return cells;
}
export function visibleMapRoads(cells, x, z, radius) {
  const found = new Set();
  for (let i = Math.floor((x - radius) / MAP_CELL); i <= Math.floor((x + radius) / MAP_CELL); i++) for (let j = Math.floor((z - radius) / MAP_CELL); j <= Math.floor((z + radius) / MAP_CELL); j++) {
    for (const item of cells.get(`${i},${j}`) || []) if (intersectsMapView(item.box, x, z, radius)) found.add(item);
  }
  return found;
}
function coastPaths(buffer) {
  const v = new DataView(buffer), land = new Path2D(), coast = new Path2D(); let at = 6;
  for (let layer = 0; layer < v.getUint16(4, true); layer++) {
    const id = MAP_ASSETS.layers[v.getUint8(at)], count = v.getUint32(at + 1, true); at += 5;
    for (let line = 0; line < count; line++) {
      const n = v.getUint16(at, true); at += 2;
      const path = id === 'land' ? land : id === 'coast' ? coast : null;
      for (let p = 0; p < n; p++, at += 4) if (path) {
        const [x, z] = athensFromAttica(v.getUint16(at, true) / MAP_ASSETS.quantize, v.getUint16(at + 2, true) / MAP_ASSETS.quantize);
        if (p) path.lineTo(x, z); else path.moveTo(x, z);
      }
      if (id === 'land') land.closePath();
    }
  }
  return { land, coast };
}
async function streetIndex(json, near) {
  const roads = decodeSpawnRoads(json).athens.roads, cells = new Map(), [ax, az] = atticaFromAthens(near.x, near.z);
  // Make this neighbourhood usable first, rather than waiting for the whole city.
  const distance = road => (road.pts[0] - ax) ** 2 + (road.pts[1] - az) ** 2;
  roads.sort((a, b) => distance(a) - distance(b));
  base.roads = cells;
  // Parsing the city must not hold a driving frame while creating every path.
  for (let i = 0; i < roads.length; i += 750) {
    for (const [key, batch] of indexMapRoads(roads.slice(i, i + 750))) {
      if (cells.has(key)) cells.get(key).push(...batch); else cells.set(key, batch);
    }
    streetView = null;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return cells;
}
let base = { roads: new Map() }, complete = false, pending, retryAt = 0, streetView;
function streetPaths(cells, x, z, radius) {
  const bounds = [Math.floor((x - radius) / MAP_CELL), Math.floor((z - radius) / MAP_CELL), Math.floor((x + radius) / MAP_CELL), Math.floor((z + radius) / MAP_CELL)];
  const key = bounds.join(',');
  if (streetView?.key === key) return streetView.paths;
  const found = new Set(), paths = [new Path2D(), new Path2D()];
  for (let i = bounds[0]; i <= bounds[2]; i++) for (let j = bounds[1]; j <= bounds[3]; j++) for (const item of cells.get(`${i},${j}`) || []) found.add(item);
  for (const item of found) paths[item.major ? 1 : 0].addPath(item.path);
  streetView = { key, paths }; return paths;
}
const read = async url => { const r = await fetch(url); if (!r.ok) throw Error(`Map layer ${r.status}`); return r; };
function loadBase(near) {
  if (complete || pending || performance.now() < retryAt) return;
  pending = Promise.all([
    read('assets/athens/streets.json').then(r => r.json()).then(json => streetIndex(json, near)),
    read(MAP_ASSETS.vectors).then(r => r.arrayBuffer()).then(coastPaths).then(coast => { Object.assign(base, coast); }),
  ]).then(() => { complete = true; }).catch(() => { retryAt = performance.now() + 15000; }).finally(() => { pending = null; });
}
export function drawWorldMapBase(g, st, radius, scale) {
  loadBase(st);
  g.fillStyle = base.land ? '#18313d' : '#202c30'; g.fillRect(st.x - radius, st.z - radius, radius * 2, radius * 2);
  if (base.land) {
    g.fillStyle = '#202c30'; g.fill(base.land, 'evenodd');
    g.strokeStyle = '#547985'; g.lineWidth = 1.3 / scale; g.stroke(base.coast);
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const [minor, major] = streetPaths(base.roads, st.x, st.z, radius);
  g.strokeStyle = '#657477'; g.lineWidth = 1.4 / scale; g.stroke(minor);
  g.strokeStyle = '#8e9999'; g.lineWidth = 2.2 / scale; g.stroke(major);
}
// A UI heuristic, not a surveyed boundary: every playable route today stays within 4.7 km of a listed place.
export const PLACE_LABEL_MAX_M = 8000;
const places = [...ATHENS_DISTRICTS, { name: 'VOULIAGMENI', lon: 23.778, lat: 37.815 }, { name: 'VARKIZA', lon: 23.801, lat: 37.82 }].map(p => ({ name: p.name, point: athensFromLonLat(p.lon, p.lat) }));
const water = MAP_LABELS.filter(p => p.k === 'water').map(p => ({ name: p.t, point: athensFromAttica(p.x, p.y) }));
export function mapScreenPoint(W, H, st, scale, x, z) {
  const dx = x - st.x, dz = z - st.z, c = Math.cos(st.yaw), s = Math.sin(st.yaw);
  return [W / 2 + (dx * c - dz * s) * scale, H * .62 + (dx * s + dz * c) * scale];
}
export function drawMapLabels(g, W, H, st, scale) {
  g.save(); g.font = `${Math.round(W / 16)}px sans-serif`; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#bcc8c8';
  const far = p => Math.hypot(p.point[0] - st.x, p.point[1] - st.z), nearest = places.reduce((a, b) => far(a) < far(b) ? a : b);
  // A place name is only a caption for where you are: beyond PLACE_LABEL_MAX_M the corner stays blank rather than naming a
  // remote one (Megara is ~25 km from Piraeus, the nearest listed place). The route name stays in the footer.
  if (far(nearest) <= PLACE_LABEL_MAX_M) g.fillText(nearest.name, 14, 14);
  for (const p of water) {
    const [x, y] = mapScreenPoint(W, H, st, scale, ...p.point), width = g.measureText(p.name).width;
    if (x > 14 && x + width < W - 14 && y > 70 && y < H - 55) { g.fillStyle = '#88a8b5'; g.fillText(p.name, x, y); break; }
  }
  // Heading and distance scale remain useful when M widens the range.
  g.fillStyle = '#b5c4c6'; g.textAlign = 'center';
  g.fillText('N', W - 24 + Math.sin(st.yaw) * 9, 23 - Math.cos(st.yaw) * 9);
  const metres = scale * 100 < W * .3 ? 100 : 50, len = metres * scale, y = H - 36;
  g.strokeStyle = '#b5c4c6'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(16, y - 4); g.lineTo(16, y); g.lineTo(16 + len, y); g.lineTo(16 + len, y - 4); g.stroke();
  g.textAlign = 'left'; g.fillText(`${metres} m`, 16, y - 20); g.restore();
}
export function drawMapDestination(g, W, H, st, scale, target, label) {
  const [x, y] = mapScreenPoint(W, H, st, scale, target.x, target.z);
  const px = Math.max(28, Math.min(W - 28, x)), py = Math.max(65, Math.min(H - 65, y));
  g.save(); g.fillStyle = '#d6c79b'; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill();
  // Reserve the footer for the destination legend; area and turn captions stay above it.
  g.font = `${Math.round(W / 18)}px sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
  g.fillText(label, W - 14, H - 37); g.restore();
}
