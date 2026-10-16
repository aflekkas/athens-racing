import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Group } from 'three';
import { loadMap } from '../src/map.js';
import { generateMapBake } from './bake-world.mjs';
import { buildTerrain, sampleH } from '../src/terrain.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { buildRoadNetwork } from '../src/road-network.js';

// Promise cache is scoped to this test process, never the checkout or player cache.
const worlds = new Map();
export function worldFixture(id) {
  if (!worlds.has(id)) worlds.set(id, (async () => {
    if (process.env.ASR_TEST_FULL === '1') {
      const bake = await generateMapBake(resolve(import.meta.dirname, '..'), id);
      return { ...bake, terrain: {
        group: bake.terrainGroup,
        heightC: (x, z) => sampleH(bake.map.terrain, bake.map.terrain.Hc, x, z),
      } };
    }
    const previousFetch = globalThis.fetch, previousLocation = globalThis.location;
    try {
      globalThis.fetch = async url => new Response(readFileSync(resolve(import.meta.dirname, '..', String(url))));
      globalThis.location = { search: '' };
      const map = await loadMap(undefined, './', id, { preload: false });
      const network = new RoadNetwork(map), scene = new Group(); map.roadNetwork = network;
      const terrain = buildTerrain(map.terrain, map.route, [], scene, {
        coastal: id === 'riviera', farmland: id === 'megara', gardens: id === 'psychiko', network, beachAreas: map.data.areas?.beach || [],
      });
      const roadsGroup = buildRoadNetwork(network, scene);
      return { map, network, terrain, terrainGroup: terrain.group, roadsGroup };
    } finally {
      globalThis.fetch = previousFetch;
      if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
    }
  })());
  return worlds.get(id);
}
