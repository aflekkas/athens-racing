// Palaio Psychiko uses the shared Greek street kit and actual OSM villa footprints.
import * as THREE from 'three';
import { buildRoad } from '../road.js';
import { buildBuildings } from '../buildings.js';
import { buildNature } from '../nature.js';
import { buildRoadside } from '../roadside.js';
import { People } from '../people.js';
import { batchStatic } from '../batch.js';

export function buildScenery(scene, map, { heightC, assets } = {}) {
  const group = new THREE.Group(); group.name = 'psychiko-garden-streets'; scene.add(group);
  const road = buildRoad(map, group, heightC, assets);
  assets.asphalt = road.asphalt;
  const buildings = buildBuildings(map, group, heightC, assets.labels);
  const nature = buildNature(map, group, heightC, buildings, assets);
  const roadside = buildRoadside(map, group, heightC, assets);
  const people = new People(map, group, assets, nature.group);
  for (const root of [road.group, buildings.group, nature.group]) batchStatic(root);
  return { group, road, people, obstacles: roadside.obstacles };
}
