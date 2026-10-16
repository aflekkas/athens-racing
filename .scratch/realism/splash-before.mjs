import * as THREE from 'three';const WATER_Y=0,clamp=THREE.MathUtils.clamp;
export class Splash {
  constructor(scene) {
    const N = this.N = 420;
    const g = new THREE.BufferGeometry();
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.life = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const c = dot.getContext('2d'), gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(240,248,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false, color: '#eef6fa' }));
    this.pts.frustumCulled = false; this.pts.visible = false; scene.add(this.pts);
    const ringGeo = new THREE.RingGeometry(0.8, 1.6, 40); ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#f4fbff', transparent: true, opacity: 0, depthWrite: false }));
    this.ring.visible = false; scene.add(this.ring);
    this.t = 9; this.k = 0;
  }
  burst(x, z, vx, vz, power = 1) {
    const n = Math.round(clamp(power, 0.3, 1) * this.N);
    for (let i = 0; i < n; i++) {
      const k = (this.k++) % this.N, a = Math.random() * Math.PI * 2, r = Math.random() * 1.6;
      this.p[k * 3] = x + Math.cos(a) * r; this.p[k * 3 + 1] = WATER_Y + 0.1; this.p[k * 3 + 2] = z + Math.sin(a) * r;
      const out = 1.5 + Math.random() * 4 * power, up = 2 + Math.random() * 7 * power;
      this.v[k * 3] = Math.cos(a) * out + vx * 0.35; this.v[k * 3 + 1] = up; this.v[k * 3 + 2] = Math.sin(a) * out + vz * 0.35;
      this.life[k] = 0.8 + Math.random() * 1.2;
    }
    this.ring.position.set(x, WATER_Y + 0.04, z); this.ring.scale.setScalar(1); this.ring.visible = true; this.pts.visible = true; this.t = 0;
  }
  update(dt) {
    if (this.t > 4) return;
    this.t += dt;
    for (let k = 0; k < this.N; k++) {
      if (this.life[k] <= 0) { this.p[k * 3 + 1] = -999; continue; }
      this.life[k] -= dt; this.v[k * 3 + 1] -= 9.81 * dt;
      for (let a = 0; a < 3; a++) this.p[k * 3 + a] += this.v[k * 3 + a] * dt;
      if (this.p[k * 3 + 1] < WATER_Y) this.life[k] = 0;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.ring.scale.setScalar(1 + this.t * 3.5); this.ring.material.opacity = Math.max(0, 0.75 - this.t * 0.3);
    if (this.t > 4) { this.pts.visible = false; this.ring.visible = false; }
  }
}
