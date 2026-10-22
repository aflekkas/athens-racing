// Authored Psychiko owns its shells and villa gardens. Infill remains in the surrounding gaps.
import {PSYCHIKO_BUILDINGS as data} from './psychiko-building-data.js';
import {groundIndex} from './world-tile-ground.js';
import {inRing} from './world-tile-trees.js';
const bounds=p=>{const x=p.filter((_,i)=>i%2===0),z=p.filter((_,i)=>i%2);return [Math.min(...x),Math.min(...z),Math.max(...x),Math.max(...z)];};
const ring=p=>Array.from({length:p.length/2},(_,i)=>p.slice(i*2,i*2+2));
const buildings=data.buildings.map(b=>({...b,ring:ring(b.p),bounds:bounds(b.p)})),sources=new Set(buildings.map(b=>b.source)),owners=new Map(),exclusions=new Map();
const bucket=(map,b,pad=0)=>{for(let x=Math.floor((b.bounds[0]-pad)/128);x<=Math.floor((b.bounds[2]+pad)/128);x++)for(let z=Math.floor((b.bounds[1]-pad)/128);z<=Math.floor((b.bounds[3]+pad)/128);z++){const k=x+','+z;if(!map.has(k))map.set(k,[]);map.get(k).push(b);}};
for(const b of buildings){const q=b.bounds,k=Math.floor((q[0]+q[2])/1024)+','+Math.floor((q[1]+q[3])/1024);if(!owners.has(k))owners.set(k,[]);owners.get(k).push(b);bucket(exclusions,b,2);}
for(const p of data.gardens)bucket(exclusions,{ring:ring(p),bounds:bounds(p)},2);
const distance=(p,a,b)=>{const x=b[0]-a[0],z=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*z)/(x*x+z*z||1)));return Math.hypot(p[0]-a[0]-x*t,p[1]-a[1]-z*t);};
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
/** Includes edge crossings/containment and a two-metre roof/balcony clearance, even across tile borders. */
export function psychikoInfillBlocked(p){
 const bb=bounds(p.flat()),candidates=new Set();for(let x=Math.floor(bb[0]/128);x<=Math.floor(bb[2]/128);x++)for(let z=Math.floor(bb[1]/128);z<=Math.floor(bb[3]/128);z++)for(const b of exclusions.get(x+','+z)||[])candidates.add(b);
 for(const b of candidates){const q=b.bounds;if(bb[2]<q[0]-2||bb[0]>q[2]+2||bb[3]<q[1]-2||bb[1]>q[3]+2)continue;const r=b.ring;
  if(p.some(a=>inRing(r,...a))||r.some(a=>inRing(p,...a)))return true;
  for(let i=0;i<p.length;i++)for(let j=0;j<r.length;j++){const a=p[i],c=p[(i+1)%p.length],d=r[j],e=r[(j+1)%r.length];if(cross(a,c,d)*cross(a,c,e)<0&&cross(d,e,a)*cross(d,e,c)<0||Math.min(distance(a,d,e),distance(c,d,e),distance(d,a,c),distance(e,a,c))<2)return true;}
 }return false;
}
/** Render/obstacle tables share one replacement decision. Whole authored footprints have one cell owner. */
export function psychikoMappedBuildings(t,m){
 const ox=m.origin?.[0]??0,oz=m.origin?.[2]??0,key=(m.cell||[Math.floor(ox/512),Math.floor(oz/512)]).join(','),owned=owners.get(key)||[],rows=[],B=[],C=[],H=[];let removed=0;
 const append=(id,p,base,height,material,row)=>{B.push(id,C.length/2,p.length/2,material);C.push(...p);H.push(base,height);rows.push(row);};
 for(let i=0;i<t.buildings.length;i+=4){const row=i/4,id=String(m.ids?.[t.buildings[i]]||''),first=t.buildings[i+1],n=t.buildings[i+2],p=Array.from(t.buildingCorners.slice(first*2,(first+n)*2));
  if(sources.has(id.split(':')[1])||id.startsWith('building:gen:')&&psychikoInfillBlocked(ring(p).map(([x,z])=>[x+ox,z+oz]))){removed++;continue;}
  append(t.buildings[i],p,t.buildingHeights[row*2],t.buildingHeights[row*2+1],t.buildings[i+3],row);
 }
 if(!removed&&!owned.length)return {tables:t,rows,removed:0};
 const ground=groundIndex(t),shells=[];
 for(const b of owned){const p=b.p.map((v,i)=>v-(i%2?oz:ox)),heights=ring(p).map(([x,z])=>ground.heightAt(Math.max(.01,Math.min(511.99,x)),Math.max(.01,Math.min(511.99,z)))).filter(Number.isFinite);
  if(!heights.length)throw Error('Missing authored Psychiko building ground');
  const lo=Math.min(...heights),hi=Math.max(...heights),id=m.ids.push('building:psychiko:'+b.index)-1;append(id,p,lo-.6,hi+b.h-lo+.6,2,-1);shells.push([b.index,lo,hi]);
 }
 m.psychikoShells=shells;
 m.psychikoSourceMapSha256=data.sourceMapSha256;
 return {tables:{...t,buildings:new Uint32Array(B),buildingCorners:new Float32Array(C),buildingHeights:new Float32Array(H)},rows,removed};
}
