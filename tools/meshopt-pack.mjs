import { MeshoptEncoder } from './vendor/meshopt_encoder.mjs';
import { gzipSync } from 'node:zlib';
import { decodeGeometryPack } from '../src/baked-geometry.js';
import { MESHOPT_MAGIC } from '../src/meshopt-pack.js';
export async function encodeMeshoptPack(buffer) {
  await MeshoptEncoder.ready;
  const { metadata, arrays } = decodeGeometryPack(buffer), chunks = [], views = [];
  let offset = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i], raw = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), width = a.BYTES_PER_ELEMENT;
    const planes = new Uint8Array(raw.length);
    for (let b = 0; b < width; b++) for (let n = 0; n < a.length; n++) planes[b * a.length + n] = raw[n * width + b];
    const rawBytes = gzipSync(raw).length, planeBytes = gzipSync(planes).length;
    let best = planeBytes < rawBytes ? planes : raw;
    const baselineBytes = Math.min(rawBytes, planeBytes);
    let codec = 'raw', shuffled = best === planes, stride = 4;
    for (const mesh of metadata.meshes || []) for (const attr of Object.values(mesh.attributes)) if (attr.array === i) {
      // Group whole packed vertices until the stream is 4-byte aligned. In particular,
      // Int8x3 uses 12 bytes and Int16x3 uses 12: no inter-vertex padding or layout assumptions.
      const size = attr.itemSize * width;
      stride = size % 4 === 0 ? size : size % 2 === 0 ? size * 2 : size * 4;
      if (stride > 256) stride = 4;
    }
    const count = Math.ceil(raw.length / stride), padded = new Uint8Array(count * stride); padded.set(raw);
    if (count) {
      const encoded = MeshoptEncoder.encodeVertexBuffer(padded, count, stride);
      // Tiny gains do not justify worker messages, WASM decode or a new allocation.
      if (baselineBytes - gzipSync(encoded).length >= Math.max(4096, baselineBytes * .01)) { best = encoded; codec = 'ATTRIBUTES'; shuffled = false; }
    }
    views.push({ type: a.constructor.name, length: a.length, offset, byteLength: best.byteLength, codec, shuffled, stride, count });
    chunks.push(best); offset += best.length;
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...metadata, version: 2, views }));
  const start = 12 + json.length, result = new Uint8Array(start + offset), dv = new DataView(result.buffer);
  dv.setUint32(0, MESHOPT_MAGIC, true); dv.setUint32(4, json.length, true); dv.setUint32(8, start, true); result.set(json, 12);
  chunks.forEach((chunk, i) => result.set(chunk, start + views[i].offset));
  return result;
}
