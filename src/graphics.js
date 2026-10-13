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
