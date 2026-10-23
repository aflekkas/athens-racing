// Scenery-only reducer. Physical/contact arrays and legacy parking seeds stay untouched.
import {tileTables} from '../src/world-tile-format.js';
import {groundIndex} from '../src/world-tile-ground.js';
import {inRing} from '../src/world-tile-trees.js';
import {psychikoInfillBlocked} from '../src/world-tile-psychiko.js';
import {vegetationContactIndex,vegetationRadius,speciesOfBakeRow} from '../src/vegetation-clearance.js';
export const SCENERY_CELL_LIMIT=96;
const distance=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-u*dx,z-a[1]-u*dz);};
const boundaryDistance=(rings,x,z)=>Math.min(...rings.flatMap(r=>r.map((a,i)=>distance(x,z,a,r[(i+1)%r.length]))));
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
const contains=(rings,x,z)=>inRing(rings[0],x,z)&&!rings.slice(1).some(r=>inRing(r,x,z));
export const geometryBlocks=(geometry,x,z,radius)=>polygons(geometry).some(rings=>contains(rings,x,z)||boundaryDistance(rings,x,z)<=radius);
export const geometryContainsCrown=(geometry,x,z,radius)=>polygons(geometry).some(rings=>contains(rings,x,z)&&boundaryDistance(rings,x,z)>radius);
export function applySceneryVegetation(pack,scenery,{blocked=()=>false,occupied=[]}={}){
 if(!scenery.clearanceEvidenceReady||Object.keys(scenery.exclusionErrors||{}).length)throw Error('Scenery lacks complete explicit exclusion evidence');
 const t=tileTables(pack),v=pack.metadata.extensions?.worldDetail?.vegetation;
 if(!v)throw Error('Scenery requires existing vegetation packet schema');
 const [ox,,oz]=pack.metadata.origin,ground=groundIndex(t),contacts=vegetationContactIndex(t);
 const landIds=new Set(pack.metadata.ids.flatMap((id,i)=>id.startsWith('terrain:')?[i]:[]));
 const otherGround=vegetationContactIndex({...t,contactTriangles:new Uint32Array(),fineFlags:Uint8Array.from(t.fineSurface||[],id=>landIds.has(id)?0:1)});
 const rings=[];for(let i=0;i<t.buildings.length;i+=4){const first=t.buildings[i+1],n=t.buildings[i+2];rings.push(Array.from({length:n},(_,j)=>[t.buildingCorners[(first+j)*2],t.buildingCorners[(first+j)*2+1]]));}
 const p=Array.from(pack.arrays[v.positionHeight]),k=Array.from(pack.arrays[v.kind]),s=Array.from(pack.arrays[v.seed]),seen=new Set(s),areas=new Map(scenery.areas.map(a=>[a.source,a.geometry]));
 const reject={},accepted=[];const no=reason=>{reject[reason]=(reject[reason]||0)+1;};
 for(const row of scenery.points){
  const x=Math.fround(row.x-ox),z=Math.fround(row.z-oz);if(x<0||z<0||x>=512||z>=512)continue;
  if(k.length>=SCENERY_CELL_LIMIT){no('cellCap');continue;}
  if(seen.has(row.seed)){no('duplicateSource');continue;}
  const raw=Number(row.tags.height),height=Math.fround(Number.isFinite(raw)&&raw>0?Math.min(10,Math.max(3,raw)):5.5),radius=vegetationRadius(speciesOfBakeRow(row.kind,row.seed),height);
  const ax=x+ox,az=z+oz;
  if(!contacts.clear(x,z,radius)||otherGround.intersects(x,z,radius)){no('contactOrExplicitSurface');continue;}
  if(row.kind===2&&(!areas.has(row.source)||!geometryContainsCrown(areas.get(row.source),ax,az,radius))){no('greenAreaBoundary');continue;}
  if(scenery.exclusions.some(a=>geometryBlocks(a.geometry,ax,az,radius))){no('sourcePavingBuildingWater');continue;}
  if(rings.some(r=>inRing(r,x,z)||boundaryDistance([r],x,z)<=radius)){no('buildingCrown');continue;}
  if(psychikoInfillBlocked([[ax-radius,az-radius],[ax+radius,az-radius],[ax+radius,az+radius],[ax-radius,az+radius]])||blocked(ax,az,radius)){no('authoredOrForecourt');continue;}
  if(occupied.some(([px,pz,pad=2])=>Math.hypot(px-x,pz-z)<radius+pad)){no('furnitureOrParking');continue;}
  if(p.some((_,i)=>i%4===0&&Math.hypot(p[i]-x,p[i+2]-z)<5)){no('treeSpacing');continue;}
  const y=Math.fround(ground.heightAt(x,z)),ys=[[radius,0],[-radius,0],[0,radius],[0,-radius]].map(([dx,dz])=>ground.heightAt(x+dx,z+dz));
  if(!Number.isFinite(y)||y<=0||ys.some(h=>!Number.isFinite(h)||Math.abs(h-y)>2)){no('missingGroundOrSlope');continue;}
  p.push(x,y,z,height);k.push(row.kind);s.push(row.seed);seen.add(row.seed);accepted.push({id:row.id,source:row.source,inference:row.inference,x:ax,y,z:az,height,radius});
 }
 // Wire packs deduplicate identical empty arrays across vegetation and physical
 // tables. Append private scenery views; replacing a shared slot changes physics.
 if(accepted.length){v.positionHeight=pack.arrays.push(new Float32Array(p))-1;v.kind=pack.arrays.push(new Uint8Array(k))-1;v.seed=pack.arrays.push(new Uint32Array(s))-1;}
 return {added:accepted.length,retained:k.length-accepted.length,total:k.length,reject,accepted};
}

