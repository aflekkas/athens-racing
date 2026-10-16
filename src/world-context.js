// Owner-locked: the terrain and mapped block buildings provide distant context.
import * as THREE from 'three';
export function buildWorldContext(map, scene) {
  const group = new THREE.Group(); group.name = 'world-context:' + map.id;
  scene.add(group); return group;
}
