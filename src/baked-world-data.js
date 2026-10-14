// Start map-specific downloads as soon as map data arrives, alongside HUD and sky construction.
import { generatedWorld } from './generated-world-cache.js';
import { decodeGeometryPack } from './baked-geometry.js';

export async function loadBakedWorldData(map) {
  const def = map.data.bakedWorld;
  if (!def || def.version !== 1 || !map.data.roadNetwork || ['nobake', 'noroadnetwork'].some(key => new URLSearchParams(typeof location === 'undefined' ? '' : location.search).has(key))) return null;
  try {
    let generated = null;
    try { generated = await generatedWorld(map); } catch (e) { console.warn('World worker unavailable; using build buffers:', e.message); }
    const packs = generated ? [decodeGeometryPack(generated.terrain), decodeGeometryPack(generated.roads)] : await Promise.all([def.terrain, def.roads].map(async url => {
      const r = await fetch(url); if (!r.ok) throw new Error(`Baked world HTTP ${r.status}`);
      if (def.compression !== 'gzip' || typeof DecompressionStream === 'undefined') throw new Error('Baked compression unsupported');
      const buffer = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return decodeGeometryPack(buffer);
    }));
    for (const p of packs) if (p.metadata.map !== map.id || p.metadata.grid !== map.terrain.GX * map.terrain.GZ) throw new Error('Baked world belongs to a different map');
    if (packs[0].arrays[packs[0].metadata.height].length !== packs[0].metadata.grid || packs[0].arrays[packs[0].metadata.source].length !== packs[0].metadata.grid) throw new Error('Invalid baked height grid');
    // Validate every geometry before installing any state, so fallback never sees half a bake.
    for (const p of packs) for (const m of p.metadata.meshes) {
      for (const a of Object.values(m.attributes)) if (!p.arrays[a.array] || !a.itemSize || p.arrays[a.array].length % a.itemSize) throw new Error('Invalid baked attribute');
      if (m.index != null && !p.arrays[m.index]) throw new Error('Invalid baked index');
    }
    return { terrain: packs[0], roads: packs[1] };
  } catch (e) { console.warn('Baked world unavailable; generating:', e.message); return null; }
}
