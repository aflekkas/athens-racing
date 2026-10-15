import * as THREE from 'three';
import { terrainChunkMaterial } from './terrain-layout.js';
import { settings, setSetting } from './settings.js';
import { CU, AP_UNIFORMS, AERIAL_GLSL, AP_K } from './env.js';

// ---------------------------------------------------------------- graphics presets
// A preset (settings.graphics) picks a LIGHTING level, an EFFECTS level, the world's scenery tier, the render
// resolution and the draw distance. Lighting, effects, resolution and draw distance can each be overridden in
// Settings > Graphics ('preset' = follow the preset). Nothing changes behind the player's back at runtime: there is
// no adaptive resolution and no silent tier switching. Everything applies live (main.js).
//
// LIGHTING: shadow: [sun shadow box half-size m, map size] (null = no shadow maps) · shadowEvery: re-render the sun
//   shadow map every n frames · probeEvery: car reflection probe face cadence in frames (0 = frozen sky reflection)
export const LIGHTING = {
  off: { shadow: null, shadowEvery: 1, probeEvery: 0 },
  low: { shadow: [70, 1024], shadowEvery: 2, probeEvery: 6 },
  med: { shadow: [95, 2048], shadowEvery: 2, probeEvery: 4 },
  high: { shadow: [150, 4096], shadowEvery: 1, probeEvery: 2 },
  ultra: { shadow: [220, 4096], shadowEvery: 1, probeEvery: 2 },
};
// EFFECTS: the post chain (src/post.js) and the extra views.
//   msaa: scene samples (capped by the GPU) · fxaa: post-tone-map edge AA · ao: Alchemy AO samples at half res (0 = off) ·
//   bloomMips: 0 = off · blurTaps: camera motion blur taps (0 = off) · dofTaps: garage / orbit depth of field ·
//   sharpen: contrast-adaptive, luma only · heat: distant heat shimmer on clear days · grade: the final pass also does
//   glare, vignette and sharpening (off = tone map only) · simple: cheap sky / sea / terrain shading ·
//   mirrorEvery: cockpit mirror cadence divisor (0 = off) · mirrorFar: mirror camera far plane (m) ·
//   waterEvery: sea reflection cadence in frames (0 = off) · particles: weather / tyre-smoke detail ('low'|'med'|'high')
export const EFFECTS = {
  off: { msaa: 0, fxaa: false, ao: 0, bloomMips: 0, blurTaps: 0, dofTaps: 8, sharpen: 0, heat: false, grade: false, simple: true, mirrorEvery: 0, mirrorFar: 0, waterEvery: 0, particles: 'low' },
  low: { msaa: 0, fxaa: true, ao: 0, bloomMips: 0, blurTaps: 0, dofTaps: 12, sharpen: 0, heat: false, grade: true, simple: true, mirrorEvery: 0, mirrorFar: 0, waterEvery: 0, particles: 'low' },
  med: { msaa: 2, fxaa: true, ao: 6, bloomMips: 4, blurTaps: 6, dofTaps: 16, sharpen: 0.12, heat: false, grade: true, simple: false, mirrorEvery: 2, mirrorFar: 240, waterEvery: 6, particles: 'med' },
  high: { msaa: 4, fxaa: true, ao: 10, bloomMips: 5, blurTaps: 8, dofTaps: 24, sharpen: 0.18, heat: true, grade: true, simple: false, mirrorEvery: 1, mirrorFar: 600, waterEvery: 3, particles: 'high' },
  ultra: { msaa: 8, fxaa: true, ao: 16, bloomMips: 6, blurTaps: 12, dofTaps: 40, sharpen: 0.18, heat: true, grade: true, simple: false, mirrorEvery: 1, mirrorFar: 600, waterEvery: 3, particles: 'high' },
};
// PRESETS: scenery: the tier the world builders, weather and LOD code use ('low' | 'med' | 'high') · horizon: the
//   far-impostor tier (src/scenery.js SCENERY_TIERS) · pixelRatio: render pixel ratio cap (× device pixels) ·
//   drawDistance: m (src/scenery.js) · trafficDraw: traffic drawn out to (m, null = from the draw distance) ·
//   crowd: pedestrians drawn out to (m) · detail: small-prop range factor (src/scenery.js)
export const PRESETS = {
  potato: { lighting: 'off', effects: 'off', scenery: 'low', horizon: 'potato', pixelRatio: 0.6, drawDistance: 500, trafficDraw: 220, crowd: 70, detail: 0.5 },
  low: { lighting: 'off', effects: 'low', scenery: 'low', horizon: 'low', pixelRatio: 0.8, drawDistance: 1000, trafficDraw: 320, crowd: 110, detail: 0.7 },
  med: { lighting: 'med', effects: 'med', scenery: 'med', horizon: 'med', pixelRatio: 1.1, drawDistance: 1000, trafficDraw: 420, crowd: 140, detail: 0.85 },
  high: { lighting: 'high', effects: 'high', scenery: 'high', horizon: 'high', pixelRatio: 1.5, drawDistance: 2000, trafficDraw: null, crowd: 175, detail: 1 },
  ultra: { lighting: 'ultra', effects: 'ultra', scenery: 'high', horizon: 'ultra', pixelRatio: 2, drawDistance: 4000, trafficDraw: null, crowd: 175, detail: 1 },
};
export const PRESET_IDS = ['potato', 'low', 'med', 'high', 'ultra'];
export const LEVEL_IDS = ['off', 'low', 'med', 'high', 'ultra'];
export const PRESET_LABELS = { potato: 'POTATO', low: 'LOW', med: 'MEDIUM', high: 'HIGH', ultra: 'ULTRA', off: 'OFF' };
/** Legacy per-tier view (post.js / tests): a preset's effects + lighting + preset fields in one object. */
export const GRAPHICS_TIERS = Object.fromEntries(PRESET_IDS.map(id => [id, { ...EFFECTS[PRESETS[id].effects], ...LIGHTING[PRESETS[id].lighting], ...PRESETS[id] }]));
export const GRAPHICS_CHOICES = [...PRESET_IDS].reverse();
/**
 * What the current settings resolve to. `preset` is always a concrete preset id (a stored 'auto' from an older
 * build resolves through the device heuristic). renderScale 'auto' = the preset's resolution, otherwise a fixed
 * 0.5..1 fraction of the screen's pixels (device pixel ratio, capped at 2).
 */
export function resolveGraphics(s = settings, { deviceRatio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, gpuName = '', userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '' } = {}) {
  const preset = PRESETS[s.graphics] ? s.graphics : detectQuality('auto', gpuName, userAgent), P = PRESETS[preset];
  const lighting = LIGHTING[s.lighting] ? s.lighting : P.lighting, effects = EFFECTS[s.effects] ? s.effects : P.effects;
  const screen = Math.min(deviceRatio || 1, 2), scale = s.renderScale === 'auto' || s.renderScale == null ? null : +s.renderScale;
  const pixelRatio = +(scale ? screen * scale : Math.min(screen, P.pixelRatio)).toFixed(3);
  const draw = +s.drawDistance > 0 ? +s.drawDistance : P.drawDistance;
  return { preset, P, lighting, L: LIGHTING[lighting], effects, E: EFFECTS[effects], scenery: P.scenery, horizon: P.horizon,
    pixelRatio, resolution: pixelRatio / screen, drawDistance: draw, trafficDraw: P.trafficDraw, crowd: P.crowd, detail: P.detail };
}
const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i;
// integrated / mobile GPUs: medium. Apple M-series and discrete cards stay on high; ultra is opt-in only.
const MID_GPU = /Intel\(R\) (HD|UHD)|Intel.*(HD|UHD) Graphics|Mali|Adreno|PowerVR|Apple GPU|Radeon\(TM\) Graphics|Radeon Vega [0-9]|Iris(?! Xe)/i;
// old / very weak integrated parts: potato
const WEAK_GPU = /Intel\(R\) HD Graphics( [2-5][0-9]{2,3})?$|Intel.*HD Graphics (2000|2500|3000|4000|4400|4600|5000|5500|6000|500|505|510|405|400)\b|Mali-(G31|G51|G52|T[0-9]+)\b|Adreno \(TM\) [2-5][0-9]{2}\b|PowerVR/i;
/** the preset for a stored preference (a preset id, or 'auto' = pick from the GPU) and what the browser reports */
export function detectQuality(preference = 'auto', gpuName = '', userAgent = '') {
  if (PRESETS[preference]) return preference;
  if (SOFTWARE_GPU.test(gpuName)) return 'low';
  if (WEAK_GPU.test(gpuName)) return 'potato';
  if (/Android|iPhone|iPad|Mobile/i.test(userAgent) || MID_GPU.test(gpuName)) return 'med';
  return 'high';
}

// ---------------------------------------------------------------- first-run preset pick (used by the UI onboarding prompt)
export const QUALITY_STORAGE_KEY = 'paraliaki.graphics';
/** the stored preference ('auto' = never chosen | preset); a ?quality= URL parameter wins */
export function storedQualityPreference() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && (q === 'auto' || PRESETS[q])) return q;
  try { const v = localStorage.getItem(QUALITY_STORAGE_KEY); if (v === 'auto' || PRESETS[v]) return v; } catch {}
  return 'auto';
}
const TIER_ORDER = PRESET_IDS;
const minTier = (a, b) => TIER_ORDER[Math.min(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))];
function gpuNameOf(gl) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
}
// A short synchronous GPU throughput probe in its own throwaway context: a fixed fragment workload at 960x540,
// timed through a 1-pixel readback (forces completion). It only ever LOWERS the heuristic tier, so an
// uncalibrated reading can't push a weak laptop onto high. ms per pass: discrete ~0.3-1, Iris Xe ~2-4, UHD 620 ~6-12.
function gpuProbe(budgetMs = 1500) {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false });
  if (!gl) return null;
  const gpu = gpuNameOf(gl);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main(){gl_Position=vec4(p,0.,1.);}'));
  // ~the per-pixel ALU of the lit world + post chain: 48 iterations of trig/normalize/pow
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; uniform float t; out vec4 o;
    void main(){ vec3 c=vec3(gl_FragCoord.xy*.001,t); for(int i=0;i<48;i++){ c=normalize(vec3(sin(c.y*3.1+t),cos(c.z*2.3),sin(c.x*1.7)))*pow(abs(c.x)+.5,1.3); } o=vec4(c*.5+.5,1.); }`));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return { gpu, msPerPass: null }; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tLoc = gl.getUniformLocation(prog, 't'), px = new Uint8Array(4);
  const pass = (k) => { gl.uniform1f(tLoc, k); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  pass(0); // compile + warm
  const start = performance.now(); let n = 0;
  while (n < 40 && performance.now() - start < budgetMs) pass(++n);
  const msPerPass = (performance.now() - start) / Math.max(1, n);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { gpu, msPerPass };
}
/**
 * Recommend a tier for this device: GPU name + CPU cores + device memory, then (optional) a ≤1.5 s GPU probe that
 * can only lower it. Never recommends 'ultra'. Resolves { tier, reasons[], gpu, cores, memory, msPerPass }.
 * Preset ids are 'potato' | 'low' | 'med' | 'high' (label 'med' as "Medium").
 */
export async function detectQualityTier({ probe = true, gpuName = '', userAgent = navigator.userAgent } = {}) {
  const cores = navigator.hardwareConcurrency || 4, memory = navigator.deviceMemory || 8, reasons = [];
  let probed = null;
  if (probe) { await new Promise(r => setTimeout(r, 0)); try { probed = gpuProbe(); } catch { probed = null; } }
  const gpu = gpuName || probed?.gpu || '';
  let tier = detectQuality('auto', gpu, userAgent);
  reasons.push(`gpu:${gpu || 'unknown'}→${tier}`);
  if (cores <= 2 || memory <= 2) { tier = minTier(tier, 'potato'); reasons.push(`cpu ${cores} cores / ${memory} GB→potato`); }
  else if (cores <= 4 || memory <= 4) { tier = minTier(tier, 'med'); reasons.push(`cpu ${cores} cores / ${memory} GB→≤med`); }
  const ms = probed?.msPerPass;
  if (ms != null) {
    const cap = ms > 30 ? 'potato' : ms > 14 ? 'low' : ms > 4.5 ? 'med' : 'high';
    if (cap !== 'high') reasons.push(`probe ${ms.toFixed(1)} ms→≤${cap}`);
    tier = minTier(tier, cap);
  }
  if (tier === 'ultra') tier = 'high';
  return { tier, reasons, gpu, cores, memory, msPerPass: ms ?? null };
}
/** Persist and apply a preset live. The legacy reload option is accepted without navigation. */
export function applyQualityTier(tier, _options = {}) {
  if (tier !== 'auto' && !PRESETS[tier]) throw new Error(`Unknown graphics preset: ${tier}`);
  const changed = settings.graphics !== tier;
  setSetting('graphics', tier);
  return changed;
}
/** Resolution is independent of the preset's effects: 'auto' (the preset's) or a fixed 0.5..1 of the screen's pixels. */
export function applyRenderResolution(scale, { pixelRatioCap } = {}) {
  const previous = [settings.renderScale, settings.pixelRatioCap];
  setSetting('renderScale', scale);
  if (pixelRatioCap !== undefined) setSetting('pixelRatioCap', pixelRatioCap);
  return previous[0] !== settings.renderScale || previous[1] !== settings.pixelRatioCap;
}
/** the pixel ratio the renderer runs at (see resolveGraphics) */
export function resolutionRatio(deviceRatio = 1, scale = settings.renderScale, preset = settings.graphics) {
  return resolveGraphics({ graphics: preset, renderScale: scale }, { deviceRatio }).pixelRatio;
}

/** Fewer shadow casters: small parts (world bounding radius under minRadius m: trim, bolts, lamps, badges) and
 * see-through glass keep receiving shadows but stop casting them; the body, wheels and big parts still cast. The
 * shadow map reads the same and the shadow pass submits far fewer draws per car. Returns how many were trimmed. */
export function trimShadowCasters(root, minRadius = 0.14) {
  let n = 0; root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || !o.castShadow || o.isInstancedMesh) return;
    const g = o.geometry, m = o.material;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r = (g.boundingSphere?.radius || 0) * o.matrixWorld.getMaxScaleOnAxis();
    const glass = m && !Array.isArray(m) && m.transparent && m.opacity < 0.9;
    if (r < minRadius || glass) { o.castShadow = false; n++; }
  });
  return n;
}

// Keep the course and car geometry intact while reducing expensive per-pixel
// atmosphere/water work on software rendering and low-end graphics devices.
export function simplifyScenery(sky, skyCube, water, terrain) {
  if (!sky.userData.lowScenery) {
  const oldSky = sky.material;
  sky.material = sky.userData.lowMaterial ||= new THREE.ShaderMaterial({
    uniforms: { skyCube: { value: skyCube } }, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){vDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww;}',
    fragmentShader: 'uniform samplerCube skyCube; varying vec3 vDir; void main(){gl_FragColor=vec4(textureCube(skyCube,normalize(vDir)).rgb,1.0);}',
  });
  // the full sky material stays alive: env.js bakes the sky cube with it on every change of conditions
  sky.userData.fullMaterial ||= oldSky;
  sky.userData.lowScenery = true;
  }
  if (water) {
  if (!water.mesh.userData.fullMaterial) water.mesh.userData.fullMaterial = water.mesh.material;
  const oldWater = water.mesh.userData.fullMaterial;
  if (water.mesh.userData.lowMaterial) { water.mesh.material = water.mesh.userData.lowMaterial; } else {
  const sea = new THREE.ShaderMaterial({
    uniforms: { ...AP_UNIFORMS, skyCube: { value: skyCube }, time: oldWater.uniforms.uTime, uBody: CU.uSeaBody }, // body colour follows the time of day (env.js)
    vertexShader: 'varying vec3 world; void main(){world=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);}',
    fragmentShader: `const float AP_K = ${AP_K.toFixed(3)};
      ${AERIAL_GLSL}
      uniform samplerCube skyCube; uniform float time; uniform vec3 uBody; varying vec3 world;
      void main(){vec3 off=world-cameraPosition;vec3 v=normalize(-off);
      // Average unresolved slopes before reflection; otherwise the LOW sea aliases into horizon bands.
      vec2 rippleFilter=vec2(1.)-smoothstep(vec2(.6),vec2(3.14),fwidth(world.xz)*vec2(.08,.07));
      rippleFilter*=1.-smoothstep(350.,2200.,length(off.xz));
      vec3 n=normalize(vec3(.018*sin(world.x*.08+time)*rippleFilter.x,1.,.016*cos(world.z*.07+time*.7)*rippleFilter.y));
      float f=.02+.98*pow(1.-max(dot(n,v),0.),5.);vec3 reflected=textureCube(skyCube,reflect(-v,n)).rgb;
      vec3 col=aerial(mix(uBody,reflected,f),off,cameraPosition.y);
      col=mix(col,apHorizon(normalize(off)),smoothstep(8000.,26000.,length(off.xz)));
      gl_FragColor=vec4(col,1.);}`,
  });
  water.mesh.material = sea; water.mesh.userData.lowMaterial = sea;
  }
  }
  if (terrain && !terrain.userData?.lowMaterials) {
  terrain.userData ||= {};
  terrain.userData.lowMaterials = true;
  const ground = new THREE.MeshLambertMaterial({ vertexColors: true });
  const coarse = ground.clone(); Object.assign(coarse, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 }); // see terrain.js
  terrain.group.traverse(o => { if (o.isMesh) { o.userData.fullMaterial = o.material; o.userData.lowMaterial = terrainChunkMaterial(o.userData.coarseTerrain ? coarse : ground, o.userData.terrainDecode); o.material = o.userData.lowMaterial; } });
  }
}

/** Reuse the existing world; material variants are kept for later switches. */
export function applySceneryQuality(sky, skyCube, water, worldGroup, low) {
  if (low) simplifyScenery(sky, skyCube, water, null);
  else if (sky.userData.fullMaterial) { sky.material = sky.userData.fullMaterial; sky.userData.lowScenery = false; }
  if (water?.mesh.userData.fullMaterial) water.mesh.material = low ? water.mesh.userData.lowMaterial : water.mesh.userData.fullMaterial;
  worldGroup?.traverse(o => { if (o.userData.lowMaterial && o.userData.fullMaterial) o.material = low ? o.userData.lowMaterial : o.userData.fullMaterial; });
}

/** Release inactive quality variants when their owning map is disposed. */
export function releaseSceneryVariants(root) {
  const active = new Set(), variants = new Set();
  root.traverse(o => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) active.add(m);
    for (const value of [o.userData.fullMaterial, o.userData.lowMaterial]) for (const m of Array.isArray(value) ? value : value ? [value] : []) variants.add(m);
  });
  for (const m of variants) if (!active.has(m) && !m.userData.shared) m.dispose();
}
