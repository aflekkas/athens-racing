// Physically based environment: a Rayleigh + Mie + ozone single-scattering atmosphere (evaluated in JS for the
// sun's colour and the horizon haze, and on the GPU for the sky), a cloud layer, image-based lighting baked from
// that sky, aerial perspective injected into every material's fog chunk, and the sea (planar reflections,
// photographic wave normals, real bathymetry, clear-water seabed with caustics, shore foam).
import * as THREE from 'three';
import { TX } from './tex.js';

export const U = { time: { value: 0 } };

// ---------------------------------------------------------------- conditions: time of day + weather
// Each time of day is a light source (the sun, or the moon at night) at a real compass position over the Riviera
// (the coast runs NW-SE with the Saronic Gulf to the south-west): the sun comes up over Hymettus inland, sets over
// the gulf. E scales the source (moonlight is ~1/170 of sunlight here: stylised so the night stays readable).
// Exposure adapts partially to the light level, so a sunset is darker than noon and the night stays dark.
export const TIMES = {
  dawn: { elev: 4.5, az: 80, E: 1, bias: 1.0, wb: [1.0, 0.98, 1.04], lamps: 0.25 },
  day: { elev: 62, az: 205, E: 1, bias: 1.0, wb: [0.96, 1.0, 1.06] },
  afternoon: { elev: 21, az: 250, E: 1, bias: 1.0, wb: [0.96, 1.0, 1.06] }, // the original look (default)
  sunset: { elev: 2.4, az: 282, E: 1, bias: 1.05, wb: [1.0, 0.97, 0.98], lamps: 0.35 },
  night: { elev: 34, az: 140, E: 0.006, bias: 0.62, wb: [0.9, 0.98, 1.16], night: 1, lamps: 1, tint: [0.55, 0.72, 1.0] },
};
// over: overcast cover, T: light through the cloud deck, haze: extra aerial extinction (visibility), rain intensity
export const WEATHERS = {
  clear: { over: 0, T: 1, haze: 1, rain: 0 },
  overcast: { over: 1, T: 0.36, haze: 3, rain: 0 },
  rain: { over: 1, T: 0.22, haze: 30, rain: 1 },
};
const Qp = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
/** the current conditions as plain data (what events and multiplayer exchange) */
export const COND = { time: TIMES[Qp.get('tod')] ? Qp.get('tod') : 'afternoon', weather: WEATHERS[Qp.get('wx')] ? Qp.get('wx') : 'clear' };
// derived state the rest of the game reads (updated in place)
export const COND_STATE = { night: 0, over: 0, rain: 0, exposure: 1, ambient: 1, glare: 1, bloom: 1, wb: [0.96, 1, 1.06], daylight: 1, lamps: 0, headlights: 0 };

export let SUN_ELEV = TIMES[COND.time].elev, SUN_AZ = TIMES[COND.time].az;
const dirFromAngles = (elev, az, out = new THREE.Vector3()) => {
  const el = THREE.MathUtils.degToRad(elev), a = THREE.MathUtils.degToRad(az);
  // compass azimuth -> world (x east, z south)
  return out.set(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)).normalize();
};
/** direction to the key light (sun, or the moon at night): mutated in place when the conditions change */
export const sunDir = dirFromAngles(SUN_ELEV, SUN_AZ);
export const REFLECT_LAYER = 1, PROBE_LAYER = 2;
// Athens (and Glyfada, along the coast) glow over the hills to the north-north-west at night
const GLOW_DIR = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(332)), 0, -Math.cos(THREE.MathUtils.degToRad(332)));

// ---------------------------------------------------------------- atmosphere model (shared constants)
const RE = 6360e3, RA = 6420e3, HR = 8000, HM = 1200;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];
const BMS = 2.3e-5, BME = BMS * 1.11; // summer coastal haze (about 6x a clean standard atmosphere)
const BO = [0.65e-6, 1.881e-6, 0.085e-6];
const MIE_G = 0.76;
const E_SUN = 6.2; // top-of-atmosphere solar irradiance in scene units
const GROUND_ALBEDO = 0.13;

function raySphere(o, d, r) { const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2]; const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r; const D = b * b - c; if (D < 0) return null; const s = Math.sqrt(D); return [-b - s, -b + s]; }
function dens(h) { return [Math.exp(-h / HR), Math.exp(-h / HM), Math.max(0, 1 - Math.abs(h - 25000) / 15000)]; }
function odToSun(p, L, n = 10) {
  const t = raySphere(p, L, RA); if (!t) return [0, 0, 0];
  const g = raySphere(p, L, RE); if (g && g[0] > 0) return null;
  const dl = t[1] / n; const od = [0, 0, 0];
  for (let j = 0; j < n; j++) { const q = [p[0] + L[0] * (j + 0.5) * dl, p[1] + L[1] * (j + 0.5) * dl, p[2] + L[2] * (j + 0.5) * dl]; const h = Math.hypot(...q) - RE; const d = dens(h); od[0] += d[0] * dl; od[1] += d[1] * dl; od[2] += d[2] * dl; }
  return od;
}
const ext = (od) => [0, 1, 2].map((c) => BR[c] * od[0] + BME * od[1] + BO[c] * od[2]);
/** sky radiance (single scattering + a multiple-scattering estimate) for a view direction, camera at sea level */
function skyJS(d, L, n = 24) {
  const o = [0, RE + 50, 0];
  const t = raySphere(o, d, RA); let tmax = t[1];
  const g = raySphere(o, d, RE); if (g && g[0] > 0) tmax = g[0];
  const dt = tmax / n; const odV = [0, 0, 0]; const sR = [0, 0, 0], sM = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = [o[0] + d[0] * (i + 0.5) * dt, o[1] + d[1] * (i + 0.5) * dt, o[2] + d[2] * (i + 0.5) * dt];
    const h = Math.hypot(...p) - RE; const dd = dens(h);
    odV[0] += dd[0] * dt * 0.5; odV[1] += dd[1] * dt * 0.5; odV[2] += dd[2] * dt * 0.5;
    const odL = odToSun(p, L, 6);
    if (odL) { const e = ext([odV[0] + odL[0], odV[1] + odL[1], odV[2] + odL[2]]); for (let c = 0; c < 3; c++) { const T = Math.exp(-e[c]); sR[c] += T * dd[0] * dt; sM[c] += T * dd[1] * dt; } }
    odV[0] += dd[0] * dt * 0.5; odV[1] += dd[1] * dt * 0.5; odV[2] += dd[2] * dt * 0.5;
  }
  const mu = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
  const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const gg = MIE_G * MIE_G, pM = 3 / (8 * Math.PI) * ((1 - gg) * (1 + mu * mu)) / ((2 + gg) * Math.pow(1 + gg - 2 * MIE_G * mu, 1.5));
  return [0, 1, 2].map((c) => E_SUN * (sR[c] * BR[c] * (pR + MS_K / (4 * Math.PI)) + sM[c] * BMS * (pM + MS_K / (4 * Math.PI))));
}
const MS_K = 0.45; // isotropic multiple-scattering boost (brightens the horizon, desaturates the haze)

const ANG = [0, 4, 9, 16, 26, 40, 60, 90, 125, 180];
function computeAtmosphere(Ldir, k = 1) {
  const L = [Ldir.x, Ldir.y, Ldir.z];
  const od = odToSun([0, RE + 50, 0], L, 40);
  const Tsun = od ? ext(od).map((e) => Math.exp(-e)) : [0, 0, 0];
  const sunIrr = Tsun.map((t) => t * E_SUN * k); // on a surface facing the sun
  // sky irradiance on a horizontal surface (cosine-weighted hemisphere)
  const skyIrr = [0, 0, 0]; let N = 0;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) {
    const el = (i + 0.5) / 6 * Math.PI / 2, az = (j + 0.5) / 12 * Math.PI * 2;
    const d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const l = skyJS(d, L, 16); const w = Math.sin(el) * Math.cos(el);
    for (let c = 0; c < 3; c++) skyIrr[c] += l[c] * w * k; N += w;
  }
  for (let c = 0; c < 3; c++) skyIrr[c] = skyIrr[c] / N * Math.PI;
  // horizon radiance (2 deg up) vs angle from the sun's azimuth: the colour distant things fade into
  const sunAz = Math.atan2(L[2], L[0]);
  const horizon = ANG.map((a) => { const az = sunAz + a * Math.PI / 180, el = 2 * Math.PI / 180; return skyJS([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], L, 32).map((x) => x * k); });
  const zenith = skyJS([0, 1, 0], L, 24).map((x) => x * k);
  return { Tsun, sunIrr, skyIrr, horizon, ANG, zenith };
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
// reference light level for the exposure: the original late-afternoon look is exposure 1
const REF = (() => { const a = computeAtmosphere(dirFromAngles(21, 250)); return lum(a.sunIrr) * Math.sin(THREE.MathUtils.degToRad(21)) + lum(a.skyIrr); })();

/** everything the shaders and lights need for the current conditions */
function deriveConditions() {
  const T = TIMES[COND.time], W = WEATHERS[COND.weather];
  SUN_ELEV = T.elev; SUN_AZ = T.az; dirFromAngles(T.elev, T.az, sunDir);
  const A = computeAtmosphere(sunDir, T.E);
  const night = T.night || 0, over = W.over;
  // the underside of an overcast deck: diffuse light through the cloud, a little desaturated
  const ghi = A.sunIrr.map((s, c) => s * Math.max(sunDir.y, 0.04) + A.skyIrr[c]);
  let oc = ghi.map((x) => x * W.T / Math.PI);
  const ol = lum(oc); oc = oc.map((x) => ol + (x - ol) * 0.55);
  // city light pollution (sodium / LED orange) under the night sky
  const glow = night ? [0.011, 0.0062, 0.003] : [0, 0, 0];
  const out = {
    A,
    sunLight: A.sunIrr.map((x) => x * (1 - over * (1 - W.T * 0.35))), // what still reaches the ground as a direct beam
    skyIrr: mix3(A.skyIrr, oc.map((x, c) => x * Math.PI + glow[c] * 1.2), over),
    horizon: A.horizon.map((h) => mix3(h, oc.map((x, c) => x * 0.92 + glow[c]), over * 0.93)),
    oc, glow, night, over, rain: W.rain, haze: W.haze,
  };
  if (night) out.skyIrr = out.skyIrr.map((x, c) => x + glow[c] * 0.8 * (1 - over));
  const E = lum(out.sunLight) * Math.max(sunDir.y, 0) + lum(out.skyIrr);
  // partial adaptation: darker scenes are brought up, but not all the way
  const exposure = THREE.MathUtils.clamp(Math.pow(REF / Math.max(E, 1e-6), 0.62), 0.55, 9) * T.bias;
  Object.assign(COND_STATE, {
    night, over, rain: W.rain, exposure, daylight: E / REF, lamps: T.lamps || 0, headlights: T.lamps || W.rain ? 1 : 0,
    ambient: THREE.MathUtils.clamp(E * exposure / REF, 0.02, 1.2), // how lit unlit (sprite) effects should look
    glare: (night ? 0.15 : 1) * (1 - over * 0.95),
    bloom: night ? 1.5 : 1 + over * 0.2,
    wb: T.wb,
  });
  return out;
}
let D = deriveConditions();
/** live atmosphere values (sunIrr, skyIrr, horizon, zenith) for the current conditions */
export let ATMO = D.A;
export let SUN_INTENSITY = lum(D.sunLight);
export const SUN_COLOR = new THREE.Color();
// the key light's colour; moonlight is tinted blue (how night vision sees it)
const setSunColor = () => { const t = TIMES[COND.time].tint || [1, 1, 1], c = D.sunLight.map((x, i) => x * t[i]), s = Math.max(lum(c), 1e-6); SUN_COLOR.setRGB(c[0] / s, c[1] / s, c[2] / s); };
setSunColor();
const v3 = (a) => `vec3(${a.map((x) => x.toFixed(6)).join(',')})`;
const f1 = (x) => x.toExponential(5);

// ---- shared uniforms. Built-in materials get theirs from ShaderLib, which three clones per material; a typed
// array value survives that clone by reference, so updating these arrays updates the fog of every material at once.
const AP = {
  apHz: { value: new Float32Array(30) }, // horizon radiance table (10 x vec3, by angle from the sun's azimuth)
  apSun: { value: new Float32Array(3) },
  apQ: { value: new Float32Array([0.000075, 240, 1]) }, // sea-level aerosol density / scale height / enabled
  apP: { value: new Float32Array(3) },   // x: haze (extinction) multiplier, y: 1 = uniforms present, z: sun-translucency scale
  apGlowC: { value: new Float32Array(3) }, apGlowD: { value: new Float32Array([GLOW_DIR.x, 0, GLOW_DIR.z]) },
};
for (const sh of Object.values(THREE.ShaderLib)) if (sh.uniforms && sh.uniforms.fogColor) Object.assign(sh.uniforms, AP);
Object.assign(THREE.UniformsLib.fog, AP);
export const AP_UNIFORMS = AP;
// uniforms of the env's own shaders (sky, atmosphere bake, sea, the LOW-tier sky / sea)
export const CU = {
  uSunIrr: { value: new THREE.Vector3() }, uSkyIrr: { value: new THREE.Vector3() }, uSunE: { value: new THREE.Vector3() },
  uOcCol: { value: new THREE.Vector3() }, uOver: { value: 0 }, uRain: { value: 0 }, uNight: { value: 0 }, uE: { value: 1 },
  uGlowC: { value: new THREE.Vector3() }, uGlowD: { value: GLOW_DIR.clone() }, uSeaBody: { value: new THREE.Vector3(0.018, 0.13, 0.18) },
};
function writeUniforms() {
  const A = D.A;
  for (let i = 0; i < 10; i++) for (let c = 0; c < 3; c++) AP.apHz.value[i * 3 + c] = D.horizon[i][c];
  AP.apSun.value.set([sunDir.x, sunDir.y, sunDir.z]);
  // leaf / frond translucency toward the light is scaled to the light actually there (none under a thick deck)
  AP.apP.value.set([D.haze, 1, THREE.MathUtils.clamp(lum(D.sunLight) / Math.max(lum(ATMO0.sunIrr), 1e-6), 0, 1.3)]);
  AP.apGlowC.value.set(D.glow.map((x) => x * (1 + D.over * 1.5)));
  CU.uSunIrr.value.fromArray(A.sunIrr); CU.uSkyIrr.value.fromArray(D.skyIrr); CU.uSunE.value.fromArray(D.sunLight);
  CU.uOcCol.value.fromArray(D.oc); CU.uOver.value = D.over; CU.uRain.value = D.rain; CU.uNight.value = D.night; CU.uE.value = TIMES[COND.time].E;
  CU.uGlowC.value.fromArray(D.glow);
  // LOW-tier sea body colour: scaled to the light on the water
  const k = (lum(D.sunLight) * Math.max(sunDir.y, 0) + lum(D.skyIrr)) / REF;
  CU.uSeaBody.value.set(0.018, 0.13, 0.18).multiplyScalar(THREE.MathUtils.clamp(k, 0, 1.4));
}
const ATMO0 = computeAtmosphere(dirFromAngles(21, 250));
writeUniforms();

/** GLSL: aerial perspective (transmittance + in-scattering toward the horizon colour). Reads the shared condition
 *  uniforms; materials without them (custom shaders) fall back to the boot-time constants. */
export const AERIAL_GLSL = /* glsl */`
  uniform vec3 apHz[10]; uniform vec3 apSun; uniform vec3 apQ; uniform vec3 apP; uniform vec3 apGlowC; uniform vec3 apGlowD;
  const vec3 AP_SUN0 = ${v3([sunDir.x, sunDir.y, sunDir.z])};
  const vec3 AP_BR = vec3(${BR.map(f1).join(',')});
  const float AP_BM = ${f1(BME)};
  float apOD(float h0, float dy, float d, float H){ h0 = max(h0, 0.0); float a = exp(-h0 / H); float k = dy / H; float x = k * d; if (abs(x) < 1e-3) return a * d; return a * (1.0 - exp(-clamp(x, -30.0, 30.0))) / k; }
  vec3 apHorizon0(vec3 dir){
    vec2 hd = normalize(dir.xz + vec2(1e-5)); vec2 sd = normalize(AP_SUN0.xz);
    float a = degrees(acos(clamp(dot(hd, sd), -1.0, 1.0)));
    ${ANG.slice(1).map((A, i) => `if (a < ${A.toFixed(1)}) return mix(${v3(D.horizon[i])}, ${v3(D.horizon[i + 1])}, (a - ${ANG[i].toFixed(1)}) / ${(A - ANG[i]).toFixed(1)});`).join('\n    ')}
    return ${v3(D.horizon[D.horizon.length - 1])};
  }
  vec3 apHorizon(vec3 dir){
    if (apP.y < 0.5) return apHorizon0(dir);
    vec2 hd = normalize(dir.xz + vec2(1e-5)); vec2 sd = normalize(apSun.xz + vec2(1e-5));
    float a = degrees(acos(clamp(dot(hd, sd), -1.0, 1.0)));
    vec3 h;
    ${ANG.slice(1).map((A, i) => `${i ? 'else ' : ''}if (a < ${A.toFixed(1)}) h = mix(apHz[${i}], apHz[${i + 1}], (a - ${ANG[i].toFixed(1)}) / ${(A - ANG[i]).toFixed(1)});`).join('\n    ')}
    else h = apHz[9];
    // city glow on the northern horizon at night
    h += apGlowC * (0.3 + 1.7 * pow(max(dot(hd, apGlowD.xz), 0.0), 3.0));
    return h;
  }
  vec3 aerial(vec3 col, vec3 off, float camY){
    float d = length(off); vec3 dir = off / max(d, 1e-4); d = min(d, 80000.0);
    vec3 od = AP_BR * apOD(camY, dir.y, d, ${HR.toFixed(1)}) + AP_BM * apOD(camY, dir.y, d, ${HM.toFixed(1)}) * (apP.y > 0.5 ? apP.x : 1.0);
    // Coastal boundary layer: height-integrated, weather-scaled, with the live angular sky radiance.
    if (apP.y > 0.5 && apQ.z > 0.5) od += vec3(apQ.x * apOD(camY, dir.y, d, max(apQ.y, 1.0)) * sqrt(max(apP.x, 1.0)));
    vec3 T = exp(-od * AP_K);
    return col * T + apHorizon(dir) * (1.0 - T);
  }
`;
/** install the aerial perspective as the fog of every built-in / onBeforeCompile material */
export function installAerial(k = 1.0) {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogOff;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z; vFogOff = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG\n uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogOff;\n #ifdef FOG_EXP2\n uniform float fogDensity;\n #else\n uniform float fogNear; uniform float fogFar;\n #endif\n const float AP_K = ${k.toFixed(3)};\n${AERIAL_GLSL}\n#endif`;
  C.fog_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = aerial(gl_FragColor.rgb, vFogOff, cameraPosition.y);\n#endif';
}
export const AP_K = 1.25;

// ---------------------------------------------------------------- sky
const ATMO_FRAG = /* glsl */`
  #ifndef PI
  #define PI 3.141592653589793
  #endif
  uniform vec3 uSun; uniform float uE; uniform vec3 uSunIrr; uniform vec3 uSkyIrr; varying vec3 vDir;
  const float RE = ${RE.toFixed(1)}, RA = ${RA.toFixed(1)};
  const vec3 BR = vec3(${BR.map(f1).join(',')}); const float BMS = ${f1(BMS)}, BME = ${f1(BME)};
  const vec3 BO = vec3(${BO.map(f1).join(',')});
  vec2 rs(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r * r, D = b * b - c; if (D < 0.0) return vec2(-1.0); D = sqrt(D); return vec2(-b - D, -b + D); }
  vec3 dens(float h){ return vec3(exp(-h / ${HR.toFixed(1)}), exp(-h / ${HM.toFixed(1)}), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0)); }
  vec3 ex(vec3 od){ return BR * od.x + BME * od.y + BO * od.z; }
  void main(){
    vec3 d = normalize(vDir); vec3 L = normalize(uSun);
    vec3 o = vec3(0.0, RE + 50.0, 0.0);
    float tmax = rs(o, d, RA).y; vec2 g = rs(o, d, RE); bool ground = g.x > 0.0; if (ground) tmax = g.x;
    const int N = 40; float dt = tmax / float(N);
    vec3 odV = vec3(0.0), sR = vec3(0.0), sM = vec3(0.0);
    for (int i = 0; i < N; i++){
      vec3 p = o + d * (float(i) + 0.5) * dt; float h = length(p) - RE; vec3 dd = dens(h) * dt;
      odV += dd * 0.5;
      vec2 tl = rs(p, L, RA); vec2 tg = rs(p, L, RE);
      if (tg.x < 0.0) {
        float dl = tl.y / 10.0; vec3 odL = vec3(0.0);
        for (int j = 0; j < 10; j++){ vec3 q = p + L * (float(j) + 0.5) * dl; odL += dens(length(q) - RE) * dl; }
        vec3 T = exp(-ex(odV + odL));
        sR += T * dd.x; sM += T * dd.y;
      }
      odV += dd * 0.5;
    }
    float mu = dot(d, L);
    float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float gg = ${MIE_G * MIE_G}; float pM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * ${MIE_G} * mu, 1.5));
    vec3 col = uE * ${E_SUN.toFixed(3)} * (sR * BR * (pR + ${MS_K} / (4.0 * PI)) + sM * BMS * (pM + ${MS_K} / (4.0 * PI)));
    if (ground) {
      vec3 Tv = exp(-ex(odV));
      col += Tv * ${GROUND_ALBEDO} / PI * (uSunIrr * max(L.y, 0.0) + uSkyIrr);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const CLOUD_GLSL = /* glsl */`
  uniform vec3 uSunIrr; uniform vec3 uSkyIrr; uniform vec3 uOcCol; uniform float uOver; uniform float uRain; uniform float uNight;
  uniform vec3 uGlowC; uniform vec3 uGlowD;
  float ch(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float cn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
    return mix(mix(ch(i), ch(i + vec2(1, 0)), u.x), mix(ch(i + vec2(0, 1)), ch(i + vec2(1, 1)), u.x), u.y); }
  float cfbm(vec2 p, int oct){ float s = 0., a = .5; for (int i = 0; i < 6; i++){ if (i >= oct) break; s += a * cn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 7.7); a *= .5; } return s; }
  // city glow lighting the sky (and cloud bases) from below, strongest toward Athens
  vec3 cityGlow(vec3 d){ vec2 hd = normalize(d.xz + vec2(1e-5)); return uGlowC * (0.3 + 1.7 * pow(max(dot(hd, uGlowD.xz), 0.0), 3.0)); }
  // returns (rgb radiance, alpha)
  vec4 clouds(vec3 d, vec3 L, float time){
    if (d.y < 0.004) return vec4(0.0);
    // cumulus humilis layer at 1.6 km, cirrus at 8 km
    float t1 = 1600.0 / d.y; vec2 p1 = d.xz * t1 * 0.00042 + vec2(time * 0.0016, time * 0.0007);
    float base = cfbm(p1 * 0.35, 3);
    float cov = smoothstep(0.42, 0.75, base); // patchy: mostly clear
    float n1 = cfbm(p1 * 1.6, 6);
    float den = clamp((n1 - 0.62 + 0.45 * cov) * 3.2, 0.0, 1.0) * cov;
    float lit = cfbm(p1 * 1.6 + L.xz * 0.35, 4);
    float shade = clamp((lit - n1) * 2.5 + 0.55, 0.15, 1.0);
    float mu = dot(d, L);
    vec3 sunL = uSunIrr * (uNight > 0.5 ? 0.45 : 1.15);
    vec3 amb = uSkyIrr + cityGlow(d) * 6.0;
    vec3 cu = (sunL * (0.34 + 0.9 * pow(max(mu, 0.0), 6.0)) * shade + amb * 0.32) * 0.9;
    float a1 = den * smoothstep(0.004, 0.05, d.y);
    // cirrus
    float t2 = 8000.0 / d.y; vec2 p2 = d.xz * t2 * 0.00009 + vec2(time * 0.0009, 0.0);
    float ci = cfbm(p2 * vec2(1.0, 4.0), 5);
    float ac = smoothstep(0.55, 0.85, ci) * 0.42 * smoothstep(0.02, 0.2, d.y) * (0.6 + 0.4 * cn(p2 * 0.3));
    vec3 cc = sunL * (0.3 + 1.1 * pow(max(mu, 0.0), 10.0)) + amb * 0.35;
    // aerial fade toward the horizon
    float fade = exp(-t1 * 0.000018);
    vec3 col = mix(cc, cu, a1 / max(a1 + ac * (1.0 - a1), 1e-4));
    float a = 1.0 - (1.0 - a1) * (1.0 - ac);
    return vec4(col, a * fade);
  }
  // a solid stratus / nimbostratus deck: lumpy grey bases, darker and lower in rain
  vec4 overcast(vec3 d, float time){
    float y = max(d.y, 0.02);
    vec2 p = d.xz / y * (uRain > 0.5 ? 0.9 : 0.6) + vec2(time * 0.004, time * 0.0016);
    float n = cfbm(p, 5), n2 = cfbm(p * 3.1 + 4.0, 4);
    vec3 c = uOcCol * (0.72 + 0.5 * n - 0.18 * n2 * (0.5 + uRain)) + cityGlow(d) * 3.0;
    // brighter toward the hidden sun
    c *= 1.0 + 0.35 * pow(max(dot(normalize(vec3(d.x, y, d.z)), normalize(uSunDir)), 0.0), 4.0) * (1.0 - uRain * 0.6);
    return vec4(c, uOver * smoothstep(-0.06, 0.02, d.y));
  }
  float stars(vec3 d){
    if (d.y < 0.0) return 0.0;
    vec3 q = d * 260.0; vec3 i = floor(q); vec3 f = fract(q) - 0.5;
    float h = ch(i.xy * 1.7 + i.z * 13.1);
    float s = smoothstep(0.985, 1.0, h) * smoothstep(0.22, 0.0, length(f));
    return s * smoothstep(0.02, 0.25, d.y) * (0.4 + 0.6 * ch(i.zx + 3.3));
  }`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: sunDir }, uTime: U.time, uAtmo: { value: null }, uEnv: { value: 0 }, ...CU },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir; uniform float uTime; uniform samplerCube uAtmo; uniform float uEnv;
      varying vec3 vDir;
      ${CLOUD_GLSL}
      void main(){
        vec3 d = normalize(vDir); vec3 L = normalize(uSunDir);
        vec3 col = textureCube(uAtmo, d).rgb;
        float mu = dot(d, L);
        // night: stars (washed out toward the city glow) and the glow itself
        if (uNight > 0.5) {
          vec3 g = cityGlow(d) * exp(-max(d.y, 0.0) * 9.0);
          col += g;
          col += vec3(0.9, 0.95, 1.0) * stars(d) * 0.05 * (1.0 - uOver) / (1.0 + dot(g, vec3(400.0)));
        }
        if (uEnv < 0.5) {
          // sun (or moon) disc with limb darkening (radiance clamped to what a half-float target can hold)
          float r = acos(clamp(mu, -1.0, 1.0)) / (uNight > 0.5 ? 0.0055 : 0.00465);
          float disc = 1.0 - smoothstep(0.92, 1.0, r);
          float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0))));
          col += uSunIrr * disc * limb * (uNight > 0.5 ? 1500.0 : 900.0);
        }
        vec4 c = clouds(d, L, uTime);
        col = mix(col, c.rgb, c.a * (1.0 - uOver));
        if (uOver > 0.0) { vec4 o = overcast(d, uTime); col = mix(col, o.rgb, o.a); }
        if (uEnv > 0.5) col = min(col, vec3(40.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -1000;
  // not in REFLECT_LAYER: the sea takes the sky from the baked cube (the xyww dome doesn't survive oblique clipping);
  // the car reflection probe sees it on PROBE_LAYER
  sky.layers.enable(PROBE_LAYER);
  return sky;
}

// the baked sky lives in fixed render targets: a change of conditions re-renders into the same textures, so the
// sea, scene.environment, the LOW-tier sky and the car probe all follow without being re-wired
const BAKE = { renderer: null, sky: null, atmoRT: null, envRT: null, pmremRT: null, atmoMat: null, s1: null, s2: null };
export function bakeSky(renderer, sky) {
  // 1. the clear atmosphere into a cube (expensive shader, done once per change of conditions)
  if (!BAKE.atmoRT) {
    // keep the full sky material for baking: LOW (graphics.js) swaps the visible dome for a cube lookup
    BAKE.renderer = renderer; BAKE.sky = sky; BAKE.skyMat = sky.material;
    BAKE.atmoRT = new THREE.WebGLCubeRenderTarget(192, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    BAKE.atmoMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir }, uE: CU.uE, uSunIrr: CU.uSunIrr, uSkyIrr: CU.uSkyIrr }, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: ATMO_FRAG,
    });
    BAKE.s1 = new THREE.Scene(); BAKE.s1.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), BAKE.atmoMat));
    // 2. sky + clouds (no sun disc) for image-based lighting and sea reflections
    BAKE.envRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    BAKE.s2 = new THREE.Scene(); const s = sky.clone(); s.material = BAKE.skyMat; s.position.set(0, 0, 0); BAKE.s2.add(s);
  }
  new THREE.CubeCamera(0.1, 100, BAKE.atmoRT).update(renderer, BAKE.s1);
  const su = BAKE.skyMat.uniforms;
  su.uAtmo.value = BAKE.atmoRT.texture;
  su.uEnv.value = 1;
  new THREE.CubeCamera(1, 20000, BAKE.envRT).update(renderer, BAKE.s2);
  su.uEnv.value = 0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  BAKE.pmremRT = pmrem.fromCubemap(BAKE.envRT.texture, BAKE.pmremRT);
  pmrem.dispose();
  return { cube: BAKE.envRT.texture, env: BAKE.pmremRT.texture, atmo: BAKE.atmoRT.texture };
}

let SUN = null;
export function createLights(scene) {
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const S = SHADOW_HALF;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 900 });
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3; sun.shadow.blurSamples = 12;
  scene.add(sun); scene.add(sun.target);
  SUN = sun;
  return { sun };
}

const listeners = [];
/** called with (COND, COND_STATE) after every change of conditions */
export function onConditions(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
/**
 * Change the time of day and / or the weather: {time: 'dawn'|'day'|'afternoon'|'sunset'|'night', weather: 'clear'|'overcast'|'rain'}.
 * Re-derives the atmosphere, light and fog, re-bakes the sky cube and image-based light (a few ms on a GPU) and
 * notifies listeners (weather.js: lights, rain, wet roads). Returns the plain conditions.
 */
export function setConditions(c = {}) {
  const time = TIMES[c.time] ? c.time : COND.time, weather = WEATHERS[c.weather] ? c.weather : COND.weather;
  const changed = time !== COND.time || weather !== COND.weather;
  COND.time = time; COND.weather = weather;
  if (changed) {
    D = deriveConditions(); ATMO = D.A; SUN_INTENSITY = lum(D.sunLight); setSunColor();
    writeUniforms();
    if (BAKE.renderer) bakeSky(BAKE.renderer, BAKE.sky);
  }
  if (SUN) { SUN.color.copy(SUN_COLOR); SUN.intensity = SUN_INTENSITY; }
  for (const fn of listeners) fn(COND, COND_STATE, changed);
  return { ...COND };
}
export function getConditions() { return { ...COND }; }
/** the baked sky cube (sky + clouds, no sun disc) for the current conditions */
export function bakedSky() { return BAKE.envRT ? BAKE.envRT.texture : null; }
const SHADOW_HALF = 95;
const _m4 = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
export function updateSun(sun, center) {
  const texel = (SHADOW_HALF * 2) / 4096;
  sun.position.copy(center).addScaledVector(sunDir, 420);
  sun.target.position.copy(center);
  _m4.lookAt(sun.position, sun.target.position, _up);
  _inv.copy(_m4).invert();
  _p.copy(center).applyMatrix4(_inv);
  _p.x = Math.round(_p.x / texel) * texel; _p.y = Math.round(_p.y / texel) * texel;
  _p.applyMatrix4(_m4).sub(center);
  sun.position.add(_p); sun.target.position.add(_p);
  sun.target.updateMatrixWorld();
}

/** Bathymetry texture from the terrain grid (0..25.5 m water depth) */
export function makeDepthTexture(terrain) {
  const { GX, GZ, H } = terrain;
  const d = new Uint8Array(GX * GZ);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(255, Math.round(-H[i] * 10)));
  const t = new THREE.DataTexture(d, GX, GZ, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- sea
export function createWater(skyCube, terrain, depthTex) {
  const geo = new THREE.PlaneGeometry(80000, 80000, 1, 1); geo.rotateX(-Math.PI / 2);
  const reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
  const uniforms = {
    uTime: U.time, uSunDir: { value: sunDir },
    uSky: { value: skyCube }, tRefl: { value: reflRT.texture }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
    tDepth: { value: depthTex }, uGrid: { value: new THREE.Vector4(terrain.minX, terrain.minZ, (terrain.GX - 1) * terrain.T, (terrain.GZ - 1) * terrain.T) },
    uLake: { value: 0 }, tWN: { value: TX.water }, tSand: { value: TX.sand_diff }, tRock: { value: TX.rock_diff },
    ...AP, uSunE: CU.uSunE, uSkyIrr: CU.uSkyIrr, uRain: CU.uRain,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSunDir; uniform samplerCube uSky;
      uniform sampler2D tRefl; uniform mat4 uReflMat; uniform float uReflOn; uniform sampler2D tDepth; uniform vec4 uGrid; uniform float uLake;
      uniform sampler2D tWN; uniform sampler2D tSand; uniform sampler2D tRock; uniform vec3 uSunE; uniform vec3 uSkyIrr; uniform float uRain;
      varying vec3 vWorld;
      #ifndef PI
      #define PI 3.141592653589793
      #endif
      const float AP_K = ${AP_K.toFixed(3)};
      ${AERIAL_GLSL}
      float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      // animated caustics: two warped cellular-ish interference patterns
      float caustic(vec2 p, float t){
        vec2 q = p * 0.9;
        float c = 0.0;
        for (int i = 0; i < 3; i++){
          float fi = float(i);
          q += vec2(sin(q.y * 1.3 + t * (0.6 + fi * 0.2)), cos(q.x * 1.1 - t * (0.5 + fi * 0.15))) * 0.45;
          c += abs(sin(q.x + fi) * sin(q.y * 1.1 - fi));
        }
        return pow(1.0 - c / 3.0, 5.0);
      }
      void main(){
        vec3 Vd = cameraPosition - vWorld; float dist = length(Vd); vec3 V = Vd / dist;
        vec2 p = vWorld.xz;
        vec2 guv = (p - uGrid.xy) / uGrid.zw;
        float inGrid = step(0.0, guv.x) * step(guv.x, 1.0) * step(0.0, guv.y) * step(guv.y, 1.0);
        float depth = mix(40.0, texture2D(tDepth, guv).r * 25.5, inGrid);
        if (uLake > 0.5) depth = 7.0;
        float fw = max(length(fwidth(p)), 1e-4);
        // ---- waves: long swell (analytic) + wind chop (photographic normal map, two scales)
        vec2 grad = vec2(0.0); float lost = 0.0;
        float calm = uLake > 0.5 ? 0.2 : 1.0;
        float patchA = (0.6 + 0.8 * noise(p * 0.004 + vec2(uTime * 0.01, uTime * 0.004))) * calm * (1.0 + 0.45 * uRain);
        patchA *= mix(0.35, 1.0, smoothstep(0.3, 5.0, depth));
        for (int i = 0; i < 10; i++) {
          float fi = float(i);
          float wl = 60.0 * pow(0.72, fi);
          float k = 6.2831853 / wl;
          float ang = 0.55 + sin(fi * 7.31) * 0.9;
          vec2 d = vec2(cos(ang), sin(ang));
          float w = sqrt(9.81 * k);
          float slope = 0.06 * (1.0 - fi * 0.03);
          float ph = k * dot(d, p) - w * uTime + fi * 1.93;
          float fade = 1.0 - smoothstep(0.1, 0.4, fw / wl);
          grad += d * slope * cos(ph) * fade * patchA;
          lost += 0.5 * slope * slope * (1.0 - fade) * patchA * patchA;
        }
        vec2 w1 = p * 0.045 + vec2(uTime * 0.021, uTime * 0.013);
        vec2 w2 = p * 0.11 + vec2(-uTime * 0.017, uTime * 0.027);
        vec2 w3 = p * 0.31 + vec2(uTime * 0.04, -uTime * 0.03);
        vec3 n1 = texture2D(tWN, w1).xzy * 2.0 - 1.0, n2 = texture2D(tWN, w2).xzy * 2.0 - 1.0, n3 = texture2D(tWN, w3).xzy * 2.0 - 1.0;
        float df = smoothstep(0.05, 0.6, fw * 0.11), df3 = smoothstep(0.02, 0.25, fw * 0.31);
        vec2 chop = (n1.xz * 0.55 + n2.xz * 0.35 * (1.0 - df) + n3.xz * 0.2 * (1.0 - df3)) * (0.42 * patchA + 0.06);
        lost += (df * 0.02 + df3 * 0.01) * patchA;
        vec3 N = normalize(vec3(-grad.x - chop.x, 1.0, -grad.y - chop.y));
        vec3 L = normalize(uSunDir);
        float NdV = max(dot(N, V), 0.001);
        // ---- reflection: planar scene reflection over the baked sky
        vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.005;
        vec3 sky = textureCube(uSky, R).rgb;
        vec4 rc = uReflMat * vec4(vWorld, 1.0);
        vec2 ruv = rc.xy / rc.w + N.xz * 0.06 * clamp(40.0 / dist, 0.15, 1.0);
        vec4 pr = texture2D(tRefl, clamp(ruv, 0.001, 0.999));
        float edge = smoothstep(0.0, 0.03, ruv.x) * smoothstep(1.0, 0.97, ruv.x) * smoothstep(0.0, 0.03, ruv.y) * smoothstep(1.0, 0.97, ruv.y);
        vec3 refl = mix(sky, pr.rgb, clamp(pr.a, 0.0, 1.0) * uReflOn * edge);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        F = mix(F, 0.25, clamp(lost * 2.0, 0.0, 0.5));
        // ---- water body: Beer-Lambert absorption over a lit sandy / rocky seabed
        vec3 sunE = uSunE, skyE = uSkyIrr;
        vec3 absorb = uLake > 0.5 ? vec3(0.45, 0.12, 0.13) : vec3(0.42, 0.075, 0.05);
        vec3 scatter = uLake > 0.5 ? vec3(0.012, 0.05, 0.045) : vec3(0.006, 0.034, 0.05);
        vec3 Rt = refract(-V, N, 0.75);
        float path = depth / max(-Rt.y, 0.08);
        vec2 bp = p + Rt.xz * path;                               // where the refracted ray meets the seabed
        vec3 bed = mix(texture2D(tSand, bp * 0.25).rgb * vec3(1.0, 0.95, 0.85), texture2D(tRock, bp * 0.12).rgb * 0.8, smoothstep(0.45, 0.75, noise(bp * 0.05)));
        float ca = caustic(bp * 0.6, uTime * 1.3) * 2.2 * exp(-depth * 0.18);
        vec3 bedL = bed * (sunE * L.y * exp(-absorb * depth / max(L.y, 0.2)) * (0.6 + ca) + skyE * 0.5 * exp(-absorb * depth)) / PI;
        vec3 Tw = exp(-absorb * (path + depth));
        vec3 body = bedL * Tw + scatter * (sunE * L.y + skyE) / PI * (1.0 - Tw) * 3.0;
        // sunlight through the backs of waves
        float sss = pow(clamp(dot(V, -vec3(L.x, 0.0, L.z)) * 0.5 + 0.5, 0.0, 1.0), 4.0) * clamp(dot(N.xz, -normalize(L.xz)) * 5.0 + 0.1, 0.0, 1.0);
        body += vec3(0.02, 0.16, 0.14) * sss * sunE * 0.02;
        vec3 col = mix(body, refl, F);
        // ---- shore foam: wave bands running in and breaking over the shallows
        float fn = noise(p * 0.35 + vec2(uTime * 0.3, 0.0)) * 0.6 + noise(p * 1.7 - uTime * 0.4) * 0.4;
        float band = 0.5 + 0.5 * sin(depth * 5.0 - uTime * 1.4 + fn * 3.0);
        float foam = smoothstep(1.1, 0.0, depth) * smoothstep(0.42, 0.8, fn * band + 0.25);
        foam += smoothstep(0.25, 0.0, depth) * smoothstep(0.35, 0.6, fn) * 0.8;
        foam *= inGrid * (1.0 - uLake);
        vec3 foamC = (sunE * max(dot(N, L), 0.2) + skyE) / PI * 0.85;
        col = mix(col, foamC, clamp(foam, 0.0, 1.0) * 0.85);
        // ---- sun glitter (GGX with the unresolved slope variance as extra roughness)
        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 1e-4);
        float a2 = 0.0016 + lost * 1.4;
        float NdH2 = NdH * NdH;
        float D = exp((NdH2 - 1.0) / (a2 * NdH2)) / (3.14159 * a2 * NdH2 * NdH2);
        float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        float NdL = max(dot(N, L), 0.0);
        vec3 spec = sunE * D * Fh * NdL / (4.0 * NdV * max(NdL, 0.1) + 0.001);
        col += min(spec, vec3(60.0)) * (1.0 - foam * 0.8);
        // ---- aerial perspective
        col = aerial(col, vWorld - cameraPosition, cameraPosition.y);
        // The finite ocean sheet reaches the same radiance as the sky before its edge.
        col = mix(col, apHorizon(normalize(vWorld - cameraPosition)), smoothstep(8000.0, 26000.0, length(vWorld.xz - cameraPosition.xz)) * (1.0 - uLake));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;

  const virt = new THREE.PerspectiveCamera();
  virt.layers.set(REFLECT_LAYER);
  const normal = new THREE.Vector3(0, 1, 0), mirrorPos = new THREE.Vector3(), camPos = new THREE.Vector3();
  const rot = new THREE.Matrix4(), look = new THREE.Vector3(), target = new THREE.Vector3(), view = new THREE.Vector3();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const cc = new THREE.Color();
  const lakeMeshes = [];
  function renderReflection(renderer, scene, camera) {
    mirrorPos.set(camera.position.x, 0, camera.position.z);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(mirrorPos, camPos);
    if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(mirrorPos);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(mirrorPos, look).reflect(normal).negate().add(mirrorPos);
    virt.position.copy(view);
    virt.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    virt.lookAt(target);
    virt.far = 90000; // include the same distant island silhouettes as the main view
    virt.updateMatrixWorld();
    virt.projectionMatrix.copy(camera.projectionMatrix);
    mat.uniforms.uReflMat.value.copy(bias).multiply(virt.projectionMatrix).multiply(virt.matrixWorldInverse);
    plane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(virt.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = virt.projectionMatrix;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0; q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm.elements[2] = clip.x; pm.elements[6] = clip.y; pm.elements[10] = clip.z + 1.0 - 0.003; pm.elements[14] = clip.w;
    mesh.visible = false; for (const m of lakeMeshes) m.visible = false;
    const prevRT = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(reflRT);
    renderer.getClearColor(cc); const pa = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, virt);
    renderer.setClearColor(cc, pa);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevShadow;
    mesh.visible = true; for (const m of lakeMeshes) m.visible = true;
    mat.uniforms.uReflOn.value = 1;
  }
  function setSize(w, h) { reflRT.setSize(Math.max(256, Math.floor(w * 0.45)), Math.max(256, Math.floor(h * 0.45))); }
  function makeLake(geo, y) {
    const lm = new THREE.ShaderMaterial({ uniforms: { ...mat.uniforms, uLake: { value: 1 } }, vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader });
    const m = new THREE.Mesh(geo, lm); m.position.y = y; lakeMeshes.push(m); return m;
  }
  return { mesh, renderReflection, setSize, makeLake, material: mat, dispose() { reflRT.dispose(); depthTex.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------- islands across the Saronic Gulf + Hymettus
let islandMat = null;
function islandMaterial() {
  if (islandMat) return islandMat;
  islandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: true });
  islandMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vIP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvIP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vIP;
      float ih(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float inz(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f); return mix(mix(ih(i),ih(i+vec2(1,0)),u.x), mix(ih(i+vec2(0,1)),ih(i+vec2(1,1)),u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { float n = inz(vIP.xz * 0.004) * 0.5 + inz(vIP.xz * 0.02) * 0.3 + inz(vIP.xz * 0.09) * 0.2;
        diffuseColor.rgb *= 0.7 + 0.55 * n;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.38, 0.25), smoothstep(0.5, 0.75, inz(vIP.xz * 0.006 + 3.0)) * 0.5); }`);
  };
  return islandMat;
}
function islandMesh(cx, cz, rx, rz, h, seed, color = '#8d8f86') {
  const geo = new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3), c0 = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const n = 1 + 0.18 * Math.sin(a * 3 + seed) + 0.1 * Math.sin(a * 7 + seed * 2) + 0.05 * Math.sin(a * 13 + seed * 3) + 0.025 * Math.sin(a * 29 + seed * 5);
    const ridge = 0.06 * Math.sin(a * 11 + seed * 4) * Math.sin(y * 9 + seed);
    const yy = Math.pow(Math.max(0, y), h < 200 ? 0.8 : 1.4) * (0.75 + 0.35 * Math.sin(a * 2 + seed * 1.7)) * (1 + ridge);
    p.setXYZ(i, x * rx * n, yy * h - 2, z * rz * n);
    const k = 0.85 + 0.25 * Math.sin(a * 17 + seed + y * 6);
    col[i * 3] = c0.r * k; col[i * 3 + 1] = c0.g * k; col[i * 3 + 2] = c0.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, islandMaterial());
  m.position.set(cx, 0, cz);
  m.name = 'Saronic distant relief';
  m.layers.enable(REFLECT_LAYER);
  return m;
}
export function createFarScenery(proj, region = 'riviera') {
  const g = new THREE.Group();
  const P = (lat, lon) => [(lon - proj.lon0) * proj.mlon, -(lat - proj.lat0) * proj.mlat];
  // real islands of the Saronic Gulf, seen from the Riviera
  const isl = [
    ['Aegina', 37.745, 23.49, 5200, 4200, 520], ['Agistri', 37.70, 23.35, 2400, 1900, 260], ['Salamina', 37.94, 23.48, 6500, 4000, 380],
    ['Fleves', 37.772, 23.765, 600, 350, 60], ['Patroklou', 37.655, 23.95, 900, 600, 160], ['Methana', 37.6, 23.36, 4200, 3600, 740],
    ['Arsida', 37.786, 23.795, 160, 90, 18],
  ];
  isl.forEach(([n, lat, lon, rx, rz, h], i) => { const [x, z] = P(lat, lon); const mesh = islandMesh(x, z, rx, rz, h, i * 2.3, '#8a8670'); mesh.name = n; g.add(mesh); });
  // Regional silhouettes use the supplied map projection; these are distant relief, not drivable DEM.
  // Hymettus ridge inland (north-east), Peloponnese hills beyond Aegina
  const ridge = (lat, lon, len, w, h, rot, seed, color, name = 'Distant coastal ridge') => {
    const [x, z] = P(lat, lon);
    const m = islandMesh(x, z, len, w, h, seed, color); m.rotation.y = rot; m.name = name; g.add(m);
  };
  if (region === 'megara') {
    // Geraneia / Makryplagi west of the circuit; Pateras forms the northern skyline.
    // https://www.topoguide.gr/mountains/attiki/hiking_on_geraneia_en.php
    // https://athensattica.com/el/point/oros-pateras/
    ridge(38.021, 23.1352, 9500, 4200, 1351, 0.12, 11, '#858275', 'Geraneia · west / northwest');
    ridge(38.13, 23.355, 6800, 3500, 1131, -0.55, 13, '#868571', 'Pateras · north');
    return g;
  }
  ridge(37.94, 23.83, 7000, 2600, 1000, -0.95, 1, '#8e8572');
  ridge(37.86, 23.86, 3400, 1800, 480, -0.7, 3, '#8a8270');
  ridge(37.74, 23.95, 4800, 2400, 520, 0.2, 5, '#888270');
  ridge(37.55, 23.25, 16000, 5000, 1200, 0.1, 7, '#8c8a7c');
  return g;
}
