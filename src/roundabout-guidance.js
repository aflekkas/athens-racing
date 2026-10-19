// One-way guidance at Psychiko's roundabouts: white counter-clockwise arrows painted on every ring, a give-way
// line across each legal entry, and a Greek P-1 (give way) over P-40 (mandatory roundabout) sign beside it.
// Mini-roundabouts get a painted centre and arrows. Everything is one vertex-coloured mesh: a single draw call.
import * as THREE from 'three';
import { GeoBatch, M } from './util.js';
import { ringPoint, ringStation } from './roundabouts.js';

const WHITE = new THREE.Color('#e9e7df'), BLUE = new THREE.Color('#1f56a8'), RED = new THREE.Color('#c8261f'), POST = new THREE.Color('#7c858a');
const PAINT_LIFT = .03;

// Flat painted triangles: each vertex sits on the real road surface (slopes, ring planes, crowns).
function paint(batch, surface, tris) {
  for (const [a, b, c] of tris) {
    const pts = [a, b, c].map(([x, z]) => [x, surface(x, z) + PAINT_LIFT, z]);
    const ux = pts[1][0] - pts[0][0], uz = pts[1][2] - pts[0][2], vx = pts[2][0] - pts[0][0], vz = pts[2][2] - pts[0][2];
    if (ux * vz - uz * vx > 0) pts.reverse(); // face up
    for (const p of pts) { batch.pos.push(...p); batch.nor.push(0, 1, 0); batch.col.push(WHITE.r, WHITE.g, WHITE.b); batch.uv.push(0, 0); }
  }
}
// A 2.8 m straight arrow along (tx,tz), centred at (x,z).
function arrowTris(x, z, tx, tz, scale = 1) {
  const rx = -tz, rz = tx, at = (f, s) => [x + (tx * f + rx * s) * scale, z + (tz * f + rz * s) * scale];
  return [[at(-1.4, -.15), at(.35, -.15), at(.35, .15)], [at(-1.4, -.15), at(.35, .15), at(-1.4, .15)], [at(.35, -.5), at(1.4, 0), at(.35, .5)]];
}
/** evenly spaced arrows along a CCW ring polyline, each pointing with circulation */
export function ringArrowPlacements(p) {
  const length = ringStation(...p[0], p).length, count = Math.max(3, Math.round(length / 28));
  return Array.from({ length: count }, (_, k) => ringPoint(p, (k + .5) * length / count, {}));
}
function ringArrows(batch, surface, p, scale = 1) { for (const q of ringArrowPlacements(p)) paint(batch, surface, arrowTris(q.x, q.z, q.tx, q.tz, scale)); }
// Dashed give-way line across the entering half of an arm (all of it on a one-way entry), just outside the ring.
function giveWay(batch, surface, e, offset, half) {
  const cx = e.x + e.dx * offset, cz = e.z + e.dz * offset, rx = e.dz, rz = -e.dx; // right of the approaching driver
  for (let s = e.oneway ? -half : 0; s < half - .25; s += 1) {
    const a = s + .1, b = Math.min(half, s + .6), at = (u, d) => [cx + rx * u + e.dx * d, cz + rz * u + e.dz * d];
    paint(batch, surface, [[at(a, 0), at(b, 0), at(b, .3)], [at(a, 0), at(b, .3), at(a, .3)]]);
  }
}
const signGeometry = (() => {
  const b = new GeoBatch(), add = (g, m, c) => { b.add(g, m, c); g.dispose(); }, BACK = POST;
  add(new THREE.BoxGeometry(.07, 2.5, .07), M(0, 1.25, 0), POST);
  // P-40: blue disc, three white CCW arrows (as seen by the approaching driver, who looks along -z).
  add(new THREE.CircleGeometry(.33, 16), M(0, 1.95, .045), BLUE);
  add(new THREE.CircleGeometry(.33, 16), M(0, 1.95, .04, 0, Math.PI, 0), BACK);
  // The approaching driver faces the sign's +z side with local +x to their right: counter-clockwise in local x/y.
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3, x = Math.cos(a) * .17, y = 1.95 + Math.sin(a) * .17;
    add(new THREE.PlaneGeometry(.14, .045), M(x, y, .05, 0, 0, a + Math.PI / 2), WHITE);
    add(new THREE.CircleGeometry(.06, 3), M(x - Math.sin(a) * .08, y + Math.cos(a) * .08, .05, 0, 0, a + Math.PI / 2), WHITE);
  }
  // P-1 give way: red-bordered white point-down triangle above it.
  add(new THREE.CircleGeometry(.42, 3), M(0, 2.62, .045, 0, 0, -Math.PI / 2), RED);
  add(new THREE.CircleGeometry(.3, 3), M(0, 2.62, .05, 0, 0, -Math.PI / 2), WHITE);
  add(new THREE.CircleGeometry(.42, 3), M(0, 2.62, .04, 0, Math.PI, -Math.PI / 2), BACK);
  return b;
})();
function sign(batch, ground, x, z, dx, dz) {
  const g = signGeometry, y = ground(x, z), yaw = Math.atan2(dx, dz), m = M(x, y, z, 0, yaw, 0), n = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
  for (let i = 0; i < g.pos.length; i += 3) {
    v.set(g.pos[i], g.pos[i + 1], g.pos[i + 2]).applyMatrix4(m); batch.pos.push(v.x, v.y, v.z);
    v.set(g.nor[i], g.nor[i + 1], g.nor[i + 2]).applyMatrix3(n).normalize(); batch.nor.push(v.x, v.y, v.z);
  }
  batch.col.push(...g.col); batch.uv.push(...g.uv);
}
export const SIGN_TRIANGLES = signGeometry.pos.length / 9;

/** the CCW circle a mini-roundabout's arrows follow (negative x/z signed area is counter-clockwise on the map) */
export const miniRing = q => Array.from({ length: 12 }, (_, k) => { const a = -k * Math.PI / 6; return [q.x + Math.cos(a) * (q.r + 1.6), q.z + Math.sin(a) * (q.r + 1.6)]; });

/** guidance records live in map.data.psychiko (tools/maps/psychiko/build.mjs) */
export function buildRoundaboutGuidance(map, ground, material) {
  const net = map.roadNetwork, route = map.route, data = map.data.psychiko;
  if (!net || !data?.roundaboutGuidance) return null;
  const surface = (x, z) => { if (net.mainInside(x, z)) { const q = net.project(x, z); return route.surfaceY(q.s, q.u); } return net.height(x, z); };
  const paved = (x, z) => net.mainInside(x, z) || net.sample(x, z)?.surf === 'asphalt';
  const rings = new Map((map.data.roadNetwork.roundabouts || []).map(q => [q.id, q])), batch = new GeoBatch();
  const entry = (e, offset) => {
    let half = 1; while (half < 8 && paved(e.x + e.dx * (offset + .5) + e.dz * (half + .25), e.z + e.dz * (offset + .5) - e.dx * (half + .25))) half += .25;
    giveWay(batch, surface, e, offset, half);
    // The sign stands on the footway to the approaching driver's right, facing them.
    const d = offset + 3, x = e.x + e.dx * d + e.dz * (half + 1), z = e.z + e.dz * d - e.dx * (half + 1);
    sign(batch, ground, x, z, e.dx, e.dz);
  };
  let signs = 0, arrows = 0;
  for (const g of data.roundaboutGuidance) {
    const ring = rings.get(g.id); if (!ring) continue;
    ringArrows(batch, surface, ring.p); arrows++;
    for (const e of g.entries) { entry(e, ring.w / 2 + .4); signs++; }
  }
  for (const q of data.miniRoundabouts || []) {
    // Painted, mountable centre (no raised island) and three small CCW arrows around it.
    const disc = []; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, b = (k + 1) * Math.PI / 8; disc.push([[q.x, q.z], [q.x + Math.cos(a) * q.r, q.z + Math.sin(a) * q.r], [q.x + Math.cos(b) * q.r, q.z + Math.sin(b) * q.r]]); }
    paint(batch, surface, disc);
    ringArrows(batch, surface, miniRing(q), .55); arrows++;
    for (const e of q.entries) { entry(e, q.r + 3.4); signs++; }
  }
  const mesh = batch.build ? new THREE.Mesh(batch.build(), material) : null;
  if (!mesh) return null;
  mesh.name = 'roundabout-guidance'; mesh.castShadow = false; mesh.receiveShadow = true;
  return { mesh, signs, arrows, triangles: batch.pos.length / 9 };
}
