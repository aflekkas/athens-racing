import { loadPsychikoTextures } from './psychiko-textures.js';
// Palaio Psychiko uses the shared Greek street kit and actual OSM villa footprints.
import * as THREE from 'three';
import { buildRoad } from '../road.js';
import { buildBuildings } from './psychiko-buildings.js';
import { buildNature } from './psychiko-nature.js';
import { buildPsychikoGardens } from './psychiko-gardens.js';
import { People } from '../people.js';
import { batchStatic } from '../batch.js';

export async function buildScenery(scene, map, { heightC, assets } = {}) {
  await loadPsychikoTextures();
  const group = new THREE.Group(); group.name = 'psychiko-garden-streets'; scene.add(group);
  const road = buildRoad(map, group, heightC, assets);
  assets.asphalt = road.asphalt;
  const buildings = buildBuildings(map, group, heightC, assets.labels);
  const nature = buildNature(map, group, heightC, buildings, assets);
  const roadside = buildPsychikoGardens(map, group, heightC, buildings, assets);
  const people = new People(map, group, assets, nature.group);
  for (const root of [road.group, buildings.group, nature.group, roadside.group]) batchStatic(root);
  return { group, road, people, obstacles: roadside.obstacles };
}
