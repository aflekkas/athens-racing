// Reproducible incremental lake refinement. The supplied source manifest remains
// immutable. Feed the result to build-coast.mjs's full union pack/gate path.
// Usage: node refine-coast.mjs BASE_MANIFEST LOCAL_HASH_CELL_DIR OUTPUT
import fs from 'node:fs/promises';import {resolve} from 'node:path';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {decodeTilePack} from '../../src/world-tile-codec.js';import {tileTables,validateWorldManifest} from '../../src/world-tile-format.js';
import {refineCoastalLakes} from './coastal-relief.mjs';import {packTiles} from './pack.mjs';import {COASTAL_DRESSING} from '../../src/coastal-dressing-data.js';
import {credentials,apiClient,STAGING} from '../world-r2.mjs';
const [basePath,cellDir,outPath]=process.argv.slice(2);if(!outPath)throw Error('Expected BASE_MANIFEST LOCAL_HASH_CELL_DIR OUTPUT');
const output=resolve(outPath),base=validateWorldManifest(JSON.parse(await fs.readFile(basePath))),code=await fs.readFile(new URL('./coastal-relief.mjs',import.meta.url)),source=await fs.readFile(new URL('../../src/coastal-dressing-data.js',import.meta.url));
const disk=await fs.statfs('/');if(Math.ceil((disk.blocks-disk.bfree)/(disk.blocks-disk.bfree+disk.bavail)*100)>=83)throw Error('Shared disk hard stop: 83%');
const revision=createHash('sha256').update(base.revision).update(code).update(source).digest('hex'),keys=new Set([base.spawn.cell.join(','),...Object.entries(COASTAL_DRESSING.cells).filter(([,r])=>r.cover.some(c=>c[0]==='lake')).map(([k])=>k)]);
await fs.mkdir(output,{recursive:true});const input=output+'/input.ndjson',handle=await fs.open(input,'wx'),refinements=[],audit=[];let api;
try{for(const key of keys){const entry=base.tiles[key];if(!entry)throw Error('Refinement outside current world: '+key);
 const bytes=await fs.readFile(resolve(cellDir,entry.sha256+'.bin.gz')).catch(async()=>{api??=apiClient(await credentials());return Buffer.from(await(await api(STAGING,'/cells/'+entry.sha256+'.bin.gz')).arrayBuffer());});
 if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Source integrity mismatch '+key);
 const raw=gunzipSync(bytes),pack=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),entry.decodedBytes);refinements.push({cell:key,...refineCoastalLakes(pack)});pack.metadata.revision=revision;
 await handle.write(JSON.stringify({metadata:pack.metadata,arrays:pack.arrays.map(a=>({type:a.constructor.name,data:Array.from(a)})),tables:Object.fromEntries(Object.entries(tileTables(pack)).map(([k,a])=>[k,Array.from(a)])),dependencies:[]})+'\n');
}}finally{await handle.close();}
const tiles=await packTiles(input,output,{onTile:async({key,physical,bridges,bores})=>audit.push({key,physical,bridges,bores})});for(const e of Object.values(tiles)){e.contactEligible=true;e.dependencies=[];}
await fs.writeFile(output+'/manifest.json',JSON.stringify({...base,revision,tiles}));await fs.writeFile(output+'/audit.json',JSON.stringify({baseline:base.revision,revision,refinements,audit},null,2));await fs.writeFile(output+'/python-audit.ndjson','');await fs.rm(input);
console.log(JSON.stringify({revision,refinements}));
