// Compact, lossless buffer container. JSON describes aligned typed-array views; no geometry is quantised.
const TYPES = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray };
const MAGIC = 0x31525341; // ASR1
export function encodeGeometryPack(metadata, arrays, shuffled = []) {
  let length = 0, viewsIndex = 0;
  const alignment = arrays.some(a => a.BYTES_PER_ELEMENT > 4) ? 8 : 4;
  const views = arrays.map(a => {
    if (!TYPES[a.constructor.name]) throw new Error('Unsupported baked array');
    length = Math.ceil(length / alignment) * alignment;
    const v = { type: a.constructor.name, offset: length, length: a.length, shuffled: shuffled[viewsIndex++] === true };
    length += a.byteLength; return v;
  });
  const json = new TextEncoder().encode(JSON.stringify({ version: 1, ...metadata, views }));
  const start = Math.ceil((12 + json.length) / alignment) * alignment;
  const buffer = new ArrayBuffer(start + length), dv = new DataView(buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, json.length, true); dv.setUint32(8, start, true);
  new Uint8Array(buffer, 12, json.length).set(json);
  arrays.forEach((a, i) => {
    // Byte planes put repeated float exponent/sign bytes together for gzip without losing a single bit.
    const source = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), dest = new Uint8Array(buffer, start + views[i].offset, a.byteLength);
    if (!views[i].shuffled) { dest.set(source); return; }
    const width = a.BYTES_PER_ELEMENT;
    for (let byte = 0; byte < width; byte++) for (let n = 0; n < a.length; n++) dest[byte * a.length + n] = source[n * width + byte];
  });
  return buffer;
}
export function decodeGeometryPack(buffer, { consume = false } = {}) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Invalid baked geometry magic');
  const start = dv.getUint32(8, true), size = dv.getUint32(4, true);
  if (start < 12 + size || start % 4) throw new Error('Invalid baked geometry header');
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, size)));
  if (metadata.version !== 1) throw new Error('Unsupported baked geometry version');
  // The loader owns its inflated buffer. Unshuffle into that allocation so a
  // single raw attribute cannot retain the whole pack alongside copied arrays.
  let scratch;
  const arrays = metadata.views.map(v => {
    const Type = TYPES[v.type];
    if (!Type || !Number.isSafeInteger(v.offset) || v.offset < 0 || !Number.isSafeInteger(v.length) || v.length < 0) throw new Error('Invalid baked geometry view');
    const source = new Uint8Array(buffer, start + v.offset, v.length * Type.BYTES_PER_ELEMENT);
    if (!v.shuffled && !metadata.shuffled) return new Type(buffer, start + v.offset, v.length);
    const array = consume ? new Type(buffer, start + v.offset, v.length) : new Type(v.length), dest = new Uint8Array(array.buffer, array.byteOffset, array.byteLength), width = Type.BYTES_PER_ELEMENT;
    let input = source;
    if (consume) {
      if (!scratch || scratch.length < source.length) scratch = new Uint8Array(source.length);
      scratch.set(source); input = scratch;
    }
    for (let byte = 0; byte < width; byte++) for (let n = 0; n < v.length; n++) dest[n * width + byte] = input[byte * v.length + n];
    return array;
  });
  return { metadata, arrays };
}
