// HDR post pipeline:
//  scene (MSAA, half-float colour + resolved depth)
//  -> ambient occlusion (half res, Alchemy-style from depth, bilateral blur)
//  -> composite: AO, per-pixel camera motion blur by depth reprojection (the cars themselves are masked out),
//     depth of field for the orbit / garage cameras
//  -> bloom (HDR)
//  -> final: exposure, filmic tone mapping (AgX, punchy), white balance + split-tone grade, chromatic aberration,
//     sun glare and lens ghosts, vignette, film grain, gameplay flashes (nitro / impact / fade).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const NOBLOOM = location.search.includes('nobloom');
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DEPTH_GLSL = /* glsl */`
  uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uProj;
  float rawDepth(vec2 uv){ return texture2D(tDepth, uv).r; }
  vec3 viewPos(vec2 uv, float d){ vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uInvProj * c; return v.xyz / v.w; }
`;

const AOShader = {
  uniforms: { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uRadius: { value: 1.1 }, uTime: { value: 0 } },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform vec2 uRes; uniform float uRadius; uniform float uTime;
    ${DEPTH_GLSL}
    float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
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
      float sum = 0.0; const int NS = 12;
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
  uniforms: {
    tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uBlur: { value: 0 },
    uCarInv: { value: [new THREE.Matrix4(), new THREE.Matrix4()] }, uCarHalf: { value: [new THREE.Vector3(1, 1, 2.5), new THREE.Vector3(1, 1, 2.5)] },
    uAO: { value: 0.85 }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 },
    uDof: { value: 0 }, uFocus: { value: 10 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tAO; uniform vec2 uRes; uniform float uTime;
    uniform mat4 uCamWorld; uniform mat4 uPrevVP; uniform float uBlur; uniform mat4 uCarInv[2]; uniform vec3 uCarHalf[2];
    uniform float uAO; uniform float uDof; uniform float uFocus;
    ${DEPTH_GLSL}
    float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    bool inCar(vec3 wp, int i){ vec3 l = (uCarInv[i] * vec4(wp, 1.0)).xyz; return all(lessThan(abs(l - vec3(0.0, uCarHalf[i].y, 0.0)), uCarHalf[i])); }
    void main(){
      float d = rawDepth(vUv);
      vec3 P = viewPos(vUv, min(d, 0.999999));
      vec3 col = texture2D(tColor, vUv).rgb;
      float j = hh(gl_FragCoord.xy + fract(uTime * 7.0) * 61.0);
      // ---- depth of field (orbit / garage cameras)
      if (uDof > 0.0) {
        float z = -P.z;
        float coc = clamp(uDof * abs(z - uFocus) / max(z, 0.1), 0.0, 9.0);
        if (coc > 0.6) {
          vec3 acc = col; float wsum = 1.0;
          for (int i = 1; i < 24; i++){
            float fi = float(i);
            float r = sqrt(fi / 24.0) * coc;
            float a = fi * 2.39996 + j * 6.28;
            vec2 o = vec2(cos(a), sin(a)) * r / uRes;
            float sz = -viewPos(vUv + o, min(rawDepth(vUv + o), 0.999999)).z;
            float scoc = clamp(uDof * abs(sz - uFocus) / max(sz, 0.1), 0.0, 9.0);
            float w = smoothstep(r - 1.0, r + 0.5, scoc + (sz > z ? 0.0 : 3.0)); // sharp foreground doesn't bleed
            acc += texture2D(tColor, vUv + o).rgb * w; wsum += w;
          }
          col = acc / wsum;
        }
      }
      // ---- camera motion blur from depth reprojection (anything inside the two racing cars is held still)
      if (uBlur > 0.0) {
        vec3 wp = (uCamWorld * vec4(P, 1.0)).xyz;
        bool still = inCar(wp, 0) || inCar(wp, 1) || -P.z < 0.9;
        if (!still) {
          vec4 pc = uPrevVP * vec4(wp, 1.0);
          vec2 prev = pc.xy / pc.w * 0.5 + 0.5;
          vec2 vel = (vUv - prev) * uBlur;
          float vl = length(vel * uRes);
          float mx = 0.045 * uRes.y;
          if (vl > mx) vel *= mx / vl;
          if (vl > 1.0) {
            vec3 acc = col; float wsum = 1.0;
            for (int i = 1; i <= 10; i++){
              float t = (float(i) + j - 0.5) / 10.0 - 0.5;
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
      // ---- ambient occlusion
      if (d < 0.99999) {
        float ao = texture2D(tAO, vUv).r;
        col *= mix(1.0, ao, uAO);
      }
      gl_FragColor = vec4(min(col, vec3(250.0)), 1.0);
    }`,
};

const FinalShader = {
  uniforms: {
    tHDR: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uSpeed: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.56) },
    uShake: { value: 0 }, uFlash: { value: 0 }, uNitro: { value: 0 }, uFade: { value: 0 }, uExposure: { value: 1.0 },
    uWB: { value: new THREE.Vector3(0.96, 1.0, 1.06) }, uGlare: { value: 1 }, uRainLens: { value: 0 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */`
    uniform sampler2D tHDR; uniform float uTime; uniform vec2 uRes; uniform vec3 uSun; uniform float uSpeed; uniform vec2 uCenter;
    uniform float uShake; uniform float uFlash; uniform float uNitro; uniform float uFade; uniform float uExposure;
    uniform vec3 uWB; uniform float uGlare; uniform float uRainLens;
    varying vec2 vUv;
    float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    vec3 agxContrast(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
    vec3 agx(vec3 color){
      const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
      const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
      color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
      color = inset * color;
      color = max(color, 1e-10); color = log2(color);
      color = (color + 12.47393) / (4.026069 + 12.47393);
      color = clamp(color, 0.0, 1.0);
      color = agxContrast(color);
      // "punchy" look: a little more saturation and contrast in the log domain output
      float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(l), color, 1.18);
      color = pow(max(color, 0.0), vec3(1.08));
      color = outset * color;
      color = pow(max(vec3(0.0), color), vec3(2.2));
      color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - uCenter;
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      float r = length((uv - 0.5) * asp);
      // lateral chromatic aberration (lens) + a touch more on impacts
      float ca = 0.0012 * r * r + uShake * 0.003 + uSpeed * r * 0.0015;
      vec2 cd = (uv - 0.5) * ca;
      vec3 col;
      col.r = texture2D(tHDR, uv - cd).r;
      col.g = texture2D(tHDR, uv).g;
      col.b = texture2D(tHDR, uv + cd).b;
      // sun: veiling glare, streak and lens ghosts (in scene-linear, before the tone curve)
      if (uSun.z * uGlare > 0.001) {
        vec2 sp = uSun.xy;
        float d = length((uv - sp) * asp);
        vec3 glare = vec3(1.0, 0.86, 0.66) * (exp(-d * 9.0) * 0.18 + exp(-d * 2.5) * 0.03);
        glare += vec3(1.0, 0.88, 0.7) * exp(-abs(uv.y - sp.y) * 220.0) * exp(-abs(uv.x - sp.x) * 4.0) * 0.08;
        vec2 axis = vec2(0.5) - sp;
        for (int i = 1; i <= 5; i++) {
          float fi = float(i);
          vec2 gp = sp + axis * (0.35 + fi * 0.33);
          float gd = length((uv - gp) * asp);
          float sz = 0.02 + fi * 0.018;
          float ring = smoothstep(sz, sz * 0.8, gd) * (0.6 + 0.4 * smoothstep(sz * 0.5, sz, gd));
          vec3 tint = i == 1 ? vec3(0.3, 0.7, 1.0) : i == 2 ? vec3(1.0, 0.65, 0.3) : i == 3 ? vec3(0.5, 1.0, 0.6) : i == 4 ? vec3(0.8, 0.5, 1.0) : vec3(1.0, 0.9, 0.5);
          glare += tint * ring * 0.035;
        }
        col += glare * uSun.z * uGlare;
      }
      // exposure + white balance (per time of day: camera set for daylight, cooler at night)
      col *= uExposure * uWB;
      // rain: a soft veil of scattered light (contrast drops)
      col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))) * 0.9 + 0.008, uRainLens * 0.12);
      col = agx(col);
      // grade: split-tone (cool shadows, warm highlights), gentle S-curve
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col * vec3(0.97, 1.0, 1.04), col * vec3(1.03, 1.0, 0.95), smoothstep(0.1, 0.7, l));
      // nitro: cool edge tint; impact flash
      col = mix(col, col * vec3(0.8, 0.96, 1.2) + vec3(0.0, 0.01, 0.03), uNitro * smoothstep(0.25, 0.85, length(c * asp)) * 0.7);
      // optical vignette (cos^4-ish), slightly stronger at speed
      float vig = 1.0 - smoothstep(0.45, 1.25, r) * (0.42 + uSpeed * 0.15);
      col *= vig;
      col += vec3(1.0, 0.96, 0.88) * uFlash * 0.25;
      col = mix(col, vec3(0.01, 0.012, 0.016), uFade);
      vec3 o = toSRGB(clamp(col, 0.0, 1.0));
      // film grain (luma weighted) + dither
      float g = hh(uv * uRes + fract(uTime * 13.0) * 917.0) - 0.5;
      o += g * (0.022 * (1.0 - o * 0.6)) + (hh(uv * uRes * 1.3 + 7.0) - 0.5) / 255.0;
      gl_FragColor = vec4(o, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { lowQuality = false } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const W = () => Math.max(1, Math.floor(size.x * pr)), H = () => Math.max(1, Math.floor(size.y * pr));
  const depthTex = new THREE.DepthTexture(W(), H());
  depthTex.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(W(), H(), { type: THREE.HalfFloatType, samples: lowQuality ? 0 : 4, depthTexture: depthTex });
  const hdrRT = new THREE.WebGLRenderTarget(W(), H(), { type: THREE.HalfFloatType, depthBuffer: false });
  const aoA = new THREE.WebGLRenderTarget(W() >> 1, H() >> 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const aoB = new THREE.WebGLRenderTarget(W() >> 1, H() >> 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const mk = (sh) => new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(sh.uniforms), vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader, depthTest: false, depthWrite: false });
  const aoMat = mk(AOShader), blurMat = mk(BlurShader), compMat = mk(CompositeShader), finalMat = mk(FinalShader);
  // shared matrices (same objects in both shaders)
  compMat.uniforms.uInvProj = aoMat.uniforms.uInvProj; compMat.uniforms.uProj = aoMat.uniforms.uProj;
  compMat.uniforms.uCarInv.value = [new THREE.Matrix4(), new THREE.Matrix4()];
  compMat.uniforms.uCarHalf.value = [new THREE.Vector3(1, 1, 2.5), new THREE.Vector3(1, 1, 2.5)];
  aoMat.uniforms.tDepth.value = depthTex; compMat.uniforms.tDepth.value = depthTex;
  compMat.uniforms.tColor.value = sceneRT.texture; compMat.uniforms.tAO.value = aoA.texture;
  finalMat.uniforms.tHDR.value = hdrRT.texture;
  const quad = new FullScreenQuad(null);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W() / 2, H() / 2), 0.1, 0.35, 3.0);
  const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4();
  let havePrev = false;
  const u = finalMat.uniforms;
  const post = {
    u, comp: compMat.uniforms, bloom, sceneRT,
    aoOn: !lowQuality && !location.search.includes('noao'),
    /** set before render(): cars = [{inv: Matrix4 (world->car), half: Vector3}], blur strength, dof */
    render(dt = 1 / 60) {
      camera.updateMatrixWorld();
      aoMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
      aoMat.uniforms.uProj.value.copy(camera.projectionMatrix);
      aoMat.uniforms.uTime.value = u.uTime.value;
      compMat.uniforms.uTime.value = u.uTime.value;
      compMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      compMat.uniforms.uPrevVP.value.copy(havePrev ? prevVP : curVP);
      // scene
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      // AO
      if (post.aoOn) {
        quad.material = aoMat; renderer.setRenderTarget(aoA); quad.render(renderer);
        quad.material = blurMat;
        blurMat.uniforms.tAO.value = aoA.texture; blurMat.uniforms.uDir.value.set(1 / aoA.width, 0); renderer.setRenderTarget(aoB); quad.render(renderer);
        blurMat.uniforms.tAO.value = aoB.texture; blurMat.uniforms.uDir.value.set(0, 1 / aoA.height); renderer.setRenderTarget(aoA); quad.render(renderer);
      }
      compMat.uniforms.uAO.value = post.aoOn ? 0.85 : 0;
      compMat.uniforms.uBlur.value = post.blur * (1 / 60) / Math.max(1 / 240, dt);
      quad.material = compMat; renderer.setRenderTarget(hdrRT); quad.render(renderer);
      // bloom adds onto hdrRT
      if (!NOBLOOM && !lowQuality) bloom.render(renderer, null, hdrRT, dt, false);
      // final to screen
      quad.material = finalMat; renderer.setRenderTarget(null); quad.render(renderer);
      prevVP.copy(curVP); havePrev = true;
    },
    blur: 0.5,
    setSize(w, h, p) {
      size.set(w, h);
      const ww = Math.max(1, Math.floor(w * p)), hh = Math.max(1, Math.floor(h * p));
      sceneRT.setSize(ww, hh); hdrRT.setSize(ww, hh);
      aoA.setSize(ww >> 1, hh >> 1); aoB.setSize(ww >> 1, hh >> 1);
      aoMat.uniforms.uRes.value.set(ww >> 1, hh >> 1);
      compMat.uniforms.uRes.value.set(ww, hh);
      u.uRes.value.set(ww, hh);
      bloom.setSize(ww / 2, hh / 2);
    },
    resetHistory() { havePrev = false; },
    /** lighting state from env.js COND_STATE: exposure, white balance, sun glare, bloom (night lamps glow more) */
    setConditions(st) {
      u.uExposure.value = st.exposure; u.uWB.value.fromArray(st.wb); u.uGlare.value = st.glare; u.uRainLens.value = st.rain;
      bloom.strength = 0.1 * st.bloom; bloom.threshold = 3.0 / Math.max(1, st.exposure * 0.8);
    },
  };
  post.setSize(size.x, size.y, pr);
  return post;
}
