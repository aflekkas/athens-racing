import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { decodeGeometryPack } from '../src/baked-geometry.js';
import { validateWorldManifest, validateWorldTile, validateTileSeam } from '../src/world-tile-format.js';
export async function validateDirectory(path) {
  const manifest = validateWorldManifest(JSON.parse(await readFile(path, 'utf8'))), packs = new Map();
  let bytes = 0, decodedBytes = 0, triangles = 0;
  for (const [key, entry] of Object.entries(manifest.tiles)) {
    const url = new URL(entry.url, 'https://local/' + path.replace(/^\//,''));
    if (url.origin !== 'https://local') throw new Error('Validator accepts local tile files only');
    let body = await readFile(resolve(dirname(path), entry.url));
    if (entry.range) body = body.subarray(entry.range.offset, entry.range.offset + entry.range.length);
    if (body.length !== entry.bytes || createHash('sha256').update(body).digest('hex') !== entry.sha256) throw new Error(`Tile integrity ${key}`);
    const raw = gunzipSync(body), buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const pack = decodeGeometryPack(buffer), result = validateWorldTile(pack, { world: manifest.world, revision: manifest.revision, cell: key.split(',').map(Number) });
    if (result.bytes > entry.decodedBytes || result.triangles !== entry.triangles) throw new Error(`Tile accounting ${key}`);
    bytes += body.length; decodedBytes += result.bytes; triangles += result.triangles; packs.set(key,pack);
  }
  for (const [key,a] of packs) { const [x,z] = key.split(',').map(Number); for (const next of [`${x+1},${z}`, `${x},${z+1}`]) if (packs.has(next)) validateTileSeam(a,packs.get(next)); }
  return { tiles:packs.size, bytes, decodedBytes, triangles, bytesPerKm2: bytes / (packs.size * .512**2) };
}
if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(await validateDirectory(resolve(process.argv[2])),null,2));
