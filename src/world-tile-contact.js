// Worker-built CSR grid: bounded storage, no per-triangle JS objects retained on main.
export const CONTACT_CELL = 16;
const GRID = 32;
export function buildTileContactIndex(t, maxReferences = 2000000) {
  const counts = new Uint32Array(GRID * GRID);
  const visit = (positions, triangles, stride, fine, write) => {
    for (let i = 0; i < triangles.length; i += stride) {
      const a = triangles[i]*3, b = triangles[i+1]*3, c = triangles[i+2]*3;
      const x0 = Math.max(0,Math.min(31,Math.floor(Math.min(positions[a],positions[b],positions[c])/16)));
      const x1 = Math.max(0,Math.min(31,Math.floor(Math.max(positions[a],positions[b],positions[c])/16)));
      const z0 = Math.max(0,Math.min(31,Math.floor(Math.min(positions[a+2],positions[b+2],positions[c+2])/16)));
      const z1 = Math.max(0,Math.min(31,Math.floor(Math.max(positions[a+2],positions[b+2],positions[c+2])/16)));
      for (let z=z0;z<=z1;z++) for (let x=x0;x<=x1;x++) write(z*GRID+x, fine ? (i/stride)|0x80000000 : i/stride);
    }
  };
  // Compact tiles list their ground contact rows as the fine triangles (see TILE_COMPACT_TABLES): one reference per
  // triangle answers both the road/terrain contact and the fine fallback.
  const both = write => { visit(t.contactPositions,t.contactTriangles,5,false,write); visit(t.finePositions,t.fineTriangles,3,true,write); };
  const pass = t.fineSurface ? write => { visit(t.finePositions,t.fineTriangles,3,true,write); visit(t.contactPositions,t.contactTriangles,5,false,write); } : both;
  let total=0;
  pass(cell => { if (++total>maxReferences) throw new Error('Tile contact index exceeds reference budget'); counts[cell]++; });
  const offsets = new Uint32Array(counts.length+1);
  for(let i=0;i<counts.length;i++) offsets[i+1]=offsets[i]+counts[i];
  const refs=new Uint32Array(total), cursor=offsets.slice(0,-1);
  pass((cell,ref) => { refs[cursor[cell]++]=ref; });
  return {offsets,refs};
}
function triangle(positions,indices,i,x,z) {
  const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  const ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2];
  const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz); if(Math.abs(det)<1e-10)return null;
  const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det,w=1-u-v;
  if(u< -1e-6||v< -1e-6||w< -1e-6)return null;
  const ay=positions[a+1],by=positions[b+1],cy=positions[c+1];
  return {y:u*ay+v*by+w*cy, nx:((bz-cz)*(ay-cy)+(cz-az)*(by-cy))/det, nz:((cx-bx)*(ay-cy)+(ax-cx)*(by-cy))/det};
}
/** referenceY/layer are mandatory for unambiguous bridge/tunnel contacts. */
export function sampleTileContact(t,index,x,z,{referenceY=0,layer=null,requiredFlags=0,includeBoundary=false}={}) {
  if(x<0||z<0||x>512||z>512||!includeBoundary&&(x===512||z===512))return null;
  const cell=Math.min(31,Math.floor(z/16))*GRID+Math.min(31,Math.floor(x/16)); let best=null,score=Infinity;const groups=new Map();
  const keep=(sample,flags,surfaceLayer,surface,fine)=>{
    // Contact is the top road (or terrain) face within a physical layer.
    // Choosing the face nearest referenceY let a lower overlapping road fan
    // steal contact on only one side of a tile border. The fine terrain beneath
    // asphalt belongs to that same layer too: it must never steal road contact
    // because it happens to be nearer the car or route centreline height. Height selects BETWEEN
    // layers, preserving bridge/tunnel selection, never beneath the top face.
    const key=surfaceLayer,previous=groups.get(key);
    if(!previous||sample.y>previous.y||Math.abs(sample.y-previous.y)<1e-6&&previous.fine&&!fine)groups.set(key,{...sample,flags,layer:surfaceLayer,surface,fine});
  };
  const allowed=(flags,surfaceLayer)=>!(flags&8 || requiredFlags && !(flags&requiredFlags) || layer!==null&&surfaceLayer!==layer);
  for(let k=index.offsets[cell];k<index.offsets[cell+1];k++) {
    const ref=index.refs[k],fine=!!(ref&0x80000000),row=ref&0x7fffffff;
    if(fine&&t.fineSurface){
      // Ground row of a compact tile: its (surface, flags) contact view and the fine fallback share one triangle.
      const flags=t.fineFlags[row],asContact=allowed(flags,0),asFine=allowed(2,0);if(!asContact&&!asFine)continue;
      const sample=triangle(t.finePositions,t.fineTriangles,row*3,x,z);if(!sample)continue;
      if(asContact)keep(sample,flags,0,t.fineSurface[row],false);
      if(asFine)keep(sample,2,0,0,true);
      continue;
    }
    const i=row*(fine?3:5),flags=fine?2:t.contactTriangles[i+4],surfaceLayer=fine?0:t.contactLayers[row];
    if(!allowed(flags,surfaceLayer))continue;
    const sample=triangle(fine?t.finePositions:t.contactPositions,fine?t.fineTriangles:t.contactTriangles,i,x,z);
    if(!sample)continue;
    keep(sample,flags,surfaceLayer,fine?0:t.contactTriangles[i+3],fine);
  }
  // A deck meeting its approach can be only a few centimetres above the terrain.
  // Prefer road contact within the allowed 15 cm step; distant bridge layers still use height.
  for(const sample of groups.values()){
    const d=Math.abs(sample.y-referenceY)+(sample.flags&1?0:.15);if(d<score){score=d;best=sample;}
  }
  if(best){delete best.fine;return best;}
  // Canonical coarse triangles, matching the existing shortest-height-diagonal rule.
  const fx=x/16,fz=z/16,ix=Math.min(31,Math.floor(fx)),iz=Math.min(31,Math.floor(fz)),u=fx-ix,v=fz-iz,k=iz*33+ix,H=t.coarseHeights;
  const a=H[k],b=H[k+1],c=H[k+33],d=H[k+34]; let y,nx,nz;
  if(Math.abs(a-d)<Math.abs(b-c)) {
    if(u>v){nx=b-a;nz=d-b;y=a+nx*u+nz*v;}else{nx=d-c;nz=c-a;y=a+nx*u+nz*v;}
  }else if(u+v<1){nx=b-a;nz=c-a;y=a+nx*u+nz*v;}else{nx=d-c;nz=d-b;y=d-nx*(1-u)-nz*(1-v);}
  return requiredFlags && !(requiredFlags&2) || layer!==null&&layer!==0?null:{y,nx:nx/16,nz:nz/16,flags:2,layer:0,surface:0};
}

// Explicit metrics-only API. No runtime caller, admission or native-memory claim.
// Positional native views avoid invoking table/options property accessors.
// Capture the native getter, not view[Symbol.toStringTag]/constructor/instanceof.
// Its internal TypedArrayName check survives a forged prototype or tag property.
const contactShapeNativeBrand=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag).get;
const contactShapeNativeIsView=ArrayBuffer.isView,contactShapeNativeApply=Reflect.apply;
const contactShapeFloat32Prototype=Float32Array.prototype,contactShapeFloat64Prototype=Float64Array.prototype,contactShapeUint32Prototype=Uint32Array.prototype;
function contactShapeLength(view,kind){
 if(!contactShapeNativeIsView(view))throw Error('Contact shape: native view required');
 if(Object.hasOwn(view,Symbol.toStringTag))throw Error('Contact shape: native tag shadow');
 const brand=contactShapeNativeApply(contactShapeNativeBrand,view,[]),proto=Object.getPrototypeOf(view);
 if(kind==='uint'?brand!=='Uint32Array'||proto!==contactShapeUint32Prototype:!(brand==='Float32Array'&&proto===contactShapeFloat32Prototype||brand==='Float64Array'&&proto===contactShapeFloat64Prototype))throw Error('Contact shape: native brand/prototype type');
 for(const key of ['buffer','length','byteLength','byteOffset','constructor','BYTES_PER_ELEMENT'])if(Object.hasOwn(view,key))throw Error('Contact shape: layout shadow');
 const native=Object.getPrototypeOf(Uint8Array.prototype);
 const buffer=Reflect.apply(Object.getOwnPropertyDescriptor(native,'buffer').get,view,[]);
 if(Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype)throw Error('Contact shape: fixed ArrayBuffer required');
 for(const key of ['byteLength','resizable','maxByteLength','detached','constructor'])if(Object.hasOwn(buffer,key))throw Error('Contact shape: backing shadow');
 const resizing=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable');
 if(resizing&&Reflect.apply(resizing.get,buffer,[]))throw Error('Contact shape: resizable backing');
 const bytes=Reflect.apply(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,buffer,[]);
 if(bytes>67108864)throw Error('Contact shape: input backing bound');
 // Native iterator creation validates detached buffers; one fixed object/input,
 // never one object/triangle or a count-sized list. No iterator is consumed.
 Reflect.apply(native.values,view,[]);
 return Reflect.apply(Object.getOwnPropertyDescriptor(native,'length').get,view,[]);
}
/** Counts the unchanged builder's AABB visits. Does not validate a world tile.
 * compact is actual fineSurface presence/truthiness normalized to a boolean by
 * an owned caller (empty typed view is present); no metadata/options callbacks.
 */
export function measureContactIndexShape(finePositions,fineTriangles,contactPositions,contactTriangles,compact,maxReferences=2000000){
 if(typeof compact!=='boolean'||typeof maxReferences!=='number'||!Number.isSafeInteger(maxReferences)||maxReferences<0||maxReferences>0xffffffff)throw Error('Contact shape: mode/reference limit');
 const fp=contactShapeLength(finePositions,'float'),ft=contactShapeLength(fineTriangles,'uint'),cp=contactShapeLength(contactPositions,'float'),ct=contactShapeLength(contactTriangles,'uint');
 if(fp%3||cp%3||ft%3||ct%5||ft/3>=0x80000000||ct/5>=0x80000000)throw Error('Contact shape: stride/row encoding');
 for(let i=0;i<fp;i++)if(!Number.isFinite(finePositions[i]))throw Error('Contact shape: nonfinite position');
 for(let i=0;i<cp;i++)if(!Number.isFinite(contactPositions[i]))throw Error('Contact shape: nonfinite position');
 let references=0,primitives=0;
 // Scalar workspace only. Preserve compact vs legacy pass order, not a
 // triangle-intersection approximation, half-open edge, or deduplicated fan.
 for(let pass=0;pass<2;pass++){
  const fine=compact?pass===0:pass===1,positions=fine?finePositions:contactPositions,triangles=fine?fineTriangles:contactTriangles,stride=fine?3:5,length=fine?ft:ct,vertices=(fine?fp:cp)/3;
  for(let i=0;i<length;i+=stride){
   if(triangles[i]>=vertices||triangles[i+1]>=vertices||triangles[i+2]>=vertices)throw Error('Contact shape: vertex index');
   const a=triangles[i]*3,b=triangles[i+1]*3,c=triangles[i+2]*3;
   const x0=Math.max(0,Math.min(31,Math.floor(Math.min(positions[a],positions[b],positions[c])/16))),x1=Math.max(0,Math.min(31,Math.floor(Math.max(positions[a],positions[b],positions[c])/16)));
   const z0=Math.max(0,Math.min(31,Math.floor(Math.min(positions[a+2],positions[b+2],positions[c+2])/16))),z1=Math.max(0,Math.min(31,Math.floor(Math.max(positions[a+2],positions[b+2],positions[c+2])/16)));
   const delta=(x1-x0+1)*(z1-z0+1);
   if(!Number.isSafeInteger(delta)||delta<1||delta>1024||delta>maxReferences-references)throw Error('Contact shape: reference overflow/limit');
   references+=delta;primitives++;
  }
 }
 return Object.freeze({status:'measured',kind:'contact',fineTriangles:ft/3,contactTriangles:ct/5,primitives,references,perBucketReferenceUpper:Math.min(primitives,references),passOrder:compact?'fine-then-contact':'contact-then-fine',shapeOnly:true,admission:false,capacityClaim:false});
}
