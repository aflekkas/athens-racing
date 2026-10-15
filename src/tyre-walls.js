// Club-circuit safety furniture. Reference photographs are recorded in tools/maps/megara/SOURCES.md.
// Painted sections/belt facing are an illustrative reconstruction, not a current safety survey.
import * as THREE from 'three';
import { CellInstances } from './util.js';
import { TyreDynamics } from './tyre-dynamics.js';

export function createTyreWalls(group, map, heightC, obstacles) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .97 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x242624, roughness: 1 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x787a72, roughness: .7, metalness: .35 });
  // Flattened torus: a visible open centre, rounded sidewalls, four touching tyres per stack.
  const geo = new THREE.TorusGeometry(.34, .16, 8, 24).rotateX(Math.PI / 2).scale(1, .87, 1);
  // Grooves cross the outer tread; sidewalls retain rounded shoulders and an open bore.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tyreLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntyreLocal = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 tyreLocal;').replace('#include <color_fragment>', `#include <color_fragment>
      float tread=step(.44,length(tyreLocal.xz));
      float groove=step(.83,fract(atan(tyreLocal.z,tyreLocal.x)*15.2789+tyreLocal.y*7.));
      diffuseColor.rgb*=1.-tread*groove*.45;`);
  };
  material.customProgramCacheKey = () => 'circuit-tyre-tread-v1';
  const tyres = new CellInstances(geo, material, { cell: 80, colors: true, far: 240 });
  const belts = new CellInstances(new THREE.BoxGeometry(1, 1, 1), rubber, { cell: 500, far: 1600 });
  const bolts = new CellInstances(new THREE.BoxGeometry(1, 1, 1), metal, { cell: 500, far: 250, shadow: false });
  const marks = new CellInstances(new THREE.BoxGeometry(1, 1, 1), rubber, { cell: 500, far: 550, shadow: false });
  const farTyres = new CellInstances(new THREE.CylinderGeometry(.49, .49, .28, 6), material, { cell: 80, colors: true, near: 240, far: 1600 });
  const placements = [], dynamics = new TyreDynamics(heightC), dummy = new THREE.Object3D();
  const loose = new THREE.InstancedMesh(geo, material, dynamics.capacity);
  loose.name = 'loose-circuit-tyres'; loose.count = 0; loose.frustumCulled = false; loose.castShadow = true; loose.receiveShadow = true;
  loose.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(loose);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const setSlot = (slot, matrix) => { slot.mesh.setMatrixAt(slot.index, matrix); slot.mesh.instanceMatrix.needsUpdate = true; };
  function impact(stack, hit) {
    for (const b of dynamics.release(stack, hit.vx, hit.vz, hit.speed)) {
      const slot = stack.slots[b.level]; setSlot(slot, hidden); setSlot(stack.farSlots[b.level], hidden);
      loose.setColorAt(dynamics.bodies.indexOf(b), new THREE.Color(stack.color));
    }
    if (loose.instanceColor) loose.instanceColor.needsUpdate = true;
  }
  function clear(x, z, radius = .7) {
    const p = map.route.project(x, z);
    if (Math.abs(p.u) < map.route.edge(p.s) + radius + 1) return false;
    const network = map.roadNetwork;
    if (network) for (const s of network.segments) if (network.distance(s, x, z) < s.hw + s.sw + radius + 1) return false;
    return true;
  }
  function path(points, { painted = true, facing = true } = {}) {
    let along = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i], dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      if (length < .1) continue;
      const n = Math.ceil(length / .94), yaw = Math.atan2(dx, dz), nx = dz / length, nz = -dx / length;
      for (let j = 0; j < n; j++) {
        const t = (j + .5) / n, x = ax + dx * t, z = az + dz * t;
        if (!clear(x, z)) continue;
        const y = heightC(x, z), segment = Math.floor((along + t * length) / 4);
        const col = !painted ? 0x32332f : segment % 3 === 0 ? 0xb14a3a : segment % 3 === 1 ? 0xd8d5c4 : 0x32332f;
        const stack = { id: placements.length, x, y, z, yaw, color: col, slots: [], farSlots: [], released: false };
        for (let level = 0; level < 4; level++) {
          tyres.addTRS(x, y + .14 + level * .28, z, yaw + level * .08, 1, 1, 1, col);
          farTyres.addTRS(x, y + .14 + level * .28, z, yaw, 1, 1, 1, col);
        }
        // Backing belt leaves the rounded top tyre exposed; both faces protect the stack.
        if (facing) for (const side of [-1, 1]) {
          belts.addTRS(x + nx * .46 * side, y + .31, z + nz * .46 * side, yaw, .035, .36, length / n + .025);
          for (const h of [.21, .41]) bolts.addTRS(x + nx * .486 * side, y + h, z + nz * .486 * side, yaw, .018, .036, .036);
        }
        const obstacle = { x, z, yaw, hw: .51, hl: length / n / 2 + .04, kind: 'tyre', restitution: .08, damageScale: .35, onImpact: hit => impact(stack, hit) };
        obstacles.push(obstacle); placements.push(Object.assign(stack, { obstacle }));
      }
      along += length;
    }
  }
  function finish() {
    // Rubber pickup on the existing raised kerbs, kept inside their painted width.
    for (const k of map.route.kerbs || []) for (let s = k.s0 + 1; s < k.s1; s += 3.7) {
      const p = map.route.point(s, k.side * (map.route.edge(s) + (k.width || .85) * .42));
      const f = map.route.frame(s, {});
      marks.addTRS(p.x, p.y + .052 + (k.height || .045), p.z, Math.atan2(f.tx, f.tz) + .12, .10, .005, .65);
    }
    for (const bucket of [tyres, farTyres, belts, bolts, marks]) {
      bucket.build(group);
      if (bucket === tyres || bucket === farTyres) {
        let cell = 0;
        for (const list of bucket.cells.values()) {
          const mesh = bucket.meshes[cell++];
          list.forEach(([matrix], index) => {
            const e = matrix.elements, stack = placements.find(p => Math.abs(p.x - e[12]) < .001 && Math.abs(p.z - e[14]) < .001);
            const slots = bucket === tyres ? stack.slots : stack.farSlots; slots.push({ mesh, index, matrix });
          });
        }
      }
      bucket.cells.clear();
    }
    group.userData.tyreWalls = placements;
    return placements;
  }
  return { path, finish, dynamics,
    update(dt, online = false) {
      if (online && dynamics.bodies.length) this.reset();
      dynamics.enabled = !online; dynamics.update(dt); loose.count = dynamics.bodies.length;
      dynamics.bodies.forEach((b, i) => {
        dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(b.ax, b.ay, b.az); dummy.updateMatrix(); loose.setMatrixAt(i, dummy.matrix);
      });
      if (loose.count) loose.instanceMatrix.needsUpdate = true;
    },
    reset() {
      for (const b of dynamics.bodies) { const stack = b.stack; setSlot(stack.slots[b.level], stack.slots[b.level].matrix); setSlot(stack.farSlots[b.level], stack.farSlots[b.level].matrix); }
      dynamics.reset(); loose.count = 0;
    },
  };
}
