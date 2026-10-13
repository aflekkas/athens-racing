// The road: a continuous spline sweep along the real route with banking, shader-drawn markings,
// curbs, pavements/shoulders, planted median, guard rails and road furniture.
import * as THREE from 'three';
import { REFLECT_LAYER } from './env.js';
import { clamp, smoothstep, canvasTex, CellInstances, M, RNG, lerp } from './util.js';
import { LANE_W } from './map.js';
import { terrainMaterial } from './terrain.js';
import { TX, GLSL_HELPERS } from './tex.js';

const STEP = 2;
const CHUNK = 600; // metres per mesh chunk

export const ROAD = {
  curbH: (route, s) => 0.16 * smoothstep(0.15, 0.6, route.urban(s)),
  gutter: 0.55,
  /** pavement / shoulder width beyond the curb */
  sidewalk(route, s, side) {
    const urb = route.urban(s);
    const sea = side > 0 ? route.seaR(s) : route.seaL(s);
    const prom = sea < 140 ? 2.4 : 0; // the seaside promenade is wider (palms, benches)
    return lerp(1.6, 3.6 + prom, urb);
  },
  /** hard limits for the car body centre (u range) */
  limits(route, s, out) {
    const e = route.edge(s), mh = route.medHalf(s), div = route.div(s), urb = route.urban(s);
    const outer = e + ROAD.gutter + (urb > 0.5 ? 0 : 1.1);
    out.max = outer; out.min = div > 0.45 ? mh : -outer;
    return out;
  },
};

// ------------------------------------------------------------------ materials
// Asphalt: photographed asphalt (albedo / normal / roughness, anti-tiling) + macro variation, repaired patches,
// tyre-polished wheel tracks, oil drips down the lane centres, a dusty gutter; worn thermoplastic markings.
function asphaltMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.userData.uniforms = { tAD: { value: TX.asphalt_diff }, tAN: { value: TX.asphalt_nor }, tAR: { value: TX.asphalt_arm }, uCross: { value: new Float32Array(16).fill(-9999) }, uStop: { value: new Float32Array(8).fill(-9999) }, uStopO: { value: new Float32Array(8).fill(-9999) } };
  mat.customProgramCacheKey = () => 'asphalt6';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSU; attribute vec4 aEM; varying vec2 vSU; varying vec4 vEM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSU = aSU; vEM = aEM;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tAD; uniform sampler2D tAN; uniform sampler2D tAR; uniform float uCross[16]; uniform float uStop[8]; uniform float uStopO[8];
      varying vec2 vSU; varying vec4 vEM;
      ${GLSL_HELPERS}
      // anti-aliased band |x - c| < w/2
      float band(float x, float c, float w){ float d = abs(x - c) - w * 0.5; float fw = max(fwidth(x), 1e-4); return 1.0 - smoothstep(-fw, fw, d); }
      float paint = 0.0; float polish = 0.0; float gRough = 0.9; vec3 aN = vec3(0.0, 0.0, 1.0); float gut = 0.0;
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float s = vSU.x, u = vSU.y, au = abs(u);
        float e = vEM.x, mh = vEM.y, nl = vEM.z, dv = vEM.w;
        vec2 tuv = vec2(u, s) / 4.2;
        vec3 alb = texNoTile(tAD, tuv).rgb;
        vec4 nr = texNoTile(tAN, tuv);
        vec3 arm = texNoTile(tAR, tuv).rgb;
        aN = nr.xyz * 2.0 - 1.0;
        float macro = fbm2(vec2(u * 0.08, s * 0.012)) ;
        float lumA = dot(alb, vec3(0.333));
        vec3 base = (vec3(0.1) + (mix(vec3(lumA), alb, 0.5) - 0.1) * 0.55) * 1.4 * (0.72 + 0.56 * macro) * vec3(0.98, 0.98, 1.0);
        // repaired patches: darker, smoother rectangles of newer asphalt with crisp edges
        vec2 pc = floor(vec2(u / 3.5, s / 19.0));
        float pr = h12(pc + 7.1);
        if (pr > 0.86) { vec2 lf = fract(vec2(u / 3.5, s / 19.0)); float inP = band(lf.x, 0.5, 0.62 + 0.2 * h12(pc)) * band(lf.y, 0.45, 0.4 + 0.3 * h12(pc + 3.0)); base = mix(base, base * 0.62, inP); aN.xy *= 1.0 - 0.6 * inP; }
        // tyre-polished tracks in each lane, oil drips between them
        float lu = (au - mh) / ${LANE_W.toFixed(2)};
        float lf = fract(lu);
        float inLane = step(0.0, lu) * step(lu, nl);
        polish = (smoothstep(0.17, 0.0, abs(lf - 0.25)) + smoothstep(0.17, 0.0, abs(lf - 0.75))) * inLane;
        float oil = smoothstep(0.12, 0.0, abs(lf - 0.5)) * inLane * smoothstep(0.45, 0.8, vn2(vec2(u * 2.0, s * 0.35))) * 0.6;
        base *= (1.0 - polish * 0.12) * (1.0 - oil * 0.35);
        // gutter: dusty concrete edge strip, sand and grit drift against the curb
        gut = smoothstep(e + 0.02, e + 0.06, au);
        vec3 conc = vec3(0.42, 0.405, 0.38) * (0.78 + 0.4 * alb.r);
        base = mix(base, conc, gut);
        float dust = smoothstep(e - 0.9, e + 0.4, au) * (0.5 + 0.5 * vn2(vec2(s * 0.3, u * 3.0)));
        base = mix(base, vec3(0.36, 0.33, 0.28), dust * 0.35);
        // ---- markings (white thermoplastic, chipped and worn by tyres)
        float m = 0.0;
        m += band(au, e - 0.22, 0.15);                       // edge lines
        if (dv > 0.5) m += band(au, mh + 0.22, 0.12);       // inner edge next to the median
        else { m += band(u, 0.12, 0.1) + band(u, -0.12, 0.1); } // double solid centre line
        float dash = band(fract(s / 9.0), 0.185, 0.37);
        for (int i = 1; i < 4; i++) { float fi = float(i); if (fi < nl - 0.3) m += band(au, mh + fi * ${LANE_W.toFixed(2)}, 0.12) * dash; }
        // zebra crossings and stop lines near the player
        float heavy = 0.0;
        for (int i = 0; i < 16; i++) {
          float ds = s - uCross[i];
          if (abs(ds) < 2.6) { float bar = band(fract(u / 1.1 + 0.25), 0.75, 0.5); float z = bar * band(ds, 0.0, 4.0) * step(au, e - 0.3); m += z; heavy += z; }
        }
        for (int i = 0; i < 8; i++) { float ds = s - uStop[i]; m += band(ds, 0.0, 0.45) * step(mh, u) * step(u, e - 0.3); float dso = s - uStopO[i]; m += band(dso, 0.0, 0.45) * step(u, -mh) * step(-(e - 0.3), u); }
        float wearN = vn2(vec2(u * 9.0, s * 2.3)) * 0.55 + vn2(vec2(u * 31.0, s * 13.0)) * 0.45;
        float wearK = 0.32 + polish * 0.25 * heavy + (1.0 - lumA) * 0.25;
        float chip = smoothstep(wearK - 0.05, wearK + 0.08, wearN);
        paint = clamp(m, 0.0, 1.0) * (1.0 - gut) * chip;
        vec3 pcol = vec3(0.8, 0.8, 0.77) * (0.88 + 0.12 * alb.r / max(lumA, 0.05)) * (1.0 - polish * 0.15 * heavy);
        diffuseColor.rgb = mix(base, pcol, paint);
        gRough = mix(clamp(arm.g * 1.05, 0.55, 1.0), 0.55, polish * 0.55 + oil * 0.6);
        gRough = mix(gRough, 0.62, paint);
        aN.xy *= (1.0 - paint * 0.75) * (1.0 - polish * 0.3);
        diffuseColor.rgb *= mix(1.0, arm.r, 0.3);
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, vec2(vSU.y, vSU.x) / 4.2, aN, 1.2);');
  };
  return mat;
}

// Pavements: grooved square concrete paving slabs (photographed), tinted per district; gravel shoulders outside town
function pavingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true });
  mat.customProgramCacheKey = () => 'paving6';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tPD = { value: TX.paver_diff }; sh.uniforms.tPN = { value: TX.paver_nor }; sh.uniforms.tPR = { value: TX.paver_arm };
    sh.uniforms.tGD = { value: TX.ground_diff }; sh.uniforms.tGN = { value: TX.ground_nor };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSU; varying vec2 vSU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSU = aSU;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tPD; uniform sampler2D tPN; uniform sampler2D tPR; uniform sampler2D tGD; uniform sampler2D tGN;
      varying vec2 vSU; vec3 pN = vec3(0, 0, 1); float pRough = 0.85; float gravel = 0.0;
      ${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 q = vec2(vSU.x, vSU.y) / 3.2;
        vec3 alb = texture2D(tPD, q).rgb; vec4 n = texture2D(tPN, q); vec3 arm = texture2D(tPR, q).rgb;
        gravel = smoothstep(0.42, 0.34, dot(vColor, vec3(0.333))); // gravel shoulders are vertex-coloured darker
        vec2 gq = vSU / 3.5;
        vec3 g = texNoTile(tGD, gq).rgb; vec3 gn = texture2D(tGN, gq).xyz;
        float stain = fbm2(vSU * 0.35);
        vec3 tile = alb * vec3(1.08, 1.06, 1.02) * (0.85 + 0.3 * stain) * (vColor / max(0.001, dot(vColor, vec3(0.333)))) * 0.95;
        diffuseColor.rgb = mix(tile, g * vec3(1.05, 0.98, 0.9), gravel);
        pN = mix(n.xyz, gn, gravel) * 2.0 - 1.0;
        pRough = mix(clamp(arm.g, 0.5, 1.0), 0.95, gravel);
        diffuseColor.rgb *= mix(1.0, arm.r, 0.7 * (1.0 - gravel));
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = pRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, vSU / 3.2, pN, 1.0);');
  };
  return mat;
}

// Curbs, median noses, piers: worn concrete
export function concreteMaterial(color = '#d8d3c8', scale = 2.0) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  mat.customProgramCacheKey = () => 'concrete6_' + scale;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tCD = { value: TX.concrete_diff }; sh.uniforms.tCN = { value: TX.concrete_nor }; sh.uniforms.tCR = { value: TX.concrete_arm };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tCD; uniform sampler2D tCN; uniform sampler2D tCR; varying vec3 vCW; varying vec3 vCWN; vec3 cN = vec3(0,0,1); float cR = 0.85; vec2 cUV;
      ${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 an = abs(vCWN);
        cUV = (an.y > max(an.x, an.z) ? vCW.xz : an.x > an.z ? vCW.zy : vCW.xy) / ${scale.toFixed(2)};
        vec3 alb = texture2D(tCD, cUV).rgb; vec3 arm = texture2D(tCR, cUV).rgb; cN = texture2D(tCN, cUV).xyz * 2.0 - 1.0;
        float l = dot(alb, vec3(0.333));
        diffuseColor.rgb *= (0.55 + 0.9 * l) * (0.85 + 0.25 * fbm2(cUV * 0.4)) * mix(1.0, arm.r, 0.6);
        cR = clamp(arm.g, 0.55, 1.0);
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = cR;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, cUV, cN, 0.8);');
  };
  return mat;
}

// ------------------------------------------------------------------ geometry
class Strip {
  constructor(cols) { this.cols = cols; this.pos = []; this.su = []; this.em = []; this.col = []; this.rows = 0; }
  row(points) { // points: [{p:Vector3, s, u, c?:Color}]
    for (const q of points) { this.pos.push(q.p.x, q.p.y, q.p.z); this.su.push(q.s, q.u); if (q.em) this.em.push(...q.em); if (q.c) this.col.push(q.c.r, q.c.g, q.c.b); }
    this.rows++;
  }
  build(flipU = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aSU', new THREE.Float32BufferAttribute(this.su, 2));
    if (this.em.length) g.setAttribute('aEM', new THREE.Float32BufferAttribute(this.em, 4));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const idx = [], C = this.cols;
    for (let r = 0; r + 1 < this.rows; r++) for (let c = 0; c + 1 < C; c++) {
      const a = r * C + c, b = a + 1, d = a + C, e = d + 1;
      if (!flipU) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e);
    }
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}

export function buildRoad(map, scene, heightC, assets) {
  const { route, data } = map;
  const group = new THREE.Group(); scene.add(group);
  const asphalt = asphaltMaterial();
  const paving = pavingMaterial();
  const curbMat = concreteMaterial('#e2ddd2', 1.6);
  const vergeMat = terrainMaterial();
  const P = () => new THREE.Vector3();
  const sMin = -60, sMax = route.length + 60;
  const cConc = new THREE.Color('#bdb8ad'), cSoil = new THREE.Color('#6b5a40'), cGrass = new THREE.Color('#62733a'), cGravel = new THREE.Color('#9c917c'), cDirt = new THREE.Color('#8f8064');

  for (let c0 = sMin; c0 < sMax; c0 += CHUNK) {
    const c1 = Math.min(sMax, c0 + CHUNK);
    const road = new Strip(7), med = new Strip(6), curbR = new Strip(4), curbL = new Strip(4), walkR = new Strip(3), walkL = new Strip(3), skR = new Strip(3), skL = new Strip(3);
    for (let s = c0; s <= c1 + 0.001; s += STEP) {
      const e = route.edge(s), mh = route.medHalf(s), nl = route.lanesF(s), dv = route.div(s);
      const eA = e + ROAD.gutter;
      const em = [e, mh, nl, dv];
      const us = [-eA, -e, -mh, 0, mh, e, eA];
      road.row(us.map((u) => ({ p: route.point(s, u, P()), s, u, em })));
      // median island (raised when the avenue is divided)
      const mhH = 0.2 * smoothstep(0.25, 0.6, dv);
      const y0 = route.surfaceY(s, 0);
      const mrow = [[-mh, 0, cConc], [-mh, mhH, cConc], [-mh + 0.16, mhH, cConc], [mh - 0.16, mhH, cConc], [mh, mhH, cConc], [mh, 0, cConc]];
      med.row(mrow.map(([u, h, c], i) => { const p = route.point(s, u, P()); p.y += h + (i === 2 || i === 3 ? 0.02 : 0); return { p, s, u, c: (i === 2 || i === 3) && mh > 0.6 ? (Math.sin(s * 0.7) > 0 ? cSoil : cGrass) : c }; }));
      // curbs + pavements both sides
      const ch = ROAD.curbH(route, s);
      for (const side of [1, -1]) {
        const sw = ROAD.sidewalk(route, s, side);
        const yC = route.surfaceY(s, side * eA);
        const yTop = yC + ch;
        const pts = [[eA, yC], [eA, yTop], [eA + 0.18, yTop], [eA + 0.18, yTop]];
        const curb = side > 0 ? curbR : curbL;
        curb.row(pts.map(([u, y], i) => { const p = route.point(s, side * u, P()); p.y = y + (i === 3 ? -0.0 : 0); return { p, s, u: side * u }; }));
        const walk = side > 0 ? walkR : walkL;
        const urb = route.urban(s);
        const wc = urb > 0.5 ? cConc : cGravel;
        const wp = [[eA + 0.18, yTop], [eA + 0.18 + sw * 0.5, yTop + 0.01], [eA + 0.18 + sw, yTop + 0.02]];
        walk.row(wp.map(([u, y]) => { const p = route.point(s, side * u, P()); p.y = y; return { p, s, u: side * u, c: wc }; }));
        // skirt down to the terrain
        const uo = eA + 0.18 + sw;
        const po = route.point(s, side * (uo + 0.5), P());
        const th = heightC(po.x, po.z);
        const sk = side > 0 ? skR : skL;
        const yb = Math.min(yTop - 0.1, th - 0.25);
        const pk1 = route.point(s, side * (uo + 0.05), P()); pk1.y = yTop + 0.02;
        const pk2 = route.point(s, side * (uo + 0.4), P()); pk2.y = lerp(yTop, yb, 0.6);
        const pk3 = route.point(s, side * (uo + 1.0 + Math.max(0, yTop - yb) * 0.6), P()); pk3.y = yb;
        sk.row([{ p: pk1, s, u: side * uo, c: cDirt }, { p: pk2, s, u: side * uo, c: cDirt }, { p: pk3, s, u: side * uo, c: cDirt }]);
      }
    }
    const add = (geo, mat, shadow = false, refl = false) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = shadow; if (refl) m.layers.enable(REFLECT_LAYER); group.add(m); return m; };
    add(road.build(), asphalt, false, true);
    add(med.build(), vergeMat, true);
    add(curbR.build(), curbMat); add(curbL.build(true), curbMat);
    add(walkR.build(), paving, false, true); add(walkL.build(true), paving, false, true);
    add(skR.build(), vergeMat); add(skL.build(true), vergeMat);
  }

  if (assets.furniture !== false) buildFurniture(map, group, heightC, assets);
  return { group, asphalt };
}

// ------------------------------------------------------------------ furniture
function signTexture(route) {
  // atlas of road signs (all English / Latin)
  const W = 2048, H = 1024;
  const regions = {};
  const tex = canvasTex(W, H, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    const blue = '#0b4ea2';
    const font = (px, w = 700) => `${w} ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    let y = 0;
    const panel = (key, w, h, draw) => { if (!panel.x || panel.x + w > W) { panel.x = 0; y += panel.rowH || 0; panel.rowH = 0; } regions[key] = [panel.x / W, 1 - (y + h) / H, (panel.x + w) / W, 1 - y / H]; g.save(); g.translate(panel.x, y); draw(w, h); g.restore(); panel.x += w; panel.rowH = Math.max(panel.rowH, h); };
    const dirSign = (key, lines) => panel(key, 512, 256, (w, h) => {
      g.fillStyle = blue; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#fff'; g.textBaseline = 'middle';
      lines.forEach(([txt, arrow, km], i) => {
        const yy = 60 + i * 70;
        g.font = font(54); g.textAlign = 'left'; g.fillText(txt, 92, yy);
        if (km) { g.textAlign = 'right'; g.fillText(km, w - 34, yy); }
        g.save(); g.translate(52, yy); g.rotate(arrow); g.beginPath(); g.moveTo(0, -24); g.lineTo(18, 0); g.lineTo(6, 0); g.lineTo(6, 22); g.lineTo(-6, 22); g.lineTo(-6, 0); g.lineTo(-18, 0); g.closePath(); g.fill(); g.restore();
      });
    });
    dirSign('d_start', [['ASTIR BEACH', Math.PI / 2, ''], ['VARKIZA', 0, '6'], ['SOUNIO', 0, '47']]);
    dirSign('d_lake', [['LAKE VOULIAGMENI', -Math.PI / 2, ''], ['LIMANAKIA', 0, '1.5'], ['VARKIZA', 0, '5']]);
    dirSign('d_astir', [['ASTIR BEACH', Math.PI / 2, ''], ['MARINA', Math.PI / 2, ''], ['VARKIZA', 0, '5']]);
    dirSign('d_varkiza', [['VARI', -Math.PI / 2, '4'], ['LOMVARDA', 0, '3'], ['SOUNIO', 0, '42']]);
    // speed limits
    for (const v of [30, 40, 50, 60, 70]) panel('sl' + v, 256, 256, (w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.fillStyle = '#d0141e'; g.fill();
      g.beginPath(); g.arc(128, 128, 92, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.fillStyle = '#111'; g.font = font(118, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), 128, 134);
    });
    // place-name boards (white on blue, Greek style but Latin text)
    for (const [k, t] of [['n_vouliagmeni', 'VOULIAGMENI'], ['n_limanakia', 'LIMANAKIA'], ['n_varkiza', 'VARKIZA'], ['n_lomvarda', 'LOMVARDA']]) panel(k, 512, 128, (w, h) => {
      g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.strokeStyle = blue; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = blue; g.font = font(78, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h / 2 + 4);
    });
    panel('bus', 256, 256, (w, h) => { g.fillStyle = '#0b4ea2'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = font(120, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUS', 128, 100); g.font = font(44, 700); g.fillText('OASA', 128, 196); });
    panel('chev', 256, 256, (w, h) => { g.fillStyle = '#ffd400'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let i = 0; i < 2; i++) { g.beginPath(); const x = 50 + i * 90; g.moveTo(x, 30); g.lineTo(x + 70, 128); g.lineTo(x, 226); g.lineTo(x + 34, 226); g.lineTo(x + 104, 128); g.lineTo(x + 34, 30); g.closePath(); g.fill(); } });
    panel('finish', 1024, 256, (w, h) => {
      for (let i = 0; i < 32; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 32, j * 32, 32, 32); }
      g.fillStyle = 'rgba(10,12,16,.92)'; g.fillRect(150, 50, w - 300, h - 100);
      g.fillStyle = '#fff'; g.font = `italic 900 120px "Barlow Condensed", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('FINISH · ' + route.to.toUpperCase(), w / 2, h / 2 + 6);
    });
    panel('start', 1024, 256, (w, h) => {
      g.fillStyle = '#0b0d10'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff3d2e'; g.fillRect(0, 0, 40, h); g.fillRect(w - 40, 0, 40, h);
      g.fillStyle = '#fff'; g.font = `italic 900 110px "Barlow Condensed", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RIVIERA RUN · START', w / 2, h / 2 + 6);
    });
  });
  return { tex, regions };
}
function uvRect(geo, r) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + (r[2] - r[0]) * uv.getX(i), r[1] + (r[3] - r[1]) * uv.getY(i)); return geo; }

function buildFurniture(map, group, heightC, assets) {
  const { route, data } = map;
  const rng = new RNG(77);
  const metal = new THREE.MeshStandardMaterial({ color: '#7d8186', metalness: 0.85, roughness: 0.38 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#3b3f44', metalness: 0.7, roughness: 0.45 });
  const white = new THREE.MeshStandardMaterial({ color: '#e9e7e1', roughness: 0.6 });
  const lampHead = new THREE.MeshStandardMaterial({ color: '#d6d8da', metalness: 0.4, roughness: 0.4, emissive: '#fff2d6', emissiveIntensity: 0.15 });
  const { tex, regions } = signTexture(route);
  const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.1 });
  assets.signRegions = regions; assets.signMat = signMat;
  const lim = {};
  const pt = new THREE.Vector3();

  // -- street lamps: double-arm on the median, single-arm on pavements, none on the cliff road
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.12, 9.5, 8); poleGeo.translate(0, 4.75, 0);
  const armGeo = new THREE.CylinderGeometry(0.045, 0.05, 2.2, 6); armGeo.rotateZ(Math.PI / 2); armGeo.translate(1.1, 9.2, 0);
  const headGeo = new THREE.BoxGeometry(0.75, 0.16, 0.32); headGeo.translate(2.25, 9.15, 0);
  const lampPole = new CellInstances(poleGeo, metal, { far: 1600 }), lampArm = new CellInstances(armGeo, metal, { far: 900, shadow: false }), lampHeadI = new CellInstances(headGeo, lampHead, { shadow: false, far: 900 });
  for (let s = 10; s < route.length; s += 36) {
    const urb = route.urban(s); if (urb < 0.4) continue;
    const dv = route.div(s), f = route.frame(s, {});
    const yaw = Math.atan2(f.tx, f.tz);
    if (dv > 0.6 && route.medHalf(s) > 1.2) {
      route.point(s, 0, pt);
      lampPole.addTRS(pt.x, pt.y + 0.2, pt.z, yaw, 1);
      for (const a of [0, Math.PI]) { lampArm.addTRS(pt.x, pt.y + 0.2, pt.z, yaw + a, 1); lampHeadI.addTRS(pt.x, pt.y + 0.2, pt.z, yaw + a, 1); }
    } else {
      const u = route.edge(s) + ROAD.gutter + 0.6;
      route.point(s, u, pt);
      lampPole.addTRS(pt.x, pt.y + 0.15, pt.z, yaw, 1);
      lampArm.addTRS(pt.x, pt.y + 0.15, pt.z, yaw, 1); lampHeadI.addTRS(pt.x, pt.y + 0.15, pt.z, yaw, 1);
    }
  }
  lampPole.build(group); lampArm.build(group); lampHeadI.build(group);

  // -- guard rail (W-beam) on the sea side of the cliff road and wherever the drop is steep
  const railPos = [], railNor = [];
  const postGeo = new THREE.BoxGeometry(0.12, 0.9, 0.08); postGeo.translate(0, 0.45, 0);
  const posts = new CellInstances(postGeo, darkMetal, { shadow: false, far: 500 });
  const reflGeo = new THREE.BoxGeometry(0.1, 1.0, 0.1); reflGeo.translate(0, 0.5, 0);
  const reflPosts = new CellInstances(reflGeo, white, { shadow: false, far: 500 });
  const railRuns = [];
  for (const side of [1, -1]) {
    let run = null;
    for (let s = 0; s <= route.length; s += 2) {
      const urb = route.urban(s);
      const u = route.edge(s) + ROAD.gutter + ROAD.sidewalk(route, s, side) + 0.25;
      route.point(s, side * u, pt);
      const drop = route.surfaceY(s, side * u) - heightC(pt.x + 0, pt.z) ;
      const p2 = route.point(s, side * (u + 6), new THREE.Vector3());
      const drop2 = route.surfaceY(s, side * u) - heightC(p2.x, p2.z);
      const want = (urb < 0.5 && (side > 0 ? route.seaR(s) < 90 : false)) || (drop2 > 2.2 && urb < 0.8);
      if (want) { if (!run) { run = []; railRuns.push({ side, pts: run }); } run.push({ s, u, p: pt.clone() }); }
      else run = null;
      if (want && s % 4 === 0) { const f = route.frame(s, {}); posts.addTRS(pt.x, pt.y - 0.05, pt.z, Math.atan2(f.tx, f.tz), 1); }
      // white reflector posts along the cliff road's inland edge
      if (!want && urb < 0.5 && s % 50 === 0) { const f = route.frame(s, {}); reflPosts.addTRS(pt.x, pt.y - 0.05, pt.z, Math.atan2(f.tx, f.tz), 1); }
    }
  }
  posts.build(group); reflPosts.build(group);
  assets.rails = railRuns; // the only hard barriers along the road (see ground.js)
  const prof = [[0, 0.52], [0.05, 0.55], [0.05, 0.62], [0, 0.66], [0, 0.72], [0.05, 0.76], [0.05, 0.83], [0, 0.86]];
  for (const run of railRuns) {
    if (run.pts.length < 3) continue;
    const pos = [], idx = [];
    run.pts.forEach((q, r) => {
      const f = route.frame(q.s, {});
      for (const [o, h] of prof) { const u = run.side * (q.u - 0.08 + o); route.point(q.s, u, pt); pos.push(pt.x, q.p.y + h - 0.05, pt.z); }
      if (r > 0) for (let c = 0; c + 1 < prof.length; c++) { const a = (r - 1) * prof.length + c, b = a + 1, d = a + prof.length, e = d + 1; if (run.side > 0) idx.push(a, d, b, b, d, e); else idx.push(a, b, d, b, e, d); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  }

  // -- OSM furniture: crossings and bus stops (the signalised junctions are built by signals.js)
  const crossings = [], stops = [], stopsO = [];
  const used = [];
  const J = assets.junctions || [];
  const nearJ = (s) => J.some((j) => Math.abs(j.s - s) < 18);
  const isNear = (s, type, d) => used.some((q) => q.t === type && Math.abs(q.s - s) < d);
  for (const j of J) { crossings.push(j.zF, j.zO); stops.push(j.sF); stopsO.push(j.sO); }
  for (const f of data.furniture) {
    if (f.t === 'crossing' && !nearJ(f.s) && !isNear(f.s, 'crossing', 25)) { crossings.push(f.s); used.push({ t: 'crossing', s: f.s }); }
    if (f.t === 'bus_stop' && !isNear(f.s + (f.u > 0 ? 0 : 0.5), 'bus' + Math.sign(f.u), 80) && f.u > 0 && !nearJ(f.s) ) {
      used.push({ t: 'bus' + Math.sign(f.u), s: f.s });
      // the shelter itself is modelled by roadside.js (OASA shelter + pole); here we only keep the stop for bus scheduling
      (assets.busStops = assets.busStops || []).push(f.s);
    }
  }
  crossings.sort((a, b) => a - b); stops.sort((a, b) => a - b); stopsO.sort((a, b) => a - b);
  assets.crossings = crossings; assets.stops = stops; assets.stopsO = stopsO;

  // -- direction / name signs at real places
  const sgPole = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8); sgPole.translate(0, 1.6, 0);
  const addSign = (s, key, w, h, height = 2.4, side = 1, poles = 1) => {
    const fr = route.frame(s, {}), yaw = Math.atan2(fr.tx, fr.tz);
    const u = side * (route.edge(s) + ROAD.gutter + 1.0);
    route.point(s, u, pt);
    const g = new THREE.Group(); g.position.copy(pt); g.rotation.y = yaw; group.add(g);
    for (let i = 0; i < poles; i++) { const p = new THREE.Mesh(sgPole, metal); p.scale.y = (height + h * 0.5) / 3.2; p.position.x = poles === 1 ? 0 : (i - 0.5) * w * 0.7; p.castShadow = true; g.add(p); }
    const plate = new THREE.Mesh(uvRect(new THREE.PlaneGeometry(w, h), regions[key]), signMat); plate.position.set(0, height + h / 2, -0.06); plate.rotation.y = Math.PI; plate.castShadow = true; g.add(plate);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), metal); back.position.set(0, height + h / 2, -0.05); g.add(back);
  };
  const mk = Object.fromEntries(data.marks.map((m) => [m.id, m.s]));
  addSign(route.start + 200, 'd_start', 4.2, 2.1, 2.2, 1, 2);
  addSign(mk.astir - 90, 'd_astir', 4.2, 2.1, 2.2, 1, 2);
  addSign(mk.lake - 160, 'd_lake', 4.2, 2.1, 2.2, 1, 2);
  addSign(mk.limanakia - 200, 'n_limanakia', 2.4, 0.6);
  addSign(mk.varkiza - 250, 'n_varkiza', 2.4, 0.6);
  addSign(mk.varkiza + 350, 'd_varkiza', 4.2, 2.1, 2.2, 1, 2);
  addSign(mk.lomvarda - 220, 'n_lomvarda', 2.4, 0.6);
  // posted limits where OSM maxspeed changes (30 through Limanakia, 60 on the Ribas approach), repeated every ~900 m
  const speeds = route.speeds && route.speeds.length ? route.speeds : [{ s: 0, v: 50 }];
  speeds.forEach((q, i) => {
    const end = i + 1 < speeds.length ? speeds[i + 1].s : route.length;
    for (let s = Math.max(route.start - 60, q.s) + 25; s < end - 60; s += 900) if (regions['sl' + q.v]) addSign(s, 'sl' + q.v, 0.75, 0.75, 1.9);
  });
  // chevrons on the tighter cliff bends
  for (let s = 0; s < route.length; s += 14) {
    const k = route.curv(s);
    if (route.urban(s) < 0.5 && Math.abs(k) > 1 / 160) {
      const side = k > 0 ? -1 : 1; // outside of the bend
      const fr = route.frame(s, {}), yaw = Math.atan2(fr.tx, fr.tz);
      route.point(s, side * (route.edge(s) + ROAD.gutter + 1.6), pt);
      const g = new THREE.Group(); g.position.copy(pt); g.rotation.y = yaw; group.add(g);
      const p = new THREE.Mesh(sgPole, metal); p.scale.y = 0.4; g.add(p);
      const geo = uvRect(new THREE.PlaneGeometry(0.7, 0.7), regions.chev); if (side > 0) geo.scale(-1, 1, 1);
      const plate = new THREE.Mesh(geo, signMat); plate.position.set(0, 1.25, -0.04); plate.rotation.y = Math.PI; g.add(plate);
    }
  }
  // start / finish gantries
  const gantry = (s, key, tint) => {
    const fr = route.frame(s, {}), yaw = Math.atan2(fr.tx, fr.tz);
    const wHalf = route.edge(s) + 1.2;
    const g = new THREE.Group(); route.point(s, 0, pt); g.position.copy(pt); g.rotation.y = yaw + Math.PI; group.add(g);
    const leg = new THREE.BoxGeometry(0.5, 7.5, 0.5); leg.translate(0, 3.75, 0);
    for (const sx of [-1, 1]) { const l = new THREE.Mesh(leg, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.3 })); l.position.x = sx * wHalf; l.castShadow = true; g.add(l); }
    const banner = new THREE.Mesh(uvRect(new THREE.PlaneGeometry(wHalf * 2, wHalf * 0.5), regions[key]), signMat); banner.position.set(0, 6.4, 0); banner.rotation.y = Math.PI; banner.castShadow = true; g.add(banner);
    const banner2 = banner.clone(); banner2.rotation.y = 0; banner2.scale.x = -1; banner2.position.z = 0.05; g.add(banner2);
  };
  gantry(route.start, 'start', '#ff3d2e');
  gantry(route.finish, 'finish', '#f2f2f2');
}

function addBusStop(group, route, f, regions, signMat, assets) {
  const s = f.s, fr = route.frame(s, {}), yaw = Math.atan2(fr.tx, fr.tz);
  const u = route.edge(s) + ROAD.gutter + Math.min(2.6, ROAD.sidewalk(route, s, 1) - 0.6);
  const pt = route.point(s, u, new THREE.Vector3());
  const g = new THREE.Group(); g.position.copy(pt); g.position.y += ROAD.curbH(route, s); g.rotation.y = yaw + Math.PI; group.add(g);
  const frame = new THREE.MeshStandardMaterial({ color: '#2f3a45', metalness: 0.6, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#cfe3ee', transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 4.2), frame); roof.position.set(0.2, 2.5, 0); roof.castShadow = true; g.add(roof);
  for (const z of [-2, 2]) for (const x of [-0.5, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.5, 0.07), frame); p.position.set(x, 1.25, z); g.add(p); }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.0), glass); back.position.set(0.9, 1.3, 0); back.rotation.y = -Math.PI / 2; g.add(back);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 2.6), frame); bench.position.set(0.6, 0.48, 0); g.add(bench);
  const sign = new THREE.Mesh(uvRect(new THREE.PlaneGeometry(0.6, 0.6), regions.bus), signMat); sign.position.set(-0.5, 2.9, -2.0); sign.rotation.y = Math.PI / 2; g.add(sign);
  if (f.n && assets.makeLabel) { const lab = assets.makeLabel(f.n.toUpperCase(), 3.2, 0.42, '#0b4ea2', '#ffffff'); lab.position.set(-0.3, 2.66, 0); lab.rotation.y = -Math.PI / 2; g.add(lab); const lab2 = lab.clone(); lab2.rotation.y = Math.PI / 2; lab2.position.x = -0.32; g.add(lab2); }
}
