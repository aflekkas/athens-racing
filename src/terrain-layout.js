import * as THREE from 'three';

// Tile-local integer XYZ. The small Float32 Y residual preserves the exact
// final Float32 height, including road-clearance/slope constraints. It is not a
// second surface: CPU getters and every material decode the same two terms.
export class TerrainPosition extends THREE.BufferAttribute {
  constructor(array, decode, residual) { super(array, 3); this.decode = decode; this.residual = residual; }
  component(i, axis) {
    const d = this.decode;
    const high = Math.fround(d.offset[axis] + this.array[i * 3 + axis] * d.scale[axis]);
    return axis === 1 ? Math.fround(high + this.residual[i]) : high;
  }
  getX(i) { return this.component(i, 0); }
  getY(i) { return this.component(i, 1); }
  getZ(i) { return this.component(i, 2); }
}
export function restoreTerrainLayout(mesh) {
  const decode = mesh.userData.terrainDecode;
  if (!decode) return;
  const g = mesh.geometry;
  g.setAttribute('position', new TerrainPosition(g.attributes.position.array, decode, g.attributes.aHeightResidual.array));
  if (!g.boundingBox) g.computeBoundingBox();
  if (!g.boundingSphere) g.computeBoundingSphere();
  mesh.material = terrainChunkMaterial(mesh.material, decode);
}
export function terrainChunkMaterial(source, decode) {
  if (!decode) return source;
  const mat = source.clone(), compile = source.onBeforeCompile;
  mat.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    shader.uniforms.terrainOffset = { value: new THREE.Vector3(...decode.offset) };
    shader.uniforms.terrainScale = { value: new THREE.Vector3(...decode.scale) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 terrainOffset; uniform vec3 terrainScale; attribute float aHeightResidual;')
      .replace('#include <begin_vertex>', 'vec3 transformed = terrainOffset + position * terrainScale; transformed.y += aHeightResidual;');
  };
  mat.customProgramCacheKey = () => source.customProgramCacheKey() + ':terrain-u16-v1';
  return mat;
}
export function compactTerrainGeometry(g, step) {
  const p = g.attributes.position, count = p.count;
  g.computeBoundingBox();
  const box = g.boundingBox, offset = box.min.toArray();
  // Power-of-two Y scale makes the multiply exact in the shader. A residual
  // restores the original float after the offset addition rounds to Float32.
  const scale = [step, 2 ** Math.ceil(Math.log2(Math.max(1e-6, box.max.y - box.min.y) / 65535)), step];
  const decode = { version: 1, offset, scale }, quantized = new Uint16Array(count * 3), residual = new Float32Array(count);
  for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) {
    const value = p.array[i * 3 + a], q = Math.round((value - offset[a]) / scale[a]);
    if (q < 0 || q > 65535) throw new Error('Terrain tile exceeds Uint16 extent');
    quantized[i * 3 + a] = q;
    if (a === 1) residual[i] = value - Math.fround(offset[a] + q * scale[a]);
    else if (Math.fround(offset[a] + q * scale[a]) !== value) throw new Error('Terrain lattice cannot be represented exactly');
  }
  g.setAttribute('position', new TerrainPosition(quantized, decode, residual));
  g.setAttribute('aHeightResidual', new THREE.BufferAttribute(residual, 1));
  for (const name of ['normal', 'color', 'aU']) {
    const a = g.attributes[name], signed = name === 'normal', array = signed ? new Int8Array(a.array.length) : new Uint8Array(a.array.length);
    for (let i = 0; i < array.length; i++) array[i] = Math.round(Math.max(signed ? -1 : 0, Math.min(1, a.array[i])) * (signed ? 127 : 255));
    g.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize, true));
  }
  if (count > 65535) throw new Error('Terrain tile exceeds Uint16 vertex count');
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(g.index.array), 1));
  g.userData.terrainDecode = decode;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g;
}
// Test/debug utility: raw GPU buffers are intentionally not world-space floats.
export function terrainWorldPositions(mesh) {
  const p = mesh.geometry.attributes.position;
  if (!mesh.userData.terrainDecode) return p.array;
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { out[i*3]=p.getX(i); out[i*3+1]=p.getY(i); out[i*3+2]=p.getZ(i); }
  return out;
}
