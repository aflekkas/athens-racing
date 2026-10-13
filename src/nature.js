// Vegetation, coast and street life placed from the real OSM land use:
// Washingtonia palms on the Glyfada promenade, bitter-orange street trees, oleanders in the median,
// Aleppo pines in Vouliagmeni, maquis and limestone boulders along the cliff road, yachts in the
// marinas, parasols on the organised beaches (Astir, Voula, the lake), side streets, kiosks.
import * as THREE from 'three';
import * as ENV from './env.js';
import { REFLECT_LAYER, U, sunDir } from './env.js';
import { RNG, CellInstances, M, canvasTex, pointInPoly, polyBounds, polyArea, clamp, smoothstep, lerp, vnoise } from './util.js';
import { ROAD } from './road.js';
import { TX, GLSL_HELPERS } from './tex.js';

// ------------------------------------------------------------------ templates
// leaf-card atlas quadrants (u0, v0, u1, v1) of assets/tex/foliage_atlas.webp (tools/make_foliage.py)
const ATL = { citrus: [0, 0.5, 0.5, 1], oleander: [0.5, 0.5, 1, 1], pine: [0, 0, 0.5, 0.5], lentisk: [0.5, 0, 1, 0.5] };
const CYP_TINT = new THREE.Color(0.62, 0.72, 0.6);
const EXTRA = { fan: [0, 0.5, 0.5, 1], olive: [0.5, 0.5, 1, 1], bougainvillea: [0, 0, 0.5, 0.5], scrub: [0.5, 0, 1, 0.5] };

/** a shell of leaf cards around an ellipsoid: twigs radiate outward, normals bent outward for soft volumetric light */
function cardCluster(n, seed, rect, { r = [1, 1, 1], cy = 0, w = 1, h = 1, tilt = 0.7, outward = 0.75, shell = 0.55 } = {}) {
  const R = new RNG(seed);
  const pos = [], nor = [], uv = [], ao = [], idx = [];
  const d = new THREE.Vector3(), up = new THREE.Vector3(), rt = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3(), nn = new THREE.Vector3(), cn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    d.set(R.range(-1, 1), R.range(-0.55, 1), R.range(-1, 1)).normalize();
    const rad = shell + (1 - shell) * Math.pow(R.next(), 0.6);
    c.set(d.x * r[0] * rad, cy + d.y * r[1] * rad, d.z * r[2] * rad);
    up.copy(d).multiplyScalar(outward).add(q.set(R.range(-tilt, tilt), 0.75, R.range(-tilt, tilt))).normalize();
    rt.set(R.range(-1, 1), R.range(-0.3, 0.3), R.range(-1, 1)).cross(up).normalize();
    cn.crossVectors(rt, up).normalize();
    const sw = w * R.range(0.8, 1.2), sh = h * R.range(0.8, 1.2);
    const base = pos.length / 3;
    const corners = [[-0.5, -0.15], [0.5, -0.15], [0.5, 0.85], [-0.5, 0.85]];
    const uvs = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
    if (R.next() < 0.5) { const t = uvs[0]; uvs[0] = uvs[1]; uvs[1] = t; const t2 = uvs[2]; uvs[2] = uvs[3]; uvs[3] = t2; }
    corners.forEach(([a, b], k) => {
      q.copy(c).addScaledVector(rt, a * sw).addScaledVector(up, b * sh);
      pos.push(q.x, q.y, q.z);
      nn.set(q.x / r[0], (q.y - cy) / r[1], q.z / r[2]).normalize().multiplyScalar(0.8).addScaledVector(cn, 0.2).normalize();
      nor.push(nn.x, nn.y, nn.z);
      uv.push(uvs[k][0], uvs[k][1]);
      ao.push(clamp(0.45 + 0.5 * rad + 0.15 * d.y, 0.3, 1.05));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

const FOLIAGE_VS = (sway) => `
  #ifdef USE_INSTANCING
    vec3 ip = instanceMatrix[3].xyz;
  #else
    vec3 ip = vec3(0.0);
  #endif
  float wph = uTime * 1.25 + ip.x * 0.11 + ip.z * 0.07;
  float wk = ${sway} * (0.6 + 0.4 * sin(uTime * 0.37 + ip.x * 0.01));
  transformed.x += (sin(wph + position.y * 0.6) + 0.35 * sin(wph * 2.7 + position.x)) * wk * aAO;
  transformed.z += (cos(wph * 0.8 + position.y * 0.5) + 0.35 * cos(wph * 2.3 + position.z)) * wk * aAO;
  transformed.y += sin(wph * 1.9 + position.x * 2.0) * wk * 0.5 * aAO;
`;
/** alpha-to-coverage leaf cards (MSAA), translucent toward the sun, per-instance tint; flowers keep their own colour */
function leafMaterial(flowers, map = TX.foliage) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.38, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.68, metalness: 0 });
  m.customProgramCacheKey = () => 'leaf7' + (flowers ? 'f' : '');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time; sh.uniforms.uSun = { value: sunDir };
    sh.uniforms.uLeafDaylight = { get value() { return ENV.COND_STATE.daylight; } };
    sh.uniforms.uLeafSunColor = { value: ENV.SUN_COLOR };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO; varying vec3 vLW; uniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO;\n' + FOLIAGE_VS('0.045'))
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef USE_INSTANCING\nvLW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAO; varying vec3 vLW; uniform vec3 uSun; uniform float uLeafDaylight; uniform vec3 uLeafSunColor; vec3 leafT;')
      .replace('#include <color_fragment>', `
        {
          vec3 c = diffuseColor.rgb;
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float flw = ${flowers ? '(1.0 - smoothstep(0.03, 0.1, mx - mn)) * smoothstep(0.3, 0.6, mx)' : '0.0'};
          #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
            c = mix(c * ${flowers ? 'vec3(1.0)' : 'vColor'}, vColor * (0.55 + 0.45 * mx) * 0.95, flw);
          #endif
          diffuseColor.rgb = c * mix(1.0, vAO, 0.85 * (1.0 - flw));
          leafT = diffuseColor.rgb * (1.0 - flw);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 vd = normalize(vLW - cameraPosition);
          float tr = pow(max(dot(vd, normalize(uSun)), 0.0), 5.0);
          totalEmissiveRadiance += leafT * uLeafSunColor * tr * 0.8 * vAO * uLeafDaylight;
        }`);
  };
  return m;
}
function frondMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: TX.frond, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
  m.customProgramCacheKey = () => 'frond6';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time; sh.uniforms.uSun = { value: sunDir };
    sh.uniforms.uLeafDaylight = { get value() { return ENV.COND_STATE.daylight; } };
    sh.uniforms.uLeafSunColor = { value: ENV.SUN_COLOR };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAO; attribute float aDry; varying float vAO; varying float vDry; varying vec3 vLW; uniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO; vDry = aDry;\n' + FOLIAGE_VS('0.09'))
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef USE_INSTANCING\nvLW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAO; varying float vDry; varying vec3 vLW; uniform vec3 uSun; uniform float uLeafDaylight; uniform vec3 uLeafSunColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.4))) * vec3(1.6, 1.25, 0.8), vDry) * (0.55 + 0.45 * vAO);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 vd = normalize(vLW - cameraPosition); float tr = pow(max(dot(vd, normalize(uSun)), 0.0), 5.0); totalEmissiveRadiance += diffuseColor.rgb * uLeafSunColor * tr * 0.9 * uLeafDaylight; }`);
  };
  return m;
}
/** bark: photographed albedo + normal, cylindrical UVs in metres */
function barkMaterial(key, tint, rep) {
  const m = new THREE.MeshStandardMaterial({ color: tint, map: TX[key + '_diff'], normalMap: TX[key + '_nor'], roughness: 0.92, metalness: 0 });
  m.normalScale.set(1.2, 1.2);
  return m;
}
function barkUV(g, circ, vScale = 1) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, p.getY(i) * vScale);
  return g;
}
function rockMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  m.customProgramCacheKey = () => 'rock6';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tRD: { value: TX.rock_diff }, tRN: { value: TX.rock_nor } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRP = (modelMatrix * vec4(transformed, 1.0)).xyz; vRN = normalize(mat3(modelMatrix) * objectNormal);\n#ifdef USE_INSTANCING\nvRP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tRD; uniform sampler2D tRN; varying vec3 vRP; varying vec3 vRN; vec3 rN; vec2 rUV;
      ${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 an = abs(vRN);
        rUV = (an.y > max(an.x, an.z) ? vRP.xz : an.x > an.z ? vRP.zy : vRP.xy) / 2.5;
        vec3 r = texture2D(tRD, rUV).rgb; rN = texture2D(tRN, rUV).xyz * 2.0 - 1.0;
        r = mix(vec3(dot(r, vec3(0.333))), r, 0.4) * 1.5;
        diffuseColor.rgb *= r * mix(0.5, 1.0, smoothstep(0.0, 0.8, vRP.y));
      }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, rUV, rN, 1.3);');
  };
  return m;
}

/** A small deterministic atlas for species absent from the photographed leaf atlas.
 * Transparent space is kept between leaves; these are cutout cards, never opaque canopy shells. */
function rivieraFoliageAtlas() {
  return canvasTex(1024, 1024, (ctx) => {
    const r = new RNG(813);
    const line = (x0, y0, x1, y1, color, width) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    const leaf = (x, y, a, length, width, color) => { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(0, -length / 2, width / 2, length / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
    // Washingtonia: radial, deeply divided fans rather than pinnate date-palm leaves.
    line(256, 505, 256, 335, '#81834c', 12);
    for (let j = 0; j < 37; j++) {
      const a = -1.43 + j / 36 * 2.86, len = r.range(245, 310);
      const x = 256 + Math.sin(a) * len * 0.79, y = 338 - Math.cos(a) * len;
      ctx.fillStyle = r.pick(['#667c42', '#79904e', '#84994f', '#526c3f']);
      ctx.beginPath(); ctx.moveTo(256, 345); ctx.lineTo(x - 6, y + 8); ctx.lineTo(x + 6, y); ctx.closePath(); ctx.fill();
      line(256, 345, x, y + 8, '#a8ae70', 1.4);
    }
    // Silvery olive: opposite pairs of narrow leaves on airy branching sprays.
    for (let b = 0; b < 5; b++) {
      const bx = 745 + (b - 2) * 16, tx = 570 + b * 85;
      line(bx, 506, tx, 60 + Math.abs(b - 2) * 30, '#837763', 5);
      for (let j = 1; j < 13; j++) {
        const t = j / 13, x = bx + (tx - bx) * t, y = 506 - (446 - Math.abs(b - 2) * 30) * t;
        for (const side of [-1, 1]) leaf(x, y, side * 0.8 + (b - 2) * 0.13, r.range(38, 59), 9, r.pick(['#9ca58a', '#b6bca0', '#7e8e70', '#8c9b79']));
      }
    }
    // Bougainvillea: angular papery bracts among green leaves. White bracts take instance tint.
    for (let b = 0; b < 6; b++) {
      const bx = 80 + b * 64;
      line(255, 1020, bx, 610, '#716043', 5);
      for (let j = 0; j < 10; j++) {
        const t = j / 10, x = 255 + (bx - 255) * t, y = 1010 - 390 * t;
        leaf(x, y, (b % 2 ? 1 : -1) * 0.8, 47, 25, '#62783b');
        if (j > 3) for (let k = 0; k < 3; k++) {
          ctx.save(); ctx.translate(x + r.range(-16, 16), y - 20); ctx.rotate(k * 2.1);
          ctx.fillStyle = r.pick(['#f5f0ec', '#d9d9d4', '#fff9f3']); ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(-18, -13); ctx.quadraticCurveTo(-8, -37, 13, -31); ctx.lineTo(18, -10); ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }
    }
    // Phrygana: wiry thyme / sage stems, seedheads and sparse drought-grey leaves.
    for (let b = 0; b < 35; b++) {
      const bx = r.range(685, 840), tx = r.range(540, 993), ty = r.range(570, 830);
      line(bx, 1020, tx, ty, r.pick(['#afa17b', '#8c8f63', '#aaa98b']), 2.5);
      for (let j = 2; j < 8; j++) { const t = j / 8; leaf(bx + (tx - bx) * t, 1020 + (ty - 1020) * t, r.range(-1, 1), r.range(13, 25), 5, '#92967a'); }
      ctx.fillStyle = '#bca687'; ctx.beginPath(); ctx.ellipse(tx, ty, 4, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
  }, { aniso: 4 });
}

function makeFanPalm() {
  const parts = [];
  for (let i = 0; i < 18; i++) {
    const g = new THREE.PlaneGeometry(2.35, 2.9, 1, 3); g.translate(0, 1.45, 0);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      const t = p.getY(k) / 2.9;
      p.setZ(k, -t * t * (i < 6 ? 0.4 : 1.1));
      uv.setXY(k, uv.getX(k) * 0.5, 0.5 + uv.getY(k) * 0.5);
    }
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(Array.from({ length: p.count }, (_, k) => 0.55 + 0.45 * p.getY(k) / 2.9), 1));
    g.computeVertexNormals(); g.applyMatrix4(M(0, 0, 0, i < 6 ? -0.45 : i < 13 ? -1.1 : -1.8, i * 2.39996, 0, 1, 1, 1, 'YXZ')); parts.push(g);
  }
  return mergeGeosAttr(parts, ['aAO']);
}

function makeAgave() {
  const parts = [];
  for (let i = 0; i < 15; i++) {
    const a = i * 2.39996, outer = i < 10, len = outer ? 1.2 : 0.8;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.17, 0.32, -len * 0.42, 0, 0.41, -len * 0.44, 0.17, 0.32, -len * 0.42, 0, outer ? 0.44 : 1.1, -len], 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3]); g.computeVertexNormals(); g.rotateY(a); parts.push(g);
  }
  return mergeGeos(parts);
}
function makePricklyPear() {
  const parts = [];
  for (const [x, y, z, a, sx, sy] of [[0, 0.42, 0, 0, 0.28, 0.47], [-0.3, 1.0, 0, -0.5, 0.28, 0.43], [0.36, 1.05, 0, 0.5, 0.29, 0.44], [-0.51, 1.51, 0, -0.15, 0.21, 0.33], [0.22, 1.65, 0.02, -0.2, 0.23, 0.35], [0.48, 0.52, 0.1, 0.8, 0.2, 0.3]]) {
    const g = new THREE.SphereGeometry(1, 8, 5); g.scale(sx, sy, 0.065); g.rotateZ(a); g.translate(x, y, z); parts.push(g);
  }
  return mergeGeos(parts);
}

function makePalm() {
  // trunk: tall, slightly curved, leaf-scar rings (bark texture), UVs in metres for a ~10 m palm
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 1, 12, 16, true); trunk.translate(0, 0.5, 0);
  barkUV(trunk, 2.2, 10 / 2.2);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 2.2) * 0.25 * y); }
  trunk.computeVertexNormals();
  // crown: ~34 arching fronds in three generations (young upright, mature, old drooping and drying)
  const R = new RNG(5);
  const parts = [];
  for (let i = 0; i < 28; i++) {
    const gen = i < 6 ? 0 : i < 20 ? 1 : 2;
    const L = gen === 0 ? R.range(3.2, 3.8) : R.range(3.8, 4.6);
    const fr = new THREE.PlaneGeometry(1.9, L, 1, 6); fr.translate(0, L / 2, 0);
    const fp = fr.attributes.position;
    const rise = gen === 0 ? 1.15 : gen === 1 ? R.range(0.5, 0.8) : R.range(0.05, 0.35);
    const droop = gen === 0 ? 0.25 : gen === 1 ? 0.75 : 1.25;
    const aAO = new Float32Array(fp.count), dry = new Float32Array(fp.count);
    const isDry = gen === 2 && R.next() < 0.3 ? 1 : 0;
    for (let k = 0; k < fp.count; k++) {
      const t = fp.getY(k) / L, x = fp.getX(k);
      // arc: leave at angle `rise`, gravity bends the tip down; leaflets fold into a shallow V
      const a = rise - droop * t * t * 1.4;
      let yy = 0, zz = 0; const N = 8;
      for (let q = 0; q < N; q++) { const tt = t * q / N, aa = rise - droop * tt * tt * 1.4; yy += Math.sin(aa) * L * t / N; zz -= Math.cos(aa) * L * t / N; }
      fp.setXYZ(k, x * (1 - 0.15 * t), yy + Math.abs(x) * 0.25, zz);
      aAO[k] = (0.55 + 0.45 * t) * (gen === 0 ? 1.05 : gen === 1 ? 0.95 : 0.8);
      dry[k] = isDry ? 0.9 : gen === 2 ? 0.25 * t : 0;
      void a;
    }
    fr.setAttribute('aAO', new THREE.BufferAttribute(aAO, 1)); fr.setAttribute('aDry', new THREE.BufferAttribute(dry, 1));
    fr.computeVertexNormals();
    fr.applyMatrix4(M(0, R.range(-0.25, 0.1), 0, 0, i * 2.39996 + R.range(-0.15, 0.15), 0, 1, 1, 1, 'YXZ'));
    parts.push(fr);
  }
  const crown = mergeGeosAttr(parts, ['aAO', 'aDry']);
  // the woody "boot" of frond bases at the top of the trunk
  const boot = new THREE.CylinderGeometry(0.42, 0.3, 1.1, 12, 3); boot.translate(0, -0.35, 0); barkUV(boot, 1.5, 1.0);
  return { trunk, crown, boot };
}
function makePine(seed) {
  // Aleppo pine: leaning trunk with a few limbs, umbrella canopy of flattened clumps (core + needle cards)
  const r = new RNG(seed);
  const trunk = new THREE.CylinderGeometry(0.14, 0.3, 1, 9, 6, true); trunk.translate(0, 0.5, 0); barkUV(trunk, 1.4, 10 / 2.0);
  const coreParts = [], cardParts = [];
  for (let i = 0; i < 6; i++) {
    const sx = r.range(1.6, 2.6), sy = r.range(0.8, 1.2), sz = r.range(1.6, 2.6);
    const cx = r.range(-2, 2), cy = r.range(-0.6, 0.6), cz = r.range(-2, 2);
    const g = cardCluster(4, seed * 10 + i, ATL.pine, { r: [sx * 0.7, sy * 0.6, sz * 0.7], w: 3.1, h: 2.1, shell: 0.55 }); g.translate(cx, cy, cz); coreParts.push(g);
    const c = cardCluster(18, seed * 100 + i, ATL.pine, { r: [sx, sy, sz], cy: 0, w: 1.7, h: 1.7, tilt: 0.9, outward: 0.6, shell: 0.75 });
    c.translate(cx, cy, cz); cardParts.push(c);
  }
  return { trunk, core: mergeGeos(coreParts), cards: mergeGeosAttr(cardParts, ['aAO']) };
}
function mergeGeosAttr(list, extra) {
  const pos = [], nor = [], uv = [], ex = extra.map(() => []); const idx = []; let base = 0;
  for (const g of list) {
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    extra.forEach((k, i) => ex[i].push(...(g.attributes[k] ? g.attributes[k].array : new Float32Array(g.attributes.position.count).fill(1))));
    const ix = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (const v of ix) idx.push(v + base);
    base += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  extra.forEach((k, i) => out.setAttribute(k, new THREE.Float32BufferAttribute(ex[i], 1)));
  out.setIndex(idx); out.computeBoundingSphere();
  return out;
}
export function mergeGeos(list) {
  const pos = [], nor = [], uv = [], ao = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2)));
    ao.push(...(g.attributes.aAO ? g.attributes.aAO.array : new Float32Array(g.attributes.position.count).fill(1)));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  out.computeBoundingSphere();
  return out;
}
/** foliage: lumpy normals, darker inside, light shining through the edges; flowers from the instance colour */
export function foliageMaterial(color, { map = null, flowers = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, map, roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO; varying vec3 vFP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vAO; varying vec3 vFP;
      float fh3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      float fn3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(fh3(i),fh3(i+vec3(1,0,0)),f.x), mix(fh3(i+vec3(0,1,0)),fh3(i+vec3(1,1,0)),f.x), f.y),
                   mix(mix(fh3(i+vec3(0,0,1)),fh3(i+vec3(1,0,1)),f.x), mix(fh3(i+vec3(0,1,1)),fh3(i+vec3(1,1,1)),f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `
      {
        float leafN = fn3(vFP * 2.6) * 0.6 + fn3(vFP * 7.0) * 0.4;
        vec3 base = diffuseColor.rgb;
        #ifdef USE_MAP
          base *= texture2D(map, vMapUv).rgb * 1.6;
        #endif
        base *= (0.72 + 0.5 * leafN) * vAO;
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          float fl = ${flowers.toFixed(2)} * smoothstep(0.6, 0.66, fn3(vFP * 13.0 + 3.1)) * smoothstep(0.45, 0.85, vAO);
          base = mix(base, vColor * (0.85 + 0.3 * leafN), fl);
          base = mix(base, base * vColor * 1.25, ${flowers > 0 ? '0.0' : '0.85'});
        #endif
        diffuseColor.rgb = base;
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (vec3(fn3(vFP * 3.1), fn3(vFP * 3.1 + 7.7), fn3(vFP * 3.1 + 3.3)) - 0.5) * 0.9);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.06 * (1.0 - vAO);`);
  };
  return mat;
}
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position; const r = new RNG(seed);
  const sx = r.range(0.8, 1.6), sy = r.range(0.5, 0.9), sz = r.range(0.8, 1.4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.75 + 0.45 * vnoise(x * 1.7 + seed, y * 1.9 + z * 1.3);
    p.setXYZ(i, x * n * sx, Math.max(-0.3, y) * n * sy, z * n * sz);
  }
  g.computeVertexNormals();
  return g;
}
function boatGeo(kind) {
  // hull (lofted), deck cabin, optional mast
  const L = kind === 2 ? 14 : kind === 1 ? 10 : 7, B = L * 0.32;
  const pts = [];
  const hull = new THREE.BufferGeometry();
  const rings = 14, segs = 8; const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, z = (t - 0.5) * L;
    const w = B * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)), 0.6) * (t > 0.85 ? 1 - (t - 0.85) * 2.5 : 1);
    const depth = 0.9 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.1));
    for (let j = 0; j <= segs; j++) { const a = Math.PI * j / segs; pos.push(Math.cos(a) * w, 0.9 - Math.sin(a) * depth - 0.5 + t * 0.25, -z); }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hull.setIndex(idx); hull.computeVertexNormals();
  const deck = new THREE.BoxGeometry(B * 0.92, 0.12, L * 0.8); deck.translate(0, 0.62, -L * 0.04);
  const cabin = new THREE.BoxGeometry(B * 0.6, kind === 2 ? 1.6 : 0.9, L * 0.32); cabin.translate(0, kind === 2 ? 1.4 : 1.1, L * 0.02);
  const parts = [hull.toNonIndexed(), deck, cabin];
  if (kind !== 2) { const mast = new THREE.CylinderGeometry(0.06, 0.08, L * 1.35, 6); mast.translate(0, L * 0.68 + 0.6, -L * 0.08); parts.push(mast); }
  if (kind === 2) { const fly = new THREE.BoxGeometry(B * 0.55, 0.6, L * 0.25); fly.translate(0, 2.4, L * 0.05); parts.push(fly); }
  return mergeGeos(parts.map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }));
}
function umbrellaGeo(straw) {
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 2.3, 5); pole.translate(0, 1.15, 0);
  const top = new THREE.ConeGeometry(straw ? 1.25 : 1.15, straw ? 0.75 : 0.45, straw ? 10 : 8, 1, false); top.translate(0, 2.35, 0);
  return { pole, top };
}

// ------------------------------------------------------------------ main
export function buildNature(map, scene, heightC, bld, assets) {
  const { data, route, terrain } = map;
  const group = new THREE.Group(); scene.add(group);
  const rng = new RNG(2024);
  const pineTrunkMat = barkMaterial('pinebark', '#b8a898', 1.6);
  const rockMat = rockMaterial();

  // Close leaf cards cross-fade into coarse cutout sprays. No opaque foliage blobs.
  const leafMat = leafMaterial(false), flowerMat = leafMaterial(true), frondMat = frondMaterial();
  const extraAtlas = rivieraFoliageAtlas(), extraMat = leafMaterial(false, extraAtlas), extraFlowerMat = leafMaterial(true, extraAtlas);
  const palmT = makePalm(), pineT = [makePine(1), makePine(2), makePine(3)];
  const palmTrunk = new CellInstances(palmT.trunk, barkMaterial('palmbark', '#d8cbb8', 2.2), { far: 1800 });
  const palmCrown = new CellInstances(palmT.crown, frondMat, { far: 1800, cell: 400, colors: true });
  const fanCrown = new CellInstances(makeFanPalm(), extraMat, { far: 1800, cell: 400, colors: true });
  const palmBoot = new CellInstances(palmT.boot, barkMaterial('palmbark', '#a89880', 1.0), { far: 700, shadow: false });
  const pineTrunk = new CellInstances(pineT[0].trunk, pineTrunkMat, { cell: 500, far: 2000 });
  const pineCore = pineT.map((t) => new CellInstances(t.core, leafMat, { cell: 500, near: 390, far: 2600, colors: true, shadow: false }));
  const pineCards = pineT.map((t) => new CellInstances(t.cards, leafMat, { cell: 250, far: 500, colors: true }));
  const oleCards = [11, 12].map((seed) => cardCluster(30, seed, ATL.oleander, { r: [0.95, 0.7, 0.9], w: 1.1, h: 1.1, shell: 0.65 }));
  const lenCards = [13, 14].map((seed) => cardCluster(24, seed, ATL.lentisk, { r: [0.95, 0.65, 0.9], w: 1.05, h: 1.05, shell: 0.65 }));
  const bushCore = [13, 14].map((seed) => new CellInstances(cardCluster(7, seed, ATL.lentisk, { r: [0.75, 0.5, 0.75], w: 1.5, h: 1.25 }), leafMat, { colors: true, cell: 400, near: 234, far: 900, shadow: false }));
  const oleFar = [11, 12].map((seed) => new CellInstances(cardCluster(8, seed, ATL.oleander, { r: [0.75, 0.5, 0.75], w: 1.5, h: 1.25 }), flowerMat, { colors: true, cell: 400, near: 234, far: 900, shadow: false }));
  const oleI = oleCards.map((g) => new CellInstances(g, flowerMat, { colors: true, cell: 250, far: 300, shadow: false }));
  const lenI = lenCards.map((g) => new CellInstances(g, leafMat, { colors: true, cell: 250, far: 300, shadow: false }));
  const rocks = [rockGeo(1), rockGeo(2), rockGeo(3)].map((g) => new CellInstances(g, rockMat, { colors: true, cell: 400, far: 900, shadow: false }));
  const cypCards = cardCluster(46, 21, ATL.pine, { r: [0.6, 3.8, 0.6], cy: 4.0, w: 0.85, h: 1.5, tilt: 0.15, outward: 0.2 });
  const cypCore = new CellInstances(cardCluster(16, 21, ATL.pine, { r: [0.6, 3.8, 0.6], cy: 4.0, w: 1.0, h: 2.0, tilt: 0.15, outward: 0.2 }), leafMat, { near: 390, far: 2200, colors: true, shadow: false });
  const cypI = new CellInstances(cypCards, leafMat, { far: 500, cell: 250, colors: true });
  const cypress = { add: (m) => { cypCore.add(m, CYP_TINT); cypI.add(m, CYP_TINT); } };
  const orangeCards = cardCluster(64, 31, ATL.citrus, { r: [1.5, 1.25, 1.5], cy: 2.9, w: 1.3, h: 1.3, shell: 0.65 });
  const orangeCore = new CellInstances(cardCluster(16, 31, ATL.citrus, { r: [1.3, 1.05, 1.3], cy: 2.9, w: 1.8, h: 1.8 }), leafMat, { near: 390, far: 1700, colors: true, shadow: false });
  const orangeI = new CellInstances(orangeCards, leafMat, { far: 500, cell: 250, colors: true });
  const oliveCards = new CellInstances(cardCluster(54, 63, EXTRA.olive, { r: [2.1, 1.45, 1.9], cy: 3.2, w: 1.9, h: 1.8 }), extraMat, { far: 500, cell: 300, colors: true });
  const oliveFar = new CellInstances(cardCluster(15, 63, EXTRA.olive, { r: [1.9, 1.25, 1.7], cy: 3.2, w: 2.3, h: 2.2 }), extraMat, { near: 390, far: 2100, cell: 500, colors: true, shadow: false });
  const oliveTrunkGeo = mergeGeos([-1, 1].map((side) => { const g = new THREE.CylinderGeometry(0.08, 0.24, 2.8, 7); g.rotateZ(side * 0.25); g.translate(side * 0.2, 1.35, 0); return g; }));
  const oliveTrunks = new CellInstances(oliveTrunkGeo, pineTrunkMat, { far: 1200, cell: 500 });
  const bougainvillea = new CellInstances(cardCluster(22, 88, EXTRA.bougainvillea, { r: [1.1, 0.85, 0.75], cy: 0.6, w: 1.2, h: 1.5 }), extraFlowerMat, { far: 650, cell: 350, colors: true, shadow: false });
  const phrygana = new CellInstances(cardCluster(6, 97, EXTRA.scrub, { r: [0.5, 0.15, 0.5], cy: 0.3, w: 1.0, h: 0.85, outward: 0.25 }), extraMat, { far: 450, cell: 350, colors: true, shadow: false });
  const succulentMat = new THREE.MeshStandardMaterial({ color: '#96ab86', roughness: 0.83, side: THREE.DoubleSide });
  const agave = new CellInstances(makeAgave(), succulentMat, { far: 600, cell: 350, colors: true, shadow: false });
  const pricklyPear = new CellInstances(makePricklyPear(), succulentMat, { far: 700, cell: 350, colors: true, shadow: false });
  const fruitGeo = new THREE.IcosahedronGeometry(0.075, 0);
  const smallTrunkGeo = new THREE.CylinderGeometry(0.07, 0.11, 2.3, 7); smallTrunkGeo.translate(0, 1.15, 0); barkUV(smallTrunkGeo, 0.6);
  const smallTrunks = new CellInstances(smallTrunkGeo, pineTrunkMat, { far: 700, shadow: false });
  const fruitPos = [];

  const pt = new THREE.Vector3();
  const OLEANDER = [new THREE.Color('#ff5fa8'), new THREE.Color('#fbf3ee'), new THREE.Color('#ff3d64'), new THREE.Color('#ff86c2'), new THREE.Color('#ffd8e6')];
  const MAQUIS = [new THREE.Color('#a3a383'), new THREE.Color('#b5b28a'), new THREE.Color('#c4bd92'), new THREE.Color('#9aa27a')];
  const ROCKC = [new THREE.Color('#d4cbbb'), new THREE.Color('#bdb3a2'), new THREE.Color('#e0d8ca'), new THREE.Color('#aaa396')];
  const leafTint = () => new THREE.Color().setRGB(rng.range(0.85, 1.1), rng.range(0.9, 1.1), rng.range(0.8, 1.0));

  const addPalm = (x, y, z, h = rng.range(8, 14)) => {
    const yaw = rng.range(0, 6.28), fan = rng.chance(0.56), thickness = fan ? rng.range(0.7, 0.95) : rng.range(1.25, 1.65);
    if (!fan) h *= 0.72;
    palmTrunk.add(M(x, y - 0.2, z, 0, yaw, 0, thickness, h, thickness, 'YXZ'));
    // trunk top offset from the curvature in the template
    const off = Math.sin(2.2) * 0.25 * thickness;
    const cx = x + Math.cos(yaw) * off, cz = z - Math.sin(yaw) * off;
    const sc = rng.range(0.9, 1.15);
    (fan ? fanCrown : palmCrown).add(M(cx, y + h - 0.3, cz, 0, rng.range(0, 6.28), 0, sc, sc, sc, 'YXZ'), leafTint());
    palmBoot.add(M(cx, y + h - 0.3, cz, 0, rng.range(0, 6.28), 0, 1, 1, 1));
  };
  const addPine = (x, y, z, h = rng.range(7, 13)) => {
    const lean = rng.range(-0.12, 0.12), yaw = rng.range(0, 6.28);
    pineTrunk.add(M(x, y - 0.3, z, lean, yaw, 0, 1, h, 1, 'YXZ'));
    const tx = x + Math.sin(yaw) * Math.sin(lean) * h, tz = z + Math.cos(yaw) * Math.sin(lean) * h;
    const sc = h / 10, k = rng.int(0, 2);
    const m = M(tx, y + h - 0.6, tz, 0, rng.range(0, 6.28), 0, sc * rng.range(0.9, 1.2), sc, sc * rng.range(0.9, 1.2), 'YXZ');
    const tint = leafTint(); pineCore[k].add(m, tint); pineCards[k].add(m, tint);
  };
  const addBush = (x, y, z, s, colors) => {
    const k = rng.int(0, 1), c = rng.pick(colors);
    const m = M(x, y + s * 0.35, z, 0, rng.range(0, 6.28), 0, s, s * rng.range(0.7, 1.1), s, 'YXZ');
    if (colors === OLEANDER) { oleFar[k].add(m, c); oleI[k].add(m, c); }
    else { bushCore[k].add(m, c); lenI[k].add(m, c); }
  };
  const addRock = (x, y, z, s) => { rng.pick(rocks).add(M(x, y - s * 0.25, z, rng.range(-0.3, 0.3), rng.range(0, 6.28), rng.range(-0.3, 0.3), s, s, s, 'YXZ'), rng.pick(ROCKC)); };
  const addOrange = (x, y, z) => {
    smallTrunks.add(M(x, y, z, 0, 0, 0, 1)); const sc = rng.range(0.8, 1.1); const m = M(x, y, z, 0, rng.range(0, 6), 0, sc, sc, sc, 'YXZ');
    const tint = leafTint(); orangeCore.add(m, tint); orangeI.add(m, tint);
    for (let i = 0; i < 12; i++) { const a = rng.range(0, 6.28), r = rng.range(1.0, 1.5) * sc; fruitPos.push([x + Math.cos(a) * r, y + 2.9 * sc + rng.range(-0.9, 0.7), z + Math.sin(a) * r]); }
  };

  // A separate stream varies species while keeping every tree's placement reproducible.
  const variety = new RNG(9163);
  const BOUGAINVILLEA = ['#d8429b', '#b438b4', '#ee6ba9', '#faf1dd', '#e86955'].map((c) => new THREE.Color(c));
  const addOlive = (x, y, z) => {
    const sc = variety.range(0.8, 1.35), m = M(x, y, z, 0, variety.range(0, 6.28), 0, sc, sc * variety.range(0.85, 1.1), sc, 'YXZ');
    const tint = new THREE.Color().setRGB(variety.range(0.9, 1.1), variety.range(0.96, 1.12), variety.range(0.9, 1.06));
    oliveTrunks.add(m); oliveCards.add(m, tint); oliveFar.add(m, tint);
  };
  const addDryPlant = (x, y, z, scale = 1) => {
    const n = variety.next(), plant = n < 0.12 ? agave : n < 0.2 ? pricklyPear : phrygana;
    const sc = scale * variety.range(0.65, 1.3), tint = new THREE.Color().setRGB(variety.range(0.85, 1.15), variety.range(0.88, 1.05), variety.range(0.78, 1.05));
    plant.add(M(x, y, z, 0, variety.range(0, 6.28), 0, sc, sc * variety.range(0.8, 1.2), sc, 'YXZ'), tint);
  };
  const addBougainvillea = (x, y, z) => { const sc = variety.range(0.8, 1.35); bougainvillea.add(M(x, y, z, 0, variety.range(0, 6.28), 0, sc, sc, sc, 'YXZ'), variety.pick(BOUGAINVILLEA)); };

  // free ground test: on land, not in a building, not on the road or pavement
  const onRoad = (x, z, pad = 1.2) => {
    const q = route.project(x, z, null);
    if (Math.abs(q.s - clamp(q.s, 0, route.length)) > 30) return false;
    const lim = route.edge(q.s) + ROAD.gutter + ROAD.sidewalk(route, q.s, Math.sign(q.u) || 1) + pad;
    return Math.abs(q.u) < lim;
  };
  const free = (x, z, pad = 1.2) => {
    const h = heightC(x, z); if (h < 0.35) return null;
    if (bld.inBuilding(x, z)) return null;
    if (onRoad(x, z, pad)) return null;
    return h;
  };

  // ---- 1. street trees along the route (promenade palms, bitter oranges, median oleanders)
  for (let s = 0; s < route.length; s += 2) {
    const urb = route.urban(s), dv = route.div(s), mh = route.medHalf(s);
    const e = route.edge(s) + ROAD.gutter;
    if (dv > 0.6 && mh > 1.3 && urb > 0.3) {
      if (s % 4 === 0) { route.point(s, rng.range(-0.6, 0.6), pt); addBush(pt.x, pt.y + 0.2, pt.z, rng.range(0.7, 1.1), OLEANDER); }
      if (s % 48 === 18) { route.point(s, 0, pt); addPalm(pt.x, pt.y + 0.2, pt.z, rng.range(9, 12)); }
    }
    for (const side of [1, -1]) {
      const sea = side > 0 ? route.seaR(s) : route.seaL(s);
      const sw = ROAD.sidewalk(route, s, side);
      if (urb > 0.5) {
        if (sea < 140 && s % 14 === (side > 0 ? 0 : 6)) { route.point(s, side * (e + sw - 1.0), pt); addPalm(pt.x, pt.y + ROAD.curbH(route, s), pt.z); }
        else if (sea >= 140 && s % 10 === 4) { route.point(s, side * (e + 1.2), pt); if (!bld.inBuilding(pt.x, pt.z, 0.5)) addOrange(pt.x, pt.y + ROAD.curbH(route, s), pt.z); }
      } else {
        // cliff road: maquis on the verges, rocks below the guard rail, the odd pine
        if (s % 6 === 0) { route.point(s, side * (e + sw + rng.range(2, 9)), pt); const h = heightC(pt.x, pt.z); if (h > 0.4) { if (rng.chance(0.55)) addBush(pt.x, h, pt.z, rng.range(0.6, 1.4), MAQUIS); else addRock(pt.x, h, pt.z, rng.range(0.4, 1.3)); } }
        if (s % 34 === 0 && side < 0) { route.point(s, side * (e + sw + rng.range(6, 16)), pt); const h = heightC(pt.x, pt.z); if (h > 2) addPine(pt.x, h, pt.z, rng.range(5, 9)); }
      }
    }
  }
  // ---- 2. OSM trees
  for (const [x, z, palmF] of data.trees) { const h = free(x, z, 0.3); if (h === null) continue; if (palmF) addPalm(x, h, z); else if (rng.chance(0.58)) addPine(x, h, z, rng.range(6, 11)); else if (variety.chance(0.45)) addOlive(x, h, z); else addOrange(x, h, z); }
  // ---- 3. land-use areas
  const scatter = (poly, density, maxN, fn) => {
    const b = polyBounds(poly.p); const area = Math.abs(polyArea(poly.p));
    const n = Math.min(maxN, Math.floor(area * density));
    for (let i = 0; i < n * 1.6 && i < maxN * 2; i++) {
      const x = rng.range(b.x0, b.x1), z = rng.range(b.z0, b.z1);
      if (!pointInPoly(x, z, poly.p)) continue;
      const q = route.project(x, z, null); if (Math.abs(q.u) > 650) continue;
      const h = free(x, z); if (h === null) continue;
      fn(x, h, z, Math.abs(q.u));
    }
  };
  for (const a of data.areas.wood) if (a.c) scatter(a, 1 / 70, 900, (x, y, z) => addPine(x, y, z));
  for (const a of data.areas.park) if (a.c) scatter(a, 1 / 110, 120, (x, y, z) => { const r = rng.next(); if (r < 0.45) addPine(x, y, z); else if (r < 0.65) addPalm(x, y, z); else if (r < 0.85) addOlive(x, y, z); else addBush(x, y, z, rng.range(0.8, 1.6), MAQUIS); });
  for (const a of data.areas.scrub) if (a.c) scatter(a, 1 / 45, 700, (x, y, z, du) => { if (variety.chance(0.57)) addDryPlant(x, y, z); else if (rng.chance(0.85)) addBush(x, y, z, rng.range(0.6, 1.5), MAQUIS); else addRock(x, y, z, rng.range(0.5, 1.4)); });
  for (const a of data.areas.rock) if (a.c) scatter(a, 1 / 30, 600, (x, y, z) => addRock(x, y, z, rng.range(0.5, 2.2)));
  // gardens of the villas (Kavouri / Vouliagmeni): pines, cypresses, oleanders between houses
  for (let s = 5800; s < 11000; s += 3.2) for (const side of [1, -1]) {
    const u = side * (rng.chance(0.6) ? rng.range(12, 70) : rng.range(70, 320)); route.point(s, u, pt);
    const h = free(pt.x, pt.z, 3); if (h === null) continue;
    const r = rng.next();
    if (r < 0.38) addPine(pt.x, h, pt.z); else if (r < 0.53) addOlive(pt.x, h, pt.z); else if (r < 0.66) cypress.add(M(pt.x, h - 0.3, pt.z, 0, variety.range(0, 6.28), 0, rng.range(0.7, 1.1), rng.range(0.8, 1.2), rng.range(0.7, 1.1))); else if (r < 0.8) addBougainvillea(pt.x, h, pt.z); else addBush(pt.x, h, pt.z, rng.range(0.8, 1.6), r < 0.91 ? OLEANDER : MAQUIS);
  }
  // the cliff road (Limanakia, past Varkiza, Lomvarda): boulders along the rocky shoreline and on the cliffs below the road
  for (let s = 0; s < route.length; s += 3) for (let k = 0; k < 2; k++) {
    if (route.urban(s) > 0.4) { s += 9; break; }
    const u = rng.range(8, 140); route.point(s, u, pt);
    const h = heightC(pt.x, pt.z);
    if (h < -0.6 || h > 30) continue;
    if (onRoad(pt.x, pt.z, 1)) continue;
    const nearSea = h < 4;
    if (nearSea || rng.chance(0.4)) addRock(pt.x, Math.max(h, -0.3), pt.z, nearSea ? rng.range(0.8, 3.2) : rng.range(0.5, 1.6));
    else if (variety.chance(0.6)) addDryPlant(pt.x, h, pt.z); else addBush(pt.x, h, pt.z, rng.range(0.5, 1.2), MAQUIS);
  }
  // breakwaters: rubble mounds of limestone blocks
  for (const a of data.areas.breakwater) {
    const p = a.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]; const L = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < L; d += 2.2) { const t = d / L; addRock(ax + (bx - ax) * t + rng.range(-1.5, 1.5), 0.6, az + (bz - az) * t + rng.range(-1.5, 1.5), rng.range(1.0, 2.0)); }
    }
  }
  for (const c of [palmTrunk, palmCrown, fanCrown, palmBoot, pineTrunk, ...pineCore, ...pineCards, ...bushCore, ...oleFar, ...oleI, ...lenI, ...rocks, cypCore, cypI, orangeCore, orangeI, smallTrunks, oliveTrunks, oliveCards, oliveFar, bougainvillea, phrygana, agave, pricklyPear]) c.build(group);
  {
    const fruit = new CellInstances(fruitGeo, new THREE.MeshStandardMaterial({ color: '#f07a10', roughness: 0.42 }), { cell: 300, far: 260, shadow: false });
    for (const [x, y, z] of fruitPos) fruit.add(M(x, y, z));
    fruit.build(group);
  }

  // ---- 4. piers (concrete decks)
  const concrete = new THREE.MeshStandardMaterial({ color: '#c4beb2', roughness: 0.85 });
  for (const a of data.areas.pier) {
    const p = a.p;
    if (a.c && p.length >= 6) {
      const shape = new THREE.Shape(); for (let i = 0; i < p.length; i += 2) (i ? shape.lineTo(p[i], -p[i + 1]) : shape.moveTo(p[i], -p[i + 1]));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -1.2, 0);
      const m = new THREE.Mesh(g, concrete); m.receiveShadow = true; m.castShadow = true; m.layers.enable(REFLECT_LAYER); group.add(m);
    } else for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, L + 1), concrete); m.position.set((ax + bx) / 2, 0, (az + bz) / 2); m.rotation.y = Math.atan2(bx - ax, bz - az); m.receiveShadow = true; m.layers.enable(REFLECT_LAYER); group.add(m);
    }
  }

  // ---- 5. marinas: berthed yachts and sailing boats; boats moored in the bays
  const hullMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.05 });
  const boats = [boatGeo(0), boatGeo(1), boatGeo(2)].map((g) => new CellInstances(g, hullMat, { colors: true, cell: 600, far: 3000, shadow: false }));
  const BOATC = [new THREE.Color('#f4f4f2'), new THREE.Color('#f4f4f2'), new THREE.Color('#e9eef3'), new THREE.Color('#1f3d68'), new THREE.Color('#f4f4f2')];
  for (const a of data.areas.marina) {
    if (!a.c) continue;
    const b = polyBounds(a.p);
    // principal axis of the basin
    const ang = Math.atan2(b.z1 - b.z0, b.x1 - b.x0) > 0.78 ? 0 : Math.PI / 2;
    for (let x = b.x0; x < b.x1; x += 5.2) for (let z = b.z0; z < b.z1; z += 16) {
      const jx = x + rng.range(-0.4, 0.4), jz = z + rng.range(-1, 1);
      if (!pointInPoly(jx, jz, a.p) || heightC(jx, jz) > -0.8) continue;
      if (rng.chance(0.18)) continue;
      const k = rng.chance(0.45) ? 0 : rng.chance(0.6) ? 1 : 2;
      boats[k].add(M(jx, 0.05, jz, 0, ang + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.05, 0.05), 0, 1), rng.pick(BOATC));
    }
  }
  for (let i = 0; i < 160; i++) {
    const s = rng.range(0, route.length), u = rng.range(60, 900); route.point(s, u, pt);
    const h = heightC(pt.x, pt.z); if (h > -2.5 || h < -26) continue;
    const k = rng.chance(0.5) ? 0 : rng.chance(0.7) ? 2 : 1;
    boats[k].add(M(pt.x, 0.05, pt.z, 0, rng.range(0, 6.28), 0, 1), rng.pick(BOATC));
  }
  for (const c of boats) { c.build(group); for (const m of c.meshes) m.layers.enable(REFLECT_LAYER); }

  // ---- 6. organised beaches: parasols + sunbeds (straw at Astir and the lake)
  const umb = umbrellaGeo(false), straw = umbrellaGeo(true);
  const poleI = new CellInstances(umb.pole, new THREE.MeshStandardMaterial({ color: '#d9d4c7', roughness: 0.6 }), { cell: 500, far: 500, shadow: false });
  const topI = new CellInstances(umb.top, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide }), { colors: true, cell: 500, far: 1200 });
  const strawI = new CellInstances(straw.top, new THREE.MeshStandardMaterial({ color: '#b99b62', roughness: 1, side: THREE.DoubleSide }), { cell: 500, far: 1200 });
  const bedGeo = new THREE.BoxGeometry(0.7, 0.3, 1.9); bedGeo.translate(0, 0.25, 0);
  const beds = new CellInstances(bedGeo, new THREE.MeshStandardMaterial({ color: '#f1efe9', roughness: 0.7 }), { cell: 500, colors: true, far: 450, shadow: false });
  const UMB = [new THREE.Color('#f6f6f2'), new THREE.Color('#1f6fb4'), new THREE.Color('#f2c230'), new THREE.Color('#e8572d'), new THREE.Color('#f6f6f2')];
  const beachPeople = [], sunbeds = [];
  for (const a of data.areas.beach) {
    if (!a.c) continue;
    const isAstir = /Aster|Astir/i.test(a.n || '');
    const b = polyBounds(a.p);
    const col = rng.pick(UMB);
    const strawB = isAstir || rng.chance(0.35);
    let n = 0;
    for (let x = b.x0; x < b.x1; x += 4.5) for (let z = b.z0; z < b.z1; z += 4.5) {
      const jx = x + rng.range(-0.5, 0.5), jz = z + rng.range(-0.5, 0.5);
      if (!pointInPoly(jx, jz, a.p)) continue;
      const h = heightC(jx, jz); if (h < 0.5 || h > 3) continue;
      const q = route.project(jx, jz, null); if (Math.abs(q.u) > 700) continue;
      if (++n > 400) break;
      poleI.add(M(jx, h, jz)); (strawB ? strawI : topI).add(M(jx, h, jz, 0, rng.range(0, 6), 0, 1), col);
      const yaw = rng.range(-0.2, 0.2) + Math.atan2(-1, 0.3);
      for (const o of [-0.55, 0.55]) { beds.add(M(jx + o, h, jz + 0.9, 0, yaw, 0, 1), isAstir ? '#ffffff' : '#e6e1d6'); sunbeds.push([jx + o, h, jz + 0.9, yaw]); }
      if (rng.chance(0.4)) beachPeople.push([jx + rng.range(-1.5, 1.5), h, jz + rng.range(0.5, 2.5)]);
    }
  }
  poleI.build(group); topI.build(group); strawI.build(group); beds.build(group);

  // ---- 7. side streets from OSM (asphalt and footpaths draped on the terrain)
  buildSideStreets(data.sideRoads, group, heightC, route);

  // ---- 8. kiosks (periptero) at the real OSM kiosk positions on the avenue
  for (const poi of data.pois) {
    if (poi.k !== 'shop:kiosk' || Math.abs(poi.u) > 60) continue;
    const side = Math.sign(poi.u) || 1;
    const u = side * (route.edge(poi.s) + ROAD.gutter + Math.min(2.2, ROAD.sidewalk(route, poi.s, side) - 1));
    route.point(poi.s, u, pt);
    const fr = route.frame(poi.s, {});
    const k = makeKiosk(assets.labels, poi.n);
    k.position.set(pt.x, pt.y + ROAD.curbH(route, poi.s), pt.z); k.rotation.y = Math.atan2(fr.tx, fr.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(k);
  }

  // ---- 9. Lake Vouliagmeni water surface
  for (const a of data.areas.lake) {
    if (!a.c || a.p.length < 6) continue;
    const shape = new THREE.Shape(); for (let i = 0; i < a.p.length; i += 2) (i ? shape.lineTo(a.p[i], -a.p[i + 1]) : shape.moveTo(a.p[i], -a.p[i + 1]));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    group.add(assets.water.makeLake(g, 0.3));
    // straw parasols around the lake's lido
    const n = a.p.length / 2;
    for (let i = 0; i < n; i++) {
      const x = a.p[i * 2], z = a.p[i * 2 + 1];
      const cx = a.p.reduce((s, v, j) => s + (j % 2 === 0 ? v : 0), 0) / n, cz = a.p.reduce((s, v, j) => s + (j % 2 === 1 ? v : 0), 0) / n;
      const dx = x - cx, dz = z - cz, L = Math.hypot(dx, dz) || 1;
      const px = x + dx / L * 6, pz = z + dz / L * 6; const h = heightC(px, pz);
      if (h > 0.3 && h < 6 && i % 2 === 0) { const sp = new THREE.Mesh(straw.top, strawI.mat); sp.position.set(px, h, pz); group.add(sp); const pl = new THREE.Mesh(straw.pole, poleI.mat); pl.position.set(px, h, pz); group.add(pl); }
    }
  }
  assets.beachPeople = beachPeople; assets.sunbeds = sunbeds;
  return { group };
}

function buildSideStreets(list, group, heightC, route) {
  const pos = [], col = [], idx = [], shadingRng = new RNG(451);
  const asph = new THREE.Color('#3a3a3c'), foot = new THREE.Color('#b9b1a1');
  for (const r of list) {
    const p = r.p; const n = p.length / 2; if (n < 2) continue;
    const pts = [];
    for (let i = 0; i + 1 < n; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3]; const L = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.ceil(L / 8));
      for (let j = 0; j < k; j++) pts.push([ax + (bx - ax) * j / k, az + (bz - az) * j / k]);
    }
    pts.push([p[n * 2 - 2], p[n * 2 - 1]]);
    const hw = r.w / 2, c = r.f ? foot : asph;
    const base = pos.length / 3;
    let rows = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const rx = -tz, rz = tx;
      for (const sd of [-1, 1]) {
        const x = pts[i][0] + rx * hw * sd, z = pts[i][1] + rz * hw * sd;
        const h = heightC(x, z);
        pos.push(x, Math.max(h, 0.1) + 0.06, z);
        const sh = shadingRng.range(0.9, 1.05); col.push(c.r * sh, c.g * sh, c.b * sh);
      }
      if (i > 0) { const v = base + (rows - 1) * 2; idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
      rows++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  // the strips may wind either way: force normals up
  const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) if (nn.getY(i) < 0) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // textured: worn asphalt for streets, concrete paving slabs for footpaths (vertex colour tells them apart)
  mat.customProgramCacheKey = () => 'side6';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tAD: { value: TX.asphalt_diff }, tAN: { value: TX.asphalt_nor }, tPD: { value: TX.paver_diff }, tPN: { value: TX.paver_nor } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tAD; uniform sampler2D tAN; uniform sampler2D tPD; uniform sampler2D tPN; varying vec3 vSW; vec3 sN; vec2 sUV;
      ${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float foot = step(0.3, vColor.r);
        sUV = vSW.xz / (foot > 0.5 ? 3.2 : 4.2);
        vec3 a = texNoTile(tAD, sUV).rgb, pv = texture2D(tPD, sUV).rgb;
        sN = (foot > 0.5 ? texture2D(tPN, sUV).xyz : texNoTile(tAN, sUV).xyz) * 2.0 - 1.0;
        diffuseColor.rgb = foot > 0.5 ? pv * 1.05 : mix(vec3(dot(a, vec3(0.333))), a, 0.5) * 1.5 * (0.8 + 0.4 * fbm2(vSW.xz * 0.05));
      }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); if (dot(normal, upV) < 0.0) normal = -normal;\nnormal = perturb(-vViewPosition, normal, sUV, sN, 1.0);');
  };
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m);
}

function makeKiosk(labels, name) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.3, 1.5), new THREE.MeshStandardMaterial({ color: '#2a5d3a', roughness: 0.6 })); body.position.y = 1.15; body.castShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.4), new THREE.MeshStandardMaterial({ color: '#e7e3d8', roughness: 0.6 })); roof.position.y = 2.45; roof.castShadow = true; g.add(roof);
  const fridge = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.6), new THREE.MeshStandardMaterial({ color: '#d61f26', roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.05 })); fridge.position.set(1.25, 0.85, 0.2); g.add(fridge);
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 1.3), new THREE.MeshStandardMaterial({ color: '#d9c88f', roughness: 0.8 })); rack.position.set(0.9, 1.3, 0); g.add(rack);
  if (labels) { const r = labels.add('PERIPTERO · ' + String(name || 'KIOSK').toUpperCase(), '#f2d230', '#1a1a1a'); if (r) { const s = labels.plane(r, 2.5, 0.4); s.position.set(0, 2.72, 1.21); g.add(s); const s2 = labels.plane(r, 2.5, 0.4); s2.position.set(0, 2.72, -1.21); s2.rotation.y = Math.PI; g.add(s2); } }
  return g;
}
