import * as THREE from 'three';
import { psychikoStreet } from './maps/psychiko-streets.js';
import { ASPHALT_GLSL } from './road-asphalt.js';
import { TX } from './tex.js';
import { batchStatic } from './batch.js';
import { REFLECT_LAYER } from './env.js';
import { TRAFFIC_TYPES, trafficModel } from './cars.js';
import { bakeParkedFleet } from './traffic-fleet.js';
import { RNG } from './util.js';
// Convex subtraction partitions overlapping OSM strips into disjoint polygons, including T/Y junctions.
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function area(poly){let sum=0;for(let i=1;i+1<poly.length;i++)sum+=cross(poly[0],poly[i],poly[i+1]);return sum/2;}
function half(poly,a,b,inside){const out=[];for(let i=0,j=poly.length-1;i<poly.length;j=i++){const p=poly[j],q=poly[i],d=cross(a,b,p),e=cross(a,b,q),P=inside?d>=-1e-7:d<=1e-7,Q=inside?e>=-1e-7:e<=1e-7;if(P!==Q){const t=d/(d-e);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}if(Q)out.push(q);}return out;}
function subtract(poly,clip){let rem=poly;const result=[];for(let i=0;rem.length>=3&&Math.abs(area(rem))>1e-5&&i<clip.length;i++){const a=clip[i],b=clip[(i+1)%clip.length],outer=half(rem,a,b,false);if(outer.length>=3&&Math.abs(area(outer))>1e-5)result.push(outer);rem=half(rem,a,b,true);}return result;}
function capsule(s,r){const angle=Math.atan2(s.dz,s.dx),p=[];for(let j=0;j<=6;j++){const a=angle-Math.PI/2+j*Math.PI/6;p.push([s.bx+Math.cos(a)*r,s.bz+Math.sin(a)*r]);}for(let j=0;j<=6;j++){const a=angle+Math.PI/2+j*Math.PI/6;p.push([s.ax+Math.cos(a)*r,s.az+Math.sin(a)*r]);}return p;}
export function roadNetworkMaterial(psychiko=false){const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.94,vertexColors:true});m.customProgramCacheKey=()=> psychiko?'osm-road-network-psychiko-v3':'osm-road-network-v3';m.onBeforeCompile=sh=>{
 sh.uniforms.roadAlbedo={value:TX.asphalt_diff};sh.uniforms.roadNormal={value:TX.asphalt_nor};sh.uniforms.nPaving={value:TX.paver_diff};
 sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aRoadHalfWidth; varying float nHalfWidth; varying vec2 nUV; varying vec2 nWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nnHalfWidth=aRoadHalfWidth;nUV=uv;nWorld=(modelMatrix*vec4(position,1.)).xz;');
 sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 nUV; varying vec2 nWorld; varying float nHalfWidth; uniform sampler2D nPaving;'+ASPHALT_GLSL).replace('#include <color_fragment>',`#include <color_fragment>
 float paving=step(.5,vColor.r);
 vec3 asphalt=roadAsphalt(nWorld,nHalfWidth-abs(nUV.x),vColor.b);vec3 tile=texture2D(nPaving,nWorld*.31).rgb*.74;tile=mix(tile,vec3(.19,.23,.11),step(1.5,vColor.r));
 float fw=max(fwidth(nUV.x),.012);float line=1.-smoothstep(.055-fw,.055+fw,abs(nUV.x));
 ${psychiko?'line=1.-smoothstep(.05-fw,.05+fw,abs(abs(nUV.x)-.12));':''}
 float dash=${psychiko?'1.':'step(fract(nUV.y/9.),.36)'};float paint=line*dash*vColor.g*(1.-paving);
 diffuseColor.rgb=mix(mix(asphalt,tile,paving),vec3(.72,.71,.66),paint);`).replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=roadAsphaltNormal(-vViewPosition,normal,nWorld,(1.-step(.5,vColor.r))*.65);');
 };m.defaultAttributeValues={...m.defaultAttributeValues,aRoadHalfWidth:[100]};return m;}
export function buildRoadNetwork(network,scene){
 const root=new THREE.Group();root.name='surrounding-osm-roads';scene.add(root);const mat=roadNetworkMaterial(network.route.streetCircuit),tiles=new Map(),roadS=new Map();let triangles=0;
 for(const road of network.roads){let s=0;for(const seg of network.segments.filter(q=>q.road===road)){roadS.set(seg,s);s+=seg.L;}}
 function vertex(tile,p,seg,pavement){const u=((p[0]-seg.ax)*-seg.dz+(p[1]-seg.az)*seg.dx)/seg.L,s=roadS.get(seg)+((p[0]-seg.ax)*seg.dx+(p[1]-seg.az)*seg.dz)/seg.L;
  let paint=seg.road.sf==='asphalt'&&!seg.road.oneway&&!['residential','living_street','service'].includes(seg.road.h)?1:0;
  if(seg.road.oneway||seg.road.junction==='roundabout')paint=0;
  else if(network.route.streetCircuit)paint=psychikoStreet(seg.road.n,seg.az < -900).paint;
  if(paint)for(const other of network.candidates(...p))if(other.road.id!==seg.road.id&&network.distance(other,...p)<other.hw+2){paint=0;break;}
  tile.pos.push(p[0],network.height(...p)+(pavement?.14:0),p[1]);tile.uv.push(u,s);tile.halfWidth.push(seg.hw);tile.col.push(pavement?1:0,paint,seg.road.sf==='gravel'?1:0);
 }
 function triangle(a,b,c,seg,pavement,depth=0){if(Math.abs(cross(a,b,c))<1e-6)return;const ab=Math.hypot(a[0]-b[0],a[1]-b[1]),bc=Math.hypot(b[0]-c[0],b[1]-c[1]),ca=Math.hypot(c[0]-a[0],c[1]-a[1]),length=Math.max(ab,bc,ca);
  // Subdivide for actual DEM curvature rather than making long, flat streets spend triangles on uniform metre grids.
  const ys=[a,b,c].map(p=>network.height(...p)),points=[a,b,c];let error=0;
  for(let i=0;i<3;i++){const j=(i+1)%3;error=Math.max(error,Math.abs(network.height((points[i][0]+points[j][0])/2,(points[i][1]+points[j][1])/2)-(ys[i]+ys[j])/2));}
  error=Math.max(error,Math.abs(network.height((a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3)-(ys[0]+ys[1]+ys[2])/3));
  const junction=points.some(p=>{if(!network.nearMain(...p))return false;const q=network.project(...p);return Math.abs(q.u)<network.route.edge(q.s)+8;});
  if((length>(junction?3.8:18)||error>.01&&length>.3)&&depth<16){let A=a,B=b,C=c;if(bc>ab&&bc>ca){A=b;B=c;C=a;}else if(ca>ab){A=c;B=a;C=b;}const mid=[(A[0]+B[0])/2,(A[1]+B[1])/2];triangle(A,mid,C,seg,pavement,depth+1);triangle(mid,B,C,seg,pavement,depth+1);return;}
  // Clip at the race asphalt boundary. Both surfaces meet at precisely route.surfaceY, with no overlay.
  let poly=[a,b,c],values=poly.map(p=>{if(!network.nearMain(...p))return 1;const q=network.project(...p);return !network.route.closed&&(q.s < -60||q.s>network.route.length+60)?1:Math.abs(q.u)-network.route.edge(q.s)-network.mainMargin;});const clipped=[];
  for(let i=0,j=2;i<3;j=i++){const P=values[j]>0,Q=values[i]>0;if(P!==Q){const t=values[j]/(values[j]-values[i]);clipped.push([poly[j][0]+(poly[i][0]-poly[j][0])*t,poly[j][1]+(poly[i][1]-poly[j][1])*t]);}if(Q)clipped.push(poly[i]);}
  poly=clipped;if(poly.length<3)return;
  for(let i=1;i<poly.length-1;i++){const ps=[poly[0],poly[i],poly[i+1]],area=cross(...ps);if(Math.abs(area)<1e-6)continue;if(area>0)[ps[1],ps[2]]=[ps[2],ps[1]];const k=`${Math.floor((ps[0][0]+ps[1][0]+ps[2][0])/3/300)},${Math.floor((ps[0][1]+ps[1][1]+ps[2][1])/3/300)}`;if(!tiles.has(k))tiles.set(k,{pos:[],uv:[],col:[],halfWidth:[]});for(const p of ps)vertex(tiles.get(k),p,seg,pavement);triangles++;}
 }
 for(const seg of network.segments){const mid=[(seg.ax+seg.bx)/2,(seg.az+seg.bz)/2],near=new Set();for(const p of [[seg.ax,seg.az],mid,[seg.bx,seg.bz]])for(const other of network.candidates(...p))near.add(other);
  for(const pavement of seg.sw?[false,true]:[false]){let polys=[capsule(seg,seg.hw+(pavement?seg.sw:0))];for(const other of near){if(pavement||other.id<seg.id){const clip=capsule(other,other.hw);polys=polys.flatMap(p=>subtract(p,clip));}if(pavement&&other.id<seg.id&&other.sw){const clip=capsule(other,other.hw+other.sw);polys=polys.flatMap(p=>subtract(p,clip));}if(!polys.length)break;}
   for(const poly of polys) {
    for(let i=1;i<poly.length-1;i++)triangle(poly[0],poly[i],poly[i+1],seg,pavement);
    // The exposed inner boundary of the pavement is a real 14 cm concrete kerb, continuous around corners.
    if (pavement) for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
      if(network.mainInside(mx,mz)||Math.abs(network.distance(seg,mx,mz)-seg.hw)>.22)continue;
      const n=network.sample(mx,mz);if(!n||n.step>0)continue;
      const key=`${Math.floor(mx/300)},${Math.floor(mz/300)}`;
      if(!tiles.has(key))tiles.set(key,{pos:[],uv:[],col:[],halfWidth:[]});const tile=tiles.get(key),ya=network.height(...a),yb=network.height(...b);
      for(const [p,y] of [[a,ya],[a,ya+.14],[b,yb],[b,yb],[a,ya+.14],[b,yb+.14]]){tile.pos.push(p[0],y,p[1]);tile.uv.push(0,0);tile.halfWidth.push(0);tile.col.push(1,0,0);}triangles+=2;
    }
   }
  }
 }
 // Island tops and 14 cm kerbs share each existing road chunk/material.
 for(const island of network.islands){const ring=island.ring,poly=ring.map(p=>new THREE.Vector2(...p)),faces=THREE.ShapeUtils.triangulateShape(poly,[]);
  const add=p=>{const key=`${Math.floor(p[0]/300)},${Math.floor(p[1]/300)}`;if(!tiles.has(key))tiles.set(key,{pos:[],uv:[],col:[],halfWidth:[]});return tiles.get(key);};
  // Keep every triangle in one tile, even when its vertices straddle a cell.
  const emit=(points,islandTop=false)=>{const cx=points.reduce((v,p)=>v+p[0]/3,0),cz=points.reduce((v,p)=>v+p[2]/3,0),tile=add([cx,cz]);for(const p of points){tile.pos.push(...p);tile.uv.push(0,0);tile.col.push(islandTop?2:1,0,0);tile.halfWidth.push(0);}triangles++;};
  for(const face of faces){const ps=face.map(i=>[ring[i][0],network.height(...ring[i])+.14,ring[i][1]]);if(cross(...face.map(i=>ring[i]))>0)[ps[1],ps[2]]=[ps[2],ps[1]];emit(ps,true);}
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],ya=network.height(...a),yb=network.height(...b);emit([[a[0],ya,a[1]],[b[0],yb,b[1]],[a[0],ya+.14,a[1]]]);emit([[b[0],yb,b[1]],[b[0],yb+.14,b[1]],[a[0],ya+.14,a[1]]]);}
 }
 for(const tile of tiles.values()){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(tile.pos,3));tile.positions=g.attributes.position.array;g.setAttribute('aRoadHalfWidth',new THREE.Float32BufferAttribute(tile.halfWidth,1));g.setAttribute('uv',new THREE.Float32BufferAttribute(tile.uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(tile.col,3));g.computeVertexNormals();g.computeBoundingSphere();const m=new THREE.Mesh(g,mat);m.receiveShadow=true;m.layers.enable(REFLECT_LAYER);m.boundingSphere=g.boundingSphere;m.userData={lod:true,far:1800};root.add(m);}
 // Vertex-coloured road tiles already merge all streets in a cell. Use the common static batcher for accessories.
 batchStatic(root,300);network.installSurface(tiles.values());Object.assign(network.stats,{triangles,tiles:tiles.size});return root;
}

export function buildNetworkParking(network, scene, ground) {
 const rng=new RNG(911),roots=[],obstacles=[],used=new Set();
 const types=TRAFFIC_TYPES.filter(t=>!t.police&&!t.scooter&&!t.bus&&t.w>0&&t.len<4.8&&t.wid<1.95);
 for(const seg of network.segments){
  if(obstacles.length>=18)break;
  if(!seg.road.urban||seg.road.w<5.5||seg.L<10||used.has(seg.road.id))continue;
  const nx=-seg.dz/seg.L,nz=seg.dx/seg.L,u=seg.hw-.9;
  const x=(seg.ax+seg.bx)/2+nx*u,z=(seg.az+seg.bz)/2+nz*u,q=network.project(x,z);
  if(Math.abs(q.u)<network.route.edge(q.s)+18||ground.walls(x,z,2.4,{}))continue;
  // Keep the ends of intersecting streets clear. One car per OSM town way stays sparse and inexpensive.
  if(network.candidates(x,z).some(other=>other.road.id!==seg.road.id&&network.distance(other,x,z)<other.hw+6))continue;
  const type=types[obstacles.length%types.length];if(!type)continue;
  const car=trafficModel(type,rng.pick(type.colors),rng,{parked:true}),yaw=Math.atan2(-seg.dx,-seg.dz);
  const front=network.height(x+seg.dx/seg.L*1.3,z+seg.dz/seg.L*1.3),back=network.height(x-seg.dx/seg.L*1.3,z-seg.dz/seg.L*1.3);
  car.root.position.set(x,(front+back)/2,z);car.root.rotation.set(Math.atan2(front-back,2.6),yaw,0,'YXZ');roots.push(car);
  obstacles.push({x,z,yaw,hl:type.len/2,hw:type.wid/2});used.add(seg.road.id);
 }
 if(roots.length)scene.add(bakeParkedFleet(roots,40));network.stats.parked=obstacles.length;return obstacles;
}
