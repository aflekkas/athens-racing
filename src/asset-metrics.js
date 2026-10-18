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
  const geometries = new Set(), textures = new Set(), buffers = new Set(); let geometryBytes = 0, textureBytes = 0;
  const attribute = a => { const array = a?.array || a?.data?.array; if (array && !buffers.has(array)) { buffers.add(array); geometryBytes += array.byteLength; } };
  const texture = t => {
    if (!t?.isTexture || textures.has(t) || t.isRenderTargetTexture) return;
    textures.add(t);
    if (t.isCompressedTexture) textureBytes += t.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0);
    else for (const image of Array.isArray(t.image) ? t.image : [t.image]) if (image?.width) textureBytes += Math.round(image.width * image.height * (image.data?.BYTES_PER_ELEMENT || 1) * 4 * (t.generateMipmaps ? 4/3 : 1));
  };
  scene.traverse(o => {
    if (o.geometry && !geometries.has(o.geometry)) {
      geometries.add(o.geometry);
      for (const a of Object.values(o.geometry.attributes)) attribute(a);
      attribute(o.geometry.index);
    }
    attribute(o.instanceMatrix); attribute(o.instanceColor);
    for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const t of Object.values(material)) texture(t);
      for (const uniform of Object.values(material.uniforms || {})) for (const t of Array.isArray(uniform.value) ? uniform.value : [uniform.value]) texture(t);
    }
  });
  texture(scene.environment); texture(scene.background);
  return { geometryBytes, textureBytes, gpuBytes: geometryBytes + textureBytes, note: 'Scene buffer capacity including instances and shader textures; visibility-dependent residency may be lower. Excludes render targets and driver overhead' };
}
