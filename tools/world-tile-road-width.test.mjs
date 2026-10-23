import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldTileRoads} from '../src/world-tile-roads.js';
import {buildTileContactIndex} from '../src/world-tile-contact.js';

// Clip the actual road ribbon at CSR boundaries, like independently owned
// contact patches. A large two-triangle quad would mask the missing-bin bug.
function clip(poly,axis,boundary,greater){
 const output=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],inside=p=>greater?p[axis]>=boundary:p[axis]<=boundary;
  if(inside(a))output.push(a);
  if(inside(a)!==inside(b)){const f=(boundary-a[axis])/(b[axis]-a[axis]);output.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);}
 }
 return output;
}
function setup({x=209.272333781,z=223.969334920,yaw=.379810766936,origin=[0,0],bands=[{offset:0,width:4.8}]}={}){
 const positions=[],triangles=[],layers=[],rx=Math.cos(yaw),rz=-Math.sin(yaw),tx=-Math.sin(yaw),tz=-Math.cos(yaw);
 for(const {offset=0,width,y=0,layer=0,surface=1,flags=1} of bands){
  const ring=[[-8,-width/2],[-8,width/2],[8,width/2],[8,-width/2]].map(([a,b])=>[x+tx*a+rx*(b+offset),z+tz*a+rz*(b+offset)]);
  const minX=Math.floor(Math.min(...ring.map(p=>p[0]))/16),maxX=Math.floor(Math.max(...ring.map(p=>p[0]))/16),minZ=Math.floor(Math.min(...ring.map(p=>p[1]))/16),maxZ=Math.floor(Math.max(...ring.map(p=>p[1]))/16);
  for(let cx=minX;cx<=maxX;cx++)for(let cz=minZ;cz<=maxZ;cz++){
   let polygon=ring;for(const [axis,boundary,greater] of [[0,cx*16,true],[0,(cx+1)*16,false],[1,cz*16,true],[1,(cz+1)*16,false]])polygon=clip(polygon,axis,boundary,greater);
   for(let i=1;i+1<polygon.length;i++){
    const p=[polygon[0],polygon[i],polygon[i+1]],area=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);if(Math.abs(area)<1e-8)continue;
    const start=positions.length/3;for(const [px,pz] of p)positions.push(px,y,pz);triangles.push(start,start+1,start+2,surface,flags);layers.push(layer);
   }
  }
 }
 const tables={contactPositions:new Float32Array(positions),contactTriangles:new Uint32Array(triangles),contactLayers:new Int8Array(layers),finePositions:new Float32Array(),fineTriangles:new Uint32Array()};
 const key=origin.map(v=>v/512).join(','),packet={metadata:{origin:[origin[0],0,origin[1]],ids:['','road','other']},tables,contactIndex:buildTileContactIndex(tables)};
 const stream={tiles:new Map([[key,{state:'active',packet}]]),readyAt:()=>true},roads=new WorldTileRoads(stream);
 roads.graph.edges.set('r',{value:{id:'r',surface:'road',layer:0,flags:0}});
 return {roads,point:{edge:'r',x:x+origin[0],y:0,z:z+origin[1],yaw}};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.0001,`${actual} != ${expected}`);

test('width includes short oblique CSR-corner crossings instead of truncating asphalt',()=>{
 const {roads,point}=setup(),width=roads.width(point,{radius:32,bounded:true});near(width.left,2.4);near(width.right,2.4);near(width.width,4.8);
 const reverse=roads.width({...point,yaw:point.yaw+Math.PI},{radius:32,bounded:true});near(reverse.left,width.right);near(reverse.right,width.left);
});
test('width visits complete bins at negative coordinates and exact grid corners',()=>{
 for(const origin of [[-512,-512],[-512,0],[0,-512]]){const {roads,point}=setup({origin});near(roads.width(point,{radius:32,bounded:true}).width,4.8);}
 for(const yaw of [0,Math.PI/2,Math.PI/4,-Math.PI/4]){const {roads,point}=setup({x:208,z:224,yaw});near(roads.width(point,{radius:32,bounded:true}).width,4.8);}
});
test('width retains surface, layer, height, access flags and contiguous-interval guards',()=>{
 const extras=[{offset:5,width:4.8,layer:1},{offset:5,width:4.8,y:10},{offset:5,width:4.8,surface:2},{offset:5,width:4.8,flags:9},{offset:6,width:4.8}];
 for(const extra of extras){const {roads,point}=setup({bands:[{offset:0,width:4.8},extra]});near(roads.width(point,{radius:32,bounded:true}).width,4.8);}
 const {roads,point}=setup({bands:[{offset:8,width:4.8}]});assert.equal(roads.width(point,{radius:32,bounded:true}),null);
});
test('width preserves bounded radius and rejects invalid radius requests',()=>{
 const {roads,point}=setup();assert.equal(roads.width(point,{radius:1}),null);near(roads.width(point,{radius:1,bounded:true}).width,2);
 for(const radius of [0,-1,32.001,Infinity,NaN])assert.throws(()=>roads.width(point,{radius}),/Invalid road width search radius/);
});
