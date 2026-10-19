import { batchStatic } from './batch.js';
import { assertWorldBudget } from './world-art-direction.js';
import * as THREE from 'three';

/** One solid cross-street box per OSM exit. The same list drives visuals and physics. */
export function roadworksForEvent(data, def) {
  return def && !def.free && ['sprint', 'timetrial'].includes(def.type) ? (data.roadworks || []) : [];
}

export function buildRoadworks(map, scene, ground, assets = {}) {
  if (!map.data.roadworks?.length) return null;
  const group = new THREE.Group(); group.name = 'race-roadworks'; group.visible = false; scene.add(group);
  const blocks = map.data.roadworks || [], orange = new THREE.MeshStandardMaterial({ color: '#ec601c', roughness: .85 });
  const white = new THREE.MeshStandardMaterial({ color: '#eee8d6', roughness: .85 });
  const dark = new THREE.MeshStandardMaterial({ color: '#32373c', roughness: .95 });
  const box = assertWorldBudget('barrierPost',new THREE.BoxGeometry(1, 1, 1)), cone = assertWorldBudget('streetProp',new THREE.ConeGeometry(.23, .68, 4));
  function mesh(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  for (const b of blocks) {
    const root = new THREE.Group(); root.name = 'roadworks:' + b.id;
    const at = (x, z) => ground.network?.height(x, z) ?? ground.heightC(x, z), sin = Math.sin(b.yaw), cos = Math.cos(b.yaw);
    // Local ground offset at (lx,lz): each barrier section and cone follows a sloping street.
    const y = at(b.x, b.z), rise = (lx, lz) => at(b.x + cos * lx + sin * lz, b.z - sin * lx + cos * lz) - y;
    root.position.set(b.x, y, b.z); root.rotation.y = b.yaw; group.add(root);
    // Alternating water-filled safety barriers; continuous width includes the footways.
    const count = Math.ceil(b.hl * 2 / 1.8), length = b.hl * 2 / count;
    for (let i = 0; i < count; i++) {
      const z = -b.hl + (i + .5) * length, material = i % 2 ? white : orange, dy = rise(0, z), tilt = -Math.atan2(rise(0, z + length / 2) - rise(0, z - length / 2), length);
      for (const m of [mesh(root, box, material, 0, .24 + dy, z, 1.3, .48, length), mesh(root, box, material, 0, .69 + dy, z, .65, .42, length * .97), mesh(root, box, dark, 0, .04 + dy, z, 1.45, .08, length)]) m.rotation.x = tilt;
    }
    // Striped barricade rail and road-closed sign face the race route.
    mesh(root, box, white, .05, 1.14, 0, .12, .25, Math.min(4, b.hl * 2));
    // A single orange inset keeps the rail assembly at 24 triangles.
    mesh(root, box, orange, .12, 1.14, 0, .015, .25, 1.2);
    for (const z of [-b.hl + .3, b.hl - .3]) {
      const dy = rise(1.6, z);
      mesh(root, box, dark, 1.6, .035 + dy, z, .5, .07, .5);
      mesh(root, cone, orange, 1.6, .41 + dy, z);
      mesh(root, box, white, 1.6, .46 + dy, z, .22, .10, .22);
    }
    mesh(root, box, dark, 0, 1.45, 0, .08, 2.9, .08);
    const label = assets.makeLabel?.('ΕΡΓΑ · ΚΛΕΙΣΤΟ', 2.6, .65, '#ffe157', '#151515');
    if (label) { label.position.set(.16, 2.35, 0); label.rotation.y = Math.PI / 2; root.add(label); }
  }
  if (map.id === 'psychiko') {
    // Keep each exit's logical root/collider; merge the static barriers by spatial cell and material.
    group.updateMatrixWorld(true);
    const p = new THREE.Vector3(), footings = [];
    group.traverse(o => { if (o.isMesh && o.geometry === box && o.scale.y < .09) { o.getWorldPosition(p); footings.push([p.x, p.y - o.scale.y / 2, p.z]); } });
    group.userData.footings = footings;
    group.userData.batches = batchStatic(group, 200);
  }
  const base = ground.parked || [];
  const colliders = blocks.map(b => ({ ...b, kind: 'roadworks', restitution: .05, damageScale: .65 }));
  let active = false;
  return {
    group, colliders,
    setEvent(def) {
      const enabled = roadworksForEvent(map.data, def).length > 0;
      if (enabled === active) return;
      active = enabled; group.visible = enabled;
      ground.parked = enabled ? base.concat(colliders) : base; ground._ph = null;
    },
    get active() { return active; },
  };
}
