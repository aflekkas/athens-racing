// Vas-Per's mapped streets and footprints, using the shared owner-locked world kit.
import * as THREE from 'three';
import { buildRoad } from '../road.js';
import { buildBuildings } from '../buildings.js';
import { People } from '../people.js';
import { batchStatic } from '../batch.js';
import { PsychikoStreetscape } from './psychiko-streetscape.js';

export function buildScenery(scene, map, { heightC, assets } = {}) {
  const group = new THREE.Group(); group.name = 'psychiko-streets'; scene.add(group);
  const road = buildRoad(map, group, heightC, assets); assets.asphalt = road.asphalt;
  const buildings = buildBuildings(map, group, heightC, assets.labels);
  const people = new People(map, group, assets, group);
  for (const root of [road.group, buildings.group]) batchStatic(root);
  // Survey-based streetscape (boundaries, species canopy, kerb parking, lamps, wires, zebras, tiled roofs).
  // Its canopy replaces the generic all-broadleaf detail trees, which WorldDetail then skips for this map.
  const streetscape = new PsychikoStreetscape(map, group, heightC);
  streetscape.buildRoofs(buildings.roofs);
  map.ownVegetation = true; map.pitchedRoofs = true;
  return { group, road, people, obstacles: streetscape.obstacles, streetscape, dispose: () => streetscape.dispose() };
}
