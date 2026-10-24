// Per-cell CSR building-wall index. All retained buffers are counted in worker
// admission and transferred with the contact packet; no whole-map wall hash.
export function buildTileObstacleIndex(t,boxes=null){
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
 // parked cars and scooters (world-tile-parking.js): four walls each, so the player and the traffic hit them like a building
 if(boxes)for(let b=0;b<boxes.length;b+=7){const x=boxes[b],y=boxes[b+1],z=boxes[b+2],yaw=boxes[b+3],hl=boxes[b+4],hw=boxes[b+5],h=boxes[b+6],tx=Math.sin(yaw),tz=Math.cos(yaw),nx=tz,nz=-tx;
  const c=[[x+tx*hl+nx*hw,z+tz*hl+nz*hw],[x+tx*hl-nx*hw,z+tz*hl-nz*hw],[x-tx*hl-nx*hw,z-tz*hl-nz*hw],[x-tx*hl+nx*hw,z-tz*hl+nz*hw]];
  for(let j=0;j<4;j++){const [ax,az]=c[j],[bx,bz]=c[(j+1)%4],row=rows.length/6;rows.push(ax,az,bx,bz,y,y+h);
   const loX=Math.min(31,Math.max(0,Math.floor((Math.min(ax,bx)-bounds[0])/bounds[2]))),hiX=Math.min(31,Math.max(0,Math.floor((Math.max(ax,bx)-bounds[0])/bounds[2]))),loZ=Math.min(31,Math.max(0,Math.floor((Math.min(az,bz)-bounds[1])/bounds[3]))),hiZ=Math.min(31,Math.max(0,Math.floor((Math.max(az,bz)-bounds[1])/bounds[3])));
   for(let zz=loZ;zz<=hiZ;zz++)for(let xx=loX;xx<=hiX;xx++)buckets[zz*32+xx].push(row);}}
 const segments=new Float32Array(rows),offsets=new Uint32Array(1025);for(let i=0;i<1024;i++)offsets[i+1]=offsets[i]+buckets[i].length;
 const refs=new Uint32Array(offsets[1024]);for(let i=0;i<1024;i++)refs.set(buckets[i],offsets[i]);return {segments,offsets,refs,bounds};
}
export function obstacleBytes(index){return Object.values(index).reduce((n,a)=>n+a.byteLength,0);}
export class WorldTileObstacles{
 constructor({detailEnabled=true}={}){this.tiles=new Map();this.detailEnabled=detailEnabled;}
 setDetailEnabled(on){this.detailEnabled=on;}
 install(key,packet){this.tiles.set(key,{index:packet.obstacleIndex,detailIndex:packet.detailObstacleIndex,origin:packet.metadata.origin});}
 remove(key){this.tiles.delete(key);}
 dispose(){this.tiles.clear();}
 contact(x,y,z,r){
  let best=null;
  for(const {index:base,detailIndex,origin:o} of this.tiles.values())for(const index of this.detailEnabled?[base,detailIndex]:[base]){
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

// Explicit metrics-only API. Original builder/default callers remain unchanged.
// Capture the native getter, not view[Symbol.toStringTag]/constructor/instanceof.
// Its internal TypedArrayName check survives a forged prototype or tag property.
const obstacleShapeNativeBrand=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag).get;
const obstacleShapeNativeIsView=ArrayBuffer.isView,obstacleShapeNativeApply=Reflect.apply;
const obstacleShapeFloat32Prototype=Float32Array.prototype,obstacleShapeFloat64Prototype=Float64Array.prototype,obstacleShapeUint32Prototype=Uint32Array.prototype;
function obstacleShapeLength(view,kind){
 if(!obstacleShapeNativeIsView(view))throw Error('Obstacle shape: native view required');
 if(Object.hasOwn(view,Symbol.toStringTag))throw Error('Obstacle shape: native tag shadow');
 const brand=obstacleShapeNativeApply(obstacleShapeNativeBrand,view,[]),proto=Object.getPrototypeOf(view);
 if(kind==='uint'?brand!=='Uint32Array'||proto!==obstacleShapeUint32Prototype:!(brand==='Float32Array'&&proto===obstacleShapeFloat32Prototype||brand==='Float64Array'&&proto===obstacleShapeFloat64Prototype))throw Error('Obstacle shape: native brand/prototype type');
 for(const key of ['buffer','length','byteLength','byteOffset','constructor','BYTES_PER_ELEMENT'])if(Object.hasOwn(view,key))throw Error('Obstacle shape: layout shadow');
 const native=Object.getPrototypeOf(Uint8Array.prototype),buffer=Reflect.apply(Object.getOwnPropertyDescriptor(native,'buffer').get,view,[]);
 if(Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype)throw Error('Obstacle shape: fixed ArrayBuffer required');
 for(const key of ['byteLength','resizable','maxByteLength','detached','constructor'])if(Object.hasOwn(buffer,key))throw Error('Obstacle shape: backing shadow');
 const resizing=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable');
 if(resizing&&Reflect.apply(resizing.get,buffer,[]))throw Error('Obstacle shape: resizable backing');
 if(Reflect.apply(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,buffer,[])>67108864)throw Error('Obstacle shape: input backing bound');
 Reflect.apply(native.values,view,[]);
 return Reflect.apply(Object.getOwnPropertyDescriptor(native,'length').get,view,[]);
}
/** parkingState: 'unknown', 'verified-absent', or 'final-boxes'. These are
 * caller declarations for metrics, NOT verified source/parking authority.
 * Numeric row fields are inspected only for shape/finite builder arithmetic;
 * no positive-dimension/range, physical clearance or world-schema claim.
 */
export function measureObstacleIndexShape(buildings,buildingCorners,buildingHeights,parkingState='unknown',boxes=null,maxReferences=0xffffffff,maxSegments=0xffffffff){
 if(typeof maxReferences!=='number'||!Number.isSafeInteger(maxReferences)||maxReferences<0||maxReferences>0xffffffff||typeof maxSegments!=='number'||!Number.isSafeInteger(maxSegments)||maxSegments<0||maxSegments>0xffffffff)throw Error('Obstacle shape: Uint32 limit');
 if(parkingState!=='unknown'&&parkingState!=='verified-absent'&&parkingState!=='final-boxes')throw Error('Obstacle shape: parking state');
 if(parkingState==='unknown')return Object.freeze({status:'incomplete',kind:'obstacle',parkingState:'unknown',shapeOnly:true,admission:false,capacityClaim:false});
 if(parkingState==='verified-absent'&&boxes!==null)throw Error('Obstacle shape: ambiguous absent parking');
 const bl=obstacleShapeLength(buildings,'uint'),cl=obstacleShapeLength(buildingCorners,'float'),hl=obstacleShapeLength(buildingHeights,'float'),pl=parkingState==='final-boxes'?obstacleShapeLength(boxes,'float'):0;
 if(bl%4||cl%2||hl!==bl/2||pl%7)throw Error('Obstacle shape: table/box stride');
 let minX=0,minZ=0,maxX=512,maxZ=512;
 for(let i=0;i<cl;i+=2){if(!Number.isFinite(buildingCorners[i])||!Number.isFinite(buildingCorners[i+1]))throw Error('Obstacle shape: nonfinite corner');minX=Math.min(minX,buildingCorners[i]);maxX=Math.max(maxX,buildingCorners[i]);minZ=Math.min(minZ,buildingCorners[i+1]);maxZ=Math.max(maxZ,buildingCorners[i+1]);}
 for(let i=0;i<hl;i++)if(!Number.isFinite(buildingHeights[i])||!Number.isFinite(Math.fround(buildingHeights[i])))throw Error('Obstacle shape: nonfinite height');
 // Match source Float32Array([minX,minZ,(maxX-minX)/32,...]) BEFORE queries.
 const bx=Math.fround(minX),bz=Math.fround(minZ),sx=Math.fround((maxX-minX)/32),sz=Math.fround((maxZ-minZ)/32);
 if(!Number.isFinite(bx)||!Number.isFinite(bz)||!Number.isFinite(Math.fround(maxX))||!Number.isFinite(Math.fround(maxZ))||!Number.isFinite(sx)||!Number.isFinite(sz)||sx<=0||sz<=0)throw Error('Obstacle shape: rounded bounds');
 let references=0,segments=0,buildingSegments=0,emptyRectangles=0;
 for(let i=0;i<bl;i+=4){
  const first=buildings[i+1],count=buildings[i+2];
  if(first>cl/2||count>cl/2-first||count>maxSegments-segments||!Number.isFinite(Math.fround(buildingHeights[i/2]+buildingHeights[i/2+1])))throw Error('Obstacle shape: span/segment/height bound');
  for(let j=0;j<count;j++){
   const a=(first+j)*2,b=(first+(j+1)%count)*2,ax=buildingCorners[a],az=buildingCorners[a+1],cx=buildingCorners[b],cz=buildingCorners[b+1];
   const loX=Math.min(31,Math.max(0,Math.floor((Math.min(ax,cx)-bx)/sx))),hiX=Math.min(31,Math.floor((Math.max(ax,cx)-bx)/sx)),loZ=Math.min(31,Math.max(0,Math.floor((Math.min(az,cz)-bz)/sz))),hiZ=Math.min(31,Math.floor((Math.max(az,cz)-bz)/sz));
   const delta=Math.max(0,hiX-loX+1)*Math.max(0,hiZ-loZ+1);
   if(!Number.isSafeInteger(delta)||delta<0||delta>1024||delta>maxReferences-references)throw Error('Obstacle shape: building reference overflow/limit');
   references+=delta;segments++;buildingSegments++;if(!delta)emptyRectangles++;
  }
 }
 if(pl/7>(maxSegments-segments)/4)throw Error('Obstacle shape: parking segment bound');
 for(let b=0;b<pl;b+=7){
  for(let k=0;k<7;k++)if(!Number.isFinite(boxes[b+k]))throw Error('Obstacle shape: nonfinite parking');
  const x=boxes[b],y=boxes[b+1],z=boxes[b+2],yaw=boxes[b+3],hl=boxes[b+4],hw=boxes[b+5],h=boxes[b+6],tx=Math.sin(yaw),tz=Math.cos(yaw),nx=tz,nz=-tx;
  if(!Number.isFinite(Math.fround(y))||!Number.isFinite(Math.fround(y+h)))throw Error('Obstacle shape: parking height overflow');
  // Keep the builder's exact operation order; no per-box pair/corner arrays.
  const x0=x+tx*hl+nx*hw,z0=z+tz*hl+nz*hw,x1=x+tx*hl-nx*hw,z1=z+tz*hl-nz*hw,x2=x-tx*hl-nx*hw,z2=z-tz*hl-nz*hw,x3=x-tx*hl+nx*hw,z3=z-tz*hl+nz*hw;
  if(!Number.isFinite(Math.fround(x0))||!Number.isFinite(Math.fround(z0))||!Number.isFinite(Math.fround(x1))||!Number.isFinite(Math.fround(z1))||!Number.isFinite(Math.fround(x2))||!Number.isFinite(Math.fround(z2))||!Number.isFinite(Math.fround(x3))||!Number.isFinite(Math.fround(z3)))throw Error('Obstacle shape: parking corner overflow');
  for(let j=0;j<4;j++){
   const ax=j===0?x0:j===1?x1:j===2?x2:x3,az=j===0?z0:j===1?z1:j===2?z2:z3,cx=j===0?x1:j===1?x2:j===2?x3:x0,cz=j===0?z1:j===1?z2:j===2?z3:z0;
   const loX=Math.min(31,Math.max(0,Math.floor((Math.min(ax,cx)-bx)/sx))),hiX=Math.min(31,Math.max(0,Math.floor((Math.max(ax,cx)-bx)/sx))),loZ=Math.min(31,Math.max(0,Math.floor((Math.min(az,cz)-bz)/sz))),hiZ=Math.min(31,Math.max(0,Math.floor((Math.max(az,cz)-bz)/sz)));
   const delta=(hiX-loX+1)*(hiZ-loZ+1);
   if(!Number.isSafeInteger(delta)||delta<1||delta>1024||delta>maxReferences-references)throw Error('Obstacle shape: parking reference overflow/limit');
   references+=delta;segments++;
  }
 }
 return Object.freeze({status:'measured',kind:'obstacle',buildingSegments,parkingSegments:pl/7*4,segments,references,emptyRectangles,perBucketReferenceUpper:Math.min(segments,references),parkingState,rowOrder:'buildings-then-parking',shapeOnly:true,admission:false,capacityClaim:false});
}
