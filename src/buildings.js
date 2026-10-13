// OSM building footprints extruded into Athenian Riviera architecture: concrete "polykatoikia"
// apartment blocks with continuous balconies and awnings, white villas, Astir's hotels, shopfronts
// with the real shop names (transliterated), rooftop solar water heaters, chapels with domes.
import * as THREE from 'three';
import { REFLECT_LAYER } from './env.js';
import { RNG, CellInstances, M, canvasTex, pointInPoly, polyArea, clamp } from './util.js';
import { TX, GLSL_HELPERS } from './tex.js';

const KIND = { apt: 0, villa: 1, hotel: 2, shop: 3, church: 4, roof: 5, shed: 6 };

export function facadeMaterial() {
  // Facades are procedural but physically lit: photographed plaster (albedo/normal/roughness) tinted per building,
  // glazing with interior mapping (rooms with floor, ceiling and walls seen in parallax behind the glass) and
  // Fresnel reflections of the sky, aluminium roller shutters, window frames, shopfronts, villa shutters.
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.customProgramCacheKey = () => 'facade6';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tPD: { value: TX.plaster_diff }, tPN: { value: TX.plaster_nor }, tPR: { value: TX.plaster_arm }, tCD: { value: TX.concrete_diff }, tCN: { value: TX.concrete_nor } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aB; attribute vec2 aF; varying vec4 vB; varying vec2 vF; varying vec3 vWN; varying vec3 vWP2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvB = aB; vF = aF;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal); vWP2 = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tPD; uniform sampler2D tPN; uniform sampler2D tPR; uniform sampler2D tCD; uniform sampler2D tCN;
      varying vec4 vB; varying vec2 vF; varying vec3 vWN; varying vec3 vWP2;
      ${GLSL_HELPERS}
      float box(vec2 p, vec2 a, vec2 b){ vec2 fw = fwidth(p) * 0.8; vec2 s = smoothstep(a - fw, a + fw, p) * (1.0 - smoothstep(b - fw, b + fw, p)); return s.x * s.y; }
      float gRough = 0.85; float gMetal = 0.0; vec3 gEmit = vec3(0.0); vec3 gN = vec3(0, 0, 1); float gNK = 0.6; vec2 gUV; float gSpec = 1.0;
      vec3 wallCol(float k, float seed){
        float r = fract(seed * 7.13);
        if (k < 0.5) return r < 0.34 ? vec3(0.86, 0.84, 0.79) : r < 0.55 ? vec3(0.84, 0.76, 0.62) : r < 0.7 ? vec3(0.75, 0.73, 0.69) : r < 0.84 ? vec3(0.82, 0.68, 0.52) : r < 0.93 ? vec3(0.9, 0.88, 0.84) : vec3(0.66, 0.68, 0.66);
        if (k < 1.5) { float q = fract(seed * 3.7); return q < 0.6 ? vec3(0.93, 0.92, 0.88) : q < 0.85 ? vec3(0.91, 0.84, 0.7) : vec3(0.86, 0.64, 0.5); }
        if (k < 2.5) return vec3(0.92, 0.91, 0.88);
        if (k < 3.5) return vec3(0.8, 0.8, 0.78);
        if (k < 4.5) return vec3(0.96, 0.95, 0.92);
        return vec3(0.6, 0.58, 0.55);
      }
      // a room behind the glass, ray-cast in facade space (x along the wall, y up, z into the building)
      vec3 interior(vec2 o, vec3 rd, vec2 size, float seed, float lit){
        float D = 3.2 + 2.5 * h12(vec2(seed, 1.7));
        rd.z = max(rd.z, 0.02);
        vec3 ro = vec3(o, 0.0);
        vec3 t0 = (vec3(0.0) - ro) / rd, t1 = (vec3(size, D) - ro) / rd;
        vec3 tm = max(t0, t1);
        float t = min(min(tm.x, tm.y), tm.z);
        vec3 hp = ro + rd * t;
        float hv = h12(vec2(seed, 9.1));
        vec3 wall = mix(vec3(0.78, 0.74, 0.68), vec3(0.62, 0.66, 0.7), step(0.7, hv));
        vec3 c;
        if (t == tm.z) { c = wall; c = mix(c, vec3(0.25, 0.2, 0.16), box(hp.xy, vec2(size.x * 0.3, 0.0), vec2(size.x * 0.7, 2.1)) * step(0.6, h12(vec2(seed, 3.3)))); } // a door in the back wall
        else if (t == tm.y) c = rd.y > 0.0 ? vec3(0.9) : mix(vec3(0.42, 0.3, 0.2), vec3(0.62, 0.6, 0.56), step(0.5, hv)) * (0.85 + 0.15 * step(0.5, fract(hp.x * 2.0 + floor(hp.z * 2.0) * 0.5)));
        else c = wall * 0.9;
        // furniture silhouettes near the back
        float furn = box(hp.xy, vec2(0.2, 0.0), vec2(size.x * 0.6, 0.9)) * step(D - 0.05, hp.z) * step(0.4, h12(vec2(seed, 5.5)));
        c = mix(c, vec3(0.2, 0.17, 0.15), furn);
        // light falls off away from the window; some rooms have a warm lamp on
        float E = 0.16 * exp(-hp.z * 0.32) + 0.02;
        E += lit * 0.25 * exp(-length(hp - vec3(size.x * 0.5, size.y - 0.3, D * 0.6)) * 0.6);
        return c * E * vec3(1.0, 0.97, 0.92);
      }
      float fresnel(float c){ return 0.04 + 0.96 * pow(1.0 - c, 5.0); }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float lv = vB.x, k = vB.y, seed = vB.z, flag = vB.w;
        float along = vF.x, y = vF.y;
        vec3 Nw = normalize(vWN);
        vec3 Tw = normalize(vec3(-Nw.z, 0.0, Nw.x) + 1e-5);
        vec3 V = normalize(vWP2 - cameraPosition);
        vec3 rd = vec3(dot(V, Tw), V.y, -dot(V, Nw));
        float NdV = clamp(-dot(V, Nw), 0.0, 1.0);
        vec3 wall = wallCol(k, seed);
        gUV = vec2(along, y) / 2.2 + seed * 17.0;
        vec3 pd = texture2D(tPD, gUV).rgb; vec3 pa = texture2D(tPR, gUV).rgb; gN = texture2D(tPN, gUV).xyz * 2.0 - 1.0;
        float grime = fbm2(vec2(along * 0.12, y * 0.25) + seed * 10.0);
        wall *= (pd / 0.62) * (0.88 + 0.16 * grime);
        wall *= mix(0.72, 1.0, smoothstep(0.0, 1.4, y)); // splash grime at the base
        // rain streaks
        wall *= 1.0 - 0.08 * smoothstep(0.6, 0.9, vn2(vec2(along * 1.3, y * 0.08 + seed)));
        vec3 col = wall; gRough = clamp(pa.g + 0.05, 0.6, 1.0);
        if (flag > 0.5 && flag < 1.5) {
          // flat roof: weathered concrete / white-painted waterproofing
          vec2 ru = vWP2.xz / 3.0;
          vec3 cd = texture2D(tCD, ru).rgb;
          col = mix(cd * vec3(1.25, 1.2, 1.15), vec3(0.78, 0.78, 0.76) * (0.8 + 0.4 * cd.r), step(0.55, fract(seed * 5.1))) * (0.8 + 0.3 * fbm2(vWP2.xz * 0.2));
          gN = texture2D(tCN, ru).xyz * 2.0 - 1.0; gUV = ru;
          gRough = 0.93;
        } else if (k < 3.5) {
          float FH = 3.1;
          float fl = floor(y / FH), fy = y - fl * FH;
          float top = lv * FH;
          float bayW = k > 0.5 && k < 1.5 ? 3.4 : 2.7 + fract(seed * 13.1) * 1.3;
          float bay = floor(along / bayW); float bx = fract(along / bayW);
          float cs = h12(vec2(bay, fl) + seed * 31.0);
          bool ground = fl < 0.5;
          bool balc = flag > 1.5;
          vec2 cellO = vec2(bx * bayW, fy);
          if (y > top - 0.05) {
            col = wall * 0.97; // parapet
            if (y > top + 0.75) col = vec3(0.86, 0.85, 0.82) * (pd / 0.62);
          } else if (ground) {
            bool shop = k > 2.5 || (k < 0.5 && fract(seed * 5.3) > 0.4) || k > 1.5;
            if (shop) {
              // glazed shopfront with an aluminium frame and a dark sign band
              float g = box(vec2(bx, fy), vec2(0.05, 0.12), vec2(0.95, 2.55));
              float fr = box(vec2(bx, fy), vec2(0.035, 0.08), vec2(0.965, 2.6)) - g;
              float lit = step(0.35, h12(vec2(bay, 4.0) + seed));
              vec3 inside = interior(vec2(bx * bayW, fy - 0.12), rd, vec2(bayW, 3.0), cs + 3.0, lit) * (1.6 + lit * 1.5);
              float mul = box(vec2(fract(bx * 2.0), fy), vec2(0.47, 0.0), vec2(0.53, 2.6)) * g + box(vec2(bx, fy), vec2(0.0, 2.05), vec2(1.0, 2.1)) * g;
              fr = clamp(fr + mul, 0.0, 1.0); g *= 1.0 - mul;
              col = mix(wall * 0.55, vec3(0.03), g);
              col = mix(col, vec3(0.2, 0.2, 0.21), fr);
              if (g > 0.5) { gRough = 0.05; gMetal = 0.0; gEmit = inside * (1.0 - fresnel(NdV)); gNK = 0.0; gSpec = 0.28; }
              if (fr > 0.5) { gRough = 0.35; gMetal = 0.8; gNK = 0.0; }
              float band = box(vec2(bx, fy), vec2(-0.1, 2.62), vec2(1.1, 3.08));
              col = mix(col, vec3(0.09, 0.09, 0.1), band * 0.9);
            } else {
              float gt = h12(vec2(bay, 7.7) + seed * 3.0);
              if (gt < 0.4) {
                // pilotis: open, deeply shadowed parking under the block, columns at the bay lines
                float pil = 1.0 - box(vec2(bx, fy), vec2(0.07, -1.0), vec2(0.93, 2.75));
                vec3 dark = wall * 0.12 * (0.7 + 0.3 * smoothstep(0.0, 2.7, fy));
                float car = box(vec2(bx, fy), vec2(0.2, 0.1), vec2(0.8, 1.35)) * step(0.5, h12(vec2(bay, 2.2) + seed));
                dark = mix(dark, vec3(0.04, 0.045, 0.05) * (0.6 + 0.8 * h12(vec2(bay, 9.9))), car);
                col = mix(dark, wall * 0.95, pil);
                if (pil < 0.5) gNK = 0.0;
              } else if (gt < 0.72) {
                // closed shop: ribbed aluminium roller shutter, sometimes with graffiti tags
                float sh = box(vec2(bx, fy), vec2(0.06, 0.0), vec2(0.94, 2.6));
                float rib = 0.5 + 0.5 * sin(fy * 6.2831 / 0.08);
                vec3 shc = mix(vec3(0.55, 0.56, 0.57), vec3(0.38, 0.4, 0.42), step(0.5, h12(vec2(bay, 1.1)))) * (0.85 + 0.15 * rib);
                float tag = step(0.7, h12(vec2(bay, 5.5))) * smoothstep(0.55, 0.75, vn2(vec2(along * 3.0, fy * 4.0))) * box(vec2(bx, fy), vec2(0.15, 0.3), vec2(0.85, 1.6));
                shc = mix(shc, vec3(0.1, 0.12, 0.3), tag * 0.8);
                col = mix(col, shc, sh);
                if (sh > 0.5) { gRough = 0.45; gMetal = 0.7; gNK = 0.0; }
                float band = box(vec2(bx, fy), vec2(-0.1, 2.62), vec2(1.1, 3.05));
                col = mix(col, vec3(0.12, 0.12, 0.13), band * 0.9);
              } else {
                // entrance lobby: glazed door in a marble surround
                float sur = box(vec2(bx, fy), vec2(0.22, 0.0), vec2(0.78, 2.6));
                col = mix(col, vec3(0.86, 0.84, 0.8), sur);
                float door = box(vec2(bx, fy), vec2(0.3, 0.0), vec2(0.7, 2.4));
                col = mix(col, vec3(0.0), door);
                if (door > 0.5) { gRough = 0.06; gEmit = interior(cellO, rd, vec2(bayW, 3.0), cs, 1.0) * 1.2 * (1.0 - fresnel(NdV)); gNK = 0.0; gSpec = 0.6; }
              }
            }
          } else if (k < 0.5 || k > 1.5) {
            // apartment floor: balcony doors (behind real balconies) or windows, aluminium frames, roller shutters
            float second = step(0.5, bx);
            vec2 a0 = balc ? (second > 0.5 ? vec2(0.56, 0.9) : vec2(0.1, 0.04)) : vec2(0.2, 0.85);
            vec2 a1 = balc ? (second > 0.5 ? vec2(0.9, 2.35) : vec2(0.46, 2.45)) : vec2(0.8, 2.35);
            cs = h12(vec2(bay * 2.0 + second, fl) + seed * 31.0);
            float glazing = box(vec2(bx, fy), a0, a1);
            float frame = box(vec2(bx, fy), a0 - vec2(0.03, 0.05), a1 + vec2(0.03, 0.05)) - glazing;
            float mull = box(vec2(bx, fy), vec2(0.488, a0.y), vec2(0.512, a1.y)) * glazing * (balc ? 0.0 : 1.0);
            float shutK = cs < 0.22 ? 0.0 : cs < 0.42 ? 0.4 : cs < 0.62 ? 0.75 : 1.0;          // how far the roller shutter is down
            float shutY = a1.y - (a1.y - a0.y) * shutK;
            float shut = glazing * step(shutY, fy);
            vec3 shutCol = fract(cs * 17.0) > 0.55 ? vec3(0.8, 0.78, 0.72) : fract(cs * 17.0) > 0.25 ? vec3(0.62, 0.6, 0.56) : vec3(0.42, 0.33, 0.24);
            float slat = 0.5 + 0.5 * sin(fy * 6.2831 / 0.045);
            float lit = step(0.8, h12(vec2(bay, fl * 7.0) + seed));
            vec3 inside = interior(vec2(bx * bayW, fy - a0.y), rd, vec2(bayW, FH), cs, lit);
            // curtains / sheers just behind the glass on some windows
            float cur = step(0.55, fract(cs * 29.0)) * (0.55 + 0.25 * sin(bx * 60.0));
            inside = mix(inside, vec3(0.85, 0.82, 0.76) * 0.09, cur * 0.75);
            float boxS = step(0.01, shutK) * box(vec2(bx, fy), vec2(a0.x - 0.03, a1.y + 0.02), vec2(a1.x + 0.03, a1.y + 0.2)); // shutter box
            col = mix(col, wall * 0.9, boxS);
            float frameMetal = fract(seed * 23.0) > 0.5 ? 1.0 : 0.0;
            vec3 frameCol = frameMetal > 0.5 ? vec3(0.86, 0.86, 0.84) : vec3(0.3, 0.24, 0.18);
            col = mix(col, frameCol, frame + mull);
            if (frame + mull > 0.5) { gRough = 0.4; gNK = 0.0; }
            if (glazing > 0.5 && mull < 0.5) {
              if (shut > 0.5) { col = shutCol * (0.82 + 0.18 * slat); gRough = 0.45; gMetal = 0.6; gNK = 0.0; }
              else { col = vec3(0.0); gRough = 0.06; gMetal = 0.0; gEmit = inside * (1.0 - fresnel(NdV)); gNK = 0.0; gSpec = 0.5; }
            }
            // window sill
            if (!balc) { float sill = box(vec2(bx, fy), vec2(a0.x - 0.05, a0.y - 0.08), vec2(a1.x + 0.05, a0.y - 0.02)); col = mix(col, vec3(0.88, 0.87, 0.83), sill); }
            // AC unit on the wall beside some windows
            float ac = step(0.86, h12(vec2(bay, fl * 3.1) + seed)) * box(vec2(bx, fy), vec2(0.02, 0.15), vec2(0.13, 0.7)) * (1.0 - glazing);
            col = mix(col, vec3(0.86, 0.86, 0.84), ac);
            // soffit shading right under the slab above (ambient)
            if (balc) col *= 1.0 - smoothstep(2.5, 3.05, fy) * 0.35;
          } else {
            // villa: rendered stucco, timber shutters (open or closed)
            float win = box(vec2(bx, fy), vec2(0.32, 0.8), vec2(0.68, 2.3)) * step(0.22, cs);
            float sh2 = fract(cs * 11.0);
            vec3 shutters = sh2 < 0.35 ? vec3(0.1, 0.27, 0.5) : sh2 < 0.6 ? vec3(0.18, 0.33, 0.22) : sh2 < 0.8 ? vec3(0.4, 0.28, 0.18) : vec3(0.82, 0.82, 0.78);
            float open = step(0.45, fract(cs * 5.0));
            float side = box(vec2(bx, fy), vec2(0.15, 0.8), vec2(0.31, 2.3)) + box(vec2(bx, fy), vec2(0.69, 0.8), vec2(0.85, 2.3));
            float louv = 0.8 + 0.2 * step(0.5, fract(fy * 14.0));
            vec3 inside = interior(vec2((bx - 0.32) * bayW, fy - 0.8), rd, vec2(0.36 * bayW, 2.6), cs, 0.0);
            if (win > 0.5) {
              if (open > 0.5) { col = vec3(0.0); gRough = 0.06; gEmit = inside * (1.0 - fresnel(NdV)); gNK = 0.0; gSpec = 0.5; }
              else { col = shutters * louv; gRough = 0.6; gNK = 0.0; }
            }
            col = mix(col, shutters * louv, side * open * step(0.22, cs));
            float sill = box(vec2(bx, fy), vec2(0.3, 0.72), vec2(0.7, 0.8)) * step(0.22, cs);
            col = mix(col, vec3(0.9, 0.89, 0.85), sill);
          }
        } else if (k > 3.5 && k < 4.5) {
          // chapel: whitewashed, arched blue-framed windows
          float bx = fract(along / 3.0);
          float arch = box(vec2(bx, y), vec2(0.4, 1.4), vec2(0.6, 2.8));
          col = mix(col, vec3(0.08, 0.18, 0.42), arch);
        } else if (k > 4.5) {
          col = vec3(0.55, 0.55, 0.53) * (pd / 0.62);
        }
        diffuseColor.rgb = col;
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (gNK > 0.0) normal = perturb(-vViewPosition, normal, gUV, gN, gNK);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= gSpec;');
  };
  return mat;
}

/** balconies, railings, awnings and roof parapets as real geometry (they cast the strong horizontal shadows of Athens) */
function detailMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => 'bdetail6';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tPD: { value: TX.plaster_diff }, tPN: { value: TX.plaster_nor } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aD; varying vec3 vD; varying vec2 vDU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvD = aD; vDU = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tPD; uniform sampler2D tPN; varying vec3 vD; varying vec2 vDU;
      ${GLSL_HELPERS}
      float dRough = 0.8, dMetal = 0.0; vec3 dN = vec3(0, 0, 1); float dNK = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float type = vD.x, seed = vD.y, sub = vD.z;
        vec3 pd = texture2D(tPD, vDU / 2.0).rgb;
        vec3 col;
        if (type < 0.5) {            // slab / parapet: painted concrete
          col = vec3(0.9, 0.89, 0.86) * pd / 0.62 * (0.9 + 0.1 * vn2(vDU * 0.5 + seed * 9.0));
          dN = texture2D(tPN, vDU / 2.0).xyz * 2.0 - 1.0; dNK = 0.6;
        } else if (type < 1.5) {     // railing: glass panels in an aluminium frame
          float fr = 1.0 - step(0.04, vDU.y) * step(vDU.y, 0.94) * step(0.03, fract(vDU.x / 1.2)) * step(fract(vDU.x / 1.2), 0.97);
          col = mix(vec3(0.05, 0.08, 0.085), vec3(0.8, 0.8, 0.8), fr);
          dRough = mix(0.05, 0.35, fr); dMetal = mix(0.2, 0.9, fr);
        } else if (type < 2.5) {     // railing: painted steel bars
          float bar = step(0.75, fract(vDU.x / 0.12)) + step(0.94, vDU.y) + (1.0 - step(0.06, vDU.y));
          if (bar < 0.5) discard;
          col = sub > 0.5 ? vec3(0.06, 0.06, 0.065) : vec3(0.82, 0.82, 0.8);
          dRough = 0.45; dMetal = 0.5;
        } else if (type < 3.5) {     // awning canvas, striped or plain
          float st = step(0.5, fract(vDU.x * 1.8));
          float r = fract(seed * 7.7);
          vec3 c1 = r < 0.3 ? vec3(0.13, 0.36, 0.25) : r < 0.55 ? vec3(0.66, 0.55, 0.38) : r < 0.75 ? vec3(0.12, 0.25, 0.5) : r < 0.88 ? vec3(0.5, 0.12, 0.1) : vec3(0.75, 0.72, 0.62);
          col = r < 0.6 ? mix(c1, vec3(0.88, 0.86, 0.8), st) : c1;
          col *= 0.9 + 0.1 * sin(vDU.x * 200.0);
          dRough = 0.95;
        } else {                     // AC units
          col = vec3(0.86, 0.86, 0.84); dRough = 0.5;
        }
        diffuseColor.rgb = col;
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = dMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (dNK > 0.0) normal = perturb(-vViewPosition, normal, vDU / 2.0, dN, dNK);');
  };
  return mat;
}

class DetailBatch {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.d = []; this.idx = []; }
  /** quad from 4 corners (counter-clockwise seen from the front), uv in metres */
  quad(a, b, c, d, n, uvs, D) {
    const v = this.pos.length / 3;
    for (const p of [a, b, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.d.push(D[0], D[1], D[2]); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  /** axis-aligned-in-wall box: origin o, along t (unit), out n (unit), length L, depth Dp, y0..y1 */
  box(o, t, n, L, Dp, y0, y1, D) {
    const P = (a, b, y) => [o[0] + t[0] * a + n[0] * b, y, o[2] + t[2] * a + n[2] * b];
    const T = [t[0], 0, t[2]], N = [n[0], 0, n[2]], mT = [-t[0], 0, -t[2]], mN = [-n[0], 0, -n[2]];
    this.quad(P(0, 0, y1), P(L, 0, y1), P(L, Dp, y1), P(0, Dp, y1), [0, 1, 0], [[0, 0], [L, 0], [L, Dp], [0, Dp]], D); // top
    this.quad(P(0, Dp, y0), P(L, Dp, y0), P(L, 0, y0), P(0, 0, y0), [0, -1, 0], [[0, Dp], [L, Dp], [L, 0], [0, 0]], D); // bottom
    this.quad(P(0, Dp, y0), P(0, Dp, y1), P(L, Dp, y1), P(L, Dp, y0), N, [[0, y0], [0, y1], [L, y1], [L, y0]], D); // front edge
    this.quad(P(0, 0, y0), P(0, 0, y1), P(0, Dp, y1), P(0, Dp, y0), mT, [[0, y0], [0, y1], [Dp, y1], [Dp, y0]], D);
    this.quad(P(L, Dp, y0), P(L, Dp, y1), P(L, 0, y1), P(L, 0, y0), T, [[0, y0], [0, y1], [Dp, y1], [Dp, y0]], D);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aD', new THREE.Float32BufferAttribute(this.d, 3));
    g.setIndex(this.idx); g.computeBoundingSphere();
    return g;
  }
}

/** Signs atlas for real shop names */
export class LabelAtlas {
  constructor(cols = 4, rows = 64, cw = 512, ch = 80) {
    this.cols = cols; this.rows = rows; this.cw = cw; this.ch = ch; this.n = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = cols * cw; this.canvas.height = rows * ch;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.55, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 0.18 });
  }
  add(text, bg, fg, style = 'bold') {
    if (this.n >= this.cols * this.rows) return null;
    const i = this.n++, cx = (i % this.cols) * this.cw, cy = Math.floor(i / this.cols) * this.ch;
    const g = this.g;
    g.fillStyle = bg; g.fillRect(cx, cy, this.cw, this.ch);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let px = 60;
    const fam = style === 'serif' ? 'Georgia, serif' : '"Barlow Condensed", "Arial Narrow", sans-serif';
    const wgt = style === 'serif' ? 'italic 700' : '800';
    do { g.font = `${wgt} ${px}px ${fam}`; px -= 2; } while (g.measureText(text).width > this.cw - 36 && px > 20);
    g.fillText(text, cx + this.cw / 2, cy + this.ch / 2 + 3);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(cx, cy, this.cw, 4);
    this.tex.needsUpdate = true;
    return [cx / this.canvas.width, 1 - (cy + this.ch) / this.canvas.height, (cx + this.cw) / this.canvas.width, 1 - cy / this.canvas.height];
  }
  plane(rect, w, h) {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + (rect[2] - rect[0]) * uv.getX(i), rect[1] + (rect[3] - rect[1]) * uv.getY(i));
    return new THREE.Mesh(geo, this.mat);
  }
}

const SIGN_STYLE = (k, n) => {
  if (k === 'pharmacy') return ['#0f8a3c', '#ffffff'];
  if (k === 'cafe') return ['#1d1712', '#f3d9a4'];
  if (k === 'restaurant' || k === 'fast_food') return ['#7a1e1e', '#fff3dc'];
  if (k === 'bar') return ['#101418', '#7fe0ff'];
  if (k === 'bank') return ['#0d2b5c', '#ffffff'];
  if (k === 'ice_cream' || k === 'shop:pastry' || k === 'shop:confectionery') return ['#f6e7ef', '#a2195b'];
  if (k === 'fuel') return ['#0a6b2f', '#ffe14d'];
  if (k && k.startsWith('shop:supermarket')) return ['#e5531a', '#ffffff'];
  if (k && k.startsWith('shop:clothes')) return ['#f4f2ee', '#141414'];
  if (k && k.startsWith('shop:bakery')) return ['#6b3f1d', '#fff1d6'];
  const pal = [['#141414', '#ffffff'], ['#ffffff', '#1b1b1b'], ['#203a5c', '#f2f2f2'], ['#b8932e', '#141414'], ['#2b2b2b', '#e8c37a']];
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) | 0; return pal[Math.abs(h) % pal.length];
};

/**
 * The OSM extract maps only part of inland Glyfada / Voula. Fill urban land-cover cells that have no footprint,
 * street, park or beach with apartment blocks of typical size, aligned to the nearest real side street.
 */
export function infillBuildings(map, heightC) {
  const { data, route, terrain } = map;
  const rng = new RNG(31);
  const C = 40, segs = new Map(), boxes = new Map();
  const put = (m, x, z, v) => { const k = Math.floor(x / C) * 100003 + Math.floor(z / C); let l = m.get(k); if (!l) m.set(k, l = []); l.push(v); };
  for (const r of data.sideRoads) {
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const sg = [p[i], p[i + 1], p[i + 2], p[i + 3], r.w / 2];
      const L = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
      for (let t = 0; t <= L; t += C * 0.5) put(segs, sg[0] + (sg[2] - sg[0]) * t / (L || 1), sg[1] + (sg[3] - sg[1]) * t / (L || 1), sg);
    }
  }
  const blockers = [...data.buildings.map((b) => [b.p, false]), ...['park', 'pitch', 'parking', 'pool', 'marina', 'fuel', 'golf', 'beach', 'wood'].flatMap((k) => (data.areas[k] || []).filter((a) => a.c).map((a) => [a.p, true]))];
  for (const [p, area] of blockers) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    const rec = { p, area, x0: x0 - 4, x1: x1 + 4, z0: z0 - 4, z1: z1 + 4 };
    for (let i = Math.floor(rec.x0 / C); i <= Math.floor(rec.x1 / C); i++) for (let j = Math.floor(rec.z0 / C); j <= Math.floor(rec.z1 / C); j++) { const k = i * 100003 + j; let l = boxes.get(k); if (!l) boxes.set(k, l = []); l.push(rec); }
  }
  const nearSeg = (x, z, R) => {
    let best = null, bd = R;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const l = segs.get((Math.floor(x / C) + di) * 100003 + Math.floor(z / C) + dj); if (!l) continue;
      for (const sg of l) {
        const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - sg[0]) * dx + (z - sg[1]) * dz) / L2, 0, 1);
        const d = Math.hypot(sg[0] + dx * t - x, sg[1] + dz * t - z) - sg[4];
        if (d < bd) { bd = d; best = sg; }
      }
    }
    return best ? { d: bd, sg: best } : null;
  };
  const blocked = (x, z) => {
    const l = boxes.get(Math.floor(x / C) * 100003 + Math.floor(z / C)); if (!l) return false;
    for (const r of l) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && (!r.area || pointInPoly(x, z, r.p))) return true;
    return false;
  };
  const out = [];
  let id = 50000;
  for (let s = 0; s < route.length; s += 27) {
    if (route.urban(s) < 0.5) continue;
    for (const side of [-1, 1]) for (let u0 = 34; u0 < 470; u0 += 25) {
      const u = side * (u0 + rng.range(-3, 3)), ss = s + rng.range(-3, 3);
      const c = route.point(ss, u);
      const seaSide = (side > 0 ? route.seaR(ss) : route.seaL(ss)) < 600;
      const okCls = (x, z) => { const k = terrain.cls(x, z); return k === 4 || (k === 8 && !seaSide); };
      if (!okCls(c.x, c.z)) continue;
      const lim = route.edge(ss) + ROAD_CLEAR;
      if (Math.abs(u) < lim) continue;
      // orientation from the nearest street, else the avenue
      const ns = nearSeg(c.x, c.z, 45);
      let tx, tz;
      if (ns) { const dx = ns.sg[2] - ns.sg[0], dz = ns.sg[3] - ns.sg[1], L = Math.hypot(dx, dz) || 1; tx = dx / L; tz = dz / L; }
      else { const f = route.frame(ss, {}); tx = f.tx; tz = f.tz; }
      const W = rng.range(11, 19), D = rng.range(10, 16);
      const nx = -tz, nz = tx;
      const P = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push(c.x + tx * a * W / 2 + nx * b * D / 2, c.z + tz * a * W / 2 + nz * b * D / 2);
      let ok = true;
      const test = [[c.x, c.z]]; for (let i = 0; i < 4; i++) { test.push([P[i * 2], P[i * 2 + 1]]); const j = (i + 1) % 4; test.push([(P[i * 2] + P[j * 2]) / 2, (P[i * 2 + 1] + P[j * 2 + 1]) / 2]); }
      for (const [x, z] of test) {
        if (!okCls(x, z) || heightC(x, z) < 1.2 || blocked(x, z)) { ok = false; break; }
        const q = nearSeg(x, z, 3.0); if (q) { ok = false; break; }
        const pr = route.project(x, z, null); if (Math.abs(pr.u) < route.edge(clamp(pr.s, 0, route.length)) + ROAD_CLEAR) { ok = false; break; }
      }
      if (!ok) continue;
      const lv = rng.chance(0.15) ? 3 : rng.chance(0.55) ? 4 : rng.chance(0.6) ? 5 : 6;
      const rec = { p: P, h: lv * 3.1 + rng.range(0.2, 1.2), lv, k: 'apt', s: Math.round(ss), u: Math.round(u), id: id++, infill: true };
      out.push(rec);
      // block this footprint for the next candidates
      const r2 = { p: P, x0: Math.min(P[0], P[2], P[4], P[6]) - 3, x1: Math.max(P[0], P[2], P[4], P[6]) + 3, z0: Math.min(P[1], P[3], P[5], P[7]) - 3, z1: Math.max(P[1], P[3], P[5], P[7]) + 3 };
      for (let i = Math.floor(r2.x0 / C); i <= Math.floor(r2.x1 / C); i++) for (let j = Math.floor(r2.z0 / C); j <= Math.floor(r2.z1 / C); j++) { const k = i * 100003 + j; let l = boxes.get(k); if (!l) boxes.set(k, l = []); l.push(r2); }
    }
  }
  // the land around the new blocks is town: mark it urban in the land-cover grid (terrain + vegetation read it)
  const T = terrain.T;
  for (const b of out) {
    const p = b.p; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    for (let x = x0 - 10; x <= x1 + 10; x += T) for (let z = z0 - 10; z <= z1 + 10; z += T) {
      const i = Math.round((x - terrain.minX) / T), j = Math.round((z - terrain.minZ) / T);
      if (i >= 0 && j >= 0 && i < terrain.GX && j < terrain.GZ && terrain.C[j * terrain.GX + i] === 8) terrain.C[j * terrain.GX + i] = 4;
    }
  }
  return out;
}
const ROAD_CLEAR = 16;

export function buildBuildings(map, scene, heightC, labels, infill = []) {
  const { data, route } = map;
  if (location.search.includes('debug')) console.log('infill buildings', infill.length);
  const mat = facadeMaterial();
  const detMat = detailMaterial();
  const groups = new Map(); // chunk -> arrays
  const CH = 500;
  const rng = new RNG(5);
  const hashCell = new Map(); const HC = 40; // spatial hash of footprints (for prop placement)
  const roofs = [];
  const domes = [];
  for (const b of data.buildings.concat(infill)) {
    let p = b.p;
    const n = p.length / 2; if (n < 3) continue;
    let area = polyArea(p);
    // wind every footprint so that the edge normal (dz, -dx) points out of the building (front faces outside)
    if (area > 0) { const q = []; for (let i = n - 1; i >= 0; i--) q.push(p[i * 2], p[i * 2 + 1]); p = q; } area = Math.abs(area);
    let gmin = Infinity, gmax = -Infinity, cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { const h = heightC(p[i * 2], p[i * 2 + 1]); gmin = Math.min(gmin, h); gmax = Math.max(gmax, h); cx += p[i * 2]; cz += p[i * 2 + 1]; }
    cx /= n; cz /= n;
    if (gmax < 0.2) continue; // in the water (mapping offset)
    const y0 = gmin - 0.6;
    const k = KIND[b.k] ?? 0;
    let H = Math.max(2.6, b.h);
    if (k === KIND.roof) H = 3.2;
    const y1 = gmax + H - (gmax - gmin) * 0.3;
    const lv = Math.max(1, Math.round((y1 - gmin) / 3.1 - 0.15));
    const seed = (b.id % 997) / 997;
    const key = Math.floor(b.s / CH);
    let G = groups.get(key); if (!G) { G = { pos: [], nor: [], f: [], b: [], idx: [], det: new DetailBatch() }; groups.set(key, G); }
    const base = G.pos.length / 3;
    // walls
    let along = 0;
    const roofTop = y1 + (k <= KIND.hotel ? 0.9 : 0.2);
    // balconies: apartment blocks / hotels get continuous cantilevered balconies on their longer walls
    const FH = 3.1;
    const balcK = (k === KIND.apt || k === KIND.hotel) && lv >= 2 && Math.abs(b.u) < (b.infill ? 260 : 900);
    const railT = rng.next() < 0.45 ? 1 : rng.next() < 0.6 ? 2 : 0;
    const railDark = rng.next() < 0.5 ? 1 : 0;
    const bayW = 2.7 + ((seed * 13.1) % 1) * 1.3;
    const depth = rng.range(1.0, 1.45);
    let longest = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; longest = Math.max(longest, Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1])); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const hasBalc = balcK && L >= 4.5 && (L > longest * 0.55 || rng.next() < 0.35);
      const v = G.pos.length / 3;
      G.pos.push(ax, y0, az, bx, y0, bz, bx, roofTop, bz, ax, roofTop, az);
      for (let q = 0; q < 4; q++) { G.nor.push(nx, 0, nz); G.b.push(lv, k, seed, hasBalc ? 2 : 0); }
      G.f.push(along, y0 - gmin, along + L, y0 - gmin, along + L, roofTop - gmin, along, roofTop - gmin);
      G.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
      if (hasBalc) {
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        const ins = 0.2, BL = L - ins * 2;
        const o = [ax + tx * ins, 0, az + tz * ins], t = [tx, 0, tz], nn = [nx, 0, nz];
        const det = G.det;
        for (let fl = 1; fl <= lv; fl++) {
          const yT = gmin + fl * FH + 0.02;
          const roofEave = fl === lv;
          det.box(o, t, nn, BL, roofEave ? depth * 0.7 : depth, yT - (roofEave ? 0.24 : 0.18), yT, [0, seed, 0]);
          if (roofEave) continue;
          // railing along the outer edge (+ returns at both ends)
          const rt = [railT, seed, railDark];
          const E = (a, d) => [o[0] + t[0] * a + nn[0] * d, o[2] + t[2] * a + nn[2] * d];
          if (railT === 0) det.box([E(0, depth - 0.1)[0], 0, E(0, depth - 0.1)[1]], t, nn, BL, 0.1, yT, yT + 1.0, [0, seed, 0]);
          else {
            const p0 = E(0, depth - 0.04), p1 = E(BL, depth - 0.04), q0 = E(0, 0), q1 = E(BL, 0);
            det.quad([p0[0], yT, p0[1]], [p1[0], yT, p1[1]], [p1[0], yT + 1.0, p1[1]], [p0[0], yT + 1.0, p0[1]], nn, [[0, 0], [BL, 0], [BL, 1], [0, 1]], rt);
            det.quad([q0[0], yT, q0[1]], [p0[0], yT, p0[1]], [p0[0], yT + 1.0, p0[1]], [q0[0], yT + 1.0, q0[1]], [-t[0], 0, -t[2]], [[0, 0], [depth, 0], [depth, 1], [0, 1]], rt);
            det.quad([p1[0], yT, p1[1]], [q1[0], yT, q1[1]], [q1[0], yT + 1.0, q1[1]], [p1[0], yT + 1.0, p1[1]], t, [[0, 0], [depth, 0], [depth, 1], [0, 1]], rt);
          }
          // awnings (tentes) hanging from the slab above, per bay
          const nb = Math.max(1, Math.floor(BL / bayW));
          for (let bI = 0; bI < nb; bI++) {
            const r = rng.next();
            if (r < 0.42) {
              const a0 = bI * bayW + 0.1, a1 = Math.min(BL, (bI + 1) * bayW) - 0.1;
              const yTop = yT + FH - 0.2, yBot = yT + FH - 0.2 - rng.range(0.6, 1.0), out = depth - 0.08;
              const w0 = E(a0, 0.05), w1 = E(a1, 0.05), e0 = E(a0, out), e1 = E(a1, out);
              const ny = out, nh = yTop - yBot, ln = Math.hypot(ny, nh);
              const an = [nn[0] * nh / ln, ny / ln, nn[2] * nh / ln];
              det.quad([e0[0], yBot, e0[1]], [e1[0], yBot, e1[1]], [w1[0], yTop, w1[1]], [w0[0], yTop, w0[1]], an, [[0, 0], [a1 - a0, 0], [a1 - a0, ln], [0, ln]], [3, seed + bI * 0.37 + fl * 0.11, 0]);
            } else if (r > 0.82) {
              // AC unit standing on the balcony floor
              const c0 = E(bI * bayW + 0.3, 0.1);
              det.box([c0[0], 0, c0[1]], t, nn, 0.8, 0.3, yT, yT + 0.55, [4, seed, 0]);
            }
          }
        }
      }
      along += L;
    }
    // roof
    const contour = []; for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
    let tris = [];
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
    const rv = G.pos.length / 3;
    for (let i = 0; i < n; i++) { G.pos.push(p[i * 2], roofTop, p[i * 2 + 1]); G.nor.push(0, 1, 0); G.b.push(lv, k, seed, 1); G.f.push(0, 0); }
    for (const t of tris) {
      // ensure the roof faces up
      const [a, b2, c] = t;
      const ux = p[b2 * 2] - p[a * 2], uz = p[b2 * 2 + 1] - p[a * 2 + 1], vx = p[c * 2] - p[a * 2], vz = p[c * 2 + 1] - p[a * 2 + 1];
      const cy = uz * vx - ux * vz; // y of (u x v)
      if (cy > 0) G.idx.push(rv + a, rv + b2, rv + c); else G.idx.push(rv + a, rv + c, rv + b2);
    }
    // spatial hash for prop placement
    const bb = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
    for (let i = 0; i < n; i++) { bb.x0 = Math.min(bb.x0, p[i * 2]); bb.x1 = Math.max(bb.x1, p[i * 2]); bb.z0 = Math.min(bb.z0, p[i * 2 + 1]); bb.z1 = Math.max(bb.z1, p[i * 2 + 1]); }
    const rec = { p, bb, top: roofTop, k, area, cx, cz, s: b.s, u: b.u, gmin };
    for (let i = Math.floor(bb.x0 / HC); i <= Math.floor(bb.x1 / HC); i++) for (let j = Math.floor(bb.z0 / HC); j <= Math.floor(bb.z1 / HC); j++) { const kk = i * 100003 + j; if (!hashCell.has(kk)) hashCell.set(kk, []); hashCell.get(kk).push(rec); }
    if ((k === KIND.apt || k === KIND.villa || k === KIND.hotel) && area > 50) roofs.push(rec);
    if (k === KIND.church) domes.push(rec);
  }
  const group = new THREE.Group(); scene.add(group);
  for (const G of groups.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(G.f, 2));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(G.b, 4));
    g.setIndex(G.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.layers.enable(REFLECT_LAYER); m.userData.dynamic = true; group.add(m);
    if (G.det.pos.length) {
      const dg = G.det.build();
      const dm = new THREE.Mesh(dg, detMat); dm.castShadow = true; dm.receiveShadow = true; dm.userData.dynamic = true;
      dm.userData.lod = true; dm.userData.far = 1100; dm.boundingSphere = dg.boundingSphere;
      group.add(dm);
    }
  }
  const inBuilding = (x, z, pad = 0) => {
    const list = hashCell.get(Math.floor(x / HC) * 100003 + Math.floor(z / HC)); if (!list) return null;
    for (const r of list) { if (x < r.bb.x0 - pad || x > r.bb.x1 + pad || z < r.bb.z0 - pad || z > r.bb.z1 + pad) continue; if (pad > 0 || pointInPoly(x, z, r.p)) return r; }
    return null;
  };

  // ---- rooftop solar water heaters (the Greek skyline signature) + water tanks
  const tankGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.6, 12); tankGeo.rotateZ(Math.PI / 2); tankGeo.translate(0, 1.35, 0.55);
  const panelGeo = new THREE.BoxGeometry(2.0, 0.06, 1.4); panelGeo.rotateX(-0.75); panelGeo.translate(0, 0.75, -0.05);
  const frameGeo = new THREE.BoxGeometry(1.9, 0.9, 0.05); frameGeo.translate(0, 0.45, 0.62);
  const tanks = new CellInstances(tankGeo, new THREE.MeshStandardMaterial({ color: '#e6e6e2', metalness: 0.5, roughness: 0.35 }), { cell: 500, far: 800, shadow: false });
  const panels = new CellInstances(panelGeo, new THREE.MeshStandardMaterial({ color: '#1b2a44', metalness: 0.6, roughness: 0.18 }), { cell: 500, far: 800, shadow: false });
  const frames = new CellInstances(frameGeo, new THREE.MeshStandardMaterial({ color: '#8e9296', metalness: 0.7, roughness: 0.4 }), { cell: 500, far: 600, shadow: false });
  const sunYaw = Math.PI; // collectors face south (+z)
  for (const r of roofs) {
    if (Math.abs(r.u) > 420) continue;
    const cnt = Math.min(5, Math.max(1, Math.floor(r.area / 110)));
    for (let i = 0; i < cnt; i++) {
      for (let t = 0; t < 6; t++) {
        const x = rng.range(r.bb.x0 + 1.5, r.bb.x1 - 1.5), z = rng.range(r.bb.z0 + 1.5, r.bb.z1 - 1.5);
        if (!pointInPoly(x, z, r.p)) continue;
        const yaw = sunYaw + rng.range(-0.25, 0.25);
        tanks.addTRS(x, r.top, z, yaw, 1); panels.addTRS(x, r.top, z, yaw, 1); frames.addTRS(x, r.top, z, yaw, 1);
        break;
      }
    }
  }
  tanks.build(group); panels.build(group); frames.build(group);
  // chapel domes
  const domeMat = new THREE.MeshStandardMaterial({ color: '#1d4fa3', roughness: 0.4 });
  for (const d of domes) {
    const r = Math.min(3.2, Math.sqrt(d.area) * 0.22);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    m.position.set(d.cx, d.top, d.cz); m.castShadow = true; group.add(m);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), new THREE.MeshStandardMaterial({ color: '#d8c27a', metalness: 1, roughness: 0.3 }));
    cross.position.set(d.cx, d.top + r + 0.45, d.cz); group.add(cross);
  }

  // ---- shop signs with the real names, mounted on the facade nearest each OSM shop/cafe
  const pt = new THREE.Vector3();
  const pharmacyCross = makePharmacyCross();
  const signs = [];
  for (const poi of data.pois) {
    if (Math.abs(poi.u) > 140) continue;
    // nearest wall edge that faces the road
    let best = null, bd = 28;
    const fr = route.frame(poi.s, {});
    const toRoad = [fr.x - poi.x, fr.z - poi.z]; const tl = Math.hypot(...toRoad) || 1; toRoad[0] /= tl; toRoad[1] /= tl;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const list = hashCell.get((Math.floor(poi.x / HC) + di) * 100003 + Math.floor(poi.z / HC) + dj); if (!list) continue;
      for (const r of list) {
        if (r.k === KIND.roof || r.k === KIND.shed) continue;
        const n = r.p.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n; const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[j * 2], bz = r.p[j * 2 + 1];
          const L = Math.hypot(bx - ax, bz - az); if (L < 3) continue;
          const nx = (bz - az) / L, nz = -(bx - ax) / L;
          if (nx * toRoad[0] + nz * toRoad[1] < 0.35) continue;
          let t = ((poi.x - ax) * (bx - ax) + (poi.z - az) * (bz - az)) / (L * L); t = clamp(t, 0.15, 0.85);
          const px = ax + (bx - ax) * t, pz = az + (bz - az) * t; const d = Math.hypot(px - poi.x, pz - poi.z);
          if (d < bd) { bd = d; best = { px, pz, nx, nz, L, r }; }
        }
      }
    }
    if (!best) continue;
    if (signs.some((q) => Math.hypot(q.x - best.px, q.z - best.pz) < 4)) continue;
    const kind = poi.k;
    const text = kind === 'pharmacy' ? 'PHARMACY · ' + poi.n.toUpperCase() : poi.n.toUpperCase();
    const [bg, fg] = SIGN_STYLE(kind, poi.n);
    const rect = labels.add(text, bg, fg); if (!rect) break;
    const w = Math.min(best.L * 0.85, 4.2 + text.length * 0.12), h = w / 512 * 80 * 1.35;
    const m = labels.plane(rect, w, Math.min(0.9, h));
    const gy = best.r.gmin + 0.6 + 2.85;
    m.position.set(best.px + best.nx * 0.14, gy, best.pz + best.nz * 0.14);
    m.rotation.y = Math.atan2(best.nx, best.nz);
    group.add(m);
    signs.push({ x: best.px, z: best.pz });
    if (kind === 'pharmacy') {
      const c = pharmacyCross.clone(); c.position.set(best.px + best.nx * 0.9 + best.nz * (w / 2 + 0.4), gy + 0.9, best.pz + best.nz * 0.9 - best.nx * (w / 2 + 0.4)); c.rotation.y = Math.atan2(best.nz, -best.nx); group.add(c);
    }
  }
  return { group, inBuilding, roofs };
}

function makePharmacyCross() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#16c45a', emissive: '#22ff6a', emissiveIntensity: 2.2, roughness: 0.3 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.28), mat), b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.85), mat);
  g.add(a, b);
  return g;
}
