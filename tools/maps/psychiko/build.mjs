#!/usr/bin/env node
// Deterministic inland bundle. No coastal flattening, invented switchbacks or grade cap.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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
const buildings=[],trees=[],sideRoads=[],landmarks=[];
const flatten=ps=>ps.flatMap(p=>p.map(r));
for(const e of osm){const t=e.tags||{};if(e.type==='node'){if(t.natural==='tree'){const p=P(e),q=nearest(...p,450);if(q)trees.push([r(p[0]),r(p[1]),0]);}continue;}if(e.type!=='way')continue;const ps=geometry(e);if(ps.length<2)continue;
 const center=ps.reduce((s,p)=>[s[0]+p[0]/ps.length,s[1]+p[1]/ps.length],[0,0]);const q=nearest(...center,1800);if(!q)continue;
 if(t.building&&ps.length>3&&q.d<260){if(ps.some(p=>nearest(...p,15)?.d<8))continue;const k=t.building==='church'?'church':!['apartments','commercial','retail','school'].includes(t.building)?'villa':'apt';const lv=+t['building:levels']||2;buildings.push({p:flatten(ps.slice(0,-1)),h:+t.height||lv*3.1,lv,k,s:q.s,u:r(q.u),id:e.id,name:t['name:en']||t.name});if(k==='church')landmarks.push({id:e.id,kind:'church',p:flatten(ps),name:t.name});}
 let cls=t.landuse==='quarry'?'quarry':t.natural==='wood'||t.landuse==='forest'?'wood':t.natural==='scrub'||t.natural==='heath'?'scrub':t.natural==='bare_rock'||t.natural==='scree'?'rock':t.landuse==='residential'?'residential':t.amenity==='parking'?'parking':t.leisure==='park'||t.landuse==='village_green'?'park':null;
 if(cls&&ps.length>3){const a={p:flatten(ps),c:e.nodes?.[0]===e.nodes?.at(-1)?1:0,id:e.id};areas[cls].push(a);if(cls==='quarry')areas.rock.push(a);}
 if(t.highway&&!R.sourceWayIds.includes(e.id)&&q.d<380&&['secondary','tertiary','unclassified','residential','service'].includes(t.highway)&&!['dirt','gravel','unpaved','ground'].includes(t.surface)){sideRoads.push({id:e.id,p:flatten(ps),w:t.highway==='secondary'?6.6:4.5,f:0,n:t['int_name']||t['name:en']||t.name});}
}
// Rasterise source land cover and bilinearly upsample the actual DEM.10m grid improves road cutting,
// not the original DEM's geographic resolution (25m source,100m cached terrain samples).
const T=10,minX=Math.max(dem.x0,Math.floor((Math.min(...X)-1800)/T)*T),maxX=Math.min(dem.x0+(dem.nx-1)*dem.step,Math.ceil((Math.max(...X)+1800)/T)*T),minZ=Math.max(dem.z0,Math.floor((Math.min(...Z)-1800)/T)*T),maxZ=Math.min(dem.z0+(dem.nz-1)*dem.step,Math.ceil((Math.max(...Z)+2200)/T)*T);
const GX=Math.floor((maxX-minX)/T)+1,GZ=Math.floor((maxZ-minZ)/T)+1,H=new Int16Array(GX*GZ),CL=new Uint8Array(GX*GZ).fill(3);
function raster(p,value){let z0=Infinity,z1=-Infinity;for(let k=1;k<p.length;k+=2){z0=Math.min(z0,p[k]);z1=Math.max(z1,p[k]);}for(let j=clamp(Math.ceil((z0-minZ)/T),0,GZ-1);j<=clamp(Math.floor((z1-minZ)/T),0,GZ-1);j++){const z=minZ+j*T,xs=[];for(let a=0,b=p.length-2;a<p.length;b=a,a+=2){const za=p[a+1],zb=p[b+1];if((za>z)!==(zb>z))xs.push(p[a]+(z-za)*(p[b]-p[a])/(zb-za));}xs.sort((a,b)=>a-b);for(let k=0;k+1<xs.length;k+=2)for(let i=clamp(Math.ceil((xs[k]-minX)/T),0,GX-1);i<=clamp(Math.floor((xs[k+1]-minX)/T),0,GX-1);i++)CL[j*GX+i]=value;}}
for(const[k,v]of[['wood',6],['residential',4],['scrub',3],['rock',2],['quarry',2]])for(const a of areas[k])if(a.c)raster(a.p,v);
for(let j=0;j<GZ;j++){for(let i=0;i<GX;i++){const x=minX+i*T,z=minZ+j*T,id=j*GX+i;let h=demAt(x,z);const q=nearest(x,z,55);if(q&&q.d<48){const f=clamp((q.d-7)/37,0,1),t=f*f*(3-2*f);h=(Y[q.i]-.25)*(1-t)+h*t;}H[id]=Math.round(h*10);}}
const header=Buffer.alloc(32);header.writeInt32LE(GX,0);header.writeInt32LE(GZ,4);header.writeFloatLE(minX,8);header.writeFloatLE(minZ,12);header.writeFloatLE(T,16);fs.writeFileSync(path.join(out,'terrain.bin'),Buffer.concat([header,Buffer.from(H.buffer),Buffer.from(CL.buffer)]));
const marks=[{id:'pavlou',name:'VASILEOS PAVLOU',sub:'Start / finish · Palaio Psychiko',s:0},{id:'diamantidou',name:'DIAMANTIDOU',sub:'Garden avenue · Venizelou roundabout',s:R.stations[1].s},{id:'malakasi',name:'MALAKASI',sub:'Upper villa quarter',s:R.stations[2].s},{id:'kallari',name:'STRATIGOU KALLARI',sub:'Pine-lined residential bends',s:R.stations[3].s},{id:'kyprou',name:'KYPROU',sub:'Return to Vasileos Pavlou',s:R.stations[4].s}];
const events=[{id:'psychiko-tt',mapId:'psychiko',name:'PSYCHIKO GARDEN LAP',blurb:'One lap through the real garden-suburb streets. Tight roundabouts and leafy avenues against the clock.',type:'timetrial',from:'start',to:'finish',laps:1,rivals:0,traffic:0,targets:{gold:75,silver:65,bronze:55}},{id:'psychiko-race',mapId:'psychiko',name:'PSYCHIKO STREET RACE',blurb:'Two laps against three locals on the closed garden-street loop.',type:'sprint',from:'start',to:'finish',laps:2,rivals:3,traffic:0,targets:{gold:1,silver:2,bronze:3}}];
const a=0,b=N-1;let ascent=0,descent=0,maxGrade=0;for(let i=a+1;i<=b;i++){const d=Y[i]-Y[i-1];if(d>0)ascent+=d;else descent-=d;maxGrade=Math.max(maxGrade,Math.abs(d/step));}
const stats={startElevation:Y[a],finishElevation:Y[b],ascent:r(ascent),descent:r(descent),maxGrade:r(maxGrade*100),elevationSource:dem.source};
const data={schema:1,id:'psychiko',name:'PSYCHIKO GARDEN CIRCUIT',type:'circuit',coastal:false,length:R.length,attribution:'Map data © OpenStreetMap contributors (ODbL) · Elevation: EU-DEM v1.1 via OpenTopoData',proj,route:{step,x:X,z:Z,y:Y,width:new Array(N).fill(7),lanes:new Array(N).fill(1),div:new Array(N).fill(0),start:0,finish:R.length,length:R.length,closed:true,streetCircuit:true,from:'Vasileos Pavlou',to:'Vasileos Pavlou',names:R.names,speeds:[{s:0,v:30}]},marks,zones:[{s:0,urban:.85,zone:'town'}],parkSpots:[],humps:[],barriers:[],coast:[],buildings,areas,trees,pois:[],furniture:[],places:[],sideRoads,events,psychiko:{stats,sourceWayIds:R.sourceWayIds,orderedWays:R.orderedWays,stations:R.stations}};
// Real OSM stops; only route-side stops, not nearby stops on a different avenue.
for(const e of osm)if(e.type==='node'&&(e.tags?.highway==='bus_stop'||e.tags?.public_transport==='platform')){const p=P(e),q=nearest(...p,20);if(q)data.furniture.push({t:'bus_stop',s:q.s,u:r(q.u),x:r(p[0]),z:r(p[1]),id:e.id});}

data.roadNetwork=extractRoadNetwork(data,osm,{excludeWays:R.sourceWayIds,radius:300});
fs.writeFileSync(path.join(out,'map.json'),JSON.stringify(data));
fs.writeFileSync(path.join(dir,'raw/profile.json'),JSON.stringify({step,start:R.start,finish:R.finish,raw:Yraw,smoothed:Y,stats}));
console.log(JSON.stringify({length:data.length,stats,GX,GZ,buildings:buildings.length,sideRoads:sideRoads.length,areas:Object.fromEntries(Object.entries(areas).map(([k,v])=>[k,v.length]))},null,2));
