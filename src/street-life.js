// Municipal 1100 L bins and Greek municipal labels, batched by 180 m cells.
// Artistic scenery placement is illustrative, not an OSM inventory of municipal bins.
import * as THREE from 'three';
import { CellInstances, GeoBatch, M, canvasTex, pointInPoly } from './util.js';
import { ROAD } from './road.js';
import { STREET_LIFE_MAPS, townBinStations } from './street-life-data.js';

const CELL = 180;
class BinLabelBatch {
  constructor(group) {
    this.group=group; this.cells=new Map();
    const map=canvasTex(256,256,c=>{
      for(let row=0;row<2;row++) {
        c.fillStyle='#e3d5a3';c.fillRect(8,row*128+8,240,108);
        c.fillStyle='#173e38';c.textAlign='center';c.font='bold 24px sans-serif';
        c.fillText(row?'ΑΝΑΚΥΚΛΩΣΗ':'ΔΗΜΟΣ',128,row*128+50,218);
        c.font='18px sans-serif';c.fillText(row?'♻  RECYCLE':'ΚΑΘΑΡΙΟΤΗΤΑ',128,row*128+85,218);
      }
    });
    this.material=new THREE.MeshStandardMaterial({map,roughness:.96,alphaTest:.12,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  }
  add(x,y,z,yaw,recycling) {
    const key=`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;
    if(!this.cells.has(key))this.cells.set(key,new GeoBatch());
    const g=new THREE.PlaneGeometry(.34,.17),uv=g.attributes.uv,row=recycling?1:0;
    for(let i=0;i<uv.count;i++)uv.setXY(i,.015+uv.getX(i)*.97,1-(row+.025+(1-uv.getY(i))*.95)/2);
    this.cells.get(key).add(g,M(x,y,z,0,yaw,-.04));g.dispose();
  }
  build() {
    for(const batch of this.cells.values()) {
      const g=batch.build(),mesh=new THREE.Mesh(g,this.material);mesh.name='Greek municipal bin labels';mesh.receiveShadow=true;
      mesh.boundingSphere=g.boundingSphere;mesh.userData={lod:true,far:340,impostor:false};this.group.add(mesh);
    }
    if(!this.cells.size){this.material.map.dispose();this.material.dispose();}
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

export function buildStreetLife(map, scene, heightC, roadside = null) {
  if (!STREET_LIFE_MAPS.includes(map.id)) return { obstacles: [] };
  const group = new THREE.Group(); group.name = 'Greek municipal bins'; scene.add(group);
  const labels = new BinLabelBatch(group), props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .87 });
  const pools = [false, true].map(blue => new CellInstances(municipalBinGeometry(blue), props, { cell: CELL, far: 340 }));
  const r = map.route, obstacles = [], bins = [], stations = townBinStations(map);
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
      const sticker = facing(.527, -.35); labels.add(sticker[0], y + 1.11, sticker[1], yaw, blue);
    }
  }
  for (const pool of pools) { pool.build(group); pool.cells.clear(); if (!pool.meshes.length) { pool.geo.dispose(); if (pool.mat !== props) pool.mat.dispose(); } }
  if (!pools.some(p => p.meshes.length)) props.dispose();
  labels.build();
  const stats={bins:bins.length,recycling:bins.filter(b=>b.recycling).length,cellMeshes:group.children.length};
  group.userData.streetLife=stats;group.userData.bins=bins;
  return {group,obstacles,stats};
}
