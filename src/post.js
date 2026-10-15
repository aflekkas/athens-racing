// HDR post pipeline (the passes each effects level runs come from EFFECTS in graphics.js):
//  scene (MSAA, half-float colour + resolved depth)
//  -> ambient occlusion (half res, Alchemy-style from depth, bilateral blur)                              med+
//  -> composite: AO, per-pixel camera motion blur by depth reprojection (the cars themselves are masked out),
//     depth of field for the orbit / garage cameras, distant heat shimmer                           med+ (low: DOF only)
//  -> bloom: soft-knee threshold, Karis-weighted 13-tap downsample chain, tent upsample (dual filter)      med+
//  -> final: FXAA + contrast-adaptive sharpening, exposure, white balance, sun glare, AgX filmic tone mapping,
//     per time-of-day / weather grade (lift / gamma / gain, saturation, contrast, split tone; eased between
//     conditions), vignette, gameplay flashes, TPDF dither.
// The mirrors (cockpit.js) and the sea reflection render the scene into their own targets and never run this chain.
import * as THREE from 'three';
import * as ENV from './env.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { EFFECTS, PRESETS } from './graphics.js';
import { settings } from './settings.js';

const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const NOBLOOM = Q.has('nobloom'), NOAO = Q.has('noao');
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const HASH = 'float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }';
const DEPTH_GLSL = /* glsl */`
  uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uProj;
  float rawDepth(vec2 uv){ return texture2D(tDepth, uv).r; }
  vec3 viewPos(vec2 uv, float d){ vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uInvProj * c; return v.xyz / v.w; }
`;

const AOShader = {
  defines: { NS: 10 },
  uniforms: { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uRadius: { value: 1.1 }, uTime: { value: 0 } },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform vec2 uRes; uniform float uRadius; uniform float uTime;
    ${DEPTH_GLSL}
    ${HASH}
    void main(){
      float d = rawDepth(vUv);
      if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
      vec3 P = viewPos(vUv, d);
      vec2 px = 1.0 / uRes;
      // normal from the depth buffer: pick the smaller difference on each axis (keeps silhouettes clean)
      vec3 pl = viewPos(vUv - vec2(px.x, 0.0), rawDepth(vUv - vec2(px.x, 0.0))), pr = viewPos(vUv + vec2(px.x, 0.0), rawDepth(vUv + vec2(px.x, 0.0)));
      vec3 pd = viewPos(vUv - vec2(0.0, px.y), rawDepth(vUv - vec2(0.0, px.y))), pu = viewPos(vUv + vec2(0.0, px.y), rawDepth(vUv + vec2(0.0, px.y)));
      vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
      vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
      vec3 N = normalize(cross(dx, dy));
      float R = uRadius * clamp(-P.z * 0.06, 0.35, 2.2);
      // projected radius in pixels
      float rpx = R * uProj[1][1] * 0.5 * uRes.y / max(-P.z, 0.05);
      rpx = clamp(rpx, 2.0, 70.0);
      float sum = 0.0;
      float a0 = hh(gl_FragCoord.xy + fract(uTime) * 13.0) * 6.2831;
      float r0 = hh(gl_FragCoord.yx * 1.37 + 3.1);
      for (int i = 0; i < NS; i++){
        float fi = (float(i) + r0) / float(NS);
        float ang = a0 + float(i) * 2.39996;
        vec2 o = vec2(cos(ang), sin(ang)) * rpx * (0.12 + 0.88 * fi * fi) * px;
        vec2 suv = vUv + o;
        float sd = rawDepth(suv);
        vec3 Q = viewPos(suv, sd);
        vec3 v = Q - P;
        float vv = dot(v, v);
        float occ = max(0.0, dot(v, N) + P.z * 0.002) / (vv + 0.01);
        occ *= 1.0 - smoothstep(R * R * 0.6, R * R * 1.8, vv); // range check
        sum += occ;
      }
      float ao = max(0.0, 1.0 - 2.0 * 0.6 * sum / float(NS));
      ao = pow(ao, 1.4);
      // far away the depth buffer is too coarse to rebuild normals from (24-bit on some GPUs): AO there turns into
      // contour stripes, and it is sub-pixel anyway. Fade it out by 450 m.
      ao = mix(ao, 1.0, smoothstep(220.0, 450.0, -P.z));
      gl_FragColor = vec4(ao, -P.z, 0.0, 1.0);
    }`,
};

const BlurShader = {
  uniforms: { tAO: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tAO; uniform vec2 uDir;
    void main(){
      vec2 c = texture2D(tAO, vUv).rg; float z = c.g;
      float s = c.r, w = 1.0;
      for (int i = 1; i <= 4; i++){
        for (int k = -1; k <= 1; k += 2){
          vec2 q = texture2D(tAO, vUv + uDir * float(i * k)).rg;
          float wi = exp(-float(i * i) * 0.12) * (1.0 - smoothstep(0.0, 0.08 * z + 0.05, abs(q.g - z)));
          s += q.r * wi; w += wi;
        }
      }
      gl_FragColor = vec4(s / w, z, 0.0, 1.0);
    }`,
};

const CompositeShader = {
  defines: { BLUR_TAPS: 8, DOF_TAPS: 24 },
  uniforms: {
    tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uBlur: { value: 0 },
    uCarInv: { value: [new THREE.Matrix4(), new THREE.Matrix4()] }, uCarHalf: { value: [new THREE.Vector3(1, 1, 2.5), new THREE.Vector3(1, 1, 2.5)] },
    uAO: { value: 0.85 }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uExposure: { value: 1 },
    uHeat: { value: 0 }, uDof: { value: 0 }, uFocus: { value: 10 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tAO; uniform vec2 uRes; uniform float uTime;
    uniform mat4 uCamWorld; uniform mat4 uPrevVP; uniform float uBlur; uniform mat4 uCarInv[2]; uniform vec3 uCarHalf[2];
    uniform float uAO; uniform float uExposure; uniform float uHeat; uniform float uDof; uniform float uFocus;
    ${DEPTH_GLSL}
    ${HASH}
    bool inCar(vec3 wp, int i){ vec3 l = (uCarInv[i] * vec4(wp, 1.0)).xyz; return all(lessThan(abs(l - vec3(0.0, uCarHalf[i].y, 0.0)), uCarHalf[i])); }
    void main(){
      float d = rawDepth(vUv);
      vec3 P = viewPos(vUv, min(d, 0.999999));
      vec2 sampleUV = vUv;
      // Sub-pixel refraction only on distant, nearly horizontal sight lines.
      if (uHeat > 0.0) {
        vec3 ray = normalize((uCamWorld * vec4(P, 0.0)).xyz);
        float heat = uHeat * smoothstep(450.0, 1800.0, -P.z) * (1.0 - smoothstep(0.025, 0.11, abs(ray.y)));
        vec2 wobble = vec2(sin(vUv.y * 340.0 + uTime * 1.7), sin(vUv.x * 280.0 - uTime * 1.2));
        vec2 refracted = vUv + wobble * heat * 0.45 / uRes;
        if (abs(rawDepth(refracted) - d) < 0.0002) sampleUV = refracted;
      }
      vec3 col = texture2D(tColor, sampleUV).rgb;
      float j = hh(gl_FragCoord.xy + fract(uTime * 7.0) * 61.0);
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
      // ---- camera motion blur from depth reprojection (anything inside the two racing cars is held still)
      #if BLUR_TAPS > 0
      if (uBlur > 0.0) {
        vec3 wp = (uCamWorld * vec4(P, 1.0)).xyz;
        bool still = inCar(wp, 0) || inCar(wp, 1) || -P.z < 0.9;
        if (!still) {
          vec4 pc = uPrevVP * vec4(wp, 1.0);
          vec2 prev = pc.xy / pc.w * 0.5 + 0.5;
          vec2 vel = (vUv - prev) * uBlur;
          float vl = length(vel * uRes);
          float mx = 0.04 * uRes.y;
          if (vl > mx) vel *= mx / vl;
          if (vl > 1.0) {
            vec3 acc = col; float wsum = 1.0;
            for (int i = 1; i <= BLUR_TAPS; i++){
              float t = (float(i) + j - 0.5) / float(BLUR_TAPS) - 0.5;
              vec2 suv = vUv - vel * t;
              float sd = rawDepth(suv);
              // don't smear the (static) car body over the background
              vec3 sw = (uCamWorld * vec4(viewPos(suv, min(sd, 0.999999)), 1.0)).xyz;
              if (inCar(sw, 0) || inCar(sw, 1)) continue;
              acc += texture2D(tColor, suv).rgb; wsum += 1.0;
            }
            col = acc / wsum;
          }
        }
      }
      #endif
      // ---- ambient occlusion: full strength in the ambient-lit shade, eased off on sunlit surfaces (it only
      // stands in for the missing sky occlusion, the shadow map already darkens what the sun can't reach)
      if (uAO > 0.0 && d < 0.99999) {
        float ao = texture2D(tAO, vUv).r;
        float lit = smoothstep(0.35, 2.5, dot(col, vec3(0.2126, 0.7152, 0.0722)) * uExposure);
        col *= mix(1.0, ao, uAO * (1.0 - 0.45 * lit));
      }
      gl_FragColor = vec4(min(col, vec3(250.0)), 1.0);
    }`,
};

// ---- bloom: threshold + Karis-weighted 13-tap downsample (kills sun-glint fireflies on the sea), then 13-tap
// downsamples and 9-tap tent upsamples added back up the chain (Jimenez, "Next generation post processing in CoD:AW")
const BLOOM_DOWN = /* glsl */`
  varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; uniform float uClamp;
  float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 s(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
  #ifdef PREFILTER
  uniform float uExposureK;
  vec3 kw(vec3 a, vec3 b, vec3 c, vec3 d){ vec3 m = (a + b + c + d) * 0.25; return m / (1.0 + lum(m) * uExposureK); }
  #endif
  void main(){
    vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0), d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
    vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0), j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
    #ifdef PREFILTER
    // Karis average per 2x2 block, weights 0.5 (inner) and 4 x 0.125 (outer); then undo the 1/(1+L) bias
    vec3 o = kw(j, k, l, m) * 0.5 + (kw(a, b, d, e) + kw(b, c, e, f) + kw(d, e, g, h) + kw(e, f, h, i)) * 0.125;
    o = o / max(1.0 - lum(o) * uExposureK, 0.05);
    o = min(o, vec3(uClamp));
    // soft-knee threshold on the brightest channel
    float br = max(o.r, max(o.g, o.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee); rq = rq * rq / (4.0 * uKnee + 1e-5);
    o *= max(rq, br - uThreshold) / max(br, 1e-5);
    #else
    vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    #endif
    gl_FragColor = vec4(o, 1.0);
  }`;
const BLOOM_UP = /* glsl */`
  varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScatter;
  vec3 s(float x, float y){ return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
  void main(){
    vec3 o = s(0.0, 0.0) * 4.0 + (s(-1.0, 0.0) + s(1.0, 0.0) + s(0.0, -1.0) + s(0.0, 1.0)) * 2.0 + s(-1.0, -1.0) + s(1.0, -1.0) + s(-1.0, 1.0) + s(1.0, 1.0);
    gl_FragColor = vec4(o * (uScatter / 16.0), 1.0);
  }`;

const FinalShader = {
  defines: { FXAA: 1 },
  uniforms: {
    tHDR: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uSpeed: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.56) },
    uShake: { value: 0 }, uFlash: { value: 0 }, uNitro: { value: 0 }, uFade: { value: 0 }, uExposure: { value: 1.0 },
    uWB: { value: new THREE.Vector3(0.96, 1.0, 1.06) }, uGlare: { value: 1 }, uRainLens: { value: 0 }, 
    // grade (eased per time of day / weather) and lens
    uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1 }, uContrast: { value: 1 }, uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHiTint: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.22 }, uGrain: { value: 0.008 }, uSharpen: { value: 0 }, uCA: { value: 0 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    uniform sampler2D tHDR; uniform sampler2D tBloom; uniform float uBloom; uniform float uTime; uniform vec2 uRes; uniform vec3 uSun; uniform float uSpeed; uniform vec2 uCenter;
    uniform float uShake; uniform float uFlash; uniform float uNitro; uniform float uFade; uniform float uExposure;
    uniform vec3 uWB; uniform float uGlare; uniform float uRainLens;
    uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform float uSat; uniform float uContrast; uniform vec3 uShadowTint; uniform vec3 uHiTint;
    uniform float uVignette; uniform float uGrain; uniform float uSharpen; uniform float uCA;
    varying vec2 vUv;
    ${HASH}
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    // perceptual luma (Reinhard of the exposed luminance): what the edge detection and the sharpening work on
    float pl(vec3 c){ float l = lum(c) * uExposure; return l / (1.0 + l); }
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
      vec2 px = 1.0 / uRes;
      vec2 c = uv - uCenter;
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      float r = length((uv - 0.5) * asp);
      vec3 col = tex(uv);
      #if FXAA
      // ---- FXAA (console variant, 9 taps) on the perceptual luma; flat areas get a halo-free CAS-style sharpen instead
      {
        vec3 nw = tex(uv + vec2(-0.5, -0.5) * px), ne = tex(uv + vec2(0.5, -0.5) * px), sw = tex(uv + vec2(-0.5, 0.5) * px), se = tex(uv + vec2(0.5, 0.5) * px);
        float lNW = pl(nw), lNE = pl(ne), lSW = pl(sw), lSE = pl(se), lM = pl(col);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        if (lMax - lMin < max(0.04, lMax * 0.15)) {
          if (uSharpen > 0.0 && lM > 1e-4) {
            float avg = (lNW + lNE + lSW + lSE) * 0.25;
            float amt = uSharpen * (1.0 - smoothstep(0.0, 0.25, lMax - lMin)); // adaptive: less where contrast is high
            float t = clamp(lM + (lM - avg) * amt * 2.0, lMin, min(lMax, 0.995));
            col *= (t / (1.0 - t)) / max(lM / (1.0 - lM), 1e-5);
          }
        } else {
          vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
          float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
          float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
          dir = clamp(dir * rcp, -6.0, 6.0) * px;
          vec3 A = 0.5 * (tex(uv + dir * (1.0 / 3.0 - 0.5)) + tex(uv + dir * (2.0 / 3.0 - 0.5)));
          vec3 B = A * 0.5 + 0.25 * (tex(uv - dir * 0.5) + tex(uv + dir * 0.5));
          float lB = pl(B);
          col = (lB < lMin || lB > lMax) ? A : B;
        }
      }
      #endif
      // lateral chromatic aberration: off by default, a flicker of it on impacts
      float ca = uCA * r * r + uShake * 0.003;
      if (ca > 0.0002) { vec2 cd = (uv - 0.5) * ca; col.r = tex(uv - cd).r; col.b = tex(uv + cd).b; }
      // bloom (scene-linear, same exposure as the image)
      col += texture2D(tBloom, uv).rgb * uBloom;
      // sun: veiling glare, a faint streak and lens ghosts (in scene-linear, before the tone curve)
      if (uSun.z * uGlare > 0.001) {
        vec2 sp = uSun.xy;
        float d = length((uv - sp) * asp);
        vec3 glare = vec3(1.0, 0.86, 0.66) * (exp(-d * 9.0) * 0.16 + exp(-d * 2.5) * 0.025);
        glare += vec3(1.0, 0.88, 0.7) * exp(-abs(uv.y - sp.y) * 220.0) * exp(-abs(uv.x - sp.x) * 4.0) * 0.05;
        vec2 axis = vec2(0.5) - sp;
        for (int i = 1; i <= 4; i++) {
          float fi = float(i);
          vec2 gp = sp + axis * (0.35 + fi * 0.4);
          float gd = length((uv - gp) * asp);
          float sz = 0.02 + fi * 0.018;
          float ring = smoothstep(sz, sz * 0.75, gd) * (0.6 + 0.4 * smoothstep(sz * 0.5, sz, gd));
          vec3 tint = i == 1 ? vec3(0.3, 0.7, 1.0) : i == 2 ? vec3(1.0, 0.65, 0.3) : i == 3 ? vec3(0.5, 1.0, 0.6) : vec3(0.8, 0.5, 1.0);
          glare += tint * ring * 0.014;
        }
        col += glare * uSun.z * uGlare;
      }
      // exposure + white balance (per time of day: camera set for daylight, cooler at night)
      col *= uExposure * uWB;
      // rain: a soft veil of scattered light (contrast drops)
      col = mix(col, vec3(lum(col)) * 0.9 + 0.008, uRainLens * 0.1);
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

/** effects: an EFFECTS level ('off' | 'low' | 'med' | 'high' | 'ultra'); quality (a preset id) is the legacy form */
export function createPost(renderer, scene, camera, { lowQuality = false, quality = lowQuality ? 'low' : 'high', effects = PRESETS[quality]?.effects || 'high' } = {}) {
  if (!EFFECTS[effects]) effects = 'high';
  let tier = EFFECTS[effects];
  lowQuality = !tier.ao && !tier.blurTaps;
  const gl = renderer.getContext();
  const size = renderer.getSize(new THREE.Vector2());
  let pr = renderer.getPixelRatio();
  const W = () => Math.max(1, Math.floor(size.x * pr)), H = () => Math.max(1, Math.floor(size.y * pr));
  const depthTex = new THREE.DepthTexture(W(), H());
  depthTex.type = THREE.UnsignedIntType;
  const samples = Math.min(tier.msaa, gl.getParameter(gl.MAX_SAMPLES) || 0);
  const sceneRT = new THREE.WebGLRenderTarget(W(), H(), { type: THREE.HalfFloatType, samples, depthTexture: depthTex });
  const hdrRT = new THREE.WebGLRenderTarget(W(), H(), { type: THREE.HalfFloatType, depthBuffer: false });
  const aoA = new THREE.WebGLRenderTarget(W() >> 1, H() >> 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const aoB = new THREE.WebGLRenderTarget(W() >> 1, H() >> 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const mk = (sh, defines = {}) => new THREE.ShaderMaterial({ defines: { ...(sh.defines || {}), ...defines }, uniforms: THREE.UniformsUtils.clone(sh.uniforms), vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader, depthTest: false, depthWrite: false });
  const aoMat = mk(AOShader, { NS: Math.max(1, tier.ao) }), blurMat = mk(BlurShader);
  const compMat = mk(CompositeShader, { BLUR_TAPS: tier.blurTaps, DOF_TAPS: tier.dofTaps }), finalMat = mk(FinalShader, { FXAA: tier.fxaa ? 1 : 0 });
  // shared matrices (same objects in both shaders)
  compMat.uniforms.uInvProj = aoMat.uniforms.uInvProj; compMat.uniforms.uProj = aoMat.uniforms.uProj;
  aoMat.uniforms.tDepth.value = depthTex; compMat.uniforms.tDepth.value = depthTex;
  compMat.uniforms.tColor.value = sceneRT.texture; compMat.uniforms.tAO.value = aoA.texture;
  const quad = new FullScreenQuad(null);
  // ---- bloom chain
  let bloomMips = NOBLOOM ? 0 : tier.bloomMips;
  const mips = [];
  for (let i = 0; i < bloomMips; i++) mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  const bloomMat = (frag, defines = {}, blend = false) => new THREE.ShaderMaterial({ defines, vertexShader: VS, fragmentShader: frag, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uClamp: { value: 64 }, uExposureK: { value: 1 }, uScatter: { value: 0.85 } },
    ...(blend ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true } : {}) });
  const preMat = bloomMat(BLOOM_DOWN, { PREFILTER: 1 }), downMat = bloomMat(BLOOM_DOWN), upMat = bloomMat(BLOOM_UP, {}, true);
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blackTex.needsUpdate = true;
  finalMat.uniforms.tBloom.value = mips[0]?.texture || blackTex;
  const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4();
  let havePrev = false;
  const u = finalMat.uniforms;
  // ---- per-pass timing (?postprofile or post.measure()): gl.finish() fences, a relative guide on any GPU
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
    u, comp: compMat.uniforms, sceneRT, effects, tier,
    aoOn: tier.ao > 0 && !NOAO,
    /** per-feature switches the game may flip (settings, adaptive fallback) */
    motionBlur: true, sharpen: tier.sharpen,
    /** set before render(): cars = [{inv: Matrix4 (world->car), half: Vector3}], blur strength, dof */
    render(dt = 1 / 60) {
      if (prof) { gl.finish(); prof.t = performance.now(); }
      lerpGrade(1 - Math.exp(-Math.min(dt, 0.25) / 0.6));
      post.applyGrade();
      camera.updateMatrixWorld();
      aoMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
      aoMat.uniforms.uProj.value.copy(camera.projectionMatrix);
      aoMat.uniforms.uTime.value = u.uTime.value;
      compMat.uniforms.uTime.value = u.uTime.value;
      compMat.uniforms.uExposure.value = u.uExposure.value;
      compMat.uniforms.uHeat.value = tier.heat && ENV.COND_STATE.night === 0 && ENV.COND_STATE.over === 0 && ENV.COND_STATE.rain === 0 && ENV.sunDir.y > 0.15 ? 1 : 0;
      compMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      compMat.uniforms.uPrevVP.value.copy(havePrev ? prevVP : curVP);
      // scene
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      mark('scene');
      // AO
      if (post.aoOn) {
        quad.material = aoMat; renderer.setRenderTarget(aoA); quad.render(renderer);
        quad.material = blurMat;
        blurMat.uniforms.tAO.value = aoA.texture; blurMat.uniforms.uDir.value.set(1 / aoA.width, 0); renderer.setRenderTarget(aoB); quad.render(renderer);
        blurMat.uniforms.tAO.value = aoB.texture; blurMat.uniforms.uDir.value.set(0, 1 / aoA.height); renderer.setRenderTarget(aoA); quad.render(renderer);
        mark('ao');
      }
      compMat.uniforms.uAO.value = post.aoOn ? 0.85 : 0;
      const blur = tier.blurTaps && post.motionBlur && settings.motionBlur !== false ? post.blur : 0;
      compMat.uniforms.uBlur.value = blur * (1 / 60) / Math.max(1 / 240, dt);
      // composite: low skips it unless a camera asks for depth of field
      let hdr = sceneRT;
      if (!lowQuality || compMat.uniforms.uDof.value > 0) {
        quad.material = compMat; renderer.setRenderTarget(hdrRT); quad.render(renderer); hdr = hdrRT;
        mark('composite');
      }
      // bloom (reads the composited image, the final pass adds mips[0])
      if (mips.length && u.uBloom.value > 0) {
        const e = u.uExposure.value;
        preMat.uniforms.uThreshold.value = post.bloomThreshold / e; preMat.uniforms.uKnee.value = post.bloomThreshold * 0.5 / e;
        preMat.uniforms.uClamp.value = 40 / e; preMat.uniforms.uExposureK.value = e * 0.25;
        let src = hdr.texture, sw = hdr.width, sh = hdr.height;
        for (let i = 0; i < mips.length; i++) {
          const m = i ? downMat : preMat;
          m.uniforms.tSrc.value = src; m.uniforms.uTexel.value.set(1 / sw, 1 / sh);
          quad.material = m; renderer.setRenderTarget(mips[i]); quad.render(renderer);
          src = mips[i].texture; sw = mips[i].width; sh = mips[i].height;
        }
        // the upsamples blend onto the downsampled mips: no auto clear
        quad.material = upMat; const autoClear = renderer.autoClear; renderer.autoClear = false;
        for (let i = mips.length - 1; i > 0; i--) {
          upMat.uniforms.tSrc.value = mips[i].texture; upMat.uniforms.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
          renderer.setRenderTarget(mips[i - 1]); quad.render(renderer);
        }
        renderer.autoClear = autoClear;
        mark('bloom');
      }
      // final to screen
      u.tHDR.value = hdr.texture;
      u.uSharpen.value = post.sharpen;
      quad.material = finalMat; renderer.setRenderTarget(null); quad.render(renderer);
      mark('final');
      prevVP.copy(curVP); havePrev = true;
      if (prof) { prof.frames++; for (const k in prof.cur) { prof.sum[k] = (prof.sum[k] || 0) + prof.cur[k]; prof.cur[k] = 0; } }
    },
    blur: 0.5,
    setSize(w, h, p) {
      pr = p;
      size.set(w, h);
      const ww = Math.max(1, Math.floor(w * p)), hh = Math.max(1, Math.floor(h * p));
      sceneRT.setSize(ww, hh); hdrRT.setSize(ww, hh);
      aoA.setSize(ww >> 1, hh >> 1); aoB.setSize(ww >> 1, hh >> 1);
      aoMat.uniforms.uRes.value.set(ww >> 1, hh >> 1);
      compMat.uniforms.uRes.value.set(ww, hh);
      u.uRes.value.set(ww, hh);
      mips.forEach((m, i) => m.setSize(Math.max(1, ww >> (i + 1)), Math.max(1, hh >> (i + 1))));
    },
    /** Keep this object (weather references it); rebuild only changed GPU resources. */
    /** switch effects level live (an EFFECTS id; a preset id is accepted for older callers) */
    setQuality(next) { post.setEffects(EFFECTS[next] ? next : PRESETS[next]?.effects); },
    setEffects(next) {
      if (!EFFECTS[next] || next === post.effects) return;
      tier = EFFECTS[next]; post.effects = next; lowQuality = !tier.ao && !tier.blurTaps; post.tier = tier;
      if (finalMat.defines.FXAA !== (tier.fxaa ? 1 : 0)) { finalMat.defines.FXAA = tier.fxaa ? 1 : 0; finalMat.needsUpdate = true; }
      const nextSamples = Math.min(tier.msaa, gl.getParameter(gl.MAX_SAMPLES) || 0);
      if (sceneRT.samples !== nextSamples) { sceneRT.dispose(); sceneRT.samples = nextSamples; }
      for (const [mat, defs] of [[aoMat, { NS: Math.max(1, tier.ao) }], [compMat, { BLUR_TAPS: tier.blurTaps, DOF_TAPS: tier.dofTaps }]]) {
        Object.assign(mat.defines, defs); mat.needsUpdate = true;
      }
      bloomMips = NOBLOOM ? 0 : tier.bloomMips;
      while (mips.length > bloomMips) mips.pop().dispose();
      while (mips.length < bloomMips) mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
      u.tBloom.value = mips[0]?.texture || blackTex;
      post.aoOn = tier.ao > 0 && !NOAO; post.sharpen = tier.sharpen; post.bloomScale = tier.bloomMips ? 1 : 0;
      post.setConditions(ENV.COND_STATE); post.setSize(size.x, size.y, pr); post.resetHistory();
    },
    resetHistory() { havePrev = false; post.snapGrade(); },
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
    /** quality tiers scale bloom here (then call setConditions(post.lastConditions)); the conditions own the base value */
    bloomScale: 1, bloomThreshold: 2.5, lastConditions: null,
    /** Apply the eased environment grade to the uniforms. */
    applyGrade() {
      const g = grade.cur; if (!g) return;
      u.uLift.value.fromArray(g.lift); u.uGamma.value.fromArray(g.gamma); u.uGain.value.fromArray(g.gain);
      u.uShadowTint.value.fromArray(g.sh); u.uHiTint.value.fromArray(g.hi);
      u.uSat.value = g.sat; u.uContrast.value = g.contrast;
      u.uExposure.value = grade.exposure; u.uVignette.value = 0.22;
    },
    /** lighting state from env.js COND_STATE: exposure, white balance, sun glare, bloom (night lamps glow more), grade */
    setConditions(st) {
      const first = !grade.target;
      post.baseExposure = st.exposure; grade.exposureTarget = st.exposure;
      // effects off: tone map only (no sun glare / lens ghosts, no rain on the lens)
      u.uWB.value.fromArray(st.wb); u.uGlare.value = tier.grade ? st.glare : 0; u.uRainLens.value = tier.grade ? st.rain : 0;
      grade.target = gradeFor(ENV.COND.time, ENV.COND.weather);
      if (first) { grade.cur = structuredClone(grade.target); grade.exposure = st.exposure; }
      post.lastConditions = st;
      // bloom: night lamps, signals and light bars glow; by day only the sun glints on the sea and chrome do
      u.uBloom.value = bloomMips ? (st.night ? 0.075 : 0.04 + st.over * 0.01) * post.bloomScale : 0;
      post.bloomThreshold = st.night ? 1.6 : 2.6;
      post.applyGrade();
    },
  };
  post.bloomScale = tier.bloomMips ? 1 : 0;
  post.setConditions(post.lastConditions || ENV.COND_STATE);
  post.setSize(size.x, size.y, pr);
  return post;
}
