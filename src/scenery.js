// RENDER DISTANCE + LOD for the scenery: one distance policy shared by the GPU dither fades and the per-chunk CPU culler.
//
// Draw distance: settings.drawDistance (metres: DRAW_DISTANCES, or 'auto' = the tier's default; ?draw=1000 overrides).
// Every registered distance is authored at the REFERENCE draw distance (2 km, the high tier) and scaled by
// drawScale() = (drawDistance / 2000)^0.75 (sub-linear: small props don't vanish at 500 m, trees don't explode at 4 km).
// setDrawDistance() applies live, without a reload or a shader recompile (the fade ranges are shared uniforms).
//
// ---- registering assets (world builders: map-world.js, nature.js, buildings.js, world-context.js, maps/*.js)
//   Anything under the map group that has userData.far (metres at 2 km draw distance) and a boundingSphere, and is
//   an InstancedMesh or has userData.lod = true, is picked up by prepareSceneryLod() after the map is built:
//     mesh.userData = { far: 1800, near: 0 }      // fully dithered out at `far`; near > 0 = dithered IN from `near`
//     mesh.userData.impostor = true | false | { color, shape: 'crown' | 'cone' | 'block', far }
//   CellInstances (util.js) does this for you: new CellInstances(geo, mat, { cell: 400, far: 1800, near: 0 }), and
//   splits the instances into spatial cells, so culling (frustum + distance) is per chunk, never per object.
//   - LOD pairs cross-fade with complementary dither masks: give the detail level far = F and the coarse level
//     near = 0.78 * F (and a larger far). No hard pops, no double-dithered overlap.
//   - impostors: a far proxy is built automatically for foliage (alpha-tested InstancedMesh, far >= 1500, >= 2.5 m
//     tall): one 12-triangle crown per instance (same placement and tint), merged per kind into 1.5 km chunks,
//     fading in as the detail fades out and drawn out to the tier's horizon. Opt in anything else with userData.impostor = true
//     (shape 'block' for buildings / sheds), opt out with false. Riviera buildings use footprint shells
//     (addBuildingImpostors). Things beyond the terrain are ENV.createFarScenery (islands, mountain ranges).
//   - registerLod(object, { far, near, impostor }) sets the same userData from code.
//   - the scene's camera far plane is 90 km; the aerial perspective (env.js) fades everything into the horizon haze,
//     so the horizon impostors and the far scenery melt into the sky instead of clipping.
import * as THREE from 'three';
import { settings } from './settings.js';

export const DRAW_DISTANCES = [300, 500, 1000, 2000, 4000];
const REF_DISTANCE = 2000;
// drawDistance: the tier's default · building: riviera facade detail range (at 2 km) · horizon: impostors' far edge
export const SCENERY_TIERS = {
  potato: { drawDistance: 500, building: 1800, horizon: 2600, pixelRatio: 0.6 },
  low: { drawDistance: 1000, building: 1800, horizon: 5200, pixelRatio: 0.8 },
  med: { drawDistance: 1000, building: 1800, horizon: 7200, pixelRatio: 1.1 },
  high: { drawDistance: 2000, building: 1800, horizon: 9000, pixelRatio: 1.5 },
  ultra: { drawDistance: 4000, building: 1800, horizon: 12000, pixelRatio: 2 },
};
const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const STATE = { tier: SCENERY_TIERS.high, drawDistance: REF_DISTANCE, scale: 1, horizon: SCENERY_TIERS.high.horizon, detail: 1, ready: false };
// Small props (authored far up to ~1 km: bins, chairs, bushes, signs, kerb clutter) draw out to `detail` × their range
// on the lower presets (graphics.js PRESETS.detail), easing back to the full range for big things (trees, buildings).
// An LOD pair's coarse level uses the factor of its detail level (near / 0.78), so the cross-fade stays matched.
const detailK = (far) => STATE.detail + (1 - STATE.detail) * smoothstep01((far - 400) / 1200);
const smoothstep01 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
/** the draw distance a tier starts with, after the player's setting and the ?draw= override */
export function drawDistanceFor(quality = 'high') {
  const tier = SCENERY_TIERS[quality] || SCENERY_TIERS.high, q = +Q.get('draw'), s = +settings.drawDistance;
  return q > 0 ? q : s > 0 ? s : tier.drawDistance;
}
export const drawDistance = () => STATE.drawDistance;
export const drawScale = () => STATE.scale;
export const horizonDistance = () => STATE.horizon;

const fades = new Set(); // every fade material's range uniform (+ its authored distances)
function applyRanges() {
  for (const f of fades) {
    const k = STATE.scale, near = f.near * k * detailK(f.near / 0.78), far = f.horizon ? STATE.horizon : f.far * k * detailK(f.far);
    f.uniform.value.set(near, near / 0.78, far * 0.78, far);
  }
}
/** set the scene's draw distance (metres), the tier the horizon comes from and the small-prop range factor; applies live */
export function setDrawDistance(metres, quality, detail = STATE.detail) {
  if (quality) STATE.tier = SCENERY_TIERS[quality] || SCENERY_TIERS.high;
  STATE.detail = Math.max(0.3, Math.min(1, +detail || 1));
  STATE.drawDistance = Math.max(200, +metres || STATE.tier.drawDistance);
  STATE.scale = Math.pow(STATE.drawDistance / REF_DISTANCE, 0.75);
  STATE.horizon = Math.max(STATE.tier.horizon, STATE.drawDistance * 2.5); STATE.ready = true;
  applyRanges();
}

const materials = new WeakMap();
function fadeMaterial(source, near, far, horizon = false) {
  let cache = materials.get(source); if (!cache) materials.set(source, cache = new Map());
  const key = `${near}:${far}:${horizon}`; if (cache.has(key)) return cache.get(key);
  const mat = source.clone(), compile = source.onBeforeCompile, program = source.customProgramCacheKey();
  const range = { value: new THREE.Vector4() }, alphaTest = source.alphaTest > 0;
  fades.add({ uniform: range, near, far, horizon }); applyRanges();
  mat.onBeforeCompile = (sh, renderer) => {
    compile.call(mat, sh, renderer);
    sh.uniforms.uSceneryRange = range;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSceneryDistance;')
      .replace('#include <project_vertex>', `
        vec4 sceneryP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          // One fade value per tree: leaves and trunks dissolve together.
          sceneryP = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #endif
        vSceneryDistance = length((modelMatrix * sceneryP).xz - cameraPosition.xz);
        #include <project_vertex>`);
    // Alpha-tested cards: the averaged alpha of the small mips falls under the cutoff and the foliage thins out with
    // distance; scale alpha with the mip level so the coverage holds (Golus, "Anti-aliased alpha test").
    const keepCoverage = alphaTest ? `
        #ifdef USE_MAP
          vec2 sceneryTs = vec2(textureSize(map, 0));
          vec2 sceneryDx = dFdx(vMapUv * sceneryTs), sceneryDy = dFdy(vMapUv * sceneryTs);
          diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(max(dot(sceneryDx, sceneryDx), dot(sceneryDy, sceneryDy)))) * 0.25;
        #endif` : '';
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSceneryDistance; uniform vec4 uSceneryRange;')
      .replace('#include <alphatest_fragment>', `${keepCoverage}
        #include <alphatest_fragment>
        float sceneryNoise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
        float sceneryOut = smoothstep(uSceneryRange.z, uSceneryRange.w, vSceneryDistance);
        if (sceneryNoise < sceneryOut) discard;
        // Complementary masks keep both LODs from darkening the overlap.
        if (uSceneryRange.x > 0.0 && sceneryNoise >= smoothstep(uSceneryRange.x, uSceneryRange.y, vSceneryDistance)) discard;`);
  };
  mat.customProgramCacheKey = () => `${program}:scenery-fade-v2${alphaTest ? 'a' : ''}`;
  cache.set(key, mat); return mat;
}

/** mark an object for the LOD system (see the header); returns it */
export function registerLod(object, { far, near = 0, impostor } = {}) {
  object.userData.lod = true; object.userData.far = far; object.userData.near = near;
  if (impostor !== undefined) object.userData.impostor = impostor;
  if (!object.boundingSphere && object.geometry) { if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere(); object.boundingSphere = object.geometry.boundingSphere; }
  return object;
}

/** Keep a cheap, footprint-exact building shell beyond the detailed facade range.
 * Geometry impostors preserve irregular OSM roofs from every viewing direction. */
export function addBuildingImpostors(group, quality = 'high') {
  const tier = SCENERY_TIERS[quality] || SCENERY_TIERS.high;
  const shell = new THREE.MeshLambertMaterial({color: '#eee5d3'});
  shell.customProgramCacheKey = () => 'riviera-building-shell-v1';
  shell.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aB; attribute vec2 aF; varying vec4 vShellB; varying vec2 vShellF;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShellB=aB; vShellF=aF;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vShellB; varying vec2 vShellF;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float seed=fract(vShellB.z*7.13);
        diffuseColor.rgb *= mix(vec3(0.78,0.73,0.62),vec3(1.0),step(0.45,seed));
        if(vShellB.w<0.5 || vShellB.w>1.5){
          vec2 bay=fract(vShellF/vec2(3.3,3.1));
          float win=step(0.22,bay.x)*step(bay.x,0.79)*step(0.25,bay.y)*step(bay.y,0.82);
          diffuseColor.rgb*=1.0-win*0.65;
        }`);
  };
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || !mesh.geometry.attributes.aB) continue;
    mesh.userData.lod = true; mesh.userData.far = tier.building; mesh.userData.impostor = false;
    mesh.boundingSphere = mesh.geometry.boundingSphere;
    const far = new THREE.Mesh(mesh.geometry, shell);
    far.userData = {dynamic:true, lod:true, near:tier.building * 0.78, horizon:true, impostor:false};
    far.boundingSphere = mesh.boundingSphere; far.layers.mask = mesh.layers.mask; far.receiveShadow = false;
    group.add(far);
  }
}

// ---------------------------------------------------------------- automatic far impostors
const _c = new THREE.Color();
const texColor = new WeakMap();
/** mean linear colour of a texture's opaque texels (cached per texture) */
function averageTexture(tex) {
  if (texColor.has(tex)) return texColor.get(tex);
  let out = null;
  try {
    const img = tex.image, cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n) out = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch { /* not drawable (compressed / cross-origin): fall back to the material colour */ }
  texColor.set(tex, out); return out;
}
function impostorColor(mesh, opts) {
  if (opts.color) return new THREE.Color(opts.color);
  const m = mesh.material, c = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
  const t = m.map && averageTexture(m.map);
  if (t) c.multiply(t); else if (m.map) c.multiply(_c.set('#58663f'));
  const col = mesh.geometry.attributes.color;
  if (col && m.vertexColors) { let r = 0, g = 0, b = 0; for (let i = 0; i < col.count; i++) { r += col.getX(i); g += col.getY(i); b += col.getZ(i); } c.multiply(_c.setRGB(r / col.count, g / col.count, b / col.count)); }
  // card foliage self-shadows: a solid crown of the mean texel colour reads too bright
  return m.alphaTest > 0 ? c.multiplyScalar(0.72) : c;
}
/** a closed, smooth-shaded proxy filling the geometry's bounding box (crown: hexagonal bipyramid with a flat top) */
function proxyGeometry(box, shape) {
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  if (shape === 'block') { const g = new THREE.BoxGeometry(size.x, size.y, size.z); g.translate(c.x, c.y, c.z); return g; }
  const rx = size.x * 0.42, rz = size.z * 0.42;
  const bottom = shape === 'cone' ? box.min.y + size.y * 0.1 : box.min.y + size.y * 0.3, top = box.max.y, belly = bottom + (top - bottom) * (shape === 'cone' ? 0.2 : 0.4);
  const pos = [], ring = [];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ring.push([c.x + Math.cos(a) * rx, belly, c.z + Math.sin(a) * rz]); }
  const lo = [c.x, bottom, c.z], hi = [c.x, top, c.z];
  for (let i = 0; i < 6; i++) { const a = ring[i], b = ring[(i + 1) % 6]; pos.push(...lo, ...b, ...a, ...hi, ...a, ...b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // round normals from the crown centre: soft, tree-like shading instead of facets
  const n = [], mid = new THREE.Vector3(c.x, (bottom + top) / 2, c.z), v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]).sub(mid); v.y *= 0.6; v.normalize(); n.push(v.x, v.y, v.z); }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}
function wantsImpostor(mesh) {
  const u = mesh.userData, opt = u.impostor;
  if (opt === false || u.impostorOf || !mesh.isInstancedMesh || !(u.far > 0)) return false;
  if (opt) return true;
  const m = mesh.material;
  if (!(m.alphaTest > 0) || u.far < 1500) return false;
  const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox.max.y - g.boundingBox.min.y >= 2.5;
}
/** one proxy per instance, merged per kind into coarse chunks (a handful of draw calls for a whole forest) */
function buildImpostors(root) {
  const made = [], kinds = new Map(), m4 = new THREE.Matrix4(), col = new THREE.Color();
  root.traverse(mesh => { if (wantsImpostor(mesh)) made.push(mesh); });
  for (const mesh of made) {
    const opts = typeof mesh.userData.impostor === 'object' ? mesh.userData.impostor : {};
    const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const color = impostorColor(mesh, opts), b = g.boundingBox;
    const shape = opts.shape || (b.max.y - b.min.y > 2.2 * (b.max.x - b.min.x) ? 'cone' : 'crown');
    const key = `${g.uuid}:${shape}:${color.getHexString()}:${mesh.userData.far}:${opts.far || 0}`;
    let k = kinds.get(key);
    if (!k) {
      const mat = new THREE.MeshLambertMaterial({ color });
      mat.customProgramCacheKey = () => 'scenery-impostor-v1';
      k = { parent: mesh.parent, near: mesh.userData.far * 0.78, far: opts.far, cells: new CellInstancesLite(proxyGeometry(b, shape), mat, !!mesh.instanceColor) };
      kinds.set(key, k);
    }
    for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m4); if (mesh.instanceColor) mesh.getColorAt(i, col); k.cells.add(m4, mesh.instanceColor ? col : null); }
  }
  let meshes = 0;
  for (const k of kinds.values()) for (const proxy of k.cells.build(k.parent)) {
    proxy.userData = { lod: true, impostor: false, near: k.near, far: k.far, horizon: !k.far, dynamic: true };
    meshes++;
  }
  return { sources: made.length, meshes };
}
/** instanced proxies bucketed into 1.5 km chunks with exact bounds */
class CellInstancesLite {
  constructor(geo, mat, colors) { this.geo = geo; this.mat = mat; this.colors = colors; this.cells = new Map(); }
  add(m, c) {
    const e = m.elements, key = Math.floor(e[12] / 1500) * 10007 + Math.floor(e[14] / 1500);
    let cell = this.cells.get(key); if (!cell) this.cells.set(key, cell = []);
    cell.push([m.clone(), c ? c.clone() : null]);
  }
  build(parent) {
    this.geo.computeBoundingSphere(); const r0 = this.geo.boundingSphere.radius + this.geo.boundingSphere.center.length(), out = [];
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const list of this.cells.values()) {
      const m = new THREE.InstancedMesh(this.geo, this.mat, list.length), box = new THREE.Box3(); let maxS = 1;
      list.forEach(([mat, c], i) => { m.setMatrixAt(i, mat); if (this.colors) m.setColorAt(i, c); mat.decompose(p, q, sc); box.expandByPoint(p); maxS = Math.max(maxS, sc.x, sc.y, sc.z); });
      const sph = new THREE.Sphere(); box.getBoundingSphere(sph); sph.radius += r0 * maxS; m.boundingSphere = sph;
      m.castShadow = false; m.receiveShadow = false; m.name = 'scenery-impostor';
      parent.add(m); out.push(m);
    }
    return out;
  }
}

export function prepareSceneryLod(scene, quality = 'high') {
  if (!STATE.ready) setDrawDistance(drawDistanceFor(quality), quality); // main.js sets it first, with the full tier
  const impostors = buildImpostors(scene), list = [];
  scene.traverse(mesh => {
    if (!(mesh.isInstancedMesh || mesh.userData.lod) || !(mesh.userData.far || mesh.userData.horizon) || !mesh.boundingSphere) return;
    if (!mesh.userData.sceneryPrepared) {
      mesh.material = fadeMaterial(mesh.material, mesh.userData.near || 0, mesh.userData.far || 0, !!mesh.userData.horizon);
      mesh.userData.sceneryPrepared = true;
    }
    list.push(mesh);
  });
  list.impostors = impostors;
  return list;
}
const center = new THREE.Vector3();
/** per-chunk distance culling (three still frustum-culls each chunk by its bounding sphere) */
export function updateSceneryLod(list, camera) {
  const k = STATE.scale, horizon = STATE.horizon;
  for (const mesh of list) {
    center.copy(mesh.boundingSphere.center).applyMatrix4(mesh.matrixWorld);
    const d = Math.hypot(center.x-camera.position.x, center.z-camera.position.z), r = mesh.boundingSphere.radius;
    const u = mesh.userData, far = u.horizon ? horizon : u.far * k * detailK(u.far), near = (u.near || 0) * k * detailK((u.near || 0) / 0.78);
    mesh.visible = d-r < far+20 && (!near || d+r > near-20);
  }
}
