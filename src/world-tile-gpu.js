/** Shared CPU-only upload contract. Worker produces it; main thread never scans vertices. */
export function tileGPUPlan(pack){
 const buffers=new Map(),meshes=[];
 for(const m of pack.metadata.meshes){
  const bindings={},decode=m.userData?.terrainDecode;
  for(const[name,a]of Object.entries(m.attributes)){
   const key=`${a.array}:${a.itemSize}:${!!a.normalized}`+(name==='position'&&decode?`:terrain:${JSON.stringify(decode)}`:'');
   if(!buffers.has(key))buffers.set(key,{key,array:a.array,itemSize:a.itemSize,normalized:!!a.normalized,type:pack.arrays[a.array].constructor.name,count:pack.arrays[a.array].length/a.itemSize});
   bindings[name]=key;
  }
  let index=null;if(m.index!=null){index=`index:${m.index}`;if(!buffers.has(index))buffers.set(index,{key:index,array:m.index,itemSize:1,normalized:false,type:pack.arrays[m.index].constructor.name,count:pack.arrays[m.index].length});}
  meshes.push({attributes:bindings,index});
 }
 return {buffers:[...buffers.values()],meshes};
}
export function tileRenderVariants(pack){
 const variants=new Map();
 for(const m of pack.metadata.meshes){
  const attributes=Object.fromEntries(Object.entries(m.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>[name,{type:pack.arrays[a.array].constructor.name,itemSize:a.itemSize,normalized:!!a.normalized}]));
  const variant={surface:m.userData?.tileSurface||'basic',attributes,index:m.index==null?null:pack.arrays[m.index].constructor.name,terrain:!!m.userData?.terrainDecode};
  const key=JSON.stringify(variant);variants.set(key,{key,...variant});
 }
 return [...variants.values()];
}
export const GL_ARRAY_TYPES={Float32Array:'FLOAT',Uint8Array:'UNSIGNED_BYTE',Uint8ClampedArray:'UNSIGNED_BYTE',Int8Array:'BYTE',Uint16Array:'UNSIGNED_SHORT',Int16Array:'SHORT',Uint32Array:'UNSIGNED_INT',Int32Array:'INT'};
