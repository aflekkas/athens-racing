// No scene rendering, DOM, audio, or gameplay. Return the original generators' exact transferable buffers.
import * as THREE from 'three';
import { loadMap } from './map.js';
import { buildTerrain } from './terrain.js';
import { RoadNetwork } from './road-network-surface.js';
import { buildRoadNetwork } from './road-network.js';
import { packGroup } from './baked-world-pack.js';
self.onmessage = async ({ data: { id } }) => {
  try {
    const start = performance.now();
    self.postMessage({ type: 'progress', stage: 'map', step: 0, steps: 4 });
    const map = await loadMap(undefined, '/', id, { preload: false }), network = new RoadNetwork(map), scene = new THREE.Group();
    map.roadNetwork = network;
    const mapReady = performance.now();
    self.postMessage({ type: 'progress', stage: 'terrain', step: 1, steps: 4 });
    const ter = buildTerrain(map.terrain, map.route, [], scene, { coastal: id === 'riviera', farmland: id === 'megara', gardens: id === 'psychiko', network, beachAreas: map.data.areas?.beach || [] });
    const terrainReady = performance.now();
    self.postMessage({ type: 'progress', stage: 'roads', step: 2, steps: 4 });
    const terrain = packGroup(ter.group, { map: id, grid: map.terrain.GX * map.terrain.GZ, height: 0, source: 1 }, [map.terrain.Hc, network.source]);
    const root = buildRoadNetwork(network, scene);
    const roadsReady = performance.now();
    self.postMessage({ type: 'progress', stage: 'buffers', step: 3, steps: 4 });
    const roads = packGroup(root, { map: id, grid: map.terrain.GX * map.terrain.GZ, stats: { triangles: network.stats.triangles, tiles: network.stats.tiles } });
    self.postMessage({ terrain, roads, timings: { map: mapReady - start, terrain: terrainReady - mapReady, roads: roadsReady - terrainReady, total: performance.now() - start } }, [terrain, roads]);
  } catch (e) { self.postMessage({ error: e.message }); }
};
