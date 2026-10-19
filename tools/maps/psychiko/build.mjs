#!/usr/bin/env node
// Deterministic inland bundle. No coastal flattening, invented switchbacks or grade cap.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {boundaryRing,inside,municipalLength,publicRoad,sideStreetExits} from './neighbourhood.mjs';
import {psychikoSection} from '../../../src/maps/psychiko-streets.js';
import {buildPsychikoScenery} from './scenery.mjs';
import {psychikoWayClass} from './street-classes.mjs';
import {inject} from '../../inject-speed-signs.mjs';
import {routeRoundabouts,roundaboutLoops} from '../../roundabouts.mjs';
import {extractRoadNetwork} from '../../build-road-network.mjs';
import {arterialRecords} from './arterial.mjs';
import {loadPsychikoOsm} from './corrections.mjs';
import {multipolygons,footprintPieces} from './multipolygon.mjs';
import {readCopernicus,copernicusField,roundaboutPlanes,plannedHeight,gridExtent} from './elevation.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..'),out=path.join(root,'data/maps/psychiko');
fs.mkdirSync(out,{recursive:true});
const load=n=>{const p=path.join(dir,'raw',n+'.json');return JSON.parse(fs.existsSync(p)?fs.readFileSync(p):gunzipSync(fs.readFileSync(p+'.gz')));};
const R=load('route'),osm=loadPsychikoOsm();
const {proj,step,x:X,z:Z}=R,N=X.length;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),r=v=>+v.toFixed(2);
const P=n=>[(n.lon-proj.lon0)*proj.mlon,-(n.lat-proj.lat0)*proj.mlat];
// One Copernicus GLO-30 height field (sigma-20 m Gaussian, roundabout planes) for the lap, every
// side road, junction and roundabout, and the terrain grid. No along-route smoothing or grade cap.
const field=copernicusField(readCopernicus(path.join(dir,'raw/copernicus.json.gz')),proj),dem=gridExtent(proj);
const heightAt=plannedHeight(field,roundaboutPlanes(roundaboutLoops(osm,P),field));
// A real street eases into a junction turn with a vertical curve: where the lap turns from a contour street
// straight up a hill the field profile would otherwise kink within 2 m. Fair it with a sigma-12 m along-lap
// Gaussian, held within 0.15 m of the field so side streets still meet the lap at their own height.
const Yraw=X.map((x,i)=>field.raw(x,Z[i])),Yfield=X.map((x,i)=>heightAt(x,Z[i])).slice(0,-1),SV=12/step,KV=Math.ceil(3*SV);
const Y=Yfield.map((h,i)=>{let sum=0,w=0;for(let k=-KV;k<=KV;k++){const q=Math.exp(-k*k/(2*SV*SV));sum+=Yfield[(i+k+Yfield.length)%Yfield.length]*q;w+=q;}return r(h+clamp(sum/w-h,-.15,.15));});Y.push(Y[0]);
const buckets=new Map(),C=80;
for(let i=0;i<N;i++){const key=`${Math.floor(X[i]/C)},${Math.floor(Z[i]/C)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);}
function nearest(x,z,max=600){const cx=Math.floor(x/C),cz=Math.floor(z/C);let bi=-1,bd=max*max;for(let k=0;k<=Math.ceil(max/C);k++){for(let a=-k;a<=k;a++)for(let b=-k;b<=k;b++){if(Math.max(Math.abs(a),Math.abs(b))!==k)continue;for(const i of buckets.get(`${cx+a},${cz+b}`)||[]){const d=(x-X[i])**2+(z-Z[i])**2;if(d<bd){bd=d;bi=i;}}}if(bi>=0&&Math.sqrt(bd)<(k-.5)*C)break;}if(bi<0)return null;const a=Math.max(0,bi-1),b=Math.min(N-1,bi+1),dx=X[b]-X[a],dz=Z[b]-Z[a],l=Math.hypot(dx,dz)||1;return{i:bi,s:bi*step,d:Math.sqrt(bd),u:(x-X[bi])*-dz/l+(z-Z[bi])*dx/l};}
const nodes=new Map(osm.filter(e=>e.type==='node').map(e=>[e.id,e]));
const geometry=w=>(w.geometry||w.nodes?.map(id=>nodes.get(id))||[]).filter(Boolean).map(P);
// Each lap sample takes the surveyed class of its nearest raced OSM way (raw/street-classes.json). Route names gain that
// class as `k` and split where a mixed way changes class; runs under 20 m (junction fillets) join the previous run.
const routeNames=(()=>{const ways=[...new Set(R.orderedWays.map(w=>w.id))].map(id=>({id,p:geometry(osm.find(e=>e.type==='way'&&e.id===id))}));
 const seg=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);};
 const cls=X.map((x,i)=>{let best=null,d=Infinity;for(const w of ways)for(let k=1;k<w.p.length;k++){const e=seg(x,Z[i],w.p[k-1],w.p[k]);if(e<d){d=e;best=w.id;}}return psychikoWayClass(best,x,Z[i],proj);});
 for(let i=1,start=0;i<=N;i++)if(i===N||cls[i]!==cls[start]){if((i-start)*step<20&&start>0)cls.fill(cls[start-1],start,i);start=i;}
 const out=[];R.names.forEach((n,j)=>{const end=R.names[j+1]?.s??R.length,first=Math.min(N-1,Math.round((n.s+Math.min(10,(end-n.s)/2))/step));let k=cls[first];out.push({...n,k});
  for(let i=first+1;i*step<end-step&&i<N;i++)if(cls[i]!==k){k=cls[i];out.push({s:r(i*step),name:n.name,k});}});
 return out;})(),classed={length:R.length,names:routeNames};
const areas=Object.fromEntries(['beach','lake','pool','scrub','rock','cliff','wood','park','marina','pier','breakwater','parking','golf','pitch','residential','fuel','quarry'].map(k=>[k,[]]));
const boundary=boundaryRing(load('boundaries'),P);
const garden=load('garden-route');
const drawnRing=X.map((x,i)=>[x,Z[i]]);
const buildings=[],sideRoads=[],landmarks=[];
const flatten=ps=>ps.flatMap(p=>p.map(r));
for(const e of osm){const t=e.tags||{};if(e.type==='node')continue;if(e.type!=='way')continue;const ps=geometry(e);if(ps.length<2)continue;
 const center=ps.reduce((s,p)=>[s[0]+p[0]/ps.length,s[1]+p[1]/ps.length],[0,0]);const q=nearest(...center,1800);if(!q)continue;
 if(t.building&&ps.length>3&&(q.d<400||inside(center,boundary)||inside(center,drawnRing))){// Preserve close OSM fronts. Only omit actual race-carriageway overlaps;
 // the former 8 m centreline exclusion erased legitimate front-garden plots.
 if(ps.some(p=>{const q=nearest(...p,8);return q&&q.d<psychikoSection(classed,q.s).w/2+.05;}))continue;const k=t.building==='church'?'church':!['apartments','commercial','retail','school'].includes(t.building)?'villa':'apt';const pick=((Math.imul(e.id,2654435761)>>>0)%1000)/1000;const lv=+t['building:levels']||(pick<.67?2:3);buildings.push({p:flatten(ps.slice(0,-1)),h:+t.height||lv*3.1,lv,k:k==='villa'&&pick>.65?'apt':k,pitched:k!=='church'&&(t['roof:shape']?t['roof:shape']!=='flat':pick<.45),...(t['roof:shape']==='gabled'?{roof:'gabled'}:{}),s:q.s,u:r(q.u),id:e.id,name:t['name:en']||t.name});if(k==='church')landmarks.push({id:e.id,kind:'church',p:flatten(ps),name:t.name});}
 let cls=t.landuse==='quarry'?'quarry':t.natural==='wood'||t.landuse==='forest'?'wood':t.natural==='scrub'||t.natural==='heath'?'scrub':t.natural==='bare_rock'||t.natural==='scree'?'rock':t.landuse==='residential'?'residential':t.amenity==='parking'?'parking':t.leisure==='park'||t.landuse==='village_green'?'park':null;
 if(cls&&ps.length>3){const a={p:flatten(ps),c:e.nodes?.[0]===e.nodes?.at(-1)?1:0,id:e.id};areas[cls].push(a);if(cls==='quarry')areas.rock.push(a);}
 if(t.highway&&!R.sourceWayIds.includes(e.id)&&q.d<380&&['secondary','tertiary','unclassified','residential','service'].includes(t.highway)&&!['dirt','gravel','unpaved','ground'].includes(t.surface)){sideRoads.push({id:e.id,p:flatten(ps),w:t.highway==='secondary'?6.6:4.5,f:0,n:t['int_name']||t['name:en']||t.name});}
}
// OSM multipolygon relations (raw/relations.json): courtyard and campus buildings, the Stefanou Delta stadium
// and tracks, parks and woods. Courtyards stay open: a holed footprint becomes several <=10-vertex blocks.
for(const mp of multipolygons(load('relations').elements,osm,P)){const t=mp.tags,ps=mp.outer,center=ps.reduce((s,p)=>[s[0]+p[0]/ps.length,s[1]+p[1]/ps.length],[0,0]),q=nearest(...center,1800);if(!q)continue;
 if(t.building&&(q.d<400||inside(center,boundary)||inside(center,drawnRing))&&!ps.some(p=>{const q=nearest(...p,8);return q&&q.d<psychikoSection(R,q.s).w/2+.05;})){
  const k=!['apartments','commercial','retail','school','office','hospital'].includes(t.building)?'villa':'apt',pick=((Math.imul(mp.id,2654435761)>>>0)%1000)/1000,lv=+t['building:levels']||(pick<.67?2:3),pieces=footprintPieces(ps,mp.holes);
  pieces.forEach((piece,part)=>buildings.push({p:flatten(piece),h:+t.height||lv*3.1,lv,k:k==='villa'&&pick>.65?'apt':k,pitched:pieces.length===1&&pick<.45,s:q.s,u:r(q.u),id:mp.id,rel:1,...(pieces.length>1?{part}:{}),name:t['name:en']||t.name}));}
 const cls=t.natural==='wood'||t.landuse==='forest'?'wood':t.landuse==='residential'?'residential':t.leisure==='park'||t.landuse==='village_green'?'park':['stadium','track','pitch'].includes(t.leisure)?'pitch':null;
 if(cls)areas[cls].push({p:flatten(ps),c:1,id:mp.id,rel:1,...(mp.holes.length?{holes:mp.holes.map(flatten)}:{})});
}
// Marks name the streets along the lap (district-style splits and HUD ticks); the timing line is the first.
const plain=name=>name.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase();
const marks=[{id:'start',name:'FAROS',sub:'Start / finish · Faros traffic light',s:0}];
R.names.forEach((n,i)=>{const run=(R.names[i+1]?.s??R.length)-n.s;if(/^Unnamed/.test(n.name)||n.s<150||run<120)return;const name=plain(n.name);if(marks.at(-1).name===name)return;marks.push({id:'street-'+marks.length,name,sub:'Palaio Psychiko streets',s:n.s});});
const events=[{id:'psychiko-tt',mapId:'psychiko',name:'PSYCHIKO FAROS TT',disabled:true,blurb:'One lap from Faros through the squares, the College and Kifisias against the clock.',type:'timetrial',from:'start',to:'finish',laps:1,rivals:0,traffic:0,targets:{gold:75,silver:65,bronze:55}},{id:'psychiko-race',mapId:'psychiko',name:'PSYCHIKO FAROS RACE',blurb:'Two laps from the Faros light, through Psychiko squares and hills, returning on Kifisias.',type:'sprint',from:'start',to:'finish',laps:2,rivals:2,traffic:0,targets:{gold:1,silver:2,bronze:3}}];
const data={schema:1,id:'psychiko',name:'PSYCHIKO FAROS CIRCUIT',type:'circuit',coastal:false,length:R.length,attribution:'Map data © OpenStreetMap contributors (ODbL) · Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA (smoothed)',proj,route:{step,x:X,z:Z,y:Y,width:new Array(N).fill(7),lanes:new Array(N).fill(1),div:new Array(N).fill(0),start:0,finish:R.length,length:R.length,closed:true,streetCircuit:true,from:'Faros',to:'Faros',names:routeNames,speeds:[{s:0,v:30}]},marks,zones:[{s:0,urban:.85,zone:'town'}],parkSpots:[],humps:[],barriers:[],coast:[],buildings,areas,pois:[],furniture:[],places:[],sideRoads,events,psychiko:{sourceWayIds:R.sourceWayIds,orderedWays:R.orderedWays,stations:R.stations,gardenLoop:{length:garden.length,sourceWayIds:garden.sourceWayIds,sourceNodeIds:garden.sourceNodeIds},boundary:boundary.flat()}};
// Real OSM stops; only route-side stops, not nearby stops on a different avenue.
for(const e of osm)if(e.type==='node'&&(e.tags?.highway==='bus_stop'||e.tags?.public_transport==='platform')){const p=P(e),q=nearest(...p,20);if(q)data.furniture.push({t:'bus_stop',s:q.s,u:r(q.u),x:r(p[0]),z:r(p[1]),id:e.id});}

// Cover the entire municipal unit, the drawn loop (including its Filothei extension),
// and the retained original course. Keep private driveways and footpaths out.
const gardenWays=new Set(garden.sourceWayIds);
// Municipal ways also count by clipped length, so streets running exactly along the edge are not missed.
const publicWays=osm.filter(e=>{if(!publicRoad(e))return false;const ps=geometry(e);return R.sourceWayIds.includes(e.id)||gardenWays.has(e.id)||(/Kifisias|Paraplefri Odos/.test(e.tags.int_name||'')&&ps.some(p=>p[1]>-1400&&p[1]<1300))||ps.some(p=>inside(p,boundary)||inside(p,drawnRing)||nearest(...p,280))||municipalLength(ps,boundary)>2;});
const selected=[...nodes.values(),...publicWays];
// Kerb-to-kerb sections from station evidence, blended over 12m for smooth road edges.
const sections=X.map((_,i)=>psychikoSection(data.route,i*step).w);
data.route.width=sections.map((_,i)=>r(Array.from({length:13},(_,k)=>sections[(i+k-6+N-1)%(N-1)]).reduce((a,b)=>a+b,0)/13));
data.route.width[N-1]=data.route.width[0];
const T=10,minX=Math.max(dem.x0,Math.floor((Math.min(...X)-1800)/T)*T),maxX=Math.min(dem.x0+(dem.nx-1)*dem.step,Math.ceil((Math.max(...X)+1800)/T)*T),minZ=Math.max(dem.z0,Math.floor((Math.min(...Z)-1800)/T)*T),maxZ=Math.min(dem.z0+(dem.nz-1)*dem.step,Math.ceil((Math.max(...Z)+2200)/T)*T);
// Clip 25 m inside the terrain grid so both six-metre shoulders always have ground under them.
data.psychiko.networkBounds=[minX+25,minZ+25,maxX-25,maxZ-25].map(r);
// Oncoming civilians use a legal reverse plan only if it stays within 60 m of the lap: shared-world snapshots
// carry road-space s/u, which cannot place a car on a long detour. Without a plan the ring is forward-only.
data.route.roundabouts=routeRoundabouts(data.route,roundaboutLoops(selected,P)).map(r=>{const plan=R.trafficRoundabouts.find(q=>q.id===r.id&&q.path.every(p=>(nearest(...p,600)?.d??Infinity)<30));
 // The reverse arm of a roundabout beside the timing line straddles the lap seam: express it with s1 past the lap length.
 return {...r,reverse:plan&&{...plan,s1:plan.s0>plan.s1?plan.s1+R.length:plan.s1}};});
for(const r of data.route.roundabouts)for(let i=Math.floor(r.s0/step);i<=Math.ceil(r.s1/step);i++)data.route.width[i]=Math.min(data.route.width[i],r.w);
// Civilian traffic may only run with the lap on its one-way source streets. Rings whose oncoming arms have
// a legal reverse plan are driven by that plan instead; Areaki has none, so its ring stays forward-only too.
{const wayById=new Map(osm.filter(e=>e.type==='way').map(w=>[w.id,w])),planned=new Set(data.route.roundabouts.filter(q=>q.reverse).flatMap(q=>roundaboutLoops(selected,P).find(l=>l.id===q.id)?.ways||[]));
 const forward=t=>t.junction==='roundabout'||['yes','1','true','-1'].includes(t.oneway),at=id=>nearest(...P(nodes.get(id)),30).s,spans=[];
 for(const w of R.orderedWays){if(!forward(wayById.get(w.id).tags)||planned.has(w.id))continue;const a=at(w.from),b=at(w.to);if(b>=a)spans.push([a,b]);else spans.push([a,R.length],[0,b]);}
 spans.sort((p,q)=>p[0]-q[0]);data.route.oneway=[];for(const[a,b]of spans){const last=data.route.oneway.at(-1);if(last&&a<=last[1]+1)last[1]=Math.max(last[1],b);else data.route.oneway.push([a,b]);}
 data.route.oneway=data.route.oneway.map(p=>p.map(r));}
// The runtime caps 2 m grades at 14% (and levels genuinely folded carriageway edges).
// Own that pass here, before the terrain is cut, so the shipped profile and terrain already agree with it.
{const {Route}=await import('../../../src/map.js'),y=data.route.y,down=v=>Math.floor(v*100+1e-6)/100;
 for(let pass=0;pass<60;pass++){const conformed=new Route(data.route).Y;let moved=0;
  for(let i=0;i<N;i++){const v=down(conformed[i]);if(v<y[i]){moved=Math.max(moved,y[i]-v);y[i]=v;}}
  y[0]=y[N-1]=Math.min(y[0],y[N-1]);
  if(moved<.005)break;}}
// Rasterise source land cover and sample the shared height field. The 10 m grid
// improves road cutting, not the ~30 m Copernicus source resolution.
const GX=Math.floor((maxX-minX)/T)+1,GZ=Math.floor((maxZ-minZ)/T)+1,H=new Int16Array(GX*GZ),CL=new Uint8Array(GX*GZ).fill(3);
function raster(outer,value,holes=[]){const p=outer;let z0=Infinity,z1=-Infinity;for(let k=1;k<p.length;k+=2){z0=Math.min(z0,p[k]);z1=Math.max(z1,p[k]);}for(let j=clamp(Math.ceil((z0-minZ)/T),0,GZ-1);j<=clamp(Math.floor((z1-minZ)/T),0,GZ-1);j++){const z=minZ+j*T,xs=[];for(const p of [outer,...holes])for(let a=0,b=p.length-2;a<p.length;b=a,a+=2){const za=p[a+1],zb=p[b+1];if((za>z)!==(zb>z))xs.push(p[a]+(z-za)*(p[b]-p[a])/(zb-za));}xs.sort((a,b)=>a-b);for(let k=0;k+1<xs.length;k+=2)for(let i=clamp(Math.ceil((xs[k]-minX)/T),0,GX-1);i<=clamp(Math.floor((xs[k+1]-minX)/T),0,GX-1);i++)CL[j*GX+i]=value;}}
for(const[k,v]of[['scrub',3],['rock',2],['quarry',2],['residential',4],['wood',6],['park',5],['pitch',5]])for(const a of areas[k])if(a.c)raster(a.p,v,a.holes);
// The street bed is level with the lap across its kerbs and footways. Beyond them the ground keeps the
// field's own cross-slope; only the small offset at the footway edge decays over 35 m, so side streets
// and verges do not get squeezed into a steep ramp beside the lap.
for(let j=0;j<GZ;j++){for(let i=0;i<GX;i++){const x=minX+i*T,z=minZ+j*T,id=j*GX+i;let h=heightAt(x,z);const q=nearest(x,z,75);
 if(q){const e=data.route.width[q.i]/2+3,bed=Y[q.i]-.25;if(q.d<=e)h=bed;else if(q.d<e+60){const a=Math.max(0,q.i-1),b=Math.min(N-1,q.i+1),l=Math.hypot(X[b]-X[a],Z[b]-Z[a])||1,side=Math.sign(q.u)||1;
  const off=bed-heightAt(X[q.i]-(Z[b]-Z[a])/l*side*e,Z[q.i]+(X[b]-X[a])/l*side*e),f=(q.d-e)/60,t=f*f*(3-2*f);h+=off*(1-t);}}
 H[id]=Math.round(h*10);}}
const header=Buffer.alloc(32);header.writeInt32LE(GX,0);header.writeInt32LE(GZ,4);header.writeFloatLE(minX,8);header.writeFloatLE(minZ,12);header.writeFloatLE(T,16);fs.writeFileSync(path.join(out,'terrain.bin'),Buffer.concat([header,Buffer.from(H.buffer),Buffer.from(CL.buffer)]));
const a=0,b=N-1;let ascent=0,descent=0,maxGrade=0;for(let i=a+1;i<=b;i++){const d=Y[i]-Y[i-1];if(d>0)ascent+=d;else descent-=d;maxGrade=Math.max(maxGrade,Math.abs(d/step));}
const stats={startElevation:Y[a],finishElevation:Y[b],ascent:r(ascent),descent:r(descent),maxGrade:r(maxGrade*100),elevationSource:'Copernicus DEM GLO-30 (2021) AWS COG, EGM2008; sigma-20 m spatial Gaussian, roundabout planes'};
data.psychiko.stats=stats;
data.roadNetwork=extractRoadNetwork(data,selected,{excludeWays:R.sourceWayIds,radius:1600,bounds:data.psychiko.networkBounds});
data.psychiko.networkWayIds=publicWays.map(w=>w.id);
// One-way guidance: every legal entry arm of each ring (and of mini-roundabout 351945852) gets a P-1/P-40 sign
// and a give-way line; the runtime paints CCW arrows on the ring. Gated Athens College drive 31270034 is left alone.
{const GATED=new Set([31270034]),isRing=new Set(roundaboutLoops(selected,P).flatMap(l=>l.ways)),toward=(w,k,j)=>{const t=w.tags;if(t.oneway==='-1')return j>k;if(['yes','1','true'].includes(t.oneway))return j<k;return true;};
 const arms=(nodeIds,skip)=>{const out=[];for(const w of publicWays){if(skip.has(w.id)||isRing.has(w.id))continue;w.nodes.forEach((n,k)=>{if(!nodeIds.has(n))return;for(const j of [k-1,k+1]){const m=w.nodes[j];if(m===undefined||!toward(w,k,j))continue;
  const a=P(nodes.get(n)),b=P(nodes.get(m)),L=Math.hypot(b[0]-a[0],b[1]-a[1]);out.push({node:n,way:w.id,x:r(a[0]),z:r(a[1]),dx:r((b[0]-a[0])/L),dz:r((b[1]-a[1])/L),oneway:['yes','1','true','-1'].includes(w.tags.oneway)?1:0});}});}return out;};
 data.psychiko.roundaboutGuidance=data.roadNetwork.roundabouts.filter(q=>!GATED.has(q.id)).map(q=>{const loop=roundaboutLoops(selected,P).find(l=>l.id===q.id);return{id:q.id,entries:arms(new Set(loop.nodes),new Set(loop.ways))};});
 data.psychiko.miniRoundabouts=osm.filter(e=>e.type==='node'&&e.tags?.highway==='mini_roundabout'&&inside(P(e),boundary)).map(e=>{const p=P(e);return{id:e.id,x:r(p[0]),z:r(p[1]),r:2,entries:arms(new Set([e.id]),new Set())};});}
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
data.psychiko.arterial=arterialRecords(selected,P);
data.psychiko.scenery=buildPsychikoScenery(data,fs.readFileSync(path.join(out,'terrain.bin')),osm);
fs.writeFileSync(path.join(out,'map.json'),JSON.stringify(data));
inject('psychiko');
fs.writeFileSync(path.join(dir,'raw/profile.json'),JSON.stringify({step,start:R.start,finish:R.finish,raw:Yraw,smoothed:Y,stats}));
console.log(JSON.stringify({length:data.length,stats,GX,GZ,buildings:buildings.length,sideRoads:sideRoads.length,areas:Object.fromEntries(Object.entries(areas).map(([k,v])=>[k,v.length]))},null,2));
