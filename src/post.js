// HDR post pipeline for the ONE graphics look (src/graphics.js RENDER, owner-locked: docs/OWNER-DECISIONS.md):
//  scene (no MSAA, half-float colour + resolved depth)
//  -> composite: depth of field for the orbit / garage cameras only (skipped otherwise)
//  -> final: exposure, white balance, AgX filmic tone mapping, per time-of-day / weather grade (lift / gamma / gain,
//     saturation, contrast, split tone; eased between conditions), vignette, gameplay flashes, grain, TPDF dither.
// No ambient occlusion, motion blur, heat shimmer, bloom, edge-smoothing / sharpening, sun glare or rain-lens passes: they were
// the old Effects levels, removed with the presets. Ask the owner before adding any of them back.
// The mirrors (cockpit.js) and the sea reflection render the scene into their own targets and never run this chain.
import * as THREE from 'three';
import * as ENV from './env.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RENDER } from './graphics.js';

const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const HASH = 'float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }';
const DEPTH_GLSL = /* glsl */`
  uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uProj;
  float rawDepth(vec2 uv){ return texture2D(tDepth, uv).r; }
  vec3 viewPos(vec2 uv, float d){ vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uInvProj * c; return v.xyz / v.w; }
`;

const CompositeShader = {
  defines: { DOF_TAPS: 8 },
  uniforms: {
    tColor: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
    uRes: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uDof: { value: 0 }, uFocus: { value: 10 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uRes;
    uniform float uExposure; uniform float uDof; uniform float uFocus;
    ${DEPTH_GLSL}
    ${HASH}
    void main(){
      float d = rawDepth(vUv);
      vec3 P = viewPos(vUv, min(d, 0.999999));
      vec3 col = texture2D(tColor, vUv).rgb;
      // Keep the orbit DOF kernel stable; animated sample noise
      // otherwise makes edges shimmer through the gather.
      float j = hh(gl_FragCoord.xy);
      // ---- depth of field (orbit / garage cameras): a golden-angle gather, sharp foreground never bleeds
      if (uDof > 0.0) {
        float z = -P.z;
        float coc = clamp(uDof * abs(z - uFocus) / max(z, 0.1), 0.0, 9.0) * uRes.y / 1080.0;
        if (coc > 0.6) {
          vec3 acc = col; float wsum = 1.0;
          for (int i = 1; i < DOF_TAPS; i++){
            float fi = float(i);
            float r = sqrt(fi / float(DOF_TAPS)) * coc;
            float a = fi * 2.39996 + j * 6.28;
            vec2 o = vec2(cos(a), sin(a)) * r / uRes;
            float sz = -viewPos(vUv + o, min(rawDepth(vUv + o), 0.999999)).z;
            float scoc = clamp(uDof * abs(sz - uFocus) / max(sz, 0.1), 0.0, 9.0) * uRes.y / 1080.0;
            float w = smoothstep(r - 1.0, r + 0.5, scoc + (sz > z ? 0.0 : 3.0));
            // a soft highlight weight: bright points open into bokeh discs instead of being averaged away
            vec3 s = texture2D(tColor, vUv + o).rgb;
            w *= 1.0 + 0.6 * smoothstep(1.5, 8.0, dot(s, vec3(0.2126, 0.7152, 0.0722)) * uExposure);
            acc += s * w; wsum += w;
          }
          col = acc / wsum;
        }
      }
      gl_FragColor = vec4(min(col, vec3(250.0)), 1.0);
    }`,
};

const FinalShader = {
  uniforms: {
    tHDR: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uSpeed: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.56) },
    uShake: { value: 0 }, uFlash: { value: 0 }, uNitro: { value: 0 }, uFade: { value: 0 }, uExposure: { value: 1.0 },
    uWB: { value: new THREE.Vector3(0.96, 1.0, 1.06) },
    // grade (eased per time of day / weather) and lens
    uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1 }, uContrast: { value: 1 }, uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHiTint: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.22 }, uGrain: { value: 0.008 }, uCA: { value: 0 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    uniform sampler2D tHDR; uniform float uTime; uniform vec2 uRes; uniform vec3 uSun; uniform float uSpeed; uniform vec2 uCenter;
    uniform float uShake; uniform float uFlash; uniform float uNitro; uniform float uFade; uniform float uExposure;
    uniform vec3 uWB;
    uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform float uSat; uniform float uContrast; uniform vec3 uShadowTint; uniform vec3 uHiTint;
    uniform float uVignette; uniform float uGrain; uniform float uCA;
    varying vec2 vUv;
    ${HASH}
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    vec3 agxContrast(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
    // AgX: graceful highlight roll-off (the sea glare and the white sky keep their hue instead of skewing yellow/cyan)
    vec3 agx(vec3 color){
      const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
      const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
      color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
      color = inset * color;
      color = max(color, 1e-10); color = log2(color);
      color = (color + 12.47393) / (4.026069 + 12.47393);
      color = clamp(color, 0.0, 1.0);
      color = agxContrast(color);
      // "punchy" look in the log-encoded output
      float l = lum(color);
      color = mix(vec3(l), color, 1.18);
      color = pow(max(color, 0.0), vec3(1.08));
      color = outset * color;
      color = pow(max(vec3(0.0), color), vec3(2.2));
      color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    vec3 tex(vec2 uv){ return texture2D(tHDR, uv).rgb; }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - uCenter;
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      float r = length((uv - 0.5) * asp);
      vec3 col = tex(uv);
      // lateral chromatic aberration: off by default, a flicker of it on impacts
      float ca = uCA * r * r + uShake * 0.003;
      if (ca > 0.0002) { vec2 cd = (uv - 0.5) * ca; col.r = tex(uv - cd).r; col.b = tex(uv + cd).b; }
      // exposure + white balance (per time of day: camera set for daylight, cooler at night)
      col *= uExposure * uWB;
      col = agx(col);
      // ---- grade (display-referred): lift / gamma / gain, contrast around mid grey (endpoints fixed), saturation,
      // split tone (shadows / highlights)
      col = col * uGain + uLift * (1.0 - col);
      col = pow(max(col, 0.0), 1.0 / uGamma);
      vec3 g = sqrt(col);
      g += (uContrast - 1.0) * (g - 0.5) * 4.0 * g * (1.0 - g);
      col = g * g;
      float l = lum(col);
      col = max(mix(vec3(l), col, uSat), 0.0);
      col *= mix(uShadowTint, uHiTint, smoothstep(0.06, 0.6, l));
      // nitro: cool edge tint; impact flash
      col = mix(col, col * vec3(0.8, 0.96, 1.2) + vec3(0.0, 0.01, 0.03), uNitro * smoothstep(0.25, 0.85, length(c * asp)) * 0.7);
      // optical vignette (cos^4-ish), a touch stronger at speed
      col *= 1.0 - smoothstep(0.45, 1.3, r) * (uVignette + uSpeed * 0.08);
      col += vec3(1.0, 0.96, 0.88) * uFlash * 0.25;
      col = mix(col, vec3(0.01, 0.012, 0.016), uFade);
      vec3 o = toSRGB(clamp(col, 0.0, 1.0));
      // film grain (luma weighted, mostly in the mid-tones) + triangular dither against banding in the night sky
      vec2 fc = uv * uRes;
      float gr = hh(fc + fract(uTime * 13.0) * 917.0) - 0.5;
      o += gr * uGrain * (1.0 - o * 0.7) + (hh(fc * 1.3 + 7.0) + hh(fc * 0.71 + 3.3) - 1.0) / 255.0;
      gl_FragColor = vec4(o, 1.0);
    }`,
};

// ---- colour grade per time of day, modified by the weather. Values are display-referred (after AgX).
//  lift: raises the blacks toward a colour · gamma: mid-tones · gain: highlights · sat · contrast (1 = AgX punchy)
//  sh / hi: split-tone multipliers for shadows / highlights
const GRADE_TIMES = {
  dawn: { lift: [0.006, 0.006, 0.014], gamma: [1, 1, 1.02], gain: [1.03, 0.99, 0.97], sat: 1.0, contrast: 1.0, sh: [0.97, 0.99, 1.05], hi: [1.04, 1.0, 0.96] },
  day: { lift: [0.0, 0.002, 0.006], gamma: [1, 1, 1], gain: [1.0, 1.0, 0.99], sat: 1.04, contrast: 1.04, sh: [0.97, 1.0, 1.04], hi: [1.02, 1.0, 0.97] },
  afternoon: { lift: [0.0, 0.002, 0.006], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.97], sat: 1.05, contrast: 1.04, sh: [0.97, 1.0, 1.04], hi: [1.03, 1.0, 0.95] },
  sunset: { lift: [0.002, 0.004, 0.014], gamma: [1.02, 1.0, 0.98], gain: [1.07, 1.0, 0.88], sat: 1.1, contrast: 1.05, sh: [0.95, 0.99, 1.07], hi: [1.06, 0.99, 0.9] },
  night: { lift: [0.002, 0.006, 0.016], gamma: [0.98, 1.0, 1.03], gain: [0.98, 1.0, 1.03], sat: 0.9, contrast: 1.06, sh: [0.94, 1.0, 1.1], hi: [1.04, 1.0, 0.94] },
};
const GRADE_WEATHER = {
  clear: null,
  overcast: { lift: [0.008, 0.009, 0.011], sat: 0.86, contrast: 0.96, gain: [0.99, 1.0, 1.02], split: 0.4 },
  rain: { lift: [0.012, 0.014, 0.017], sat: 0.76, contrast: 0.93, gain: [0.97, 1.0, 1.03], split: 0.25 },
};
const V3 = ['lift', 'gamma', 'gain', 'sh', 'hi'];
function gradeFor(time, weather) {
  const t = GRADE_TIMES[time] || GRADE_TIMES.afternoon, w = GRADE_WEATHER[weather];
  const g = { lift: [...t.lift], gamma: [...t.gamma], gain: [...t.gain], sat: t.sat, contrast: t.contrast, sh: [...t.sh], hi: [...t.hi] };
  if (w) {
    for (let i = 0; i < 3; i++) {
      g.lift[i] += w.lift[i]; g.gain[i] *= w.gain[i];
      g.sh[i] = 1 + (g.sh[i] - 1) * w.split; g.hi[i] = 1 + (g.hi[i] - 1) * w.split; // flat light: little split tone
    }
    g.sat *= w.sat; g.contrast *= w.contrast;
  }
  return g;
}

/** The fixed post chain (graphics.js RENDER). There is no quality or effects argument: one look only. */
export function createPost(renderer, scene, camera) {
  const tier = RENDER;
  const size = renderer.getSize(new THREE.Vector2());
  let pr = renderer.getPixelRatio();
  const W = () => Math.max(1, Math.floor(size.x * pr)), H = () => Math.max(1, Math.floor(size.y * pr));
  const depthTex = new THREE.DepthTexture(W(), H());
  depthTex.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(W(), H(), { type: THREE.HalfFloatType, samples: 0, depthTexture: depthTex });
  const hdrRT = new THREE.WebGLRenderTarget(W(), H(), { type: THREE.HalfFloatType, depthBuffer: false });
  const mk = (sh, defines = {}) => new THREE.ShaderMaterial({ defines: { ...(sh.defines || {}), ...defines }, uniforms: THREE.UniformsUtils.clone(sh.uniforms), vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader, depthTest: false, depthWrite: false });
  const compMat = mk(CompositeShader, { DOF_TAPS: tier.dofTaps }), finalMat = mk(FinalShader);
  compMat.uniforms.tDepth.value = depthTex; compMat.uniforms.tColor.value = sceneRT.texture;
  const quad = new FullScreenQuad(null);
  const u = finalMat.uniforms;
  // ---- per-pass timing (?postprofile or post.measure()): gl.finish() fences, a relative guide on any GPU
  const gl = renderer.getContext();
  let prof = null;
  const mark = (name) => { if (!prof) return; gl.finish(); const t = performance.now(); prof.cur[name] = (prof.cur[name] || 0) + t - prof.t; prof.t = t; };
  // ---- eased grade + exposure
  const grade = { cur: null, target: null, exposure: 1, exposureTarget: 1 };
  const lerpGrade = (k) => {
    const a = grade.cur, b = grade.target;
    for (const key of V3) for (let i = 0; i < 3; i++) a[key][i] += (b[key][i] - a[key][i]) * k;
    a.sat += (b.sat - a.sat) * k; a.contrast += (b.contrast - a.contrast) * k;
    grade.exposure += (grade.exposureTarget - grade.exposure) * k;
  };
  const post = {
    u, comp: compMat.uniforms, sceneRT,
    render(dt = 1 / 60) {
      if (prof) { gl.finish(); prof.t = performance.now(); }
      lerpGrade(1 - Math.exp(-Math.min(dt, 0.25) / 0.6));
      post.applyGrade();
      camera.updateMatrixWorld();
      compMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
      compMat.uniforms.uProj.value.copy(camera.projectionMatrix);
      compMat.uniforms.uExposure.value = u.uExposure.value;
      // scene
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      mark('scene');
      // composite: only when a camera asks for depth of field (orbit / garage)
      let hdr = sceneRT;
      if (compMat.uniforms.uDof.value > 0) {
        quad.material = compMat; renderer.setRenderTarget(hdrRT); quad.render(renderer); hdr = hdrRT;
        mark('composite');
      }
      // final to screen
      u.tHDR.value = hdr.texture;
      quad.material = finalMat; renderer.setRenderTarget(null); quad.render(renderer);
      mark('final');
      if (prof) { prof.frames++; for (const k in prof.cur) { prof.sum[k] = (prof.sum[k] || 0) + prof.cur[k]; prof.cur[k] = 0; } }
    },
    setSize(w, h, p) {
      pr = p;
      size.set(w, h);
      const ww = Math.max(1, Math.floor(w * p)), hh = Math.max(1, Math.floor(h * p));
      sceneRT.setSize(ww, hh); hdrRT.setSize(ww, hh);
      compMat.uniforms.uRes.value.set(ww, hh);
      u.uRes.value.set(ww, hh);
    },
    resetHistory() { post.snapGrade(); },
    /** jump the eased grade / exposure to the current conditions (map switch, captures) */
    snapGrade() { if (grade.target) { lerpGrade(1); post.applyGrade(); } },
    /** average ms per pass over n renders of the current view (gl.finish fences) */
    measure(n = 20) {
      prof = { t: 0, frames: 0, cur: {}, sum: {} };
      for (let i = 0; i < n; i++) post.render(1 / 60);
      const out = {}; let total = 0;
      for (const k in prof.sum) { out[k] = +(prof.sum[k] / prof.frames).toFixed(2); if (k !== 'scene') total += prof.sum[k] / prof.frames; }
      out.post = +total.toFixed(2); prof = null; return out;
    },
    baseExposure: 1,
    lastConditions: null,
    /** Apply the eased environment grade to the uniforms. */
    applyGrade() {
      const g = grade.cur; if (!g) return;
      u.uLift.value.fromArray(g.lift); u.uGamma.value.fromArray(g.gamma); u.uGain.value.fromArray(g.gain);
      u.uShadowTint.value.fromArray(g.sh); u.uHiTint.value.fromArray(g.hi);
      u.uSat.value = g.sat; u.uContrast.value = g.contrast;
      u.uExposure.value = grade.exposure; u.uVignette.value = 0.22;
    },
    /** lighting state from env.js COND_STATE: exposure, white balance and the grade (no glare, rain lens or bloom) */
    setConditions(st) {
      const first = !grade.target;
      post.baseExposure = st.exposure; grade.exposureTarget = st.exposure;
      u.uWB.value.fromArray(st.wb);
      grade.target = gradeFor(ENV.COND.time, ENV.COND.weather);
      if (first) { grade.cur = structuredClone(grade.target); grade.exposure = st.exposure; }
      post.lastConditions = st;
      post.applyGrade();
    },
  };
  post.setConditions(post.lastConditions || ENV.COND_STATE);
  post.setSize(size.x, size.y, pr);
  return post;
}
