// Terrain meshes from the DEM/land-cover grid: a 10 m mesh along the route corridor and a 40 m mesh beyond.
import * as THREE from 'three';
import { REFLECT_LAYER } from './env.js';
import { vnoise, fbm, smoothstep, clamp } from './util.js';
import { TX, GLSL_HELPERS } from './tex.js';
import { sampleTerrainHeight } from './terrain-contact.js';
import { cutMountainRoads } from './road-cut.js';
import { RoadTerrain } from './road-terrain.js';
import { limitTerrainSlopes } from './terrain-slope.js';
import { installTerrainRefinement, TERRAIN_SUBDIVISIONS } from './terrain-refinement.js';

const C = (h) => new THREE.Color(h);
const CLASS_COL = [C('#b9a985'), C('#dcc8a0'), C('#b7ab95'), C('#8a7d57'), C('#9a937f'), C('#738440'), C('#5c6435'), C('#6d6b57'), C('#9c8b63')];
const ROCK = C('#a9a194'), ROCK2 = C('#c4b9a6'), VERGE = C('#9d8f73'), DRYGRASS = C('#b8a46c'), MAQUIS = C('#5e6336');
const LIME = C('#c2bdb2'), LIME2 = C('#8a857b'), GARDEN = C('#7d8350');

export function terrainMaterial({ farmland = false } = {}) {
  // texture splatting driven by the land-cover vertex colour + slope + height: dry cracked soil, withered grass /
  // maquis ground, beach sand (wet near the waterline) and limestone rock faces (tri-planar on steep ground)
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.customProgramCacheKey = () => farmland ? 'terrain6-farmland' : 'terrain6';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tGD: { value: TX.ground_diff }, tGN: { value: TX.ground_nor }, tSD: { value: TX.grass_diff }, tSN: { value: TX.grass_nor },
      tBD: { value: TX.sand_diff }, tBN: { value: TX.sand_nor }, tRD: { value: TX.rock_diff }, tRN: { value: TX.rock_nor },
    });
    sh.uniforms.tCD = { value: TX.concrete_diff }; sh.uniforms.tAD = { value: TX.asphalt_diff };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aU; varying float vU; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvU = aU;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tCD; uniform sampler2D tAD; varying float vU;
      uniform sampler2D tGD; uniform sampler2D tGN; uniform sampler2D tSD; uniform sampler2D tSN; uniform sampler2D tBD; uniform sampler2D tBN; uniform sampler2D tRD; uniform sampler2D tRN;
      varying vec3 vWP; varying vec3 vWN;
      ${GLSL_HELPERS}
      vec3 tN = vec3(0, 0, 1); float tRough = 0.95; vec2 tUV; float wRock = 0.0; vec2 rUV;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 p = vWP.xz;
        vec3 vc = diffuseColor.rgb;
        float steep = 1.0 - clamp(vWN.y, 0.0, 1.0);
        float sat = max(vc.r, max(vc.g, vc.b)) - min(vc.r, min(vc.g, vc.b));
        float lum = dot(vc, vec3(0.333));
        float macro = fbm2(p * 0.012);
        float mid = vn2(p * 0.09);
        // layer weights
        float wGrass = smoothstep(0.01, 0.06, vc.g - vc.b) * smoothstep(0.03, 0.09, vc.g - vc.r * 0.85) ;
        float wSand = smoothstep(2.2, 0.8, vWP.y) * smoothstep(0.3, 0.45, lum) + smoothstep(0.55, 0.7, lum) * smoothstep(0.1, 0.16, sat) * 0.8;
        wRock = smoothstep(0.32, 0.6, steep + (1.0 - smoothstep(0.04, 0.12, sat)) * 0.35 * smoothstep(0.3, 0.5, lum) + (mid - 0.5) * 0.2);
        wSand = clamp(wSand, 0.0, 1.0) * (1.0 - wRock);
        wGrass *= (1.0 - wRock) * (1.0 - wSand);
        float wGround = max(0.0, 1.0 - wRock - wSand - wGrass);
        tUV = p / 3.0;
        vec3 g = texNoTile(tGD, tUV).rgb, gn = texture2D(tGN, tUV).xyz;
        { float gm = dot(g, vec3(0.333)); g = mix(vec3(gm), g, 0.8); g = vec3(0.3) * vec3(1.04, 1.0, 0.92) + (g - 0.3) * 0.5; gn = mix(vec3(0.5, 0.5, 1.0), gn, 0.55); }
        vec2 sUV = p / 3.0; vec3 sg = texNoTile(tSD, sUV).rgb, sgn = texture2D(tSN, sUV).xyz;
        vec2 bUV = p / 3.5; vec3 b = texNoTile(tBD, bUV).rgb, bn = texture2D(tBN, bUV).xyz;
        vec3 an = abs(vWN);
        rUV = (an.x > an.z ? vWP.zy : vWP.xy) / 6.0; if (an.y > 0.75) rUV = p / 6.0;
        vec3 r = texNoTile(tRD, rUV).rgb, rn = texture2D(tRN, rUV).xyz;
        // limestone: greyer and paler than the scan, with the vertex tint for local variety
        r = mix(vec3(dot(r, vec3(0.333))), r, 0.45) * vec3(1.15, 1.1, 1.02);
        vec3 tint = vc / max(lum, 0.02);
        vec3 col = g * mix(vec3(1.0), tint, 0.55) * 1.05 * wGround + sg * mix(vec3(1.0), tint, 0.35) * 0.95 * wGrass + b * 1.15 * wSand + r * mix(vec3(1.0), tint, 0.25) * wRock;
        // town: irregular plots between the blocks - paved yards, dusty ground, a few gardens and car parks
        float wU = smoothstep(0.3, 0.9, vU) * (1.0 - wRock) * (1.0 - wSand);
        if (wU > 0.0) {
          vec2 wp = p + vec2(vn2(p * 0.05), vn2(p * 0.05 + 7.0)) * 9.0;
          vec2 cell = floor(wp / vec2(23.0, 15.0));
          float ph = h12(cell);
          vec3 conc = texture2D(tCD, p / 3.0).rgb * 1.55;
          vec3 asph = texture2D(tAD, p / 4.0).rgb * 1.25;
          vec3 garden = mix(sg * vec3(0.7, 0.95, 0.55), g, 0.35);
          vec3 uc = ph < 0.4 ? mix(conc, g, 0.3) : ph < 0.55 ? asph : ph < 0.85 ? g * vec3(1.0, 0.97, 0.92) : garden;
          uc = mix(uc, g, smoothstep(0.55, 0.8, vn2(p * 0.12)) * 0.5); // dust drifts across everything
          col = mix(col, uc, wU);
        }
        // wild Attic hillside: grey limestone showing through thin soil, dense dark phrygana / maquis clumps
        float wWild = ${farmland ? '0.0' : '(1.0 - smoothstep(0.1, 0.5, vU) * (1.0 - smoothstep(0.1, 0.25, steep))) * (1.0 - wSand * (1.0 - smoothstep(0.15, 0.3, steep))) * smoothstep(2.5, 9.0, vWP.y)'};
        if (wWild > 0.0) {
          float outc = smoothstep(0.38, 0.62, fbm2(p * 0.045) + steep * 0.45);
          vec3 lime = texNoTile(tRD, p / 5.0).rgb; lime = mix(vec3(dot(lime, vec3(0.333))), lime, 0.3) * vec3(1.25, 1.22, 1.15);
          vec3 soil = mix(g, sg, 0.5) * vec3(0.78, 0.74, 0.66);
          vec3 wild = mix(soil, lime, outc);
          float shrub = smoothstep(0.44, 0.56, vn2(p * 0.55) * 0.6 + vn2(p * 2.1) * 0.4) * (1.0 - outc * 0.6);
          wild = mix(wild, vec3(0.055, 0.068, 0.034) * (0.7 + 0.6 * vn2(p * 3.0)), shrub * 0.9);
          col = mix(col, wild, wWild);
        }
        ${farmland ? 'col = mix(vc * (.74 + .48 * dot(sg, vec3(.333))), col, smoothstep(.22,.55,steep));' : ''}
        col *= 0.82 + 0.36 * macro;
        // wet sand / rock darkening at the waterline
        col *= mix(0.55, 1.0, smoothstep(0.05, 0.6, vWP.y));
        diffuseColor.rgb = col;
        tN = (gn * wGround + sgn * wGrass + bn * wSand + rn * wRock) * 2.0 - 1.0;
        tRough = mix(0.97, 0.88, wRock) * mix(0.6, 1.0, smoothstep(0.0, 0.5, vWP.y));
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturb(-vViewPosition, normal, wRock > 0.5 ? rUV : tUV, tN, 1.1);');
  };
  return mat;
}

/**
 * Build terrain meshes. `corridorPts` is an array of [x,z,r] stamps marking the detailed area.
 * clampFn(x, z) -> max height allowed (keeps the ground under the road and pavements) or Infinity.
 */
export function buildTerrain(terrain, route, extraStamps, scene, { coastal = true, farmland = false, network = null } = {}) {
  const { GX, GZ, T, minX, minZ, H, C: CL } = terrain;
  const mat = terrainMaterial({ farmland });
  // ---------------------------------------------------------------- corridor mask (10 m vertices)
  const mask = new Uint8Array(GX * GZ);
  const stamp = (x, z, r) => {
    const i0 = Math.max(0, Math.floor((x - r - minX) / T)), i1 = Math.min(GX - 1, Math.ceil((x + r - minX) / T));
    const j0 = Math.max(0, Math.floor((z - r - minZ) / T)), j1 = Math.min(GZ - 1, Math.ceil((z + r - minZ) / T));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = minX + i * T - x, dz = minZ + j * T - z; if (dx * dx + dz * dz < r * r) mask[j * GX + i] = 1; }
  };
  for (let s = -300; s <= route.length + 300; s += 25) { const p = route.point(s, 0); stamp(p.x, p.z, Math.max(120, route.edge(s) + 80)); }
  for (const [x, z, r] of extraStamps) stamp(x, z, r);

  // ---------------------------------------------------------------- road clamp (per 10 m vertex: nearest route sample)
  const Hc = H.slice();
  const best = new Float32Array(GX * GZ).fill(1e9), bestS = new Float32Array(GX * GZ), bestU = new Float32Array(GX * GZ);
  const R = 46;
  for (let k = 0; k < route.N; k++) {
    const s = k * route.step;
    const x = route.X[k], z = route.Z[k], rx = -route.TZ[k], rz = route.TX[k];
    const i0 = Math.max(0, Math.floor((x - R - minX) / T)), i1 = Math.min(GX - 1, Math.ceil((x + R - minX) / T));
    const j0 = Math.max(0, Math.floor((z - R - minZ) / T)), j1 = Math.min(GZ - 1, Math.ceil((z + R - minZ) / T));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = minX + i * T - x, dz = minZ + j * T - z, d = dx * dx + dz * dz, id = j * GX + i;
      if (d < best[id]) { best[id] = d; bestS[id] = s + dx * route.TX[k] + dz * route.TZ[k]; bestU[id] = dx * rx + dz * rz; }
    }
  }
  const verge = new Float32Array(GX * GZ);
  for (let id = 0; id < GX * GZ; id++) {
    if (best[id] > R * R) continue;
    const s = bestS[id], u = bestU[id];
    const edge = route.edge(s) + (route.urban(s) > 0.5 ? 4.5 : 3.0);
    const au = Math.abs(u);
    const sy = route.surfaceY(s, clamp(u, -edge, edge)) - 0.3;
    if (au < edge + 12) { Hc[id] = Math.min(Hc[id], sy + Math.max(0, au - edge - 4) * 0.25); verge[id] = 1 - smoothstep(edge, edge + 14, au); }
    if (au < edge + 2 && Hc[id] < sy - 3) Hc[id] = Math.max(Hc[id], sy - 3); // never leave a hole right under the shoulder
  }
  // the cliff road (Limanakia, Varkiza - Lomvarda) climbs over bare limestone; DEM cells are too coarse for the cliffs and coves,
  // so add ridged rock relief between the road and the sea (and a few rocks breaking the surface in the coves)
  const rug = new Float32Array(GX * GZ), H0 = Hc.slice();
  if (coastal) {
    let s0 = 0; for (let s = 0; s < route.length; s += 20) if (route.urban(s) < 0.6) { s0 = s; break; }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let s = s0 - 200; s <= route.length; s += 20) { const p = route.point(s, 0); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const i0 = Math.max(0, Math.floor((x0 - 500 - minX) / T)), i1 = Math.min(GX - 1, Math.ceil((x1 + 500 - minX) / T));
    const j0 = Math.max(0, Math.floor((z0 - 500 - minZ) / T)), j1 = Math.min(GZ - 1, Math.ceil((z1 + 500 - minZ) / T));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const id = j * GX + i, x = minX + i * T, z = minZ + j * T;
      const q = route.project(x, z, null);
      if (q.s < s0 - 150 || q.s > route.length || Math.abs(q.u) > 480) continue;
      const au = Math.abs(q.u), edge = route.edge(q.s) + 3;
      if (au < edge + 4) continue;
      const h = Hc[id]; if (h < -4) continue;
      const k = smoothstep(edge + 14, edge + 48, au) * (1 - smoothstep(380, 480, au)) * (1 - smoothstep(0.3, 0.7, route.urban(q.s)));
      if (k <= 0) continue;
      const f = fbm(x * 0.022, z * 0.022, 4), ridge = Math.pow(1 - Math.abs(2 * f - 1), 3);
      const bumps = fbm(x * 0.09 + 31, z * 0.09, 3);
      let nh = h + (ridge * 11 + bumps * 3.5 - 3.5) * k * k * (h < 3 ? 0.6 : 1);
      // keep the view over the sea open: on the seaward side the rock never rises above the road
      const seaward = q.u > 0 ? route.seaR(q.s) < 400 : route.seaL(q.s) < 400;
      if (seaward) nh = Math.min(nh, Math.max(h, route.y(q.s) - 2.5 - (au - edge) * 0.04));
      if (h > -0.5) Hc[id] = nh;
      else if (bumps > 0.62 && h > -3.5) Hc[id] = 0.4 + (bumps - 0.62) * 9; // rocks in the coves
      rug[id] = k * (0.55 + 0.45 * bumps);
    }
  }
  {
    const add = new Float32Array(GX * GZ); for (let i = 0; i < add.length; i++) if (rug[i] > 0) add[i] = Hc[i] - H0[i];
    for (let j = 1; j < GZ - 1; j++) for (let i = 1; i < GX - 1; i++) {
      const id = j * GX + i; if (rug[id] <= 0 || H0[id] < -0.5) continue;
      const b = (add[id] * 4 + add[id - 1] + add[id + 1] + add[id - GX] + add[id + GX]) / 8;
      Hc[id] = H0[id] + b;
    }
  }
  if (location.search.includes('debug')) { let n = 0, mx = 0; for (let i = 0; i < rug.length; i++) if (rug[i] > 0) { n++; mx = Math.max(mx, rug[i]); } console.log('rugged cells', n, mx); }
  // Surrounding roads use the actual DEM, without decorative cliff relief across their carriageways.
  if (network) {
    const source = Hc.slice();
    for (let i = 0; i < source.length; i++) if (rug[i] > 0) source[i] = H0[i];
    network.prepareTerrain(Hc, stamp, source);
  }
  route.localLayout?.carveTerrain(terrain, Hc, stamp);
  if (!coastal && !farmland) cutMountainRoads(terrain, route, Hc, network);
  terrain.Hc = Hc;

  const cropGreen = C('#78864c'), cropDry = C('#b6ae72'), cropVerge = C('#929c5a');
  const colorAt = (i, j, h, n, out) => {
    const id = j * GX + i, x = minX + i * T, z = minZ + j * T;
    const cls = CL[id];
    out.copy(CLASS_COL[cls] || CLASS_COL[8]);
    const nz = vnoise(x * 0.013, z * 0.013), nz2 = vnoise(x * 0.07 + 9, z * 0.07);
    if (farmland) {
      // Megara is cultivated, gently rolling coastal plain. The circuit scenery
      // adds satellite-traced gravel and paved polygons over these grass verges.
      out.copy(cropGreen).lerp(cropDry, smoothstep(.25, .75, nz));
      out.lerp(cropVerge, verge[id] * .3).multiplyScalar(.9 + .2 * nz2);
      return out;
    }
    if (cls === 8 || cls === 3) out.lerp(nz > 0.5 ? DRYGRASS : MAQUIS, cls === 3 ? 0.45 * nz2 : 0.25 * nz2);
    if (cls === 2) out.lerp(nz > 0.5 ? ROCK2 : ROCK, 0.5);
    const steep = 1 - n.y;
    if (steep > 0.25 && cls !== 1) out.lerp(nz2 > 0.5 ? ROCK2 : ROCK, smoothstep(0.25, 0.6, steep));
    if (cls === 4 && h > 0.5) out.lerp(GARDEN, 0.35 + 0.35 * nz2); // gardens between houses read greener than bare concrete
    if (rug[id] > 0) { out.lerp(nz2 > 0.45 ? LIME : LIME2, rug[id] * (0.55 + 0.45 * smoothstep(0.2, 0.6, steep))); if (nz > 0.62) out.lerp(MAQUIS, 0.35 * rug[id]); }
    if (verge[id] > 0) out.lerp(VERGE, verge[id] * 0.7);
    if (h > 60) out.lerp(MAQUIS, smoothstep(60, 180, h) * 0.35 * (1 - steep));
    return out;
  };

  // The source DEM is 10 m: road-edge constraints cannot survive interpolation
  // of those large triangles. Refine only the road/shoulder corridor; the
  // tighter Penteli hairpins use 1.25 m, Riviera 2 m, and Megara 2.5 m.
  const conform = new RoadTerrain(route, network, { clearance: coastal ? .095 : .075 }), refined = new Set();
  for (const seg of conform.segments) {
    const R = seg.width + 32 + T;
    const i0 = Math.max(0, Math.floor((Math.min(seg.ax, seg.bx) - R - minX) / T)), i1 = Math.min(GX - 2, Math.ceil((Math.max(seg.ax, seg.bx) + R - minX) / T));
    const j0 = Math.max(0, Math.floor((Math.min(seg.az, seg.bz) - R - minZ) / T)), j1 = Math.min(GZ - 2, Math.ceil((Math.max(seg.az, seg.bz) + R - minZ) / T));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = minX + (i + .5) * T, z = minZ + (j + .5) * T;
      const t = clamp(((x - seg.ax) * seg.dx + (z - seg.az) * seg.dz) / seg.L2, 0, 1);
      if (Math.hypot(x - seg.ax - seg.dx * t, z - seg.az - seg.dz * t) <= seg.width + 32 + T * .71) {
        refined.add(j * GX + i); mask[j * GX + i] = mask[j * GX + i + 1] = mask[(j + 1) * GX + i] = mask[(j + 1) * GX + i + 1] = 1;
      }
    }
  }
  // A coarse 40 m triangle must never overlie a new cut/fill corridor. Extend
  // the fine mask to whole coarse cells; merely checking its four corners can
  // leave a tall underlay poking through a perfectly level fine shoulder.
  for(const id of refined){const i=Math.floor((id%GX)/4)*4,j=Math.floor(Math.floor(id/GX)/4)*4;
    for(let b=j;b<=Math.min(GZ-1,j+4);b++)for(let a=i;a<=Math.min(GX-1,i+4);a++)mask[b*GX+a]=1;
  }
  const build = (step, include, lower) => {
    const nx = Math.floor((GX - 1) / step) + 1, nz = Math.floor((GZ - 1) / step) + 1;
    const vid = new Int32Array(nx * nz).fill(-1);
    const pos = [], col = [], idx = [], urb = [];
    const n = new THREE.Vector3(), c = new THREE.Color();
    const hAt = (i, j) => Hc[j * GX + i];
    const vert = (a, b) => {
      const k = b * nx + a; if (vid[k] >= 0) return vid[k];
      const i = Math.min(GX - 1, a * step), j = Math.min(GZ - 1, b * step);
      let h = hAt(i, j) - (lower ? lower(i, j) : 0);
      const i0 = Math.max(0, i - step), i1 = Math.min(GX - 1, i + step), j0 = Math.max(0, j - step), j1 = Math.min(GZ - 1, j + step);
      n.set((hAt(i0, j) - hAt(i1, j)) / ((i1 - i0) * T), 1, (hAt(i, j0) - hAt(i, j1)) / ((j1 - j0) * T)).normalize();
      colorAt(i, j, h, n, c);
      pos.push(minX + i * T, h, minZ + j * T); col.push(c.r, c.g, c.b); urb.push(CL[j * GX + i] === 4 && h > 0.8 ? 1 : 0);
      vid[k] = pos.length / 3 - 1; return vid[k];
    };
    for (let b = 0; b + 1 < nz; b++) for (let a = 0; a + 1 < nx; a++) {
      const i = a * step, j = b * step, i2 = Math.min(GX - 1, i + step), j2 = Math.min(GZ - 1, j + step);
      if (!include(i, j, i2, j2)) continue;
      const hs = [hAt(i, j), hAt(i2, j), hAt(i, j2), hAt(i2, j2)];
      if (Math.max(...hs) < -1.2) continue; // the sea covers it
      const v00 = vert(a, b), v10 = vert(a + 1, b), v01 = vert(a, b + 1), v11 = vert(a + 1, b + 1);
      // split along the shorter diagonal in height for smoother shading
      if (Math.abs(hs[0] - hs[3]) < Math.abs(hs[1] - hs[2])) idx.push(v00, v01, v11, v00, v11, v10);
      else idx.push(v00, v01, v10, v10, v01, v11);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(urb, 1));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const inFine = (i, j, i2, j2) => mask[j * GX + i] && mask[j * GX + i2] && mask[j2 * GX + i] && mask[j2 * GX + i2];
  const fineGeo = build(1, (i,j,i2,j2) => inFine(i,j,i2,j2) && !refined.has(j * GX + i));
  // coarse outside: drop vertices that are deep inside the fine area so they hide under it
  const C4 = 4;
  const coarseGeo = build(C4, (i, j, i2, j2) => !(inFine(i, j, i, j) && inFine(i2, j2, i2, j2) && inFine(i, j2, i, j2) && inFine(i2, j, i2, j)),
    (i, j) => { let all = true; for (let dj = -C4; dj <= C4 && all; dj += C4) for (let di = -C4; di <= C4 && all; di += C4) { const a = Math.min(GX - 1, Math.max(0, i + di)), b = Math.min(GZ - 1, Math.max(0, j + dj)); if (!mask[b * GX + a]) all = false; } return all ? 3 : 0; });
  // split the fine mesh into tiles for culling
  const group = new THREE.Group();
  const tiles = splitGeometry(fineGeo, 600);
  for (const g of tiles) { const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.layers.enable(REFLECT_LAYER); group.add(m); }
  // The coarse mesh underlies the fine area too: push it back in depth so the fine tiles always win, even where the
  // depth buffer can't resolve the few metres between them (kilometres away, cockpit near plane).
  const coarseMat = mat.clone(); coarseMat.onBeforeCompile = mat.onBeforeCompile; coarseMat.customProgramCacheKey = mat.customProgramCacheKey;
  Object.assign(coarseMat, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
  for (const g of splitGeometry(coarseGeo, 1500)) { const m = new THREE.Mesh(g, coarseMat); m.receiveShadow = true; m.userData.coarseTerrain = true; m.layers.enable(REFLECT_LAYER); group.add(m); }
  // Use the uncut DEM for feathering; earlier cuts are only an underlay.
  // This raises downhill fills as well as lowering uphill cuts.
  const heights = new Map(), fixed = new Set(), n = farmland ? TERRAIN_SUBDIVISIONS : coastal ? 5 : 8, stride = (GX - 1) * n + 1;
  const height = (ix, iz) => {
    const key = iz * stride + ix; if (heights.has(key)) return heights.get(key);
    const x = minX + ix * T / n, z = minZ + iz * T / n;
    const y = conform.height(x, z, sampleTerrainHeight(terrain, H, x, z));
    heights.set(key, y); if(conform.fixed)fixed.add(key); return y;
  };
  // Bound the actual triangle slopes around all drivable strips. Side roads
  // subsequently sample this same field rather than restoring an older DEM.
  for(const id of refined){const i=id%GX,j=Math.floor(id/GX);for(let b=0;b<=n;b++)for(let a=0;a<=n;a++)height(i*n+a,j*n+b);}
  limitTerrainSlopes(heights,fixed,stride,T/n);
  const pos = [], col = [], nor = [], urb = [], indices = [], vertices = new Map(), c = new THREE.Color(), normal = new THREE.Vector3();
  const vertex = (ix, iz) => {
    const key = iz * stride + ix; if (vertices.has(key)) return vertices.get(key);
    const y = height(ix, iz), i = clamp(Math.round(ix / n), 0, GX - 1), j = clamp(Math.round(iz / n), 0, GZ - 1);
    normal.set((height(Math.max(0,ix-1),iz)-height(Math.min((GX-1)*n,ix+1),iz))/(2*T/n),1,
      (height(ix,Math.max(0,iz-1))-height(ix,Math.min((GZ-1)*n,iz+1)))/(2*T/n)).normalize();
    colorAt(i,j,y,normal,c);
    const id = pos.length / 3; vertices.set(key,id);
    pos.push(minX + ix * T / n,y,minZ + iz * T / n); col.push(c.r,c.g,c.b); nor.push(normal.x,normal.y,normal.z); urb.push(CL[j*GX+i]===4?1:0); return id;
  };
  for (const id of refined) {
    const i = id % GX, j = Math.floor(id / GX);
    for (let b=0;b<n;b++) for(let a=0;a<n;a++) {
      const x=i*n+a,z=j*n+b,v00=vertex(x,z),v10=vertex(x+1,z),v01=vertex(x,z+1),v11=vertex(x+1,z+1);
      if (Math.abs(pos[v00*3+1]-pos[v11*3+1])<Math.abs(pos[v10*3+1]-pos[v01*3+1])) indices.push(v00,v01,v11,v00,v11,v10);
      else indices.push(v00,v01,v10,v10,v01,v11);
    }
  }
  const refinedGeo = new THREE.BufferGeometry();
  refinedGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); refinedGeo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  refinedGeo.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3)); refinedGeo.setAttribute('aU',new THREE.Float32BufferAttribute(urb,1));refinedGeo.setIndex(indices);
  for (const g of splitGeometry(refinedGeo,600)) { const m=new THREE.Mesh(g,mat); m.userData.terrainRefinement=n; m.receiveShadow=true;m.layers.enable(REFLECT_LAYER);group.add(m); }
  fineGeo.dispose();coarseGeo.dispose();refinedGeo.dispose();
  installTerrainRefinement(terrain,group);
  scene.add(group);
  return { group, material: mat, heightC: (x, z) => sampleH(terrain, Hc, x, z) };
}

export const sampleH = (terrain, heights, x, z) => terrain.refinedHeight?.(x,z) ?? sampleTerrainHeight(terrain, heights, x, z);

function splitGeometry(geo, tile) {
  const pos = geo.attributes.position, col = geo.attributes.color, nor = geo.attributes.normal, ua = geo.attributes.aU, idx = geo.index.array;
  const buckets = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const k = Math.floor(pos.getX(a) / tile) * 1000 + Math.floor(pos.getZ(a) / tile);
    let b = buckets.get(k); if (!b) { b = { map: new Map(), p: [], c: [], n: [], u: [], i: [] }; buckets.set(k, b); }
    for (let q = 0; q < 3; q++) {
      const v = idx[t + q]; let nv = b.map.get(v);
      if (nv === undefined) { nv = b.p.length / 3; b.map.set(v, nv); b.p.push(pos.getX(v), pos.getY(v), pos.getZ(v)); b.c.push(col.getX(v), col.getY(v), col.getZ(v)); b.n.push(nor.getX(v), nor.getY(v), nor.getZ(v)); b.u.push(ua ? ua.getX(v) : 0); }
      b.i.push(nv);
    }
  }
  const out = [];
  for (const b of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(b.u, 1));
    g.setIndex(b.i); g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}
