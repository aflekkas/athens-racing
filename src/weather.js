// Conditions in the world: what the time of day and the weather (env.js) mean for everything that isn't sky.
//  - night: street lamps lit with light pools on the road (analytic, in the road / pavement shaders: no real
//    lights), lit windows, car head / tail lamps (emissive + glow sprites; the player gets one real spot light on
//    HIGH), headlight pools on the road for the rival and nearby traffic
//  - rain: instanced streaks around the camera, a wet road (darker, glossy, puddles that mirror the sky and the
//    lamps), spray behind cars, drops and wipers on the cockpit windscreen, less grip (ground.js WEATHER)
// API: setConditions({time, weather}) / getConditions() (plain data: events and multiplayer exchange it),
// initWeather(ctx) once the world is built (before the shaders compile), updateWeather(dt) every drawn frame.
import * as THREE from 'three';
import * as ENV from './env.js';
import { WEATHER } from './ground.js';
import { setCarLights, setTrafficLights } from './vehicle-models.js';

export const setConditions = (c) => ENV.setConditions(c);
export const getConditions = () => ENV.getConditions();
if (typeof window !== 'undefined') { window.__setConditions = setConditions; window.__conditions = getConditions; }

const NL = 12, NC = 6;       // analytic lamps / car lights evaluated per road pixel (LOW: fewer, see init)
const GRIP_RAIN = 0.78;
const lum = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

// ---- uniforms shared by every material the weather touches
const WXU = {
  wxWet: { value: 0 }, wxRain: { value: 0 }, wxNight: { value: 0 }, wxTime: ENV.U.time,
  wxLamp: { value: new Float32Array(NL * 4) }, wxLampC: { value: new THREE.Vector3(1.0, 0.78, 0.5) },
  wxCarP: { value: new Float32Array(NC * 4) }, wxCarD: { value: new Float32Array(NC * 4) }, wxCarC: { value: new THREE.Vector3(1.0, 0.95, 0.86) },
  wxDay: { value: 1 }, wxWin: { value: 0 },
};

const WX_VS_PARS = '\nvarying vec3 vWxP;';
const WX_VS = `
#ifdef USE_INSTANCING
  vWxP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vWxP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`;
const WX_FS_PARS = /* glsl */`
uniform float wxWet; uniform float wxRain; uniform float wxNight; uniform float wxTime;
uniform vec4 wxLamp[${NL}]; uniform vec3 wxLampC; uniform vec4 wxCarP[${NC}]; uniform vec4 wxCarD[${NC}]; uniform vec3 wxCarC;
varying vec3 vWxP;
float wxH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wxN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(wxH(i), wxH(i + vec2(1, 0)), u.x), mix(wxH(i + vec2(0, 1)), wxH(i + vec2(1, 1)), u.x), u.y); }
float wxPuddle = 0.0;`;
// before the material is set up: a wet surface is darker and glossier, puddles are flat mirrors with ripples
const WX_WET = /* glsl */`
if (wxWet > 0.0) {
  vec2 q = vWxP.xz;
  float n = wxN(q * 0.21) * 0.62 + wxN(q * 0.83 + 7.0) * 0.38;
  float bias = 0.0;
  #ifdef WX_ASPHALT
    bias = gut * 0.22 + polish * 0.1; // water stands along the kerb and in the worn wheel tracks
  #endif
  wxPuddle = smoothstep(0.6, 0.7, n + bias) * smoothstep(0.3, 0.8, wxWet);
  diffuseColor.rgb *= mix(1.0, 0.52, wxWet) * (1.0 - 0.3 * wxPuddle);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.42, wxWet);
  roughnessFactor = mix(roughnessFactor, 0.03, wxPuddle);
  // raindrop rings in the puddles (cheap: two scrolling noise layers)
  vec2 rp = q * 5.0;
  vec2 rip = vec2(wxN(rp + wxTime * 1.7) - wxN(rp + 3.1 - wxTime * 1.3), wxN(rp.yx - wxTime * 1.5) - wxN(rp.yx + 5.2 + wxTime * 1.1));
  normal = normalize(mix(normal, nonPerturbedNormal, wxPuddle * 0.92) + vec3(rip * 0.06 * wxRain * wxPuddle, 0.0));
}`;
// after the scene lights: street lamps (down-lights) and car headlamps (spots), lit analytically in world space
const WX_LIGHTS = /* glsl */`
if (wxNight > 0.0) {
  vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 Vw = normalize(cameraPosition - vWxP);
  for (int i = 0; i < ${NL}; i++) {
    vec4 lp = wxLamp[i]; if (lp.w <= 0.0) continue;
    vec3 Lv = lp.xyz - vWxP; float d2 = dot(Lv, Lv); vec3 Ln = Lv * inversesqrt(d2);
    float cone = smoothstep(0.2, 0.75, Ln.y);
    vec3 E = wxLampC * (lp.w * cone * saturate(dot(Nw, Ln)) / (d2 + 3.0));
    reflectedLight.directDiffuse += E * BRDF_Lambert(material.diffuseColor);
    reflectedLight.directSpecular += E * BRDF_GGX(Ln, Vw, Nw, material);
  }
  for (int i = 0; i < ${NC}; i++) {
    vec4 cp = wxCarP[i]; if (cp.w <= 0.0) continue;
    vec3 Lv = cp.xyz - vWxP; float d2 = dot(Lv, Lv); vec3 Ln = Lv * inversesqrt(d2);
    float ca = dot(-Ln, wxCarD[i].xyz);
    float cone = smoothstep(0.86, 0.97, ca) * (0.6 + 0.4 * smoothstep(0.97, 0.995, ca));
    vec3 E = wxCarC * (cp.w * cone * saturate(dot(Nw, Ln)) / (d2 + 1.0));
    reflectedLight.directDiffuse += E * BRDF_Lambert(material.diffuseColor);
    reflectedLight.directSpecular += E * BRDF_GGX(Ln, Vw, Nw, material);
  }
}`;

/** chain onto a material's existing onBeforeCompile (keeps the owner's shader, adds ours); must run before compile */
function wrap(mat, tag, fn) {
  if (mat.userData.wx) return; mat.userData.wx = tag;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); fn(sh); };
  mat.customProgramCacheKey = function () { return prevKey.call(this) + '|' + tag; };
  mat.needsUpdate = true;
}
const warned = new Set();
function replaceOnce(src, a, b, what) {
  if (!src.includes(a)) { if (!warned.has(what)) { warned.add(what); console.warn('weather: shader hook not found:', what); } return src; }
  return src.replace(a, b);
}
function roadHook(sh) {
  Object.assign(sh.uniforms, WXU);
  sh.vertexShader = replaceOnce(sh.vertexShader, '#include <common>', '#include <common>' + WX_VS_PARS, 'road vs common');
  sh.vertexShader = replaceOnce(sh.vertexShader, '#include <worldpos_vertex>', '#include <worldpos_vertex>' + WX_VS, 'road worldpos');
  const asphalt = sh.fragmentShader.includes('float gut') && sh.fragmentShader.includes('polish');
  sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <common>', (asphalt ? '#define WX_ASPHALT\n' : '') + '#include <common>' + WX_FS_PARS, 'road fs common');
  sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <lights_physical_fragment>', WX_WET + '\n#include <lights_physical_fragment>', 'road lights_physical');
  sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + WX_LIGHTS, 'road lights_end');
}
// facades: daylight inside the rooms scales with the light outside; at night many more rooms have the lamp on
function facadeHook(sh) {
  sh.uniforms.wxDay = WXU.wxDay; sh.uniforms.wxWin = WXU.wxWin;
  sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <common>', '#include <common>\nuniform float wxDay; uniform float wxWin;', 'facade common');
  sh.fragmentShader = replaceOnce(sh.fragmentShader, 'float E = 0.16 * exp(-hp.z * 0.32) + 0.02;',
    'float E = (0.16 * exp(-hp.z * 0.32) + 0.02) * wxDay; lit = max(lit, step(1.0 - wxWin, h12(vec2(seed, 2.9)))) * (1.0 + 5.0 * wxWin);', 'facade interior light');
}
// leaf / frond translucency toward the light: scaled to the direct light actually there (env.js apP.z)
function leafHook(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n#ifdef USE_FOG\n#define WX_SUNK (apP.y > 0.5 ? apP.z : 1.0)\n#else\n#define WX_SUNK 1.0\n#endif')
    .replace(/totalEmissiveRadiance \+= leafT/g, 'totalEmissiveRadiance += WX_SUNK * leafT');
}

// ---- soft additive glow sprites (lamps, head / tail lamps), sized in metres with a minimum on-screen size
function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uFog: { value: 0 } },
    vertexShader: /* glsl */`attribute float aSize; attribute vec3 aCol; uniform float uScale; uniform float uFog; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = max(-mv.z, 0.1);
        float px = aSize * uScale / d; gl_PointSize = clamp(px, 3.0, 220.0);
        vC = aCol * min(1.0, px / 3.0) * exp(-d * uFog); if (dot(aCol, aCol) <= 0.0) gl_PointSize = 0.0; }`,
    fragmentShader: /* glsl */`varying vec3 vC;
      void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard;
        float a = exp(-r * 9.0) * 1.6 + exp(-r * 2.5) * 0.25; gl_FragColor = vec4(vC * a * (1.0 - r), 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
function pointsOf(n, mat) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3).fill(0), size = new Float32Array(n), col = new Float32Array(n * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const p = new THREE.Points(g, mat); p.frustumCulled = false; p.renderOrder = 6;
  return { p, pos, size, col, g, n };
}

// ---- rain: instanced camera-facing streaks in a box that travels with the camera (all motion on the GPU)
function createRain(n) {
  const base = new THREE.PlaneGeometry(1, 1); base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position);
  const off = new Float32Array(n * 4); for (let i = 0; i < off.length; i++) off[i] = Math.random();
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4)); g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uCamVel: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(44, 26, 44) },
      uCol: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uAlpha: { value: 0 }, uWind: { value: new THREE.Vector3(1.2, 0, 0.6) }, uNear: { value: 1.2 } },
    vertexShader: /* glsl */`attribute vec4 aOff; uniform float uTime; uniform vec3 uCam; uniform vec3 uCamVel; uniform vec3 uBox; uniform vec3 uWind; uniform float uNear;
      varying float vA; varying float vY;
      void main(){
        vec3 vel = vec3(uWind.x, -8.5 * (0.8 + 0.4 * aOff.w), uWind.z);
        vec3 c = uCam - uBox * 0.5;
        vec3 p = c + mod(aOff.xyz * uBox + vel * uTime - c, uBox);
        vec3 rel = vel - uCamVel; float sp = length(rel); vec3 dir = rel / max(sp, 1e-3);
        float len = clamp(sp * 0.028, 0.18, 1.8);
        vec3 toC = cameraPosition - p; float d = length(toC);
        vec3 side = normalize(cross(dir, toC / max(d, 1e-3)));
        vec3 wp = p + dir * (position.y - 0.5) * len + side * position.x * (0.007 + d * 0.0009);
        vA = smoothstep(uNear, uNear + 1.5, d) * (1.0 - smoothstep(14.0, 22.0, d));
        vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`uniform vec3 uCol; uniform float uAlpha; varying float vA; varying float vY;
      void main(){ float a = uAlpha * vA * sin(vY * 3.14159); if (a < 0.003) discard; gl_FragColor = vec4(uCol, a); }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 7; mesh.visible = false;
  return { mesh, mat };
}

// ---- spray thrown up behind wheels on a wet road (CPU particles, soft sprites lit by the ambient light)
class Spray {
  constructor(scene, n) {
    this.n = n; this.k = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3).fill(-1e5); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.age = new Float32Array(n);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uCol: { value: new THREE.Vector3(0.6, 0.6, 0.6) } },
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 300.0); vA = aAlpha; }`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard; gl_FragColor = vec4(uCol, vA * (1.0 - r) * (1.0 - r)); }`,
      transparent: true, depthWrite: false,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; this.pts.visible = false;
    scene.add(this.pts); this.g = g; this.live = 0;
  }
  emit(x, y, z, vx, vy, vz, a) {
    const k = this.k; this.k = (k + 1) % this.n;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.life[k] = 0.7 + Math.random() * 0.5; this.age[k] = 0; this.alpha[k] = a; this.live = 2;
  }
  update(dt) {
    if (this.live <= 0) return;
    let any = false;
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      const t = (this.age[k] += dt) / this.life[k];
      if (t >= 1) { this.life[k] = 0; this.alpha[k] = 0; this.pos[k * 3 + 1] = -1e5; continue; }
      any = true;
      const d = Math.exp(-2.2 * dt);
      this.vel[k * 3] *= d; this.vel[k * 3 + 2] *= d; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * d - 2.5 * dt;
      for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt;
      this.size[k] = 0.5 + 2.6 * Math.sqrt(t);
      this.alpha[k] *= 1 - dt * 1.4;
    }
    if (!any) this.live--;
    for (const a of ['position', 'aSize', 'aAlpha']) this.g.attributes[a].needsUpdate = true;
  }
}

// ---- drops on the cockpit windscreen, cleared by two wipers
function dropMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: ENV.U.time, uRain: { value: 0 }, uAmb: { value: new THREE.Vector3(0.3, 0.3, 0.3) }, uWipe: { value: 1.25 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`uniform float uTime; uniform float uRain; uniform vec3 uAmb; uniform float uWipe; varying vec2 vUv;
      float h1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      const float TAU = 6.2831853, SWEEP = 2.3, ARM = 0.66;
      // seconds since the arm pivoting at P last passed over m (both arms run in phase)
      float since(vec2 m, vec2 P, float w, float omega){
        vec2 r = m - P; if (length(r) > ARM || r.y < 0.0) return 1e3;
        float phi = atan(r.y, r.x); float s = (3.14159 - phi) / SWEEP; if (s < 0.0 || s > 1.0) return 1e3;
        float w0 = acos(clamp(1.0 - 2.0 * s, -1.0, 1.0));
        return min(mod(w - w0, TAU), mod(w - (TAU - w0), TAU)) / omega;
      }
      float blade(vec2 m, vec2 P, float a){ vec2 dir = vec2(cos(a), sin(a)); vec2 r = m - P; float t = clamp(dot(r, dir), 0.0, ARM); return 1.0 - smoothstep(0.004, 0.009, length(r - dir * t)) * 1.0; }
      void main(){
        vec2 m = vec2(vUv.x * 1.3, vUv.y * 0.75);
        float omega = TAU / uWipe, w = mod(uTime * omega, TAU);
        vec2 P1 = vec2(0.3, -0.04), P2 = vec2(0.92, -0.04);
        float ts = min(since(m, P1, w, omega), since(m, P2, w, omega));
        // drops land at random times, sitting in a jittered grid of cells
        vec2 cell = m / 0.03; vec2 ci = floor(cell); vec2 cf = fract(cell);
        float hA = h1(ci), hB = h1(ci + 17.3), hC = h1(ci + 41.7);
        float tLand = hA * 2.2 / max(uRain, 0.05) + hC * 0.4;
        float age = mod(uTime + hB * 37.0, 1e4);
        float on = step(tLand, min(ts, age));
        vec2 c = vec2(0.25 + 0.5 * hB, 0.25 + 0.5 * hC);
        float rad = 0.16 + 0.22 * hA;
        vec2 dv = cf - c; float dd = length(dv) / rad;
        float drop = (1.0 - smoothstep(0.8, 1.0, dd)) * on;
        // a lens: dark rim, a bright fleck where it catches the sky, the world showing (blurred) through
        vec3 col = uAmb * (0.55 + 0.9 * smoothstep(0.7, 0.0, length(dv / rad + vec2(0.35, -0.4)))) * (0.6 + 0.4 * smoothstep(1.0, 0.6, dd));
        float a = drop * (0.32 + 0.4 * smoothstep(0.6, 1.0, dd));
        // the blades themselves
        float a1 = 3.14159 - SWEEP * (0.5 - 0.5 * cos(w));
        float b = max(blade(m, P1, a1), blade(m, P2, a1));
        col = mix(col, vec3(0.012), b); a = max(a, b * 0.96);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ state
let W = null;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

/**
 * ctx: { renderer, scene, camera, sky, water, sun, post, probe, traffic, assets, audio, low, cars: () => [player, rival], cam: () => 'cockpit'|'chase'|'orbit' }
 * Call once the world is built and before the shaders compile (it extends the road / facade / leaf shaders).
 */
export function initWeather(ctx) {
  const { scene, low } = ctx;
  W = { ...ctx, nl: low ? 6 : NL, lamps: [], lampMats: [], frame: 0, lastModel: null, drops: null, rainT: 0, prevCam: new THREE.Vector3(), camVel: new THREE.Vector3() };
  // -- material hooks
  const seen = new Set();
  scene.traverse((o) => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (seen.has(m)) continue; seen.add(m);
      const key = m.customProgramCacheKey && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey() : '';
      if (/^(asphalt|paving|concrete)/.test(key)) wrap(m, 'wx-road', roadHook);
      else if (/^facade/.test(key)) wrap(m, 'wx-facade', facadeHook);
      else if (/^(leaf|frond)/.test(key) || (m.onBeforeCompile && /totalEmissiveRadiance \+= leafT/.test(m.onBeforeCompile.toString()))) wrap(m, 'wx-leaf', leafHook);
      // street-lamp heads (road.js): emissive '#fff2d6'
      if (m.emissive && m.emissive.getHexString() === 'fff2d6' && o.isInstancedMesh) W.lampMats.push(m);
    }
    // lamp head positions: the head box sits 2.25 m out along the arm, 9.15 m up the pole
    if (o.isInstancedMesh && o.material && o.material.emissive && o.material.emissive.getHexString() === 'fff2d6') {
      o.updateMatrixWorld(true);
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld); W.lamps.push(new THREE.Vector3(2.25, 9.0, 0).applyMatrix4(_m)); }
    }
  });
  W.lampMats = [...new Set(W.lampMats)];
  W.lampBase = W.lampMats.map((m) => m.emissiveIntensity);
  // -- lamp halos (static) and car-lamp glows (dynamic)
  W.glowMat = glowMaterial();
  W.lampGlow = pointsOf(Math.max(1, W.lamps.length), W.glowMat);
  W.lamps.forEach((p, i) => { W.lampGlow.pos.set([p.x, p.y - 0.12, p.z], i * 3); W.lampGlow.size[i] = 1.3; });
  W.lampGlow.g.attributes.position.needsUpdate = true; W.lampGlow.g.attributes.aSize.needsUpdate = true;
  W.lampGlow.p.visible = false; scene.add(W.lampGlow.p);
  W.carGlow = pointsOf(4 * 72, W.glowMat); W.carGlow.p.visible = false; scene.add(W.carGlow.p);
  // -- the player's headlights: one real spot light on HIGH (always in the scene so switching never recompiles)
  if (!low) {
    W.spot = new THREE.SpotLight(0xfff1dc, 0, 0, 0.62, 0.55, 2);
    W.spot.castShadow = false; scene.add(W.spot); scene.add(W.spot.target);
  }
  // -- rain, spray
  W.rain = createRain(low ? 1800 : 6000); scene.add(W.rain.mesh);
  W.spray = new Spray(scene, low ? 220 : 600);
  W.dropMat = dropMaterial();
  ENV.onConditions(apply);
  apply(ENV.COND, ENV.COND_STATE, true);
  return W;
}

function apply(cond, st, changed) {
  if (!W) return;
  const night = st.night, lamps = st.lamps, rain = st.rain;
  // physics + effects (ground.js owns the object)
  Object.assign(WEATHER, { gripScale: rain ? GRIP_RAIN : 1, wet: rain, ambient: Math.min(1, st.ambient) });
  WXU.wxWet.value = rain; WXU.wxRain.value = rain;
  WXU.wxNight.value = lamps > 0 || st.headlights ? 1 : 0;
  WXU.wxDay.value = Math.min(1.2, st.daylight); WXU.wxWin.value = night ? 0.5 : lamps * 0.35;
  for (let i = 0; i < W.lampMats.length; i++) W.lampMats[i].emissiveIntensity = W.lampBase[i] + 28 * lamps;
  W.lampGlow.p.visible = lamps > 0;
  for (let i = 0; i < W.lamps.length; i++) W.lampGlow.col.set([4.5 * lamps, 3.4 * lamps, 2.1 * lamps], i * 3);
  W.lampGlow.g.attributes.aCol.needsUpdate = true;
  W.lightsOn = !!st.headlights;
  setTrafficLights(W.lightsOn);
  W.lastLights = null; // re-apply to the racers next frame
  W.post.setConditions(st);
  if (changed && W.probe && ENV.bakedSky()) W.probe.pmrem.fromCubemap(ENV.bakedSky(), W.probe.envRT);
  W.rain.mesh.visible = rain > 0; W.spray.pts.visible = rain > 0;
  W.audio?.setWeather?.(cond.weather, rain || (st.over ? 0.3 : 0));
  W.audio?.setTimeOfDay?.(cond.time);
}

const carList = [];
/** per drawn frame: lights follow the cars and the camera, rain follows the camera */
export function updateWeather(dt) {
  if (!W) return;
  const st = ENV.COND_STATE, cam = W.camera, f = ++W.frame;
  const cars = W.cars().filter(Boolean), player = cars[0];
  // camera velocity (for the rain streaks' apparent motion)
  if (dt > 0) { W.camVel.subVectors(cam.position, W.prevCam).divideScalar(Math.max(dt, 1e-3)); if (W.camVel.lengthSq() > 4e4) W.camVel.set(0, 0, 0); }
  W.prevCam.copy(cam.position);
  const pxPerM = W.renderer.getDrawingBufferSize(_c).y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  W.glowMat.uniforms.uScale.value = pxPerM;
  W.glowMat.uniforms.uFog.value = st.rain ? 0.006 : st.over ? 0.0012 : 0.0003;
  // racers' lamps
  const lightsKey = player && player.model;
  if (W.lastLights !== lightsKey) { W.lastLights = lightsKey; for (const c of cars) setCarLights(c.model, W.lightsOn); }
  // ---- nearest street lamps -> analytic pools on the road (refreshed every few frames)
  const lampOn = st.lamps > 0;
  if (lampOn && (f % 4 === 0 || !W.near)) {
    const cx = cam.position.x, cz = cam.position.z, L = W.lamps;
    W.near = L.map((p, i) => [((p.x - cx) ** 2 + (p.z - cz) ** 2), i]).sort((a, b) => a[0] - b[0]).slice(0, W.nl);
    const a = WXU.wxLamp.value; a.fill(0);
    W.near.forEach(([d2, i], k) => { const p = L[i]; a.set([p.x, p.y, p.z, 34 * st.lamps * (1 - Math.min(1, Math.sqrt(d2) / 420))], k * 4); });
  } else if (!lampOn) WXU.wxLamp.value.fill(0);
  // ---- car lamps: glows for everyone, road pools for the rival + nearest traffic, a spot light for the player
  const G = W.carGlow; let n = 0;
  const cp = WXU.wxCarP.value, cd = WXU.wxCarD.value; cp.fill(0);
  let nc = 0;
  const on = W.lightsOn;
  const camIn = W.cam() === 'cockpit';
  const pushCar = (root, wid, len, hy, brake, self, poolOK) => {
    root.updateMatrixWorld();
    const e = root.matrixWorld.elements;
    _f.set(-e[8], -e[9], -e[10]).normalize(); // nose is -Z
    _c.subVectors(cam.position, _v.setFromMatrixPosition(root.matrixWorld));
    const dist = _c.length(); if (dist > 650) return;
    const facing = _f.dot(_c) / Math.max(dist, 1e-3);
    const front = on ? Math.max(0, facing + 0.25) / 1.25 : 0, back = Math.max(0, -facing + 0.3) / 1.3;
    for (const sx of [-1, 1]) {
      if (n + 2 > G.n) return;
      if (!(self && camIn)) {
        _v.set(sx * wid * 0.36, hy, -len / 2 - 0.12).applyMatrix4(root.matrixWorld); G.pos.set([_v.x, _v.y, _v.z], n * 3); G.size[n] = 0.55;
        G.col.set([3.2 * front, 3.0 * front, 2.6 * front], n * 3); n++;
      }
      const tb = (on ? 0.9 : 0) + (brake ? 2.2 : 0);
      _v.set(sx * wid * 0.38, hy + 0.06, len / 2 + 0.1).applyMatrix4(root.matrixWorld); G.pos.set([_v.x, _v.y, _v.z], n * 3); G.size[n] = 0.42;
      G.col.set([tb * back, tb * back * 0.04, tb * back * 0.02], n * 3); n++;
    }
    if (on && poolOK && nc < NC && dist < 220) {
      _v.set(0, hy, -len / 2).applyMatrix4(root.matrixWorld);
      cp.set([_v.x, _v.y, _v.z, 70], nc * 4);
      cd.set([_f.x, _f.y - 0.07, _f.z, 0], nc * 4); nc++;
    }
  };
  if (on || f % 2 === 0) {
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], m = c.model; if (!m.root.visible) continue;
      pushCar(m.root, m.dims.W, m.dims.L, 0.68, (m.tail?.emissiveIntensity || 0) > 2, i === 0, i > 0 || !W.spot);
    }
    if (W.traffic) {
      carList.length = 0;
      for (const c of W.traffic.cars) if (c.active && c.m.root.visible && c.mode !== 'parked') carList.push([c.m.root.position.distanceToSquared(cam.position), c]);
      carList.sort((a, b) => a[0] - b[0]);
      for (const [, c] of carList) pushCar(c.m.root, c.wid, c.len, c.type.bus ? 0.9 : 0.66, c.braking && !c.crash, false, true);
    }
    for (let i = n; i < G.n; i++) G.col.fill(0, i * 3, i * 3 + 3);
    G.p.visible = n > 0;
    for (const a of ['position', 'aSize', 'aCol']) G.g.attributes[a].needsUpdate = true;
  }
  if (W.spot && player) {
    W.spot.intensity = on ? 90 : 0;
    if (on) {
      const r = player.model.root; r.updateMatrixWorld();
      W.spot.position.set(0, 0.72, -player.model.dims.L / 2 + 0.2).applyMatrix4(r.matrixWorld);
      W.spot.target.position.set(0, -0.4, -player.model.dims.L / 2 - 14).applyMatrix4(r.matrixWorld); W.spot.target.updateMatrixWorld();
    }
  }
  // ---- rain
  if (st.rain > 0) {
    const ru = W.rain.mat.uniforms;
    ru.uTime.value = (ru.uTime.value + dt) % 1000; ru.uCam.value.copy(cam.position); ru.uCamVel.value.copy(W.camVel);
    const amb = ENV.CU.uSkyIrr.value, k = 0.16 / Math.max(st.exposure, 0.5);
    ru.uCol.value.set(amb.x, amb.y, amb.z).multiplyScalar(k * 1.3).addScalar(st.lamps * 0.02);
    ru.uAlpha.value = 0.42 * st.rain;
    ru.uNear.value = camIn ? 1.6 : 0.6;
    // spray off the tyres
    W.spray.mat.uniforms.uScale.value = pxPerM;
    W.spray.mat.uniforms.uCol.value.copy(ru.uCol.value).multiplyScalar(1.5);
    const sprayCar = (root, wid, len, v) => {
      if (v < 7 || Math.random() > (W.low ? 0.4 : 1)) return;
      const e = root.matrixWorld.elements; _f.set(-e[8], 0, -e[10]).normalize();
      for (const sx of [-1, 1]) {
        _v.set(sx * wid * 0.4, 0.25, len / 2 - 0.4).applyMatrix4(root.matrixWorld);
        const a = Math.min(0.35, (v - 7) / 40) * st.rain;
        W.spray.emit(_v.x, _v.y, _v.z, _f.x * v * 0.35 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.6, _f.z * v * 0.35 + (Math.random() - 0.5) * 2, a);
      }
    };
    for (const c of cars) if (c.model.root.visible) sprayCar(c.model.root, c.model.dims.W, c.model.dims.L, Math.abs(c.veh.vLong));
    if (W.traffic) for (let i = 0; i < Math.min(6, carList.length); i++) { const c = carList[i][1]; if (carList[i][0] < 90 * 90) sprayCar(c.m.root, c.wid, c.len, c.v || 0); }
  }
  W.spray.update(dt);
  // ---- windscreen drops (cockpit view only)
  if (player && player.model !== W.lastModel) {
    W.lastModel = player.model;
    const ws = player.model.windscreen;
    if (W.drops) W.drops.removeFromParent();
    W.drops = null;
    if (ws && ws.geometry.attributes.uv) {
      W.drops = new THREE.Mesh(ws.geometry, W.dropMat);
      W.drops.position.copy(ws.position); W.drops.quaternion.copy(ws.quaternion); W.drops.scale.copy(ws.scale);
      W.drops.renderOrder = 8; W.drops.castShadow = false; W.drops.frustumCulled = false;
      ws.parent.add(W.drops);
    }
  }
  if (W.drops) {
    W.drops.visible = st.rain > 0 && camIn;
    const amb = ENV.CU.uSkyIrr.value, k = 0.22 / Math.max(st.exposure, 0.5);
    W.dropMat.uniforms.uAmb.value.set(amb.x, amb.y, amb.z).multiplyScalar(k).addScalar(st.lamps * 0.01);
    W.dropMat.uniforms.uRain.value = st.rain;
  }
}
