// Derivation reads immutable physical arrays, often through different table
// wrappers. Share their query grids within one synchronous packet build only.
// Dropping the scope frees every index; subsequent packets or edits start fresh.
let scope=null;
export function withTileSurfaceIndexes(build){
 const previous=scope;scope=new Map();try{return build();}finally{scope=previous;}
}
export function tileSurfaceIndex(kind,arrays,build){
 if(!scope||arrays.some(a=>!a))return build();
 let cache=scope.get(kind);if(!cache)scope.set(kind,cache=new WeakMap());
 for(let i=0;i<arrays.length-1;i++){let next=cache.get(arrays[i]);if(!next)cache.set(arrays[i],next=new WeakMap());cache=next;}
 const key=arrays.at(-1);let index=cache.get(key);if(!index){index=build();cache.set(key,index);}return index;
}
