// ASR2: generic lossless EXT_meshopt_compression-style buffer views.
// Vertex layouts remain owned by the terrain builder; codec never converts attribute values.
const TYPES = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array };
export const MESHOPT_MAGIC = 0x32525341;
let workers = false, workersFailed = false;
export async function decodeMeshoptPack(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MESHOPT_MAGIC) throw new Error('Invalid meshopt magic');
  const size = dv.getUint32(4, true), start = dv.getUint32(8, true);
  if (size > buffer.byteLength - 12 || start < 12 + size || start > buffer.byteLength) throw new Error('Invalid meshopt header');
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, size)));
  if (metadata.version !== 2 || !Array.isArray(metadata.views)) throw new Error('Invalid meshopt version');
  // Raw views do not need the decoder or its WASM payload at all.
  const MeshoptDecoder = metadata.views.some(v => v.codec === 'ATTRIBUTES') ? (await import('three/addons/libs/meshopt_decoder.module.js')).MeshoptDecoder : null;
  if (MeshoptDecoder) {
    if (!workers && !workersFailed && typeof Worker !== 'undefined') { try { MeshoptDecoder.useWorkers(1); workers = true; } catch { workersFailed = true; } }
    await MeshoptDecoder.ready;
  }
  const arrays = [];
  for (const v of metadata.views) {
    const Type = TYPES[v.type], end = start + v.offset + v.byteLength;
    if (!Type || !Number.isSafeInteger(v.length) || v.length < 0 || v.length * Type.BYTES_PER_ELEMENT > 256 * 1024 * 1024 || !Number.isSafeInteger(v.offset) || v.offset < 0 || !Number.isSafeInteger(v.byteLength) || v.byteLength < 0 || end > buffer.byteLength) throw new Error('Invalid meshopt view');
    const source = new Uint8Array(buffer, start + v.offset, v.byteLength);
    let bytes;
    if (v.codec === 'ATTRIBUTES') {
      if (!Number.isSafeInteger(v.stride) || v.stride < 4 || v.stride > 256 || v.stride % 4 || !Number.isSafeInteger(v.count) || v.count < 0 || v.count * v.stride > 256 * 1024 * 1024 || v.count * v.stride < v.length * Type.BYTES_PER_ELEMENT) throw new Error('Invalid meshopt stride');
      if (workers && !workersFailed) {
        let timer;
        try {
          bytes = await Promise.race([MeshoptDecoder.decodeGltfBufferAsync(v.count, v.stride, source, 'ATTRIBUTES'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Meshopt worker timed out')), 15000); })]);
        } catch {
          // Worker startup/script/CSP failures must not leave a map loading forever.
          workersFailed = true; bytes = new Uint8Array(v.count * v.stride);
          MeshoptDecoder.decodeGltfBuffer(bytes, v.count, v.stride, source, 'ATTRIBUTES');
        } finally { clearTimeout(timer); }
      } else {
        bytes = new Uint8Array(v.count * v.stride);
        MeshoptDecoder.decodeGltfBuffer(bytes, v.count, v.stride, source, 'ATTRIBUTES');
      }
    } else if (v.codec === 'raw') {
      if (v.byteLength !== v.length * Type.BYTES_PER_ELEMENT) throw new Error('Invalid raw view');
      bytes = source.slice();
      if (v.shuffled) {
        const out = new Uint8Array(bytes.length), width = Type.BYTES_PER_ELEMENT;
        for (let b = 0; b < width; b++) for (let n = 0; n < v.length; n++) out[n * width + b] = bytes[b * v.length + n];
        bytes = out;
      }
    } else throw new Error('Unsupported meshopt codec');
    arrays.push(new Type(bytes.buffer, bytes.byteOffset, v.length));
  }
  return { metadata, arrays };
}
