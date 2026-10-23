// Offline DSM ripple removal. One immutable, world-coordinate lattice drives
// every tile; render meshes, contacts, graph and dressing move together. No
// per-tile smoothing, vehicle-only height offsets or relaxed physical gates.
import {groundIndex} from '../../src/world-tile-ground.js';
import {tileTables} from '../../src/world-tile-format.js';
const taps=[1,8,28,56,70,56,28,8,1];
const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const plane=(x,z,sample,spacing=8)=>{
 const ax=Math.floor(x/spacing)*spacing,az=Math.floor(z/spacing)*spacing,u=(x-ax)/spacing,v=(z-az)/spacing;
 const a=sample(ax,az),b=sample(ax+spacing,az),c=sample(ax,az+spacing);
 return u+v<=1?a+(b-a)*u+(c-a)*v:sample(ax+spacing,az+spacing)*(u+v-1)+c*(1-u)+b*(1-v);
};
/** The atlas is small (4225 heights/cell); retain it, never whole decoded cells.
 * Protected cells cover authored regions and structures. A global
 * 128 m transition keeps their original geometry and bridge clearances intact. */
export function terrainReliefField(atlas){
 const spacing=atlas.spacing||16,n=512/spacing+1;
 const grids=new Map(Object.entries(atlas.grids)),protectedCells=new Set(atlas.protected||[]),cache=new Map();
 function node(x,z){
  const cx=Math.floor(x/512),cz=Math.floor(z/512);
  // A border node is available from either cell, including a world outer edge.
  for(const [a,b] of [[cx,cz],...(x%512===0?[[cx-1,cz]]:[]),...(z%512===0?[[cx,cz-1]]:[]),...(x%512===0&&z%512===0?[[cx-1,cz-1]]:[])]){
   const h=grids.get(a+','+b),value=h?.[(z-b*512)/spacing*n+(x-a*512)/spacing];if(Number.isFinite(value))return value;
  }
  return NaN;
 }
 // Bounded memoization prevents an all-world pass retaining millions of keys.
 // Eviction changes only work, never field values or cell iteration semantics.
 const cacheLimit=atlas.cacheLimit??32768;
 function remember(key,value){cache.set(key,value);if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);}
 const original=(x,z)=>plane(x,z,node,spacing);
 function blend(x,z){
  let weight=1;
  // Never extrapolate through missing data or across an authored/structure cell.
  // All callers see the same protected extent, including adjacent tile edges.
  for(let cz=Math.floor((z-256)/512);cz<=Math.floor((z+256)/512);cz++)for(let cx=Math.floor((x-256)/512);cx<=Math.floor((x+256)/512);cx++){
   if(grids.has(cx+','+cz)&&!protectedCells.has(cx+','+cz))continue;
   const d=Math.hypot(Math.max(cx*512-x,0,x-(cx+1)*512),Math.max(cz*512-z,0,z-(cz+1)*512));
   weight=Math.min(weight,ease(d/128));
  }
  weight*=ease((original(x,z)-2)/8);
  return weight;
 }
 function lattice(x,z){
  const key=x+','+z;if(cache.has(key))return cache.get(key);
  let sum=0;const weight=blend(x,z);
  if(!weight){remember(key,0);return 0;}
  for(let j=0;j<9;j++)for(let i=0;i<9;i++){
   const h=original(x+(i-4)*32,z+(j-4)*32);
   if(!Number.isFinite(h))throw Error('Incomplete terrain atlas halo at '+key);
   sum+=h*taps[i]*taps[j]/65536;
  }
  const height=original(x,z);
  // The sea datum and low shore stay fixed. Above 10 m, city terrain gets
  // the complete correction even when a neighbouring cell contains water.
  const delta=(sum-height)*weight;remember(key,delta);return delta;
 }
 const delta=(x,z)=>plane(x,z,lattice),target=(x,z)=>original(x,z)+delta(x,z);
 const scale=(x,z)=>{
  const grade=sample=>Math.hypot(sample(x+4,z)-sample(x-4,z),sample(x,z+4)-sample(x,z-4))/8;
  const fade=g=>Math.max(0,Math.min(1,(.22-g)/.12));
  const old=fade(grade(original)),next=fade(grade(target));return Math.min(1,next/Math.max(.001,old));
 };
 return {delta,original,lattice,blend,transform:(x,y,z)=>{const d=delta(x,z);if(!blend(x,z))return y;return original(x,z)+d+(y-original(x,z))*scale(x,z);}};
}

export function terrainAtlasCell(pack){
 const t=tileTables(pack),m=pack.metadata;
 const ground=groundIndex(t);
 const protectedReasons=[...(!t.fineSurface?.length?['no-generated-fine-surface']:[]),...(!m.extensions?.derivedBuildings?['authored-or-legacy']:[]),...(m.structures?.length?['structure-layer']:[]),...(m.tunnelBores?.length?['bore']:[]),...(m.coastalLakes?.length?['lake']:[])];
 return {heights:Array.from({length:65*65},(_,i)=>Math.fround(ground.heightAt(i%65*8,Math.floor(i/65)*8))),protected:!!protectedReasons.length,protectedReasons};
}
export function refineTerrainRelief(pack,field){
 const m=pack.metadata,t=tileTables(pack),[ox,oz]=m.cell.map(n=>n*512),info=terrainAtlasCell(pack);
 if(info.protected)return {protected:true,vertices:0,maxAdjustment:0};
 if(m.terrainRelief)throw Error('Terrain relief already applied');
 const beforeGround=groundIndex(t);
 let maxAdjustment=0,vertices=0;const moved=new Set();
 const delta=(x,z)=>field.delta(ox+x,oz+z),transform=(x,y,z)=>field.transform?field.transform(ox+x,y,oz+z):y+delta(x,z);
 function positions(p,stride=3){if(!p||moved.has(p))return;moved.add(p);for(let i=0;i<p.length;i+=stride){const y=transform(p[i],p[i+1],p[i+2]),d=y-p[i+1];p[i+1]=y;maxAdjustment=Math.max(maxAdjustment,Math.abs(d));vertices++;}}
 // Includes road paint; shared contact/render arrays are moved exactly once.
 for(const mesh of m.meshes){if(mesh.userData?.terrainDecode)throw Error('Relief requires canonical Float32 generated terrain');positions(pack.arrays[mesh.attributes.position.array]);}
 positions(t.finePositions);positions(t.contactPositions);
 const afterGround=groundIndex(t);
 function supported(p,stride=3){if(!p||moved.has(p))return;moved.add(p);for(let i=0;i<p.length;i+=stride){const x=p[i],z=p[i+2],old=beforeGround.heightAt(x,z),next=afterGround.heightAt(x,z);p[i+1]+=Number.isFinite(old)&&Number.isFinite(next)?next-old:delta(x,z);}}
 supported(t.edgePoints);supported(t.anchorTransforms,4);
 // nodePositions have their own [x,y,z] contract.
 supported(t.nodePositions);
 const detail=m.extensions?.worldDetail;
 supported(detail?.vegetation&&pack.arrays[detail.vegetation.positionHeight],4);
 supported(detail?.parking!=null&&pack.arrays[detail.parking],5);
 if(detail?.props)supported(pack.arrays[detail.props.rows],5);
 supported(detail?.signals&&pack.arrays[detail.signals.rows],6);
 // Buildings stay rigid: move the minimum supporting footprint elevation,
 // rather than bending roofs or treating their height as a world ordinate.
 for(let i=0;i<t.buildings.length;i+=4){const start=t.buildings[i+1],count=t.buildings[i+2];let oldBase=Infinity,newBase=Infinity;
  for(let j=start;j<start+count;j++){const x=t.buildingCorners[j*2],z=t.buildingCorners[j*2+1],y=beforeGround.heightAt(x,z);oldBase=Math.min(oldBase,y);newBase=Math.min(newBase,afterGround.heightAt(x,z));}
  if(Number.isFinite(oldBase)&&Number.isFinite(newBase))t.buildingHeights[i/2]+=newBase-oldBase;
 }
 for(let z=0;z<=32;z++)for(let x=0;x<=32;x++)t.coarseHeights[z*33+x]+=delta(x*16,z*16);
 m.terrainRelief={version:1,filter:'binomial-9x32m',atlasRevision:field.revision||null};
 return {protected:false,vertices,maxAdjustment};
}
