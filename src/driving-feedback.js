import * as THREE from 'three';
import { DrivingGuidance } from './driving-guidance.js';

const colors = { go: [0.15, .95, .48], prepare: [1, .68, .12], brake: [1, .18, .16] };
const preferencesKey = 'paraliaki.driving-feedback';
export class DrivingFeedback {
  constructor({ scene } = {}) {
    // World-space braking line only. The owner removed the tyre-grip HUD and its controls.
    this.scene = scene; this.guidance = new DrivingGuidance(); this.nextUpdate = 0; this.options = { line: false };
    try {
      const storage=globalThis.localStorage, saved=JSON.parse(storage?.getItem(preferencesKey)||'{}');
      this.options.line=saved.line===true;
      if(Object.hasOwn(saved,'grip')){delete saved.grip;storage?.setItem(preferencesKey,JSON.stringify(saved));}
    } catch {}
  }
  createLine() {
    // One reusable chevron mesh, at most 75 route samples. Only built on opting in.
    const count = this.guidance.capacity - 1, positions = new Float32Array(count * 9), color = new Float32Array(count * 9);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .78, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.line = new THREE.Mesh(geometry, material); this.line.name = 'driving-braking-assist'; this.line.frustumCulled = false; this.line.renderOrder = 2; this.scene.add(this.line);
  }
  update({ vehicle, route = vehicle?.route, dir, visible = true, spectating = false, wetGrip = 1, endS } = {}) {
    visible = visible && this.options.line;
    if (!visible || !vehicle) { this.nextUpdate = 0; if (this.line) this.line.visible = false; return; }
    const now = globalThis.performance?.now?.() || Date.now();
    const changed = vehicle !== this.lastVehicle || route !== this.lastRoute || dir !== this.lastDir || visible !== this.lastVisible;
    this.lastVisible = visible;
    if (!changed && now < this.nextUpdate) return;
    this.nextUpdate = now + 100; this.lastVehicle = vehicle; this.lastRoute = route; this.lastDir = dir;
    if (!this.scene || spectating && !vehicle.spec) { if (this.line) this.line.visible = false; return; }
    const guidance = this.guidance.update(vehicle, route, { dir, wetGrip, endS });
    if (!guidance.available) { if (this.line) this.line.visible = false; return; }
    if (!this.line) this.createLine(); this.line.visible = true;
    const geometry = this.line.geometry, positions = geometry.attributes.position.array, color = geometry.attributes.color.array;
    let count = 0;
    for (let i = 1; i < guidance.count - 1; i++) {
      const n = guidance.nodes[i], next = guidance.nodes[i + 1], dx = next.x - n.x, dz = next.z - n.z, len = Math.hypot(dx, dz);
      if (len < .1) continue;
      const fx = dx / len, fz = dz / len, width = Math.min(.55, Math.max(.1, (route.edge(n.s) - Math.abs(n.u)) * .65));
      const offset = count * 9;
      positions.set([n.x - fz * width, n.y, n.z + fx * width, n.x + fz * width, n.y, n.z - fx * width, n.x + fx * 1.5, n.y + (next.y - n.y) * Math.min(1, 1.5 / len), n.z + fz * 1.5], offset);
      const c = colors[n.tone]; for (let v = 0; v < 3; v++) for (let ch = 0; ch < 3; ch++) color[offset + v * 3 + ch] = c[ch]; count++;
    }
    geometry.setDrawRange(0, count * 3); geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = true;
  }
  dispose() { if (this.line) { this.line.removeFromParent(); this.line.geometry.dispose(); this.line.material.dispose(); } }
}
