// Photographic PBR texture library (CC0 scans from Poly Haven, re-encoded to WebP by tools/fetch_tex.py)
// plus the GLSL helpers every surface shader shares: derivative-based normal mapping, stochastic
// (anti-tiling) sampling, and value noise.
import * as THREE from 'three';

const BASE = './assets/tex/';
const LIST = {
  asphalt: ['asphalt_02', 'diff nor arm'],
  paver: ['floor_pavement', 'diff nor arm'],
  concrete: ['concrete_floor_worn_001', 'diff nor arm'],
  ground: ['dry_ground_01', 'diff nor'],
  grass: ['withered_grass', 'diff nor'],
  sand: ['coast_sand_01', 'diff nor'],
  rock: ['rock_face_03', 'diff nor'],
  leather: ['fabric_leather_02', 'nor arm'],
};
const SINGLE = { water: 'waternormals' };

export const TX = {};
// Anisotropic filtering level for subsequently loaded textures (lower presets use less: cheaper sampling on
// road surfaces at grazing angles). Applied live to already-loaded textures via setAnisotropy().
let ANISO = 8;

// Texture objects exist immediately (materials can reference them while the world is being built); the images
// decode off the main thread and are attached as they arrive.
function load(key, url, srgb) {
  const t = TX[key] = new THREE.Texture();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return new Promise((res) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => { t.image = img; t.needsUpdate = true; res(t); }); };
    img.onerror = () => { // keep running without the file: a flat 1x1 stand-in
      const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d');
      g.fillStyle = srgb ? '#a0a0a0' : '#8080ff'; g.fillRect(0, 0, 1, 1); t.image = c; t.needsUpdate = true; res(t);
    };
    img.src = url;
  });
}

let pending = null;
/** Start loading everything; returns a promise that resolves once all images are decoded and attached. */
export function loadTextures() {
  if (pending) return pending;
  const jobs = [];
  for (const [key, [file, maps]] of Object.entries(LIST)) for (const m of maps.split(' ')) jobs.push(load(key + '_' + m, `${BASE}${file}_${m}.webp`, m === 'diff'));
  for (const [key, file] of Object.entries(SINGLE)) jobs.push(load(key, `${BASE}${file}.webp`, key !== 'water'));
  return (pending = Promise.all(jobs));
}
/** upload everything to the GPU before the first frame */
export function uploadTextures(renderer) { for (const t of Object.values(TX)) if (t.image) renderer.initTexture(t); }
/** Live anisotropy level (1..8): cheap texture filtering on the light presets. High keeps 8. */
export function setAnisotropy(n) {
  ANISO = Math.max(1, Math.min(8, Math.round(n) || 1));
  for (const t of Object.values(TX)) {
    if (t.anisotropy === ANISO) continue;
    t.anisotropy = ANISO; t.needsUpdate = true;
  }
  return ANISO;
}

/** GLSL: shared helpers. Include after <common>. */
export const GLSL_HELPERS = /* glsl */`
  float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
    return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
  float fbm2(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vn2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
  // tangent frame from screen-space derivatives (no tangent attribute needed)
  mat3 tbnFrom(vec3 eyePos, vec3 n, vec2 uv){
    vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
    vec2 st0 = dFdx(uv), st1 = dFdy(uv);
    vec3 q1perp = cross(q1, n), q0perp = cross(n, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(T, T), dot(B, B));
    float sc = det == 0.0 ? 0.0 : inversesqrt(det);
    return mat3(T * sc, B * sc, n);
  }
  // apply a tangent-space normal (xy in -1..1) with strength k
  vec3 perturb(vec3 eyePos, vec3 n, vec2 uv, vec3 tn, float k){
    tn.xy *= k; mat3 m = tbnFrom(eyePos, n, uv); return normalize(m * tn);
  }
  // anti-tiling: blend two rotated/offset lookups by a low-frequency noise
  vec4 texNoTile(sampler2D t, vec2 uv){
    float k = vn2(uv * 0.13);
    vec2 o1 = h22(floor(uv * 0.13 + 0.5)) * 7.0;
    vec4 a = texture2D(t, uv);
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv + vec2(0.37, 0.71) + o1;
    vec4 b = textureGrad(t, uv2, mat2(0.8, -0.6, 0.6, 0.8) * dFdx(uv), mat2(0.8, -0.6, 0.6, 0.8) * dFdy(uv));
    return mix(a, b, smoothstep(0.35, 0.65, k));
  }
`;
