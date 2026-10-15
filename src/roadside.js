// Street-level Athens Riviera furniture. All dimensions are metres.
// Reference shapes (viewed as reference only; no third-party images are shipped):
// https://2steps.gr/index.asp?xkey=3680 — Limanakia limestone, timber kiosk and access steps.
// https://www.lifo.gr/guide/nightlife/recommendations/mojito-bay — Lomvarda beach bar.
// https://commons.wikimedia.org/wiki/File:OASA_stop_3.png — blue/white OASA stop plate.
// https://www.holprop.com/sale/villa-house/greece/attica/varkiza-vari/ — villa boundary walls.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CellInstances, GeoBatch, M, RNG, clamp, canvasTex, pointInPoly } from './util.js';
import { ROAD } from './road.js';
import { TX } from './tex.js';

const CELL = 180;
const WHITE = '#e9e7de', BLUE = '#175997', IRON = '#323f43', STEEL = '#a8afb0';

function materials() {
  const pbr = (roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, ...extra });
  const scanned = (key) => pbr(.9, 0, TX[key + '_diff'] ? { map: TX[key + '_diff'], normalMap: TX[key + '_nor'], normalScale: new THREE.Vector2(.45, .45) } : {});
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
    const g = bevel ? new RoundedBoxGeometry(w, h, d, 1, Math.min(bevel, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d);
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
    this.batches.clear(); return this;
  }
}

function shelter(mats) {
  const m = new Model('shelter', mats, { hw: 2.28, hl: 1.03 });
  m.box('concrete', 0, -.09, 0, 4.5, .22, 2.0, '#b7b4a9', .025);
  for (const x of [-2, 2]) for (const z of [-.72, .72]) {
    m.box('metal', x, 1.22, z, .075, 2.44, .075, IRON, .009);
    m.box('metal', x, .06, z, .20, .05, .20, STEEL, .01);
    for (const dx of [-.065, .065]) m.rod('metal', [x + dx, .08, z], [x + dx, .097, z], .016, IRON);
    m.solid(x, z, .065, .065);
  }
  m.box('metal', 0, 2.45, 0, 4.5, .11, 1.98, IRON, .035);
  m.box('paint', 0, 2.54, 0, 4.55, .085, 2.02, '#c5cccf', .035);
  m.box('paint', 0, 2.36, .98, 4.48, .22, .035, BLUE, .01);
  m.label(0, 0, 2.36, 1.003, 3.35, .19);
  // Rear panes and short side wings; the street-facing side stays open.
  for (const x of [-1.31, 0, 1.31]) {
    m.box('glass', x, 1.29, -.73, 1.24, 1.88, .018, '#b4d4d9');
    m.box('metal', x - .64, 1.28, -.74, .028, 2.0, .035, STEEL);
    for (const y of [1.02, 1.12]) m.box('paint', x, y, -.713, 1.20, .023, .009, WHITE);
  }
  m.box('glass', -2, 1.29, -.12, .018, 1.88, 1.2, '#b4d4d9');
  m.box('paint', 1.99, 1.31, -.11, .055, 1.83, 1.17, BLUE, .02);
  m.label(1, 1.958, 1.77, -.11, .93, .25, -Math.PI / 2);
  m.label(6, 1.957, 1.39, -.11, .94, .25, -Math.PI / 2);
  m.solid(0, -.74, 2.04, .035); m.solid(-2, -.12, .04, .61); m.solid(2, -.12, .05, .61);
  for (const x of [-1.05, 1.05]) {
    m.box('metal', x, .26, -.37, .065, .46, .42, IRON, .014);
    m.box('metal', x, .63, -.57, .05, .5, .055, IRON);
  }
  for (let i = 0; i < 5; i++) m.box('metal', 0, .49, -.57 + i * .09, 2.8, .045, .074, '#8f9999', .015);
  for (let i = 0; i < 3; i++) m.box('metal', 0, .70 + i * .09, -.60, 2.8, .065, .035, '#8f9999', .012);
  for (const x of [-1.28, 0, 1.28]) m.rod('metal', [x, .49, -.16], [x, .73, -.16], .022, IRON);
  m.solid(0, -.37, 1.43, .27);
  return m.finish();
}

function stopPole(mats, parking = false) {
  const m = new Model(parking ? 'parking' : 'stop', mats, { hw: .35, hl: .2 });
  m.rod('metal', [0, -.12, 0], [0, 2.85, 0], .035, '#b8bfc0');
  m.box('concrete', 0, -.07, 0, .28, .23, .28, '#b2aea5', .03);
  m.box('paint', 0, 2.57, 0, .62, parking ? .65 : .73, .045, WHITE, .045);
  if (parking) { m.label(2, 0, 2.57, .026, .56, .59); m.label(2, 0, 2.57, -.026, .56, .59, Math.PI); }
  else for (const side of [-1, 1]) {
    m.label(0, 0, 2.80, side * .026, .57, .19, side < 0 ? Math.PI : 0);
    m.label(1, 0, 2.57, side * .026, .57, .20, side < 0 ? Math.PI : 0);
    m.label(6, 0, 2.35, side * .026, .57, .16, side < 0 ? Math.PI : 0);
  }
  if (!parking) m.box('paint', 0, 1.83, 0, .24, .42, .09, BLUE, .015);
  m.solid(0, 0, .14, .14); return m.finish();
}

function bin(mats) {
  const m = new Model('bin', mats, { hw: .36, hl: .36 });
  m.rod('metal', [0, .12, 0], [0, .83, 0], .255, '#486e67', .30, 16);
  m.rod('metal', [0, .80, 0], [0, .86, 0], .32, IRON, .32, 16);
  m.rod('rubber', [0, .857, 0], [0, .865, 0], .255, '#161d1c', .255, 16);
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; m.rod('metal', [Math.cos(a) * .258, .16, Math.sin(a) * .258], [Math.cos(a) * .300, .78, Math.sin(a) * .300], .009, '#73908a'); }
  for (const x of [-.32, .32]) m.box('metal', x, .43, 0, .035, .86, .045, IRON, .007);
  m.box('concrete', 0, -.045, 0, .70, .13, .52, '#aaa99e', .025);
  m.solid(0, 0, .35, .32); return m.finish();
}

function canteen(mats) {
  const m = new Model('canteen', mats, { hw: 2.85, hl: 1.75 });
  m.box('metal', 0, .49, 0, 4.7, .14, 2.12, IRON, .03);
  m.box('paint', 0, 1.0, 0, 4.55, .84, 2.06, '#e7e2cc', .07);
  m.box('paint', 0, 1.87, -.98, 4.55, 1.65, .10, WHITE, .035);
  for (const x of [-2.2, 2.2]) m.box('paint', x, 1.89, 0, .13, 1.67, 2.06, WHITE, .03);
  m.box('rubber', 0, 1.42, .89, 3.65, .16, .045, '#272d27');
  m.box('paint', 0, 2.60, 0, 4.65, .22, 2.16, WHITE, .055);
  m.box('paint', 0, .95, 1.035, 4.50, .18, .024, '#487c77');
  m.box('metal', 0, 1.38, 1.15, 3.88, .07, .55, STEEL, .028);
  m.box('paint', 0, 2.42, 1.10, 3.95, .065, 1.25, '#c5c7b7', .025, -.17);
  for (const x of [-1.86, 1.86]) m.rod('metal', [x, 1.42, 1.01], [x, 2.46, 1.64], .019, STEEL);
  m.label(3, 0, 2.60, 1.084, 2.60, .18);
  m.label(5, 0, 1.12, 1.052, 2.9, .21);
  m.box('paint', 1.63, 1.71, -.51, .51, 1.1, .55, WHITE, .025);
  m.box('glass', 1.63, 1.76, -.226, .39, .73, .016, '#94bec5');
  for (let i = 0; i < 6; i++) m.rod('paint', [-.8 + i * .19, 1.43, -.62], [-.8 + i * .19, 1.68, -.62], .045, i % 2 ? '#497d68' : '#b8883e');
  for (const x of [-1.3, 1.3]) for (const z of [-1.06, 1.06]) {
    m.rod('rubber', [x, .36, z - .12], [x, .36, z + .12], .35, '#252b2b', .35, 16);
    m.rod('metal', [x, .36, z - .135], [x, .36, z + .135], .17, '#a4a8a3', .17, 12);
    m.box('paint', x, .68, z, .90, .10, .32, WHITE, .045);
  }
  m.rod('metal', [-2.2, .43, -.72], [-2.78, .4, 0], .035, STEEL);
  m.rod('metal', [-2.2, .43, .72], [-2.78, .4, 0], .035, STEEL);
  for (const x of [-2, 2]) m.rod('metal', [x, -.10, -.8], [x, .50, -.8], .025, STEEL);
  m.solid(0, 0, 2.35, 1.20); m.solid(-2.58, 0, .25, .40);
  return m.finish();
}

function shack(mats) {
  const m = new Model('shack', mats, { hw: 2.85, hl: 2.22 });
  m.box('wood', 0, .06, 0, 5.4, .20, 3.8, '#86755b', .025);
  for (let i = 0; i < 23; i++) m.box('wood', -2.58 + i * .235, .18, 0, .222, .04, 3.75, i % 3 ? '#aa9371' : '#bdab86', .007);
  for (const x of [-2.47, 2.47]) for (const z of [-1.65, 1.65]) m.box('wood', x, 1.46, z, .14, 2.90, .14, '#b5a384', .018);
  m.box('wood', 0, 1.5, -1.65, 4.95, 2.65, .12, '#81745a');
  for (let i = 0; i < 27; i++) m.box('wood', -2.4 + i * .185, 1.5, -1.575, .17, 2.6, .045, i % 4 ? '#a59779' : '#c0b497', .005);
  for (const x of [-2.46, 2.46]) m.box('wood', x, .76, 0, .12, 1.15, 3.25, '#a58d6b');
  m.box('wood', 0, .80, 1.38, 4.95, 1.20, .13, '#849686');
  for (let i = 0; i < 27; i++) m.box('wood', -2.40 + i * .185, .80, 1.46, .168, 1.15, .045, i % 3 ? '#92a49a' : '#b1beb0', .006);
  m.box('wood', 0, 1.43, 1.44, 5.16, .11, .61, '#d2c3a3', .035);
  m.box('wood', 0, 2.87, 0, 5.65, .12, 4.34, '#a28a65', .025, -.04);
  for (let i = 0; i < 57; i++) m.rod('wood', [-2.77 + i * .098, 2.88, -2.15], [-2.77 + i * .098, 3.05, 2.15], .036, i % 3 ? '#bdaa80' : '#8c7957', .028, 6);
  m.box('wood', 0, 2.65, 1.70, 4.96, .30, .06, '#d0c09d', .02);
  m.label(4, 0, 2.65, 1.736, 4.40, .25);
  m.box('wood', 0, 1.52, -1.45, 3.5, .07, .35, '#c7b18a');
  for (let i = 0; i < 9; i++) m.rod('paint', [-1.4 + i * .31, 1.57, -1.4], [-1.4 + i * .31, 1.9, -1.4], .04, i % 3 ? '#4c7967' : '#a47c45');
  m.label(5, 0, 1.99, -1.57, 2.1, .25);
  m.solid(0, 0, 2.55, 1.90); return m.finish();
}

function wall(mats) {
  const m = new Model('wall', mats, { hw: 1.53, hl: .34 }), rng = new RNG(712);
  // Recessed mortar joints, staggered irregular limestone courses and projecting coping.
  m.box('concrete', 0, .66, 0, 3.03, 1.68, .48, '#99968b');
  for (let row = 0; row < 5; row++) {
    let x = -1.50;
    while (x < 1.49) {
      const w = Math.min(rng.range(.32, .77), 1.50 - x);
      if (w < .03) break;
      m.box('stone', x + w / 2, -.11 + row * .305 + .15, 0, w - .018, .285, rng.range(.52, .59), rng.pick(['#b3b3a8', '#bdbbb0', '#a5aaa5', '#c5c2b5']), .035);
      x += w;
    }
  }
  for (let x = -1.125; x < 1.5; x += .75) m.box('concrete', x, 1.49, 0, .744, .14, .65, '#c3c1b4', .018);
  m.solid(0, 0, 1.52, .33); return m.finish();
}

function villa(mats) {
  const m = new Model('villa', mats, { hw: 3.12, hl: .36 });
  m.box('plaster', 0, .32, 0, 6.12, .85, .36, '#eeeee2', .035);
  m.box('concrete', 0, .78, 0, 6.15, .09, .45, '#dedccd', .018);
  for (const x of [-3, 0, 3]) {
    m.box('plaster', x, .79, 0, .30, 1.80, .38, WHITE, .025);
    m.box('concrete', x, 1.71, 0, .40, .10, .47, '#e4e0d3', .025);
  }
  for (const x of [-1.5, 1.5]) for (const y of [.97, 1.52]) m.box('metal', x, y, 0, 2.8, .038, .038, IRON, .005);
  for (let i = 0; i < 30; i++) {
    const x = -2.87 + i * .198;
    if (Math.abs(x) < .2 || Math.abs(x) > 2.85) continue;
    m.box('metal', x, 1.21, 0, .020, .84, .024, IRON, .004);
    m.rod('metal', [x, 1.63, 0], [x, 1.72, 0], .042, IRON, 0, 4);
    if (i % 3 === 0) m.add('metal', new THREE.TorusGeometry(.095, .012, 5, 12), M(x + .098, 1.25, 0), IRON);
  }
  m.solid(0, 0, 3.10, .25); return m.finish();
}

function stairs(mats, tops = null, bottoms = null) {
  const n = 18, run = .31;
  tops ||= Array.from({ length: n }, (_, i) => -i * .17);
  bottoms ||= tops.map(y => y - .42);
  const m = new Model('stairs', mats, { hw: 1.05, hl: n * run / 2, z: n * run / 2 });
  for (let i = 0; i < n; i++) {
    const h = Math.max(.18, tops[i] - bottoms[i]);
    m.box('concrete', 0, tops[i] - h / 2, i * run + run / 2, 1.9, h, run + .012, i % 4 ? '#bebcb0' : '#aaa99c', .013);
    m.box('stone', 0, tops[i] + .013, i * run + .05, 1.89, .027, .12, '#cecec1', .008);
  }
  for (const x of [-.87, .87]) {
    for (let i = 0; i < n; i += 3) {
      const z = i * run + .10, y = tops[i];
      m.rod('metal', [x, y, z], [x, y + 1.02, z], .025, STEEL);
      m.box('metal', x, y + .026, z, .13, .025, .13, IRON, .008);
    }
    for (let i = 0; i < n - 1; i++) for (const h of [.56, 1.02]) m.rod('metal', [x, tops[i] + h, i * run + .10], [x, tops[i + 1] + h, (i + 1) * run + .10], .023, STEEL);
  }
  m.solid(0, n * run / 2, .98, n * run / 2); return m.finish();
}

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
  const group = new THREE.Group(); group.name = 'Greek residential roadside';
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
  // Short villa boundary runs leave driveways and mapped junctions open.
  const villaRanges = route.streetCircuit ? [{from:20,to:route.length-20,sides:[-1,1]}] : Number.isFinite(marks.varkiza) ? [{from:Math.max(0,marks.varkiza-370),to:Math.min(route.length,marks.varkiza+440)}] : [];
  for (const range of villaRanges) for (let s=range.from;s<range.to;s+=29) {
    if(route.urban(s)<.45)continue;
    for(const side of range.sides || [-seaSide(s)]) {
      if(map.roadNetwork?.mouth(s,side,12))continue;
      if((data.sideRoads||[]).some(r=>Number.isFinite(r.s)&&Math.abs(r.s-s)<12))continue;
      for(const ds of [-3,3]) {
        const ss=s+ds,u=side*(route.edge(ss)+ROAD.gutter+ROAD.sidewalk(route,ss,side)+1.35);
        place('villa',ss,u,{slope:route.streetCircuit?1.2:.42});
      }
    }
  }
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
