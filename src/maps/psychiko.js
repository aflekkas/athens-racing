// Vas-Per's mapped streets and footprints, using the shared owner-locked world kit.
import * as THREE from 'three';
import { buildRoad } from '../road.js';
import { buildBuildings } from '../buildings.js';
import { People } from '../people.js';
import { batchStatic } from '../batch.js';
import { CellInstances, GeoBatch, M } from '../util.js';
import { municipalBinGeometry } from '../street-life.js';
import { assertWorldBudget } from '../world-art-direction.js';
import { buildRoundaboutGuidance } from '../roundabout-guidance.js';

export function psychikoLampGeometry() {
  const batch = new GeoBatch();
  for (const [x,y,z,w,h,d,color] of [[0,2.75,0,.15,5.5,.15,'#415259'],[0,5.45,-.4,.15,.15,.95,'#415259'],[0,5.35,-.9,.35,.16,.45,'#f0e4bc']]) {
    const g = new THREE.BoxGeometry(w,h,d); batch.add(g,M(x,y,z),color); g.dispose();
  }
  return assertWorldBudget('lamp',batch.build());
}
export function buildScenery(scene, map, { heightC, assets } = {}) {
  const group = new THREE.Group(); group.name = 'psychiko-streets'; scene.add(group);
  const road = buildRoad(map, group, heightC, assets); assets.asphalt = road.asphalt;
  const buildings = buildBuildings(map, group, heightC, assets.labels);
  const material = new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
  const lamps = new CellInstances(psychikoLampGeometry(),material,{cell:240,far:320});
  const bins = new CellInstances(municipalBinGeometry(),material,{cell:240,far:240});
  for (const [i,[x,z,yaw]] of (map.data.psychiko.scenery?.furniture || []).entries()) {
    const y=heightC(x,z); lamps.add(M(x,y,z,0,yaw));
    if(i%5===0)bins.add(M(x,y,z,0,yaw));
  }
  lamps.build(group); bins.build(group);
  // Counter-clockwise ring arrows, give-way lines and P-1/P-40 signs at every public roundabout entry.
  const guidance = buildRoundaboutGuidance(map, heightC, material); if (guidance) group.add(guidance.mesh);
  const people = new People(map, group, assets, group);
  for (const root of [road.group, buildings.group]) batchStatic(root);
  return { group, road, people, obstacles: [] };
}
