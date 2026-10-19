// Deterministic streetscape records inferred from the frozen OSM streets and the municipal Street View survey
// (raw/street-classes.json, 2026-10-19). No downloaded imagery is shipped or read. Positions follow mapped
// streets, footprints, parks and campuses; species, wall types and heights are class-level estimates, not a census.
//
// Records are compact integer rows referencing a street strip: ref -1 is the lap (route s), ref >= 0 indexes
// data.roadNetwork.roads (arc length along road.p); lengths in decimetres. src/maps/psychiko-streetscape.js rebuilds the
// geometry. Walls and trees are delta-encoded for the bundle (decodePsychikoScenery below is the exact inverse).
//   walls   [ref, side, s0, s1, type, height]      boundary runs at the back of the footway, gaps at junctions/drives
//   trees   [x, z, species*1000 + height]          0 umbrella pine, 1 cypress, 2 broadleaf, 3 palm, 4 small/pollard, 5 garden shrub
//           (stored as half-metre deltas, species*100 + half-metre height)
//   parking [ref, side, s0, s1]                    kerb rows (lap bays sit outside the raced width)
//   poles   [ref, side, s, type]                   0 green gooseneck + cream bell (avenues), 1 utility pole + side arm
//   zebras  [ref, s]                               marked crossings across the whole carriageway
import { Route, Terrain } from '../../../src/map.js';
import { RoadNetwork } from '../../../src/road-network-surface.js';
import { pointInPoly, polyBounds } from '../../../src/util.js';
import { psychikoStreet, psychikoSection } from '../../../src/maps/psychiko-streets.js';
import { PSYCHIKO_SURVEY, psychikoWayParking } from './street-classes.mjs';
import { insideIsland, islandDistance } from '../../../src/roundabouts.js';
export const WALL_TYPES = Object.freeze(['plaster-railing', 'hedge', 'metal-fence', 'school-stone', 'stone', 'plaster', 'gate']);
const dm = v => Math.round(v * 10);
// Integer hash: placement depends on the feature, never on generation order.
function hash(...v) { let h = 0x9e3779b9; for (const x of v) { h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; } return (h >>> 0) / 4294967296; }
// Boundary mix per class from the survey's readable stations (plaster+railing 25, hedge 20, stone 13, metal fence 11, open 9 of 78).
const WALLS = {
  default: [['plaster-railing', .32], ['hedge', .26], ['stone', .15], ['metal-fence', .14], ['plaster', .05], [null, .08]],
  avenue: [['plaster-railing', .34], ['hedge', .24], ['stone', .2], ['metal-fence', .16], [null, .06]],
  hill: [['stone', .32], ['plaster', .12], ['hedge', .1], ['metal-fence', .1], [null, .36]],
  park: [['metal-fence', .45], ['hedge', .2], ['stone', .1], [null, .25]],
  arterial: [['hedge', .25], ['plaster', .15], ['metal-fence', .1], [null, .5]],
  frontage: [['hedge', .4], ['plaster', .2], ['metal-fence', .1], [null, .3]],
};
const OBSERVED = { 'plaster wall + railing': 'plaster-railing', hedge: 'hedge', 'stone wall': 'stone', 'metal fence': 'metal-fence', open: null };
// Street-tree spacing/probability and species mix [pine, cypress, broadleaf, palm, small] by class kind.
const STREET_TREES = {
  avenue: [.8, [.5, .06, .44, 0, 0]], school: [.6, [.55, .25, .2, 0, 0]], residential: [.35, [.15, .05, .3, 0, .5]],
  lane: [.18, [.1, .05, .25, 0, .6]], hill: [.12, [.3, .3, .2, 0, .2]], park: [.5, [.5, .1, .4, 0, 0]], frontage: [.4, [.6, .1, .3, 0, 0]],
  arterial: [.15, [.3, .1, .6, 0, 0]], ring: [.4, [.4, .1, .4, .1, 0]], cypress: [.5, [.2, .5, .3, 0, 0]], olive: [.5, [.05, .05, .2, 0, .7]], blocks: [.3, [.4, .1, .3, 0, .2]],
};
const GARDEN = [.34, .26, .3, .05, .05], PARK = [.5, .1, .33, .05, .02], WOOD = [.8, .1, .1, 0, 0];
const pickWeighted = (list, r) => { let a = 0; for (const [v, w] of list) { a += w; if (r < a) return v; } return list.at(-1)[0]; };
const pickSpecies = (mix, r) => { let a = 0; for (let i = 0; i < mix.length; i++) { a += mix[i]; if (r < a) return i; } return 2; };
const HEIGHT = [[14, 22], [11, 19], [7, 12], [8, 13], [4, 6.5], [1.3, 2.6]];

export function buildPsychikoScenery(data, bytes, osm = []) {
  const route = new Route(data.route), terrain = new Terrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const network = new RoadNetwork({ id: 'psychiko', data, route, terrain }), proj = data.proj;
  const P = n => [(n.lon - proj.lon0) * proj.mlon, -(n.lat - proj.lat0) * proj.mlat];
  const nodes = new Map(osm.filter(e => e.type === 'node').map(e => [e.id, e]));
  const polygon = w => (w.nodes || []).map(id => nodes.get(id)).filter(Boolean).flatMap(P);
  const areaIndex = list => { const cells = new Map(); for (const p of list) { const bb = polyBounds(p); for (let x = Math.floor(bb.x0 / 64); x <= Math.floor(bb.x1 / 64); x++) for (let z = Math.floor(bb.z0 / 64); z <= Math.floor(bb.z1 / 64); z++) { const k = x + ',' + z; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p); } } return (x, z) => (cells.get(Math.floor(x / 64) + ',' + Math.floor(z / 64)) || []).some(p => pointInPoly(x, z, p)); };
  const closedWays = osm.filter(e => e.type === 'way' && e.nodes?.length > 3 && e.nodes[0] === e.nodes.at(-1));
  const inCampus = areaIndex(closedWays.filter(e => /^(school|college|university)$/.test(e.tags?.amenity || '')).map(polygon));
  const parks = closedWays.filter(e => ['park', 'garden'].includes(e.tags?.leisure) || ['park', 'village_green', 'grass', 'recreation_ground'].includes(e.tags?.landuse)).map(polygon).filter(p => p.length > 6);
  const woods = (data.areas.wood || []).filter(a => a.c).map(a => a.p);
  const inPark = areaIndex(parks), inWood = areaIndex(woods), inBuilding = areaIndex(data.buildings.map(b => b.p));
  const inside = (x, z) => { const ring = data.psychiko.boundary; let yes = false; for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) { const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1]; if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) yes = !yes; } return yes; };
  const lapClear = (x, z, pad) => { if (!network.nearMain(x, z)) return true; const q = network.project(x, z); return Math.abs(q.u) >= route.edge(q.s) + .55 + .18 + 1.8 + pad; };
  const roadClear = (x, z, pad, own = null) => !network.candidates(x, z).some(seg => seg.road !== own && network.distance(seg, x, z) < seg.hw + seg.sw + pad);
  const clear = (x, z, pad, own) => !inBuilding(x, z) && !network.islandAt(x, z) && lapClear(x, z, pad) && roadClear(x, z, pad, own);

  // Street strips: the lap and each network road part, with their surveyed sections.
  const strips = [];
  { const at = s => route.frame(s, {});
    strips.push({ ref: -1, length: route.length, road: null, at, section: s => psychikoSection(route, s), hw: s => route.edge(s) + .55, fw: () => .18 + 1.8 }); }
  data.roadNetwork.roads.forEach((road, ref) => {
    if (road.junction === 'roundabout' || road.sf !== 'asphalt') return;
    const segs = []; let length = 0;
    for (let i = 0; i + 3 < road.p.length; i += 2) { const [x, z, bx, bz] = road.p.slice(i, i + 4), L = Math.hypot(bx - x, bz - z); if (L > .01) segs.push({ s: length, x, z, tx: (bx - x) / L, tz: (bz - z) / L, L }); length += L; }
    if (!segs.length || length < 8) return;
    const section = psychikoStreet(road.n, road.p[1] < -900, road.k), fw = road.urban ? road.fw ?? 1.3 : 0;
    const at = s => { let q = segs[0]; for (const g of segs) if (g.s <= s) q = g; else break; const d = Math.min(s - q.s, q.L); return { x: q.x + q.tx * d, z: q.z + q.tz * d, tx: q.tx, tz: q.tz }; };
    strips.push({ ref, length, road, at, section: () => section, hw: () => road.w / 2, fw: () => fw });
  });

  const walls = [], trees = [], parking = [], poles = [], zebras = [], treeCells = new Set();
  const tree = (x, z, species, h) => { const key = Math.round(x / 3.5) + ',' + Math.round(z / 3.5); if (treeCells.has(key)) return; treeCells.add(key); trees.push(dm(x), dm(z), species * 1000 + Math.min(999, dm(h))); };
  const treeHeight = (species, r) => HEIGHT[species][0] + (HEIGHT[species][1] - HEIGHT[species][0]) * r;
  const observedNear = (x, z) => { let best = null, d = 35 * 35; for (const o of observed) { const e = (o.x - x) ** 2 + (o.z - z) ** 2; if (e < d) { d = e; best = o; } } return best; };
  const observed = PSYCHIKO_SURVEY.observed.map(o => { const [x, z] = P(o); return { ...o, x, z, hx: Math.sin(o.heading * Math.PI / 180), hz: -Math.cos(o.heading * Math.PI / 180) }; });

  for (const strip of strips) {
    const { ref, length, at } = strip, own = strip.road;
    // Walls: 2 m samples at the back of the footway, typed per ~24 m plot; driveway/gate gaps per plot.
    for (const side of [-1, 1]) {
      let run = null;
      const flush = () => { if (run && run.s1 - run.s0 >= 2.5) walls.push(ref, side, dm(run.s0), dm(run.s1), WALL_TYPES.indexOf(run.type), dm(run.h)); run = null; };
      for (let s = 1; s <= length - 1; s += 2) {
        const p = at(s), sec = strip.section(s), u = strip.hw(s) + strip.fw(s) + .2, x = p.x - p.tz * u * side, z = p.z + p.tx * u * side;
        const plot = Math.floor(s / 24), r = hash(ref, side, plot), local = (s % 24) / 24;
        let type = null;
        if (clear(x, z, .1, own) && !inBuilding(x - p.tz * side * 1.2, z + p.tx * side * 1.2)) {
          const kind = sec.kind;
          if (inCampus(x - p.tz * side * 3, z + p.tx * side * 3)) type = 'school-stone';
          else if (inPark(x - p.tz * side * 2, z + p.tx * side * 2)) type = pickWeighted(WALLS.park, r);
          else { const o = observedNear(x, z), seen = o && ((x - o.x) * o.hz - (z - o.z) * o.hx > 0 ? o.left : o.right);
            type = seen?.length ? OBSERVED[seen[Math.floor(r * seen.length)]] ?? null : pickWeighted(WALLS[kind] || WALLS.default, r); }
          // Driveway: a 3.5 m opening in most villa plots, half of them closed by a dark metal gate.
          if (type && type !== 'school-stone' && r > .25) { const d0 = .2 + hash(plot, ref, side, 7) * .55; if (local >= d0 && local < d0 + 3.5 / 24) type = hash(ref, plot, side) < .5 ? 'gate' : null; }
        }
        if (!type) { flush(); continue; }
        const h = type === 'school-stone' ? 2.6 + hash(ref, side) * .6 : type === 'hedge' ? 1.7 + r * .9 : type === 'gate' ? 1.8 : type === 'stone' ? 1.1 + r * .8 : type === 'plaster' ? 1.7 + r * .5 : type === 'metal-fence' ? 1.6 + r * .3 : 1.7 + r * .4;
        if (!run || run.type !== type || Math.abs(run.h - h) > .01) { flush(); run = { type, h, s0: s - 1, s1: s + 1 }; } else run.s1 = s + 1;
      }
      flush();
    }
    // Street trees in footway pits and garden trees beyond the boundary.
    for (let s = 4; s < length - 4; s += 3) {
      const p = at(s), sec = strip.section(s), [prob, mix] = STREET_TREES[sec.kind] || STREET_TREES.residential;
      for (const side of [-1, 1]) {
        const r = hash(ref, side, Math.floor(s), 11);
        // Mature avenue rows: roughly 7.5 m between pits, with gaps at mouths and buildings. Crowns overlap above
        // the street; trunks stay on the footway. The survey's A9/A8 classes alone receive this denser treatment.
        const avenue = sec.k === 'A9' || sec.k === 'A8', phase = side > 0 ? 3 : 0;
        const streetTree = avenue ? Math.floor((s + phase + 3) / 7.5) !== Math.floor((s + phase) / 7.5) && r < .94 : r < prob / 3.4;
        if (strip.fw(s) >= .9 && streetTree) { const u = strip.hw(s) + .55, x = p.x - p.tz * u * side, z = p.z + p.tx * u * side;
          if (!inBuilding(x, z) && roadClear(x, z, -strip.fw(s) + .3, own) && lapClear(x, z, -1.8 + .2) && !network.islandAt(x, z)) { const sp = pickSpecies(mix, hash(ref, side, Math.floor(s), 12)), h = avenue && sp === 2 ? 13 + hash(s, ref, 13) * 4 : treeHeight(sp, hash(s, ref, 13)) * (sp === 4 ? 1 : .85); tree(x, z, sp, h); } }
        if (r > .55 && r < .55 + .25) { const u = strip.hw(s) + strip.fw(s) + 2.5 + hash(ref, side, s, 14) * 9, x = p.x - p.tz * u * side, z = p.z + p.tx * u * side;
          if (clear(x, z, 1.5, null) && !inBuilding(x + 2, z) && !inBuilding(x - 2, z) && !inBuilding(x, z + 2) && !inBuilding(x, z - 2)) { const sp = inCampus(x, z) ? pickSpecies([.5, .3, .2, 0, 0], hash(x | 0, z | 0)) : pickSpecies(GARDEN, hash(ref, side, s, 15)); tree(x, z, sp, treeHeight(sp, hash(ref, s, side, 16))); } }
        // Garden shrubs massed just inside the boundary (dense hedges/shrubs are typical of the villa frontages).
        if (r < .2 && strip.section(s).kind !== 'arterial') { const u = strip.hw(s) + strip.fw(s) + 1.3 + hash(ref, side, s, 17) * 1.8, x = p.x - p.tz * u * side, z = p.z + p.tx * u * side;
          if (clear(x, z, .8, null)) tree(x, z, 5, treeHeight(5, hash(ref, side, s, 18))); }
      }
    }
    if (ref < 0) {
      // The lap stays a clear race carriageway: on its surveyed avenues (A9/A8) cars sit astride the kerb, inner wheels in
      // the gutter, outside the raced width, including beside the grid. Keep the gantry, rings and mouths clear.
      for (const side of [-1, 1]) {
        let s0 = null;
        const end = s => { if (s0 !== null && s - s0 >= 5) parking.push(ref, side, dm(s0), dm(s)); s0 = null; };
        for (let s = 8; s <= length - 8; s += 1) {
          const sec = strip.section(s), block = Math.floor(s / 60), e = route.edge(s), u = e + 1.15, p = at(s), x = p.x - p.tz * u * side, z = p.z + p.tx * u * side;
          const ok = ['A9', 'A8'].includes(sec.k) && e >= 3.9 && hash(side, block, 31) < (sec.parking ?? .5) * 1.3 && !route.roundabouts.some(r => s > r.s0 - 18 && s < r.s1 + 18)
            && !network.mouth(s, side, 6) && !network.candidates(x, z).some(seg => network.distance(seg, x, z) < seg.hw + 6) && !((s % 26) / 26 > .6 && (s % 26) / 26 < .6 + 4 / 26 && hash(side, Math.floor(s / 26), 32) < .5);
          if (ok && s0 === null) s0 = s; else if (!ok) end(s);
        }
        end(length - 8);
      }
      continue;
    }
    // Kerb parking on the asphalt. Both sides only where at least 3.6 m of carriageway stays usable; never on the lap.
    const road = strip.road, sec = strip.section(0), counts = psychikoWayParking(road.id), w = road.w;
    const sides = w < 4.6 ? 0 : w >= 7.5 ? 2 : 1;
    const share = counts ? (2 * counts[0] + counts[1]) / (2 * (counts[0] + counts[1] + counts[2])) : sec.parking ?? .4;
    for (const side of [-1, 1]) {
      if (!sides || (sides === 1 && (hash(road.id, 3) < .5 ? -1 : 1) !== side) || hash(road.id, side, 5) > share * (sides === 1 ? 1.6 : 1)) continue;
      let s0 = null;
      const end = s => { if (s0 !== null && s - s0 >= 5) parking.push(ref, side, dm(s0), dm(s)); s0 = null; };
      for (let s = 6; s <= length - 6; s += 1) {
        const p = at(s), u = w / 2 - 1, x = p.x - p.tz * u * side, z = p.z + p.tx * u * side, gap = Math.floor(s / 30);
        const ok = lapClear(x, z, 9) && !network.islandAt(x, z) && !network.candidates(x, z).some(seg => seg.road !== road && network.distance(seg, x, z) < seg.hw + 5) && !((s % 30) / 30 > .55 && (s % 30) / 30 < .55 + 4 / 30 && hash(ref, side, gap, 9) < .6);
        if (ok && s0 === null) s0 = s; else if (!ok) end(s);
      }
      end(length - 6);
    }
  }

  // Each square keeps an open centre/path corridor and irregular crown groups. These are class-level garden
  // estimates from the survey notes, not satellite-derived trunk coordinates. Use the actual inset island polygon,
  // with a generous kerb setback; the general park filler deliberately rejects islands.
  const gardens = new Map([[25053074, 12], [25053095, 13], [25053106, 8], [25053533, 11], [25053545, 10], [25053562, 14], [31250243, 3], [31486890, 2], [634346640, 5], [737204781, 9]]);
  for (const island of network.islands) {
    const count = gardens.get(island.id); if (!count) continue;
    const poly = island.ring, cx = (island.minX + island.maxX) / 2, cz = (island.minZ + island.maxZ) / 2;
    const angle = hash(island.id, 41) * Math.PI, cs = Math.cos(angle), sn = Math.sin(angle);
    const path = (x, z, width) => { const dx = x - cx, dz = z - cz; return Math.abs(dx * cs + dz * sn) < width || (island.id !== 25053562 && Math.abs(-dx * sn + dz * cs) < width); };
    const fits = (x, z, pad) => insideIsland(x, z, poly) && islandDistance(x, z, poly) > pad && !network.mainInside(x, z) && !inBuilding(x, z);
    for (let k = 0, planted = 0; k < 500 && planted < count; k++) {
      const x = Math.round((island.minX + hash(island.id, k, 42) * (island.maxX - island.minX)) * 2) / 2;
      const z = Math.round((island.minZ + hash(island.id, k, 43) * (island.maxZ - island.minZ)) * 2) / 2;
      if (!fits(x, z, 4) || path(x, z, 2) || trees.some((v, i) => i % 3 === 0 && Math.floor(trees[i + 2] / 1000) !== 5 && Math.hypot(v / 10 - x, trees[i + 1] / 10 - z) < 6)) continue;
      const sp = hash(island.id, k, 44) < .64 ? 0 : 2;
      tree(x, z, sp, sp === 0 ? 14 + hash(k, island.id) * 5 : 11 + hash(k, island.id) * 4); planted++;
    }
    // Low clipped perimeter hedge, interrupted for paths, plus loose shrub beds inside it.
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0; d < L; d += 2.2) {
        const px = a[0] + (b[0] - a[0]) * d / L, pz = a[1] + (b[1] - a[1]) * d / L, R = Math.hypot(px - cx, pz - cz);
        const x = Math.round((px + (cx - px) * 2.6 / R) * 2) / 2, z = Math.round((pz + (cz - pz) * 2.6 / R) * 2) / 2;
        if (fits(x, z, 1.6) && !path(x, z, 2.4)) tree(x, z, 5, 1.4 + hash(i, island.id, d | 0) * .35);
      }
    }
    for (let k = 0; k < count * 3; k++) {
      const x = cx + (hash(island.id, k, 45) - .5) * (island.maxX - island.minX) * .72, z = cz + (hash(island.id, k, 46) - .5) * (island.maxZ - island.minZ) * .72;
      if (fits(x, z, 3) && !path(x, z, 2.5)) tree(x, z, 5, 1.5 + hash(island.id, k, 47));
    }
  }

  // Poles: green goosenecks staggered along avenues, utility poles with side arms on one side of other streets.
  for (const strip of strips) {
    const { ref, length, at } = strip;
    if (ref >= 0 && strip.road.h === 'primary') continue;
    let s = 8 + hash(ref, 21) * 12, n = 0;
    while (s < length - 6) {
      if (ref < 0 && route.roundabouts.some(r => s > r.s0 - 8 && s < r.s1 + 8)) { s += 3; continue; }
      const sec = strip.section(s), avenue = ['avenue', 'school', 'park', 'cypress'].includes(sec.kind), side = avenue ? (n % 2 ? 1 : -1) : (hash(ref, 22) < .5 ? -1 : 1);
      const p = at(s), u = strip.hw(s) + Math.min(.45, strip.fw(s) / 2), x = p.x - p.tz * u * side, z = p.z + p.tx * u * side;
      if (!inBuilding(x, z) && !network.islandAt(x, z) && (ref < 0 || lapClear(x, z, -1.6)) && !network.candidates(x, z).some(seg => seg.road !== strip.road && network.distance(seg, x, z) < seg.hw + .6)) { poles.push(ref, side, dm(s), sec.kind==='arterial' ? 2 : avenue ? 0 : 1); n++; s += avenue ? 26 + hash(ref, s | 0) * 8 : 32 + hash(ref, s | 0) * 8; }
      else s += 3;
    }
  }

  // Ring lamps stand on the OUTER footway, facing the circulating lane. Use source-road references so they
  // share the existing streamed prop cells and height sampler. No lamps in the gated college garden.
  data.roadNetwork.roads.forEach((road, ref) => {
    if (road.junction !== 'roundabout' || !network.islands.some(r => gardens.has(r.id) && r.ways.includes(road.id))) return;
    let station = 0, next = 12;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const [ax, az, bx, bz] = road.p.slice(i, i + 4), L = Math.hypot(bx - ax, bz - az); if (L < .01) continue;
      for (; next < station + L; next += 30) {
        const t = (next - station) / L, tx = (bx - ax) / L, tz = (bz - az) / L, u = road.w / 2 + .45;
        for (const side of [-1, 1]) {
          const x = ax + (bx - ax) * t - tz * u * side, z = az + (bz - az) * t + tx * u * side;
          // The outward candidate must also be beyond the island on a short step further from the ring.
          if (network.islandAt(x, z) || network.islandAt(x - tz * 2 * side, z + tx * 2 * side) || network.mainInside(x, z) || inBuilding(x, z)) continue;
          if (!network.candidates(x, z).some(seg => seg.road.id !== road.id && seg.road.junction !== 'roundabout' && network.distance(seg, x, z) < seg.hw + 1)) poles.push(ref, side, dm(next), 0);
          break;
        }
      }
      station += L;
    }
  });

  // Zebras: OSM marked crossings inside the municipality, plus the observed approach crossings at A, B and Pindou squares.
  const nearestStrip = (x, z, max = 4) => { let best = null, d = max; for (const strip of strips) { if (strip.ref < 0) { if (!network.nearMain(x, z)) continue; const q = network.project(x, z), e = Math.abs(q.u); if (e < d) { d = e; best = { ref: -1, s: q.s }; } continue; } for (let s = 0; s <= strip.length; s += 1) { const p = strip.at(s), e = Math.hypot(p.x - x, p.z - z); if (e < d) { d = e; best = { ref: strip.ref, s }; } } } return best; };
  const zebra = q => { if (q && !zebras.some((v, i) => i % 2 === 0 && v === q.ref && Math.abs(zebras[i + 1] - dm(q.s)) < 80)) zebras.push(q.ref, dm(q.s)); };
  for (const e of osm) if (e.type === 'node' && e.tags?.highway === 'crossing' && /^(marked|zebra|uncontrolled|traffic_signals)$/.test(e.tags.crossing || 'marked')) { const [x, z] = P(e); if (inside(x, z)) zebra(nearestStrip(x, z, 3)); }
  const squares = [25053095, 25053533, 737204781];
  for (const ring of data.roadNetwork.roundabouts || []) if (ring.ways.some(id => squares.includes(id))) {
    const cx = ring.p.reduce((a, p, i) => i % 2 ? a : a + p / (ring.p.length / 2), 0), cz = ring.p.reduce((a, p, i) => i % 2 ? a + p / (ring.p.length / 2) : a, 0);
    let radius = 0; for (let i = 0; i < ring.p.length; i += 2) radius = Math.max(radius, Math.hypot(ring.p[i] - cx, ring.p[i + 1] - cz));
    for (const strip of strips) { if (strip.ref < 0) { for (const r of route.roundabouts) if (Math.hypot(route.point((r.s0 + r.s1) / 2, 0).x - cx, route.point((r.s0 + r.s1) / 2, 0).z - cz) < radius + 10) { zebra({ ref: -1, s: r.s0 - 9 }); zebra({ ref: -1, s: r.s1 + 9 }); } continue; }
      for (const [s, step] of [[0, 1], [strip.length, -1]]) { const p = strip.at(s); if (Math.abs(Math.hypot(p.x - cx, p.z - cz) - radius) < ring.w / 2 + 6 && strip.length > 20) zebra({ ref: strip.ref, s: s + step * 8 }); } }
  }

  // Parks: margin rows and irregular canopy groups instead of a uniform grid; woods are pine-dominated groups.
  const fillArea = (poly, mix, spacing, margin, seed) => {
    const bb = polyBounds(poly);
    if (margin) for (let i = 0; i + 3 < poly.length; i += 2) { const ax = poly[i], az = poly[i + 1], bx = poly[i + 2], bz = poly[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      for (let d = 2; d < L - 2; d += 8 + hash(seed, i, d | 0) * 5) { const t = d / L, nx = -(bz - az) / L, nz = (bx - ax) / L; for (const k of [1, -1]) { const x = ax + (bx - ax) * t + nx * 3.5 * k, z = az + (bz - az) * t + nz * 3.5 * k; if (pointInPoly(x, z, poly) && clear(x, z, 1.2, null)) { const sp = pickSpecies(mix, hash(seed, i, d | 0, 2)); tree(x, z, sp, treeHeight(sp, hash(seed, d | 0, i))); break; } } } }
    for (let gx = Math.floor(bb.x0 / spacing); gx <= Math.floor(bb.x1 / spacing); gx++) for (let gz = Math.floor(bb.z0 / spacing); gz <= Math.floor(bb.z1 / spacing); gz++) {
      const r = hash(seed, gx, gz); if (r > .72) continue; // open lawns and clearings between groups
      const cx = (gx + .2 + hash(gx, gz, seed, 3) * .6) * spacing, cz = (gz + .2 + hash(gz, gx, seed, 4) * .6) * spacing, count = 2 + Math.floor(hash(gx, seed, gz) * 5);
      for (let k = 0; k < count; k++) { const a = hash(gx, gz, k, 5) * 6.283, d = Math.sqrt(hash(gz, gx, k, 6)) * 8, x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
        if (pointInPoly(x, z, poly) && clear(x, z, 1.2, null)) { const sp = pickSpecies(mix, hash(gx, gz, k, seed)); tree(x, z, sp, treeHeight(sp, hash(k, gx, gz))); } }
    }
  };
  const near = (poly) => { const bb = polyBounds(poly), cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2; return network.candidates(cx, cz).length || network.nearMain(cx, cz) || [[bb.x0, bb.z0], [bb.x1, bb.z1]].some(p => network.candidates(...p).length); };
  parks.forEach((p, i) => { if (near(p)) fillArea(p, PARK, 30, true, 1000 + i); });
  woods.forEach((p, i) => { if (near(p)) fillArea(p, WOOD, 42, false, 5000 + i); });
  // Mapped OSM trees and rows keep their positions; species from leaf_type/genus where tagged.
  for (const e of osm) {
    const t = e.tags || {}, sp = /Pinus/i.test(t.genus || '') || t.leaf_type === 'needleleaved' ? (/Cupressus/i.test(t.genus || '') ? 1 : 0) : /Citrus|Olea/i.test(t.genus || '') ? 4 : /palm|Phoenix|Washingtonia/i.test(t.genus || t.species || '') ? 3 : 2;
    if (e.type === 'node' && t.natural === 'tree') { const [x, z] = P(e); if (clear(x, z, .2, null) && (network.candidates(x, z).length || network.nearMain(x, z))) tree(x, z, sp, parseFloat(t.height) || treeHeight(sp, hash(e.id))); }
    if (e.type === 'way' && t.natural === 'tree_row') { const ps = (e.nodes || []).map(id => nodes.get(id)).filter(Boolean).map(P); for (let i = 1; i < ps.length; i++) { const [ax, az] = ps[i - 1], [bx, bz] = ps[i], L = Math.hypot(bx - ax, bz - az); for (let d = 0; d < L; d += 8) { const x = ax + (bx - ax) * d / L, z = az + (bz - az) * d / L; if (clear(x, z, .2, null) && (network.candidates(x, z).length || network.nearMain(x, z))) tree(x, z, sp, treeHeight(sp, hash(e.id, i, d))); } } }
  }
  return { version: 3, source: 'Municipal Street View survey 2026-10-19 (classes, boundaries, parking, lamps); frozen OSM 2026-10-14', roads: data.roadNetwork.roads.length, ...encode(walls, trees), parking, poles, zebras };
}
// Walls: [ref delta, side, s0 (from the previous run's s1 on the same ref/side, else absolute), length, type, height].
// Trees: sorted into 50 m bands, then [x, z] half-metre deltas and species*100 + half-metre height.
function encode(walls, trees) {
  const w = []; let ref = 0, side = 0, end = 0;
  for (let i = 0; i < walls.length; i += 6) { const same = walls[i] === ref && walls[i + 1] === side; w.push(walls[i] - ref, walls[i + 1], walls[i + 2] - (same ? end : 0), walls[i + 3] - walls[i + 2], walls[i + 4], walls[i + 5]); ref = walls[i]; side = walls[i + 1]; end = walls[i + 3]; }
  const rows = []; for (let i = 0; i < trees.length; i += 3) rows.push([Math.round(trees[i] / 5), Math.round(trees[i + 1] / 5), Math.floor(trees[i + 2] / 1000) * 100 + Math.min(99, Math.round(trees[i + 2] % 1000 / 5))]);
  rows.sort((a, b) => Math.floor(a[1] / 100) - Math.floor(b[1] / 100) || a[0] - b[0] || a[1] - b[1]);
  const t = []; let x = 0, z = 0; for (const r of rows) { t.push(r[0] - x, r[1] - z, r[2]); x = r[0]; z = r[1]; }
  return { walls: w, trees: t };
}
