import * as THREE from 'three';
import { objectiveTarget } from './driving-objectives.js';

// One lightweight current target, shared by offline and online driving modes.
// World markers have no collision body: pickup/dropoff remains on driveable tarmac.
export class DrivingModeView {
  constructor(scene, route) {
    this.scene = scene; this.route = route;
    this.root = new THREE.Group(); this.root.name = 'driving-objective'; this.root.visible = false; scene.add(this.root);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(8.5, 9, 40), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide, transparent: true, opacity: .72, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.root.add(this.ring);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, 7, 6), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: .55 }));
    this.beacon.position.y = 3.5; this.root.add(this.beacon);
    // Simple visual passenger, no dialogue or separate AI/collision simulation.
    this.passenger = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.22, .28, 1.15, 7), new THREE.MeshLambertMaterial({ color: 0x384c64 })); body.position.y = .8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.18, 7, 6), new THREE.MeshLambertMaterial({ color: 0xc49a7a })); head.position.y = 1.58;
    this.passenger.add(body, head); this.root.add(this.passenger);
    this.canvas = document.createElement('canvas'); this.canvas.width = 640; this.canvas.height = 96;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true })); this.label.scale.set(9, 1.35, 1); this.label.position.y = 4.8; this.root.add(this.label);
    this.key = '';
  }
  update(objective, routes, active = true) {
    const target = objective && routes?.length ? objectiveTarget(objective, routes) : null;
    this.root.visible = !!target && active;
    if (!this.root.visible) return;
    const key = `${objective.mode}:${objective.routeIndex}:${objective.phase}`;
    if (this.key === key) return;
    this.key = key;
    const color = objective.phase === 'dropoff' ? 0x62e9bf : objective.mode === 'getaway' ? 0xf4a879 : 0xffd34d;
    this.ring.material.color.setHex(color); this.beacon.material.color.setHex(color);
    const y = this.route?.surfaceY ? this.route.surfaceY(target.s, target.u) : target.y;
    this.root.position.set(target.x, y + .12, target.z);
    this.passenger.visible = objective.mode === 'taxi' && objective.phase === 'pickup';
    const ctx = this.canvas.getContext('2d'); ctx.clearRect(0, 0, 640, 96); ctx.fillStyle = '#10171dec'; ctx.beginPath();ctx.roundRect(0,0,640,96,12);ctx.fill();ctx.strokeStyle='#'+color.toString(16).padStart(6,'0');ctx.lineWidth=5;ctx.stroke();
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.font = '800 32px Barlow Condensed, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(target.label, 320, 40);
    ctx.fillStyle = '#ffffff'; ctx.font = '800 22px Barlow Condensed, sans-serif'; ctx.fillText('STOP BELOW 8 KM/H · HOLD 1.5 S', 320, 75); this.texture.needsUpdate = true;
  }
  dispose() { this.root.removeFromParent(); this.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); this.texture.dispose(); }
}
