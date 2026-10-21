// Re-emits scenery from authenticated immutable cells. Physical arrays, road
// graph, colliders, seams and all layers must remain byte-for-byte identical.
import {readFile,writeFile,mkdir,statfs,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {decodeGeometryPack,encodeGeometryPack} from '../src/baked-geometry.js';
import {tileTables,validateWorldTile} from '../src/world-tile-format.js';
import {prepareTilePacket} from '../src/world-tile-worker.js';
import {coastalRecipe} from '../src/world-tile-coast.js';
import {clearPacketVegetation,vegetationContactIndex,psychikoVegetationRadius} from '../src/vegetation-clearance.js';
import {assertVegetationClearance,forestByCell,clearForestCell} from './audit-world-vegetation.mjs';
import {canonicalWorldJSON,composeWorldManifest} from '../src/world-manifest.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const decode=b=>{const r=gunzipSync(b);return decodeGeometryPack(r.buffer.slice(r.byteOffset,r.byteOffset+r.length));};
const physical=pack=>hash(Buffer.concat([Buffer.from(JSON.stringify({ids:pack.metadata.ids,strings:pack.metadata.strings,obstacles:pack.metadata.authoredObstacles})),...Object.values(tileTables(pack)).map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength))]));
let diskWait=null;
async function disk(){if(diskWait)return diskWait;diskWait=(async()=>{for(;;){const s=await statfs('/'),used=s.blocks-s.bfree,pct=Math.ceil(100*used/(used+s.bavail));if(pct<83)return;console.log('Paused writes: shared disk '+pct+'%; waiting for <83%.');await new Promise(r=>setTimeout(r,30000));}})();try{await diskWait;}finally{diskWait=null;}}
async function get(url,sha){for(let n=0;;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(hash(b)!==sha)throw Error('Source hash mismatch: '+url);return b;}catch(e){if(n===2)throw e;}}}
export async function rebakeVegetation({sourceURL,out}){
 await disk();await mkdir(resolve(out,'cells'),{recursive:true});await mkdir(resolve(out,'manifests'),{recursive:true});
 const r=await fetch(sourceURL);if(!r.ok)throw Error('Source manifest unavailable');const old=await r.json(),{revision,...content}=old;if(hash(canonicalWorldJSON(content))!==revision)throw Error('World-set source hash mismatch');
 const sources={},objects=[],proof={sourceRevision:old.revision,regions:{},physical:[],passed:false};
 const sourceFiles=['src/vegetation-clearance.js','src/vegetation-forest.js','src/vegetation-fade.js','src/athens-trees.js','src/world-tile-trees.js','src/world-tile-coast.js','src/world-tile-worker.js','src/world-tile-buildings.js','src/world-psychiko-detail.js','tools/audit-world-vegetation.mjs','tools/rebake-world-vegetation.mjs'];
 proof.sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,hash(await readFile(resolve(import.meta.dirname,'..',f)))])));
 const policyHash=hash(canonicalWorldJSON(proof.sourceHashes));
 const store=async(body,kind='cells')=>{const sha256=hash(body),key=kind+'/'+sha256+(kind==='cells'?'.bin.gz':'.json'),file=resolve(out,key);await disk();await writeFile(file,body);objects.push({key,file,size:body.length});return {key,sha256,bytes:body.length};};
 for(const region of old.regions){
  const url=new URL(region.manifestUrl,sourceURL).href,manifest=JSON.parse(await get(url,region.manifestSha256)),original=structuredClone(manifest),report={cells:0,changedCells:0,wireRemoved:0,vegetation:0,forest:0,physicalUnchanged:0};proof.regions[region.id]=report;
  let forest=null,forestCells=null,forestOld=null;const enrichments=[];
  for(const spec of manifest.enrichments||[]){if(spec.kind!=='psychiko-streetscape-v1')throw Error('Unaudited vegetation enrichment');const response=await fetch(new URL(spec.url,sourceURL));if(!response.ok)throw Error('Enrichment unavailable');const data=await response.json();if(data.sourceMapSha256!==spec.sourceMapSha256)throw Error('Enrichment source changed');const q=data.proj,P=manifest.projection,sx=P.mlon/q.mlon,sz=P.mlat/q.mlat,ox=(q.lon0-P.lon0)*P.mlon,oz=-(q.lat0-P.lat0)*P.mlat,cells=new Map(),T=data.psychiko.scenery.trees;
   for(let i=0,hx=0,hz=0;i<T.length;i+=3){hx+=T[i];hz+=T[i+1];const x=ox+hx/2*sx,z=oz+hz/2*sz,key=Math.floor(x/512)+','+Math.floor(z/512),sp=Math.floor(T[i+2]/100),height=T[i+2]%100/2;if(!cells.has(key))cells.set(key,[]);cells.get(key).push({seed:i,x,z,radius:psychikoVegetationRadius(sp,height,Math.max(sx,sz))});}
   data.vegetationClearance={version:1,allowedTreeSeeds:[]};enrichments.push({spec,data,cells});
  }
  if(region.id==='penteli'){forestOld=manifest.regionalAssets[0];forest=decode(await get(new URL(forestOld.url,url),forestOld.sha256));const f=forest.metadata.forest;f.clearanceArray=forest.arrays.length;forest.arrays.push(new Uint8Array(f.nx*f.nz));forestCells=forestByCell(forest);}
  const entries=Object.entries(manifest.tiles);let cursor=0;
  // At most four fetches in flight; synchronous packet work never duplicates a
  // full decoded world in memory. Only the new compressed cells stay on disk.
  await Promise.all(Array.from({length:2},async()=>{for(;;){const task=cursor++;if(task>=entries.length)return;await disk();const [key,entry]=entries[task],body=await get(new URL(entry.url,url),entry.sha256),pack=decode(body),tables=tileTables(pack),before=physical(pack),originalOccupancy=pack.arrays[pack.metadata.extensions?.worldDetail?.vegetation?.positionHeight],removed=clearPacketVegetation(pack,tables);
    if(removed.removed&&originalOccupancy?.length&&coastalRecipe(pack.metadata.cell)){const ext=pack.metadata.extensions.worldDetail;ext.coastalTreeOccupancy=pack.arrays.length;pack.arrays.push(originalOccupancy);}
    assertVegetationClearance(pack,tables);if(removed.removed)pack.metadata.vegetationClearance={version:1,sourceHash:policyHash};
    for(const e of enrichments){const q=vegetationContactIndex(tables),[cx,cz]=pack.metadata.cell;for(const row of e.cells.get(key)||[])if(q.clear(row.x-cx*512,row.z-cz*512,row.radius))e.data.vegetationClearance.allowedTreeSeeds.push(row.seed);}
    if(forest)report.forest+=clearForestCell(forest,forestCells.get(key),tables,pack.metadata.cell);
    const raw=encodeGeometryPack(pack.metadata,pack.arrays),after=decodeGeometryPack(raw);if(physical(after)!==before)throw Error('Physical geometry changed: '+key);
    const measured=prepareTilePacket(decodeGeometryPack(raw),{world:pack.metadata.world,revision:pack.metadata.revision,cell:pack.metadata.cell,entry:{decodedBytes:Number.MAX_SAFE_INTEGER,triangles:entry.triangles}});
    const checked=assertVegetationClearance(measured,tileTables(measured));validateWorldTile(after);
    if(removed.removed){const source=decode(body),prior=prepareTilePacket(source,{world:source.metadata.world,revision:source.metadata.revision,cell:source.metadata.cell,entry:{decodedBytes:Number.MAX_SAFE_INTEGER,triangles:entry.triangles}}),colliders=p=>hash(JSON.stringify([p.obstacleIndex,p.detailObstacleIndex]));if(colliders(prior)!==colliders(measured))throw Error('Derived colliders changed: '+key);}
    const changed=removed.removed>0||!!forest;const stored=changed?await store(gzipSync(new Uint8Array(raw),{level:9})):{key:entry.url.slice(7),sha256:entry.sha256,bytes:entry.bytes};if(changed)report.changedCells++;
    // Preserve established reservations whenever they already cover this bake.
    // Runtime dressing remains charged separately by the existing streamer.
    const resident=Math.max(entry.residentBytes??entry.decodedBytes,measured.bytes+2048);
    manifest.tiles[key]={...entry,url:changed?'/world/'+stored.key:entry.url,sha256:stored.sha256,bytes:stored.bytes,decodedBytes:Math.max(entry.decodedBytes,raw.byteLength),...(entry.residentBytes?{residentBytes:resident}:{decodedBytes:Math.max(resident,raw.byteLength)})};
    report.cells++;report.wireRemoved+=removed.removed;report.vegetation+=checked.checked;report.physicalUnchanged++;proof.physical.push({cell:key,region:region.id,beforeSHA:entry.sha256,afterSHA:stored.sha256,physicalSHA:before});
    if(report.cells%100===0)console.log(region.id,report.cells+'/'+entries.length);
  }}));
  if(forest){const raw=encodeGeometryPack(forest.metadata,forest.arrays),stored=await store(gzipSync(new Uint8Array(raw),{level:9})),asset={...forestOld,url:'/world/'+stored.key,sha256:stored.sha256,bytes:stored.bytes,decodedBytes:raw.byteLength,residentBytes:forestOld.residentBytes+forest.arrays.at(-1).byteLength*2+300000};delete asset.file;manifest.regionalAssets=[asset];manifest.regionResidentBytes=asset.residentBytes;
    // The cell-owned background descriptor must authenticate the new mask too.
    for(const [key,e]of Object.entries(manifest.tiles)){const path=resolve(out,e.url.slice('/world/'.length)),pack=decode(await readFile(path));if(pack.metadata.regionalScenery?.terrain)pack.metadata.regionalScenery.terrain=asset;
      const raw=encodeGeometryPack(pack.metadata,pack.arrays),stored=await store(gzipSync(new Uint8Array(raw),{level:9}));await unlink(path);const obsolete=objects.findIndex(o=>o.file===path);if(obsolete>=0)objects.splice(obsolete,1);manifest.tiles[key]={...e,url:'/world/'+stored.key,sha256:stored.sha256,bytes:stored.bytes};proof.physical.find(p=>p.cell===key&&p.region===region.id).afterSHA=stored.sha256;
    }
  }else for(const asset of manifest.regionalAssets||[]){/* Existing immutable assets are referenced, never copied or modified. */void asset;}
  for(const e of enrichments){e.data.vegetationClearance.allowedTreeSeeds.sort((a,b)=>a-b);const stored=await store(Buffer.from(JSON.stringify(e.data)),'manifests');e.spec.url='/world/'+stored.key;report.psychikoTrees=e.data.vegetationClearance.allowedTreeSeeds.length;}
  for(const entry of Object.values(manifest.tiles))entry.transientBytes=Math.max(entry.transientBytes||0,2*entry.decodedBytes+entry.bytes);
  manifest.vegetationClearance={version:1,sourceHashes:proof.sourceHashes,passed:true};
  let worst=0;for(const key of Object.keys(manifest.tiles)){const[x,z]=key.split(',').map(Number);for(const dx of[-1,0])for(const dz of[-1,0]){let sum=manifest.regionResidentBytes||300000;for(let a=0;a<2;a++)for(let b=0;b<2;b++){const e=manifest.tiles[[x+dx+a,z+dz+b].join(',')];sum+=e?.residentBytes??e?.decodedBytes??0;}worst=Math.max(worst,sum);}}
  report.worst2x2Bytes=worst;report.headroomBytes=64*1024**2-worst;if(report.headroomBytes<4*1024**2)throw Error('Vegetation 2x2 headroom below 4 MiB: '+region.id+' '+worst);
  const stored=await store(Buffer.from(JSON.stringify(manifest)),'manifests');region.manifestUrl='/world/'+stored.key;region.manifestSha256=stored.sha256;sources[region.id]={manifest,url:new URL(region.manifestUrl,sourceURL).href};await writeFile(resolve(out,region.id+'-manifest.json'),JSON.stringify(manifest));
 }
 const {revision:prior,...nextContent}=old,definition={...nextContent,revision:hash(canonicalWorldJSON(nextContent))},manifest=composeWorldManifest(definition,sources);
 proof.worldBytes=Object.values(manifest.tiles).reduce((n,e)=>n+e.bytes,0)+(manifest.regionalAssets||[]).reduce((n,a)=>n+a.bytes,0);if(proof.worldBytes>2*1024**3)throw Error('World 2 GiB ceiling');
 const stored=await store(Buffer.from(JSON.stringify(definition)),'manifests');proof.revision=definition.revision;proof.manifest=stored.key;proof.passed=true;
 await writeFile(resolve(out,'vegetation-audit.json'),JSON.stringify(proof,null,2));await writeFile(resolve(out,'world.json'),JSON.stringify(manifest));await writeFile(resolve(out,'publication.json'),JSON.stringify({objects,key:stored.key,definition}));console.log(JSON.stringify({...proof,physical:undefined,sourceHashes:undefined},null,2));return proof;
}
if(process.argv[1]===import.meta.filename)await rebakeVegetation({sourceURL:process.argv[2],out:resolve(process.argv[3])});
