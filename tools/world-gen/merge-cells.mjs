// Stream an incremental shared-boundary bake into the authoritative full-world
// packer. No NDJSON spool or second cell copy. Reused cells are immutable,
// integrity-checked baseline cells; every cell is repacked and gated together.
// Called by build-coast.mjs when ATHENS_REUSE_MANIFEST is explicitly supplied.
import {readFile,statfs} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {once} from 'node:events';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodeTilePack} from '../../src/world-tile-codec.js';
import {tileTables,validateWorldManifest} from '../../src/world-tile-format.js';
import {apiClient,credentials,STAGING} from '../world-r2.mjs';
const [baselinePath,rebuiltPath,cellList]=process.argv.slice(2),base=validateWorldManifest(JSON.parse(await readFile(baselinePath))),rebuilt=validateWorldManifest(JSON.parse(await readFile(rebuiltPath))),cells=JSON.parse(cellList);
if(base.world!==rebuilt.world||JSON.stringify(base.projection)!==JSON.stringify(rebuilt.projection))throw Error('Incremental bake must extend the same world/projection');
const union=new Set(cells.map(c=>c.join(',')));
for(const cell of cells)if(!base.tiles[cell.join(',')])for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const key=`${cell[0]+dx},${cell[1]+dz}`;if(union.has(key)&&!rebuilt.tiles[key])throw Error('Missing rebuilt shared boundary halo '+key);}
let api=apiClient(await credentials()),reused=0,generated=0;
async function fetchBaseline(url){
 for(let attempt=0;attempt<4;attempt++)try{return Buffer.from(await(await api(STAGING,'/'+url.slice('/world/'.length))).arrayBuffer());}catch(error){
  if(attempt===3)throw error;
  if(error.message.includes('(401)'))api=apiClient(await credentials());
  await new Promise(resolve=>setTimeout(resolve,500*2**attempt));
 }
}
const audits=new Map((await readFile(process.env.ATHENS_REBUILT_AUDIT||resolve(dirname(rebuiltPath),'../python-audit.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>{const a=JSON.parse(line);return [a.cell.join(','),a];}));
for(const cell of cells){
 const disk=await statfs('/'),used=disk.blocks-disk.bfree,percent=Math.ceil(100*used/(used+disk.bavail));if(percent>=83)throw Error('Shared disk hard stop: '+percent+'%');
 const key=cell.join(','),fresh=rebuilt.tiles[key],entry=fresh||base.tiles[key];if(!entry)throw Error('Missing union cell '+key);
 let bytes;
 if(fresh){bytes=await readFile(resolve(dirname(rebuiltPath),entry.url));generated++;}
 else{
  if(!/^\/world\/cells\/[a-f0-9]{64}\.bin\.gz$/.test(entry.url))throw Error('Only immutable staging baseline cells can be reused');
  bytes=await fetchBaseline(entry.url);reused++;
 }
 if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Cell integrity mismatch '+key);
 const raw=gunzipSync(bytes,{maxOutputLength:entry.decodedBytes}),pack=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),entry.decodedBytes);
 if(pack.metadata.cell.join(',')!==key||pack.metadata.world!==base.world||pack.metadata.revision!==(fresh?(fresh.sourceRevision||rebuilt.revision):base.revision))throw Error('Cell identity mismatch '+key);
 pack.metadata.revision=rebuilt.revision;
 const input={metadata:pack.metadata,arrays:pack.arrays.map(a=>({type:a.constructor.name,data:Array.from(a)})),tables:Object.fromEntries(Object.entries(tileTables(pack)).map(([name,a])=>[name,Array.from(a)])),dependencies:[]};
 if(!process.stdout.write(JSON.stringify(input)+'\n'))await once(process.stdout,'drain');
 if(fresh&&audits.has(key))console.error(JSON.stringify(audits.get(key)));
 console.error(JSON.stringify({merged:key,reused:!fresh}));
}
console.error(JSON.stringify({mergeComplete:true,generated,reused,baselineRevision:base.revision,revision:rebuilt.revision}));
