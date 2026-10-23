// Paint-only wear: no textures, meshes, lights or physics state. Local contact history
// is not on the wire, so both dirt and scuffs are hidden on every online car.
import * as THREE from 'three';
const ZONES = ['front', 'rear', 'left', 'right'];
const LOOSE = Object.freeze({ dirt: 1, gravel: .7, sand: .8, deepsand: 1, grass: .45, scrub: .55 });
const bounded = (n, max = 1) => Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
export const CAR_SURFACE_BYTES = 4 * (16 + 4 + 16 + 4); // inverse, dirt, four vec4 contacts, enable/size

const fragment = `
varying vec3 vCarSurface;
uniform vec4 carDirt;
uniform vec4 carScuffs[4];
uniform vec4 carSurfaceSize;
float carGrain(vec3 p) {
  vec3 q = floor(p);
  return fract(sin(dot(q, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
`;
const apply = `
if (carSurfaceSize.w > 0.5 && dot(carDirt, vec4(1.0)) + carScuffs[0].w + carScuffs[1].w + carScuffs[2].w + carScuffs[3].w > 0.0) {
  vec3 p = vCarSurface;
  float grain = carGrain(p * 105.0);
  float side = smoothstep(0.2, 0.8, abs(p.x) / carSurfaceSize.x);
  float leftDirt = mix(carDirt.z, carDirt.x, smoothstep(0.0, 0.45, -p.z));
  float rightDirt = mix(carDirt.w, carDirt.y, smoothstep(0.0, 0.45, -p.z));
  float amount = mix(leftDirt, rightDirt, smoothstep(-0.15, 0.15, p.x));
  float edge = 0.49 + 0.07 * sin(p.z * 13.0 + p.x * 7.0) + 0.035 * sin(p.z * 39.0);
  float lower = 1.0 - smoothstep(edge - 0.15, edge + 0.15, p.y);
  float wheelWake = 0.4 + 0.6 * pow(abs(sin((p.z + carSurfaceSize.y * 0.24) * 2.2)), 3.0);
  float dirt = amount * lower * mix(0.45, wheelWake, side) * (0.52 + grain * 0.48);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.145, 0.09), dirt * 0.72);
  for (int i = 0; i < 4; i++) {
    if (carScuffs[i].w <= 0.0) continue;
    vec3 d = p - carScuffs[i].xyz;
    bool flank = i > 1;
    float along = flank ? d.z : d.x;
    float depth = flank ? d.x : d.z;
    float radius = length(vec3(along / 0.65, d.y / 0.22, depth / 0.26));
    float patch = 1.0 - smoothstep(0.55, 1.0, radius);
    float scratch = 1.0 - smoothstep(0.055, 0.115, abs(fract((d.y + 0.018 * sin(along * 19.0)) * 32.0) - 0.5));
    float broken = step(0.26, carGrain(vec3(along * 27.0, d.y * 63.0, float(i))));
    float wear = patch * carScuffs[i].w;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.065, 0.055), wear * 0.32);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.43, 0.44, 0.42), wear * scratch * broken * 0.8);
  }
}
`;

export function installCarSurface(car) {
  if (car.surface || !car.paint || !car.body || !car.dims) return car;
  const dirt = new THREE.Vector4(), scuffs = ZONES.map(() => new THREE.Vector4());
  const size = new THREE.Vector4(car.dims.W / 2, car.dims.L, car.dims.H, 0);
  const inverse = new THREE.Matrix4();
  const surface = car.surface = { dirt, scuffs, size, inverse, contactEpoch: null, bytes: CAR_SURFACE_BYTES };
  const paint = car.paint, before = paint.onBeforeCompile, key = paint.customProgramCacheKey();
  paint.customProgramCacheKey = () => key + ':car-surface-v1';
  paint.onBeforeCompile = function(shader, renderer) {
    before.call(this, shader, renderer);
    const originalBytes = shader.vertexShader.length + shader.fragmentShader.length;
    Object.assign(shader.uniforms, { carDirt: { value: dirt }, carScuffs: { value: scuffs }, carSurfaceSize: { value: size }, carSurfaceInverse: { value: inverse } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCarSurface;\nuniform mat4 carSurfaceInverse;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarSurface = (carSurfaceInverse * modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + fragment)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + apply);
    surface.shaderBytes = shader.vertexShader.length + shader.fragmentShader.length - originalBytes;
  };
  paint.needsUpdate = true; // exactly once; wear updates mutate uniforms only
  const clear = () => { dirt.set(0, 0, 0, 0); for (const p of scuffs) p.set(0, 0, 0, 0); };
  const setDamage = car.setDamage;
  car.setDamage = function(zone, value, hit) {
    const old = this.damage?.[zone] || 0;
    const result = setDamage?.call(this, zone, value, hit), i = ZONES.indexOf(zone);
    if (i < 0) return result;
    const total = bounded(this.damage?.[zone]);
    if (total < old) {
      scuffs[i].w = Math.min(scuffs[i].w, total);
      if (ZONES.every(z => !this.damage?.[z])) clear();
    } else if (total > old && hit?.localPoint) {
      const p = hit.localPoint;
      if ([p.x, p.y, p.z].every(Number.isFinite)) {
        scuffs[i].set(Math.max(-car.dims.W / 2, Math.min(car.dims.W / 2, p.x)), Math.max(.15, Math.min(car.dims.H, p.y)), Math.max(-car.dims.L / 2, Math.min(car.dims.L / 2, p.z)), Math.min(.85, total * 1.4));
      }
    }
    return result;
  };
  const snapshot = car.setDamageSnapshot;
  car.setDamageSnapshot = function(...args) { size.w = 0; return snapshot?.apply(this, args); };
  car.updateSurface = (dt, vehicle, detail = true, online = false) => {
    // reset() replaces the four contact records even for an undamaged but dirty car.
    if (surface.contactEpoch !== vehicle.corners) { clear(); surface.contactEpoch = vehicle.corners; }
    size.w = detail && !online ? 1 : 0;
    car.body.updateWorldMatrix(true, false); inverse.copy(car.body.matrixWorld).invert();
    if (online || vehicle.air || vehicle.bodyDynamic) return;
    const distance = bounded(Math.hypot(vehicle.vLong, vehicle.vLat), 70) * bounded(dt, .1);
    for (let i = 0; i < 4; i++) {
      if (!(vehicle.corners?.[i]?.Fz > 1)) continue;
      const rate = LOOSE[vehicle.wheelSurf?.[i]] || 0;
      dirt.setComponent(i, Math.min(.8, dirt.getComponent(i) + distance * rate / 230));
    }
  };
  const dispose = car.disposeDamage;
  car.disposeDamage = function(...args) { clear(); size.w = 0; return dispose?.apply(this, args); };
  return car;
}
