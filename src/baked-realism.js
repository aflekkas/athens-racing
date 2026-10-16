// CPU-only bake into an existing GeoBatch colour buffer. No render resources.
// Fixed south-west key; the same modelling cue is retained at night.
export const BAKED_KEY = Object.freeze({ x: -0.423, z: 0.906 });

/** Shade only the vertices just appended for one world-space block.
 * Call after batch.add(), before batch.build(). Normals must be world-space.
 * base/top are the block's vertical bounds, start is its first vertex index.
 * Existing colours remain linear RGB. No topology or attribute allocation.
 */
export function bakeBlockShade(batch, start, base, top, key = BAKED_KEY) {
  const height = Math.max(top - base, 0.001);
  for (let i = start * 3; i < batch.pos.length; i += 3) {
    const ny = batch.nor[i + 1];
    const facing = Math.max(-1, Math.min(1, batch.nor[i] * key.x + batch.nor[i + 2] * key.z));
    const face = ny > 0.5 ? 1 : ny < -0.5 ? 0.65 : 0.75 + 0.10 * facing;
    // Existing top/bottom vertices interpolate a restrained contact gradient.
    const up = Math.max(0, Math.min(1, (batch.pos[i + 1] - base) / height));
    const shade = face * (0.84 + 0.16 * up);
    batch.col[i] *= shade; batch.col[i + 1] *= shade; batch.col[i + 2] *= shade;
  }
}
