// Timings are CPU/wall estimates, never GPU timer queries (software GPUs are noisy).
import { MAP_CODEC_POLICY } from './asset-codec-policy.js';
export const assetMetrics = { textures: [], maps: {} };
if (typeof window !== 'undefined') window.__assetMetrics = assetMetrics;
export const assetCodecsEnabled = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('assetcodec') === '1';
let activeMap = null;
export function setAssetCodecMap(id) { activeMap = id; }
// A generated world has no HTTP-pack savings to pay for Basis startup.
export const textureCodecsEnabled = () => assetCodecsEnabled() && new URLSearchParams(location.search).has('bakedownload') && MAP_CODEC_POLICY[activeMap]?.textures === true;
export function heapBytes() { return globalThis.performance?.memory?.usedJSHeapSize ?? null; }
export function estimateSceneMemory(scene) {
  const geometries = new Set(), textures = new Set(); let geometryBytes = 0, textureBytes = 0;
  scene.traverse(o => {
    if (o.geometry && !geometries.has(o.geometry)) {
      geometries.add(o.geometry);
      for (const a of Object.values(o.geometry.attributes)) geometryBytes += (a.array || a.data?.array)?.byteLength || 0;
      geometryBytes += o.geometry.index?.array.byteLength || 0;
    }
    for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) for (const texture of Object.values(material)) {
      if (!texture?.isTexture || textures.has(texture) || texture.isRenderTargetTexture) continue;
      textures.add(texture);
      if (texture.isCompressedTexture) textureBytes += texture.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0);
      else if (texture.image?.width) textureBytes += Math.round(texture.image.width * texture.image.height * 4 * (texture.generateMipmaps ? 4/3 : 1));
    }
  });
  return { geometryBytes, textureBytes, gpuBytes: geometryBytes + textureBytes, note: 'Scene buffer capacity; visibility-dependent residency may be lower. Excludes render targets, driver overhead and shader-uniform-only textures' };
}
