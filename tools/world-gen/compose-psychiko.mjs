// Immutable partial-bake composition. Audits the shared boundary against original
// staging packets; never rewrites packet identity and never publishes production.
// CLOUDFLARE_ACCOUNT_ID=... node tools/world-gen/compose-psychiko.mjs baseline.json cells/ cache/ out.json [--upload]
import {readFile,writeFile,mkdir,statfs} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeTilePack} from '../../src/world-tile-codec.js';
import {validateWorldManifest,validateWorldTile} from '../../src/world-tile-format.js';
import {WorldRoadGraph} from '../../src/world-tile-graph.js';
import {sampleContactSeam} from '../validate-world-tile-contacts.mjs';
import {apiClient,credentials,inventory,uploadPlan,STAGING,PRODUCTION} from '../world-r2.mjs';
import {canonicalJSON} from '../../src/route-definition.js';
import {exportPsychikoDetail} from '../export-psychiko-detail.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function composePsychiko({baseline,cells,cache,out,upload=false,api}){
 const disk=await statfs('/');if(Math.ceil(100*(disk.blocks-disk.bfree)/(disk.blocks-disk.bfree+disk.bavail))>=83)throw Error('Shared disk hard stop at 83%');
 const base=validateWorldManifest(JSON.parse(await readFile(baseline))),fresh=JSON.parse(await readFile(resolve(cells,'entries.json'))),[world,revision]=fresh.identity.split(':');
 if(world!==base.world||!/^[a-f0-9]{64}$/.test(revision)||!Object.keys(fresh.tiles).length)throw Error('Invalid partial-bake identity');
 if(Object.keys(fresh.tiles).some(k=>!base.tiles[k]))throw Error('Psychiko must remain inside the existing world');
 await mkdir(cache,{recursive:true});api??=apiClient(await credentials());
 const load=async key=>{const e=fresh.tiles[key]||base.tiles[key];let bytes;
  if(fresh.tiles[key])bytes=await readFile(resolve(cells,e.url));
  else{const file=resolve(cache,e.sha256+'.bin.gz');try{bytes=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;if(!/^\/world\/cells\/[a-f0-9]{64}\.bin\.gz$/.test(e.url))throw Error('Immutable baseline URL required');bytes=Buffer.from(await(await api(STAGING,'/'+e.url.slice(7))).arrayBuffer());await writeFile(file,bytes);}}
  if(bytes.length!==e.bytes||hash(bytes)!==e.sha256)throw Error('Integrity mismatch '+key);
  const raw=gunzipSync(bytes,{maxOutputLength:e.decodedBytes}),p=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),e.decodedBytes);
  p.tables=validateWorldTile(p,{world:e.source?.world||base.world,revision:fresh.tiles[key]?revision:e.source?.revision||base.revision,cell:key.split(',').map(Number)}).tables;return p;
 };
 const proof={schemaVersion:1,baselineRevision:base.revision,sourceRevision:revision,rebuiltCells:Object.keys(fresh.tiles).length,sharedEdges:0,outerEdges:0,samples:0,maxDelta:0,missing:0,failures:[]},seen=new Set();
 for(const key of Object.keys(fresh.tiles).sort()){const [x,z]=key.split(',').map(Number);let a;
  for(const other of [`${x-1},${z}`,`${x+1},${z}`,`${x},${z-1}`,`${x},${z+1}`]){const pair=[key,other].sort().join('/');if(!base.tiles[other]||seen.has(pair))continue;seen.add(pair);a??=await load(key);const b=await load(other);
   const graph=new WorldRoadGraph();graph.install(key,a);graph.install(other,b);graph.dispose();
   const r=sampleContactSeam(a,b,{crossSource:true});proof.sharedEdges++;if(!fresh.tiles[other])proof.outerEdges++;proof.samples+=r.samples;proof.maxDelta=Math.max(proof.maxDelta,r.maxDelta);proof.missing+=r.missing;if(r.failures.length)proof.failures.push({cells:[key,other],...r});
  }
 }
 await writeFile(resolve(cache,'boundary-proof.json'),JSON.stringify(proof));
 if(proof.missing||proof.failures.length)throw Error('Psychiko shared-boundary gate failed: '+JSON.stringify(proof));
 // This export is generated in the normal deployment too; only its descriptor is world data.
 const enrichment=await exportPsychikoDetail(resolve(import.meta.dirname,'../..'),resolve(cache,'detail-export'));
 const override=JSON.parse(await readFile(resolve(import.meta.dirname,'overrides/psychiko.json')));
 enrichment.bounds=override.height.bounds;
 const tiles={};for(const key of Object.keys(base.tiles).sort()){const f=fresh.tiles[key],e=f||base.tiles[key];tiles[key]={...e,url:f?'/world/cells/'+f.sha256+'.bin.gz':e.url,source:f?{regionId:'basin',world,revision}:e.source||{regionId:'basin',world:base.world,revision:base.revision}};}
 const manifest={...base,tiles,enrichments:[...(base.enrichments||[]).filter(e=>e.kind!==enrichment.kind),enrichment]};delete manifest.revision;manifest.revision=hash(canonicalJSON(manifest));validateWorldManifest(manifest);
 const body=Buffer.from(JSON.stringify(manifest)),key='manifests/'+hash(body)+'.json',objects=Object.values(fresh.tiles).map(e=>({key:'cells/'+e.sha256+'.bin.gz',file:resolve(cells,e.url),size:e.bytes}));objects.push({key,body,size:body.length});
 const inventories={};for(const bucket of [STAGING,PRODUCTION])inventories[bucket]=await inventory(api,bucket);const plan=uploadPlan(objects,inventories);
 if(upload)for(const o of plan.pending)await api(STAGING,'/'+o.key,{method:'PUT',body:o.body||await readFile(o.file),headers:{'Content-Type':o.key.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','Content-Length':String(o.size)}});
 await writeFile(out,JSON.stringify(manifest));await writeFile(out+'.proof.json',JSON.stringify({...proof,manifest:key,worldSetRevision:manifest.revision,stagingAddedBytes:plan.added,combinedR2Bytes:upload?plan.after:plan.used,uploaded:upload?plan.pending.length:0},null,2)+'\n');return{manifest:key,worldSetRevision:manifest.revision,...proof,stagingAddedBytes:plan.added,combinedR2Bytes:upload?plan.after:plan.used,uploaded:upload?plan.pending.length:0};
}
if(process.argv[1]===import.meta.filename){const [baseline,cells,cache,out]=process.argv.slice(2);console.log(JSON.stringify(await composePsychiko({baseline,cells,cache,out,upload:process.argv.includes('--upload')}),null,2));}
