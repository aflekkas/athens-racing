// Refine existing hosted generated cells without raw DSM/OSM caches or uploads.
// Usage: node tools/world-gen/refine-terrain.mjs MANIFEST_URL OUTPUT [CELL...]
// Selected cells automatically fetch a one-cell halo for the GLOBAL filter.
// The result is a local, mixed-source manifest; run full-world conformance and
// the ordinary staging publication/mirror process before changing production.
import fs from 'node:fs/promises';import {resolve,join} from 'node:path';import {Readable} from 'node:stream';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {loadWorldDefinition} from '../../src/world-manifest.js';import {decodeTilePack} from '../../src/world-tile-codec.js';import {tileTables,validateWorldManifest} from '../../src/world-tile-format.js';
import {conformMarkingSurfaces} from './marking-surface.mjs';
import {TERRAIN_FIELD,TERRAIN_FIELDS,requireTerrainAcceptance} from './terrain-acceptance.mjs';
import {packTiles} from './pack.mjs';import {terrainAtlasCell,terrainReliefField,refineTerrainRelief} from './terrain-relief.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
/** A shared cache is strictly read-only: missing/corrupt entries never fall back
 * to network or alter a file owned by another task. */
export async function readTerrainSource(entry,{cache,readOnly=false,baseURL,readFile=fs.readFile,writeFile=fs.writeFile,fetcher=fetch}){
 const file=join(cache,entry.sha256+(readOnly?'.bin.gz':'.gz'));let bytes;
 try{bytes=await readFile(file);}catch(error){
  if(readOnly)throw Error('Read-only source cache missing '+entry.sha256,{cause:error});
  const response=await fetcher(new URL(entry.url,baseURL));if(!response.ok)throw Error('Cell HTTP '+response.status);
  bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('Source integrity '+entry.sha256);
  await writeFile(file,bytes);
 }
 if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('Source integrity '+entry.sha256);return bytes;
}
export async function refineHostedTerrain(url,output,selected=[],options={}){
 const stat=await fs.statfs('/');if((stat.blocks-stat.bfree)/(stat.blocks-stat.bfree+stat.bavail)>=.85)throw Error('Disk usage >=85%');
 await fs.mkdir(output,{recursive:true});const shared=options.sourceCache,cache=shared||join(output,'source');if(!shared)await fs.mkdir(cache,{recursive:true});
 let base;if(options.manifestFile){const bytes=await fs.readFile(options.manifestFile);if(!options.manifestSha256||sha(bytes)!==options.manifestSha256)throw Error('Flat manifest integrity');base=validateWorldManifest(JSON.parse(bytes));}else({manifest:base}=await loadWorldDefinition(url));
 if(shared&&(!options.sourceRevision||base.revision!==options.sourceRevision))throw Error('Shared source revision mismatch');
 const keys=selected.length?selected:Object.keys(base.tiles),context=new Set(keys);
 const descriptor=TERRAIN_FIELDS[options.filter||TERRAIN_FIELD.id];if(!descriptor)throw Error('Unknown terrain field');
 const fieldSHA256=sha(await fs.readFile(new URL('./terrain-relief.mjs',import.meta.url)));
 const acceptanceReport=options.acceptanceReport?JSON.parse(await fs.readFile(options.acceptanceReport)):undefined;
 requireTerrainAcceptance(keys.length,{field:descriptor,sourceRevision:base.revision,fieldSHA256,report:acceptanceReport});
 for(const key of keys){if(!base.tiles[key])throw Error('Unknown cell '+key);const[x,z]=key.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(base.tiles[[x+dx,z+dz]])context.add([x+dx,z+dz].join(','));}
 let atlas={version:1,spacing:8,source:url,revision:base.revision,grids:{},protected:[],coverage:{}};
 if(options.atlasFile){const bytes=await fs.readFile(options.atlasFile);if(!options.atlasSha256||sha(bytes)!==options.atlasSha256)throw Error('Probe atlas integrity');atlas=JSON.parse(bytes);if(atlas.revision!==base.revision||atlas.spacing!==8||keys.some(k=>!atlas.grids[k]))throw Error('Probe atlas source mismatch');}
 async function read(key){const e=base.tiles[key],bytes=await readTerrainSource(e,{cache,readOnly:!!shared,baseURL:url});const raw=gunzipSync(bytes);return decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),e.decodedBytes);}

 // Two readers cap transient decoded memory. No source pack stays resident.
 const pending=options.atlasFile?[]:[...context];await Promise.all([0,1].map(async()=>{while(pending.length){const key=pending.shift(),pack=await read(key),cell=terrainAtlasCell(pack);atlas.grids[key]=cell.heights;atlas.coverage[key]={source:base.tiles[key].source,selected:keys.includes(key),protectedReasons:cell.protectedReasons};if(cell.protected||!keys.includes(key))atlas.protected.push(key);}}));
 const field=terrainReliefField(atlas,{filter:descriptor.id}),revision=sha(base.revision+descriptor.id+(options.atlasSha256||'')+JSON.stringify([...keys].sort())+(await Promise.all(['./terrain-relief.mjs','./marking-surface.mjs','../world-terrain-smoothness.mjs'].map(path=>fs.readFile(new URL(path,import.meta.url),'utf8')))).join(''));field.revision=revision;
 const reports=[];const {auditTerrainSmoothness}=await import('../world-terrain-smoothness.mjs');
 async function* inputs(){for(const key of keys){const pack=await read(key),cell=terrainAtlasCell(pack);if(cell.protected){reports.push({key,protected:true,protectedReasons:cell.protectedReasons,wholeCellAfter:auditTerrainSmoothness(tileTables(pack))});continue;}const[ox,oz]=pack.metadata.cell.map(v=>v*512),comfort={include:(x,z)=>field.blend(ox+x,oz+z)>.999};const before=auditTerrainSmoothness(tileTables(pack),comfort);const relief=refineTerrainRelief(pack,field),markings=conformMarkingSurfaces(pack);pack.metadata.revision=revision;pack.metadata.world='athens-terrain-relief';reports.push({key,before,relief,markings,after:auditTerrainSmoothness(tileTables(pack),comfort),wholeCellAfter:auditTerrainSmoothness(tileTables(pack))});yield JSON.stringify({metadata:pack.metadata,arrays:pack.arrays.map(a=>({type:a.constructor.name,data:Array.from(a)})),tables:Object.fromEntries(Object.entries(tileTables(pack)).map(([k,a])=>[k,Array.from(a)])),dependencies:[]})+'\n';}}
 const tiles=await packTiles(Readable.from(inputs()),output,{onTile:({key,physical,bridges,bores})=>{Object.assign(reports.find(r=>r.key===key),{physical,bridges,bores});}});
 for(const[key,entry]of Object.entries(tiles)){entry.url='./'+entry.url.slice(2);entry.source={regionId:base.tiles[key].source?.regionId||'basin',world:'athens-terrain-relief',revision};entry.contactEligible=true;}
 // The full manifest retains untouched cells, with absolute authenticated URLs.
 const manifest=validateWorldManifest({...base,revision,releaseReady:false,developmentOnly:true,acceptance:{passed:false,reason:'Local terrain candidate; publication/contact/route proofs required'},tiles:{...Object.fromEntries(Object.entries(base.tiles).map(([k,e])=>[k,{...e,url:new URL(e.url,url).href}])),...tiles},sourceIdentities:[...(base.sourceIdentities||[]),...Array.from(new Map(Object.values(tiles).map(e=>[JSON.stringify(e.source),e.source])).values())]});
 await fs.writeFile(join(output,'manifest.json'),JSON.stringify(manifest));if(!options.atlasFile)await fs.writeFile(join(output,'atlas.json'),JSON.stringify(atlas));await fs.writeFile(join(output,'report.json'),JSON.stringify({source:url,revision,field:{...descriptor,sha256:fieldSHA256},acceptanceReport:acceptanceReport||null,atlasReference:options.atlasFile?{file:options.atlasFile,sha256:options.atlasSha256,scope:'bounded cells under proposed global field; outer seams not accepted'}:null,reports},null,2));
 if(!shared)await fs.rm(cache,{recursive:true});if(reports.some(r=>r.after?.passed===false))throw Error('Terrain smoothness gate failed; see report.json');return {revision,cells:Object.keys(tiles).length,requested:keys.length,protected:reports.filter(r=>r.protected).length,reports};
}
if(process.argv[1]===import.meta.filename){const[url,out,...keys]=process.argv.slice(2);if(!out)throw Error('Expected MANIFEST_URL OUTPUT [CELL...]');const result=await refineHostedTerrain(url,resolve(out),keys,{sourceCache:process.env.ATHENS_SOURCE_CACHE,sourceRevision:process.env.ATHENS_SOURCE_REVISION,manifestFile:process.env.ATHENS_SOURCE_MANIFEST,manifestSha256:process.env.ATHENS_SOURCE_MANIFEST_SHA256,acceptanceReport:process.env.ATHENS_TERRAIN_ACCEPTANCE_REPORT,filter:process.env.ATHENS_TERRAIN_FIELD,atlasFile:process.env.ATHENS_TERRAIN_PROBE_ATLAS,atlasSha256:process.env.ATHENS_TERRAIN_PROBE_ATLAS_SHA256});console.log(JSON.stringify({revision:result.revision,cells:result.cells,reports:result.reports.map(r=>({key:r.key,relief:r.relief,protected:r.protected,protectedReasons:r.protectedReasons,before:r.before?.maxSag,after:r.after?.maxSag}))}));}
