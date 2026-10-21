// Authored-region conversion uses the AWT tables and the existing triangle clipper.
import * as THREE from 'three';
import {triangleTiles} from '../tile-existing-worlds.mjs';
import {ATHENS_PROJECTION} from '../../src/world-manifest.js';
export const REGION_PROJECTION={lat0:ATHENS_PROJECTION.lat0,lon0:ATHENS_PROJECTION.lon0,mlat:ATHENS_PROJECTION.metresPerLat,mlon:ATHENS_PROJECTION.metresPerLon};
export function regionTransform(source,target=REGION_PROJECTION){
 for(const p of[source,target])for(const k of['lat0','lon0','mlat','mlon'])if(!Number.isFinite(p[k])||(['mlat','mlon'].includes(k)&&p[k]<=0))throw Error('Invalid region projection');
 const sx=target.mlon/source.mlon,sz=target.mlat/source.mlat,dx=(source.lon0-target.lon0)*target.mlon,dz=(target.lat0-source.lat0)*target.mlat;
 const unit=v=>{const n=Math.hypot(...v);if(!n)return v;return v.map(x=>x/n);};
 return {sx,sz,dx,dz,position:([x,y,z])=>[x*sx+dx,y,z*sz+dz],inverse:([x,y,z])=>[(x-dx)/sx,y,(z-dz)/sz],normal:([x,y,z])=>unit([x/sx,y,z/sz]),tangent:([x,y,z,w])=>[...unit([x*sx,y,z*sz]),...(w===undefined?[]:[w])],yaw:y=>Math.atan2(sx*Math.sin(y),sz*Math.cos(y))};
}
export function splitSegment(a,b){
 const cuts=[0,1];for(const axis of[0,2]){const d=b[axis]-a[axis];if(!d)continue;for(let k=Math.floor(Math.min(a[axis],b[axis])/512)+1;k*512<Math.max(a[axis],b[axis]);k++)cuts.push((k*512-a[axis])/d);}
 const ts=[...new Set(cuts)].sort((a,b)=>a-b),point=f=>a.map((v,k)=>v+(b[k]-v)*f);
 return ts.slice(1).map((t,i)=>{const aa=point(ts[i]),bb=point(t),m=point((ts[i]+t)/2);return {a:aa,b:bb,cell:[Math.floor(m[0]/512),Math.floor(m[2]/512)],f0:ts[i],f1:t};});
}
const intern=(a,s)=>{let i=a.indexOf(s);if(i<0){i=a.length;a.push(s);}return i;};
const local=(p,cell)=>[Math.fround(Math.max(0,Math.min(512,p[0]-cell[0]*512))),Math.fround(p[1]),Math.fround(Math.max(0,Math.min(512,p[2]-cell[1]*512)))];
export function addAuthoredMeshes(group,get,transform,{surface='penteliScenery',contacts=false,detail=false,bridges=[]}={}){
 let triangles=0;group.updateMatrixWorld(true);
 group.traverse(mesh=>{
  if(!mesh.isMesh)return;
  if(Array.isArray(mesh.material))throw Error('Region mesh requires a single material');
  const geometry=mesh.geometry,attributes=Object.entries(geometry.attributes).filter(([name])=>!['aHeightResidual'].includes(name)),ix=geometry.index;
  const matrix=new THREE.Matrix4(),inst=new THREE.Matrix4(),normal=new THREE.Matrix3();
  for(let instance=0;instance<(mesh.isInstancedMesh?mesh.count:1);instance++){
   matrix.copy(mesh.matrixWorld);if(mesh.isInstancedMesh){mesh.getMatrixAt(instance,inst);matrix.multiply(inst);}normal.getNormalMatrix(matrix);
   const fields=attributes.map(([name,a])=>[name,a.itemSize]),size=fields.reduce((n,[,s])=>n+s,0);
   if(fields[0][0]!=='position')throw Error('Region geometry position must be first');
   const materialColor=mesh.material.color||new THREE.Color(1,1,1),instanceColor=new THREE.Color(1,1,1);if(mesh.instanceColor)mesh.getColorAt(instance,instanceColor);
   const rgb=materialColor.clone().multiply(instanceColor).toArray(),recipe=detail?'penteliProp:'+JSON.stringify({texture:mesh.material.map?.userData.penteliRecipe,roughness:mesh.material.roughness,metalness:mesh.material.metalness,side:mesh.material.side,alphaTest:mesh.material.alphaTest,polygonOffset:mesh.material.polygonOffset,polygonOffsetFactor:mesh.material.polygonOffsetFactor,polygonOffsetUnits:mesh.material.polygonOffsetUnits}):mesh.name.startsWith('Penteli barrier chunk')?(mesh.material.metalness>.5?'penteliRail':'penteliConcrete'):mesh.name.startsWith('building-blocks:')?'penteliBuilding':surface;
   for(let i=geometry.drawRange.start||0,end=Math.min(ix?.count??geometry.attributes.position.count,(geometry.drawRange.start||0)+geometry.drawRange.count);i<end;i+=3){
    const vertices=[];
    for(let j=0;j<3;j++){
     const id=ix?ix.getX(i+j):i+j,v=[];
     for(const [name,a]of attributes){let q=Array.from({length:a.itemSize},(_,k)=>a.getComponent(id,k));
      if(name==='position')q=transform.position(new THREE.Vector3(...q).applyMatrix4(matrix).toArray());
      else if(name==='normal')q=transform.normal(new THREE.Vector3(...q).applyMatrix3(normal).normalize().toArray());
      else if(name==='tangent'){const w=q[3];q=transform.tangent([...new THREE.Vector3(...q).transformDirection(matrix).toArray(),w]);}
      v.push(...q);
     }vertices.push(v);
    }
    triangleTiles(vertices,(x,z,tri)=>{
     const tile=get(x,z);tile.authored??=new Map();const key=JSON.stringify([recipe,fields,rgb,detail]);let batches=tile.authored.get(key);if(!batches)tile.authored.set(key,batches=[]);
     let batch=batches.at(-1);if(!batch||batch.vertices.length/size>=16384*3){batch={fields,rgb,surface:recipe,detail,vertices:[]};batches.push(batch);}
     for(const v of tri)batch.vertices.push(...local(v,tile.cell),...v.slice(3));triangles++;
     if(contacts){const p=tile.t.contactPositions,t=tile.t.contactTriangles,a=tri[0],b=tri[1],c=tri[2];if(Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))>1e-8){tile.contactVertices??=new Map();const ids=[];for(const v of tri){const xyz=local(v,tile.cell),key=xyz.join(',');let id=tile.contactVertices.get(key);if(id===undefined){id=p.length/3;p.push(...xyz);tile.contactVertices.set(key,id);}ids.push(id);}let offset=0,uIndex=-1,edgeIndex=-1;for(const[name,size]of fields){if(name==='aSU')uIndex=offset+1;if(name==='aEdge')edgeIndex=offset;offset+=size;}const gravel=uIndex>=0&&Math.abs(tri.reduce((n,v)=>n+v[uIndex]/3,0))>tri.reduce((n,v)=>n+v[edgeIndex]/3,0);const station=uIndex>=0?tri.reduce((n,v)=>n+v[uIndex-1]/3,0):null,bridge=bridges.find(b=>station>=b.from&&station<=b.to);t.push(...ids,bridge?intern(tile.ids,'surface:'+bridge.id):2,gravel?4:1);tile.t.contactLayers.push(bridge?1:0);if(bridge){tile.structures??=new Map();tile.structures.set(bridge.id,{kind:'osm-bridge-guarded',layer:1,shoulderMetres:.25,bridgeSources:[bridge.id],roads:[bridge.id]});}}}
    });
   }
  }
 });return triangles;
}
export function decorateAuthored({tile,metadata,add}){
 for(const batches of tile.authored?.values()||[])for(const batch of batches){
  const {fields,vertices,rgb,surface}=batch,stride=fields.reduce((n,[,s])=>n+s,0),attributes={},unique=new Map(),rows=[],indices=[];
  for(let i=0;i<vertices.length;i+=stride){const row=vertices.slice(i,i+stride);let at=0;for(const[name,n]of fields){for(let j=0;j<n;j++)row[at+j]=name==='normal'?Math.round(Math.max(-1,Math.min(1,row[at+j]))*127)/127:name==='color'?Math.round(Math.max(0,Math.min(1,row[at+j]))*255)/255:Math.fround(row[at+j]);at+=n;}const key=row.join(',');let id=unique.get(key);if(id===undefined){id=rows.length;unique.set(key,id);rows.push(row);}indices.push(id);}
  let offset=0;
  for(const [name,size]of fields){const values=[];for(const row of rows)values.push(...row.slice(offset,offset+size));const packed=name==='normal'?Int8Array.from(values,v=>Math.round(Math.max(-1,Math.min(1,v))*127)):name==='color'?Uint8Array.from(values,v=>Math.round(Math.max(0,Math.min(1,v))*255)):new Float32Array(values);attributes[name]={array:add(packed),itemSize:size,normalized:name==='normal'||name==='color'};offset+=size;}
  let material=metadata.palette.findIndex(c=>c.every((v,i)=>v===rgb[i]));if(material<0){material=metadata.palette.length;metadata.palette.push(rgb);}
  metadata.meshes.push({name:'imported-'+surface,material,attributes,index:add(new Uint16Array(indices)),userData:{tileSurface:surface,...(surface==='penteliConcrete'?{bridgeGuard:true}:{})},layers:1,renderOrder:surface==='penteliRoad'?1:0});metadata.budgets.triangles+=indices.length/3;
 }
 if(tile.penteliPaint){const a=add(tile.penteliPaint);for(const mesh of metadata.meshes)if(mesh.userData?.tileSurface==='penteliMountain')mesh.attributes.aPCover={array:a,itemSize:1,normalized:false};}
 if(tile.penteliTrees){metadata.extensions={...metadata.extensions,worldDetail:{version:1,buildings:{facadeStyle:add(new Uint8Array(tile.t.buildings.length/4)),detailSeed:add(new Uint32Array(tile.t.buildings.length/4))},vegetation:{positionHeight:add(new Float32Array(0)),kind:add(new Uint8Array(0)),seed:add(new Uint32Array(0))},...metadata.extensions?.worldDetail,penteli:true,streetTrees:add(new Float32Array(tile.penteliTrees)),coastalTreeCount:tile.penteliTrees.length/5,penteliHouses:add(new Float32Array(tile.penteliHouses))}};metadata.penteliSceneryBytes=tile.penteliTrees.length/5*160+tile.penteliHouses.length/7*128+16384;}
 if(tile.safetyRails)metadata.safetyRails=tile.safetyRails;
 if(tile.authoredDetail)metadata.authoredDetail=tile.authoredDetail;
 if(tile.structures)metadata.structures=[...tile.structures.values()];if(tile.structures)metadata.rails=tile.safetyRails||[];
 if(tile.authoredObstacles)metadata.authoredObstacles=tile.authoredObstacles;
 metadata.regionalScenery=tile.regionalScenery;metadata.provenance=tile.provenance;
 tile.authored?.clear();
}
export function addRails(runs,get,transform){
 let segments=0,metres=0;for(const run of runs)for(let i=1;i<run.pts.length;i++){
  const p=run.pts[i-1],q=run.pts[i];if(Math.max(p.terminal,q.terminal)<=0)continue;
  for(const part of splitSegment(transform.position(p.p.toArray()),transform.position(q.p.toArray()))){const tile=get(...part.cell);tile.safetyRails??=[];tile.safetyRails.push([...local(part.a,part.cell),...local(part.b,part.cell),.85*Math.max(p.terminal,q.terminal)]);segments++;metres+=Math.hypot(...part.b.map((v,k)=>v-part.a[k]));}
 }return{segments,metres};
}
// Every vertex/portal is named in global space. Directed split edges are owned by
// exactly one cell; both cells intern precisely the same portal coordinates.
export function addRoadGraph(lines,get,transform){
 const records=[],junctions=new Map(),shared=new Map();let maxGrade=0;
 const round=p=>p.map((v,k)=>k===1?Math.fround(v):Math.round(v*10000)/10000);
 const node=p=>'penteli:n:'+p.map(v=>v.toFixed(4).replace('-','m')).join(':');
 for(const line of lines)for(const p of line.points){const key=node(round(transform.position(p)));shared.set(key,(shared.get(key)||0)+1);}
 for(const line of lines){
  let chain=null,serial=0;
  const flush=()=>{if(!chain)return;const {cell,points,layer}=chain,a=points[0],b=points.at(-1),tile=get(...cell),id=s=>intern(tile.ids,s),text=s=>intern(tile.strings,s),from=node(a),to=node(b);serial++;
   for(const [name,p]of[[from,a],[to,b]])if(!tile.graphNodes?.has(name)){tile.graphNodes??=new Set();tile.graphNodes.add(name);tile.t.nodes.push(id(name),tile.t.nodePositions.length/3);tile.t.nodePositions.push(...local(p,cell));}
   for(const reverse of line.oneway?[false]:[false,true]){
    const pp=reverse?[...points].reverse():points,src=reverse?to:from,dst=reverse?from:to,edge=`penteli:e:${line.id}:${serial}:${reverse?'r':'f'}`;
    tile.t.edges.push(id(edge),id(src),id(dst),tile.t.edgePoints.length/3,pp.length,text(line.name||'Dionysou'),1,line.speed||50,line.restricted?8:0,id('surface:roads'));for(const p of pp)tile.t.edgePoints.push(...local(p,cell));tile.t.edgeLayers.push(layer);
    const rec={id:edge,from:src,to:dst,tile};records.push(rec);for(const n of[src,dst]){if(!junctions.has(n))junctions.set(n,[]);junctions.get(n).push(rec);}
    if(!line.restricted&&!layer&&chain.length>=12){const j=Math.max(1,Math.floor(pp.length/2)),q=pp[j-1],r=pp[j],p=q.map((v,k)=>(v+r[k])/2),dx=r[0]-q[0],dz=r[2]-q[2],length=Math.hypot(dx,dz),lane=(line.width||6.8)/4;p[0]-=dz/length*lane;p[2]+=dx/length*lane;const yaw=Math.atan2(-dx,-dz);tile.t.anchors.push(id(`penteli:a:${edge}`),tile.t.anchorTransforms.length/4,id(edge),0,0);tile.t.anchorTransforms.push(...local(p,cell),yaw);}
   }chain=null;
  };
  for(let i=1;i<line.points.length;i++)for(const part of splitSegment(transform.position(line.points[i-1]),transform.position(line.points[i]))){
   const a=round(part.a),b=round(part.b),length=Math.hypot(b[0]-a[0],b[2]-a[2]),grade=Math.abs(b[1]-a[1])/length,layer=line.layerAt?.(i-1,i)||0;
   if(!Number.isFinite(grade)||grade>.45)throw Error('Imported profile exceeds 45%: '+line.id);maxGrade=Math.max(maxGrade,grade);
   if(chain&&(chain.cell.join()!=part.cell.join()||chain.layer!==layer||node(chain.points.at(-1))!==node(a)))flush();
   chain??={cell:part.cell,points:[a],layer,length:0};chain.points.push(b);chain.length+=length;
   // Preserve every sampled point, every junction and every boundary. Only
   // redundant degree-two graph records disappear; no rendered LOD changes.
   if(chain.length>=40||shared.get(node(b))>1)flush();
  }flush();
 }
 for(const [via,edges]of junctions)for(const incoming of edges.filter(e=>e.to===via))for(const outgoing of edges.filter(e=>e.from===via)){if(incoming.from===outgoing.to)continue;const tile=incoming.tile,id=s=>intern(tile.ids,s);tile.t.turns.push(id(incoming.id),id(via),id(outgoing.id),0);}
 return {directedEdges:records.length,nodes:junctions.size,maxGrade};
}
export function addBuildingColliders(buildings,get,transform,height){
 let count=0;
 for(const building of buildings){const raw=building.p?.flat();if(!raw?.length)continue;let low=Infinity,high=-Infinity;const outline=[];
  for(let i=0;i<raw.length;i+=2){const y=height(raw[i],raw[i+1]);low=Math.min(low,y);high=Math.max(high,y);outline.push(transform.position([raw[i],0,raw[i+1]]));}
  if(!Number.isFinite(low)||high<.2)continue;const xs=outline.map(p=>p[0]),zs=outline.map(p=>p[2]),x0=Math.floor(Math.min(...xs)/512),x1=Math.floor(Math.max(...xs)/512),z0=Math.floor(Math.min(...zs)/512),z1=Math.floor(Math.max(...zs)/512);
  for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){let poly=outline;
   for(const[axis,value,sign]of[[0,x*512,1],[0,(x+1)*512,-1],[2,z*512,1],[2,(z+1)*512,-1]]){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ia=(a[axis]-value)*sign>=0,ib=(b[axis]-value)*sign>=0;if(ia)out.push(a);if(ia!==ib){const f=(value-a[axis])/(b[axis]-a[axis]);out.push(a.map((v,k)=>k===axis?value:v+(b[k]-v)*f));}}poly=out;}
   if(poly.length<3)continue;if(poly.length===3)poly.push(poly[0]);if(poly.length>14)throw Error('Imported footprint exceeds AWT corner limit');
   const tile=get(x,z),id=intern(tile.ids,`penteli:building:${building.id}:${x}:${z}`);tile.t.buildings.push(id,tile.t.buildingCorners.length/2,poly.length,0);for(const p of poly)tile.t.buildingCorners.push(p[0]-x*512,p[2]-z*512);tile.t.buildingHeights.push(low-.6,high+Math.max(2.6,Number(building.h)||5.5)-low+.6);count++;
  }
 }return count;
}

// Candidate anchors must prove an entire ordinary car body on emitted asphalt.
// Boundary candidates are omitted; a nearby interior anchor avoids hidden tile
// dependencies. Runtime recovery still repeats its normal vehicle-specific test.
export function proveAnchors(tiles,{buildIndex,sample,Barriers,buildObstacles,Obstacles}){
 let accepted=0,rejected=0;
 for(const[key,tile]of tiles){const t=tile.t,index=buildIndex(t),rows=[],poses=[],origin=[tile.cell[0]*512,0,tile.cell[1]*512],barriers=new Barriers(),obstacles=new Obstacles();barriers.install(key,{metadata:{origin,safetyRails:tile.safetyRails||[]}});obstacles.install(key,{metadata:{origin},obstacleIndex:buildObstacles(t),detailObstacleIndex:tile.authoredObstacles?buildObstacles({buildings:[],buildingCorners:[],buildingHeights:[]},tile.authoredObstacles):undefined});
  for(let i=0;i<t.anchors.length;i+=5){const p=t.anchorTransforms.slice(t.anchors[i+1]*4,t.anchors[i+1]*4+4),[x,y,z,yaw]=p,hit=sample(t,index,x,z,{requiredFlags:1,referenceY:y});let safe=!!hit&&Math.abs(hit.y-y)<=.15;
   for(const a of[-2.8,0,2.8])for(const b of[-1.1,0,1.1]){const xx=x-Math.sin(yaw)*a+Math.cos(yaw)*b,zz=z-Math.cos(yaw)*a-Math.sin(yaw)*b,c=sample(t,index,xx,zz,{requiredFlags:1,referenceY:y});if(xx<.01||xx>511.99||zz<.01||zz>511.99||!c||!hit||Math.abs(c.y-(hit.y+hit.nx*(xx-x)+hit.nz*(zz-z)))>.15)safe=false;}
   const pose={x:x+origin[0],y:hit?.y??y,z:z+origin[2],yaw};if(safe&&!barriers.safe(pose))safe=false;
   if(safe)for(const a of[-1.7,0,1.7])if(obstacles.contact(pose.x-Math.sin(yaw)*a,pose.y,pose.z-Math.cos(yaw)*a,1.2))safe=false;
   if(safe){rows.push(t.anchors[i],poses.length/4,...t.anchors.slice(i+2,i+5));poses.push(x,hit.y,z,yaw);accepted++;}else rejected++;
  }
  t.anchors=rows;t.anchorTransforms=poses;
 }return {accepted,rejected};
}

// The legacy bridge mouths/shoulders are flush with the emitted fine terrain.
// Give that same geometry a deck-layer contact over the short approach apron;
// do not invent an underpass or move the source terrain vertically.
export function addBridgeAprons(map,tiles,transform){
 let triangles=0;
 for(const bridge of map.data.penteli.bridges)for(let s=bridge.from-2;s<bridge.to+2;s+=2){
  let polygon=[[s,-1],[s+2,-1],[s+2,1],[s,1]].map(([q,side])=>transform.position(map.route.point(q,side*(map.route.edge(q)+1.2)).toArray()));
  const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);if(cross(polygon[0],polygon[1],polygon[2])<0)polygon.reverse();
  const minX=Math.min(...polygon.map(p=>p[0])),maxX=Math.max(...polygon.map(p=>p[0])),minZ=Math.min(...polygon.map(p=>p[2])),maxZ=Math.max(...polygon.map(p=>p[2]));
  for(let x=Math.floor(minX/512);x<=Math.floor(maxX/512);x++)for(let z=Math.floor(minZ/512);z<=Math.floor(maxZ/512);z++){
   const tile=tiles.get(`${x},${z}`);if(!tile)continue;const t=tile.t,p=t.finePositions,ix=t.fineTriangles;
   for(let i=0;i<ix.length;i+=3){let poly=ix.slice(i,i+3).map(j=>[p[j*3]+x*512,p[j*3+1],p[j*3+2]+z*512]);if(Math.max(...poly.map(p=>p[0]))<minX||Math.min(...poly.map(p=>p[0]))>maxX||Math.max(...poly.map(p=>p[2]))<minZ||Math.min(...poly.map(p=>p[2]))>maxZ)continue;
    for(let k=0;k<4&&poly.length;k++){const a=polygon[k],b=polygon[(k+1)%4],out=[];for(let j=0;j<poly.length;j++){const v=poly[j],w=poly[(j+1)%poly.length],d=cross(a,b,v),e=cross(a,b,w);if(d>=0)out.push(v);if((d>=0)!==(e>=0)){const f=d/(d-e);out.push(v.map((q,k)=>q+(w[k]-q)*f));}}poly=out;}
    for(let j=1;j+1<poly.length;j++){const tri=[poly[0],poly[j],poly[j+1]].map(p=>local(p,tile.cell));if(Math.abs(cross(...tri))<1e-7)continue;const ids=[];tile.contactVertices??=new Map();for(const v of tri){const key=v.join(',');let id=tile.contactVertices.get(key);if(id===undefined){id=t.contactPositions.length/3;tile.contactVertices.set(key,id);t.contactPositions.push(...v);}ids.push(id);}t.contactTriangles.push(...ids,intern(tile.ids,'surface:'+bridge.id),2);t.contactLayers.push(1);triangles++;}
   }
  }
 }return triangles;
}
