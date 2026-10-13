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
  constructor(scene, n, { additive = false, soft = 0.5 } = {}) {
    this.n = n; this.k = 0; this.live = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.age = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.pos.fill(-1e5);
    this.wind = { x: 0, z: 0 }; // the air the particles settle into (drag pulls them towards it)
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft }, uLight: { value: 1 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aCol; uniform float uScale;
        varying float vA; varying vec3 vC;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 400.0); vA = aAlpha; vC = aCol; }`,
      fragmentShader: `uniform float uSoft; uniform float uLight; varying float vA; varying vec3 vC;
        void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard;
          float a = vA * pow(1.0 - r, 1.0 + uSoft * 2.0); gl_FragColor = vec4(vC * uLight, a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5;
    scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, { life = 1.5, s0 = 0.4, s1 = 2, a = 0.4, r = 1, g = 1, b = 1, grav = 0, drag = 1.5 } = {}) {
    const k = this.k; this.k = (k + 1) % this.n;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
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
      for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt;
      this.size[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * Math.sqrt(t);
      this.alpha[k] = this.a0[k] * smoothstep(0, 0.08, t) * (1 - t) * (1 - t);
    }
    if (!any) this.live--;
    const at = this.pts.geometry.attributes;
    at.position.needsUpdate = at.aSize.needsUpdate = at.aAlpha.needsUpdate = at.aCol.needsUpdate = true;
  }
}

// mark colours (rgb, alpha): rubber on tarmac, ruts in the soft stuff
const MARK_COL = { asphalt: [0.04, 0.04, 0.045, 0.6], pavement: [0.07, 0.07, 0.07, 0.45], sand: [0.42, 0.35, 0.25, 0.55], deepsand: [0.45, 0.37, 0.26, 0.65], dirt: [0.24, 0.18, 0.12, 0.5],
  gravel: [0.3, 0.27, 0.22, 0.45], scrub: [0.22, 0.2, 0.13, 0.45], verge: [0.2, 0.17, 0.1, 0.5] };
// dust colours per surface
const DUST = { sand: [0.86, 0.78, 0.62], deepsand: [0.88, 0.8, 0.64], dirt: [0.62, 0.52, 0.4], gravel: [0.72, 0.68, 0.6], scrub: [0.6, 0.55, 0.42], verge: [0.5, 0.42, 0.3] };

export class Fx {
  constructor(scene, route, ground) {
    this.route = route; this.ground = ground;
    this.smoke = new Particles(scene, 1800, { soft: 0.8 });
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
    if (dt > 0) for (const veh of cars) if (veh) this._car(veh, dt);
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
      const slideK = clamp((slip - 2.2) / 7, 0, 1) * (Wc.sN > 0.9 ? 1 : 0.4);
      if (air || veh.water > 0) { st.on = false; continue; }
      // marks: rubber when the tyre slides, ruts wherever the ground is soft
      const markA = paved ? slideK : surf === 'rock' ? 0 : Math.max(0.45 * smoothstep(0.5, 3, Math.abs(vgx)), slideK);
      if (markA > 0.04) this._mark(st, x, this._groundY(veh, x, z, ox, oz) + 0.025, z, MARK_COL[surf] || MARK_COL.dirt, Math.min(1, markA * 1.2) * (paved ? 1 - 0.6 * WEATHER.wet : 1));
      else st.on = false;
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
        st.acc += 26 * k * (0.3 + 0.7 * st.heat) * dt;
        while (st.acc >= 1) {
          st.acc -= 1;
          const j = Math.random(), h = st.heat;
          this.smoke.emit(x - vw.x * dt * j, y, z - vw.z * dt * j, vw.x * 0.15 + (Math.random() - 0.5) * 0.8 - fx * spinV * 0.04, 0.35 + Math.random() * 0.5, vw.z * 0.15 + (Math.random() - 0.5) * 0.8 - fz * spinV * 0.04,
            { life: 1.1 + Math.random() * 0.9 + h * 0.8, s0: 0.35, s1: 1.8 + 2.2 * h + Math.random(), a: 0.05 + 0.2 * h, r: 0.8, g: 0.8, b: 0.82, grav: -0.025, drag: 2.2 });
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
