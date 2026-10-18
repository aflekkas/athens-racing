// Owner exception 2026-10-18: only source-verified OSM bridge=yes ways and
// connected approaches may replace six-metre shoulders with guarded edges.
// The surface audit still enforces asphalt/shoulder slopes and approach grades.
import {buildTileContactIndex,sampleTileContact} from '../src/world-tile-contact.js';
export function auditBridgeGuards(t,m){
 const structures=m.structures||[],rails=m.rails||[];
 if(!structures.length)return {passed:rails.length===0,edgeSamples:0,unguarded:0,clearanceSamples:0,blocked:0,unsafeAnchors:0};
 const c={...t,finePositions:[],fineTriangles:[],coarseHeights:Array(1089).fill(NaN)},index=buildTileContactIndex(c),p=t.contactPositions,ix=t.contactTriangles;
 const edges=new Map(),unguardedPoints=[];let edgeSamples=0,unguarded=0,clearanceSamples=0,blocked=0,unsafeAnchors=0,minClearance=Infinity;
 const point=i=>[p[i*3],p[i*3+1],p[i*3+2]];
 const ground=(x,z)=>sampleTileContact(c,index,x,z,{layer:0});
 const deck=(x,z)=>sampleTileContact(c,index,x,z,{layer:1});
 const clearance=(x,z)=>{
  const a=ground(x,z),b=deck(x,z);if(!a||!b||!(a.flags&1)||b.y-a.y<=.15)return;
  const gap=b.y-a.y-.5;clearanceSamples++;minClearance=Math.min(minClearance,gap);if(gap<4.5-.002)blocked++;
 };
 for(let i=0;i<ix.length;i+=5){
  const vertices=[ix[i],ix[i+1],ix[i+2]];
  if(t.contactLayers[i/5]===1){
   for(let k=0;k<3;k++){const a=vertices[k],b=vertices[(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;if(edges.has(key))edges.set(key,null);else edges.set(key,[point(a),point(b)]);}
  }
  // Full ground carriageway edges and interiors, not only its centreline.
  if(t.contactLayers[i/5]!==0||!(ix[i+4]&1))continue;
  const [a,b,d]=vertices.map(point),n=Math.max(1,Math.ceil(Math.max(Math.hypot(a[0]-b[0],a[2]-b[2]),Math.hypot(a[0]-d[0],a[2]-d[2]),Math.hypot(b[0]-d[0],b[2]-d[2]))/2));
  for(let j=0;j<=n;j++)for(let k=0;k<=n-j;k++)clearance(a[0]+(b[0]-a[0])*j/n+(d[0]-a[0])*k/n,a[2]+(b[2]-a[2])*j/n+(d[2]-a[2])*k/n);
 }
 for(const pair of edges.values()){
  if(!pair)continue;const [a,b]=pair;
  // A clipped tile border is completed by the neighbouring tile, not a rail.
  if([0,2].some(axis=>Math.abs(a[axis]-b[axis])<.001&&(Math.abs(a[axis])<.001||Math.abs(a[axis]-512)<.001)))continue;
  const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])));
  for(let j=0;j<=n;j++){
   const x=a[0]+(b[0]-a[0])*j/n,y=a[1]+(b[1]-a[1])*j/n,z=a[2]+(b[2]-a[2])*j/n,g=ground(x,z);
   if(Math.min(x,z,512-x,512-z)<.22)continue; // rail ownership may be in the adjacent cell
   if(g&&y-g.y<=.17)continue;edgeSamples++;
   if(!rails.some(r=>{const dx=r[3]-r[0],dz=r[5]-r[2],f=Math.max(0,Math.min(1,((x-r[0])*dx+(z-r[2])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-r[0]-dx*f,z-r[2]-dz*f)<.22&&Math.abs(y-r[1]-(r[4]-r[1])*f)<.1&&r[6]>=.65;})){unguarded++;if(unguardedPoints.length<20)unguardedPoints.push([x,y,z,g?.y]);}
  }
 }
 const raised=new Set(structures.flatMap(s=>s.roads).map(id=>'surface:'+id)),edgeLayers=new Map();
 for(let i=0;i<t.edges.length;i+=10)edgeLayers.set(t.edges[i],{layer:t.edgeLayers[i/10],surface:m.ids[t.edges[i+9]]});
 for(let i=0;i<t.anchors.length;i+=5){const edge=edgeLayers.get(t.anchors[i+2]);if(!edge||edge.layer!==0||raised.has(edge.surface))unsafeAnchors++;}
 const visible=m.meshes.some(mesh=>mesh.userData?.bridgeGuard);
 return {passed:!unguarded&&!blocked&&!unsafeAnchors&&(!edgeSamples||visible&&rails.length>0),edgeSamples,unguarded,unguardedPoints,clearanceSamples,blocked,minClearance:Number.isFinite(minClearance)?minClearance:null,unsafeAnchors,visible,rails:rails.length};
}
