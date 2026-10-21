// Repack the existing union with local terrain refinements. Four workers maximum,
// each using the authoritative packer; the parent checks every cross-worker seam.
// Usage: node refine-world.mjs BASE_MANIFEST HASH_CELL_DIR OUTPUT [PARTIAL_CELL_DIR]
import fs from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawn} from 'node:child_process';import {Readable} from 'node:stream';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {decodeTilePack} from '../../src/world-tile-codec.js';import {tileTables,validateWorldManifest} from '../../src/world-tile-format.js';import {packTiles,encodeTile,WORLD_CEILING_BYTES} from './pack.mjs';import {refineCoastalLakes} from './coastal-relief.mjs';import {credentials,apiClient,STAGING} from '../world-r2.mjs';import {auditRockBores} from '../world-bore-audit.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const wire=pack=>({metadata:pack.metadata,arrays:pack.arrays.map(a=>({type:a.constructor.name,data:Array.from(a)})),tables:Object.fromEntries(Object.entries(tileTables(pack)).map(([k,a])=>[k,Array.from(a)])),dependencies:[]});
async function disk(){const d=await fs.statfs('/');if(Math.ceil((d.blocks-d.bfree)/(d.blocks-d.bfree+d.bavail)*100)>=83)throw Error('Shared disk hard stop: 83%');}
if(process.argv[2]==='--worker'){
 const config=JSON.parse(await fs.readFile(process.argv[3])),worker=Number(process.argv[4]),base=validateWorldManifest(JSON.parse(await fs.readFile(config.base))),out=join(config.out,'worker'+worker);await fs.mkdir(out,{recursive:true});
 let api;const audits=[],seams={},variants=new Map(),keys=Object.keys(base.tiles).filter((_,i)=>i%config.workers===worker);
 async function* inputs(){for(const key of keys){await disk();const entry=base.tiles[key];let bytes=await fs.readFile(join(config.cache,entry.sha256+'.bin.gz')).catch(()=>null),pack;
  // An interrupted earlier pack can be reused only if reversing its revision
  // reproduces the exact original compressed source hash. Otherwise fetch it.
  if(!bytes&&config.partial?.[key]){const b=gunzipSync(await fs.readFile(config.partial[key])),p=await decodeTilePack(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),entry.decodedBytes);p.metadata.revision=base.revision;const candidate=encodeTile(wire(p)).bytes;if(digest(candidate)===entry.sha256){bytes=candidate;pack=p;}}
  if(!bytes){for(let attempt=0;attempt<4;attempt++)try{api??=apiClient(await credentials());bytes=Buffer.from(await(await api(STAGING,'/cells/'+entry.sha256+'.bin.gz')).arrayBuffer());break;}catch(error){api=null;if(attempt===3)throw error;}}
  if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw Error('Source hash mismatch '+key);
  if(!pack){const raw=gunzipSync(bytes);pack=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),entry.decodedBytes);}
  const refinement=refineCoastalLakes(pack);pack.metadata.revision=config.revision;audits.push({key,sourceSha256:entry.sha256,refinement});yield JSON.stringify(wire(pack))+'\n';
 }}
 const entries=await packTiles(Readable.from(inputs()),out,{maxBytes:WORLD_CEILING_BYTES,onTile:async({key,entry,physical,bridges,roads,bores,packet,seams:edges})=>{
  const dressedBores=auditRockBores({...packet,metadata:{...packet.metadata,meshes:packet.metadata.meshes.filter(m=>!m.userData?.landmarkBox)}});if(!dressedBores.passed)throw Error('Dressed bore clearance: '+JSON.stringify(dressedBores));
  entry.contactEligible=true;entry.dependencies=[];seams[key]=edges;for(const v of packet.renderVariants)variants.set(v.key,v);
  await fs.appendFile(join(out,'audit.ndjson'),JSON.stringify({key,entry,physical,bridges,roads,bores,dressedBores})+'\n');console.log(JSON.stringify({worker,packed:key}));
 }});
 await fs.writeFile(join(out,'result.json'),JSON.stringify({entries,seams,variants:[...variants.values()],sources:audits}));
}else{
 const [basePath,cachePath,outPath,partialPath]=process.argv.slice(2);if(!outPath)throw Error('Expected BASE_MANIFEST HASH_CELL_DIR OUTPUT [PARTIAL_CELL_DIR]');await disk();const out=resolve(outPath);await fs.mkdir(out,{recursive:true});
 const base=validateWorldManifest(JSON.parse(await fs.readFile(basePath))),revision=createHash('sha256').update(base.revision).update(await fs.readFile(new URL('./coastal-relief.mjs',import.meta.url))).update(await fs.readFile(new URL('../../src/coastal-dressing-data.js',import.meta.url))).digest('hex'),partial={};
 if(partialPath)for(const file of await fs.readdir(partialPath)){const m=/^(-?\d+)-(-?\d+)-[a-f0-9]{64}\.bin\.gz$/.exec(file);if(m)partial[m[1]+','+m[2]]=resolve(partialPath,file);}
 const config={base:resolve(basePath),cache:resolve(cachePath),out,revision,workers:Math.min(4,Math.max(1,Number(process.env.ATHENS_WORKERS)||4)),partial};await fs.writeFile(join(out,'config.json'),JSON.stringify(config));
 const children=[];const stop=()=>{for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');};process.once('SIGINT',()=>{stop();process.exitCode=130;});process.once('SIGTERM',()=>{stop();process.exitCode=143;});
 try{await Promise.all(Array.from({length:config.workers},(_,i)=>new Promise((res,rej)=>{const c=spawn(process.execPath,[import.meta.filename,'--worker',join(out,'config.json'),String(i)],{stdio:'inherit'});children.push(c);c.once('error',rej);c.once('exit',code=>code?rej(Error('Refinement worker failed '+i+': '+code)):res());})));}catch(error){stop();throw error;}
 const entries={},seams={},variants=new Map();let refinements=[];
 for(let i=0;i<config.workers;i++){const r=JSON.parse(await fs.readFile(join(out,'worker'+i,'result.json')));for(const [key,e]of Object.entries(r.entries)){if(entries[key])throw Error('Duplicate cell');entries[key]={...e,url:'./worker'+i+'/'+e.url.slice(2)};}Object.assign(seams,r.seams);for(const v of r.variants)variants.set(v.key,v);refinements.push(...r.sources.filter(s=>s.refinement.lakes));}
 if(Object.keys(entries).length!==Object.keys(base.tiles).length)throw Error('Incomplete world');let seamEdges=0,worst2x2=0;
 for(const key of Object.keys(entries)){const [x,z]=key.split(',').map(Number);for(const [other,a,b]of [[`${x+1},${z}`,1,0],[`${x},${z+1}`,3,2]])if(seams[other]){seamEdges++;if(seams[key][a]!==seams[other][b])throw Error('Cracked seam '+key+'/'+other);}
  worst2x2=Math.max(worst2x2,[[x,z],[x+1,z],[x,z+1],[x+1,z+1]].reduce((n,c)=>n+(entries[c.join(',')]?.residentBytes||0),0));}
 const bytes=Object.values(entries).reduce((n,e)=>n+e.bytes,0);if(worst2x2>64*1024**2||bytes>WORLD_CEILING_BYTES)throw Error('World budget exceeded');
 const manifest=validateWorldManifest({...base,revision,tiles:entries,renderVariants:[...variants.values()]});await fs.writeFile(join(out,'manifest.json'),JSON.stringify(manifest));await fs.writeFile(join(out,'summary.json'),JSON.stringify({revision,cells:Object.keys(entries).length,seamEdges,worst2x2,bytes,refinements},null,2));console.log(JSON.stringify({complete:true,revision,bytes,worst2x2,seamEdges}));
}
