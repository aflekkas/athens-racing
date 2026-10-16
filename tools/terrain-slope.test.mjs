import test from 'node:test';import assert from 'node:assert/strict';
// Frozen pre-optimization solver (06484cb) for exact Float64 equivalence.
// Two distance transforms constrain the *triangles*, not only an ideal shoulder
// formula. Raise fills from road anchors first, then cut all remaining steep
// relief. Eight neighbours bound slopes in every direction without scan-order
// artefacts or an arbitrary relaxation-iteration limit.
class Heap {
  constructor(){this.keys=[];this.values=[];}
  push(k,v){let i=this.keys.length;this.keys.push(k);this.values.push(v);while(i){const p=(i-1)>>1;if(this.values[p]<=v)break;this.keys[i]=this.keys[p];this.values[i]=this.values[p];i=p;}this.keys[i]=k;this.values[i]=v;}
  pop(){if(!this.keys.length)return null;const k=this.keys[0],v=this.values[0],key=this.keys.pop(),value=this.values.pop();if(this.keys.length){let i=0;while(i*2+1<this.keys.length){let c=i*2+1;if(c+1<this.keys.length&&this.values[c+1]<this.values[c])c++;if(this.values[c]>=value)break;this.keys[i]=this.keys[c];this.values[i]=this.values[c];i=c;}this.keys[i]=key;this.values[i]=value;}return [k,v];}
}
function reference(heights,fixed,stride,step){
 const neighbours=[[-1,1],[1,1],[-stride,1],[stride,1],[-stride-1,Math.SQRT2],[-stride+1,Math.SQRT2],[stride-1,Math.SQRT2],[stride+1,Math.SQRT2]],slope=.4;
 let heap=new Heap();const lower=new Map(),anchors=new Map();
 for(const key of fixed){const h=heights.get(key);lower.set(key,h);anchors.set(key,h);heap.push(key,-h);}
 for(let q;(q=heap.pop());){const [key,negative]=q,h=-negative;if(h<lower.get(key)-1e-9)continue;for(const [offset,d]of neighbours){const other=key+offset;if(!heights.has(other))continue;const value=h-slope*step*d;if(value>(lower.get(other)??-Infinity)+1e-9){lower.set(other,value);heap.push(other,-value);}}}
 for(const [key,value]of lower)heights.set(key,Math.max(heights.get(key),value));
 for(const [key,value]of anchors)heights.set(key,value);
 heap=new Heap();for(const [key,value]of heights)heap.push(key,value);
 for(let q;(q=heap.pop());){const [key,h]=q;if(h>heights.get(key)+1e-9)continue;for(const [offset,d]of neighbours){const other=key+offset;if(!heights.has(other))continue;const value=h+slope*step*d;if(value<heights.get(other)-1e-9){heights.set(other,value);heap.push(other,value);}}}
}

import {limitTerrainSlopes as next} from '../src/terrain-slope.js';
test('dense slope storage preserves every Float64 height on sparse grids',()=>{
 let seed=9182;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/2**32;
 for(let run=0;run<50;run++){
  const h=new Map(),fixed=new Set(),stride=81;
  for(let z=0;z<45;z++)for(let x=0;x<80;x++){if(rand()<.12)continue;const key=z*stride+x;h.set(key,rand()*600-40);if(rand()<.03)fixed.add(key);}
  if(run===0)fixed.clear();if(run===1)for(const key of h.keys())fixed.add(key);
  const b=new Map(h);reference(h,fixed,stride,[1.25,2,2.5][run%3]);next(b,fixed,stride,[1.25,2,2.5][run%3]);assert.deepEqual(b,h);
 }
});
