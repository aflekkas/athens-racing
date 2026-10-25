// Optional exact-query acceleration. Reservations share the existing stream
// admission cap; an unavailable/full cache falls back to the original predicate.
export class WorldRoadQueryCache {
 constructor(stream,{maxBytes=256*1024}={}){this.stream=stream;this.maxBytes=maxBytes;this.bytes=0;this.buildings=null;this.connections=null;this.baseBytes=0;this.revision=null;}
 reserve(bytes){const base=this.baseBytes?0:1024;if(this.bytes+bytes+base>this.maxBytes||!this.stream.reserveQueryBytes?.(bytes+base))return false;if(base){this.buildings=new Map();this.connections=new Map();this.baseBytes=base;}this.bytes+=bytes+base;return true;}
 release(bytes){this.bytes-=bytes;this.stream.releaseQueryBytes(bytes);}
 clearConnections(){for(const entry of this.connections?.values()||[])this.release(entry.bytes);this.connections?.clear();}
 sync(graph){if(this.revision!==graph.revision){this.clearConnections();this.revision=graph.revision;}for(const [key,entry]of this.buildings||[]){const tile=this.stream.tiles.get(key),t=tile?.packet?.tables,m=tile?.packet?.metadata;if(tile?.state!=='active'||tile.packet!==entry.packet||t.buildings!==entry.rows||t.buildingCorners!==entry.corners||m.origin[0]!==entry.x||m.origin[2]!==entry.z){this.release(entry.bytes);this.buildings.delete(key);}}}
 connected(edge,graph){this.sync(graph);const entry=this.connections?.get(edge.id);if(entry?.edge===edge)return new Map(entry.result);if(entry){this.release(entry.bytes);this.connections.delete(edge.id);}return null;}
 rememberConnected(edge,result){
  if(this.connections?.has(edge.id))return;
  let bytes=256+edge.id.length*2;for(const [surface]of result)bytes+=192+surface.length*2;
  if(bytes+(this.baseBytes||1024)>this.maxBytes)return;
  // A full optional cache must still admit the current repeatedly sampled turn.
  // Drop older connectivity first, then bounds (whose exact fallback is cheap).
  let attempts=(this.connections?.size||0)+(this.buildings?.size||0);
  while(!this.reserve(bytes)){
   if(attempts--<=0)return;
   const entries=this.connections?.size?this.connections:this.buildings;
   const first=entries?.entries().next().value;if(!first)return;
   entries.delete(first[0]);this.release(first[1].bytes);
  }
  try{this.connections.set(edge.id,{edge,result:new Map(result),bytes});}catch(error){this.release(bytes);throw error;}
 }
 boundsFor(tile){if(!this.stream.reserveQueryBytes)return null;let key;for(const [k,value]of this.stream.tiles)if(value===tile){key=k;break;}if(key===undefined)return null;return this.bounds(key,tile);}
 bounds(key,tile){
  const old=this.buildings?.get(key);if(old)return old.bounds;
  const t=tile.packet.tables,m=tile.packet.metadata,count=t.buildings.length;
  const bytes=count*8+320+key.length*2;if(!count||!this.reserve(bytes))return null;
  try{const bounds=new Float64Array(count);
   for(let i=0;i<count;i+=4){let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
    const first=t.buildings[i+1],end=first+t.buildings[i+2];
    for(let j=first;j<end;j++){const x=t.buildingCorners[j*2]+m.origin[0],z=t.buildingCorners[j*2+1]+m.origin[2];minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);}
    if(![minX,minZ,maxX,maxZ].every(Number.isFinite))minX=minZ=maxX=maxZ=NaN;
    bounds[i]=minX;bounds[i+1]=minZ;bounds[i+2]=maxX;bounds[i+3]=maxZ;
   }
   this.buildings.set(key,{packet:tile.packet,rows:t.buildings,corners:t.buildingCorners,x:m.origin[0],z:m.origin[2],bounds,bytes});return bounds;
  }catch(error){this.release(bytes);throw error;}
 }
 remove(key){const entry=this.buildings?.get(key);if(entry){this.release(entry.bytes);this.buildings.delete(key);}this.clearConnections();}
 clear(){for(const entry of this.buildings?.values()||[])this.release(entry.bytes);this.buildings?.clear();this.clearConnections();if(this.baseBytes){this.release(this.baseBytes);this.baseBytes=0;}this.buildings=null;this.connections=null;}
}
