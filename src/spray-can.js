// Shared prop for preset characters. Origin is the hand joint;
// the nozzle is (0, .015, .045), the can body extends down through the grip.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function sprayCanGeometry(color = '#ef57aa') {
  const parts = [];
  const add = (g, paint) => {
    const c = new THREE.Color(paint), n = g.attributes.position.count, colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(g.toNonIndexed()); g.dispose();
  };
  const body = new THREE.CylinderGeometry(.034, .034, .14, 10); body.translate(0, -.068, .045); add(body, '#b6bfc0');
  const label = new THREE.CylinderGeometry(.0345, .0345, .075, 10); label.translate(0, -.073, .045); add(label, color);
  const shoulder = new THREE.CylinderGeometry(.018, .034, .015, 10); shoulder.translate(0, .009, .045); add(shoulder, '#8b9294');
  const nozzle = new THREE.BoxGeometry(.017, .013, .019); nozzle.translate(0, .018, .046); add(nozzle, '#eee8df');
  const hole = new THREE.BoxGeometry(.007, .005, .003); hole.translate(0, .019, .057); add(hole, '#1d282b');
  const g = mergeGeometries(parts); parts.forEach(p => p.dispose()); g.computeBoundingSphere(); return g;
}
