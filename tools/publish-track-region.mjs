// Immutable staging-only attachment. Prepare first; --upload after release gates.
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {publication,apiClient,credentials,inventory,uploadPlan,STAGING} from './world-r2.mjs';
import {canonicalWorldJSON,composeWorldManifest} from '../src/world-manifest.js';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {cellStreets,packStreets} from './build-athens-streets.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function regionPublication(regionPath,basinPath,streetsPath){
 const build=await publication(regionPath),basin=JSON.parse(await readFile(basinPath));
 if(basin.elevation?.datum!=='EGM2008'||basin.elevation.verticalOffset!==0||build.manifest.elevation.datum!=='EVRS2000')throw Error('Truthful regional datums required');
 const objects=[...build.objects],document=value=>{const body=Buffer.from(JSON.stringify(value)),key='manifests/'+hash(body)+'.json';objects.push({key,body,size:body.length});return key;},basinKey=document(basin);
 const sources={},regions=[['basin',basin,basinKey],['penteli',build.manifest,build.key]].map(([id,manifest,key])=>{sources[id]={manifest,url:'https://staging.athensracing.com/world/'+key};return{id,manifestUrl:'/world/'+key,manifestSha256:key.split('/')[1].slice(0,-5),sourceWorld:manifest.world,sourceRevision:manifest.revision,access:'public',elevation:manifest.elevation,externalPortals:manifest.externalPortals};});
 const content={schemaVersion:1,id:'athens',projection:build.manifest.projection,tileMetres:512,regions},definition={...content,revision:hash(canonicalWorldJSON(content))},manifest=composeWorldManifest(definition,sources),key=document(definition);
 if(Object.values(manifest.tiles).reduce((n,e)=>n+e.bytes,0)+(manifest.regionalAssets||[]).reduce((n,a)=>n+a.bytes,0)>2*1024**3)throw Error('World ceiling exceeded');
 const original=JSON.parse(await readFile(streetsPath));if(original.revision!==basin.revision)throw Error('Stale basin streets');const cells=new Map(),local=JSON.parse(await readFile(regionPath));
 for(const[k,e]of Object.entries(local.tiles)){const b=gunzipSync(await readFile(resolve(dirname(regionPath),e.url))),p=decodeGeometryPack(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));cells.set(k,cellStreets(p));}
 const extra=packStreets(cells,{manifest:key,revision:definition.revision,world:'athens'}),names=original.maps.athens.names,rows=extra.maps.athens.roads.map(r=>{const name=r[0]<0?null:extra.maps.athens.names[r[0]];let index=name==null?-1:names.indexOf(name);if(index<0&&name!=null){index=names.length;names.push(name);}return[index,...r.slice(1)];});
 const streets={...original,manifest:key,revision:definition.revision,world:'athens',cells:Object.keys(manifest.tiles).sort(),maps:{athens:{names,roads:[...original.maps.athens.roads,...rows]}}};
 return{objects,key,definition,manifest,streets};
}
export async function megaraPublication(regionPath,existingSetUrl,streetsPath){
 const build=await publication(regionPath);if(build.manifest.regionId!=='megara'||build.manifest.access!=='circuit'||build.manifest.elevation?.datum!=='EVRS2000')throw Error('Megara source/access proof required');
 const response=await fetch(existingSetUrl,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Existing staged world set unavailable');const old=await response.json();if(old.id!=='athens'||!old.regions?.some(r=>r.id==='penteli')||old.regions.some(r=>r.id==='megara'))throw Error('Unexpected existing staged world set');
 const sources={};for(const region of old.regions){const url=new URL(region.manifestUrl,existingSetUrl).href,r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Existing region manifest unavailable: '+region.id);const bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes)!==region.manifestSha256)throw Error('Changed existing region manifest: '+region.id);sources[region.id]={url,manifest:JSON.parse(bytes)};}
 const objects=[...build.objects],document=value=>{const body=Buffer.from(JSON.stringify(value)),key='manifests/'+hash(body)+'.json';objects.push({key,body,size:body.length});return key;};
 const region={id:'megara',manifestUrl:'/world/'+build.key,manifestSha256:build.key.split('/')[1].slice(0,-5),sourceWorld:build.manifest.world,sourceRevision:build.manifest.revision,access:'circuit',elevation:build.manifest.elevation,externalPortals:[]};
 sources.megara={manifest:build.manifest,url:new URL(region.manifestUrl,existingSetUrl).href};
 const content={schemaVersion:1,id:'athens',projection:old.projection,tileMetres:512,regions:[...old.regions,region]},definition={...content,revision:hash(canonicalWorldJSON(content))},manifest=composeWorldManifest(definition,sources),key=document(definition);
 const worldBytes=Object.values(manifest.tiles).reduce((n,e)=>n+e.bytes,0)+(manifest.regionalAssets||[]).reduce((n,a)=>n+a.bytes,0);if(worldBytes>2*1024**3)throw Error('World ceiling exceeded');
 const original=JSON.parse(await readFile(streetsPath));if(original.revision!==old.revision)throw Error('Stale staged picker streets');const cells=new Map(),local=JSON.parse(await readFile(regionPath));
 for(const[k,e]of Object.entries(local.tiles)){const b=gunzipSync(await readFile(resolve(dirname(regionPath),e.url))),p=decodeGeometryPack(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));cells.set(k,cellStreets(p));}
 const extra=packStreets(cells,{manifest:key,revision:definition.revision,world:'athens'}),names=original.maps.athens.names,rows=extra.maps.athens.roads.map(r=>{const name=r[0]<0?null:extra.maps.athens.names[r[0]];let index=name==null?-1:names.indexOf(name);if(index<0&&name!=null){index=names.length;names.push(name);}return[index,...r.slice(1)];});
 const streets={...original,manifest:key,revision:definition.revision,world:'athens',cells:Object.keys(manifest.tiles).sort(),maps:{athens:{names,roads:[...original.maps.athens.roads,...rows]}}};
 return{objects,key,definition,manifest,streets,worldBytes};
}
export async function publishRegion(build,{upload=false,api}={}){api??=apiClient(await credentials());const rows=await inventory(api,STAGING),plan=uploadPlan(build.objects,{[STAGING]:rows});if(upload)for(const o of plan.pending)await api(STAGING,'/'+o.key,{method:'PUT',body:o.body||await readFile(o.file),headers:{'Content-Type':o.key.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable'}});return{bucket:STAGING,manifest:build.key,uploaded:upload?plan.pending.length:0,beforeBytes:plan.used,addedBytes:plan.added,afterBytes:upload?plan.after:plan.used,objects:rows.length+(upload?plan.pending.length:0)};}
if(process.argv[1]===import.meta.filename){const[region,basin,streets,out,...flags]=process.argv.slice(2),build=flags.includes('--megara')?await megaraPublication(region,basin,streets):await regionPublication(region,basin,streets);await writeFile(out,JSON.stringify({key:build.key,definition:build.definition,tiles:Object.keys(build.manifest.tiles).length,bytes:Object.values(build.manifest.tiles).reduce((n,e)=>n+e.bytes,0)},null,2));await writeFile(out+'.streets.json',JSON.stringify(build.streets));if(flags.includes('--upload'))console.log(JSON.stringify(await publishRegion(build,{upload:true}),null,2));else console.log(JSON.stringify({manifest:build.key,objects:build.objects.length,bytes:build.objects.reduce((n,o)=>n+o.size,0)}));}
