import { decodeTilePack } from './world-tile-codec.js';
import { validateWorldTile, residentArrayBytes } from './world-tile-format.js';
import { buildTileContactIndex } from './world-tile-contact.js';
import { tileGPUPlan, tileRenderVariants } from './world-tile-gpu.js';
import { addDerivedBuildings } from './world-tile-buildings.js';
import {buildTileObstacleIndex,obstacleBytes} from './world-tile-obstacles.js';
const controllers = new Map();
async function limitedBuffer(stream,limit,onBytes=null) {
  const reader=stream.getReader(),chunks=[]; let bytes=0;
  try { for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;onBytes?.(value.byteLength);if(bytes>limit)throw new Error('Tile exceeds declared byte budget');chunks.push(value);} }
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  const out=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out.buffer;
}
export async function fetchTilePacket({url,entry,world,revision,cell},signal,onBytes=null) {
  const headers=entry.range?{Range:`bytes=${entry.range.offset}-${entry.range.offset+entry.range.length-1}`} : {};
  const response=await fetch(url,{headers,signal});
  if(entry.range) {
    const expected=`bytes ${entry.range.offset}-${entry.range.offset+entry.range.length-1}/`;
    if(response.status!==206||!response.headers.get('Content-Range')?.startsWith(expected))throw new Error('Tile range response invalid');
  }else if(!response.ok)throw new Error(`Tile HTTP ${response.status}`);
  const compressed=await limitedBuffer(response.body,entry.bytes,onBytes);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',compressed))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(compressed.byteLength!==entry.bytes||hash!==entry.sha256)throw new Error('Tile integrity failure');
  const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer=await limitedBuffer(stream,entry.decodedBytes);
  return prepareTilePacket(await decodeTilePack(buffer,entry.decodedBytes),{entry,world,revision,cell});
}
export function prepareTilePacket(pack,{entry,world,revision,cell}){
  const checked=validateWorldTile(pack,{world,revision,cell});
  // Footprints are stored once; their wall and roof meshes are built here, before bounds, GPU plan and byte accounting.
  addDerivedBuildings(pack,checked.tables);
  const contactIndex=buildTileContactIndex(checked.tables,Math.floor(entry.decodedBytes/4));
  // Bounding volumes are built in the worker, avoiding a vertex scan during activation.
  let gpuBytes=0;const gpuViews=new Map();
  for(const mesh of pack.metadata.meshes) {
    const p=pack.arrays[mesh.attributes.position.array],n=p.length/3,decode=mesh.userData?.terrainDecode;
    const residual=decode?pack.arrays[mesh.attributes.aHeightResidual.array]:null,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    // Meshes may be windows over an index array shared with other meshes: bound only the vertices the window draws.
    const indexed=!decode&&mesh.index!=null?pack.arrays[mesh.index]:null,first=mesh.drawRange?.start??0,last=indexed?first+(mesh.drawRange?.count??indexed.length):n;
    for(let k=indexed?first:0;k<(indexed?last:n);k++){const i=indexed?indexed[k]:k;
      for(let axis=0;axis<3;axis++){
        let value=p[i*3+axis]; if(decode){value=Math.fround(decode.offset[axis]+value*decode.scale[axis]);if(axis===1)value=Math.fround(value+residual[i]);}
        min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
      }
    }
    if(n)mesh.bounds={box:[...min,...max],sphere:[...min.map((v,i)=>(v+max[i])/2),Math.hypot(...min.map((v,i)=>(max[i]-v)/2))]};
    for(const [name,a]of Object.entries(mesh.attributes)){
      const key=`${a.array}:${a.itemSize}:${!!a.normalized}`+(name==='position'&&decode?`:terrain:${JSON.stringify(decode)}`:'');
      gpuViews.set(key,pack.arrays[a.array].byteLength);
    }
    if(mesh.index!=null)gpuViews.set(`index:${mesh.index}`,pack.arrays[mesh.index].byteLength);
  }
  for(const bytes of gpuViews.values())gpuBytes+=bytes;
  const gpuPlan=tileGPUPlan(pack),renderVariants=tileRenderVariants(pack),obstacleIndex=buildTileObstacleIndex(checked.tables);
  const bytes=obstacleBytes(obstacleIndex)+residentArrayBytes(pack.arrays)+contactIndex.offsets.byteLength+contactIndex.refs.byteLength+gpuBytes+new TextEncoder().encode(JSON.stringify({metadata:pack.metadata,gpuPlan,renderVariants})).byteLength;
  if(bytes>(entry.residentBytes??entry.decodedBytes))throw new Error('Tile resident budget understated');
  if(checked.triangles!==entry.triangles)throw new Error('Tile triangles mismatch');
  return {...pack,contactIndex,obstacleIndex,bytes,jsBytes:bytes-gpuBytes,gpuBytes,gpuPlan,renderVariants};
}
if(typeof self!=='undefined'&&typeof document==='undefined')self.onmessage=async({data})=>{
  if(data.cancel){controllers.get(data.id)?.abort();return;}
  const controller=new AbortController();controllers.set(data.id,controller);
  try{
    const packet=await fetchTilePacket(data.job,controller.signal,bytes=>self.postMessage({id:data.id,downloadBytes:bytes}));
    if(controller.signal.aborted)return;
    const transfer=[...new Set([...packet.arrays.map(a=>a.buffer),packet.contactIndex.offsets.buffer,packet.contactIndex.refs.buffer,...Object.values(packet.obstacleIndex).map(a=>a.buffer)])];
    self.postMessage({id:data.id,packet},transfer);
  }catch(e){self.postMessage({id:data.id,error:e.message});}finally{controllers.delete(data.id);}
};
