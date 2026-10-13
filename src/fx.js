// Tyre effects: smoke only when a tyre is really being abused (a big drift at speed, a burnout / launch with a wheel
// lit up on the spot, a locked wheel skidding at speed), skid marks and offroad ruts laid per wheel, dust and sand
// thrown up offroad (a roost of sand behind spinning wheels), sparks off walls and rails. Radiator steam is an opt-in
// hook (Fx.steam, off: the crash-damage model draws its own). Reads the physics state only (corners, cx / cy, steer,
// wheelSurf, curbHit, drift, steamAmount).
import * as THREE from 'three';
import { clamp, smoothstep } from './util.js';
import { WEATHER } from './ground.js';

const MARKS = 5000;        // skid-mark quads in the ring buffer (~1.2 km of single-wheel mark at 0.25 m spacing)
const MARK_STEP = 0.25;    // m between mark segments
const MARK_HW = 0.11;      // half the tread width

// world-sized soft sprites; per particle: size, alpha, colour, gravity, drag
class Particles {
  constructor(scene, n, { additive = false, soft = 0.5, billow = false } = {}) {
    this.n = n; this.k = 0; this.live = 0; this.billow = billow;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.age = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.roll = new Float32Array(n); this.seed = new Float32Array(n);
    this.pos.fill(-1e5);
    this.wind = { x: 0, z: 0 }; // the air the particles settle into (drag pulls them towards it)
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRoll', new THREE.BufferAttribute(this.roll, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft }, uLight: { value: 1 }, uBillow: { value: billow ? 1 : 0 },
        tDepth: { value: null }, uDepthOn: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 90000 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aCol;
        attribute float aRoll; attribute float aSeed; uniform float uScale;
        varying float vA; varying vec3 vC; varying float vRoll; varying float vSeed; varying float vDepth; varying float vRadius;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 500.0);
          vA = aAlpha; vC = aCol; vRoll = aRoll; vSeed = aSeed; vDepth = -mv.z; vRadius = aSize * 0.5; }`,
      fragmentShader: `uniform float uSoft; uniform float uLight; uniform float uBillow;
        uniform sampler2D tDepth; uniform float uDepthOn; uniform vec2 uRes; uniform float uNear; uniform float uFar;
        varying float vA; varying vec3 vC; varying float vRoll; varying float vSeed; varying float vDepth; varying float vRadius;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p,p); if (r > 1.0) discard;
          float a = vA * pow(1.0-r,1.0+uSoft*2.0); vec3 colour = vC * uLight;
          if (uBillow > 0.5) {
            float c=cos(vRoll), s=sin(vRoll); vec2 q=mat2(c,-s,s,c)*p;
            float n=0.65*noise(q*3.2+vSeed)+0.35*noise(q*7.0-vSeed+vRoll*0.35);
            float edge=1.0-smoothstep(0.60,1.0,r+(0.5-n)*0.28);
            float density=smoothstep(0.18,0.78,n)*pow(max(0.0,1.0-r),0.55);
            vec3 normal=normalize(vec3(q,sqrt(max(0.01,1.0-r))));
            float lit=0.48+0.9*max(0.0,dot(normal,normalize(vec3(-0.4,0.8,0.6))))+0.35*r;
            colour *= lit * (0.72+0.55*n); a=vA*edge*density;
          }
          // Fade into opaque geometry and the ground, never a hard circular cut.
          if (uDepthOn > 0.5) {
            float d=texture2D(tDepth,gl_FragCoord.xy/uRes).r;
            float sceneZ=uNear*uFar/(uFar-(uFar-uNear)*d);
            float cloudZ=vDepth-vRadius*sqrt(max(0.0,1.0-r))*0.25;
            a *= clamp((sceneZ-cloudZ)/max(0.15,min(0.8,vRadius*0.5)),0.0,1.0);
          }
          a *= smoothstep(0.25,0.8,vDepth); gl_FragColor=vec4(colour,a);
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5;
    if (billow) {
      // Snapshot the opaque depth at the transparent pass, without coupling Fx
      // to post.js. MSAA uses the last resolved depth; a stationary cloud is exact.
      this.pts.onBeforeRender = (renderer, scene, camera) => {
        const target = renderer.getRenderTarget(), u = this.mat.uniforms;
        u.uDepthOn.value = 0;
        if (this.live <= 0) return;
        if (!target?.depthTexture || !renderer.copyTextureToTexture) return;
        if (!this.depthRT) {
          const depth = new THREE.DepthTexture(target.width, target.height); depth.type = target.depthTexture.type; depth.format = target.depthTexture.format;
          this.depthRT = new THREE.WebGLRenderTarget(target.width, target.height, { depthTexture: depth });
        }
        if (this.depthRT.width !== target.width || this.depthRT.height !== target.height) this.depthRT.setSize(target.width, target.height);
        renderer.initRenderTarget(this.depthRT);
        renderer.copyTextureToTexture(target.depthTexture, this.depthRT.depthTexture);
        renderer.setRenderTarget(target);
        u.tDepth.value = this.depthRT.depthTexture; u.uDepthOn.value = 1;
        u.uRes.value.set(target.width, target.height); u.uNear.value = camera.near; u.uFar.value = camera.far;
      };
      this.mat.addEventListener('dispose', () => this.depthRT?.dispose());
    }
    scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, { life = 1.5, s0 = 0.4, s1 = 2, a = 0.4, r = 1, g = 1, b = 1, grav = 0, drag = 1.5 } = {}) {
    const k = this.k; this.k = (k + 1) % this.n;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.roll[k] = Math.random() * Math.PI * 2; this.seed[k] = Math.random() * 100;
    this.life[k] = life; this.age[k] = 0; this.s0[k] = s0; this.s1[k] = s1; this.a0[k] = a; this.grav[k] = grav; this.drag[k] = drag;
    this.col[k * 3] = r; this.col[k * 3 + 1] = g; this.col[k * 3 + 2] = b;
    this.live = Math.max(this.live, 3);
  }
  update(dt) {
    if (this.live <= 0) return;
    let any = false;
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      const age = (this.age[k] += dt), t = age / this.life[k];
      if (t >= 1) { this.life[k] = 0; this.alpha[k] = 0; this.pos[k * 3 + 1] = -1e5; continue; }
      any = true;
      const d = Math.exp(-this.drag[k] * dt), wx = this.wind.x, wz = this.wind.z;
      this.vel[k * 3] = wx + (this.vel[k * 3] - wx) * d; this.vel[k * 3 + 2] = wz + (this.vel[k * 3 + 2] - wz) * d;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * d - this.grav[k] * 9.81 * dt;
      if (this.billow) {
        const phase = this.seed[k] + this.age[k] * 1.4;
        this.vel[k * 3] += Math.sin(phase) * 0.28 * dt; this.vel[k * 3 + 2] += Math.cos(phase * 0.83) * 0.28 * dt;
        this.roll[k] += dt * (0.22 + 0.12 * Math.sin(phase));
      }
      for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt;
      this.size[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * Math.sqrt(t);
      this.alpha[k] = this.a0[k] * smoothstep(0, 0.08, t) * Math.pow(1 - t, this.billow ? 1.35 : 2);
    }
    if (!any) this.live--;
    const at = this.pts.geometry.attributes;
    at.position.needsUpdate = at.aSize.needsUpdate = at.aAlpha.needsUpdate = at.aCol.needsUpdate = at.aRoll.needsUpdate = at.aSeed.needsUpdate = true;
  }
}

// mark colours (rgb, alpha): rubber on tarmac, ruts in the soft stuff
const MARK_COL = { asphalt: [0.04, 0.04, 0.045, 0.6], pavement: [0.07, 0.07, 0.07, 0.45], sand: [0.42, 0.35, 0.25, 0.55], deepsand: [0.45, 0.37, 0.26, 0.65], dirt: [0.24, 0.18, 0.12, 0.5],
  grass: [0.2, 0.17, 0.1, 0.5], gravel: [0.3, 0.27, 0.22, 0.45], scrub: [0.22, 0.2, 0.13, 0.45], verge: [0.2, 0.17, 0.1, 0.5] };
// dust colours per surface
const DUST = { grass: [0.5, 0.46, 0.32], sand: [0.86, 0.78, 0.62], deepsand: [0.88, 0.8, 0.64], dirt: [0.62, 0.52, 0.4], gravel: [0.72, 0.68, 0.6], scrub: [0.6, 0.55, 0.42], verge: [0.5, 0.42, 0.3] };

export class Fx {
  constructor(scene, route, ground) {
    this.route = route; this.ground = ground;
    this.smoke = new Particles(scene, 1800, { soft: 0.8, billow: true });
    this.grit = new Particles(scene, 900, { soft: 0.2 });
    this.sparkP = new Particles(scene, 300, { additive: true, soft: 0.1 });
    this.smoke.wind.x = 1.1; this.smoke.wind.z = 0.45; // a light sea breeze carries smoke and dust off and thins it out
    this.steam = false; // opt-in radiator steam from veh.steamAmount (0..1); off: the crash-damage model owns it
    // skid marks: one ring buffer of quads, vertex rgba
    const g = new THREE.BufferGeometry();
    this.mp = new Float32Array(MARKS * 4 * 3).fill(-1e5); this.mc = new Float32Array(MARKS * 4 * 4);
    const idx = new Uint32Array(MARKS * 6);
    for (let i = 0; i < MARKS; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.mp, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.mc, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.marks = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.marks.frustumCulled = false; this.marks.renderOrder = 1; this.marks.receiveShadow = false;
    scene.add(this.marks);
    this.mk = 0; this.dirty0 = Infinity; this.dirty1 = -1;
    this.wheels = new WeakMap(); // veh -> per-wheel trail state
    this._g = {}; this._f = {}; this.acc = new WeakMap();
    // Small shared pool: only spinning tyres draw the sidewall/rim blur. The
    // overlay belongs to Fx, so model files and their wheel rigs stay independent.
    const rimG = new THREE.RingGeometry(0.27, 0.73, 40);
    const rimM = new THREE.MeshBasicMaterial({ color: 0x4c5157, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide });
    this.blurPool = Array.from({ length: 16 }, () => {
      const group = new THREE.Group(), rim = new THREE.Mesh(rimG, rimM);
      group.add(rim); group.visible = false; scene.add(group); return { group, rim };
    });
    this.tyreRest = new WeakMap(); this.deformedRigs = new WeakSet();
    this.blurUsed = 0; this._blurAxis = new THREE.Vector3(); this._blurNormal = new THREE.Vector3(0, 0, 1); this._blurPosition = new THREE.Vector3();
  }
  _groundY(veh, x, z, ox, oz) {
    const f = this.route.frame(clamp(veh.s, 0, this.route.length), this._f);
    const s = veh.s + ox * f.tx + oz * f.tz, u = veh.u + ox * f.rx + oz * f.rz;
    return this.ground ? this.ground.at(x, z, s, u, this._g).y : this.route.surfaceY(s, u);
  }
  _mark(st, x, y, z, col, a) {
    const dx = x - st.x, dz = z - st.z, d = Math.hypot(dx, dz);
    if (st.on && d < MARK_STEP) return;
    const px = -dz / (d || 1) * MARK_HW, pz = dx / (d || 1) * MARK_HW;
    if (st.on && d < 2.5) {
      const i = this.mk; this.mk = (i + 1) % MARKS;
      const P = this.mp, C = this.mc, o = i * 12, c = i * 16;
      P[o] = st.lx; P[o + 1] = st.y; P[o + 2] = st.lz; P[o + 3] = st.rx; P[o + 4] = st.y; P[o + 5] = st.rz;
      P[o + 6] = x + px; P[o + 7] = y; P[o + 8] = z + pz; P[o + 9] = x - px; P[o + 10] = y; P[o + 11] = z - pz;
      for (let v = 0; v < 4; v++) { const a0 = v < 2 ? st.a : a; C[c + v * 4] = col[0]; C[c + v * 4 + 1] = col[1]; C[c + v * 4 + 2] = col[2]; C[c + v * 4 + 3] = col[3] * a0; }
      this.dirty0 = Math.min(this.dirty0, i); this.dirty1 = Math.max(this.dirty1, i);
    }
    st.on = true; st.x = x; st.z = z; st.y = y; st.a = a;
    st.lx = x + px; st.lz = z + pz; st.rx = x - px; st.rz = z - pz;
  }
  // A stationary burnout still deposits rubber. Stamp a tyre-sized patch at a
  // bounded rate; the normal trail resumes as soon as the car moves away.
  _rubberPatch(x, y, z, fx, fz, col, a) {
    const i = this.mk; this.mk = (i + 1) % MARKS;
    for (let v = 0; v < 4; v++) {
      const along = v < 2 ? -0.18 : 0.18, across = v & 1 ? MARK_HW : -MARK_HW;
      const o = i * 12 + v * 3, c = i * 16 + v * 4;
      this.mp[o] = x + fx * along - fz * across; this.mp[o + 1] = y; this.mp[o + 2] = z + fz * along + fx * across;
      this.mc[c] = col[0]; this.mc[c + 1] = col[1]; this.mc[c + 2] = col[2]; this.mc[c + 3] = col[3] * a;
    }
    this.dirty0 = Math.min(this.dirty0, i); this.dirty1 = Math.max(this.dirty1, i);
  }
  _deformTyre(veh, i, active) {
    const rig = veh.fxWheels?.find(w => w.front === (i < 2) && (w.side ?? Math.sign(w.pivot.position.x)) === (i & 1 ? 1 : -1));
    if (!rig?.spin || (!active && !this.deformedRigs.has(rig))) return;
    if (active) this.deformedRigs.add(rig); else this.deformedRigs.delete(rig);
    const load = active ? clamp(veh.corners[i].Fz / (veh.m * 9.81 * 0.25), 0, 2) : 0;
    const squash = 1 - 0.035 * load, spread = 1 + 0.012 * load;
    const R = rig.r || veh.spec.wheelR;
    // Model.update restores suspension travel before Fx each frame; preserve its
    // body pitch/heave compensation and lower only the compressed tread radius.
    if (active) rig.pivot.position.y -= R * 0.035 * load / (rig.pivot.parent?.matrix.elements[5] || 1);
    const angle = rig.spin.rotation.x, c = Math.cos(angle), s = Math.sin(angle);
    rig.spin.traverse(mesh => {
      // Rubber/tread only: the metal rim stays circular. Clone before changing
      // vertices so shared model/traffic templates cannot inherit a deformation.
      const mat = mesh.material;
      if (!mesh.isMesh || !mat?.color || (mat.roughness ?? 0) < 0.8 || (mat.metalness ?? 0) > 0.15) return;
      let rest = this.tyreRest.get(mesh);
      if (!rest) {
        if (!active) return;
        const original = mesh.geometry; mesh.geometry = original.clone();
        mesh.geometry.addEventListener('dispose', () => original.dispose());
        rest = { p: mesh.geometry.attributes.position.array.slice(), active: false }; this.tyreRest.set(mesh, rest);
      }
      if (!active && !rest.active) return;
      const a = mesh.geometry.attributes.position;
      if (!active) a.array.set(rest.p);
      else for (let k = 0; k < a.count; k++) {
        const y = rest.p[k * 3 + 1], z = rest.p[k * 3 + 2];
        // Flatten in the non-spinning wheel frame, then rotate back: no oval
        // wobble as the rim spins through the compressed contact patch.
        const yy = (y * c - z * s) * squash, zz = (y * s + z * c) * spread;
        a.array[k * 3 + 1] = yy * c + zz * s; a.array[k * 3 + 2] = -yy * s + zz * c;
      }
      rest.active = active; a.needsUpdate = true;
    });
  }
  /** a burst of sparks where a car scraped a wall (wall normal nx, nz points back towards the car) */
  sparks(veh, strength) {
    const n = Math.round(clamp(strength, 0, 1) * 40);
    const nx = veh.wallNx ?? 0, nz = veh.wallNz ?? 0, v = veh.velocityWorld(this._v || (this._v = new THREE.Vector3()));
    let x = veh.x - nx * veh.halfW, z = veh.z - nz * veh.halfW;
    if (!nx && !nz) { const s = veh.wallSide || 1; x = veh.x + Math.cos(veh.yaw) * veh.halfW * s; z = veh.z - Math.sin(veh.yaw) * veh.halfW * s; }
    for (let i = 0; i < n; i++) {
      const o = (Math.random() - 0.5) * veh.halfL * 1.4, fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw);
      this.sparkP.emit(x + fx * o, veh.y + 0.25 + Math.random() * 0.3, z + fz * o,
        v.x * 0.7 + nx * 2 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, v.z * 0.7 + nz * 2 + (Math.random() - 0.5) * 4,
        { life: 0.25 + Math.random() * 0.35, s0: 0.07, s1: 0.03, a: 1, r: 1, g: 0.62 + Math.random() * 0.25, b: 0.25, grav: 0.8, drag: 0.6 });
    }
  }
  /** per frame: cars is a list of physics vehicles */
  update(dt, cars, camera, viewH) {
    this.smoke.mat.uniforms.uScale.value = this.grit.mat.uniforms.uScale.value = this.sparkP.mat.uniforms.uScale.value = viewH / (2 * Math.tan(camera.fov * Math.PI / 360));
    // unlit sprites: dim them with the daylight (sparks glow regardless)
    this.smoke.mat.uniforms.uLight.value = this.grit.mat.uniforms.uLight.value = 0.08 + 0.92 * clamp(WEATHER.ambient, 0, 1);
    for (const veh of cars) if (veh?.corners) for (let i = 0; i < 4; i++) {
      const surf = veh.wheelSurf?.[i] || 'asphalt';
      this._deformTyre(veh, i, !!veh.burnout && !veh.air && !veh.water && (surf === 'asphalt' || surf === 'pavement') && veh.corners[i].vw - veh.vLong > 6);
    }
    if (dt > 0) { this.blurUsed = 0; for (const b of this.blurPool) b.group.visible = false; for (const veh of cars) if (veh) this._car(veh, dt); }
    this.smoke.update(dt); this.grit.update(dt); this.sparkP.update(dt);
    if (this.dirty1 >= 0) {
      const g = this.marks.geometry, P = g.attributes.position, C = g.attributes.color;
      P.clearUpdateRanges(); C.clearUpdateRanges();
      P.addUpdateRange(this.dirty0 * 12, (this.dirty1 - this.dirty0 + 1) * 12); C.addUpdateRange(this.dirty0 * 16, (this.dirty1 - this.dirty0 + 1) * 16);
      P.needsUpdate = C.needsUpdate = true;
      this.dirty0 = Infinity; this.dirty1 = -1;
    }
  }
  clearMarks() { this.mp.fill(-1e5); this.dirty0 = 0; this.dirty1 = MARKS - 1; }
  _car(veh, dt) {
    let W = this.wheels.get(veh);
    if (!W) this.wheels.set(veh, W = [0, 1, 2, 3].map(() => ({ on: false, x: 0, z: 0, y: 0, a: 0, lx: 0, lz: 0, rx: 0, rz: 0, acc: 0, dacc: 0, heat: 0 })));
    const C4 = veh.corners; if (!C4 || C4.length < 4) return;
    const fx = -Math.sin(veh.yaw), fz = -Math.cos(veh.yaw), rx = Math.cos(veh.yaw), rz = -Math.sin(veh.yaw);
    const cs = Math.cos(veh.steer || 0), sn = Math.sin(veh.steer || 0);
    const vw = veh.velocityWorld(this._v || (this._v = new THREE.Vector3()));
    const speed = Math.hypot(vw.x, vw.z), air = veh.air;
    const t2 = (veh.track || 1.5) / 2;
    // a big drift: the whole car well sideways at speed (normal cornering and ordinary slides stay clean)
    const bigDrift = smoothstep(0.32, 0.55, veh.drift || 0) * smoothstep(11, 17, speed);
    for (let i = 0; i < 4; i++) {
      const st = W[i], Wc = C4[i];
      const cx = veh.cx ? veh.cx[i] : (i < 2 ? veh.a : -veh.b), cy = veh.cy ? veh.cy[i] : (i & 1 ? t2 : -t2);
      const ox = fx * cx + rx * cy, oz = fz * cx + rz * cy, x = veh.x + ox, z = veh.z + oz;
      // contact-patch sliding speed: patch velocity in the wheel frame against the tread speed
      const vxp = veh.vLong - veh.w * cy, vyp = veh.vLat + veh.w * cx;
      const c = i < 2 ? cs : 1, s = i < 2 ? sn : 0;
      const vgx = vxp * c + vyp * s, vgy = -vxp * s + vyp * c;
      const spinV = Wc.vw - vgx, slip = Math.hypot(spinV, vgy);
      const surf = veh.wheelSurf?.[i] ?? (veh.offroad ? 'dirt' : 'asphalt');
      const paved = surf === 'asphalt' || surf === 'pavement';
      const burnout = !!veh.burnout && spinV > 6 && Wc.sN > 1.5;
      const slideK = clamp((slip - 2.2) / 7, 0, 1) * (Wc.sN > 0.9 ? 1 : 0.4);
      if (air || veh.water > 0) { st.on = false; continue; }
      // marks: rubber when the tyre slides, ruts wherever the ground is soft
      const markA = paved ? slideK : surf === 'rock' ? 0 : Math.max(0.45 * smoothstep(0.5, 3, Math.abs(vgx)), slideK);
      if (markA > 0.04) this._mark(st, x, this._groundY(veh, x, z, ox, oz) + 0.025, z, MARK_COL[surf] || MARK_COL.dirt, Math.min(1, markA * 1.2) * (paved ? 1 - 0.6 * WEATHER.wet : 1));
      else st.on = false;
      if (paved && burnout && speed < 2) {
        st.stamp = (st.stamp || 0) + Math.min(dt, 0.1);
        if (st.stamp >= 0.2) { st.stamp %= 0.2; this._rubberPatch(x, this._groundY(veh, x, z, ox, oz) + 0.026, z, fx * c + rx * s, fz * c + rz * s, MARK_COL[surf], Math.min(1, 0.4 + st.heat) * (1 - 0.6 * WEATHER.wet)); }
      } else st.stamp = 0;
      if (burnout && paved && this.blurUsed < this.blurPool.length) {
        const { group, rim } = this.blurPool[this.blurUsed++];
        const rig = veh.fxWheels?.find(w => w.front === (i < 2) && (w.side ?? Math.sign(w.pivot.position.x)) === (i & 1 ? 1 : -1));
        const R = rig?.r || veh.spec?.wheelR || 0.31;
        const load = clamp(Wc.Fz / (veh.m * 9.81 * 0.25), 0, 2), squash = 1 - 0.025 * load;
        group.visible = true;
        group.position.set(x, this._groundY(veh, x, z, ox, oz) + R * squash, z);
        if (rig?.pivot) {
          rig.pivot.getWorldPosition(this._blurPosition); group.position.copy(this._blurPosition);
          this._blurAxis.setFromMatrixColumn(rig.pivot.matrixWorld, 0).normalize();
        } else this._blurAxis.set(rx * c - fx * s, 0, rz * c - fz * s);
        group.quaternion.setFromUnitVectors(this._blurNormal, this._blurAxis);
        group.scale.setScalar(R);
        rim.position.z = cy < 0 ? -0.46 : 0.46;
      }
      const y = veh.y + 0.15;
      if (paved) {
        // tyre smoke only when the rubber is really being cooked: a big drift with this tyre sliding hard, a burnout /
        // launch (a wheel lit up while the car barely moves), or a wheel locked solid at speed
        // (a locked wheel means a real lock-up the physics reports, ABS not catching it; not an ABS cycle or a wheel
        // that spun down in the air touching back down)
        const gvx = Math.abs(vgx);
        st.lockT = Math.abs(Wc.vw) < 0.15 * gvx && (veh.lockup || 0) > 0.4 && !veh.absOn ? (st.lockT || 0) + dt : 0;
        const locked = st.lockT > 0.25;
        const k = Math.max(bigDrift * smoothstep(7, 12, slip),
          smoothstep(6, 12, Math.abs(spinV)) * (1 - smoothstep(6, 12, gvx)),
          locked ? smoothstep(14, 22, gvx) : 0) * (1 - 0.85 * WEATHER.wet); // a wet tyre barely smokes
        // it takes sustained abuse to make a cloud: thin and translucent at first, thick only once the tyre is hot
        st.heat = k > 0.05 ? Math.min(1, st.heat + dt * k / 1.2) : Math.max(0, st.heat - dt / 0.6);
        st.acc += (burnout ? 44 : 26) * k * (0.3 + 0.7 * st.heat) * Math.min(dt, 0.1);
        while (st.acc >= 1) {
          st.acc -= 1;
          const j = Math.random(), h = st.heat, shade = 0.05 + 0.025 * (1 - h);
          this.smoke.emit(x - vw.x * dt * j, y, z - vw.z * dt * j, vw.x * 0.15 + (Math.random() - 0.5) * 0.8 - fx * spinV * 0.04, 0.35 + Math.random() * 0.5, vw.z * 0.15 + (Math.random() - 0.5) * 0.8 - fz * spinV * 0.04,
            { life: (burnout ? 3.8 : 1.1) + Math.random() * (burnout ? 1.6 : 0.9) + h * (burnout ? 2.2 : 0.8), s0: 0.35, s1: (burnout ? 3.0 : 1.8) + 2.2 * h + Math.random(), a: burnout ? 0.24 + 0.55 * h : 0.05 + 0.2 * h, r: burnout ? shade : 0.8, g: burnout ? shade : 0.8, b: burnout ? shade * 1.05 : 0.82, grav: burnout ? -0.018 : -0.025, drag: burnout ? 0.9 : 2.2 });
        }
      } else if (surf !== 'rock') {
        // dust off the soft stuff, and a roost of sand / grit behind a spinning wheel
        const D = DUST[surf] || DUST.dirt;
        const rate = (14 * smoothstep(6, 20, speed) + 26 * smoothstep(3, 10, slip)) * (1 - 0.7 * WEATHER.wet); // wet ground doesn't dust
        st.dacc += rate * dt;
        while (st.dacc >= 1) {
          st.dacc -= 1;
          this.smoke.emit(x, veh.y + 0.2, z, vw.x * 0.25 + (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.8, vw.z * 0.25 + (Math.random() - 0.5) * 1.2,
            { life: 0.9 + Math.random() * 1.1, s0: 0.5, s1: 2.4 + Math.random() * 1.5, a: surf === 'sand' || surf === 'deepsand' ? 0.14 : 0.2, r: D[0], g: D[1], b: D[2], drag: 2 });
          if (Math.abs(spinV) > 2.5) {
            const k = Math.min(1, Math.abs(spinV) / 10), dir = -Math.sign(spinV);
            this.grit.emit(x, veh.y + 0.1, z, vw.x + fx * dir * (2 + 4 * k) + (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2.5 * k, vw.z + fz * dir * (2 + 4 * k) + (Math.random() - 0.5) * 1.5,
              { life: 0.6 + Math.random() * 0.4, s0: 0.09, s1: 0.06, a: 0.95, r: D[0] * 0.85, g: D[1] * 0.85, b: D[2] * 0.85, grav: 1, drag: 0.4 });
          }
        }
      }
    }
    veh.curbHit = 0; // consumed (the kerb strike is sound / rumble / camera only: a kerb doesn't smoke)
    // radiator steam: opt-in hook, thin and intermittent with steamAmount (0..1) from the damage model
    if (this.steam && veh.steamAmount > 0) {
      const n = (this.acc.get(veh) || 0) + dt * 10 * veh.steamAmount; this.acc.set(veh, n % 1);
      for (let i = 0; i < Math.floor(n); i++) this.smoke.emit(veh.x + fx * (veh.halfL - 0.4), veh.y + 0.9, veh.z + fz * (veh.halfL - 0.4), vw.x * 0.6 + (Math.random() - 0.5), 1 + Math.random(), vw.z * 0.6 + (Math.random() - 0.5),
        { life: 0.8 + Math.random() * 0.6, s0: 0.25, s1: 1.4, a: 0.12 * veh.steamAmount, r: 0.9, g: 0.9, b: 0.9, grav: -0.05, drag: 2 });
    }
  }
}
