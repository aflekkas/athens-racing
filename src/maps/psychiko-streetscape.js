// Psychiko streetscape from the compact survey-based records (tools/maps/psychiko/scenery.mjs): garden and campus
// boundaries, umbrella pines / cypresses / broadleaf / palms, kerb parking rows, green goosenecks and utility poles
// with overhead wires, zebra crossings, and tiled roofs on the pitched-flag buildings.
// Blocky low-poly merged geometry, streamed in camera-centred cells: one draw call per cell and only nearby cells
// resident (ranges follow the draw-distance class), so memory and draw calls stay bounded. World detail Off hides it.
import * as THREE from 'three';
import { stoneTexture, recognitionAssets, indexRecognition, drawRecognition } from './psychiko-recognition.js';
import { settings, onSettings } from '../settings.js';
import { drawScale } from '../scenery.js';
import { blockFootprint } from '../buildings.js';
import { polyArea } from '../util.js';
import { assertWorldBudget } from '../world-art-direction.js';

const C = new THREE.Color();
/** Growable flat-shaded triangle soup: float positions, normalised byte normals and colours. */
class Mesher {
  constructor(n = 4096) { this.p = new Float32Array(n * 3); this.n = new Int8Array(n * 3); this.c = new Uint8Array(n * 3); this.st = new Uint8Array(n); this.stone = 0; this.v = 0; }
  grow() { const k = this.p.length * 2, p = new Float32Array(k), n = new Int8Array(k), c = new Uint8Array(k); p.set(this.p); n.set(this.n); c.set(this.c); const st = new Uint8Array(k / 3); st.set(this.st); this.st = st; this.p = p; this.n = n; this.c = c; }
  /** One flat triangle; with `inside` ([x,y,z] behind the face) the winding is flipped so the face looks away from it. */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, color, inside = null) {
    if ((this.v + 3) * 3 > this.p.length) this.grow();
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx = nx / l * 127; ny = ny / l * 127; nz = nz / l * 127;
    if (inside && nx * ((ax + bx + cx) / 3 - inside[0]) + ny * ((ay + by + cy) / 3 - inside[1]) + nz * ((az + bz + cz) / 3 - inside[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; [bx, by, bz, cx, cy, cz] = [cx, cy, cz, bx, by, bz]; }
    C.set(color); const r = C.r * 255, g = C.g * 255, b = C.b * 255;
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) { const i = this.v++ * 3; this.st[i / 3] = this.stone; this.p[i] = x; this.p[i + 1] = y; this.p[i + 2] = z; this.n[i] = nx; this.n[i + 1] = ny; this.n[i + 2] = nz; this.c[i] = r; this.c[i + 1] = g; this.c[i + 2] = b; }
  }
  quad(a, b, c, d, color, inside = null) { this.tri(...a, ...b, ...c, color, inside); this.tri(...a, ...c, ...d, color, inside); }
  /** Copy a template ({p,n,c} soup in model space) rotated by yaw, scaled and translated. */
  add(t, x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx, tint = 1) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw), count = t.p.length / 3;
    while ((this.v + count) * 3 > this.p.length) this.grow();
    for (let k = 0; k < count; k++) {
      const j = k * 3, i = this.v++ * 3, px = t.p[j] * sx, pz = t.p[j + 2] * sz, nx = t.n[j], nz = t.n[j + 2];
      this.st[i / 3] = 0; this.p[i] = x + px * cs + pz * sn; this.p[i + 1] = y + t.p[j + 1] * sy; this.p[i + 2] = z - px * sn + pz * cs;
      this.n[i] = nx * cs + nz * sn; this.n[i + 1] = t.n[j + 1]; this.n[i + 2] = -nx * sn + nz * cs;
      if (tint === 1) { this.c[i] = t.c[j]; this.c[i + 1] = t.c[j + 1]; this.c[i + 2] = t.c[j + 2]; }
      else { this.c[i] = Math.min(255, t.c[j] * tint); this.c[i + 1] = Math.min(255, t.c[j + 1] * tint); this.c[i + 2] = Math.min(255, t.c[j + 2] * tint); }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry(), n = this.v * 3;
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.n.slice(0, n), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.slice(0, n), 3, true));
    g.setAttribute('aStone', new THREE.BufferAttribute(this.st.slice(0,this.v),1,true));
    g.computeBoundingSphere(); return g;
  }
}
/** Ring prism / cone helper in model space: rings [[y, radius], ...], n sides, optional colour per band. */
function lathe(m, rings, n, colors, jitter = null, ox = 0, oz = 0) {
  const ys = rings.map(r => r[0]), inside = [ox, (Math.min(...ys) + Math.max(...ys)) / 2, oz];
  const pt = (k, r, y) => { const a = (k % n) / n * Math.PI * 2, j = jitter ? jitter(k % n, y) : 1; return [ox + Math.sin(a) * r * j, y, oz + Math.cos(a) * r * j]; };
  for (let b = 0; b + 1 < rings.length; b++) {
    const [y0, r0] = rings[b], [y1, r1] = rings[b + 1], color = colors[Math.min(b, colors.length - 1)];
    for (let k = 0; k < n; k++) {
      if (r0 === 0) m.tri(...pt(k, 0, y0), ...pt(k + 1, r1, y1), ...pt(k, r1, y1), color, inside);
      else if (r1 === 0) m.tri(...pt(k, r0, y0), ...pt(k + 1, r0, y0), ...pt(k, 0, y1), color, inside);
      else m.quad(pt(k, r0, y0), pt(k + 1, r0, y0), pt(k + 1, r1, y1), pt(k, r1, y1), color, inside);
    }
  }
}
/** Axis box in model space without its bottom face (5 faces, 10 triangles); `top` may differ from the side colour. */
function box(m, x, y, z, w, h, d, color, top = color, ox = 0) {
  const x0 = x - w / 2 + ox, x1 = x + w / 2 + ox, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h, c = [x + ox, y + h / 2, z];
  m.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, c);
  m.quad([x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1], color, c);
  m.quad([x1, y, z0], [x0, y, z0], [x0, y1, z0], [x1, y1, z0], color, c);
  m.quad([x1, y, z1], [x1, y, z0], [x1, y1, z0], [x1, y1, z1], color, c);
  m.quad([x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0], color, c);
}
const template = (build, budget) => { const m = new Mesher(256); build(m); if (budget) { const g = m.geometry(); assertWorldBudget(budget, g); g.dispose(); } return { p: m.p.slice(0, m.v * 3), n: m.n.slice(0, m.v * 3), c: m.c.slice(0, m.v * 3) }; };
const hash = (...v) => { let h = 0x9e3779b9; for (const x of v) { h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; } return (h >>> 0) / 4294967296; };

// Unit-height tree templates (scaled per tree). Species: 0 umbrella pine, 1 cypress, 2 broadleaf, 3 palm, 4 small/pollard, 5 shrub.
const TRUNK = '#6f5f4a';
function treeTemplates() {
  const pine = v => template(m => {
    // Tall bare trunk with a slight lean, flat irregular umbrella crown high up (Pinus pinea), sometimes a second lobe.
    const lean = (v - 1) * .05; lathe(m, [[0, .022], [.8, .016]], 3, [TRUNK], null, 0, lean);
    const jit = (k, y) => .82 + .36 * hash(v, k, y > .8 ? 1 : 0);
    lathe(m, [[.71, 0], [.79, .36], [.83, .3], [.88, 0]], 8, ['#435e36', '#4b6a3c', '#5b7b46'], jit, 0, lean * 1.1);
    if (v === 1) lathe(m, [[.66, 0], [.72, .2], [.78, 0]], 6, ['#3f5a33', '#4f6d3d'], jit, .2, lean - .12);
  }, 'streetProp');
  return [
    [pine(0), pine(1), pine(2)],
    [template(m => lathe(m, [[.04, .055], [.38, .085], [1, 0]], 6, ['#34492c', '#3e5734']), 'streetProp')],
    [0, 1].map(v => template(m => { lathe(m, [[0, .035], [.48, .028]], 3, [TRUNK]); const jit = (k, y) => .78 + .44 * hash(k, v, y > .6 ? 2 : 3);
      lathe(m, [[.36, 0], [.48, .3], [.78, .32], [1, 0]], 6, ['#556e42', '#5f7a48', '#6d8a52'], jit); }, 'streetProp')),
    [template(m => { lathe(m, [[0, .028], [.86, .02]], 3, ['#8b7b5e']);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, s = Math.sin(a), c = Math.cos(a), w = .05, tip = [s * .34, .74, c * .34], l = [-c * w, .87, s * w], r = [c * w, .87, -s * w];
        m.tri(l[0], l[1], l[2], ...tip, r[0], r[1], r[2], '#6f8a45'); m.tri(r[0], r[1], r[2], ...tip, l[0], l[1], l[2], '#5d7639'); } }, 'streetProp')],
    [template(m => { lathe(m, [[0, .06], [.5, .05]], 3, ['#7c6d58']); lathe(m, [[.4, 0], [.52, .3], [.8, .3], [1, 0]], 6, ['#7b8a68', '#86967a', '#95a382'], (k, y) => .85 + .3 * hash(k, y > .6 ? 4 : 5)); }, 'streetProp')],
    [0, 1].map(v => template(m => lathe(m, [[0, .34], [.45, .52], [1, 0]], 5, ['#43603c', '#53704a'], (k, y) => .8 + .4 * hash(k, v, y > .5 ? 6 : 7)), 'streetProp')),
  ];
}
// Kerb car (≈5 m bay), gooseneck lamp, utility pole with side arm.
const CAR_COLORS = ['#c9ccce', '#e8e8e4', '#5d6266', '#1f2326', '#2b3a55', '#8f2a26', '#b9ad93', '#3d4a3f', '#d8d4c8', '#a7abad'];
const carTemplates = () => CAR_COLORS.map(color => template(m => {
  box(m, 0, .1, 0, 1.6, .26, 3.85, '#1c1e20');
  box(m, 0, .36, 0, 1.74, .5, 4.1, color);
  box(m, 0, .86, -.1, 1.5, .46, 2.15, '#33393e', color);
  box(m, 0, .86, 1.05, 1.66, .06, .5, color);
}, 'streetProp'));
const gooseneck = () => template(m => {
  box(m, 0, 0, 0, .34, .45, .34, '#2f4a3b');
  lathe(m, [[.45, .075], [4.7, .055]], 5, ['#2f4a3b']);
  box(m, 0, 4.62, .28, .1, .1, .62, '#2f4a3b'); box(m, 0, 4.72, .62, .1, .45, .1, '#2f4a3b');
  lathe(m, [[4.55, .2], [4.78, .12], [4.95, 0]], 6, ['#efe6c8', '#e6dcbc'], null, 0, .62);
}, 'lamp');
const utilityPole = () => template(m => {
  lathe(m, [[0, .14], [8.6, .09]], 4, ['#9b9a92']);
  box(m, 0, 8.05, 0, 1.2, .1, .1, '#6c6b65');
  box(m, 0, 6.3, .7, .08, .08, 1.4, '#77787a'); box(m, 0, 6.18, 1.45, .22, .14, .5, '#d9d8cc', '#8a8b88');
}, 'lamp');

// Boundary run pieces: [base colour, base height share, top colour, top thickness, base thickness].
const WALL = {
  0: { base: ['#ebe4d2', '#f1eee6', '#e3d9c3'], baseH: 1.05, top: '#2d3a32', topT: .05, t: .3 },
  1: { base: ['#b8a98c'], baseH: .35, top: '#4b6838', topT: .95, t: .35, hedge: true },
  2: { base: ['#c9bea6', '#ddd6c6'], baseH: .45, top: '#283430', topT: .05, t: .28 },
  3: { base: ['#d0c8b5', '#c9c2b1'], baseH: 1, t: .5, cap: '#b9b2a1' },
  4: { base: ['#c9b38e', '#d3bf9c', '#bea883'], baseH: 1, t: .4, cap: '#ab9575' },
  5: { base: ['#ede7d8', '#f3f0e8', '#e0d7c2'], baseH: 1, t: .25, cap: '#cfc6b1' },
  6: { base: ['#262f2b'], baseH: 1, t: .06, posts: '#efece4' },
};

export class PsychikoStreetscape {
  constructor(map, parent, heightC) {
    this.map = map; this.route = map.route; this.network = map.roadNetwork; this.height = map.terrain.sceneryHeight || heightC;
    const scenery = map.data.psychiko?.scenery || {};
    this.group = new THREE.Group(); this.group.name = 'psychiko-streetscape'; parent.add(this.group);
    this.group.worldDetailController = this;
    this.stoneTexture = stoneTexture();
    this.recognitionAssets = recognitionAssets(template,box,lathe);
    this.materials = { props: this.fadeMaterial(260), trees: this.fadeMaterial(420) }; this.cells = new Map(); this.last = { x: Infinity, z: Infinity }; this.obstacles = [];
    this.trees = treeTemplates(); this.cars = carTemplates(); this.lamps = [gooseneck(), utilityPole(), arterialLamp()];
    this.stats = { cells: 0, builds: 0 };
    this.index(scenery);
    this.roofs = null;
    this.enabled = settings.worldDetail !== false; this.group.visible = this.enabled;
    this.unsubscribe = onSettings((s, key) => { if (!key || key === 'worldDetail') this.setEnabled(s.worldDetail !== false); });
  }
  fadeMaterial(range) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), far = { value: range };
    m.userData.far = far; m.customProgramCacheKey = () => 'psychiko-streetscape-rubble-v2';
    // Dithered fade over the last 40 m of the ring, so streamed cells never pop in.
    m.onBeforeCompile = sh => {
      sh.uniforms.uStreetFar = far; sh.uniforms.tStreetStone = {value:this.stoneTexture};
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vStreetWorld; attribute float aStone; varying float vStoneWeight;').replace('#include <project_vertex>', '#include <project_vertex>\nvStreetWorld=(modelMatrix*vec4(transformed,1.)).xyz;vStoneWeight=aStone;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vStreetWorld; uniform float uStreetFar; uniform sampler2D tStreetStone; varying float vStoneWeight;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nif(vStoneWeight>.5){vec2 stoneUV=vec2(abs(dFdx(vStreetWorld.z))+abs(dFdy(vStreetWorld.z))>abs(dFdx(vStreetWorld.x))+abs(dFdy(vStreetWorld.x))?vStreetWorld.z:vStreetWorld.x,vStreetWorld.y)*.42;diffuseColor.rgb*=texture2D(tStreetStone,stoneUV).rgb*1.15;}')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n{if(vStoneWeight>.4&&vStoneWeight<.6&&fract((vStreetWorld.x+vStreetWorld.z)*2.)>.10)discard;float far=uStreetFar;float d=distance(vStreetWorld.xz,cameraPosition.xz);float r=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(r<smoothstep(far-40.,far,d))discard;}');
    };
    return m;
  }
  /** Bucket the records into cells (props 200 m, trees 320 m). Heights are resolved when a cell is built. */
  index(sc) {
    const roads = this.network?.roads || [], valid = sc.roads === roads.length;
    this.props = new Map(); this.canopy = new Map();
    const put = (map, size, x, z, item) => { const k = Math.floor(x / size) + ',' + Math.floor(z / size); let l = map.get(k); if (!l) map.set(k, l = []); l.push(item); };
    const strips = new Map(), strip = ref => { if (strips.has(ref)) return strips.get(ref); let s = null;
      if (ref < 0) s = { at: d => this.route.frame(d, {}), hw: d => this.route.edge(d) + .55, fw: () => .18 + 1.8, vertices: null, length: this.route.length };
      else if (valid && roads[ref]) { const road = roads[ref], segs = []; let L = 0; for (let i = 0; i + 3 < road.p.length; i += 2) { const [x, z, bx, bz] = road.p.slice(i, i + 4), l = Math.hypot(bx - x, bz - z); if (l > .01) segs.push({ s: L, x, z, tx: (bx - x) / l, tz: (bz - z) / l, L: l }); L += l; }
        s = { road, segs, length: L, hw: () => road.w / 2, fw: () => road.urban ? road.fw ?? 1.3 : 0, vertices: segs.map(g => g.s),
          at: d => { let q = segs[0]; for (const g of segs) if (g.s <= d) q = g; else break; const e = Math.min(d - q.s, q.L); return { x: q.x + q.tx * e, z: q.z + q.tz * e, tx: q.tx, tz: q.tz }; } }; }
      strips.set(ref, s); return s; };
    const off = (st, d, u, side) => { const p = st.at(d); return { x: p.x - p.tz * u * side, z: p.z + p.tx * u * side, tx: p.tx, tz: p.tz }; };
    const W = sc.walls || [];
    for (let i = 0, ref = 0, prevSide = 0, end = 0; i < W.length; i += 6) {
      // Delta rows (tools/maps/psychiko/scenery.mjs encode): s0 continues from the previous run on the same strip side.
      const same = W[i] === 0 && W[i + 1] === prevSide; ref += W[i]; prevSide = W[i + 1];
      const a = W[i + 2] + (same ? end : 0), b = a + W[i + 3]; end = b;
      const st = strip(ref); if (!st) continue; const side = W[i + 1], s0 = a / 10, s1 = b / 10, type = W[i + 4], h = W[i + 5] / 10;
      const cuts = [s0]; for (const v of st.vertices || []) if (v > s0 + .5 && v < s1 - .5) cuts.push(v);
      for (let k = 0; k < cuts.length; k++) { const a = cuts[k], b = k + 1 < cuts.length ? cuts[k + 1] : s1, steps = Math.max(1, Math.ceil((b - a) / (st.vertices ? 14 : 6)));
        for (let j = 0; j < steps; j++) { const da = a + (b - a) * j / steps, db = a + (b - a) * (j + 1) / steps, A = off(st, da, st.hw(da) + st.fw(da) + .2, side), B = off(st, db, st.hw(db) + st.fw(db) + .2, side);
          put(this.props, 200, (A.x + B.x) / 2, (A.z + B.z) / 2, { kind: 'wall', A, B, side, type, h, seed: i + j }); } }
    }
    const T = sc.trees || [], trunks = new Map();
    for (let i = 0, hx = 0, hz = 0; i < T.length; i += 3) { hx += T[i]; hz += T[i + 1]; const x = hx / 2, z = hz / 2, sp = Math.floor(T[i + 2] / 100), h = T[i + 2] % 100 / 2;
      if (sp !== 5) put(trunks, 8, x, z, { x, z });
      // Garden shrubs are small: they stream with the near props, trees with the longer canopy ring.
      if (sp === 5) put(this.props, 200, x, z, { kind: 'tree', x, z, sp, h, seed: i }); else put(this.canopy, 320, x, z, { kind: 'tree', x, z, sp, h, seed: i }); }
    const Pk = sc.parking || [];
    for (let i = 0; i < Pk.length; i += 4) {
      const st = strip(Pk[i]); if (!st) continue; const side = Pk[i + 1], s0 = Pk[i + 2] / 10, s1 = Pk[i + 3] / 10, lap = Pk[i] < 0;
      for (let d = s0 + 2.6, n = 0; d <= s1 - 2.4; d += 5.1 + hash(i, n) * 1.2, n++) {
        if (hash(i, n, 3) < .14) continue; // the odd empty bay
        if ((sc.zebras || []).some((ref, j, a) => j % 2 === 0 && ref === Pk[i] && Math.abs(a[j + 1] / 10 - d) < 6)) continue;
        // Side streets: on the asphalt against the kerb. The lap: astride the kerb, just outside the raced width.
        const u = lap ? st.hw(d) + .6 : st.hw(d) - 1 - hash(i, n, 4) * .25, p = off(st, d, u, side), yaw = Math.atan2(p.tx, p.tz) + (side > 0 ? 0 : Math.PI), color = Math.floor(hash(i, n, 5) * CAR_COLORS.length);
        // Check the full oriented body at bends, not just its centre. Keep it off the race lane, every island
        // and other roads' mouths; the generator's longitudinal gaps already protect the own-road junctions.
        const sn = Math.sin(yaw), cs = Math.cos(yaw);
        let treeBay = false;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const t of trunks.get((Math.floor(p.x / 8) + a) + ',' + (Math.floor(p.z / 8) + b)) || []) {
          if (Math.abs((t.x - p.x) * sn + (t.z - p.z) * cs) < 2.5 && Math.abs((t.x - p.x) * cs - (t.z - p.z) * sn) < 1.3) treeBay = true;
        }
        if (treeBay) continue; // leave the footway tree pits clear of parked bodies
        if ([-2.08, 0, 2.08].some(f => [-.87, .87].some(r => {
          const x = p.x + sn * f + cs * r, z = p.z + cs * f - sn * r;
          return this.network.islandAt(x, z) || this.network.mainInside(x, z);
        }))) continue;
        put(this.props, 200, p.x, p.z, { kind: 'car', x: p.x, z: p.z, yaw, color, lap: lap && { d, u: (st.hw(d) - .02) * side } });
        this.obstacles.push({ x: p.x, z: p.z, yaw, hl: 2.08, hw: .87 });
      }
    }
    const Po = sc.poles || [], lines = new Map();
    for (let i = 0; i < Po.length; i += 4) {
      const ref = Po[i], st = strip(ref); if (!st) continue; const side = Po[i + 1], d = Po[i + 2] / 10, type = Po[i + 3], u = st.hw(d) + Math.min(.45, st.fw(d) / 2), p = off(st, d, u, side);
      const pole = { kind: 'pole', x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), type, ref, d, onRoute: ref < 0, u: u * side };
      put(this.props, 200, p.x, p.z, pole);
      if (type === 1) { const key = ref + ':' + side, prev = lines.get(key); if (prev && d - prev.d < 45) put(this.props, 200, p.x, p.z, { kind: 'wire', a: prev, b: pole }); lines.set(key, pole); }
    }
    for (const r of this.map.data.psychiko?.arterial?.signals || []) put(this.props, 200, r.x, r.z, { ...r, kind: 'signal' });
    for (const r of this.map.data.psychiko?.arterial?.medians || []) put(this.props, 200, r.x, r.z, { ...r, kind: 'median' });
    indexRecognition(this,put);
    const Z = sc.zebras || [];
    for (let i = 0; i < Z.length; i += 2) { const st = strip(Z[i]); if (!st) continue; const d = Z[i + 1] / 10, p = st.at(d); put(this.props, 200, p.x, p.z, { kind: 'zebra', st, d, ref: Z[i] }); }
  }
  recognition(m,r) { drawRecognition(this,m,r,box,lathe); }
  groundY(x, z) { const n = this.network?.sample(x, z); return n ? n.y : this.height(x, z); }
  buildCell(kind, key) {
    const m = new Mesher(2048), items = (kind === 'props' ? this.props : this.canopy).get(key) || [];
    for (const r of items) this[r.kind](m, r);
    if (!m.v) return null;
    const mesh = new THREE.Mesh(m.geometry(), this.materials[kind]); mesh.name = 'psychiko-streetscape:' + kind + ':' + key;
    mesh.matrixAutoUpdate = false; mesh.updateMatrixWorld(true); this.stats.builds++; return mesh;
  }
  tree(m, r) {
    const set = this.trees[r.sp], t = set[r.seed % set.length], y = this.network.islandAt(r.x, r.z) ? this.network.height(r.x, r.z) - .04 : this.height(r.x, r.z) - .25, s = r.h, wide = r.sp === 0 ? 1 + hash(r.seed) * .25 : r.sp === 1 ? .85 + hash(r.seed) * .4 : 1;
    m.add(t, r.x, y, r.z, hash(r.seed, 1) * 6.283, s * wide, s, s * wide, .86 + hash(r.seed, 2) * .3);
  }
  car(m, r) { m.add(this.cars[r.color], r.x, r.lap ? this.route.point(r.lap.d, r.lap.u).y + .08 : this.network.height(r.x, r.z) - .02, r.z, r.yaw); }
  pole(m, r) {
    const y = r.onRoute ? this.route.point(r.d, r.u).y + .16 : this.groundY(r.x, r.z);
    r.y = y; m.add(this.lamps[r.type], r.x, y, r.z, r.yaw);
  }
  signal(m, r) {
    const y = this.groundY(r.x, r.z);
    m.add(SIGNAL, r.x, y, r.z, r.yaw);
    if(r.hub==='faros')m.add(SIGNAL_ARM,r.x,y,r.z,r.yaw);
  }
  median(m, r) {
    m.add(MEDIAN, r.x, this.groundY(r.x, r.z) + .02, r.z, r.yaw, r.width, 1, r.length);
  }
  wire(m, r) {
    const a = r.a, b = r.b; if (a.y === undefined) a.y = a.onRoute ? this.route.point(a.d, a.u).y + .16 : this.groundY(a.x, a.z); if (b.y === undefined) b.y = b.onRoute ? this.route.point(b.d, b.u).y + .16 : this.groundY(b.x, b.z);
    for (const lift of [8.08, 7.9]) for (const off of [-.5, .5]) {
      if (lift < 8 && off > 0) continue;
      const ca = Math.cos(a.yaw), sa = Math.sin(a.yaw), cb = Math.cos(b.yaw), sb = Math.sin(b.yaw);
      const P = [[a.x + off * ca, a.y + lift, a.z - off * sa], [b.x + off * cb, b.y + lift, b.z - off * sb]], seg = 3, pts = [];
      for (let k = 0; k <= seg; k++) { const t = k / seg; pts.push([P[0][0] + (P[1][0] - P[0][0]) * t, P[0][1] + (P[1][1] - P[0][1]) * t - Math.sin(t * Math.PI) * .45, P[0][2] + (P[1][2] - P[0][2]) * t]); }
      for (let k = 0; k < seg; k++) { const p = pts[k], q = pts[k + 1], d = .025; m.quad([p[0], p[1] - d, p[2]], [q[0], q[1] - d, q[2]], [q[0], q[1] + d, q[2]], [p[0], p[1] + d, p[2]], '#1d2022'); m.quad([q[0], q[1] - d, q[2]], [p[0], p[1] - d, p[2]], [p[0], p[1] + d, p[2]], [q[0], q[1] + d, q[2]], '#1d2022'); }
    }
  }
  zebra(m, r) {
    const st = r.st, p = st.at(r.d), half = st.hw(r.d) - (r.ref < 0 ? .55 : 0) - .4;
    for (let u = -half + .25; u <= half - .25; u += 1) {
      const corners = [[-1.5, u - .25], [1.5, u - .25], [1.5, u + .25], [-1.5, u + .25]].map(([a, b]) => { const x = p.x + p.tx * a - p.tz * b, z = p.z + p.tz * a + p.tx * b;
        return [x, (r.ref < 0 ? this.route.point(r.d + a, b).y : this.network.height(x, z)) + .03, z]; });
      m.quad(corners[0], corners[3], corners[2], corners[1], '#e6e5df', [corners[0][0], corners[0][1] - 1, corners[0][2]]);
    }
  }
  wall(m, r) {
    const w = WALL[r.type], A = r.A, B = r.B, dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz); if (L < .2) return;
    const nx = -dz / L * r.side, nz = dx / L * r.side; // outward (away from the street)
    const ya = this.height(A.x, A.z) - .25, yb = this.height(B.x, B.z) - .25, color = w.base[r.seed % w.base.length];
    // Extruded strip from the street-side face line (A→B) outwards by thickness t between heights h0..h1 above ground.
    const slab = (h0, h1, t, front, top = front, back = true) => {
      const a0 = [A.x, ya + h0, A.z], b0 = [B.x, yb + h0, B.z], a1 = [A.x, ya + h1, A.z], b1 = [B.x, yb + h1, B.z];
      const o = p => [p[0] + nx * t, p[1], p[2] + nz * t], A0 = o(a0), B0 = o(b0), A1 = o(a1), B1 = o(b1);
      const c = [(A.x + B.x) / 2 + nx * t / 2, (ya + yb) / 2 + (h0 + h1) / 2, (A.z + B.z) / 2 + nz * t / 2];
      m.quad(b0, a0, a1, b1, front, c); m.quad(b1, a1, A1, B1, top, c); if (back) m.quad(A0, B0, B1, A1, front, c);
      m.quad(a0, A0, A1, a1, front, c); m.quad(B0, b0, b1, B1, front, c);
    };
    if (r.type === 6) { slab(0, r.h, w.t, w.base[0]); for (const e of [A, B]) m.add(POST, e.x + nx * .1, this.height(e.x, e.z) - .25, e.z + nz * .1, Math.atan2(dx, dz)); return; }
    const school = r.type === 3, baseH = school ? r.h - .72 : w.cap ? r.h : Math.min(r.h, w.baseH);
    m.stone = r.type === 3 || r.type === 4 ? 255 : 0;
    slab(0, baseH - (w.cap ? .12 : 0), w.t, color, color, true);
    if (w.cap) slab(baseH - .12, baseH, w.t + .06, w.cap);
    m.stone = 0;
    if (w.hedge) slab(baseH, r.h, w.topT, w.top, '#5a7843', true);
    else if (w.top || school) {
      const color = school ? '#35483b' : w.top, top = r.h;
      const panel=(h0,h1)=>{const a=[A.x,ya+h0,A.z],b=[B.x,yb+h0,B.z],c=[B.x,yb+h1,B.z],d=[A.x,ya+h1,A.z];m.quad(a,b,c,d,color);m.quad(b,a,d,c,color);};
      panel(baseH,baseH+.045); panel(top-.06,top);
      // Shared cutout rail infill: two-sided panel, 10 triangles per run regardless of its length.
      // Horizontal cap/base remain geometry; openings and slender pickets use the existing material.
      m.stone=127; panel(baseH+.045,top-.06); m.stone=0;
    }
  }
  /** Tiled hipped (or OSM-gabled) roofs on footprints with the pitched flag; flat roofs elsewhere stay as they are. */
  buildRoofs(roofs) {
    const m = new Mesher(8192), tiles = ['#b4583c', '#a64c33', '#bd6644', '#9c4a36', '#b86b4f'];
    let count = 0;
    for (const b of roofs) {
      if (!b.pitched) continue; const p = blockFootprint(b.p), n = p.length / 2; if (n < 3) continue;
      // Minimum-area rectangle over the footprint edges (rotating calipers on the simplified outline).
      let best = null;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, ex = p[j * 2] - p[i * 2], ez = p[j * 2 + 1] - p[i * 2 + 1], l = Math.hypot(ex, ez); if (l < .5) continue; const ux = ex / l, uz = ez / l;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (let k = 0; k < n; k++) { const x = p[k * 2], z = p[k * 2 + 1], a = x * ux + z * uz, c = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, c); b1 = Math.max(b1, c); }
        const area = (a1 - a0) * (b1 - b0); if (!best || area < best.area) best = { area, ux, uz, a0, a1, b0, b1 }; }
      if (!best || Math.abs(polyArea(p)) / best.area < .78 || best.area < 25 || best.area > 900) continue;
      let { ux, uz, a0, a1, b0, b1 } = best; if (a1 - a0 < b1 - b0) { [ux, uz] = [-uz, ux]; [a0, a1, b0, b1] = [b0, b1, -a1, -a0]; }
      const e = .35; a0 -= e; a1 += e; b0 -= e; b1 += e;
      const y = b.top, half = (b1 - b0) / 2, rise = half * .5, gable = b.roof === 'gabled', ridge = gable ? 0 : Math.min(half, (a1 - a0) / 2 - .01);
      const P = (a, c, h) => [a * ux - c * uz, y + h, a * uz + c * ux], mid = (b0 + b1) / 2, color = tiles[Math.abs(b.id | 0) % tiles.length];
      const c00 = P(a0, b0, 0), c10 = P(a1, b0, 0), c11 = P(a1, b1, 0), c01 = P(a0, b1, 0), r0 = P(a0 + ridge, mid, rise), r1 = P(a1 - ridge, mid, rise);
      const inside = P((a0 + a1) / 2, mid, -.5), end = gable ? '#e8e0cc' : color;
      m.quad(c00, r0, r1, c10, color, inside); m.quad(c11, r1, r0, c01, color, inside);
      m.tri(...c01, ...r0, ...c00, end, inside); m.tri(...c10, ...r1, ...c11, end, inside);
      count++;
    }
    const mesh = new THREE.Mesh(m.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 }));
    mesh.name = 'psychiko-tiled-roofs'; mesh.matrixAutoUpdate = false; mesh.updateMatrixWorld(true);
    this.group.add(mesh); this.roofs = mesh; this.stats.roofs = count; return mesh;
  }
  setEnabled(on) {
    if (this.enabled === on) return; this.enabled = on; this.group.visible = on;
    if (!on) { for (const mesh of this.cells.values()) if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); } this.cells.clear(); }
    this.last.x = Infinity; if (this.camera) this.update(this.camera);
  }
  /** Called with the scenery LOD pass (scenery.js updateSceneryLod via worldDetailController). */
  update(camera) {
    this.camera = camera; if (!this.enabled) return;
    const p = camera.position || camera, k = drawScale(), farProps = 260 * k, farTrees = 420 * k;
    this.materials.props.userData.far.value = farProps; this.materials.trees.userData.far.value = farTrees;
    const jump = Math.hypot(p.x - this.last.x, p.z - this.last.z); if (jump < 8) return;
    let budget = jump > 150 ? Infinity : 2; // a teleport builds everything now; driving adds at most two cells per pass
    const want = new Set();
    for (const [kind, size, far] of [['props', 200, farProps], ['trees', 320, farTrees]]) {
      const source = kind === 'props' ? this.props : this.canopy, r = Math.ceil(far / size) + 1, cx = Math.floor(p.x / size), cz = Math.floor(p.z / size);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const key = (cx + i) + ',' + (cz + j); if (!source.has(key)) continue;
        const x0 = (cx + i) * size, z0 = (cz + j) * size, d = Math.hypot(Math.max(x0 - p.x, 0, p.x - x0 - size), Math.max(z0 - p.z, 0, p.z - z0 - size));
        if (d > far) continue; const id = kind + ':' + key; want.add(id);
        if (!this.cells.has(id) && budget > 0) { budget--; const mesh = this.buildCell(kind, key); this.cells.set(id, mesh); if (mesh) this.group.add(mesh); }
      }
    }
    for (const [id, mesh] of this.cells) if (!want.has(id)) { if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); } this.cells.delete(id); }
    if (budget > 0 || jump > 150) this.last = { x: p.x, z: p.z };
    this.stats.cells = this.cells.size;
  }
  dispose() { this.unsubscribe(); for (const mesh of this.cells.values()) mesh?.geometry.dispose(); this.cells.clear(); this.roofs?.geometry.dispose(); this.roofs?.material.dispose(); this.stoneTexture.dispose(); for (const mat of Object.values(this.materials)) mat.dispose(); }
}
const POST = template(m => box(m, 0, 0, 0, .4, 2, .4, '#efece4'));

// Arterial furniture uses the existing near-prop material and cell mesh: no per-light objects or lights.
const arterialLamp = () => template(m => {
  box(m, 0, 0, 0, .16, 9, .16, '#858a89');
  box(m, 0, 8.8, .9, .12, .12, 1.9, '#858a89');
  box(m, 0, 8.65, 1.7, .4, .14, .75, '#e7dfbf');
}, 'lamp');
const SIGNAL = template(m => {
  box(m, 0, 0, 0, .13, 3.4, .13, '#656d67');
  box(m, 0, 2.5, 0, .38, 1.05, .26, '#202722');
  for (let k=0;k<3;k++) box(m, 0, 2.56+k*.3, -.141, .2, .19, .025, ['#3f8d66','#695c30','#612f2c'][k]);
});
const MEDIAN = template(m => box(m, 0, 0, 0, 1, .16, 1, '#b2ac96', '#8d9675'));

const SIGNAL_ARM=template(m=>{
  box(m,0,3.4,0,.12,2.8,.12,'#68716b');box(m,1.7,6.05,0,3.5,.12,.12,'#68716b');
  box(m,3.2,4.85,0,.4,1.15,.28,'#202722');for(let k=0;k<3;k++)box(m,3.2,4.93+k*.32,-.15,.22,.21,.025,['#3f8d66','#695c30','#612f2c'][k]);
},'lamp');
