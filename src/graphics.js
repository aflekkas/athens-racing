import * as THREE from 'three';
import { settings, setSetting } from './settings.js';
import { CU, AP_UNIFORMS, AERIAL_GLSL, AP_K } from './env.js';
import { mobileDevice } from './mobile.js';

// ---------------------------------------------------------------- the one graphics look (OWNER-LOCKED)
// There is exactly ONE look: what the old Lighting = OFF + Effects = OFF levels produced. No presets, no lighting /
// effects levels, no adaptive switching. Owner-locked decision (docs/OWNER-DECISIONS.md): ask the owner before
// changing anything in RENDER; tools/owner-locked-graphics.test.mjs fails if a shadow / post / AO / bloom /
// reflection pass is switched on here or a preset / level selector comes back.
//   shadow: null = no sun shadow maps · probeEvery: 0 = frozen sky reflection on the cars (no probe re-renders) ·
//   msaa / fxaa / ao / bloomMips / blurTaps / sharpen: 0 = off · dofTaps: depth of field taps for the garage / orbit
//   cameras only · heat: no heat shimmer · grade: false = tone map + time-of-day grade only (no sun glare, lens ghosts
//   or rain on the lens) · simple: cheap sky / sea / terrain shading · waterEvery: 0 = no sea reflection pass ·
//   particles: weather / tyre-smoke detail · mirror: cockpit mirror view (every n-th frame, far plane m, width px) ·
//   scenery / horizon: the world tier and far-impostor tier · anisotropy: texture filtering · exhaust: flame tier
export const RENDER = Object.freeze({
  shadow: null, shadowEvery: 1, probeEvery: 0,
  msaa: 0, fxaa: false, ao: 0, bloomMips: 0, blurTaps: 0, dofTaps: 8, sharpen: 0, heat: false, grade: false, simple: true,
  waterEvery: 0, particles: 'low', mirror: Object.freeze({ every: 3, far: 150, width: 384 }),
  scenery: 'high', horizon: 'high', anisotropy: 8, exhaust: 'high',
});
// PERFORMANCE classes change only resolution, draw ranges and how much is simulated and refreshed, never the look. settings.perfClass
// ('auto' = from the device; the first-run check in src/ui/graphics-onboarding.js may lower it silently, and the frame
// governor in src/perf-governor.js lowers it when a machine keeps missing its frame budget) picks the 'auto' resolution,
// draw distance and the CPU budget below. pixelRatio: render pixel ratio cap (x device pixels) · drawDistance m
// (src/scenery.js) · trafficDraw / crowd: traffic and pedestrian draw ranges (m, null = from the draw distance) · detail:
// small-prop range factor (src/scenery.js) · traffic / walkers: offline traffic density and pedestrian count (x the
// map's; online the server owns the shared traffic, so it is never scaled there) · trafficHz: traffic AI rate (60 = every
// step) · hud: minimap / tacho redraw rates in Hz (src/hud.js)
const hudRates = (tacho, map, mapBig) => Object.freeze({ tacho, map, mapBig });
export const PERFORMANCE = Object.freeze({
  potato: { pixelRatio: 0.6, drawDistance: 500, trafficDraw: 220, crowd: 70, detail: 0.5, traffic: 0.4, walkers: 0.5, trafficHz: 30, hud: hudRates(20, 8, 15) },
  low: { pixelRatio: 0.8, drawDistance: 1000, trafficDraw: 320, crowd: 110, detail: 0.7, traffic: 0.6, walkers: 0.7, trafficHz: 60, hud: hudRates(24, 10, 20) },
  med: { pixelRatio: 1.1, drawDistance: 1000, trafficDraw: 420, crowd: 140, detail: 0.85, traffic: 0.85, walkers: 1, trafficHz: 60, hud: hudRates(30, 15, 30) },
  high: { pixelRatio: 1.5, drawDistance: 2000, trafficDraw: null, crowd: 175, detail: 1, traffic: 1, walkers: 1, trafficHz: 60, hud: hudRates(30, 15, 30) },
});
export const PERF_CLASSES = Object.keys(PERFORMANCE);
// Admission targets include all live page/worker allocations. Stream reservations
// are subsets of these totals, including decode overlap; never add them twice.
const MiB = 1024 * 1024;
const resourceBudget = (js, gpu, cap, transient, concurrency) => Object.freeze({
  jsBytes: js * MiB, gpuBytes: gpu * MiB,
  stream: Object.freeze({ capBytes: cap * MiB, transientBytes: transient * MiB, concurrency }),
});
export const RESOURCE_BUDGETS = Object.freeze({
  potato: resourceBudget(256, 192, 64, 64, 1),
  low: resourceBudget(256, 192, 64, 64, 1),
  med: resourceBudget(384, 256, 128, 96, 2),
  high: resourceBudget(512, 384, 256, 192, 2),
});
/**
 * What the current settings resolve to: the fixed RENDER look plus the performance class's resolution and draw
 * ranges. renderScale 'auto' = the class's resolution, otherwise a fixed 0.5..1 fraction of the screen's pixels
 * (device pixel ratio, capped at 2).
 */
export function resolveGraphics(s = settings, { deviceRatio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, gpuName = '', userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '' } = {}) {
  const perfClass = PERFORMANCE[s.perfClass] ? s.perfClass : detectPerfClass(gpuName, userAgent), P = PERFORMANCE[perfClass];
  const mobile = mobileDevice(userAgent);
  const screen = Math.min(deviceRatio || 1, mobile ? 1 : 2), scale = s.renderScale === 'auto' || s.renderScale == null ? null : +s.renderScale;
  const pixelRatio = +(scale ? screen * scale : Math.min(screen, P.pixelRatio)).toFixed(3);
  const draw = +s.drawDistance > 0 ? +s.drawDistance : Math.min(P.drawDistance, mobile ? 500 : Infinity);
  const resources = RESOURCE_BUDGETS[mobile && PERF_CLASSES.indexOf(perfClass) > 1 ? 'low' : perfClass];
  return { R: RENDER, perfClass, P, resources, pixelRatio, resolution: pixelRatio / screen, drawDistance: draw, trafficDraw: P.trafficDraw, crowd: P.crowd, detail: P.detail, traffic: P.traffic, walkers: P.walkers, trafficHz: P.trafficHz, hud: P.hud };
}
const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i;
// integrated / mobile GPUs: medium. Apple M-series and discrete cards stay on high.
const MID_GPU = /Intel\(R\) (HD|UHD)|Intel.*(HD|UHD) Graphics|Mali|Adreno|PowerVR|Apple GPU|Radeon\(TM\) Graphics|Radeon Vega [0-9]|Iris(?! Xe)/i;
// old / very weak integrated parts: potato
const WEAK_GPU = /Intel\(R\) HD Graphics( [2-5][0-9]{2,3})?$|Intel.*HD Graphics (2000|2500|3000|4000|4400|4600|5000|5500|6000|500|505|510|405|400)\b|Mali-(G31|G51|G52|T[0-9]+)\b|Adreno \(TM\) [2-5][0-9]{2}\b|PowerVR/i;
/** the performance class for what the browser reports (GPU name, user agent) */
export function detectPerfClass(gpuName = '', userAgent = '') {
  if (SOFTWARE_GPU.test(gpuName)) return 'low';
  if (WEAK_GPU.test(gpuName)) return 'potato';
  if (mobileDevice(userAgent)) return 'low';
  if (MID_GPU.test(gpuName)) return 'med';
  return 'high';
}
const minClass = (a, b) => PERF_CLASSES[Math.min(PERF_CLASSES.indexOf(a), PERF_CLASSES.indexOf(b))];
function gpuNameOf(gl) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
}
// A short synchronous GPU throughput probe in its own throwaway context: a fixed fragment workload at 960x540,
// timed through a 1-pixel readback (forces completion). It only ever LOWERS the heuristic class, so an
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
// A short synchronous CPU probe: a fixed amount of the kind of work the simulation does (trig, sqrt, typed-array traffic,
// dependent chains), repeated until `budgetMs` has passed. Returns ms per million loop iterations (lower is faster): about
// 20-35 on a current laptop core, 70 on a 2x slower one. A weak GPU is only half of a slow machine: the first-run check
// also needs to know whether the CPU can run the sim, the traffic and the HUD at frame rate.
export function cpuProbe(budgetMs = 60) {
  const table = new Float64Array(256); let x = 0.1, y = 0.2, v = 1, loops = 0;
  const start = performance.now(); let elapsed = 0;
  do {
    for (let i = 0; i < 20000; i++) { x = Math.sin(x * 1.7 + y) * 0.99; y = Math.sqrt(Math.abs(x) + y * 0.5 + 0.1); table[i & 255] = x * y + v; v = v * 0.9999 + table[(i * 7) & 255] * 1e-3; }
    loops++; elapsed = performance.now() - start;
  } while (elapsed < budgetMs);
  return { msPerMillion: elapsed / (loops * 0.02), sink: x + y + v };
}
/** the heaviest class this CPU can carry (a probe time in ms per million iterations; see cpuProbe) */
export function cpuCap(msPerMillion) {
  return msPerMillion > CPU_PROBE_LIMITS.potato ? 'potato' : msPerMillion > CPU_PROBE_LIMITS.low ? 'low' : msPerMillion > CPU_PROBE_LIMITS.med ? 'med' : 'high';
}
// Calibrated against the sim: one core of the 8-core server this was tuned on probes at ~35 ms per million iterations (CPU
// time) and runs the busy Riviera sim step in ~7 ms (x4 CPU throttle: ~28 ms, i.e. no 60 fps). A core 2x slower (~70) can still
// run 'low'; 3x slower (~100+) only 'potato'.
export const CPU_PROBE_LIMITS = Object.freeze({ potato: 100, low: 65, med: 45 });
/**
 * The first-run performance check: GPU name + CPU cores + device memory, then (optional) a <=1.5 s GPU probe that
 * can only lower it. Resolves { perfClass, reasons[], gpu, cores, memory, msPerPass }. Performance only: it picks
 * the 'auto' resolution and draw distance, never the look.
 */
export async function detectPerformance({ probe = true, gpuName = '', userAgent = navigator.userAgent } = {}) {
  const cores = navigator.hardwareConcurrency || 4, memory = navigator.deviceMemory || 8, reasons = [];
  let probed = null;
  if (probe) { await new Promise(r => setTimeout(r, 0)); try { probed = gpuProbe(); } catch { probed = null; } }
  const gpu = gpuName || probed?.gpu || '';
  let perfClass = detectPerfClass(gpu, userAgent);
  reasons.push(`gpu:${gpu || 'unknown'} to ${perfClass}`);
  // the CPU: best of three short probes (a busy moment must not condemn a fast machine)
  let cpu = null;
  if (probe) { cpu = Infinity; for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); cpu = Math.min(cpu, cpuProbe(40).msPerMillion); } }
  if (cpu != null) { const cap = cpuCap(cpu); if (cap !== 'high') reasons.push(`cpu probe ${cpu.toFixed(0)} ms/M to ≤${cap}`); perfClass = minClass(perfClass, cap); }
  if (cores <= 2 || memory <= 2) { perfClass = minClass(perfClass, 'potato'); reasons.push(`cpu ${cores} cores / ${memory} GB to potato`); }
  else if (cores <= 4 || memory <= 4) { perfClass = minClass(perfClass, 'med'); reasons.push(`cpu ${cores} cores / ${memory} GB to ≤med`); }
  const ms = probed?.msPerPass;
  if (ms != null) {
    const cap = ms > 30 ? 'potato' : ms > 14 ? 'low' : ms > 4.5 ? 'med' : 'high';
    if (cap !== 'high') reasons.push(`probe ${ms.toFixed(1)} ms to ≤${cap}`);
    perfClass = minClass(perfClass, cap);
  }
  return { perfClass, reasons, gpu, cores, memory, msPerPass: ms ?? null, cpuMsPerMillion: cpu };
}
/** Resolution: 'auto' (the performance class's) or a fixed 0.5..1 of the screen's pixels. */
export function applyRenderResolution(scale, { pixelRatioCap } = {}) {
  const previous = [settings.renderScale, settings.pixelRatioCap];
  setSetting('renderScale', scale);
  if (pixelRatioCap !== undefined) setSetting('pixelRatioCap', pixelRatioCap);
  return previous[0] !== settings.renderScale || previous[1] !== settings.pixelRatioCap;
}
/** the pixel ratio the renderer runs at (see resolveGraphics) */
export function resolutionRatio(deviceRatio = 1, scale = settings.renderScale, perfClass = settings.perfClass) {
  return resolveGraphics({ perfClass, renderScale: scale }, { deviceRatio }).pixelRatio;
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

// The fixed look's sky / sea / terrain shading (RENDER.simple): cheap per-pixel atmosphere and water, course and
// car geometry intact. map-world.js applies it to every map.
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
  // Share the reflection-independent calm-blue branch with the full water material.
  const sea = oldWater.clone();
  sea.uniforms = { ...oldWater.uniforms, uReflOn: { value: 0 } };
  water.mesh.material = sea; water.mesh.userData.lowMaterial = sea;
  }
  }
  if (terrain && !terrain.userData?.lowMaterials) {
  terrain.userData ||= {};
  terrain.userData.lowMaterials = true;
  // Area colour/texture is part of the owner-locked look, including Effects Off.
  // Keep the existing material and quantized-position decoder intact.
  terrain.group.traverse(o => { if (o.isMesh) { o.userData.fullMaterial = o.material; o.userData.lowMaterial = o.material; } });
  }
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
