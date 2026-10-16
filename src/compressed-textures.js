import { RGBAFormat } from 'three';
import { TEXTURE_MANIFEST, BASIS_TRANSCODER_PATH } from './texture-manifest.js';
import { textureCodecsEnabled, assetMetrics } from './asset-metrics.js';
let loader, loaderReady, activeRenderer;
export function configureTextureCodecs(renderer) {
  activeRenderer = renderer;
}
function prepareLoader() {
  if (!textureCodecsEnabled() || loaderReady || !activeRenderer || typeof Worker === 'undefined') return;
  loaderReady = import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
    const candidate = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH).setWorkerLimit(2).detectSupport(activeRenderer);
    // Prefer original images over expanding to RGBA when no GPU block format is supported.
    if (!Object.values(candidate.workerConfig).some(Boolean)) { candidate.dispose(); return; }
    loader = candidate;
  }).catch(e => { console.warn('KTX2 unavailable, using images:', e.message); });
}
export function textureEntry(url) { return TEXTURE_MANIFEST[new URL(url, location.href).pathname]; }
export async function loadCompressedTexture(target, url) {
  if (!textureCodecsEnabled()) return false;
  const entry = textureEntry(url);
  if (!entry?.enabled) return false;
  prepareLoader();
  if (loaderReady) await loaderReady;
  if (!loader) return false;
  const t = performance.now(); let timer, timedOut = false;
  try {
    const source = await Promise.race([loader.loadAsync(entry.url), new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Texture worker timed out')); }, 30000); })]);
    if (!source.isCompressedTexture || source.format === RGBAFormat || !source.mipmaps.length) { source.dispose(); return false; }
    const wrapS = target.wrapS, wrapT = target.wrapT, anisotropy = target.anisotropy, colorSpace = target.colorSpace, name = target.name, userData = target.userData;
    target.dispose(); // An atlas may already have immutable RGBA GPU storage from its image fallback.
    target.copy(source); target.isCompressedTexture = source.isCompressedTexture;
    target.name = name; Object.assign(target.userData, userData);
    target.wrapS = wrapS; target.wrapT = wrapT; target.anisotropy = anisotropy; target.colorSpace = colorSpace;
    target.userData.averageColor = entry.average; target.needsUpdate = true;
    const metric = { url: entry.url, codec: entry.mode, format: source.format, mipCount: source.mipmaps.length, downloadBytes: entry.bytes, decodeWallMs: performance.now() - t };
    Object.assign(metric, { gpuBytes: source.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0), width: source.image.width, height: source.image.height, skippedMips: 0 });
    assetMetrics.textures.push(metric);
    return true;
  } catch (e) { if (timedOut) { loader?.dispose(); loader = undefined; } console.warn('KTX2 unavailable, using image:', url, e.message); return false; }
  finally { clearTimeout(timer); }
}
