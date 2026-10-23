// Refine existing hosted generated cells without raw DSM/OSM caches or uploads.
// Usage: node tools/world-gen/refine-terrain.mjs MANIFEST_URL OUTPUT [CELL...]
// Selected cells automatically fetch a one-cell halo for the GLOBAL filter.
// The result is a local, mixed-source manifest; run full-world conformance and
// the ordinary staging publication/mirror process before changing production.
import fs from 'node:fs/promises';import {resolve,join} from 'node:path';import {Readable} from 'node:stream';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {loadWorldDefinition} from '../../src/world-manifest.js';import {decodeTilePack} from '../../src/world-tile-codec.js';import {tileTables,validateWorldManifest} from '../../src/world-tile-format.js';
import {conformMarkingSurfaces} from './marking-surface.mjs';
import {packTiles} from './pack.mjs';import {terrainAtlasCell,terrainReliefField,refineTerrainRelief} from './terrain-relief.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function refineHostedTerrain(url,output,selected=[]){
 const stat=await fs.statfs('/');if((stat.blocks-stat.bfree)/(stat.blocks-stat.bfree+stat.bavail)>=.85)throw Error('Disk usage >=85%');
 await fs.mkdir(output,{recursive:true});const cache=join(output,'source');await fs.mkdir(cache,{recursive:true});
 const {manifest:base}=await loadWorldDefinition(url),keys=selected.length?selected:Object.keys(base.tiles),context=new Set(keys);
 for(const key of keys){if(!base.tiles[key])throw Error('Unknown cell '+key);const[x,z]=key.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(base.tiles[[x+dx,z+dz]])context.add([x+dx,z+dz].join(','));}
 const atlas={version:1,spacing:8,source:url,revision:base.revision,grids:{},protected:[]};
 async function read(key){const e=base.tiles[key],file=join(cache,e.sha256+'.gz');let bytes;try{bytes=await fs.readFile(file)}catch{const response=await fetch(new URL(e.url,url));if(!response.ok)throw Error('Cell HTTP '+response.status);bytes=Buffer.from(await response.arrayBuffer());await fs.writeFile(file,bytes);}
  if(bytes.length!==e.bytes||sha(bytes)!==e.sha256)throw Error('Source integrity '+key);const raw=gunzipSync(bytes);return decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),e.decodedBytes);
 }
 // Two readers cap transient decoded memory. No source pack stays resident.
 const pending=[...context];await Promise.all([0,1].map(async()=>{while(pending.length){const key=pending.shift(),pack=await read(key),cell=terrainAtlasCell(pack);atlas.grids[key]=cell.heights;if(cell.protected||!keys.includes(key))atlas.protected.push(key);}}));
 const field=terrainReliefField(atlas),revision=sha(base.revision+JSON.stringify([...keys].sort())+(await Promise.all(['./terrain-relief.mjs','./marking-surface.mjs','../world-terrain-smoothness.mjs'].map(path=>fs.readFile(new URL(path,import.meta.url),'utf8')))).join(''));field.revision=revision;
 const reports=[];const {auditTerrainSmoothness}=await import('../world-terrain-smoothness.mjs');
 async function* inputs(){for(const key of keys){const pack=await read(key);if(terrainAtlasCell(pack).protected)continue;const[ox,oz]=pack.metadata.cell.map(v=>v*512),comfort={include:(x,z)=>field.blend(ox+x,oz+z)>.999};const before=auditTerrainSmoothness(tileTables(pack),comfort);const relief=refineTerrainRelief(pack,field),markings=conformMarkingSurfaces(pack);pack.metadata.revision=revision;pack.metadata.world='athens-terrain-relief';reports.push({key,before,relief,markings,after:auditTerrainSmoothness(tileTables(pack),comfort),wholeCellAfter:auditTerrainSmoothness(tileTables(pack))});yield JSON.stringify({metadata:pack.metadata,arrays:pack.arrays.map(a=>({type:a.constructor.name,data:Array.from(a)})),tables:Object.fromEntries(Object.entries(tileTables(pack)).map(([k,a])=>[k,Array.from(a)])),dependencies:[]})+'\n';}}
 const tiles=await packTiles(Readable.from(inputs()),output,{onTile:({key,physical,bridges,bores})=>{Object.assign(reports.find(r=>r.key===key),{physical,bridges,bores});}});
 for(const[key,entry]of Object.entries(tiles)){entry.url='./'+entry.url.slice(2);entry.source={regionId:base.tiles[key].source?.regionId||'basin',world:'athens-terrain-relief',revision};entry.contactEligible=true;}
 // The full manifest retains untouched cells, with absolute authenticated URLs.
 const manifest=validateWorldManifest({...base,revision,releaseReady:false,developmentOnly:true,acceptance:{passed:false,reason:'Local terrain candidate; publication/contact/route proofs required'},tiles:{...Object.fromEntries(Object.entries(base.tiles).map(([k,e])=>[k,{...e,url:new URL(e.url,url).href}])),...tiles},sourceIdentities:[...(base.sourceIdentities||[]),...Array.from(new Map(Object.values(tiles).map(e=>[JSON.stringify(e.source),e.source])).values())]});
 await fs.writeFile(join(output,'manifest.json'),JSON.stringify(manifest));await fs.writeFile(join(output,'atlas.json'),JSON.stringify(atlas));await fs.writeFile(join(output,'report.json'),JSON.stringify({source:url,revision,reports},null,2));
 await fs.rm(cache,{recursive:true});if(reports.some(r=>r.after.passed===false))throw Error('Terrain smoothness gate failed; see report.json');return {revision,cells:keys.length,reports};
}
if(process.argv[1]===import.meta.filename){const[url,out,...keys]=process.argv.slice(2);if(!out)throw Error('Expected MANIFEST_URL OUTPUT [CELL...]');const result=await refineHostedTerrain(url,resolve(out),keys);console.log(JSON.stringify({revision:result.revision,cells:result.cells,reports:result.reports.map(r=>({key:r.key,relief:r.relief,before:r.before.maxSag,after:r.after.maxSag}))}));}
