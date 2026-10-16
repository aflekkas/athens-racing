// The coastal scenery is fetched only after committing to a Riviera session.
import * as ENV from '../env.js';
import { buildRoad } from '../road.js';
import { Signals } from '../signals.js';
import { buildBuildings } from '../buildings.js';
import { buildNature } from '../nature.js';
import { buildRoadside } from '../roadside.js';
import { buildRivieraLandmarks } from '../riviera-landmarks.js';
import { People } from '../people.js';
import { batchStatic } from '../batch.js';
import { frameYield } from '../util.js';
export async function buildRiviera({ map, group, ter, assets, still, progress, quality, staticRoots, infill }) {
  const road = still(() => buildRoad(map, group, ter.heightC, assets), 'road'); assets.asphalt = road.asphalt;
  const signals = new Signals(map, group, road.group, assets.junctions);
  progress('RAISING VOULIAGMENI', .55); await frameYield();
  const bld = still(() => buildBuildings(map, group, ter.heightC, assets.labels, infill), 'buildings');
  progress('BUILDING COAST AMENITIES', .7); await frameYield();
  const nat = still(() => buildNature(map, group, ter.heightC, bld, assets), 'nature'); const natureGroup = nat.group;
  // Keep the original Riviera builders and their order, including the people before static batching.
  const people = new People(map, group, assets, natureGroup);
  const custom = { people, ...still(() => buildRoadside(map, group, ter.heightC, assets), 'roadside') };
  for (const g of [road.group, bld.group, nat.group]) batchStatic(g);
  staticRoots.push(ENV.createFarScenery(map.data.proj)); group.add(staticRoots.at(-1));
  custom.landmarks = () => still(() => buildRivieraLandmarks(map, group), 'landmarks');
  return { road, signals, natureGroup, custom };
}
