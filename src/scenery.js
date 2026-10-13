// Distance policy shared by the GPU fades and the conservative cell culler.
// A cell is culled only after its last vertex has disappeared, never at its centre.
import * as THREE from 'three';
export const SCENERY_TIERS = {
  low: { distance: 0.65, building: 1000, horizon: 5200, pixelRatio: 0.8 },
  med: { distance: 0.85, building: 1400, horizon: 7200, pixelRatio: 1.1 },
  high: { distance: 1, building: 1800, horizon: 9000, pixelRatio: 1.5 },
};
const materials = new WeakMap();
function fadeMaterial(source, near, far) {
  let cache = materials.get(source); if (!cache) materials.set(source, cache = new Map());
  const key = `${near}:${far}`; if (cache.has(key)) return cache.get(key);
  const mat = source.clone(), compile = source.onBeforeCompile, program = source.customProgramCacheKey();
  mat.onBeforeCompile = (sh, renderer) => {
    compile.call(mat, sh, renderer);
    sh.uniforms.uSceneryRange = { value: new THREE.Vector4(near, near / 0.78, far * 0.78, far) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSceneryDistance;')
      .replace('#include <project_vertex>', `
        vec4 sceneryP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          // One fade value per tree: leaves and trunks dissolve together.
          sceneryP = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #endif
        vSceneryDistance = length((modelMatrix * sceneryP).xz - cameraPosition.xz);
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSceneryDistance; uniform vec4 uSceneryRange;')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        float sceneryNoise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
        float sceneryOut = smoothstep(uSceneryRange.z, uSceneryRange.w, vSceneryDistance);
        if (sceneryNoise < sceneryOut) discard;
        // Complementary masks keep both LODs from darkening the overlap.
        if (uSceneryRange.x > 0.0 && sceneryNoise >= smoothstep(uSceneryRange.x, uSceneryRange.y, vSceneryDistance)) discard;`);
  };
  mat.customProgramCacheKey = () => `${program}:scenery-fade-v1`;
  cache.set(key, mat); return mat;
}
/** Keep a cheap, footprint-exact building shell beyond the detailed facade range.
 * Geometry impostors preserve irregular OSM roofs from every viewing direction. */
export function addBuildingImpostors(group, quality = 'high') {
  const tier = SCENERY_TIERS[quality] || SCENERY_TIERS.high;
  const shell = new THREE.MeshLambertMaterial({color: '#eee5d3'});
  shell.customProgramCacheKey = () => 'riviera-building-shell-v1';
  shell.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aB; attribute vec2 aF; varying vec4 vShellB; varying vec2 vShellF;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShellB=aB; vShellF=aF;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vShellB; varying vec2 vShellF;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float seed=fract(vShellB.z*7.13);
        diffuseColor.rgb *= mix(vec3(0.78,0.73,0.62),vec3(1.0),step(0.45,seed));
        if(vShellB.w<0.5 || vShellB.w>1.5){
          vec2 bay=fract(vShellF/vec2(3.3,3.1));
          float win=step(0.22,bay.x)*step(bay.x,0.79)*step(0.25,bay.y)*step(bay.y,0.82);
          diffuseColor.rgb*=1.0-win*0.65;
        }`);
  };
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || !mesh.geometry.attributes.aB) continue;
    mesh.userData.lod = true; mesh.userData.far = tier.building; mesh.userData.sceneryScaled = true;
    mesh.boundingSphere = mesh.geometry.boundingSphere;
    const far = new THREE.Mesh(mesh.geometry, shell);
    far.userData = {dynamic:true, lod:true, near:tier.building * 0.78, far:tier.horizon, sceneryScaled:true};
    far.boundingSphere = mesh.boundingSphere; far.layers.mask = mesh.layers.mask; far.receiveShadow = false;
    group.add(far);
  }
}
export function prepareSceneryLod(scene, quality = 'high') {
  const tier = SCENERY_TIERS[quality] || SCENERY_TIERS.high, list = [];
  scene.traverse(mesh => {
    if (!(mesh.isInstancedMesh || mesh.userData.lod) || !mesh.userData.far || !mesh.boundingSphere) return;
    if (!mesh.userData.sceneryScaled) {
      mesh.userData.far *= tier.distance; mesh.userData.near = (mesh.userData.near || 0) * tier.distance;
      mesh.userData.sceneryScaled = true;
    }
    if (!mesh.userData.sceneryPrepared) {
      mesh.material = fadeMaterial(mesh.material, mesh.userData.near || 0, mesh.userData.far);
      mesh.userData.sceneryPrepared = true;
    }
    list.push(mesh);
  });
  return list;
}
const center = new THREE.Vector3();
export function updateSceneryLod(list, camera) {
  for (const mesh of list) {
    center.copy(mesh.boundingSphere.center).applyMatrix4(mesh.matrixWorld);
    const d = Math.hypot(center.x-camera.position.x, center.z-camera.position.z), r = mesh.boundingSphere.radius;
    mesh.visible = d-r < mesh.userData.far+20 && (!mesh.userData.near || d+r > mesh.userData.near-20);
  }
}
