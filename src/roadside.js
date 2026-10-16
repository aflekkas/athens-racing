import { signFaceOffset } from './sign-mount.js';
import { WORLD_TRIANGLE_BUDGETS, triangleCount } from './world-art-direction.js';
// Street-level Athens Riviera furniture. All dimensions are metres.
// Reference shapes (viewed as reference only; no third-party images are shipped):
// https://2steps.gr/index.asp?xkey=3680 — Limanakia limestone, timber kiosk and access steps.
// https://www.lifo.gr/guide/nightlife/recommendations/mojito-bay — Lomvarda beach bar.
// https://commons.wikimedia.org/wiki/File:OASA_stop_3.png — blue/white OASA stop plate.
// https://www.holprop.com/sale/villa-house/greece/attica/varkiza-vari/ — villa boundary walls.
import * as THREE from 'three';
import { CellInstances, GeoBatch, M, clamp, canvasTex, pointInPoly } from './util.js';
import { ROAD } from './road.js';

const CELL = 180;
const WHITE = '#e9e7de', BLUE = '#175997', IRON = '#323f43', STEEL = '#a8afb0';

function materials() {
  const pbr = (roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, ...extra });
  const scanned = () => pbr(1);
  // One atlas for every sign, including stop information and the canteen menu.
  const atlas = canvasTex(1024, 1024, (c) => {
    const labels = [ ['ΟΑΣΑ  ·  OASA', BLUE, '#ffffff'], ['ΣΤΑΣΗ  /  BUS STOP', '#ffffff', BLUE],
      ['P', BLUE, '#ffffff'], ['ΚΑΝΤΙΝΑ', '#ece5cc', '#31575e'], ['LOMVARDA  ·  BEACH BAR', '#d6c6a2', '#314d4a'],
      ['COFFEE  ·  WATER  ·  SNACKS', '#24474a', '#f4eee1'], ['ΠΛΗΡΟΦΟΡΙΕΣ / INFO', '#ffffff', BLUE], ['ΠΑΡΑΛΙΑ  /  BEACH', '#f0eadd', '#285466'] ];
    labels.forEach(([text, bg, fg], i) => {
      const y = i * 128; c.fillStyle = bg; c.fillRect(0, y, 1024, 128);
      c.strokeStyle = fg; c.lineWidth = 3; c.strokeRect(12, y + 10, 1000, 108);
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `bold ${i === 2 ? 112 : i === 4 || i === 5 ? 48 : 64}px sans-serif`;
      c.fillText(text, 512, y + 66, 960);
    });
  });
  return { paint: pbr(.62, .08), metal: pbr(.38, .75), stone: scanned('rock'), concrete: scanned('concrete'), plaster: scanned('plaster'),
    wood: pbr(.88), rubber: pbr(.96), glass: pbr(.16, .05, { transparent: true, opacity: .25, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }),
    sign: pbr(.72, .02, { map: atlas }) };
}

// Bake detail into one geometry per material, then instance those geometries by spatial cell.
// This keeps a shelter's many fasteners, bench slats and frames to five draw calls per cell.
class Model {
  constructor(name, mats, bounds) { this.name = name; this.mats = mats; this.bounds = bounds; this.batches = new Map(); this.obstacles = []; }
  add(key, geo, matrix, color = '#ffffff', metricUV = true) {
    if (metricUV && ['stone', 'concrete', 'plaster'].includes(key)) {
      const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
      const v = new THREE.Vector3(), normal = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(matrix); normal.fromBufferAttribute(n, i).applyMatrix3(nm);
        const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
        uv.setXY(i, (ay > ax && ay > az ? v.x : ax > az ? v.z : v.x) / 1.6, (ay > ax && ay > az ? v.z : v.y) / 1.6);
      }
    }
    if (!this.batches.has(key)) this.batches.set(key, new GeoBatch());
    this.batches.get(key).add(geo, matrix, color); geo.dispose(); return this;
  }
  box(key, x, y, z, w, h, d, color, bevel = 0, rx = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    return this.add(key, g, M(x, y, z, rx), color);
  }
  rod(key, a, b, r, color, r2 = r, sides = 8) {
    const p = new THREE.Vector3(...a), q = new THREE.Vector3(...b), delta = q.clone().sub(p);
    const matrix = new THREE.Matrix4().compose(p.add(q).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()), new THREE.Vector3(1, 1, 1));
    return this.add(key, new THREE.CylinderGeometry(r2, r, delta.length(), sides), matrix, color);
  }
  label(row, x, y, z, w, h, ry = 0) {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (row === 2 ? .445 + uv.getX(i) * .11 : .015 + uv.getX(i) * .97), 1 - (row + .04 + (1 - uv.getY(i)) * .92) / 8);
    return this.add('sign', g, M(x, y, z, 0, ry), '#ffffff', false);
  }
  solid(x, z, hw, hl, yaw = 0) { this.obstacles.push({ x, z, yaw, hl, hw }); return this; }
  finish() {
    this.parts = [...this.batches].map(([key, batch]) => ({ key, geometry: batch.build(), material: this.mats[key] }));
    const triangles=this.parts.reduce((n,p)=>n+triangleCount(p.geometry),0); const category=this.name==='stairs'?'stairFlight':this.name==='stop'||this.name==='parking'?'sign':'streetProp';
    if(triangles>WORLD_TRIANGLE_BUDGETS[category])throw new Error('Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing. '+this.name+': '+triangles);
    this.batches.clear(); return this;
  }
}

function shelter(mats){const m=new Model('shelter',mats,{hw:2.28,hl:1.03});
 m.box('paint',0,2.5,0,4.5,.16,2,WHITE);for(const x of [-2,2])for(const z of [-.72,.72])m.box('metal',x,1.25,z,.09,2.5,.09,IRON).solid(x,z,.065,.065);
 m.box('glass',0,1.3,-.73,4,1.9,.03,'#b4d4d9').solid(0,-.74,2.04,.035);
 m.box('metal',0,.49,-.35,2.8,.10,.45,STEEL).solid(0,-.37,1.43,.27);
 m.box('metal',0,.76,-.60,2.8,.45,.06,STEEL);m.label(0,0,2.48,1.01,3.35,.19);return m.finish();}
function stopPole(mats,parking=false){const m=new Model(parking?'parking':'stop',mats,{hw:.35,hl:.2});m.box('metal',0,1.4,0,.07,2.8,.07,STEEL);m.box('paint',0,2.57,signFaceOffset(.07,.045)-.0225,.62,.73,.045,WHITE);m.label(parking?2:0,0,2.57,signFaceOffset(.07,.045)+.003,.56,.59);m.solid(0,0,.14,.14);return m.finish();}
function bin(mats){const m=new Model('bin',mats,{hw:.36,hl:.36});m.box('paint',0,.44,0,.6,.82,.6,'#486e67');m.box('metal',0,.87,0,.65,.06,.65,IRON);m.solid(0,0,.35,.32);return m.finish();}
function canteen(mats){const m=new Model('canteen',mats,{hw:2.85,hl:1.75});m.box('paint',0,1.3,0,4.55,2.6,2.06,WHITE);m.box('glass',0,1.8,1.04,3.5,.7,.03,'#344b50');m.label(3,0,2.4,1.06,2.6,.18);m.solid(0,0,2.3,1.1);return m.finish();}
function shack(mats){const m=new Model('shack',mats,{hw:2.85,hl:2.22});m.box('paint',0,1.4,0,5.4,2.8,4.2,'#c6bda8');m.solid(0,0,2.7,2.1);return m.finish();}
function wall(mats){const m=new Model('wall',mats,{hw:1.53,hl:.34});m.box('stone',0,.65,0,3,1.3,.6,'#b6ac98');m.solid(0,0,1.5,.3);return m.finish();}
function villa(mats){const m=new Model('villa',mats,{hw:3.12,hl:.36});m.box('plaster',0,.65,0,6.2,1.3,.5,WHITE);m.solid(0,0,3.1,.25);return m.finish();}
function stairs(mats,tops=null,bottoms=null){const n=18,run=.31;tops||=Array.from({length:n},(_,i)=>-i*.17);bottoms||=tops.map(y=>y-.42);const m=new Model('stairs',mats,{hw:1.05,hl:n*run/2,z:n*run/2});for(let i=0;i<n;i++){const h=Math.max(.18,tops[i]-bottoms[i]);m.box('concrete',0,tops[i]-h/2,i*run+run/2,1.9,h,run+.012,'#bebcb0');}m.solid(0,n*run/2,.98,n*run/2);return m.finish();}

/** Shared model library for tools/roadside.html. Front faces +Z, widths run along X. */
export function createRoadsideModels() {
  const mats = materials();
  return { mats, models: { shelter: shelter(mats), stop: stopPole(mats), parking: stopPole(mats, true), bin: bin(mats), canteen: canteen(mats), shack: shack(mats), wall: wall(mats), villa: villa(mats), stairs: stairs(mats) } };
}

// OBB collision uses the game's convention: forward=(-sin(yaw), -cos(yaw)).
function overlap(a, b, padding = 0) {
  const axes = [a.yaw, b.yaw].flatMap(y => [[Math.cos(y), -Math.sin(y)], [Math.sin(y), Math.cos(y)]]);
  const radius = (o, ax, az) => (o.hw + padding) * Math.abs(ax * Math.cos(o.yaw) - az * Math.sin(o.yaw)) + (o.hl + padding) * Math.abs(ax * Math.sin(o.yaw) + az * Math.cos(o.yaw));
  return axes.every(([x, z]) => Math.abs((a.x - b.x) * x + (a.z - b.z) * z) < radius(a, x, z) + radius(b, x, z));
}
function corners(o) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return [-1, 1].flatMap(a => [-1, 1].map(b => ({ x: o.x + a * o.hw * c + b * o.hl * s, z: o.z - a * o.hw * s + b * o.hl * c })));
}

/**
 * Add roadside props. Call after loadTextures() and buildTerrain(), before the main LOD scan.
 * The caller must register returned obstacles with Ground's static collision collection.
 * Does not mutate map/data/assets. No global caches: repeated builds are independent.
 * group.userData.roadside contains placement counts, exclusions and draw-call upper bounds.
 */
export function buildRoadside(map, scene, heightC, assets = {}) {
  const { route, data } = map, { mats, models } = createRoadsideModels();
  const group = new THREE.Group(); group.name = 'Athens Riviera roadside';
  const footing = new Model('footing', mats, { hw: .5, hl: .5 });
  footing.box('concrete', 0, -.5, 0, 1, 1, 1, '#bab8ac').solid(0, 0, .5, .5).finish();
  const obstacles = [], occupied = [], pools = new Map(), placements = [];
  const stats = { counts: {}, obstacles: 0, meshes: 0, instances: 0, maxMainPassDrawCalls: 0, skipped: 0 };
  const marks = Object.fromEntries((data.marks || []).map(m => [m.id, m.s]));
  const parks = (data.parkSpots || []).map(p => ({ ...p, yaw: p.yaw || 0, hw: 1.25, hl: 2.8 }));
  const humps = data.humps || [];
  const seaSide = s => route.seaR(s) <= route.seaL(s) ? 1 : -1;
  const yawAt = (s, side, outward = false) => { const f = route.frame(s, {}); return Math.atan2(f.rx * side, f.rz * side) + (outward ? 0 : Math.PI); };
  const curbGround = (s, u) => {
    const p = route.point(s, u), side = Math.sign(u) || 1;
    const pavement = Math.abs(u) <= route.edge(s) + ROAD.gutter + ROAD.sidewalk(route, s, side);
    return Math.max(heightC(p.x, p.z), pavement ? route.surfaceY(s, u) + ROAD.curbH(route, s) : -Infinity);
  };
  function clear(o, s, side, wallRun = false) {
    for (const p of [...corners(o), { x: o.x, z: o.z }]) {
      const q = route.project(p.x, p.z, s, 5);
      if (q.u * side <= route.edge(q.s) + ROAD.gutter + .30) return false;
    }
    if (parks.some(p => overlap(o, p, .35))) return false;
    for (const h of humps) {
      const dx = h[0] - o.x, dz = h[1] - o.z, c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
      const x = Math.max(0, Math.abs(dx * c - dz * sn) - o.hw), z = Math.max(0, Math.abs(dx * sn + dz * c) - o.hl);
      if (Math.hypot(x, z) < h[2] + .45) return false;
    }
    return !occupied.some(p => !(wallRun && p.wallRun) && overlap(o, p, .10));
  }
  function emit(model, x, y, z, yaw, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
    const matrix = M(x, y, z, pitch, yaw, roll, sx, sy, sz, 'YXZ');
    if (!pools.has(model)) pools.set(model, model.parts.map(p => new CellInstances(p.geometry, p.material, { cell: CELL, far: model.name === 'wall' ? 650 : 430, shadow: p.key !== 'glass' })));
    pools.get(model).forEach(p => p.add(matrix));
    for (const o of model.obstacles) {
      const lx = o.x * sx, lz = o.z * sz;
      obstacles.push({ x: x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: z - lx * Math.sin(yaw) + lz * Math.cos(yaw), yaw: yaw + o.yaw, hl: o.hl * sz, hw: o.hw * sx });
    }
    stats.counts[model.name] = (stats.counts[model.name] || 0) + 1;
    placements.push({ model: model.name, x, y, z, yaw, sx, sy, sz });
  }
  function place(name, s, u, options = {}) {
    if (!Number.isFinite(s) || s < 0 || s > route.length) return null;
    const model = models[name], side = Math.sign(u) || 1, p = route.point(s, u), yaw = options.yaw ?? yawAt(s, side);
    const b = model.bounds, o = { x: p.x, z: p.z, yaw, hw: b.hw, hl: b.hl };
    if (!clear(o, s, side)) { stats.skipped++; return null; }
    const ys = corners(o).map(q => heightC(q.x, q.z));
    if (Math.max(...ys) - Math.min(...ys) > (options.slope ?? .65)) { stats.skipped++; return null; }
    // Sink the foundation into the highest terrain point; supporting feet/plinths span small slopes.
    let y = Math.max(curbGround(s, u), ...ys) - .025;
    let pitch = 0, roll = 0;
    if (name === 'canteen') {
      // Parked trailers follow the grade so all four tyres meet the dirt.
      y = ys.reduce((a, b) => a + b) / 4 - .005;
      roll = Math.atan(((ys[2] + ys[3]) - (ys[0] + ys[1])) / (4 * b.hw));
      pitch = -Math.atan(((ys[1] + ys[3]) - (ys[0] + ys[2])) / (4 * b.hl));
    }
    if (['shelter', 'villa', 'shack'].includes(name)) {
      const sizes = { shelter: [4.48, 1.97], villa: [6.10, .35], shack: [5.32, 3.73] }[name];
      const depth = Math.max(.08, y - Math.min(...ys) + .13);
      emit(footing, p.x, y - .045, p.z, yaw, sizes[0], depth, sizes[1]);
    }
    emit(model, p.x, y, p.z, yaw, 1, 1, 1, pitch, roll); occupied.push(o); return { s, u, p, yaw };
  }
  // OSM stops on both sides; suppress duplicate relations only, not distinct opposite stops.
  const usedStops = [];
  for (const f of data.furniture || []) {
    if (f.t !== 'bus_stop' || !Number.isFinite(f.s) || f.s < 0 || f.s > route.length) continue;
    const side = Math.sign(f.u) || 1;
    if (usedStops.some(q => q.side === side && Math.abs(q.s - f.s) < 18)) continue;
    usedStops.push({ s: f.s, side });
    const u = side * Math.max(Math.abs(f.u), route.edge(f.s) + ROAD.gutter + 1.50);
    let placed = null;
    for (const ds of [0, -5, 5, -9, 9]) { placed = place('shelter', f.s + ds, u); if (placed) break; }
    const ps = placed?.s ?? f.s, pu = placed?.u ?? u;
    place('stop', ps + 3.05, pu);
    if (placed && usedStops.length % 3 === 0) place('bin', ps - 3.15, pu);
  }
  // Prefer mapped dirt parking polygons, keeping the entire kiosk footprint within the lay-by.
  const dirt = (data.areas?.parking || []).filter(a => a.sf === 'dirt' && a.p?.length >= 6);
  function layby(name, s, offset = 0) {
    if (!Number.isFinite(s)) return null;
    const target = s + offset;
    const candidates = [];
    for (const area of dirt) {
      const xs = area.p.filter((_, i) => !(i % 2)), zs = area.p.filter((_, i) => i % 2);
      const cx = xs.reduce((a, b) => a + b) / xs.length, cz = zs.reduce((a, b) => a + b) / zs.length;
      if (Math.abs(route.project(cx, cz).s - target) > 650) continue;
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.8) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1.8) {
        if (!pointInPoly(x, z, area.p)) continue;
        const q = route.project(x, z), side = seaSide(q.s);
        if (q.u * side < 0 || Math.abs(q.u) > 65) continue;
        const o = { ...models[name].bounds, x, z, yaw: yawAt(q.s, side) };
        if (!corners(o).every(p => pointInPoly(p.x, p.z, area.p))) continue;
        candidates.push({ ...q, score: Math.abs(q.s - target) + Math.abs(q.u) * .3 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const q of candidates) { const result = place(name, q.s, q.u, { slope: .42 }); if (result) return result; }
    // Some OSM extracts omit Lomvarda's dirt parking boundary. Use a dry, gently sloping
    // seaward verge near its mark, still respecting all mapped parking spaces and humps.
    if (name === 'shack' && !candidates.length) for (const ds of [0, -12, 12, -24, 24, -45, 45, -70, 70]) {
      const ss = target + ds, side = seaSide(ss);
      for (const extra of [5, 8, 11, 15]) {
        const u = side * (route.edge(ss) + ROAD.gutter + extra), p = route.point(ss, u);
        if (heightC(p.x, p.z) < .5) continue;
        if ((data.buildings || []).some(b => b.p && pointInPoly(p.x, p.z, b.p))) continue;
        const result = place(name, ss, u, { slope: .42 }); if (result) return result;
      }
    }
    return null;
  }
  if (Number.isFinite(marks.limanakia)) {
    layby('canteen', marks.limanakia, -85); layby('canteen', marks.limanakia, 105);
    // Each flight follows the sampled terrain. Individual risers have buried foundations.
    for (const offset of [-160, 25, 210]) {
      for (const ds of [0, -15, 15, -30, 30, -50, 50]) {
        const s = marks.limanakia + offset + ds; if (s < 0 || s > route.length) continue;
        const side = seaSide(s), u = side * (route.edge(s) + ROAD.gutter + ROAD.sidewalk(route, s, side) + 3.4);
        const p = route.point(s, u), yaw = yawAt(s, side, true), c = Math.cos(yaw), sn = Math.sin(yaw);
        const at = (x, z) => heightC(p.x + x * c + z * sn, p.z - x * sn + z * c);
        const top = at(0, 0) + .045, bottom = at(0, 5.58), drop = top - bottom;
        if (drop < 1.0 || drop > 3.9 || bottom < .35) continue;
        const o = { x: p.x + 2.79 * sn, z: p.z + 2.79 * c, yaw, hw: 1.05, hl: 2.79 };
        if (!clear(o, s, side)) continue;
        const tops = Array.from({ length: 18 }, (_, i) => -drop * i / 18);
        const lows = tops.map((y, i) => Math.min(at(-.95, i * .31), at(.95, (i + 1) * .31)) - top - .08);
        if (tops.some((y, i) => Math.max(at(-.95, i * .31), at(.95, (i + 1) * .31)) > top + y + .10)) continue;
        const model = stairs(mats, tops, lows); emit(model, p.x, top, p.z, yaw); occupied.push(o); break;
      }
    }
  }
  if (Number.isFinite(marks.lomvarda)) {
    const hut = layby('shack', marks.lomvarda, -45);
    layby('shack', marks.lomvarda, 40);
    if (hut) {
      place('parking', hut.s - 7, (Math.sign(hut.u) || 1) * (route.edge(hut.s - 7) + ROAD.gutter + 1.10));
      place('bin', hut.s + 4.3, hut.u); place('bin', hut.s - 4.3, hut.u);
    }
    // A stop pole is only added for real OSM stops above, never an invented bus stop at the beach.
  }
  // Varkiza villa boundaries: short separated runs leave driveway openings and side streets clear.
  if (Number.isFinite(marks.varkiza)) {
    for (let s = Math.max(0, marks.varkiza - 370); s < Math.min(route.length, marks.varkiza + 440); s += 29) {
      if (route.urban(s) < .45) continue;
      const side = -seaSide(s);
      if ((data.sideRoads || []).some(r => Number.isFinite(r.s) && Math.abs(r.s - s) < 12)) continue;
      for (const ds of [-3, 3]) {
        const ss = s + ds, u = side * (route.edge(ss) + ROAD.gutter + ROAD.sidewalk(route, ss, side) + 1.35);
        place('villa', ss, u, { slope: .42 });
      }
    }
  }
  // Retaining masonry: probe the uphill verge and require a sustained rise before starting a run.
  const wallCandidates = [];
  for (let s = Math.max(0, route.start || 0); s < route.length - 3; s += 3) {
    if (route.urban(s) > .48 || !['cliff', 'cove', 'beach'].includes(route.district(s))) continue;
    const side = -seaSide(s), u = side * (route.edge(s) + ROAD.gutter + ROAD.sidewalk(route, s, side) + 2.05);
    const p = route.point(s, u), hill = route.point(s, u + side * 8), y = heightC(p.x, p.z);
    const rise = heightC(hill.x, hill.z) - route.surfaceY(s, side * route.edge(s));
    const localRise = heightC(hill.x, hill.z) - y;
    if (rise < 1.0 || localRise < .50 || y < 0) continue;
    wallCandidates.push({ s, side, u, p, y, h: clamp(localRise + .45, .8, 2.5) });
  }
  let run = [];
  function flushWalls() {
    if (run.length >= 4) for (const q of run) {
      const yaw = yawAt(q.s, q.side), a = route.point(q.s - 1.5, q.u), b = route.point(q.s + 1.5, q.u);
      const sx = (a.distanceTo(b) + .055) / 3;
      const o = { x: q.p.x, z: q.p.z, yaw, hw: 1.53 * sx, hl: .34, wallRun: true };
      if (!clear(o, q.s, q.side, true)) continue;
      const base = Math.min(...corners(o).map(p => heightC(p.x, p.z)));
      emit(models.wall, q.p.x, base, q.p.z, yaw, sx, q.h / 1.56, 1); occupied.push(o);
    }
    run = [];
  }
  for (const q of wallCandidates) { if (run.length && (q.s - run.at(-1).s > 3.1 || q.side !== run.at(-1).side)) flushWalls(); run.push(q); }
  flushWalls();
  for (const sets of pools.values()) for (const pool of sets) {
    pool.build(group); stats.meshes += pool.meshes.length;
    for (const mesh of pool.meshes) { mesh.name = 'roadside instances'; stats.instances += mesh.count; }
  }
  stats.obstacles = obstacles.length; stats.maxMainPassDrawCalls = stats.meshes;
  group.userData.roadside = stats; group.userData.placements = placements;
  scene.add(group);
  return { group, obstacles };
}
