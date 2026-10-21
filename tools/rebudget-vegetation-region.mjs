// Re-measure changed Penteli packets after pruning vegetation. Retain 64 KiB
// per cell above complete CPU/GPU/index accounting; do not charge removed rows.
import {readFile,writeFile,unlink,statfs} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeGeometryPack} from '../src/baked-geometry.js';
import {prepareTilePacket} from '../src/world-tile-worker.js';
import {canonicalWorldJSON,composeWorldManifest} from '../src/world-manifest.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function rebudgetVegetationRegion(directory){
 const dir=resolve(directory),read=async n=>JSON.parse(await readFile(resolve(dir,n))),pub=await read('publication.json'),proof=await read('vegetation-audit.json'),m=await read('penteli-manifest.json'),measurements=[];
 if(!proof.passed)throw Error('Completed clearance bake required');
 for(const [key,e]of Object.entries(m.tiles)){
  const data=gunzipSync(await readFile(resolve(dir,e.url.slice('/world/'.length)))),pack=decodeGeometryPack(data.buffer.slice(data.byteOffset,data.byteOffset+data.length)),packet=prepareTilePacket(pack,{world:pack.metadata.world,revision:pack.metadata.revision,cell:pack.metadata.cell,entry:{decodedBytes:Number.MAX_SAFE_INTEGER,triangles:e.triangles}}),bytes=Math.max(data.length,packet.bytes+65536);
  measurements.push({cell:key,previous:e.residentBytes??e.decodedBytes,packetBytes:packet.bytes,reservedBytes:bytes});
  if(e.residentBytes)e.residentBytes=bytes;else e.decodedBytes=bytes;
  e.transientBytes=Math.max(e.transientBytes||0,2*e.decodedBytes+e.bytes);
 }
 for(;;){const s=await statfs('/');if(Math.ceil(100*(s.blocks-s.bfree)/(s.blocks-s.bfree+s.bavail))<83)break;console.log('Paused budget metadata writes at >=83% disk');await new Promise(r=>setTimeout(r,30000));}
 const replace=async(oldKey,value)=>{const body=Buffer.from(JSON.stringify(value)),key='manifests/'+hash(body)+'.json',file=resolve(dir,key);if(key===oldKey)return key;await writeFile(file,body);const i=pub.objects.findIndex(o=>o.key===oldKey);if(i<0)throw Error('Unknown publication manifest');await unlink(pub.objects[i].file).catch(e=>{if(e.code!=='ENOENT')throw e;});pub.objects.splice(i,1,{key,file,size:body.length});return key;};
 const region=pub.definition.regions.find(r=>r.id==='penteli'),key=await replace(region.manifestUrl.slice('/world/'.length),m);region.manifestUrl='/world/'+key;region.manifestSha256=key.split('/')[1].slice(0,-5);
 const{revision,...content}=pub.definition;pub.definition={...content,revision:hash(canonicalWorldJSON(content))};pub.key=await replace(pub.key,pub.definition);
 await writeFile(resolve(dir,'penteli-manifest.json'),JSON.stringify(m));
 const sources={};for(const r of pub.definition.regions)sources[r.id]={manifest:await read(r.id+'-manifest.json'),url:'https://staging.athensracing.com'+r.manifestUrl};
 const composed=composeWorldManifest(pub.definition,sources);proof.revision=composed.revision;proof.manifest=pub.key;proof.sourceHashes['tools/rebudget-vegetation-region.mjs']=hash(await readFile(import.meta.filename));
 let worst=0;for(const k of Object.keys(m.tiles)){const[x,z]=k.split(',').map(Number);for(const dx of[-1,0])for(const dz of[-1,0]){let sum=m.regionResidentBytes;for(let a=0;a<2;a++)for(let b=0;b<2;b++){const e=m.tiles[[x+dx+a,z+dz+b].join(',')];sum+=e?.residentBytes??e?.decodedBytes??0;}worst=Math.max(worst,sum);}}
 Object.assign(proof.regions.penteli,{worst2x2Bytes:worst,headroomBytes:64*1024**2-worst});
 for(const[n,v]of Object.entries({'world.json':composed,'publication.json':pub,'vegetation-audit.json':proof,'resident-measurements.json':{paddingPerCell:65536,cells:measurements}}))await writeFile(resolve(dir,n),JSON.stringify(v,null,n==='resident-measurements.json'?2:0));
 return{cells:measurements.length,releasedReservationBytes:measurements.reduce((n,m)=>n+m.previous-m.reservedBytes,0),worst2x2Bytes:worst};
}
if(process.argv[1]===import.meta.filename)console.log(JSON.stringify(await rebudgetVegetationRegion(process.argv[2]),null,2));
