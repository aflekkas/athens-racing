// Per-cell CSR building-wall index. All retained buffers are counted in worker
// admission and transferred with the contact packet; no whole-map wall hash.
export function buildTileObstacleIndex(t){
 let minX=0,minZ=0,maxX=512,maxZ=512;for(let i=0;i<t.buildingCorners.length;i+=2){minX=Math.min(minX,t.buildingCorners[i]);maxX=Math.max(maxX,t.buildingCorners[i]);minZ=Math.min(minZ,t.buildingCorners[i+1]);maxZ=Math.max(maxZ,t.buildingCorners[i+1]);}
 const bounds=new Float32Array([minX,minZ,(maxX-minX)/32,(maxZ-minZ)/32,maxX,maxZ]);
 const rows=[],buckets=Array.from({length:1024},()=>[]);
 for(let i=0;i<t.buildings.length;i+=4){const first=t.buildings[i+1],count=t.buildings[i+2],h=i/2;
  for(let j=0;j<count;j++){
   const a=(first+j)*2,b=(first+(j+1)%count)*2,ax=t.buildingCorners[a],az=t.buildingCorners[a+1],bx=t.buildingCorners[b],bz=t.buildingCorners[b+1],row=rows.length/6;
   rows.push(ax,az,bx,bz,t.buildingHeights[h],t.buildingHeights[h]+t.buildingHeights[h+1]);
   const loX=Math.min(31,Math.max(0,Math.floor((Math.min(ax,bx)-bounds[0])/bounds[2]))),hiX=Math.min(31,Math.floor((Math.max(ax,bx)-bounds[0])/bounds[2])),loZ=Math.min(31,Math.max(0,Math.floor((Math.min(az,bz)-bounds[1])/bounds[3]))),hiZ=Math.min(31,Math.floor((Math.max(az,bz)-bounds[1])/bounds[3]));
   for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++)buckets[z*32+x].push(row);
  }
 }
 const segments=new Float32Array(rows),offsets=new Uint32Array(1025);for(let i=0;i<1024;i++)offsets[i+1]=offsets[i]+buckets[i].length;
 const refs=new Uint32Array(offsets[1024]);for(let i=0;i<1024;i++)refs.set(buckets[i],offsets[i]);return {segments,offsets,refs,bounds};
}
export function obstacleBytes(index){return Object.values(index).reduce((n,a)=>n+a.byteLength,0);}
export class WorldTileObstacles{
 constructor(){this.tiles=new Map();}
 install(key,packet){this.tiles.set(key,{index:packet.obstacleIndex,origin:packet.metadata.origin});}
 remove(key){this.tiles.delete(key);}
 dispose(){this.tiles.clear();}
 contact(x,y,z,r){
  let best=null;
  for(const {index,origin:o} of this.tiles.values()){
   if(!index)continue;const lx=x-o[0],lz=z-o[2],b=index.bounds;if(lx+r<b[0]||lz+r<b[1]||lx-r>b[4]||lz-r>b[5])continue;
   const {segments:s,offsets,refs}=index;
   for(let cz=Math.max(0,Math.floor((lz-r-b[1])/b[3]));cz<=Math.min(31,Math.floor((lz+r-b[1])/b[3]));cz++)for(let cx=Math.max(0,Math.floor((lx-r-b[0])/b[2]));cx<=Math.min(31,Math.floor((lx+r-b[0])/b[2]));cx++){
    const cell=cz*32+cx;
    for(let k=offsets[cell];k<offsets[cell+1];k++){
     const i=refs[k]*6;if(y+2<s[i+4]||y>s[i+5])continue;
     const dx=s[i+2]-s[i],dz=s[i+3]-s[i+1],f=Math.max(0,Math.min(1,((lx-s[i])*dx+(lz-s[i+1])*dz)/(dx*dx+dz*dz||1)));
     const ex=lx-s[i]-dx*f,ez=lz-s[i+1]-dz*f,d=Math.hypot(ex,ez),pen=r-d;
     if(pen>0&&(!best||pen>best.pen))best={pen,nx:d?ex/d:-dz/(Math.hypot(dx,dz)||1),nz:d?ez/d:dx/(Math.hypot(dx,dz)||1),height:s[i+5]-s[i+4]};
    }
   }
  }return best;
 }
}
