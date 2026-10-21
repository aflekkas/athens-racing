// Cell-owned coastal recipes use the same worker, instanced trees and props as the basin.
// Source extraction: tools/world-gen/coastal-dressing.py. No legacy map loader or contact overlay.
import {coastalBoreSurfaces,dressCoastalBoreShells,coastalHillGround,boreLiningShade} from './world-tile-coast-bores.js';
import {COASTAL_DRESSING} from './coastal-dressing-data.js';
import {groundIndex} from './world-tile-ground.js';
import {asphaltIndex} from './world-tile-asphalt.js';
import {inRing,hashN} from './world-tile-trees.js';

export const COAST_LIMITS=Object.freeze({trees:2048,boats:48,surfaceTriangles:2048});
const offsets=[[0,0],[3,0],[-3,0],[0,3],[0,-3],[2.2,2.2],[-2.2,2.2],[2.2,-2.2],[-2.2,-2.2]];
const coverPriority={water:0,lake:0,pier:1,marina:2,developed:2,sand:3,rock:4,wood:5,park:6,scrub:7,residential:8};
export function coverAt(recipe,x,z){
  let kind='scrub',priority=99;
  for(const [k,id,rings]of recipe.cover||[]){if(coverPriority[k]>=priority)continue;if(inRing(rings[0],x,z)&&!rings.slice(1).some(r=>inRing(r,x,z))){kind=k;priority=coverPriority[k];}}
  return kind;
}
function naturalCandidates(recipe,cell){
  if(!recipe.cover)return recipe.trees;
  const rows=[],ox=cell[0]*512,oz=cell[1]*512;
  for(let z=6;z<512;z+=12)for(let x=6;x<512;x+=12){const h=hashN(Math.floor((ox+x)/12)*73856093^Math.floor((oz+z)/12)*19349663),px=x+(h%700)/100-3.5,pz=z+((h>>>12)%700)/100-3.5,k=coverAt(recipe,px,pz);
    if(['water','lake','pier','marina','developed','sand','rock'].includes(k))continue;
    if(k==='residential'&&h%5!==0)continue;
    const pine=(h>>>4)%100<(k==='wood'?75:k==='park'?65:50);rows.push([px,pz,pine?1:4,h]);}
  rows.sort((a,b)=>a[3]-b[3]);
  const shrubs=[];for(let z=4;z<512;z+=8)for(let x=4;x<512;x+=8){const h=hashN(Math.floor((ox+x)/8)*83492791^Math.floor((oz+z)/8)*2971215073),px=x+(h%400)/100-2,pz=z+((h>>>12)%400)/100-2,k=coverAt(recipe,px,pz);if(['scrub','wood','rock'].includes(k)&&h%3!==0)shrubs.push([px,pz,4,h]);}
  return rows.concat(shrubs.sort((a,b)=>a[3]-b[3]));
}
/** Ground clearance is shared by all natural placements, including future southern cells. */
export function coastalRows(t,rings,recipe,existingTrees=new Float32Array(),bakeTrees=null,cell=[0,0],lakes=[]){
  if(!recipe)return {trees:new Float32Array(),boats:new Float32Array(),surfaces:[]};
  const ground=groundIndex(t),asphalt=asphaltIndex(t),trees=[],boats=[],occupied=new Map(),surfaces=coastalBoreSurfaces(t,cell),naturalGround=coastalHillGround(surfaces,ground);
  // Seven metres is the largest exclusion radius. Query its 3x3 neighbourhood
  // instead of rescanning every earlier tree for each candidate. Keep candidate
  // order and the exact distance predicate so placement stays byte-identical.
  const occupy=(x,z)=>{const key=Math.floor(x/7)+','+Math.floor(z/7);let rows=occupied.get(key);if(!rows)occupied.set(key,rows=[]);rows.push([x,z]);};
  const crowded=(x,z,radius)=>{const cx=Math.floor(x/7),cz=Math.floor(z/7);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const rows=occupied.get((cx+dx)+','+(cz+dz));if(rows)for(const [a,b]of rows)if(Math.hypot(x-a,z-b)<radius)return true;}return false;};
  for(let i=0;i<existingTrees.length;i+=5)occupy(existingTrees[i],existingTrees[i+2]);
  if(bakeTrees)for(let i=0;i<bakeTrees.length;i+=4)occupy(bakeTrees[i],bakeTrees[i+2]);
  const candidates=naturalCandidates(recipe,cell);
  if(surfaces.length)for(let z=6;z<508;z+=12)for(let x=6;x<508;x+=12)if(naturalGround.heightAt(x,z)>ground.heightAt(x,z)+8&&['rock','scrub','wood'].includes(coverAt(recipe,x,z)))candidates.unshift([x,z,1,hashN((x+cell[0]*512)*73856093^(z+cell[1]*512)*19349663)]);
  for(const [x,z,species,seed] of candidates){
    if(trees.length>=COAST_LIMITS.trees*5)break;
    if(x<4||z<4||x>=508||z>=508)continue; // crowns cannot duplicate or obstruct a neighbour's road
    const y=naturalGround.heightAt(x,z);
    if(!Number.isFinite(y)||y<.5)continue;
    // Asphalt below a bore roof does not exclude vegetation on the hill above it.
    if(offsets.some(([dx,dz])=>(asphalt.inside(x+dx,z+dz)&&naturalGround.heightAt(x+dx,z+dz)<ground.heightAt(x+dx,z+dz)+8)||rings.some(r=>inRing(r,x+dx,z+dz))))continue;
    const ys=offsets.map(([dx,dz])=>naturalGround.heightAt(x+dx,z+dz));
    if(ys.some(v=>!Number.isFinite(v))||Math.max(...ys)-Math.min(...ys)>(species===1?4.5:y>ground.heightAt(x,z)+2?12:7))continue;
    if(crowded(x,z,species===1?7:4))continue;
    occupy(x,z);trees.push(x,y,z,(seed%628)/100,species*8+((seed>>>16)%8));
  }
  for(const [x,z,yaw,kind] of recipe.boats){
    if(boats.length>=COAST_LIMITS.boats*5)break;
    // Entire hull must be over the world's sea floor; never on a pier, beach, asphalt or lake hillside.
    const c=Math.cos(yaw),s=Math.sin(yaw);
    if([[-1.7,-5],[1.7,-5],[-1.7,5],[1.7,5],[0,0]].some(([u,v])=>{const xx=x+u*c+v*s,zz=z-u*s+v*c;return xx<0||zz<0||xx>=512||zz>=512||!(ground.heightAt(xx,zz)<-.5)||asphalt.inside(xx,zz);}))continue;
    boats.push(x,.05,z,yaw,kind);
  }
  for(const [kind,id,points] of recipe.surfaces){
    if(points.length/6>COAST_LIMITS.surfaceTriangles)continue;
    if(kind==='pier'){
      // Old pier recipe: concrete deck, 3.2 m for linear piers, mapped outline for closed ones.
      const p=[];
      for(let i=0;i<points.length;i+=6){const cx=(points[i]+points[i+2]+points[i+4])/3,cz=(points[i+1]+points[i+3]+points[i+5])/3;
        if(asphalt.inside(cx,cz))continue;
        const ys=[0,2,4].map(j=>ground.heightAt(points[i+j],points[i+j+1]));if(ys.some(y=>!Number.isFinite(y)||y<0||y>2))continue;
        for(let j=0;j<6;j+=2)p.push(points[i+j],ys[j/2]+.04,points[i+j+1]);}
      if(p.length)surfaces.push({kind,id,positions:p});
    }else if(kind==='lake'){
      const baked=lakes.find(l=>l.id===id);if(baked){surfaces.push({kind,id,positions:baked.positions});continue;}
      // Fit the low shoreline, excluding the high limestone rim from the water level estimate.
      // Clip the water back to dry ground and emitted asphalt: never flood a mapped access road.
      const outline=recipe.cover?.find(c=>c[0]==='lake'&&c[1]===id)?.[2],shore=outline?outline[0].flat():points,shoreline=[];
      for(let i=0;i<shore.length;i+=2){const y=ground.heightAt(shore[i],shore[i+1]);if(Number.isFinite(y))shoreline.push(y);}
      shoreline.sort((a,b)=>a-b);const level=shoreline[Math.floor(shoreline.length*.25)]+.06;
      if(!Number.isFinite(level))continue;
      const p=[];
      if(outline){
        const xs=outline[0].map(p=>p[0]),zs=outline[0].map(p=>p[1]);
        const wet=(x,z)=>inRing(outline[0],x,z)&&!outline.slice(1).some(r=>inRing(r,x,z))&&ground.heightAt(x,z)<level-.02&&[[0,0],[1.5,0],[-1.5,0],[0,1.5],[0,-1.5]].every(([dx,dz])=>!asphalt.inside(x+dx,z+dz));
        for(let z=Math.ceil(Math.min(...zs)/4)*4;z<Math.max(...zs);z+=4)for(let x=Math.ceil(Math.min(...xs)/4)*4;x<Math.max(...xs);x+=4){
          if(p.length/9+2>COAST_LIMITS.surfaceTriangles)continue;
          for(const triangle of [[[x,z],[x,z+4],[x+4,z]],[[x+4,z],[x,z+4],[x+4,z+4]]])if(triangle.every(([a,b])=>wet(a,b))&&wet(triangle.reduce((n,q)=>n+q[0]/3,0),triangle.reduce((n,q)=>n+q[1]/3,0)))for(const [a,b]of triangle)p.push(a,level,b);
        }
      }else for(let i=0;i<points.length;i+=2)p.push(points[i],level,points[i+1]);
      if(p.length)surfaces.push({kind,id,positions:p});
    }
  }
  return {trees:Float32Array.from(trees),boats:Float32Array.from(boats),surfaces};
}
export const coastalRecipe=cell=>COASTAL_DRESSING.cells[cell.join(',')];
/** Append optional render meshes only. The original contact/graph/building tables stay byte-identical. */
export function appendCoastalSurfaces(pack,surfaces){
  if(!surfaces.length)return 0;
  const positions=[],colours=[],rocks=[];
  for(const {kind,positions:p}of surfaces){
    for(let i=0;i<p.length;i+=9){const tri=p.slice(i,i+9),rock=kind==='rock',c=kind==='lake'?[.025,.19,.17]:rock?[.34,.345,.31]:kind==='lining'?[.16,.17,.165]:[.45,.46,.43];
      let shade=1;if(rock||kind==='concrete'||kind==='lining'){const ax=tri[3]-tri[0],ay=tri[4]-tri[1],az=tri[5]-tri[2],bx=tri[6]-tri[0],by=tri[7]-tri[1],bz=tri[8]-tri[2],nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,n=Math.hypot(nx,ny,nz)||1;shade=.72+.28*Math.abs(ny/n)+.08*(nx/n*.6+nz/n*.8);}
      positions.push(...tri);for(let j=0;j<3;j++){const depth=kind==='lining'?boreLiningShade(tri[j*3]+pack.metadata.origin[0],tri[j*3+2]+pack.metadata.origin[2]):1;colours.push(...c.map(v=>v*shade*depth));rocks.push(rock?255:0);}
      // Rock shells are closed solids seen from both bore approaches.
      if(rock||kind==='concrete'){positions.push(...tri.slice(6),...tri.slice(3,6),...tri.slice(0,3));for(let j=0;j<3;j++){colours.push(...c.map(v=>v*shade));rocks.push(rock?255:0);}}
    }
  }
  if(positions.length/3>65535)throw Error('Coastal surface vertex budget exceeded');
  const position=pack.arrays.push(Float32Array.from(positions))-1,color=pack.arrays.push(Uint8Array.from(colours.map(c=>Math.round(c*255))))-1,rock=pack.arrays.push(Uint8Array.from(rocks))-1,index=pack.arrays.push(Uint16Array.from({length:positions.length/3},(_,i)=>i))-1;
  pack.metadata.meshes.push({name:'coastal-amenities',material:0,attributes:{position:{array:position,itemSize:3,normalized:false},color:{array:color,itemSize:3,normalized:true},aRock:{array:rock,itemSize:1,normalized:true}},index,layers:1,drawRange:{start:0,count:positions.length/3},userData:{tileSurface:'coastalDetail',rockBore:surfaces.some(s=>s.kind==='rock')}});
  return (pack.arrays[position].byteLength+pack.arrays[color].byteLength+pack.arrays[rock].byteLength+pack.arrays[index].byteLength)*2+2048;
}

/** Undo only geometrically redundant four-way subdivisions for rendering.
 * Fine contact triangles remain untouched. This pays for the lake's local DEM
 * refinement without drawing hundreds of unchanged shoulder micro-triangles. */
export function coalesceLakeGround(pack){
 if(!pack.metadata.coastalLakes?.length)return 0;let bytes=0;
 for(const m of pack.metadata.meshes){if(!m.userData?.worldSurface||m.material!==0||m.index==null)continue;
  const p=pack.arrays[m.attributes.position.array],attributes=['color','aCoastColor'].filter(k=>m.attributes[k]).map(k=>[pack.arrays[m.attributes[k].array],m.attributes[k].itemSize]),original=pack.arrays[m.index],start=m.drawRange?.start||0,count=m.drawRange?.count??original.length;let ix=Array.from(original.slice(start,start+count));
  const midpoint=(a,b,v)=>{for(let j=0;j<3;j++)if(Math.abs((p[a*3+j]+p[b*3+j])/2-p[v*3+j])>.0001)return false;for(const [attr,n]of attributes)for(let j=0;j<n;j++)if(Math.abs((attr[a*n+j]+attr[b*n+j])/2-attr[v*n+j])>1)return false;return true;};
  for(let pass=0;pass<2;pass++){const out=[];for(let i=0;i<ix.length;){const [a,ab,ca,ab2,b,bc,ca2,bc2,c,ab3,bc3,ca3]=ix.slice(i,i+12);
   if(i+12<=ix.length&&ab===ab2&&ab===ab3&&ca===ca2&&ca===ca3&&bc===bc2&&bc===bc3&&midpoint(a,b,ab)&&midpoint(b,c,bc)&&midpoint(c,a,ca)){out.push(a,b,c);i+=12;}else{out.push(ix[i],ix[i+1],ix[i+2]);i+=3;}}ix=out;}
  if(ix.length<count){const index=Uint32Array.from(ix);m.index=pack.arrays.push(index)-1;m.drawRange={start:0,count:index.length};bytes+=index.byteLength*2;}
 }
 return bytes;
}

const linear=h=>{const n=parseInt(h.slice(1),16);return [n>>16,(n>>8)&255,n&255].map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});};
const coastalColours={scrub:linear('#7f8157'),wood:linear('#596a43'),park:linear('#8b9761'),rock:linear('#969b91'),sand:linear('#d8c78e'),residential:linear('#958b76'),marina:linear('#86837a'),developed:linear('#86837a')};
/** Alternate vertex colours reuse the basin's ground shader; only mapped beaches get sand, steep slopes get warm limestone. */
export function dressCoastalGround(pack,t,recipe){
  if(!recipe)return 0;
  const boreBytes=pack.metadata.tunnelBores?.length?dressCoastalBoreShells(pack,t):0;
  const gradients=new Float32Array(t.finePositions.length/3),P=t.finePositions,T=t.fineTriangles;
  for(let i=0;i<T.length;i+=3){const [a,b,c]=[T[i]*3,T[i+1]*3,T[i+2]*3],ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2],slope=Math.hypot(uy*vz-uz*vy,ux*vy-uy*vx)/Math.max(1e-5,Math.abs(uz*vx-ux*vz));for(const v of [T[i],T[i+1],T[i+2]])gradients[v]=Math.max(gradients[v],slope);}
  const slopes=new Map();for(let i=0;i<P.length;i+=3)slopes.set(P[i]+','+P[i+2],gradients[i/3]);
  const byPositions=new Map();let bytes=boreBytes;
  for(const m of pack.metadata.meshes){if(m.material!==0||!m.attributes.color||!m.userData?.worldSurface)continue;
    const key=m.attributes.position.array;let attr=byPositions.get(key);
    if(attr==null){const p=pack.arrays[key],old=pack.arrays[m.attributes.color.array],col=new Uint8Array(p.length/3*4);
      for(let i=0;i<p.length;i+=3){const x=p[i],z=p[i+2],cover=coverAt(recipe,x,z),kind=(slopes.get(x+','+z)||0)>.42&&cover!=='sand'?'rock':cover,c=coastalColours[kind]||coastalColours.scrub;
        const v=1+.035*Math.sin((x+pack.metadata.origin[0])/43+Math.sin((z+pack.metadata.origin[2])/71));
        for(let j=0;j<3;j++)col[i/3*4+j]=p[i+1]<0?old[i+j]:Math.round(Math.min(1,c[j]*v)*255);col[i/3*4+3]=kind==='rock'?255:0;}
      attr=pack.arrays.push(col)-1;byPositions.set(key,attr);bytes+=col.byteLength*2;}
    m.attributes.aCoastColor={array:attr,itemSize:4,normalized:true};m.userData.tileSurface=m.userData.tileSurface==='urban'?'coastalUrban':'coastalGround';
  }
  return bytes+coalesceLakeGround(pack);
}

/** Approved basin infill candidates, additionally checked against the emitted road and slope.
 * These are inferred houses, never additions to the surveyed building tables. */
export function coastalInfillTables(t,recipe){
  const ids=[],buildings=[],buildingCorners=[],buildingHeights=[];
  if(recipe?.infill?.length){
    const ground=groundIndex(t),asphalt=asphaltIndex(t);
    for(const [id,storeys,ring]of recipe.infill){
      if(ids.length>=256)break;
      if(!Number.isInteger(storeys)||storeys<1||storeys>3)continue;
      const probes=[];
      for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);for(let j=0;j<steps;j++)probes.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]);}
      probes.push(ring.reduce((p,q)=>[p[0]+q[0]/ring.length,p[1]+q[1]/ring.length],[0,0]));
      if(probes.some(([x,z])=>coverAt(recipe,x,z)!=='residential'||asphalt.inside(x,z)))continue;
      const ys=probes.map(([x,z])=>ground.heightAt(x,z));
      if(ys.some(y=>!Number.isFinite(y)||y<1)||Math.max(...ys)-Math.min(...ys)>1.5)continue;
      const base=Math.min(...ys)-.1,top=Math.max(...ys)+storeys*3.2;
      buildings.push(ids.length,buildingCorners.length/2,ring.length,2);ids.push(id);buildingCorners.push(...ring.flat());buildingHeights.push(base,top-base);
    }
  }
  return {ids,buildings:new Uint32Array(buildings),buildingCorners:new Float32Array(buildingCorners),buildingHeights:new Float32Array(buildingHeights)};
}

export function clearCoastalStreetTrees(t,trees,recipe){
  if(!recipe)return trees;
  const asphalt=asphaltIndex(t),ground=groundIndex(t),out=[];
  for(let i=0;i<trees.length;i+=5){const x=trees[i],z=trees[i+2],y=ground.heightAt(x,z);if(!Number.isFinite(y)||Math.abs(y-trees[i+1])>2||offsets.some(([dx,dz])=>asphalt.inside(x+dx*.4,z+dz*.4)))continue;out.push(x,y,z,trees[i+3],trees[i+4]);}
  return new Float32Array(out);
}

/** Older world bakes already contain basin infill (building:gen:*), sometimes 4–7 floors.
 * Replace those optional inferred rows, never stack coastal houses on them. Original wire tables stay intact. */
export function coastalMappedBuildings(t,metadata,recipe){
  const rows=[];for(let i=0;i<t.buildings.length/4;i++)if(!recipe||!String(metadata.ids[t.buildings[i*4]]).startsWith('building:gen:'))rows.push(i);
  if(rows.length===t.buildings.length/4)return {tables:t,rows,removed:0};
  return {tables:{...t,buildings:Uint32Array.from(rows.flatMap(i=>Array.from(t.buildings.slice(i*4,i*4+4)))),buildingHeights:Float32Array.from(rows.flatMap(i=>[t.buildingHeights[i*2],t.buildingHeights[i*2+1]]))},rows,removed:t.buildings.length/4-rows.length};
}
