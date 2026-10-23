// What a tile's streets and walls carry besides buildings and trees, derived in the tile worker from its road graph, its buildings and its drivable asphalt (nothing travels
// on the wire): blue street-name plates at junction corners, the walls a shop sign or a mural may go on, and road marks (kerb paint, manholes, asphalt patches).
// src/athens-signs.js turns the plates and wall sites into instanced quads with a text atlas (matching OSM shops to the sites, generic Greek signs elsewhere), src/athens-marks.js
// drapes the marks. Every row is tile-local metres.
//   plates  [x, y, z, yaw, width, nameIndex, hash]   (names: the plateNames list, OSM `name` of the street, as written)
//   sites   [x, z, yaw, length, baseY, flags, hash]  flags: facade style (0..15), +16 in a street-art quarter, +32 in an old quarter, +64 if 12 m or higher, +128 (murals) on the shop wall
//   marks   [type, x, y, z, a, b, c]  type 0 kerb strip from (x, z) to (a, b), c colour (0 yellow, 1 white, 2 red); 1 manhole at (x, z), a radius, c 0 dark / 1 grey;
//           2 asphalt patch at (x, z), a yaw, b length, c = width + 10 * tone (0 darker, 1 lighter)
import { CELL, hashN } from './world-tile-trees.js';
import { groundIndex } from './world-tile-ground.js';
import { asphaltIndex } from './world-tile-asphalt.js';
import { inArtQuarter } from './athens-quarters.js';

/** Which parts of the street art are on (the commits of step 6 switch them on one group at a time). */
export const STREET_ART = Object.freeze({ marks: true, murals: true });
export const ART_LIMITS = Object.freeze({ plates: 360, shops: 1300, walls: 520, marks: 1700 });
const H24 = n => n & 0xffffff;
const SHOP_STYLES = new Set([0, 1, 3, 4, 9, 10, 11]);
/** Yellow only beside actual graph junction approaches; bus-stop paint follows mapped stop rows. */
const YELLOW_NEAR = 14, STRIP = 4, KERB_WIDTH = .32;

function indexSegments(t) {
  const grid = new Map(), E = t.edges, P = t.edgePoints, add = (x0, z0, x1, z1, item) => { for (let i = Math.floor(Math.min(x0, x1) / CELL); i <= Math.floor(Math.max(x0, x1) / CELL); i++) for (let j = Math.floor(Math.min(z0, z1) / CELL); j <= Math.floor(Math.max(z0, z1) / CELL); j++) { const k = i * 4096 + j; (grid.get(k) || grid.set(k, []).get(k)).push(item); } };
  for (let e = 0; e < E.length / 10; e++) { if ((E[e * 10 + 8] & 6) || (t.edgeLayers && t.edgeLayers[e] !== 0)) continue; for (let k = E[e * 10 + 3]; k < E[e * 10 + 3] + E[e * 10 + 4] - 1; k++) add(P[k * 3], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 5], [e, P[k * 3], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 5]]); }
  const near = (x, z, pad) => { const out = []; for (let i = Math.floor((x - pad) / CELL); i <= Math.floor((x + pad) / CELL); i++) for (let j = Math.floor((z - pad) / CELL); j <= Math.floor((z + pad) / CELL); j++) { const l = grid.get(i * 4096 + j); if (l) out.push(...l); } return out; };
  /** Nearest ground-level road axis to (x, z) within `pad` metres: { d, px, pz, e } or null. */
  const nearest = (x, z, pad) => { let best = null; for (const [e, x0, z0, x1, z1] of near(x, z, pad)) { const dx = x1 - x0, dz = z1 - z0, q = dx * dx + dz * dz, u = q ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / q)) : 0, px = x0 + u * dx, pz = z0 + u * dz, d = Math.hypot(x - px, z - pz); if (d < pad && (!best || d < best.d)) best = { d, px, pz, e }; } return best; };
  return { nearest };
}

/** The wall segments of every building: midpoint, unit tangent, outward normal (rings are counter-clockwise in x, z), length. */
function* walls(infos) {
  for (let b = 0; b < infos.length; b++) {
    const info = infos[b], ring = info.ring, n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], c = ring[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 2.2) continue;
      yield { b, info, len, mx: (a[0] + c[0]) / 2, mz: (a[1] + c[1]) / 2, ux: dx / len, uz: dz / len, nx: dz / len, nz: -dx / len };
    }
  }
}

export function deriveStreetArt(t, m, infos, { ox = 0, oz = 0, propsRows = null, propsKinds = null } = {}) {
  const idx = indexSegments(t), E = t.edges, P = t.edgePoints, strings = m.strings || [];
  const plates = [], plateNames = [], nameIndex = new Map(), shops = [], graffiti = [], marks = [];
  // ---- walls facing a road: one shop site and one mural site per building
  const best = new Map();
  for (const w of walls(infos)) {
    const road = idx.nearest(w.mx, w.mz, 17); if (!road) continue;
    if ((road.px - w.mx) * w.nx + (road.pz - w.mz) * w.nz <= 0) continue; // the road lies on the other side of the wall
    const entry = best.get(w.b) || (best.set(w.b, { shop: null, art: null, second: null }).get(w.b));
    const shopScore = w.len >= 4 && road.d < 14 ? w.len - road.d * .35 : -1, artScore = w.len >= 6.5 ? w.len + 3 - road.d * .1 : -1;
    if (shopScore > 0 && (!entry.shop || shopScore > entry.shop.s)) entry.shop = { s: shopScore, w };
    if (artScore > 0 && (!entry.art || artScore > entry.art.s)) { if (entry.art) entry.second = entry.art; entry.art = { s: artScore, w }; } else if (artScore > 0 && (!entry.second || artScore > entry.second.s)) entry.second = { s: artScore, w };
  }
  for (const [b, e] of best) {
    if (!e.shop && !e.art) continue;
    const info = infos[b], height = info.top - info.base, flags = (info.style & 15) + (inArtQuarter(ox + (e.shop || e.art).w.mx, oz + (e.shop || e.art).w.mz) ? 16 : 0) + (info.quarter ? 32 : 0) + (height >= 12 ? 64 : 0);
    const row = (w, arr, extra = 0) => arr.push(w.mx + w.nx * .04, w.mz + w.nz * .04, Math.atan2(w.nx, w.nz), w.len, info.base, flags + extra, H24(info.hash >>> 3));
    const shopWall = e.shop && height >= 6.5 && SHOP_STYLES.has(info.style & 15) ? e.shop.w : null; // the wall that carries the shop sign
    if (shopWall) row(shopWall, shops);
    // a mural goes on the best long wall; if that is the shop wall it is flagged 128 and drawn only where no shop sign was made (the sign wins), so unsigned shop fronts can carry one
    if (STREET_ART.murals && e.art) { const shared = shopWall && e.art.w === shopWall; if (shared) row(shopWall, graffiti, 128); else row(e.art.w, graffiti); if (shared && e.second) row(e.second.w, graffiti); }
  }
  // ---- street-name plates on the corner buildings of junctions
  const pos = new Map(); for (let i = 0; i < t.nodes.length; i += 2) pos.set(t.nodes[i], t.nodes[i + 1]);
  const incident = new Map(), link = (node, e) => { (incident.get(node) || incident.set(node, []).get(node)).push(e); };
  for (let e = 0; e < E.length / 10; e++) { if ((E[e * 10 + 8] & 6) || (t.edgeLayers && t.edgeLayers[e] !== 0)) continue; link(E[e * 10 + 1], e); link(E[e * 10 + 2], e); }
  const junctionNodes=new Set([...incident].filter(([node,edges])=>new Set(edges.map(e=>E[e*10+1]===node?E[e*10+2]:E[e*10+1])).size>=3).map(([node])=>node));
  const wallList = [...walls(infos)];
  for (const [node, edges] of incident) {
    if (plates.length >= ART_LIMITS.plates * 7) break;
    if (!junctionNodes.has(node)) continue;
    const pi = pos.get(node); if (pi == null) continue;
    const nx0 = t.nodePositions[pi * 3], ny0 = t.nodePositions[pi * 3 + 1], nz0 = t.nodePositions[pi * 3 + 2];
    const named = edges.filter(e => strings[E[e * 10 + 5]]); if (!named.length) continue;
    const near = []; for (const w of wallList) { if (w.len < 2.4) continue; const d = Math.hypot(w.mx - nx0, w.mz - nz0); if (d < 24 && (nx0 - w.mx) * w.nx + (nz0 - w.mz) * w.nz > 0) near.push({ w, d }); }
    near.sort((a, b) => a.d - b.d); const used = new Set(); let placed = 0;
    for (const { w } of near) {
      if (placed >= 2 || used.has(w.b)) continue;
      let bestEdge = null, bestD = Infinity; // the incident street whose axis runs closest to this wall names it
      for (const e of named) for (let k = E[e * 10 + 3]; k < E[e * 10 + 3] + E[e * 10 + 4] - 1; k++) { const x0 = P[k * 3], z0 = P[k * 3 + 2], x1 = P[k * 3 + 3], z1 = P[k * 3 + 5], dx = x1 - x0, dz = z1 - z0, q = dx * dx + dz * dz, u = q ? Math.max(0, Math.min(1, ((w.mx - x0) * dx + (w.mz - z0) * dz) / q)) : 0, d = Math.hypot(w.mx - x0 - u * dx, w.mz - z0 - u * dz); if (d < bestD) { bestD = d; bestEdge = e; } }
      if (bestEdge == null || bestD > 22) continue;
      const name = strings[E[bestEdge * 10 + 5]]; if (!nameIndex.has(name)) { nameIndex.set(name, plateNames.length); plateNames.push(name); }
      const toNode = (nx0 - w.mx) * w.ux + (nz0 - w.mz) * w.uz, along = w.len > 3.2 ? Math.sign(toNode) * (w.len / 2 - 1) : 0, info = infos[w.b];
      plates.push(w.mx + w.ux * along + w.nx * .05, info.base + 3.05, w.mz + w.uz * along + w.nz * .05, Math.atan2(w.nx, w.nz), Math.min(1.6, w.len - .5), nameIndex.get(name), H24(hashN(E[bestEdge * 10] * 31 + w.b) >>> 3));
      used.add(w.b); placed++;
    }
  }
  // ---- road marks: kerb paint, manholes, asphalt patches
  const asphalt = asphaltIndex(t), ground = groundIndex(t), markedRoads = new Set();
  // A whole mark must fit, including its edges on a bend. Sampling only its centre spills onto paving.
  const fits = (x,z,yaw,hl,hw) => {
    const tx=Math.sin(yaw),tz=Math.cos(yaw);
    for(let a=-hl;a<=hl+.001;a+=hl/4||1)for(let b=-hw;b<=hw+.001;b+=hw/2||1)
      if(!asphalt.inside(x+tx*a+tz*b,z+tz*a-tx*b))return false;
    return true;
  };
  const markY = (x,z,y) => {const h=ground.heightAt(x,z);return Number.isFinite(h)?h+.025:y+.025;};
  if (STREET_ART.marks && asphalt.count) {
    const stops = []; if (propsRows && propsKinds) for (let i = 0; i < propsKinds.length; i++) if (propsKinds[i] === 1 || propsKinds[i] === 2) stops.push(propsRows[i * 5], propsRows[i * 5 + 2]);
    for (let e = 0; e < E.length / 10 && marks.length < ART_LIMITS.marks * 7; e++) {
      const o = e * 10, flags = E[o + 8], first = E[o + 3], count = E[o + 4], id = E[o];
      if ((flags & 6) || (t.edgeLayers && t.edgeLayers[e] !== 0) || count < 2) continue;
      const seg = []; let length = 0; for (let k = 0; k < count - 1; k++) { const l = Math.hypot(P[(first + k + 1) * 3] - P[(first + k) * 3], P[(first + k + 1) * 3 + 2] - P[(first + k) * 3 + 2]); seg.push(l); length += l; }
      if (length < 12) continue;
      const at = s => { let acc = 0, k = 0; while (k < seg.length - 1 && acc + seg[k] < s) { acc += seg[k]; k++; } const a = first + k, l = seg[k] || 1, f = Math.min(1, Math.max(0, (s - acc) / l)); return { x: P[a * 3] + (P[a * 3 + 3] - P[a * 3]) * f, y: P[a * 3 + 1] + (P[a * 3 + 4] - P[a * 3 + 1]) * f, z: P[a * 3 + 2] + (P[a * 3 + 5] - P[a * 3 + 2]) * f, tx: (P[a * 3 + 3] - P[a * 3]) / l, tz: (P[a * 3 + 5] - P[a * 3 + 2]) / l }; };
      const kerb = s => { const p = at(s), w = asphalt.reach(p.x, p.z, -p.tz, p.tx, 9); return w < 1.2 ? null : { ...p, w, kx: p.x - p.tz * (w - KERB_WIDTH / 2 - .15), kz: p.z + p.tx * (w - KERB_WIDTH / 2 - .15) }; };
      const paintKerb=E[o+7]<80,nearStart=junctionNodes.has(E[o+1]),nearEnd=junctionNodes.has(E[o+2]);
      let prev = null;
      for (let s = 0; s <= length + .01; s += STRIP) {
        const cur = kerb(Math.min(s, length));
        if (paintKerb && prev && cur && Math.abs(prev.w - cur.w) < .8) {
          const mid = (s - STRIP / 2);
          let colour = -1;
          if (nearStart && mid < YELLOW_NEAR || nearEnd && mid > length - YELLOW_NEAR) colour = 0;
          const px = (prev.kx + cur.kx) / 2, pz = (prev.kz + cur.kz) / 2;
          for (let i = 0; i < stops.length; i += 2) if (Math.hypot(stops[i] - px, stops[i + 1] - pz) < 7.5 && (stops[i] - prev.x) * (-prev.tz) + (stops[i + 1] - prev.z) * prev.tx > 0) { colour = Math.floor(mid / 1.2) % 2 ? 2 : 1; break; }
          // A whole strip must border non-asphalt. A street mouth can be
          // fully asphalt yet have no kerb, so containment alone is insufficient.
          const nx=-cur.tz,nz=cur.tx,outer=KERB_WIDTH/2+.4;
          let edge=true;for(let k=0;k<=4;k++){const u=k/4;if(asphalt.inside(prev.kx+(cur.kx-prev.kx)*u+nx*outer,prev.kz+(cur.kz-prev.kz)*u+nz*outer)){edge=false;break;}}
          if (colour >= 0 && edge && fits(px,pz,Math.atan2(cur.kx-prev.kx,cur.kz-prev.kz),Math.hypot(cur.kx-prev.kx,cur.kz-prev.kz)/2,KERB_WIDTH/2)) marks.push(0, prev.kx, markY(prev.kx,prev.kz,prev.y), prev.kz, cur.kx, cur.kz, colour);
        }
        prev = cur;
      }
      const repairKey=[E[o+1],E[o+2]].sort((a,b)=>a-b).join(':');
      if (markedRoads.has(repairKey)) continue; // One repair set per two-way road, avoiding coplanar duplicates.
      markedRoads.add(repairKey);
      for (let s = 9 + hashN(id) % 30; s < length - 6; s += 34 + hashN(id * 7 + Math.floor(s)) % 40) { // manholes and patches in the lane
        const p = at(s), h = hashN(id * 13 + Math.floor(s)), w = asphalt.reach(p.x, p.z, -p.tz, p.tx, 9); if (w < 1.6) continue;
        const lat = ((h >>> 5) % 100 / 100 - .5) * Math.min(2.4, w * .8), x = p.x - p.tz * lat, z = p.z + p.tx * lat;
        if (h % 5 < 3) {const r=.3+(h%3)*.03;if(fits(x,z,0,r,r))marks.push(1,x,markY(x,z,p.y),z,r,0,(h>>>9)%4===0?1:0);}
        else {const yaw=Math.atan2(p.tx,p.tz)+((h>>>7)%7-3)*.03,len=1.4+(h>>>11)%20/10,wid=Math.min(1.3,w*.6);if(fits(x,z,yaw,len/2,wid/2))marks.push(2,x,markY(x,z,p.y),z,yaw,len,wid+10*((h>>>3)%2));}
      }
    }
  }
  const lim = (a, n) => Float32Array.from(a.slice(0, n * 7));
  return { plates: lim(plates, ART_LIMITS.plates), plateNames, shops: lim(shops, ART_LIMITS.shops), walls: lim(graffiti, ART_LIMITS.walls), marks: lim(marks, ART_LIMITS.marks) };
}
