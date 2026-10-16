#!/usr/bin/env node
// Deterministic inland bundle. No coastal flattening, invented switchbacks or grade cap.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {boundaryRing,inside,publicRoad,sideStreetExits} from './neighbourhood.mjs';
import {psychikoSection} from '../../../src/maps/psychiko-streets.js';
import {buildPsychikoScenery} from './scenery.mjs';
import {inject} from '../../inject-speed-signs.mjs';
import {extractRoadNetwork} from '../../build-road-network.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..'),out=path.join(root,'data/maps/psychiko');
fs.mkdirSync(out,{recursive:true});
const load=n=>{const p=path.join(dir,'raw',n+'.json');return JSON.parse(fs.existsSync(p)?fs.readFileSync(p):gunzipSync(fs.readFileSync(p+'.gz')));};
const R=load('route'),dem=load('dem'),ed=load('route-dem'),osm=load('osm').elements;
const {proj,step,x:X,z:Z}=R,N=X.length;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),r=v=>+v.toFixed(2);
const P=n=>[(n.lon-proj.lon0)*proj.mlon,-(n.lat-proj.lat0)*proj.mlat];
function demAt(x,z){const fx=clamp((x-dem.x0)/dem.step,0,dem.nx-1.0001),fz=clamp((z-dem.z0)/dem.step,0,dem.nz-1.0001),i=Math.floor(fx),j=Math.floor(fz),a=fx-i,b=fz-j;return (dem.h[j*dem.nx+i]*(1-a)+dem.h[j*dem.nx+i+1]*a)*(1-b)+(dem.h[(j+1)*dem.nx+i]*(1-a)+dem.h[(j+1)*dem.nx+i+1]*a)*b;}
function smooth(A,sigma){const rad=Math.ceil(sigma*3);return A.map((_,i)=>{let sum=0,w=0;for(let k=-rad;k<=rad;k++){const q=Math.exp(-k*k/(2*sigma*sigma));sum+=A[clamp(i+k,0,A.length-1)]*q;w+=q;}return sum/w;});}
// Direct 25m-source DEM requests at24m stations, linearly interpolated and smoothed120m. This suppresses DEM cliff/canopy jumps at road cuts; see SOURCES.md.
let j=0;const Yraw=X.map((_,i)=>{const s=i*step;while(j<ed.length-2&&ed[j+1].s<s)j++;const a=ed[j],b=ed[j+1],t=clamp((s-a.s)/(b.s-a.s),0,1);return a.elevation+(b.elevation-a.elevation)*t;});
const periodic=Yraw.slice(0,-1),Y=periodic.map((_,i)=>{let sum=0,w=0;for(let k=-90;k<=90;k++){const q=Math.exp(-k*k/(2*30*30));sum+=periodic[(i+k+periodic.length)%periodic.length]*q;w+=q;}return r(sum/w);});Y.push(Y[0]);
const buckets=new Map(),C=80;
for(let i=0;i<N;i++){const key=`${Math.floor(X[i]/C)},${Math.floor(Z[i]/C)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);}
function nearest(x,z,max=600){const cx=Math.floor(x/C),cz=Math.floor(z/C);let bi=-1,bd=max*max;for(let k=0;k<=Math.ceil(max/C);k++){for(let a=-k;a<=k;a++)for(let b=-k;b<=k;b++){if(Math.max(Math.abs(a),Math.abs(b))!==k)continue;for(const i of buckets.get(`${cx+a},${cz+b}`)||[]){const d=(x-X[i])**2+(z-Z[i])**2;if(d<bd){bd=d;bi=i;}}}if(bi>=0&&Math.sqrt(bd)<(k-.5)*C)break;}if(bi<0)return null;const a=Math.max(0,bi-1),b=Math.min(N-1,bi+1),dx=X[b]-X[a],dz=Z[b]-Z[a],l=Math.hypot(dx,dz)||1;return{i:bi,s:bi*step,d:Math.sqrt(bd),u:(x-X[bi])*-dz/l+(z-Z[bi])*dx/l};}
const nodes=new Map(osm.filter(e=>e.type==='node').map(e=>[e.id,e]));
const geometry=w=>(w.geometry||w.nodes?.map(id=>nodes.get(id))||[]).filter(Boolean).map(P);
const areas=Object.fromEntries(['beach','lake','pool','scrub','rock','cliff','wood','park','marina','pier','breakwater','parking','golf','pitch','residential','fuel','quarry'].map(k=>[k,[]]));
const boundary=boundaryRing(load('boundaries'),P);
const garden=load('garden-route');
const drawnRing=X.map((x,i)=>[x,Z[i]]);
const buildings=[],sideRoads=[],landmarks=[];
const flatten=ps=>ps.flatMap(p=>p.map(r));
for(const e of osm){const t=e.tags||{};if(e.type==='node')continue;if(e.type!=='way')continue;const ps=geometry(e);if(ps.length<2)continue;
 const center=ps.reduce((s,p)=>[s[0]+p[0]/ps.length,s[1]+p[1]/ps.length],[0,0]);const q=nearest(...center,1800);if(!q)continue;
 if(t.building&&ps.length>3&&(q.d<400||inside(center,boundary)||inside(center,drawnRing))){if(ps.some(p=>nearest(...p,15)?.d<8))continue;const k=t.building==='church'?'church':!['apartments','commercial','retail','school'].includes(t.building)?'villa':'apt';const pick=((Math.imul(e.id,2654435761)>>>0)%1000)/1000;const lv=+t['building:levels']||(pick<.67?2:3);buildings.push({p:flatten(ps.slice(0,-1)),h:+t.height||lv*3.1,lv,k:k==='villa'&&pick>.65?'apt':k,pitched:k!=='church'&&pick<.45,s:q.s,u:r(q.u),id:e.id,name:t['name:en']||t.name});if(k==='church')landmarks.push({id:e.id,kind:'church',p:flatten(ps),name:t.name});}
 let cls=t.landuse==='quarry'?'quarry':t.natural==='wood'||t.landuse==='forest'?'wood':t.natural==='scrub'||t.natural==='heath'?'scrub':t.natural==='bare_rock'||t.natural==='scree'?'rock':t.landuse==='residential'?'residential':t.amenity==='parking'?'parking':t.leisure==='park'||t.landuse==='village_green'?'park':null;
 if(cls&&ps.length>3){const a={p:flatten(ps),c:e.nodes?.[0]===e.nodes?.at(-1)?1:0,id:e.id};areas[cls].push(a);if(cls==='quarry')areas.rock.push(a);}
 if(t.highway&&!R.sourceWayIds.includes(e.id)&&q.d<380&&['secondary','tertiary','unclassified','residential','service'].includes(t.highway)&&!['dirt','gravel','unpaved','ground'].includes(t.surface)){sideRoads.push({id:e.id,p:flatten(ps),w:t.highway==='secondary'?6.6:4.5,f:0,n:t['int_name']||t['name:en']||t.name});}
}
// Rasterise source land cover and bilinearly upsample the actual DEM.10m grid improves road cutting,
// not the original DEM's geographic resolution (25m source,100m cached terrain samples).
const T=10,minX=Math.max(dem.x0,Math.floor((Math.min(...X)-1800)/T)*T),maxX=Math.min(dem.x0+(dem.nx-1)*dem.step,Math.ceil((Math.max(...X)+1800)/T)*T),minZ=Math.max(dem.z0,Math.floor((Math.min(...Z)-1800)/T)*T),maxZ=Math.min(dem.z0+(dem.nz-1)*dem.step,Math.ceil((Math.max(...Z)+2200)/T)*T);
const GX=Math.floor((maxX-minX)/T)+1,GZ=Math.floor((maxZ-minZ)/T)+1,H=new Int16Array(GX*GZ),CL=new Uint8Array(GX*GZ).fill(3);
function raster(p,value){let z0=Infinity,z1=-Infinity;for(let k=1;k<p.length;k+=2){z0=Math.min(z0,p[k]);z1=Math.max(z1,p[k]);}for(let j=clamp(Math.ceil((z0-minZ)/T),0,GZ-1);j<=clamp(Math.floor((z1-minZ)/T),0,GZ-1);j++){const z=minZ+j*T,xs=[];for(let a=0,b=p.length-2;a<p.length;b=a,a+=2){const za=p[a+1],zb=p[b+1];if((za>z)!==(zb>z))xs.push(p[a]+(z-za)*(p[b]-p[a])/(zb-za));}xs.sort((a,b)=>a-b);for(let k=0;k+1<xs.length;k+=2)for(let i=clamp(Math.ceil((xs[k]-minX)/T),0,GX-1);i<=clamp(Math.floor((xs[k+1]-minX)/T),0,GX-1);i++)CL[j*GX+i]=value;}}
for(const[k,v]of[['scrub',3],['rock',2],['quarry',2],['residential',4],['wood',6],['park',5]])for(const a of areas[k])if(a.c)raster(a.p,v);
for(let j=0;j<GZ;j++){for(let i=0;i<GX;i++){const x=minX+i*T,z=minZ+j*T,id=j*GX+i;let h=demAt(x,z);const q=nearest(x,z,55);if(q&&q.d<48){const f=clamp((q.d-7)/37,0,1),t=f*f*(3-2*f);h=(Y[q.i]-.25)*(1-t)+h*t;}H[id]=Math.round(h*10);}}
const header=Buffer.alloc(32);header.writeInt32LE(GX,0);header.writeInt32LE(GZ,4);header.writeFloatLE(minX,8);header.writeFloatLE(minZ,12);header.writeFloatLE(T,16);fs.writeFileSync(path.join(out,'terrain.bin'),Buffer.concat([header,Buffer.from(H.buffer),Buffer.from(CL.buffer)]));
const marks=R.stations.map((q,i)=>({id:'station-'+i,name:R.names.findLast(n=>n.s<=q.s)?.name.toUpperCase()||'PSYCHIKO',sub:i?'Palaio Psychiko / Filothei streets':'Start / finish · Diamantidou',s:q.s})).sort((a,b)=>a.s-b.s);
const events=[{id:'psychiko-tt',mapId:'psychiko',name:'PSYCHIKO DRAWN LOOP TT',disabled:true,blurb:'One lap through the drawn neighbourhood loop. Tight roundabouts and neighbourhood avenues against the clock.',type:'timetrial',from:'start',to:'finish',laps:1,rivals:0,traffic:0,targets:{gold:75,silver:65,bronze:55}},{id:'psychiko-race',mapId:'psychiko',name:'PSYCHIKO STREET RACE',blurb:'Two laps against two locals on the user-drawn neighbourhood loop.',type:'sprint',from:'start',to:'finish',laps:2,rivals:2,traffic:0,targets:{gold:1,silver:2,bronze:3}}];
const a=0,b=N-1;let ascent=0,descent=0,maxGrade=0;for(let i=a+1;i<=b;i++){const d=Y[i]-Y[i-1];if(d>0)ascent+=d;else descent-=d;maxGrade=Math.max(maxGrade,Math.abs(d/step));}
const stats={startElevation:Y[a],finishElevation:Y[b],ascent:r(ascent),descent:r(descent),maxGrade:r(maxGrade*100),elevationSource:dem.source};
const data={schema:1,id:'psychiko',name:'PSYCHIKO GARDEN CIRCUIT',type:'circuit',coastal:false,length:R.length,attribution:'Map data © OpenStreetMap contributors (ODbL) · Elevation: EU-DEM v1.1 via OpenTopoData',proj,route:{step,x:X,z:Z,y:Y,width:new Array(N).fill(7),lanes:new Array(N).fill(1),div:new Array(N).fill(0),start:0,finish:R.length,length:R.length,closed:true,streetCircuit:true,from:'Diamantidou',to:'Diamantidou',names:R.names,speeds:[{s:0,v:30}]},marks,zones:[{s:0,urban:.85,zone:'town'}],parkSpots:[],humps:[],barriers:[],coast:[],buildings,areas,pois:[],furniture:[],places:[],sideRoads,events,psychiko:{stats,sourceWayIds:R.sourceWayIds,orderedWays:R.orderedWays,stations:R.stations,gardenLoop:{length:garden.length,sourceWayIds:garden.sourceWayIds,sourceNodeIds:garden.sourceNodeIds},boundary:boundary.flat()}};
// Real OSM stops; only route-side stops, not nearby stops on a different avenue.
for(const e of osm)if(e.type==='node'&&(e.tags?.highway==='bus_stop'||e.tags?.public_transport==='platform')){const p=P(e),q=nearest(...p,20);if(q)data.furniture.push({t:'bus_stop',s:q.s,u:r(q.u),x:r(p[0]),z:r(p[1]),id:e.id});}

// Cover the entire municipal unit, the drawn loop (including its Filothei extension),
// and the retained original course. Keep private driveways and footpaths out.
const gardenWays=new Set(garden.sourceWayIds);
const publicWays=osm.filter(e=>publicRoad(e)&&geometry(e).some(p=>inside(p,boundary)||inside(p,drawnRing)||nearest(...p,280)||gardenWays.has(e.id)));
const selected=[...nodes.values(),...publicWays];
// Kerb-to-kerb sections from station evidence, blended over 12m for smooth road edges.
const sections=X.map((_,i)=>psychikoSection(data.route,i*step).w);
data.route.width=sections.map((_,i)=>r(Array.from({length:13},(_,k)=>sections[(i+k-6+N-1)%(N-1)]).reduce((a,b)=>a+b,0)/13));
data.route.width[N-1]=data.route.width[0];
// The runtime levels folded carriageways (the hairpin near 4.2 km) with a 14% ramp cap.
// Pre-resolve those conflicts here with gentler 9% easing so the runtime pass is a no-op.
{const {Route}=await import('../../../src/map.js'),y=data.route.y,down=v=>Math.floor(v*100+1e-6)/100;
 for(let pass=0;pass<60;pass++){const conformed=new Route(data.route).Y;let moved=0;
  for(let i=0;i<N;i++){const v=down(conformed[i]);if(v<y[i]){moved=Math.max(moved,y[i]-v);y[i]=v;}}
  for(let i=1;i<N;i++)y[i]=Math.min(y[i],down(y[i-1]+.09*step));
  for(let i=N-2;i>=0;i--)y[i]=Math.min(y[i],down(y[i+1]+.09*step));
  y[0]=y[N-1]=Math.min(y[0],y[N-1]);
  if(moved<.005)break;}}
// Clip 25 m inside the terrain grid so both six-metre shoulders always have ground under them.
data.psychiko.networkBounds=[minX+25,minZ+25,maxX-25,maxZ-25].map(r);
data.roadNetwork=extractRoadNetwork(data,selected,{excludeWays:R.sourceWayIds,radius:1600,bounds:data.psychiko.networkBounds});
data.psychiko.networkWayIds=publicWays.map(w=>w.id);
data.psychiko.sideStreetExits=sideStreetExits(osm,R);
// Closure placement follows each outgoing source arm, beyond the race carriageway.
data.roadworks=data.psychiko.sideStreetExits.map(exit=>{
 const start=P(nodes.get(exit.node));let prev=start,travel=0,chosen=null,placed=false;
 for(const id of exit.path){const end=P(nodes.get(id));const L=Math.hypot(end[0]-prev[0],end[1]-prev[1]);
  for(let d=1;d<=Math.ceil(L);d++){const t=Math.min(1,d/L),x=prev[0]+(end[0]-prev[0])*t,z=prev[1]+(end[1]-prev[1])*t,q=nearest(x,z,100),dx=(end[0]-prev[0])/L,dz=(end[1]-prev[1])/L;
   const i=q?.i||0,a=(i-2+N-1)%(N-1),b=(i+2)%(N-1),tx=X[b]-X[a],tz=Z[b]-Z[a],alignment=Math.abs(dx*tx+dz*tz)/(Math.hypot(tx,tz)||1),hl=exit.width/2+3;
   chosen={id:exit.id,node:exit.node,way:exit.way,x:r(x),z:r(z),dx:r(dx),dz:r(dz),yaw:Math.atan2(dz,-dx),hl,hw:.65};
   if((q?.d??100)>6+hl*alignment&&travel+d>8){placed=true;break;}
  }
  if(placed)break;travel+=L;prev=end;
  if(travel>70)break;
 }
 if(!chosen)throw Error('Missing closure arm '+exit.id);
 // A short slip/roundabout arm may rejoin before a perpendicular barrier fits.
 // Close its mouth along the race edge instead, preserving the full raced lane.
 const q=nearest(chosen.x,chosen.z,120),i=q.i,a=(i-2+N-1)%(N-1),b=(i+2)%(N-1),L=Math.hypot(X[b]-X[a],Z[b]-Z[a]),tx=(X[b]-X[a])/L,tz=(Z[b]-Z[a])/L;
 const crossClear=q.d-chosen.hl*Math.abs(-Math.sin(chosen.yaw)*-tz-Math.cos(chosen.yaw)*tx)-chosen.hw;
 if(crossClear<data.route.width[i]/2+.65){
  const p=P(nodes.get(exit.node)),mouth=nearest(...p,30),m=mouth.i,ma=(m-2+N-1)%(N-1),mb=(m+2)%(N-1),ml=Math.hypot(X[mb]-X[ma],Z[mb]-Z[ma]),mx=(X[mb]-X[ma])/ml,mz=(Z[mb]-Z[ma])/ml;
  const end=P(nodes.get(exit.neighbour)),side=Math.sign((end[0]-p[0])*-mz+(end[1]-p[1])*mx)||1;
  Object.assign(chosen,{x:r(X[m]-mz*side*(data.route.width[m]/2+1.7)),z:r(Z[m]+mx*side*(data.route.width[m]/2+1.7)),yaw:Math.atan2(-mx,-mz),mouth:true});
 }
 return chosen;
});
const scenery=buildPsychikoScenery(data,fs.readFileSync(path.join(out,'terrain.bin')));
data.psychiko.scenery={furniture:scenery.furniture};
fs.writeFileSync(path.join(out,'map.json'),JSON.stringify(data));
inject('psychiko');
fs.writeFileSync(path.join(dir,'raw/profile.json'),JSON.stringify({step,start:R.start,finish:R.finish,raw:Yraw,smoothed:Y,stats}));
console.log(JSON.stringify({length:data.length,stats,GX,GZ,buildings:buildings.length,sideRoads:sideRoads.length,areas:Object.fromEntries(Object.entries(areas).map(([k,v])=>[k,v.length]))},null,2));
