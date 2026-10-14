import * as THREE from 'three';
import { CU, AP_UNIFORMS, AERIAL_GLSL, AP_K } from './env.js';

// ---------------------------------------------------------------- quality tiers
// The post chain per tier (src/post.js). `scenery` is the tier the world, weather and LOD code use (ultra shares high's).
//   msaa: scene samples (capped by the GPU) · fxaa: post-tone-map edge AA (low: the only AA; above: cleans the HDR
//   edges a hardware resolve leaves against a bright sky) · ao: Alchemy AO samples at half res (0 = off) ·
//   bloomMips: 0 = off · blurTaps: camera motion blur taps (0 = off) · dofTaps: photo / orbit depth of field ·
//   sharpen: contrast-adaptive, luma only · heat: distant heat shimmer on clear days ·
//   shadow: [sun shadow box half-size m, map size] (it fades out toward its edges; low has no shadow maps)
export const GRAPHICS_TIERS = {
  low: { scenery: 'low', pixelRatio: 0.8, msaa: 0, fxaa: true, ao: 0, bloomMips: 0, blurTaps: 0, dofTaps: 12, sharpen: 0, heat: false, shadow: null },
  med: { scenery: 'med', pixelRatio: 1.1, msaa: 2, fxaa: true, ao: 6, bloomMips: 4, blurTaps: 6, dofTaps: 16, sharpen: 0.12, heat: false, shadow: [110, 2048] },
  high: { scenery: 'high', pixelRatio: 1.5, msaa: 4, fxaa: true, ao: 10, bloomMips: 5, blurTaps: 8, dofTaps: 24, sharpen: 0.18, heat: true, shadow: [150, 4096] },
  ultra: { scenery: 'high', pixelRatio: 2, msaa: 8, fxaa: true, ao: 16, bloomMips: 6, blurTaps: 12, dofTaps: 40, sharpen: 0.18, heat: true, shadow: [220, 4096] },
};
export const GRAPHICS_CHOICES = ['auto', 'ultra', 'high', 'med', 'low'];
const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i;
// integrated / mobile GPUs: medium. Apple M-series and discrete cards stay on high; ultra is opt-in only.
const MID_GPU = /Intel\(R\) (HD|UHD)|Intel.*(HD|UHD) Graphics|Mali|Adreno|PowerVR|Apple GPU|Radeon\(TM\) Graphics|Radeon Vega [0-9]|Iris(?! Xe)/i;
/** the tier for a stored preference ('auto' | tier) and what the browser reports about the GPU */
export function detectQuality(preference = 'auto', gpuName = '', userAgent = '') {
  if (GRAPHICS_TIERS[preference]) return preference;
  if (SOFTWARE_GPU.test(gpuName)) return 'low';
  if (/Android|iPhone|iPad|Mobile/i.test(userAgent) || MID_GPU.test(gpuName)) return 'med';
  return 'high';
}

// ---------------------------------------------------------------- first-run tier pick (used by the UI onboarding prompt)
export const QUALITY_STORAGE_KEY = 'paraliaki.graphics';
/** the stored preference ('auto' | tier); a ?quality= URL parameter wins */
export function storedQualityPreference() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && (q === 'auto' || GRAPHICS_TIERS[q])) return q;
  try { const v = localStorage.getItem(QUALITY_STORAGE_KEY); if (v === 'auto' || GRAPHICS_TIERS[v]) return v; } catch {}
  return 'auto';
}
const TIER_ORDER = ['low', 'med', 'high', 'ultra'];
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
 * Tier ids are 'low' | 'med' | 'high' (label 'med' as "Medium").
 */
export async function detectQualityTier({ probe = true, gpuName = '', userAgent = navigator.userAgent } = {}) {
  const cores = navigator.hardwareConcurrency || 4, memory = navigator.deviceMemory || 8, reasons = [];
  let probed = null;
  if (probe) { await new Promise(r => setTimeout(r, 0)); try { probed = gpuProbe(); } catch { probed = null; } }
  const gpu = gpuName || probed?.gpu || '';
  let tier = detectQuality('auto', gpu, userAgent);
  reasons.push(`gpu:${gpu || 'unknown'}→${tier}`);
  if (cores <= 2 || memory <= 2) { tier = 'low'; reasons.push(`cpu ${cores} cores / ${memory} GB→low`); }
  else if (cores <= 4 || memory <= 4) { tier = minTier(tier, 'med'); reasons.push(`cpu ${cores} cores / ${memory} GB→≤med`); }
  const ms = probed?.msPerPass;
  if (ms != null) {
    const cap = ms > 14 ? 'low' : ms > 4.5 ? 'med' : 'high';
    if (cap !== 'high') reasons.push(`probe ${ms.toFixed(1)} ms→≤${cap}`);
    tier = minTier(tier, cap);
  }
  if (tier === 'ultra') tier = 'high';
  return { tier, reasons, gpu, cores, memory, msPerPass: ms ?? null };
}
/**
 * Persist a tier choice ('auto' | 'low' | 'med' | 'high' | 'ultra'). The renderer, shadow maps and world LOD are
 * built once per page load, so a change of the running tier reloads with ?quality=; returns true when it reloads.
 * Pass { reload: false } to only store it (e.g. before the game has booted).
 */
export function applyQualityTier(tier, { reload = true, current = window.__renderInfo?.().quality } = {}) {
  if (tier !== 'auto' && !GRAPHICS_TIERS[tier]) throw new Error(`Unknown graphics tier: ${tier}`);
  try { localStorage.setItem(QUALITY_STORAGE_KEY, tier); } catch {}
  const resolved = tier === 'auto' ? null : tier;
  if (!reload || (resolved && resolved === current)) return false;
  const url = new URL(location.href); url.searchParams.set('quality', tier); location.href = url;
  return true;
}

// Keep the course and car geometry intact while reducing expensive per-pixel
// atmosphere/water work on software rendering and low-end graphics devices.
export function simplifyScenery(sky, skyCube, water, terrain) {
  if (!sky.userData.lowScenery) {
  const oldSky = sky.material;
  sky.material = new THREE.ShaderMaterial({
    uniforms: { skyCube: { value: skyCube } }, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){vDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww;}',
    fragmentShader: 'uniform samplerCube skyCube; varying vec3 vDir; void main(){gl_FragColor=vec4(textureCube(skyCube,normalize(vDir)).rgb,1.0);}',
  });
  // the full sky material stays alive: env.js bakes the sky cube with it on every change of conditions
  void oldSky;
  sky.userData.lowScenery = true;
  }
  if (water) {
  const oldWater = water.mesh.material;
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
  water.mesh.material = sea;
  }
  const ground = new THREE.MeshLambertMaterial({ vertexColors: true });
  const coarse = ground.clone(); Object.assign(coarse, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 }); // see terrain.js
  terrain.group.traverse(o => { if (o.isMesh) o.material = o.userData.coarseTerrain ? coarse : ground; });
  terrain.material.dispose();
}
