// Municipal 1100 L bins and original TOE paint, batched by 180 m cells.
// Artistic scenery placement is illustrative, not an OSM inventory of municipal bins.
import * as THREE from 'three';
import { CellInstances, GeoBatch, M, canvasTex, pointInPoly, polyArea } from './util.js';
import { ROAD } from './road.js';
import { TOE_STYLES, TOE_COLORS, drawTOE } from './graffiti-art.js';
import { STREET_LIFE_MAPS, buildingGraffiti, townBinStations, paintProgress, streetLifeTown, selectGraffitiBuildings } from './street-life-data.js';

const CELL = 180, MAX_ARTISTS = 6;
function paintAtlas() {
  return canvasTex(1024, 1024, c => {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      c.save(); c.translate(col * 256, row * 128);
      drawTOE(c, { style: TOE_STYLES[col], color: TOE_COLORS[row], seed: col + row * 17 + 1, width: 256, height: 128 }); c.restore();
    }
    for (let row = 4; row < 7; row++) {
      c.fillStyle = row === 5 ? '#e9ebe2' : '#e3d5a3'; c.fillRect(8, row * 128 + 8, 240, 108);
      c.fillStyle = '#173e38'; c.textAlign = 'center'; c.font = 'bold 24px sans-serif';
      c.fillText(row === 5 ? 'ΑΝΑΚΥΚΛΩΣΗ' : row === 6 ? 'ΟΧΙ ΜΠΑΖΑ' : 'ΔΗΜΟΣ', 128, row * 128 + 50, 218);
      c.font = '18px sans-serif'; c.fillText(row === 5 ? '♻  RECYCLE' : row === 6 ? '1100 L' : 'ΚΑΘΑΡΙΟΤΗΤΑ', 128, row * 128 + 85, 218);
    }
  });
}
export class GraffitiBatch {
  constructor(group) {
    this.group = group; this.cells = new Map(); this.progress = { value: new Float32Array(MAX_ARTISTS) }; this.tags = 0;
    this.material = new THREE.MeshStandardMaterial({ map: paintAtlas(), roughness: .96, alphaTest: .12, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.material.customProgramCacheKey = () => 'toe-atlas-progress-v1';
    this.material.onBeforeCompile = shader => {
      shader.uniforms.uTOEPaint = this.progress;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aArtist; attribute float aPaintX; varying float vArtist; varying float vPaintX;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArtist=aArtist; vPaintX=aPaintX;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTOEPaint[6]; varying float vArtist; varying float vPaintX;')
        .replace('#include <alphatest_fragment>', 'float painted=1.0; for(int i=0;i<6;i++){if(abs(vArtist-float(i))<0.25) painted=uTOEPaint[i];} diffuseColor.a *= 1.0-smoothstep(painted-.025,painted+.005,vPaintX);\n#include <alphatest_fragment>');
    };
  }
  add(x, y, z, yaw, w, h, style = 0, color = 0, artist = -1, tilt = 0, sticker = -1, pitch = 0) {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let cell = this.cells.get(key); if (!cell) this.cells.set(key, cell = { batch: new GeoBatch(), artists: [], paintX: [] });
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    const col = sticker < 0 ? style % 4 : 0, row = sticker < 0 ? color % 4 : sticker;
    // Bleed-safe inset; CanvasTexture's origin is the bottom-left in UV space.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + .015 + uv.getX(i) * .97) / 4, 1 - (row + .025 + (1 - uv.getY(i)) * .95) / 8);
    cell.batch.add(g, M(x, y, z, pitch, yaw, tilt, 1, 1, 1, 'YXZ'));
    cell.artists.push(...Array(6).fill(artist)); cell.paintX.push(0, 0, 1, 0, 1, 1); g.dispose();
    if (sticker < 0) this.tags++;
  }
  build() {
    for (const cell of this.cells.values()) {
      const g = cell.batch.build(); g.setAttribute('aArtist', new THREE.Float32BufferAttribute(cell.artists, 1)); g.setAttribute('aPaintX', new THREE.Float32BufferAttribute(cell.paintX, 1));
      const mesh = new THREE.Mesh(g, this.material); mesh.name = 'TOE paint atlas cell'; mesh.receiveShadow = true;
      mesh.boundingSphere = g.boundingSphere; mesh.userData = { lod: true, far: 430, impostor: false }; this.group.add(mesh);
    }
    this.cells.clear();
  }
}

export function municipalBinGeometry(recycling = false) {
  const batch = new GeoBatch(), green = recycling ? '#22689a' : '#26725a', lid = recycling ? '#18547f' : '#205846';
  const box = (w, h, d, x, y, z, color) => { const g = new THREE.BoxGeometry(w, h, d); batch.add(g, M(x, y, z), color); g.dispose(); };
  const body = new THREE.BoxGeometry(1.34, 1.03, 1.02, 2, 2, 1), p = body.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), taper = .88 + (y + .515) * .12; p.setXYZ(i, p.getX(i) * taper, y, p.getZ(i) * taper - (y === 0 && p.getX(i) === 0 ? .035 : 0)); }
  body.computeVertexNormals(); batch.add(body, M(0, .79, 0), green); body.dispose();
  box(1.43, .12, 1.10, 0, 1.35, 0, lid); box(1.25, .08, .88, 0, 1.43, -.035, lid);
  for (const x of [-.53, .53]) { box(.22, .06, .12, x, 1.51, .37, '#36413c'); box(.08, .10, .12, x, 1.36, -.56, '#7c8b84'); }
  for (const x of [-.73, .73]) box(.11, .18, .26, x, 1.08, -.15, '#66736c');
  // Four small swivel casters, visible rubber tyres and metal forks.
  for (const x of [-.49, .49]) for (const z of [-.37, .37]) {
    box(.10, .15, .10, x, .24, z, '#a0a6a0');
    const wheel = new THREE.CylinderGeometry(.115, .115, .085, 8); wheel.rotateZ(Math.PI / 2);
    batch.add(wheel, M(x, .12, z), '#252c2a'); wheel.dispose();
    box(.012, .08, .08, x + .05, .12, z, '#91998e');
  }
  for (const x of [-.45, -.15, .15, .45]) box(.035, .75, .027, x, .8, .506, lid);
  return batch.build();
}

function decorateBuildings(map, heightC, paint) {
  const eligible = (map.data.buildings || []).filter(b => b.p?.length >= 6 && Math.abs(b.u) <= 180 && streetLifeTown(map, b.s) && b.k !== 'church' && String(b.id) !== '368804380');
  let tagged = 0;
  for (const b of selectGraffitiBuildings(eligible)) {
    const pick = buildingGraffiti(b.id);
    const p = b.p, winding = polyArea(p) > 0 ? -1 : 1, road = map.route.point(b.s, 0);
    let edge = null, best = -Infinity, ground = Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length, ax = p[i], az = p[i + 1], dx = p[j] - ax, dz = p[j + 1] - az, length = Math.hypot(dx, dz);
      ground = Math.min(ground, heightC(ax, az)); if (length < 3) continue;
      const nx = dz / length * winding, nz = -dx / length * winding, mx = ax + dx / 2, mz = az + dz / 2;
      const facing = (nx * (road.x - mx) + nz * (road.z - mz)) / Math.max(1, Math.hypot(road.x - mx, road.z - mz));
      if (facing > best) { best = facing; edge = { ax, az, dx, dz, length, nx, nz }; }
    }
    if (!edge || best < .05 || !Number.isFinite(ground)) continue;
    // Penteli buildings use the footprint-bounds midpoint as their extrusion base.
    if (map.id === 'penteli') { const xs = p.filter((_, i) => !(i % 2)), zs = p.filter((_, i) => i % 2); ground = heightC((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2); }
    const n = Math.min(pick.count, Math.floor(edge.length / 2.1));
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1), w = Math.min(2.5, edge.length / (n + 1) * .82);
      paint.add(edge.ax + edge.dx * t + edge.nx * .035, ground + .75 + (i % 2) * .22, edge.az + edge.dz * t + edge.nz * .035,
        Math.atan2(edge.nx, edge.nz), w, w * .49, (pick.style + i) % 4, pick.color, -1, (i - 1) * .045);
    }
    tagged++;
  }
  return { eligible: eligible.length, tagged };
}

export function buildStreetLife(map, scene, heightC, roadside = null) {
  if (!STREET_LIFE_MAPS.includes(map.id)) return { obstacles: [], artists: [], update() {}, reset() {} };
  const group = new THREE.Group(); group.name = 'Athens bins + TOE street life'; scene.add(group);
  const paint = new GraffitiBatch(group), props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .87 });
  const pools = [false, true].map(blue => new CellInstances(municipalBinGeometry(blue), props, { cell: CELL, far: 340 }));
  const boxPool = new CellInstances(new THREE.BoxGeometry(.75, 1.25, .45).translate(0, .625, 0), new THREE.MeshStandardMaterial({ color: '#8b9490', roughness: .88 }), { cell: CELL, far: 340 });
  const r = map.route, obstacles = [], bins = [], artists = [], stations = townBinStations(map);
  const desired = map.id === 'riviera' ? [400, 850, 4600, 10500] : [220, 450, 5700, 5820];
  const clear = (x, z, yaw, hw, hl, s) => {
    if (map.roadNetwork?.mouth(s, Math.sign(r.project(x, z, s).u) || 1, 9)) return false;
    if ((map.data.furniture || []).some(f => f.t === 'bus_stop' && Math.abs(f.s - s) < 7)) return false;
    if ((map.data.sideRoads || []).some(q => Math.abs(q.s - s) < 12)) return false;
    for (const dx of [-hw, hw]) for (const dz of [-hl, hl]) {
      const px = x + dx * Math.cos(yaw) + dz * Math.sin(yaw), pz = z - dx * Math.sin(yaw) + dz * Math.cos(yaw), q = r.project(px, pz, s, 5);
      if (Math.abs(q.u) < r.edge(q.s) + ROAD.gutter + .32 || map.roadNetwork?.sample(px, pz)) return false;
      if ((map.data.buildings || []).some(b => b.p && pointInPoly(px, pz, b.p))) return false;
    }
    if (obstacles.some(o => {
      const axes = [yaw, o.yaw].flatMap(a => [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]]);
      return axes.every(([ax, az]) => Math.abs((x - o.x) * ax + (z - o.z) * az) < hw * Math.abs(ax * Math.cos(yaw) - az * Math.sin(yaw)) + hl * Math.abs(ax * Math.sin(yaw) + az * Math.cos(yaw)) + o.hw * Math.abs(ax * Math.cos(o.yaw) - az * Math.sin(o.yaw)) + o.hl * Math.abs(ax * Math.sin(o.yaw) + az * Math.cos(o.yaw)) + .1);
    })) return false;
    return ![...(map.data.parkSpots || []), ...(roadside?.obstacles || [])].some(o => Math.hypot(x - o.x, z - o.z) < Math.hypot(o.hw || 1.1, o.hl || 2.5) + .85);
  };
  for (const s0 of stations) {
    const side = Math.floor(s0 / (map.id === 'penteli' ? 70 : 125)) % 2 ? 1 : -1;
    for (let j = 0; j < 2 + (Math.floor(s0) % 3 === 0 ? 1 : 0); j++) {
      const s = s0 + j * 1.8;
      if (s > r.length - 8) continue;
      const f = r.frame(s, {}), yaw = Math.atan2(-side * f.rx, -side * f.rz);
      let spot = null;
      for (const extra of [1.12, 2.1, 3.2]) { const u = side * (r.edge(s) + ROAD.gutter + extra), p = r.point(s, u);
        if (!clear(p.x, p.z, yaw, .80, .57, s)) continue;
        const ys = [-.75, .75].flatMap(x => [-.53, .53].map(z => heightC(p.x + x * Math.cos(yaw) + z * Math.sin(yaw), p.z - x * Math.sin(yaw) + z * Math.cos(yaw))));
        if (Math.max(...ys) - Math.min(...ys) > .35) continue;
        const pavement = map.id === 'riviera' && extra < ROAD.sidewalk(r, s, side);
        spot = { s, u, x: p.x, z: p.z, y: pavement ? Math.max(...ys, r.surfaceY(s, side * (r.edge(s) + ROAD.gutter)) + ROAD.curbH(r, s)) : heightC(p.x, p.z) + .005, yaw }; break;
      }
      if (!spot) continue;
      const { x, y, z } = spot, blue = j === 1 && Math.floor(s0) % 3 !== 1;
      pools[blue ? 1 : 0].addTRS(x, y, z, yaw, 1); bins.push({ ...spot, recycling: blue });
      obstacles.push({ x, z, yaw, hw: .77, hl: .55, kind: 'municipal-bin' });
      const facing = (out, along = 0) => [x + Math.sin(yaw) * out + Math.cos(yaw) * along, z + Math.cos(yaw) * out - Math.sin(yaw) * along];
      const sticker = facing(.527, -.35); paint.add(sticker[0], y + 1.11, sticker[1], yaw, .34, .17, 0, 0, -1, -.04, blue ? 5 : 4);
      // Scratched side panels and a smaller overlapping quick tag.
      const sideTag = [x + Math.cos(yaw) * .662, z - Math.sin(yaw) * .662];
      paint.add(sideTag[0], y + .83, sideTag[1], yaw + Math.PI / 2, .73, .38, 2, 2);
    }
  }
  // Select artists from accepted placements, so slope/parking exclusions cannot
  // silently remove half the artists. Keep their spots spread across settlements.
  for (const target of desired) {
    const candidates = bins.filter(b => !b.recycling && !artists.some(a => Math.abs(a.s - b.s) < 80)).sort((a, b) => Math.abs(a.s - target) - Math.abs(b.s - target));
    const b = candidates[0]; if (!b) continue;
    b.artistIndex = artists.length;
    const x = b.x + Math.sin(b.yaw) * .98 - Math.cos(b.yaw) * .58, z = b.z + Math.cos(b.yaw) * .98 + Math.sin(b.yaw) * .58;
    artists.push({ kind: 'artist', s: b.s, x, y: map.id === 'penteli' ? heightC(x, z) + .015 : b.y,
      z, yaw: b.yaw + Math.PI, ped: null, index: artists.length, elapsed: 0 });
  }
  for (const b of bins) paint.add(b.x + Math.sin(b.yaw) * .533, b.y + .79, b.z + Math.cos(b.yaw) * .533, b.yaw, 1.15, .56,
    Math.floor(b.s / 125) % 4, Math.floor(b.s / 250) % 4, b.artistIndex ?? -1);
  for (let i = 1; i < bins.length; i += 5) {
    const b = bins[i];
    for (const along of [-2.1, 2.1]) {
      const x = b.x - Math.sin(b.yaw) * .5 + Math.cos(b.yaw) * along, z = b.z - Math.cos(b.yaw) * .5 - Math.sin(b.yaw) * along;
      if (!clear(x, z, b.yaw, .4, .25, b.s)) continue;
      const y = map.id === 'penteli' ? heightC(x, z) : b.y;
      boxPool.addTRS(x, y, z, b.yaw, 1); obstacles.push({ x, z, yaw: b.yaw, hw: .4, hl: .25, kind: 'utility-box' });
      paint.add(x + Math.sin(b.yaw) * .231, y + .67, z + Math.cos(b.yaw) * .231, b.yaw, .68, .36, 2, i % 4); break;
    }
  }
  const buildings = decorateBuildings(map, heightC, paint);
  let retainingTags = 0, shelterTags = 0, boreTags = 0;
  // Existing retaining walls / shelter frames use the same paint atlas and cell batches.
  for (const [i, p] of (roadside?.group?.userData.placements || []).entries()) {
    if (p.model === 'wall' && i % 4 === 0) {
      const height = 1.56 * (p.sy ?? 1);
      paint.add(p.x + Math.sin(p.yaw) * .345, p.y + height * .5, p.z + Math.cos(p.yaw) * .345, p.yaw, Math.min(2.2, 2.7 * (p.sx ?? 1)), Math.min(.75, height * .58), i % 4, i % 4); retainingTags++;
    }
    if (p.model === 'shelter') { paint.add(p.x + Math.sin(p.yaw) * -.70, p.y + 1.5, p.z + Math.cos(p.yaw) * -.70, p.yaw, 1.1, .48, 2, i % 4); shelterTags++; }
  }
  // Paint the lower vertical rock face inside the actual Loumbarda bore, below its bevel.
  for (const c of r.localCorridors || []) for (const side of [-1, 1]) {
    const s = c.portalS[0] + 5, f = c.frame(s, {}), p = c.point(s, side * (c.width / 2 + .625), {});
    paint.add(p.x, p.y + 1.25, p.z, Math.atan2(-side * f.rx, -side * f.rz), 2.8, 1.15, side < 0 ? 1 : 3, side < 0 ? 0 : 2);
    boreTags++;
  }
  if (map.id === 'penteli') {
    // Project onto existing surveyed/DEM-derived masonry instead of floating planes
    // at guessed verge positions. One build-time ray probe every 173 m, no runtime raycasts.
    const walls = []; scene.updateMatrixWorld(true);
    scene.traverse(o => { if (o.isMesh && o.name === 'low-stone-cut-retaining') walls.push(o); });
    const ray = new THREE.Raycaster(), direction = new THREE.Vector3(); ray.far = 8;
    for (let s = 250; s < r.length - 20; s += 173) for (const side of [-1, 1]) {
      const f = r.frame(s, {}), origin = r.point(s, side * (r.edge(s) + ROAD.gutter)); origin.y += .48;
      ray.set(origin, direction.set(side * f.rx, 0, side * f.rz)); const hit = ray.intersectObjects(walls, false)[0];
      if (!hit) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (normal.dot(direction) > 0) normal.negate();
      const point = hit.point.clone().addScaledVector(normal, .025), pitch = -Math.asin(normal.y);
      paint.add(point.x, point.y, point.z, Math.atan2(normal.x, normal.z), 1.8, .42, Math.floor(s) % 4, side < 0 ? 0 : 2, -1, 0, -1, pitch);
      retainingTags++;
    }
  }
  for (const pool of [...pools, boxPool]) { pool.build(group); pool.cells.clear(); if (!pool.meshes.length) { pool.geo.dispose(); if (pool.mat !== props) pool.mat.dispose(); } }
  if (!pools.some(p => p.meshes.length)) props.dispose();
  paint.build();
  const mistG = new THREE.BufferGeometry(), mistPos = new Float32Array(MAX_ARTISTS * 8 * 3); mistG.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
  const mistTexture = canvasTex(32, 32, c => { const gradient = c.createRadialGradient(16, 16, 0, 16, 16, 16); gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(1, '#000000'); c.fillStyle = gradient; c.fillRect(0, 0, 32, 32); }, { srgb: false });
  const mist = new THREE.Points(mistG, new THREE.PointsMaterial({ color: '#d4d6bb', alphaMap: mistTexture, size: .065, transparent: true, opacity: .23, depthWrite: false }));
  mist.name = 'street artist spray mist'; mist.frustumCulled = false; group.add(mist);
  mist.visible = false; mistG.setDrawRange(0, 0);
  const matrix = new THREE.Matrix4(), local = new THREE.Matrix4(), euler = new THREE.Euler(), point = new THREE.Vector3();
  function hand(p) {
    const P = p.P, L = p.look;
    matrix.makeRotationY(P.yaw).scale(new THREE.Vector3(L.k, L.k, L.k)).setPosition(P.x, P.y, P.z);
    const bone = (x, y, z, rx, ry, rz, order) => { local.makeRotationFromEuler(euler.set(rx, ry, rz, order)).setPosition(x, y, z); matrix.multiply(local); };
    bone(0, P.pelY, 0, 0, P.pelYaw, P.pelRoll, 'YXZ'); bone(0, .075, 0, P.tPitch, P.tYaw, P.tRoll, 'YXZ');
    bone(-.2 * L.wT, .445, -.005, -P.shA[1], 0, -P.shR[1], 'ZXY'); bone(0, -.29, 0, -P.elb[1], 0, 0, 'XYZ'); bone(0, -.25, 0, 0, -.25, 0, 'XYZ');
    return point.set(0, .015, .045).applyMatrix4(matrix);
  }
  const stats = { bins: bins.length, recycling: bins.filter(b => b.recycling).length, artists: artists.length, buildings, tags: paint.tags, retainingTags, shelterTags, boreTags, utilityBoxes: obstacles.filter(o => o.kind === 'utility-box').length, cellMeshes: group.children.length - 1, mistDrawCalls: 1 };
  group.userData.streetLife = stats; group.userData.bins = bins;
  return { group, obstacles, artists, stats,
    reset() { for (const a of artists) a.elapsed = 0; paint.progress.value.fill(0); },
    update(dt, camPos) {
      let n = 0;
      for (const a of artists) {
        const p = a.ped; if (!p || !p.active) continue;
        const spraying = !p.react && !p.air && !p.moving && Math.hypot(p.x - a.x, p.z - a.z) < .16;
        if (spraying) a.elapsed += dt;
        p.sprayActive = a.elapsed % 18 < 10;
        paint.progress.value[a.index] = paintProgress(a.elapsed);
        if (!spraying || !p.sprayActive || (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2 > 58 ** 2) continue;
        const nozzle = hand(p), fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
        for (let j = 0; j < 8; j++) { const phase = (a.elapsed * 3 + j / 8) % 1, spread = .06 * phase, i = n++ * 3;
          mistPos[i] = nozzle.x + fx * phase * .22 + Math.sin(j * 7 + a.elapsed * 9) * spread;
          mistPos[i + 1] = nozzle.y + Math.cos(j * 5 + a.elapsed * 7) * spread;
          mistPos[i + 2] = nozzle.z + fz * phase * .22 + Math.sin(j * 3 + a.elapsed * 6) * spread;
        }
      }
      mistG.setDrawRange(0, n); mistG.attributes.position.needsUpdate = true; mist.visible = n > 0;
    },
  };
}
