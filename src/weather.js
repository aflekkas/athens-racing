import {cockpitDropMaterial} from './cockpit-rain.js';
// Conditions in the world: what the time of day and the weather (env.js) mean for everything that isn't sky.
//  - night: street lamps lit with light pools on the road (analytic, in the road / pavement shaders: no real
//    lights), lit windows, car head / tail lamps (emissive + glow sprites; the player gets one real shadowless spot
//    light, every tier), shaped low-beam patterns on the road for the player, the rival and the nearest traffic
//  - rain: depth-tested motion streaks, wet asphalt gloss and irregular puddles, pooled tyre wake cards;
//    cockpit drops remain a separate overlay. Wet-grip physics is independent.
// API: setConditions({time, weather}) / getConditions() (plain data: events and multiplayer exchange it),
// initWeather(ctx) once the world is built (before the shaders compile), updateWeather(dt) every drawn frame.
import * as THREE from 'three';
import * as ENV from './env.js';
import { settings } from './settings.js';
import { detectPerfClass } from './graphics.js';
import { WEATHER, advanceRoadWetness } from './wet-grip.js';
import { setCarLights } from './vehicle-models.js';
import { createRain, SprayCards as Spray, rainAtlas, RAIN_BUDGET } from './rain-overlays.js';

export const setConditions = (c) => ENV.setConditions(c);
export const getConditions = () => ENV.getConditions();
if (typeof window !== 'undefined') { window.__setConditions = setConditions; window.__conditions = getConditions; }

// the player's own lamp glows live on their own layer: only the main view draws it, never the rear-view mirror pass
// (it shoots from inside our car, with the car hidden, and would see our tail lamps from behind)
export const SELF_LAYER = 3;
const NL = 12, NC = 6;       // analytic lamps / car lights evaluated per road pixel (LOW: fewer, see init)
// Wet asphalt reaches 0.76 of dry grip; road water builds and dries in wet-grip.js.
const lum = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

// ---- uniforms shared by every material the weather touches
const WXU = {
  wxOverlay: { value: rainAtlas() }, wxWet: { value: 0 }, wxRain: { value: 0 }, wxNight: { value: 0 }, wxTime: ENV.U.time,
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
uniform sampler2D wxOverlay; uniform float wxWet; uniform float wxRain; uniform float wxNight; uniform float wxTime;
uniform vec4 wxLamp[${NL}]; uniform vec3 wxLampC; uniform vec4 wxCarP[${NC}]; uniform vec4 wxCarD[${NC}]; uniform vec3 wxCarC;
varying vec3 vWxP;
float wxH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wxN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(wxH(i), wxH(i + vec2(1, 0)), u.x), mix(wxH(i + vec2(0, 1)), wxH(i + vec2(1, 1)), u.x), u.y); }
float wxPuddle = 0.0;`;
// Broad irregular wet patches, using the existing atlas and sky IBL. No reflection pass.
const WX_WET = /* glsl */`
if (wxWet > 0.0) {
  float mask = texture2D(wxOverlay, vWxP.xz * 0.035 + vec2(wxN(vWxP.xz*.09), wxN(vWxP.zx*.07))*.6).b;
  wxPuddle = mask * smoothstep(0.3, 0.8, wxWet);
  diffuseColor.rgb *= mix(1.0, 0.72, wxWet) * (1.0 - 0.12 * wxPuddle);
  roughnessFactor = mix(roughnessFactor, mix(0.48, 0.23, wxPuddle), wxWet);
}`;
// after the scene lights: street lamps (down-lights) and car headlamps (spots), lit analytically in world space
const WX_LIGHTS = /* glsl */`
if (wxNight > 0.0) {
  vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 Vw = normalize(cameraPosition - vWxP);
  for (int i = 0; i < WX_NL; i++) {
    vec4 lp = wxLamp[i]; if (lp.w <= 0.0) continue;
    vec3 Lv = lp.xyz - vWxP; float d2 = dot(Lv, Lv); vec3 Ln = Lv * inversesqrt(d2);
    float cone = smoothstep(0.5, 0.86, Ln.y);
    vec3 E = wxLampC * (lp.w * cone * saturate(dot(Nw, Ln)) / (d2 + 3.0));
    reflectedLight.directDiffuse += E * BRDF_Lambert(material.diffuseColor);
    reflectedLight.directSpecular += E * BRDF_GGX(Ln, Vw, Nw, material);
  }
  // low beams, drawn as the pattern a real lamp throws on the road (a point light grazing the asphalt would be a
  // blinding blob at the bumper and nothing at 30 m): dark under the nose, an even wide fan from ~6 m, a brighter
  // centre further out, fading past ~70 m. cp: lamp centre + strength (irradiance), cd: forward (xz) + reach (m)
  for (int i = 0; i < WX_NC; i++) {
    vec4 cp = wxCarP[i]; if (cp.w <= 0.0) continue;
    vec4 cd = wxCarD[i];
    vec3 rel = vWxP - cp.xyz; vec2 Fw = cd.xz, Rw = vec2(-Fw.y, Fw.x);
    float x = dot(rel.xz, Fw), y = dot(rel.xz, Rw), dh = -rel.y;
    if (x <= 0.5 || dh < -1.0 - 0.12 * x || dh > 3.0 + 0.12 * x) continue;
    float w = 1.3 + x * 0.5, ay = abs(y);
    float lat = 1.0 - smoothstep(0.3 * w, 1.15 * w, ay);
    float hot = exp(-ay * ay / (0.25 * w * w)) * smoothstep(5.0, 25.0, x);
    float prof = smoothstep(1.0, 6.0, x) * (1.0 - smoothstep(cd.w * 0.4, cd.w, x)) * (0.55 + 0.45 * smoothstep(4.0, 30.0, x));
    vec3 Ln = normalize(cp.xyz - vWxP);
    vec3 E = wxCarC * (cp.w * prof * lat * (0.65 + 0.45 * hot) * smoothstep(0.2, 0.6, Nw.y));
    reflectedLight.directDiffuse += E * BRDF_Lambert(material.diffuseColor);
    reflectedLight.directSpecular += E * BRDF_GGX(Ln, Vw, Nw, material) * mix(0.05, 0.45, wxWet);
  }
}`;

/** chain onto a material's existing onBeforeCompile (keeps the owner's shader, adds ours); must run before compile */
function wrap(mat, tag, fn) {
  if (mat.userData.wx) return; mat.userData.wx = tag;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); fn(sh); };
  mat.customProgramCacheKey = function () { return prevKey.call(this) + '|' + tag + (tag === 'wx-road' ? `-${W?.nl}-${W?.nc}` : ''); };
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
  // LOW / MED evaluate fewer lamps / car lights per pixel (compile-time loop counts)
  const defs = `#define WX_NL ${W ? W.nl : NL}\n#define WX_NC ${W ? W.nc : NC}\n` + (asphalt ? '#define WX_ASPHALT\n' : '');
  sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <common>', defs + '#include <common>' + WX_FS_PARS, 'road fs common');
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
// leaf / frond translucency toward the light and the foliage's fake ambient fill: scaled to the direct light
// actually there (env.js apP.z), so trees don't glow at night or under a thick deck
function leafHook(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n#ifdef USE_FOG\n#define WX_SUNK (apP.y > 0.5 ? apP.z : 1.0)\n#else\n#define WX_SUNK 1.0\n#endif')
    .replace(/totalEmissiveRadiance \+= (leafT|diffuseColor\.rgb)/g, 'totalEmissiveRadiance += WX_SUNK * $1');
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

// ---- drops on the cockpit windscreen, cleared by two wipers
function dropMaterial(){return cockpitDropMaterial(ENV.U.time);}

// ------------------------------------------------------------------ state
let W = null;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

/**
 * ctx: { renderer, scene, camera, sky, water, sun, post, probe, traffic, assets, audio, quality: 'low'|'med'|'high' (or low: bool),
 *        cars: () => [player, rival], cam: () => 'cockpit'|'chase'|'orbit' }
 * Call once the world is built and before the shaders compile (it extends the road / facade / leaf shaders).
 */
export function disposeWeather() {
  if (!W) return;
  W.offConditions?.();
  const geometries = new Set(), materials = new Set();
  for (const object of [W.lampGlow?.p, W.carGlow?.p, W.selfGlow?.p, W.rain?.mesh, W.spray?.pts, W.spot, W.spot?.target]) {
    object?.removeFromParent();
    object?.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m); });
  }
  // Windscreen geometry belongs to the car. Only the weather overlay material is ours.
  W.drops?.removeFromParent();
  if (W.dropMat) materials.add(W.dropMat);
  for (const r of [...geometries, ...materials]) r.dispose();
  W = null;
}

export function initWeather(ctx) {
  disposeWeather();
  const { scene } = ctx, q = ctx.quality || (ctx.low ? 'low' : 'high'), low = q === 'low', med = q === 'med';
  // per tier: analytic lamps / car lights per road pixel, rain streaks, spray particles; the spot light is HIGH only
  W = { ...ctx, q, low, nl: low ? 6 : med ? 8 : NL, nc: low ? 3 : med ? 4 : NC, lamps: [], lampMats: [], frame: 0, lastModel: null, drops: null, rainT: 0, prevCam: new THREE.Vector3(), camVel: new THREE.Vector3() };
  const gl = ctx.renderer.getContext(), gpu = gl.getExtension('WEBGL_debug_renderer_info');
  W.autoPerfClass = detectPerfClass(gpu ? gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL) : '');
  // -- material hooks
  const seen = new Set();
  scene.traverse((o) => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (seen.has(m)) continue; seen.add(m);
      const key = m.customProgramCacheKey && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey() : '';
      if (/^(asphalt|paving|concrete|penteli-double-solid|megara-photo-surface-v2-(asphalt|worn-asphalt))/.test(key)) wrap(m, 'wx-road', roadHook); // Road kit plus the custom Penteli and Megara asphalt
      else if (/^facade/.test(key)) wrap(m, 'wx-facade', facadeHook);
      else if (/^(leaf|frond)/.test(key) || (m.onBeforeCompile && /totalEmissiveRadiance \+= (leafT|diffuseColor\.rgb)/.test(m.onBeforeCompile.toString()))) wrap(m, 'wx-leaf', leafHook);
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
  W.selfGlow = pointsOf(4, W.glowMat); W.selfGlow.p.visible = false; W.selfGlow.p.layers.set(SELF_LAYER); scene.add(W.selfGlow.p); W.camera.layers.enable(SELF_LAYER);
  // -- the player's headlights: one real shadowless spot light on every tier (always in the scene so switching never
  // recompiles), aimed level: it lights what stands in the beam (walls, signs, cars); the road pattern is analytic
  {
    W.spot = new THREE.SpotLight(0xfff1dc, 0, 0, 0.34, 0.75, 2);
    W.spot.castShadow = false; scene.add(W.spot); scene.add(W.spot.target);
  }
  // -- rain, spray
  W.rain = createRain(); scene.add(W.rain.mesh);
  W.spray = new Spray(scene);
  W.dropMat = dropMaterial();
  W.offConditions = ENV.onConditions(apply);
  applyWeatherQuality(q);
  apply(ENV.COND, ENV.COND_STATE, true);
  return W;
}

/** Reconfigure weather effects in place; no lamp scan, world rebuild, or physics reset. */
export function applyWeatherQuality(quality) {
  if (!W) return;
  const low = quality === 'low', med = quality === 'med';
  W.q = quality; W.quality = quality; W.low = low;
  W.rainCount = low ? RAIN_BUDGET.lowStreaks : med ? 480 : RAIN_BUDGET.streaks;
  const nl = low ? 6 : med ? 8 : NL, nc = low ? 3 : med ? 4 : NC;
  if (nl !== W.nl || nc !== W.nc) {
    W.nl = nl; W.nc = nc;
    W.scene.traverse(o => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) if (m.userData.wx === 'wx-road') m.needsUpdate = true; });
  }

}

function apply(cond, st, changed) {
  if (!W) return;
  const night = st.night, lamps = st.lamps, rain = st.rain;
  // physics + effects (ground.js owns the object)
  Object.assign(WEATHER, { rain, ambient: Math.min(1, st.ambient) });
  WXU.wxWet.value = WEATHER.wet; WXU.wxRain.value = rain;
  WXU.wxNight.value = lamps > 0 || st.headlights ? 1 : 0;
  WXU.wxDay.value = Math.min(1.2, st.daylight); WXU.wxWin.value = night ? 0.5 : lamps * 0.35;
  for (let i = 0; i < W.lampMats.length; i++) W.lampMats[i].emissiveIntensity = W.lampBase[i] + 9 * lamps;
  W.lampGlow.p.visible = lamps > 0;
  for (let i = 0; i < W.lamps.length; i++) W.lampGlow.col.set([2.6 * lamps, 1.95 * lamps, 1.2 * lamps], i * 3);
  W.lampGlow.g.attributes.aCol.needsUpdate = true;
  W.lightsOn = !!st.headlights;
  // (traffic templates are shared with the parked cars, so moving traffic gets its headlamps from the glow sprites)
  W.lastLights = null; // re-apply to the racers next frame
  W.post.setConditions(st);
  if (changed) W.probe?.reset();
  W.rain.mesh.visible = rain > 0; W.spray.pts.visible = rain > 0;
  W.audio?.setWeather?.(cond.weather, rain || (st.over ? 0.3 : 0));
  W.audio?.setTimeOfDay?.(cond.time);
}

// Called once per simulation frame, independently of rendering / screenshots.
export function updateRoadWeather(dt) { advanceRoadWetness(dt, ENV.COND_STATE.rain, ENV.COND_STATE.daylight); }
const carList = [];
/** per drawn frame: lights follow the cars and the camera, rain follows the camera */
export function setOnlineWeather(online) { if (W) W.online = online; }
export function updateWeather(dt) {
  if (!W) return;
  const st = ENV.COND_STATE, cam = W.camera, f = ++W.frame;
  WXU.wxWet.value = WEATHER.wet;
  W.spray.pts.visible = !W.online && WEATHER.wet > .01;
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
  let G = W.carGlow, n = 0;
  const cp = WXU.wxCarP.value, cd = WXU.wxCarD.value; cp.fill(0);
  let nc = 0;
  const on = W.lightsOn;
  const camIn = W.cam() === 'cockpit';
  const pushCar = (root, wid, len, hy, brake, self, crispTail=false) => {
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
        _v.set(sx * wid * 0.36, hy, -len / 2 - 0.12).applyMatrix4(root.matrixWorld); G.pos.set([_v.x, _v.y, _v.z], n * 3); G.size[n] = 0.4;
        G.col.set([3.2 * front, 3.0 * front, 2.6 * front], n * 3); n++;
      }
      const tb = crispTail ? 0 : (on ? 0.45 : 0) + (brake ? 1.6 : 0);
      _v.set(sx * wid * 0.38, hy + 0.06, len / 2 + 0.1).applyMatrix4(root.matrixWorld); G.pos.set([_v.x, _v.y, _v.z], n * 3); G.size[n] = 0.3;
      G.col.set([tb * back, tb * back * 0.04, tb * back * 0.02], n * 3); n++;
    }
    if (on && nc < W.nc && dist < 260) {
      _v.set(0, hy, -len / 2).applyMatrix4(root.matrixWorld);
      const h = Math.hypot(_f.x, _f.z) || 1;
      cp.set([_v.x, _v.y, _v.z, self ? 1.0 : 0.65], nc * 4);
      cd.set([_f.x / h, 0, _f.z / h, self ? 95 : 65], nc * 4); nc++;
    }
  };
  if (on || f % 2 === 0) {
    W.selfGlow.p.visible = false;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], m = c.model; if (!m.root.visible) continue;
      if (i === 0) G = W.selfGlow; // (pushed first: its slots are the self layer's)
      pushCar(m.root, m.dims.W, m.dims.L, 0.68, (m.tail?.emissiveIntensity || 0) > 2, i === 0, m.modelKind === 'aventador');
      if (i === 0) { const S = G; for (let k = n; k < S.n; k++) S.col.fill(0, k * 3, k * 3 + 3); S.p.visible = n > 0; for (const a of ['position', 'aSize', 'aCol']) S.g.attributes[a].needsUpdate = true; G = W.carGlow; n = 0; }
    }
    if (W.traffic) {
      carList.length = 0;
      for (const c of W.traffic.cars) if (c.active && c.m.root.visible && c.mode !== 'parked') carList.push([c.m.root.position.distanceToSquared(cam.position), c]);
      carList.sort((a, b) => a[0] - b[0]);
      for (const [, c] of carList) pushCar(c.m.root, c.wid, c.len, c.type.bus ? 0.9 : 0.66, c.braking && !c.crash, false);
    }
    for (let i = n; i < G.n; i++) G.col.fill(0, i * 3, i * 3 + 3);
    G.p.visible = n > 0;
    for (const a of ['position', 'aSize', 'aCol']) G.g.attributes[a].needsUpdate = true;
  }
  if (W.spot && player) {
    W.spot.intensity = on ? 160 : 0;
    if (on) {
      const r = player.model.root; r.updateMatrixWorld();
      W.spot.position.set(0, 0.72, -player.model.dims.L / 2 + 0.2).applyMatrix4(r.matrixWorld);
      W.spot.target.position.set(0, 0.5, -player.model.dims.L / 2 - 30).applyMatrix4(r.matrixWorld); W.spot.target.updateMatrixWorld();
    }
  }
  // ---- world-space streaks: relative velocity stretches them toward a moving camera
  W.spray.begin();
  if (st.rain > 0 || WEATHER.wet > .01) {
    const ru = W.rain.mat.uniforms;
    ru.uTime.value = (ru.uTime.value + dt) % 1000;
    const amb = ENV.CU.uSkyIrr.value, k = 0.16 / Math.max(st.exposure, 0.5);
    ru.uCol.value.set(amb.x, amb.y, amb.z).multiplyScalar(k * 2.2).addScalar(st.lamps * 0.02);
    ru.uAlpha.value = 0.38 * st.rain;
    W.rain.mesh.geometry.instanceCount = Math.ceil(((settings.perfClass === 'auto' ? W.autoPerfClass : settings.perfClass) === 'potato' ? 64 : W.rainCount) * st.rain);
    ru.uVelocity.value.copy(W.camVel);
    for (let i=0;i<16;i++) ru.uLamp.value[i]=WXU.wxLamp.value[i];
    ru.uHead.value.set(W.spot.position.x,W.spot.position.y,W.spot.position.z,on ? 1 : 0);
    ru.uForward.value.subVectors(W.spot.target.position,W.spot.position).normalize();
    // spray off the tyres
    W.spray.mat.uniforms.uCol.value.copy(ru.uCol.value).multiplyScalar(.9);
    const sprayCar = (root, wid, len, v) => {
      if (W.online || v < 7) return;
      const e = root.matrixWorld.elements; _f.set(-e[8], 0, -e[10]).normalize();
      for (const sx of [-1, 1]) {
        _v.set(sx * wid * 0.4, 0.25 + v * .006, len / 2 + .35 + v * .055).applyMatrix4(root.matrixWorld);
        const a = Math.min(0.35, (v - 7) / 40) * WEATHER.wet;
        W.spray.add(_v.x, _v.y, _v.z, v, a);
      }
    };
    for (const c of cars) if (c.model.root.visible) sprayCar(c.model.root, c.model.dims.W, c.model.dims.L, Math.abs(c.veh.vLong));
    if (W.traffic) for (let i = 0; i < Math.min(6, carList.length); i++) { const c = carList[i][1]; if (carList[i][0] < 90 * 90) sprayCar(c.m.root, c.wid, c.len, c.v || 0); }
  }
  W.spray.update(dt);
  // ---- windscreen drops (cockpit view only)
  if (player && player.model !== W.lastModel) {
    W.lastModel = player.model;
    const ws = player.model.cockpitWindscreen || player.model.windscreen;
    if (W.drops) W.drops.removeFromParent();
    W.drops = null;
    if (ws && ws.geometry.attributes.uv) {
      W.drops = new THREE.Mesh(ws.geometry, W.dropMat);
      W.drops.position.copy(ws.position); W.drops.quaternion.copy(ws.quaternion); W.drops.scale.copy(ws.scale);
      W.drops.renderOrder = 8; W.drops.castShadow = false; W.drops.frustumCulled = false;
      (ws.parent || player.model.body).add(W.drops);
    }
  }
  player?.model.updateCockpitWipers?.(ENV.U.time.value,st.rain>0&&camIn);
  if (W.drops) {
    W.drops.visible = st.rain > 0 && camIn;
    const amb = ENV.CU.uSkyIrr.value, k = 0.22 / Math.max(st.exposure, 0.5);
    W.dropMat.uniforms.uAmb.value.set(amb.x, amb.y, amb.z).multiplyScalar(k).addScalar(st.lamps * 0.01);
    W.dropMat.uniforms.uRain.value = st.rain;
    W.dropMat.uniforms.uSpeed.value = Math.abs(player.veh.vLong);
    W.dropMat.uniforms.uHasWipers.value = player.model.updateCockpitWipers ? 1 : 0;
  }
}
