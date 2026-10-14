// Runtime ownership of one map. The renderer, sky, lights and player cars belong to main.js;
// every object added here is detached and disposed when the map is replaced.
import * as THREE from 'three';
import * as ENV from './env.js';
import { Ground, Splash, buildHumps, buildBarriers, buildSandTraps } from './ground.js';
import { buildTerrain } from './terrain.js';
import { buildRoad } from './road.js';
import { RoadNetwork } from './road-network-surface.js';
import { buildRoadNetwork, buildNetworkParking } from './road-network.js';
import { buildBuildings, infillBuildings, LabelAtlas } from './buildings.js';
import { buildNature } from './nature.js';
import { buildRoadside } from './roadside.js';
import { buildSpeedSigns } from './speed-signs.js';
import { buildWorldContext } from './world-context.js';
import { buildRivieraLandmarks } from './riviera-landmarks.js';
import { buildStreetLife } from './street-life.js';
import { Traffic } from './traffic.js';
import { Signals, findJunctions } from './signals.js';
import { People } from './people.js';
import { Fx } from './fx.js';
import { EventMarkers } from './event-markers.js';
import { batchStatic } from './batch.js';
import { simplifyScenery } from './graphics.js';
import { TX } from './tex.js';
import { frameYield } from './util.js';
import { addBuildingImpostors, prepareSceneryLod } from './scenery.js';

function resources(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      materials.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      for (const u of Object.values(m.uniforms || {})) if (u.value?.isTexture) textures.add(u.value);
    }
  });
  return { geometries, materials, textures };
}

/** Dispose only resources owned by root; shared texture library and still-live objects survive. */
export function disposeMapGroup(root, liveScene) {
  root.removeFromParent();
  const owned = resources(root), live = resources(liveScene);
  for (const t of Object.values(TX)) if (t?.isTexture) live.textures.add(t);
  if (liveScene.environment) live.textures.add(liveScene.environment);
  if (ENV.bakedSky()) live.textures.add(ENV.bakedSky());
  const counts = { geometries: 0, materials: 0, textures: 0 };
  for (const kind of Object.keys(owned)) for (const value of owned[kind]) {
    // Framebuffer attachments must be released through their owning RenderTarget.
    if (live[kind].has(value) || value.userData?.shared || (kind === 'textures' && value.isRenderTargetTexture)) continue;
    value.dispose(); counts[kind]++;
  }
  // Instanced attributes belong to the mesh, rather than its shared geometry.
  // Three releases instanceMatrix/instanceColor buffers on this separate event.
  root.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  root.clear();
  return counts;
}

export async function buildMapWorld(map, { scene, sky, skyCube, lowGraphics = false, quality = lowGraphics ? 'low' : 'high', progress = () => {} }) {
  const group = new THREE.Group(); group.name = 'map-world:' + map.id;
  const coastal = !map.id || map.id === 'riviera';
  const route = map.route;
  const network = map.data.roadNetwork && !new URLSearchParams(location.search).has('noroadnetwork') ? new RoadNetwork(map) : null;
  map.roadNetwork = network;
  let water = null, custom = null;
  scene.add(group);
  try {
    progress('BUILDING TERRAIN', .25); await frameYield();
    const infill = coastal ? infillBuildings(map, (x, z) => map.terrain.height(x, z)) : [];
    const ter = buildTerrain(map.terrain, route, [], group, { coastal, farmland: map.id === 'megara', network });
    if (coastal) { water = ENV.createWater(skyCube, map.terrain, ENV.makeDepthTexture(map.terrain)); group.add(water.mesh); }
    if (lowGraphics) simplifyScenery(sky, skyCube, water, ter);
    const labels = new LabelAtlas();
    const assets = { labels, water, makeLabel: (t, w, h, bg, fg) => { const r = labels.add(t, bg, fg); return r ? labels.plane(r, w, h) : new THREE.Group(); } };
    progress(coastal ? 'PAVING POSEIDONOS AVENUE' : 'BUILDING ' + (map.definition?.name || map.id).toUpperCase(), .4); await frameYield();
    assets.junctions = coastal ? findJunctions(map) : [];
    assets.network = network;
    if (network) buildRoadNetwork(network, group);
    let road, natureGroup, signals;
    if (coastal) {
      road = buildRoad(map, group, ter.heightC, assets); assets.asphalt = road.asphalt;
      signals = new Signals(map, group, road.group, assets.junctions);
      progress('RAISING VOULIAGMENI', .55); await frameYield();
      const bld = buildBuildings(map, group, ter.heightC, labels, infill);
      progress('PLANTING PALMS AND PINES', .7); await frameYield();
      const nat = buildNature(map, group, ter.heightC, bld, assets); natureGroup = nat.group;
      // Keep the original Riviera builders and their order, including the people before static batching.
      const people = new People(map, group, assets, natureGroup);
      custom = { people, ...buildRoadside(map, group, ter.heightC, assets) };
      for (const g of [road.group, bld.group, nat.group]) batchStatic(g);
      addBuildingImpostors(bld.group, quality);
      group.add(ENV.createFarScenery(map.data.proj));
    } else {
      const module = await import(`./maps/${map.id}.js`);
      custom = await module.buildScenery(group, map, { heightC: ter.heightC, assets });
      if (map.id === 'megara' || map.id === 'penteli') group.add(ENV.createFarScenery(map.data.proj, map.id));
      if (custom?.group && !custom.group.parent) group.add(custom.group);
      Object.assign(assets, custom?.assets || {});
      // Open-road bundles can provide scenery only; the standard road surface omits coast-specific furniture.
      if (!route.closed && !custom?.road) { assets.furniture = false; road = buildRoad(map, group, ter.heightC, assets); }
      else road = custom?.road || { group: custom?.group || group, asphalt: custom?.asphalt };
      if (road.asphalt) assets.asphalt = road.asphalt;
      natureGroup = new THREE.Group(); group.add(natureGroup);
    }
    const landmarks = coastal ? buildRivieraLandmarks(map, group) : null;
    buildWorldContext(map, group, ter.heightC);
    // Real speed-limit signs from the map data (all maps; a no-op without sign data).
    const speedSigns = buildSpeedSigns(map, group, ter.heightC);
    signals ||= new Signals(map, group, road.group, assets.junctions);
    const people = custom?.people || new People(map, group, assets, natureGroup);
    const streetLife = buildStreetLife(map, group, ter.heightC, coastal ? custom : null);
    people.streetLife = streetLife;
    people.anchors.push(...streetLife.artists); people.anchors.sort((a, b) => a.s - b.s);
    if (route.closed) { people.dens = () => 0; people.anchors.length = 0; }
    progress('FUELLING THE CARS', .85); await frameYield();
    const traffic = new Traffic(group, route, map.data);
    traffic.signals = signals; traffic.people = people; people.traffic = traffic;
    traffic.busStops = (assets.busStops || []).slice().sort((a, b) => a - b);
    const ground = custom?.ground || new Ground(map, ter.heightC, assets);
    if (coastal) traffic.buildParkedRows(group, ground);
    const streetParking = network ? buildNetworkParking(network, group, ground) : [];
    ground.parked = (traffic.parkedCars || []).concat(custom?.obstacles || [], speedSigns.obstacles, streetParking, landmarks?.obstacles || [], streetLife.obstacles);
    ground.constrainCamera = landmarks?.constrainCamera;
    traffic.ground = ground;
    if (coastal) { buildHumps(map, group, ter.heightC); buildSandTraps(ground, group); buildBarriers(map, group); }
    const splash = new Splash(group), fx = new Fx(group, route, ground);
    const markers = new EventMarkers(group, route);
    const lod = prepareSceneryLod(group, quality);
    let disposed = false;
    return { map, group, water, assets, signals, people, traffic, ground, splash, fx, markers, lod,
      dispose() {
        if (disposed) return; disposed = true;
        // Damage fragments are parented directly to scene, outside this map root.
        for (const car of traffic.cars) car.m?.disposeDamage?.();
        const counts = disposeMapGroup(group, scene);
        // LabelAtlas can be empty on an inland map, hence not reachable through a mesh.
        labels.tex.dispose(); labels.mat.dispose();
        water?.dispose?.(); custom?.dispose?.(); map.dispose?.();
        return counts;
      },
    };
  } catch (error) { disposeMapGroup(group, scene); water?.dispose?.(); map.dispose?.(); throw error; }
}
