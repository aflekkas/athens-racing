import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signFaceOffset } from './sign-mount.js';
import { squarePost } from './world-prop-geometries.js';
// Shared by the rendered arches and the cockpit-clearance raycast guard.
export function gantryLegFrame(route, s, material, kind = 'road', dir = 1) {
  const height = kind === 'road' ? 7.5 : 7, width = kind === 'road' ? (route.streetCircuit&&route.from==='Faros'?.18:.5) : .45;
  const f = route.frame(s, {}), group = new THREE.Group();
  group.position.copy(route.point(s, 0));
  group.rotation.y = Math.atan2(f.tx, f.tz) + (dir > 0 ? Math.PI : 0);
  const leg = squarePost(width, height, width, 'gantry'); leg.translate(0, height / 2, 0);
  if(kind==='road'&&route.streetCircuit&&route.from==='Faros'){
    // Both static supports share one draw, preserving the exact same world-space vertices and raycast guard.
    const parts=[-1,1].map(side=>leg.clone().translate(side*(route.edge(s)+1.2),0,0));
    const mesh=new THREE.Mesh(mergeGeometries(parts),material);mesh.name='gantry-leg';mesh.castShadow=true;group.add(mesh);
    for(const p of parts)p.dispose();leg.dispose();
  }else for (const side of [-1, 1]) {
    const mesh = new THREE.Mesh(leg, material); mesh.name = 'gantry-leg';
    mesh.position.x = side * (route.edge(s) + 1.2); mesh.castShadow = true; group.add(mesh);
  }
  return group;
}
// Megara's existing single batched cantilever pier; keep it in the prop batch.
export function megaraGantryPier(route, s) {
  const p = route.point(s, -route.edge(s) - 1.2);
  return { x: p.x, y: route.frame(s, {}).y + 3.35, z: p.z, width: 1.5, height: 6.7, depth: .6, yaw: Math.atan2(-route.frame(s, {}).tx, -route.frame(s, {}).tz) };
}

export function megaraGantryLabels(route, s, makeLabel) {
  const group = new THREE.Group(), f = route.frame(s, {});
  const p = route.point(s, -route.edge(s) - 1.2 + 6);
  const yaw = Math.atan2(-f.tx, -f.tz), offset = signFaceOffset(.7);
  const front = makeLabel('START', 5.8, 1.05, '#eeeee5', '#111111');
  for (const side of [1, -1]) {
    const label = side === 1 ? front : front.clone();
    label.position.set(p.x - side * f.tx * offset, f.y + 6.36, p.z - side * f.tz * offset);
    label.rotation.set(0, yaw + (side < 0 ? Math.PI : 0), 0);
    group.add(label);
  }
  return group;
}
