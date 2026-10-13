import * as THREE from 'three';
import { CU } from './env.js';
// Keep the course and car geometry intact while reducing expensive per-pixel
// atmosphere/water work on software rendering and low-end graphics devices.
export function simplifyScenery(sky, skyCube, water, terrain) {
  const oldSky = sky.material;
  sky.material = new THREE.ShaderMaterial({
    uniforms: { skyCube: { value: skyCube } }, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){vDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww;}',
    fragmentShader: 'uniform samplerCube skyCube; varying vec3 vDir; void main(){gl_FragColor=vec4(textureCube(skyCube,normalize(vDir)).rgb,1.0);}',
  });
  oldSky.dispose();
  const oldWater = water.mesh.material;
  const sea = new THREE.ShaderMaterial({
    uniforms: { skyCube: { value: skyCube }, time: oldWater.uniforms.uTime, uBody: CU.uSeaBody }, // body colour follows the time of day (env.js)
    vertexShader: 'varying vec3 world; void main(){world=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);}',
    fragmentShader: `uniform samplerCube skyCube; uniform float time; uniform vec3 uBody; varying vec3 world;
      void main(){vec3 v=normalize(cameraPosition-world);vec3 n=normalize(vec3(.018*sin(world.x*.08+time),1.,.016*cos(world.z*.07+time*.7)));
      float f=.02+.98*pow(1.-max(dot(n,v),0.),5.);vec3 reflected=textureCube(skyCube,reflect(-v,n)).rgb;
      gl_FragColor=vec4(mix(uBody,reflected,f),1.);}`,
  });
  water.mesh.material = sea;
  const ground = new THREE.MeshLambertMaterial({ vertexColors: true });
  terrain.group.traverse(o => { if (o.isMesh) o.material = ground; });
  terrain.material.dispose();
}
