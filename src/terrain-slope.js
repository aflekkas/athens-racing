// Two distance transforms constrain final triangles around road anchors. Sparse
// world keys map once to dense temporary IDs; Float64 values and stable heap
// ordering preserve the original solver's arithmetic and final heights.
class Heap {
  constructor(capacity){this.keys=new Uint32Array(Math.max(16,capacity));this.values=new Float64Array(this.keys.length);this.length=0;this.key=0;this.value=0;}
  push(key,value){
    let i=this.length++;
    if(i===this.keys.length){const keys=new Uint32Array(i*2),values=new Float64Array(i*2);keys.set(this.keys);values.set(this.values);this.keys=keys;this.values=values;}
    while(i){const parent=(i-1)>>1;if(this.values[parent]<=value)break;this.keys[i]=this.keys[parent];this.values[i]=this.values[parent];i=parent;}
    this.keys[i]=key;this.values[i]=value;
  }
  pop(){
    if(!this.length)return false;
    this.key=this.keys[0];this.value=this.values[0];const last=--this.length,key=this.keys[last],value=this.values[last];
    if(last){let i=0;while(i*2+1<last){let child=i*2+1;if(child+1<last&&this.values[child+1]<this.values[child])child++;if(this.values[child]>=value)break;this.keys[i]=this.keys[child];this.values[i]=this.values[child];i=child;}this.keys[i]=key;this.values[i]=value;}
    return true;
  }
}
export function limitTerrainSlopes(heights,fixed,stride,step){
  const count=heights.size,ids=new Map(),keys=new Float64Array(count),values=new Float64Array(count),lower=new Float64Array(count).fill(-Infinity);
  let i=0;for(const [key,value]of heights){ids.set(key,i);keys[i]=key;values[i++]=value;}
  const offsets=[-1,1,-stride,stride,-stride-1,-stride+1,stride-1,stride+1];
  const slope=.4,costs=[slope*step,slope*step,slope*step,slope*step,slope*step*Math.SQRT2,slope*step*Math.SQRT2,slope*step*Math.SQRT2,slope*step*Math.SQRT2];
  // Resolve sparse neighbours once; both heap passes revisit these edges.
  const neighbours=new Int32Array(count*8);
  for(let id=0;id<count;id++)for(let j=0;j<8;j++)neighbours[id*8+j]=ids.get(keys[id]+offsets[j])??-1;
  const heap=new Heap(count);
  for(const key of fixed){const id=ids.get(key);if(id===undefined)continue;lower[id]=values[id];heap.push(id,-values[id]);}
  while(heap.pop()){
    const id=heap.key,h=-heap.value;if(h<lower[id]-1e-9)continue;
    for(let j=0;j<8;j++){const other=neighbours[id*8+j];if(other<0)continue;const value=h-costs[j];if(value>lower[other]+1e-9){lower[other]=value;heap.push(other,-value);}}
  }
  // Preserve anchor values before raising fills. An ID mask avoids another
  // full key/value Map, and remains local to this build.
  const anchors=new Uint8Array(count);for(const key of fixed){const id=ids.get(key);if(id!==undefined)anchors[id]=1;}
  for(let id=0;id<count;id++){if(!anchors[id])values[id]=Math.max(values[id],lower[id]);heap.push(id,values[id]);}
  while(heap.pop()){
    const id=heap.key,h=heap.value;if(h>values[id]+1e-9)continue;
    for(let j=0;j<8;j++){const other=neighbours[id*8+j];if(other<0)continue;const value=h+costs[j];if(value<values[other]-1e-9){values[other]=value;heap.push(other,value);}}
  }
  for(let id=0;id<count;id++)heights.set(keys[id],values[id]);
}
