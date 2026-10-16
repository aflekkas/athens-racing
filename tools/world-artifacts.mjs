// External build artifacts enter the static release without adding tile blobs to Git.
import { readFile, realpath, stat, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateWorldManifest } from '../src/world-tile-format.js';
import { readTileBytes } from './pack-world-tiles.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileHash(path) { const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex'); }
export async function stageWorldArtifact(manifestPath,out) {
  manifestPath=await realpath(manifestPath);
  const source=dirname(manifestPath),body=await readFile(manifestPath);if(body.length>25*1024*1024)throw new Error('World manifest exceeds the 25 MiB file cap');
  const manifest=validateWorldManifest(JSON.parse(body)),manifestHash=digest(body);
  if(manifest.developmentOnly===true||manifest.releaseReady===false)throw new Error('Development-only world cannot enter a public release');
  if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(manifest.world))throw new Error('World artifact needs a safe world slug');
  const files=new Map();let tileBytes=0;
  for(const [key,entry]of Object.entries(manifest.tiles)){
    if(/^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(entry.url))throw new Error('World artifact requires relative asset URLs');
    const url=new URL(entry.url,pathToFileURL(manifestPath));
    if(url.protocol!=='file:'||url.search||url.hash)throw new Error('World artifact requires local relative asset URLs');
    const lexical=fileURLToPath(url),rel=relative(source,lexical);
    if(!rel||rel==='..'||rel.startsWith('..'+sep)||resolve(rel)===rel)throw new Error('World artifact asset escapes its directory');
    const file=await realpath(lexical);if(file!==lexical)throw new Error('World artifact symlinks are not supported');
    if(!files.has(rel)){
      const info=await stat(file);if(!info.isFile()||info.size>25*1024*1024)throw new Error('World artifact exceeds the 25 MiB file cap');
      const hash=await fileHash(file),named=/-([a-f0-9]{16,64})\.(?:awt|bin\.gz)$/.exec(rel);
      if(!named||!hash.startsWith(named[1]))throw new Error('World artifact asset is not content hashed');
      files.set(rel,{file,bytes:info.size,sha256:hash});
    }
    const tile=await readTileBytes(manifestPath,entry);
    if(tile.length!==entry.bytes||digest(tile)!==entry.sha256)throw new Error(`World artifact tile integrity ${key}`);
    tileBytes+=tile.length;
  }
  // All integrity checks finish before copying; no half-validated artifact is published.
  const prefix=`data/worlds/${manifest.world}/${manifestHash.slice(0,16)}`,destination=resolve(out,prefix);
  await mkdir(destination,{recursive:true});
  for(const [rel,file]of files){const target=resolve(destination,rel);await mkdir(dirname(target),{recursive:true});await copyFile(file.file,target);}
  await writeFile(resolve(destination,'world.json'),body);
  return {world:manifest.world,revision:manifest.revision,manifest:`./${prefix}/world.json`,manifestSha256:manifestHash,tiles:Object.keys(manifest.tiles).length,files:files.size+1,bytes:body.length+[...files.values()].reduce((n,f)=>n+f.bytes,0),tileBytes,largest:Math.max(body.length,...[...files.values()].map(f=>f.bytes))};
}
if(process.argv[1]===import.meta.filename)console.log(JSON.stringify(await stageWorldArtifact(resolve(process.argv[2]),resolve(process.argv[3])),null,2));
