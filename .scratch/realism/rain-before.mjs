import * as THREE from 'three';
function createRain(n) {
  const base = new THREE.PlaneGeometry(1, 1); base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position);
  const off = new Float32Array(n * 4); for (let i = 0; i < off.length; i++) off[i] = Math.random();
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4)); g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uCamVel: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(44, 26, 44) },
      uCol: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uAlpha: { value: 0 }, uWind: { value: new THREE.Vector3(1.2, 0, 0.6) }, uNear: { value: 1.2 } },
    vertexShader: /* glsl */`attribute vec4 aOff; uniform float uTime; uniform vec3 uCam; uniform vec3 uCamVel; uniform vec3 uBox; uniform vec3 uWind; uniform float uNear;
      varying float vA; varying float vY;
      void main(){
        vec3 vel = vec3(uWind.x, -8.5 * (0.8 + 0.4 * aOff.w), uWind.z);
        vec3 c = uCam - uBox * 0.5;
        vec3 p = c + mod(aOff.xyz * uBox + vel * uTime - c, uBox);
        vec3 rel = vel - uCamVel; float sp = length(rel); vec3 dir = rel / max(sp, 1e-3);
        float len = clamp(sp * 0.028, 0.18, 1.8);
        vec3 toC = cameraPosition - p; float d = length(toC);
        vec3 side = normalize(cross(dir, toC / max(d, 1e-3)));
        vec3 wp = p + dir * (position.y - 0.5) * len + side * position.x * (0.007 + d * 0.0009);
        vA = smoothstep(uNear, uNear + 1.5, d) * (1.0 - smoothstep(14.0, 22.0, d));
        vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`uniform vec3 uCol; uniform float uAlpha; varying float vA; varying float vY;
      void main(){ float a = uAlpha * vA * sin(vY * 3.14159); if (a < 0.003) discard; gl_FragColor = vec4(uCol, a); }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 7; mesh.visible = false;
  return { mesh, mat };
}

// ---- spray thrown up behind wheels on a wet road (CPU particles, soft sprites lit by the ambient light)
class Spray {
  constructor(scene, n) {
    this.n = n; this.k = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3).fill(-1e5); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.age = new Float32Array(n);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uCol: { value: new THREE.Vector3(0.6, 0.6, 0.6) } },
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 300.0); vA = aAlpha; }`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard; gl_FragColor = vec4(uCol, vA * (1.0 - r) * (1.0 - r)); }`,
      transparent: true, depthWrite: false,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; this.pts.visible = false;
    scene.add(this.pts); this.g = g; this.live = 0;
  }
  emit(x, y, z, vx, vy, vz, a) {
    const k = this.k; this.k = (k + 1) % this.n;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.life[k] = 0.7 + Math.random() * 0.5; this.age[k] = 0; this.alpha[k] = a; this.live = 2;
  }
  update(dt) {
    if (this.live <= 0) return;
    let any = false;
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      const t = (this.age[k] += dt) / this.life[k];
      if (t >= 1) { this.life[k] = 0; this.alpha[k] = 0; this.pos[k * 3 + 1] = -1e5; continue; }
      any = true;
      const d = Math.exp(-2.2 * dt);
      this.vel[k * 3] *= d; this.vel[k * 3 + 2] *= d; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * d - 2.5 * dt;
      for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt;
      this.size[k] = 0.5 + 2.6 * Math.sqrt(t);
      this.alpha[k] *= 1 - dt * 1.4;
    }
    if (!any) this.live--;
    for (const a of ['position', 'aSize', 'aAlpha']) this.g.attributes[a].needsUpdate = true;
  }
}


export {createRain, Spray};
