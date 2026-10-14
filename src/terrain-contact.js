// Match buildTerrain's shorter-height diagonal, rather than a bilinear saddle
// that can put the contact plane inside steep mountain triangles.
import { triangleHeight } from './road-network-surface.js';
export function sampleTerrainHeight(terrain, heights, x, z) {
  const fx = (x - terrain.minX) / terrain.T, fz = (z - terrain.minZ) / terrain.T;
  if (fx < 0 || fz < 0 || fx >= terrain.GX - 1 || fz >= terrain.GZ - 1) return -30;
  return triangleHeight(terrain, heights, x, z);
}
