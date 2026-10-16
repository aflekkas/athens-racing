import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readTileBytes } from './pack-world-tiles.mjs';
import { decodeTilePack } from '../src/world-tile-codec.js';
import { validateWorldManifest, validateWorldTile, tileEdgeSignatures } from '../src/world-tile-format.js';
export async function validateDirectory(path) {
  const manifest = validateWorldManifest(JSON.parse(await readFile(path, 'utf8'))), edges = new Map();
  let bytes = 0, decodedBytes = 0, triangles = 0;
  for (const [key, entry] of Object.entries(manifest.tiles)) {
    const url = new URL(entry.url, 'https://local/' + path.replace(/^\//,''));
    if (url.origin !== 'https://local') throw new Error('Validator accepts local tile files only');
    const body = await readTileBytes(path, entry);
    if (body.length !== entry.bytes || createHash('sha256').update(body).digest('hex') !== entry.sha256) throw new Error(`Tile integrity ${key}`);
    const raw = gunzipSync(body,{maxOutputLength:entry.decodedBytes}), buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const pack = await decodeTilePack(buffer,entry.decodedBytes), result = validateWorldTile(pack, { world: manifest.world, revision: manifest.revision, cell: key.split(',').map(Number) });
    if (result.bytes > entry.decodedBytes || result.triangles !== entry.triangles) throw new Error(`Tile accounting ${key}`);
    bytes += body.length; decodedBytes += result.bytes; triangles += result.triangles; edges.set(key,tileEdgeSignatures(pack).map(value => createHash('sha256').update(value).digest('hex')));
  }
  for (const [key,a] of edges) { const [x,z] = key.split(',').map(Number); for (const [next,side,opposite] of [[`${x+1},${z}`,1,0],[`${x},${z+1}`,3,2]]) if (edges.has(next) && a[side] !== edges.get(next)[opposite]) throw new Error(`Cracked seam ${key} / ${next}`); }
  return { tiles:edges.size, bytes, decodedBytes, triangles, bytesPerKm2: bytes / (edges.size * .512**2) };
}
if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(await validateDirectory(resolve(process.argv[2])),null,2));
