#!/usr/bin/env node
// Rebuild the Megara bundle offline from the checked-in OSM and EU-DEM snapshots.
// Sources, measurement limits and refresh commands: ./SOURCES.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRoadNetwork } from '../../build-road-network.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.join(ROOT, 'data/maps/megara');
const read = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'raw', n), 'utf8'));
const ways = read('context.json'), dem = read('dem.json');
const lat0 = 37.987, lon0 = 23.364, phi = lat0 * Math.PI / 180;
const mlat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const mlon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const P = ({lat, lon}) => [(lon - lon0) * mlon, -(lat - lat0) * mlat];
const round = (v) => Math.round(v * 1000) / 1000;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const raw = ways.find(w=>w.id === 70043234).geometry.slice(0,-1).map(P);
// OSM's direction is already clockwise (+ signed area in east/south coordinates).
const area = raw.reduce((a,p,i)=>{const q=raw[(i+1)%raw.length];return a+p[0]*q[1]-q[0]*p[1];},0);
if (area < 0) raw.reverse();
// Periodic chord-weighted Hermite interpolation passes through the measured vertices.
// Unlike uniform Catmull-Rom it does not throw wide arcs around long straight segments.
const dense=[];
for(let i=0;i<raw.length;i++) {
  const p0=raw[(i-1+raw.length)%raw.length],p1=raw[i],p2=raw[(i+1)%raw.length],p3=raw[(i+2)%raw.length];
  const h=distance(p1,p2),a=distance(p0,p1),b=distance(p2,p3);
  const m1=p1.map((_,k)=>((p1[k]-p0[k])/a*h+(p2[k]-p1[k])/h*a)/(a+h)*h);
  const m2=p1.map((_,k)=>((p2[k]-p1[k])/h*b+(p3[k]-p2[k])/b*h)/(h+b)*h);
  const count=Math.max(4,Math.ceil(h/0.3));
  for(let j=0;j<count;j++){const t=j/count,t2=t*t,t3=t2*t;dense.push(p1.map((v,k)=>(2*t3-3*t2+1)*v+(t3-2*t2+t)*m1[k]+(-2*t3+3*t2)*p2[k]+(t3-t2)*m2[k]));}
}
dense.push(dense[0]);
const cumulative=[0];for(let i=1;i<dense.length;i++)cumulative.push(cumulative[i-1]+distance(dense[i-1],dense[i]));
const length=cumulative.at(-1),count=Math.ceil(length),step=length/count;
let cursor=1;const pts=[];
for(let i=0;i<count;i++) {const s=i*step;while(cumulative[cursor]<s)cursor++;const t=(s-cumulative[cursor-1])/(cumulative[cursor]-cumulative[cursor-1]);pts.push(dense[cursor-1].map((v,k)=>v+(dense[cursor][k]-v)*t));}
// The timing gantry is beside the pit straight at satellite pixel (669,801).
const line=P({lat:37.986994,lon:23.363181});let start=0;for(let i=1;i<pts.length;i++)if(distance(pts[i],line)<distance(pts[start],line))start=i;
const samples=pts.slice(start).concat(pts.slice(0,start));samples.push(samples[0]);
function elevation(x,z) {
  const fx=clamp((x-dem.x0)/dem.step,0,dem.nx-1.00001),fz=clamp((z-dem.z0)/dem.step,0,dem.nz-1.00001);
  const i=Math.floor(fx),j=Math.floor(fz),tx=fx-i,tz=fz-j;
  const get=(a,b)=>dem.h[b*dem.nx+a]??0;
  return (get(i,j)*(1-tx)+get(i+1,j)*tx)*(1-tz)+(get(i,j+1)*(1-tx)+get(i+1,j+1)*tx)*tz;
}
// Smooth only the DEM profile; survey resolution cannot justify metre-scale bumps.
const heights=samples.slice(0,-1).map(p=>elevation(...p));
const y=heights.map((_,i)=>{let n=0,w=0;for(let j=-35;j<=35;j++){const k=Math.exp(-j*j/200);n+=heights[(i+j+count)%count]*k;w+=k;}return round(n/w+0.05);});y.push(y[0]);
const route={closed:true,step,x:samples.map(p=>round(p[0])),z:samples.map(p=>round(p[1])),y,
  lanes:samples.map(()=>1),div:samples.map(()=>0),width:samples.map(()=>11.5),racingLine:samples.map(()=>0),
  start:0,finish:length,length,from:'Megara start / finish',to:'Megara start / finish',names:[{s:0,name:'Athens Megara Circuit'}],speeds:[]};
function project(p) {let i=0;for(let k=1;k<count;k++)if(distance(p,samples[k])<distance(p,samples[i]))i=k;const a=samples[(i-2+count)%count],b=samples[(i+2)%count],l=distance(a,b);return {s:round(i*step),u:round(((p[0]-samples[i][0])*(a[1]-b[1])+(p[1]-samples[i][1])*(b[0]-a[0]))/l)};}
const poly=w=>w.geometry.map(P).map(p=>p.map(round));
const buildings=ways.filter(w=>w.tags.building).map(w=>{const p=poly(w).slice(0,-1),c=p.reduce((a,b)=>[a[0]+b[0]/p.length,a[1]+b[1]/p.length],[0,0]);return {id:w.id,p:p.flat(),h:4,lv:1,k:'commercial',...project(c)};});
const sideRoads=ways.filter(w=>w.tags.highway&&w.id!==70043234).map(w=>({id:w.id,p:poly(w).flat(),w:w.tags.highway==='raceway'?6:5,f:0,n:w.tags.highway==='raceway'?'Pit / service circuit':'Access road'}));
const areaKeys=['beach','lake','pool','scrub','rock','cliff','wood','park','marina','pier','breakwater','parking','golf','pitch','residential','fuel'];
const areas=Object.fromEntries(areaKeys.map(k=>[k,[]]));
for(const w of ways){const k=w.tags.landuse==='orchard'?'wood':w.tags.natural==='scrub'?'scrub':w.tags.amenity==='parking'?'parking':null;if(k)areas[k].push({p:poly(w).flat(),c:1});}
const pix=(x,z)=>P({lon:23.359+x/1600*.01,lat:37.992-z/1600*.01}).map(round);
const pavedAreas=[{p:[[117,897],[190,891],[223,902],[337,903],[382,1015],[177,1045]].map(p=>pix(...p)),y:9}];
const pitLane=[[341,903],[426,841],[512,769],[583,738],[658,729],[755,719]].map(p=>pix(...p));
const pitEdge=(side)=>pitLane.map((p,i)=>{const a=pitLane[Math.max(0,i-1)],b=pitLane[Math.min(pitLane.length-1,i+1)],l=distance(a,b);return [round(p[0]-(b[1]-a[1])/l*3.5*side),round(p[1]+(b[0]-a[0])/l*3.5*side)];});
pavedAreas.push({p:pitEdge(1).concat(pitEdge(-1).reverse()),y:9});
// Source-reviewed asphalt shoulders/aprons; shared by scenery and Ground.at.
// Omit y so these patches follow the same ground profile as the renderer.
pavedAreas.push(...read('paved-runoffs.json'));
const kerbs=[];let active=null;
for(let i=0;i<count;i++) {
  const a=samples[(i-6+count)%count],b=samples[i],c=samples[(i+6)%count];
  const ax=b[0]-a[0],az=b[1]-a[1],bx=c[0]-b[0],bz=c[1]-b[1];
  const k=(ax*bz-az*bx)/(Math.hypot(ax,az)*Math.hypot(bx,bz)*6*step),side=Math.abs(k)>.009?Math.sign(k):0;
  if(side&&active?.side===side)active.s1=round(i*step+8);
  else {if(active)kerbs.push(active);active=side?{s0:round(Math.max(0,i*step-8)),s1:round(i*step+8),side,width:.85,height:.045}:null;}
}if(active)kerbs.push(active);
for(let i=kerbs.length-1;i>0;i--)if(kerbs[i].side===kerbs[i-1].side&&kerbs[i].s0<=kerbs[i-1].s1){kerbs[i-1].s1=kerbs[i].s1;kerbs.splice(i,1);}
const marks=[{id:'megara-grid',name:'MEGARA',sub:'Start / finish',s:0},{id:'megara-back',name:'BACK STRAIGHT',sub:'Clockwise circuit',s:round(length*.47)},{id:'megara-final',name:'FINAL HAIRPIN',sub:'Return to pit straight',s:round(length*.86)}];
const events=[{id:'megara-tt',mapId:'megara',name:'Megara Time Trial',blurb:'Three clockwise laps. Your total time decides the result.',type:'timetrial',from:'start',to:'finish',laps:3,rivals:0,traffic:0,targetTimes:{gold:240,silver:270,bronze:315}},{id:'megara-race',mapId:'megara',name:'Megara Club Race',blurb:'Three laps against three rivals.',type:'sprint',from:'start',to:'finish',laps:3,rivals:3,traffic:0,targets:{gold:1,silver:2,bronze:3}}];
const data={id:'megara',name:'Megara Circuit',type:'circuit',sea:false,attribution:'Map data © OpenStreetMap contributors (ODbL) · Elevation EU-DEM v1.1 / OpenTopoData',proj:{lat0,lon0,mlat,mlon},route,events,marks,zones:[{zone:'circuit',urban:0,s:0}],buildings,sideRoads,areas,coast:[],trees:[],pois:[],furniture:[],places:[],parkSpots:[],humps:[],barriers:[],circuit:{direction:'clockwise',publishedLength:2100,measuredLength:length,nominalWidth:11.5,kerbs,pavedAreas,pitLane,kartRoute:poly(ways.find(w=>w.id===70043225)),shortcut:ways.find(w=>w.id===70043231).geometry.map(P).map(p=>p.map(round))},sources:{osmWay:70043234,precision:'OSM centreline and interpolated EU-DEM; not a laser survey. Width nominal; kerbs and facilities interpreted from imagery.'}};
// Same 32-byte header + decimetre Int16 heights + Uint8 land class as Riviera.
data.roadNetwork = extractRoadNetwork(data, ways.map(w => ({type:'way',...w})));
const T=10,GX=361,GZ=361,n=GX*GZ,buffer=Buffer.alloc(32+n*3);
buffer.writeInt32LE(GX,0);buffer.writeInt32LE(GZ,4);buffer.writeFloatLE(-1800,8);buffer.writeFloatLE(-1800,12);buffer.writeFloatLE(T,16);
for(let j=0;j<GZ;j++)for(let i=0;i<GX;i++){const x=-1800+i*T,z=-1800+j*T,k=j*GX+i;buffer.writeInt16LE(Math.round(elevation(x,z)*10),32+k*2);buffer[32+n*2+k]=3;}
fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'map.json'),JSON.stringify(data));fs.writeFileSync(path.join(OUT,'terrain.bin'),buffer);
console.log(`Megara: ${length.toFixed(2)} m, ${samples.length} periodic samples, ${buildings.length} OSM buildings, ${kerbs.length} kerb runs; elevation ${Math.min(...y).toFixed(2)}–${Math.max(...y).toFixed(2)} m`);
