import { signFaceOffset } from './sign-mount.js';
import { squarePost, signFace } from './world-prop-geometries.js';
// Greek Ρ-32 speed-limit signs and OSM speed-camera posts, built from the
// mapped sign nodes and limit changes in the map data (tools/speed-signs.mjs).
// One InstancedMesh per part (posts, backs, one face texture per posted value,
// camera poles/heads) in wide spatial cells, so the LOD system culls and
// fades them per chunk like the other roadside furniture. Signs stand on the
// right-hand side of the carriageway they serve, facing oncoming traffic.
// Reference shape (viewed as reference only; no third-party images shipped):
// https://en.wikipedia.org/wiki/Road_signs_in_Greece (Ρ-32: white disc, red ring).
import * as THREE from 'three';
import { CellInstances, canvasTex } from './util.js';
import { buildRoadSigns } from './road-signs.js';
import { speedSignRecords } from './road-sign-layout.js';

export const SIGN_D = 0.75; // disc diameter, m (Greek Ρ-32 is posted 600-900 mm)
const POST_H = 2.7, FACE_Y = 2.2, CAM_H = 3.6;
const CELL = 1500; // a handful of chunks per map: few draw calls, per-chunk culling
const FAR = 900; // authored at the 2 km reference draw distance (see scenery.js)

/** white disc, red ring, black numerals — drawn, never loaded, so no assets ship */
export function faceTexture(v) {
  const label = String(v);
  const texture=canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f7f7f4';
    g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
    g.lineWidth = 30; g.strokeStyle = '#c8102e';
    g.beginPath(); g.arc(128, 128, 107, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#111314'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${label.length > 2 ? 104 : 132}px system-ui, sans-serif`;
    g.fillText(label, 128, 136, 174);
  });texture.userData.penteliRecipe={kind:'speed',value:v};return texture;
}

/**
 * Add the map's speed signs. Call after loadTextures(); safe on maps without
 * sign data (Megara's closed circuit has none). Returns { group, obstacles }.
 */
export function buildSpeedSigns(map, parent, heightC) {
  const group = new THREE.Group(); group.name = 'speed signs';
  const roadSigns = buildRoadSigns(map, group, heightC);
  const obstacles = [...roadSigns.obstacles];
  const counts = { signs: 0, cameras: 0, meshes: 0 };
  const { route, data } = map;
  const signs = speedSignRecords(map), cameras = data.speedCameras || [];
  if (!signs.length && !cameras.length) { parent.add(group); return { group, obstacles, counts }; }

  const metal = new THREE.MeshStandardMaterial({ color: '#8f979b', roughness: 0.55, metalness: 0.5 });
  const backMat = new THREE.MeshStandardMaterial({ color: '#7e8589', roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide });
  const postGeo = new THREE.BoxGeometry(0.04*2, POST_H, 0.05*2); postGeo.translate(0, POST_H / 2, 0);
  const faceGeo = signFace(SIGN_D / 2);
  const headGeo = new THREE.BoxGeometry(0.55, 0.32, 0.28);

  const posts = new CellInstances(postGeo, metal, { cell: CELL, far: FAR, shadow: true, receive: false });
  const backs = new CellInstances(faceGeo, backMat, { cell: CELL, far: FAR, shadow: false, receive: false });
  const faces = new Map(); // value -> CellInstances
  const heads = new CellInstances(headGeo, backMat, { cell: CELL, far: FAR, shadow: false, receive: false });
  const faceMatFor = (v) => {
    let p = faces.get(v);
    if (!p) {
      p = new CellInstances(faceGeo,
        new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.45, metalness: 0.05 }),
        { cell: CELL, far: FAR, shadow: false, receive: false });
      faces.set(v, p);
    }
    return p;
  };

  const V = new THREE.Vector3(), F = {};
  // yaw whose +Z faces the drivers travelling in direction dir
  const yawFor = (s, dir) => {
    route.frame(s, F);
    return Math.atan2(-dir * F.tx, -dir * F.tz);
  };
  const groundAt = (x, z, s, u) => Math.max(heightC(x, z), route.surfaceY(s, u) - 0.15);
  const emit = (s, u, dir, v) => {
    route.point(s, u, V);
    const y = groundAt(V.x, V.z, s, u), yaw = yawFor(s, dir);
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    posts.addTRS(V.x, y, V.z, yaw, 1, 1, 1);
    faceMatFor(v).addTRS(V.x + nx * signFaceOffset(.10), y + FACE_Y, V.z + nz * signFaceOffset(.10), yaw, 1, 1, 1);
    backs.addTRS(V.x + nx * (signFaceOffset(.10) - .02), y + FACE_Y, V.z + nz * (signFaceOffset(.10) - .02), yaw + Math.PI, 1, 1, 1);
    obstacles.push({ x: V.x, z: V.z, yaw, hw: 0.15, hl: 0.15 });
    counts.signs++;
  };
  for (const sg of signs) {
    if (!Number.isFinite(sg.s) || !Number.isFinite(sg.u)) continue;
    emit(sg.s, sg.u, sg.dir || 1, sg.v);
  }
  for (const c of cameras) {
    if (!Number.isFinite(c.s) || !Number.isFinite(c.u)) continue;
    route.point(c.s, c.u, V);
    const y = groundAt(V.x, V.z, c.s, c.u), yaw = yawFor(c.s, c.dir || 1);
    posts.addTRS(V.x, y, V.z, yaw, 1, CAM_H / POST_H, 1);
    heads.addTRS(V.x, y + CAM_H, V.z, yaw, 1, 1, 1);
    obstacles.push({ x: V.x, z: V.z, yaw, hw: 0.2, hl: 0.2 });
    counts.cameras++;
  }
  for (const pool of [posts, backs, heads, ...faces.values()]) {
    pool.build(group);
    counts.meshes += pool.meshes.length;
  }
  group.userData.speedSigns = counts;
  parent.add(group);
  return { group, obstacles, counts };
}
