// Storage-only AWT/1 repacking: compressed shared-codec tile bytes remain unchanged.
import { readFile, writeFile, mkdir, open, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateWorldManifest } from '../src/world-tile-format.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX = 24 * 1024 * 1024;
/** Read one compressed tile, never the rest of its source region bundle. */
export async function readTileBytes(manifestPath, entry) {
  const url = new URL(entry.url, pathToFileURL(resolve(manifestPath)));
  if (url.protocol !== 'file:') throw new Error('Packing requires local source tiles');
  const file = await open(fileURLToPath(url), 'r');
  try {
    const stat = await file.stat(), offsetStart=entry.range?.offset||0, length=entry.range?.length||entry.bytes;
    if (stat.size>25*1024*1024 || offsetStart+length>stat.size || !entry.range && stat.size!==entry.bytes) throw new Error('Source asset length exceeds declared budget');
    const body = Buffer.alloc(length);
    let offset = 0;
    while (offset < body.length) {
      const { bytesRead } = await file.read(body, offset, body.length-offset, offsetStart+offset);
      if (!bytesRead) throw new Error('Truncated source region');
      offset += bytesRead;
    }
    return body;
  } finally { await file.close(); }
}
export async function packWorldTiles(manifestPath, out, { bundleBytes=MAX, regionCells=8 }={}) {
  if (!Number.isSafeInteger(bundleBytes) || bundleBytes < 1 || bundleBytes > MAX || !Number.isSafeInteger(regionCells) || regionCells < 1) throw new Error('Invalid region packing limits');
  const manifest = validateWorldManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  out = resolve(out);
  // Use a new directory: publishing both individual tiles and bundles saves no files.
  if (out === dirname(resolve(manifestPath))) throw new Error('Region output must be a separate directory');
  for(const [key,entry]of Object.entries(manifest.tiles))if(entry.bytes>bundleBytes)throw new Error(`Tile ${key} exceeds region packing budget`);
  await mkdir(out, { recursive:true });
  if((await readdir(out)).length)throw new Error('Region output must be empty to avoid deploying stale bundles');
  const groups = new Map();
  for (const [key, entry] of Object.entries(manifest.tiles)) {
    const [x,z] = key.split(',').map(Number), region = [Math.floor(x/regionCells),Math.floor(z/regionCells)];
    const id = region.join(','); if (!groups.has(id)) groups.set(id, { region, entries:[] });
    groups.get(id).entries.push({ key, entry, x, z });
  }
  let files = 0, bytes = 0, largest = 0;
  for (const { region, entries } of [...groups.values()].sort((a,b)=>a.region[1]-b.region[1]||a.region[0]-b.region[0])) {
    let chunks=[], owned=[], length=0, part=0;
    async function flush() {
      if (!chunks.length) return;
      const body = Buffer.concat(chunks, length), hash = sha(body), name = `region-${region[0]}-${region[1]}-${part++}-${hash.slice(0,16)}.awt`;
      await writeFile(resolve(out,name),body);
      for (const { key, entry, offset } of owned) manifest.tiles[key]={...entry,url:`./${name}`,range:{offset,length:entry.bytes}};
      files++;bytes+=length;largest=Math.max(largest,length);chunks=[];owned=[];length=0;
    }
    for (const { key, entry } of entries.sort((a,b)=>a.z-b.z||a.x-b.x)) {
      if (entry.bytes > bundleBytes) throw new Error(`Tile ${key} exceeds region packing budget`);
      const body = await readTileBytes(manifestPath,entry);
      if (body.length !== entry.bytes || sha(body) !== entry.sha256) throw new Error(`Tile integrity ${key}`);
      if (length+body.length > bundleBytes) await flush();
      owned.push({key,entry,offset:length});chunks.push(body);length+=body.length;
    }
    await flush();
  }
  manifest.storage={kind:'regional-ranges',regionCells,bundleBytes,files,bytes,largest};
  validateWorldManifest(manifest);
  await writeFile(resolve(out,'world.json'),JSON.stringify(manifest));
  return {manifest:resolve(out,'world.json'),tiles:Object.keys(manifest.tiles).length,files:files+1,bytes,largest};
}
if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(await packWorldTiles(resolve(process.argv[2]),resolve(process.argv[3])),null,2));
