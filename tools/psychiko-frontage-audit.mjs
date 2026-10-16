// Source/renderer comparison; frozen OSM is the independent geographic reference.
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {buildBuildings} from '../src/buildings.js';
import {Route} from '../src/map.js';
export const FRONTAGE_SAMPLES = [
 {id:423843655,street:'Sismanoglou'},
 {id:307559043,street:'Bizaniou'},
 {id:308022552,street:'Davaki'},
];
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function centroid(p){let area=0,x=0,z=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],c=a[0]*b[1]-b[0]*a[1];area+=c;x+=(a[0]+b[0])*c;z+=(a[1]+b[1])*c;}return [x/(3*area),z/(3*area)];}
function pointSegment(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);}
function distance(a,b,c,d){if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));}
function nearestEdge(edges,road){let best=Infinity;for(const [a,b]of edges)for(let i=1;i<road.length;i++)best=Math.min(best,distance(a,b,road[i-1],road[i]));return best;}
export function frontageAudit(root=new URL('../',import.meta.url)){
 const data=JSON.parse(readFileSync(new URL('data/maps/psychiko/map.json',root))),route=new Route(data.route);
 const raw=JSON.parse(gunzipSync(readFileSync(new URL('tools/maps/psychiko/raw/osm.json.gz',root)))).elements;
 const nodes=new Map(raw.filter(e=>e.type==='node').map(n=>[n.id,n]));
 const project=n=>[(n.lon-data.proj.lon0)*data.proj.mlon,-(n.lat-data.proj.lat0)*data.proj.mlat];
 const road=data.route.x.map((x,i)=>[x,data.route.z[i]]);
 return FRONTAGE_SAMPLES.map(sample=>{
  const source=raw.find(e=>e.type==='way'&&e.id===sample.id),p=source.nodes.slice(0,-1).map(id=>project(nodes.get(id))),center=centroid(p);
  const building=data.buildings.find(b=>b.id===sample.id);if(!building)return {...sample,missing:true};
  const scene=new THREE.Group(),blocks=buildBuildings({data:{buildings:[building]}},scene,()=>100),edges=new Map();let area=0,x=0,z=0;
  blocks.group.updateMatrixWorld(true);
  blocks.group.traverse(mesh=>{if(!mesh.isMesh)return;const g=mesh.geometry,pos=g.attributes.position,normal=g.attributes.normal,index=g.index;
   for(let k=0;k<(index?.count??pos.count);k+=3){const ids=[0,1,2].map(i=>index?index.getX(k+i):k+i);if(ids.some(i=>normal.getY(i)<.99))continue;
    const points=ids.map(i=>{const v=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);return [v.x,v.z];}),a=Math.abs(cross(...points))/2;
    area+=a;x+=a*points.reduce((s,p)=>s+p[0]/3,0);z+=a*points.reduce((s,p)=>s+p[1]/3,0);
    for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3],key=[a.map(v=>v.toFixed(4)).join(','),b.map(v=>v.toFixed(4)).join(',')].sort().join(':');const e=edges.get(key);if(e)e.count++;else edges.set(key,{count:1,a,b});}
   }
  });
  const rendered=[x/area,z/area],boundary=[...edges.values()].filter(e=>e.count===1).map(e=>[e.a,e.b]);
  const sourceEdges=p.map((a,i)=>[a,p[(i+1)%p.length]]),sourceDistance=nearestEdge(sourceEdges,road),boxDistance=nearestEdge(boundary,road),s=route.project(...center).s;
  const row={...sample,missing:false,sourceCentroid:center,boxCentroid:rendered,centroidError:Math.hypot(center[0]-rendered[0],center[1]-rendered[1]),sourceNearestEdge:sourceDistance,boxNearestEdge:boxDistance,nearestEdgeError:Math.abs(sourceDistance-boxDistance),sourceKerbDistance:sourceDistance-route.edge(s)-.55,boxKerbDistance:boxDistance-route.edge(s)-.55,s};
  blocks.group.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});return row;
 });
}
