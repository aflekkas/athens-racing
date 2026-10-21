// Mediterranean landcover from the already attributed Penteli OSM extraction.
// Planting and residential infill are deterministic interpretations, not surveyed objects.
import {inRing,hashN,TREE} from '../../src/world-tile-trees.js';
import {buildTileContactIndex,sampleTileContact} from '../../src/world-tile-contact.js';
export function penteliCover(map,transform){
 const grid=new Map(),order=['quarry','rock','beach','lake','pool','parking','pitch','fuel','residential','wood','scrub'];
 for(const kind of order)for(const area of map.data.areas[kind]||[]){const ring=[];for(let i=0;i<area.p.length;i+=2){const p=transform.position([area.p[i],0,area.p[i+1]]);ring.push([p[0],p[2]]);}const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]),r={kind,ring,id:area.id};
  for(let x=Math.floor(Math.min(...xs)/512);x<=Math.floor(Math.max(...xs)/512);x++)for(let z=Math.floor(Math.min(...zs)/512);z<=Math.floor(Math.max(...zs)/512);z++){const k=`${x},${z}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(r);}
 }
 return(x,z)=>{for(const r of grid.get(`${Math.floor(x/512)},${Math.floor(z/512)}`)||[])if(inRing(r.ring,x,z))return r.kind;return 'default';};
}
export const COVER_KINDS=['default','wood','scrub','residential','quarry','rock','beach','lake','pool','parking','pitch','fuel'];
export function paintPenteli(positions,origin,cover){const out=new Uint8Array(positions.length/3);for(let i=0;i<positions.length;i+=3)out[i/3]=COVER_KINDS.indexOf(cover(positions[i]+origin[0],positions[i+2]+origin[2]));return out;}
export function populatePenteliScenery(bake,tiles,transform,cover){
 const counts={pine:0,maquis:0,houses:0,tavernas:0,walls:0,sourceAreas:Object.fromEntries(['wood','scrub','rock','quarry','residential'].map(k=>[k,bake.map.data.areas[k].length]))};
 const footprints=bake.map.data.buildings.map(b=>{const ring=[];for(let i=0;i<b.p.length;i+=2){const p=transform.position([b.p[i],0,b.p[i+1]]);ring.push([p[0],p[2]]);}return ring;});
 const roadClear=(x,z,r)=>{const p=transform.inverse([x,0,z]),n=bake.network;if(n.nearMain(p[0],p[2])){const q=n.project(p[0],p[2]);if(q.s>=-30&&q.s<=bake.map.route.length+30&&Math.abs(q.u)<bake.map.route.edge(q.s)+r+.4)return false;}for(let dx=-r;dx<=r;dx+=Math.max(1,r))for(let dz=-r;dz<=r;dz+=Math.max(1,r))for(const s of n.candidates(p[0]+dx,p[2]+dz))if(n.distance(s,p[0],p[2])<s.hw+s.sw+r+.4)return false;return true;};
 for(const tile of tiles.values()){
  const ox=tile.cell[0]*512,oz=tile.cell[1]*512,trees=[],houses=[],groundTables={...tile.t,coarseHeights:new Float32Array(1089).fill(NaN)},index=buildTileContactIndex(groundTables);
  const ground=(x,z)=>sampleTileContact(groundTables,index,x-ox,z-oz,{requiredFlags:2}),height=(x,z)=>ground(x,z)?.y;
  const clear=(x,z,r)=>roadClear(x,z,r)&&!footprints.some(p=>Math.min(...p.map(v=>v[0]))<=x+r&&Math.max(...p.map(v=>v[0]))>=x-r&&Math.min(...p.map(v=>v[1]))<=z+r&&Math.max(...p.map(v=>v[1]))>=z-r);
  const place=(x,z,yaw,w,h,d,kind)=>{
   const c=Math.cos(yaw),s=Math.sin(yaw),corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[0,0]].map(([a,b])=>[x+a*c+b*s,z-a*s+b*c]);
   if(corners.some(([x,z])=>x<ox+1||x>=ox+511||z<oz+1||z>=oz+511)||!clear(x,z,Math.hypot(w,d)/2+.5))return false;
   if(houses.some((_,i)=>i%7===0&&Math.hypot(x-ox-houses[i],z-oz-houses[i+2])<(Math.max(w,d)+Math.max(houses[i+4],houses[i+6]))/2+1))return false;
   const heights=corners.map(([x,z])=>height(x,z));if(!heights.every(Number.isFinite)||Math.max(...heights)-Math.min(...heights)>(kind==='walls'?1.5:3.5))return false;
   const y=Math.min(...heights)-.2;houses.push(x-ox,y,z-oz,yaw,w,h,d);tile.authoredObstacles??=[];tile.authoredObstacles.push(x-ox,y,z-oz,yaw,d/2,w/2,h);counts[kind]++;return true;
  };
  // Owner-requested inferred village frontage, not fabricated OSM buildings.
  if(bake.map.route.point)for(let station=250;station<900;station+=36)for(const side of [-1,1]){
   const centre=transform.position(bake.map.route.point(station,0).toArray());
   const p=transform.position(bake.map.route.point(station,side*(23+(station%3)*3)).toArray()),yaw=Math.atan2(centre[0]-p[0],centre[2]-p[2]),taverna=station===394||station===538;
   if(place(p[0],p[2],yaw,taverna?15:10,taverna?3.41:5.4,taverna?11:9,taverna?'tavernas':'houses')){
    const wall=transform.position(bake.map.route.point(station+12,side*15).toArray());place(wall[0],wall[2],yaw,10,1.2,.65,'walls');
   }
  }
  // Interior-only footprints make ownership and collision independent of neighbours.
  for(let ix=Math.ceil((ox+18)/44);ix*44<ox+494;ix++)for(let iz=Math.ceil((oz+18)/44);iz*44<oz+494;iz++){
   const seed=hashN(ix*73856093^iz*19349663),x=ix*44+(seed%11)-5,z=iz*44+((seed>>>8)%11)-5,r=9;
   if(seed%4===0||![[-r,-r],[r,-r],[r,r],[-r,r],[0,0]].every(([a,b])=>cover(x+a,z+b)==='residential')||!clear(x,z,13))continue;
   const heights=[[-r,-r],[r,-r],[r,r],[-r,r],[0,0]].map(([a,b])=>height(x+a,z+b));if(!heights.every(Number.isFinite)||Math.max(...heights)-Math.min(...heights)>1.5)continue;
   const y=Math.min(...heights)-.2,h=3.4,w=8+seed%4,d=8+(seed>>>4)%5,yaw=(seed%2)*Math.PI/2;
   place(x,z,yaw,w,h,d,'houses');
  }
  for(let ix=Math.floor(ox/14);ix*14<ox+512;ix++)for(let iz=Math.floor(oz/14);iz*14<oz+512;iz++){
   const seed=hashN(ix*73856093^iz*19349663),x=(ix+.18+(seed%640)/1000)*14,z=(iz+.18+((seed>>>10)%640)/1000)*14;if(x<ox+2||x>=ox+510||z<oz+2||z>=oz+510)continue;
   const kind=cover(x,z);if(['quarry','beach','lake','pool','parking','pitch','fuel'].includes(kind)||kind==='residential'&&seed%5!==0)continue;
   const pine=kind==='wood'?seed%10<9:kind==='rock'?false:kind==='scrub'?seed%10<3:seed%10<9;
   const r=pine?3:1.1;if(!clear(x,z,r))continue;
   if(houses.some((_,i)=>i%7===0&&Math.hypot(x-ox-houses[i],z-oz-houses[i+2])<16))continue;
   const contact=ground(x,z),y=contact?.y,slope=contact?Math.hypot(contact.nx,contact.nz):Infinity;
   if(!Number.isFinite(y)||slope>(pine?.75:1.15)||kind==='rock'&&seed%5!==0)continue;
   // Reject every emitted contact surface, including shoulders and bridge mouths.
   if(sampleTileContact(tile.t,index,x-ox,z-oz,{requiredFlags:1,referenceY:y}))continue;
   trees.push(x-ox,y-.12,z-oz,(seed%628)/100,(pine?TREE.pine:TREE.oleander)*8+(seed>>>22)%8);counts[pine?'pine':'maquis']++;
  }
  if(bake.map.route.point)for(let station=0;station<bake.map.route.length;station+=6)for(const side of [-1,1])for(let clump=0;clump<2;clump++){
   const p=transform.position(bake.map.route.point(station+clump*1.7+Math.sin(station*1.7)*1.3,side*(bake.map.route.edge(station)+2.2+clump*2.3+Math.sin(station)*.5)).toArray()),x=p[0],z=p[2];if(x<ox+2||x>=ox+510||z<oz+2||z>=oz+510||!clear(x,z,.65))continue;
   if(['quarry','beach','lake','pool','parking','pitch','fuel'].includes(cover(x,z)))continue;const c=ground(x,z);if(!c||!Number.isFinite(c.y)||Math.hypot(c.nx,c.nz)>1.1||sampleTileContact(tile.t,index,x-ox,z-oz,{requiredFlags:1,referenceY:c.y}))continue;
   if(houses.some((_,i)=>i%7===0&&Math.hypot(x-ox-houses[i],z-oz-houses[i+2])<Math.max(houses[i+4],houses[i+6])/2+2))continue;
   trees.push(x-ox,c.y-.12,z-oz,station%6.28,TREE.oleander*8+(station+clump)%8);counts.maquis++;
  }
  tile.penteliTrees=trees;tile.penteliHouses=houses;tile.penteliPaint=paintPenteli(tile.t.finePositions,[ox,0,oz],cover);
 }
 return counts;
}
