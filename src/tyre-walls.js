// Club-circuit safety furniture. Reference photographs are recorded in tools/maps/megara/SOURCES.md.
// Painted sections/belt facing are an illustrative reconstruction, not a current safety survey.
import * as THREE from 'three';
import { CellInstances } from './util.js';

export function createTyreWalls(group, map, heightC, obstacles) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .97 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x242624, roughness: 1 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x787a72, roughness: .7, metalness: .35 });
  // Flattened torus: a visible open centre, rounded sidewalls, three touching tyres per stack.
  const geo = new THREE.TorusGeometry(.34, .16, 6, 12).rotateX(Math.PI / 2).scale(1, .83, 1);
  const tyres = new CellInstances(geo, material, { cell: 500, colors: true, far: 1600 });
  const belts = new CellInstances(new THREE.BoxGeometry(1, 1, 1), rubber, { cell: 500, far: 1600 });
  const bolts = new CellInstances(new THREE.BoxGeometry(1, 1, 1), metal, { cell: 500, far: 250, shadow: false });
  const marks = new CellInstances(new THREE.BoxGeometry(1, 1, 1), rubber, { cell: 500, far: 550, shadow: false });
  const placements = [];
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
        for (let level = 0; level < 3; level++) tyres.addTRS(x, y + .135 + level * .265, z, yaw + level * .08, 1, 1, 1, col);
        // Backing belt leaves the rounded top tyre exposed; both faces protect the stack.
        if (facing) for (const side of [-1, 1]) {
          belts.addTRS(x + nx * .46 * side, y + .31, z + nz * .46 * side, yaw, .035, .36, length / n + .025);
          for (const h of [.21, .41]) bolts.addTRS(x + nx * .486 * side, y + h, z + nz * .486 * side, yaw, .018, .036, .036);
        }
        const obstacle = { x, z, yaw, hw: .51, hl: length / n / 2 + .04, kind: 'tyre', restitution: .3, damageScale: .55 };
        obstacles.push(obstacle); placements.push({ ...obstacle, y });
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
    for (const bucket of [tyres, belts, bolts, marks]) { bucket.build(group); bucket.cells.clear(); }
    group.userData.tyreWalls = placements;
    return placements;
  }
  return { path, finish };
}
