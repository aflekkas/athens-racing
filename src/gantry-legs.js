import * as THREE from 'three';
import { squarePost } from './world-prop-geometries.js';
// Shared by the rendered arches and the cockpit-clearance raycast guard.
export function gantryLegFrame(route, s, material, kind = 'road', dir = 1) {
  const height = kind === 'road' ? 7.5 : 7, width = kind === 'road' ? .5 : .45;
  const f = route.frame(s, {}), group = new THREE.Group();
  group.position.copy(route.point(s, 0));
  group.rotation.y = Math.atan2(f.tx, f.tz) + (dir > 0 ? Math.PI : 0);
  const leg = squarePost(width, height, width, 'gantry'); leg.translate(0, height / 2, 0);
  for (const side of [-1, 1]) {
    const mesh = new THREE.Mesh(leg, material); mesh.name = 'gantry-leg';
    mesh.position.x = side * (route.edge(s) + 1.2); mesh.castShadow = true; group.add(mesh);
  }
  return group;
}
// Megara's existing single batched cantilever pier; keep it in the prop batch.
export function megaraGantryPier(route, s) {
  const p = route.point(s, -route.edge(s) - 1.2);
  return { x: p.x, y: route.frame(s, {}).y + 3.35, z: p.z, width: 1.5, height: 6.7, depth: .6, yaw: route.heading(s) };
}
