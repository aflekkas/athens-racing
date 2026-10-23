import {sha256} from './route-definition.js';
import {snapshotOnlineGrid} from './online-grid-snapshot.js';
import {carOverlap} from './crash-contact.js';
const HEX=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('Online grid unavailable or release mismatch');};
const object=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail();};
const number=(v,min,max)=>{if(!Number.isFinite(v)||v<min||v>max)fail();};
const text=v=>{if(typeof v!=='string'||!v.length||v.length>200)fail();};
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
export const onlineGridHash=body=>sha256(body);
export function onlineGridPose(body,slot,car=null){
 if(!Number.isInteger(slot)||slot<0||slot>=8||body?.capacity!==8||body.poses?.[slot]?.slot!==slot)fail();
 if(car){const halfWidth=Number(car.width)/2,halfLength=Number(car.length)/2;if(!Number.isFinite(halfWidth)||!Number.isFinite(halfLength)||halfWidth>body.footprint.halfWidth||halfLength>body.footprint.halfLength)throw Error('Vehicle exceeds the certified online grid footprint');}
 return body.poses[slot];
}
// The trusted release descriptor supplies expectedHash. Structural checks are
// additional defenses, never a substitute for the offline physical proof.
export async function validateOnlineGrid(body,compiled,{expectedHash,car=null}={}){
 body=snapshotOnlineGrid(body).body;
 object(body,['schemaVersion','projectionId','routeId','routeHash','geometryHash','worldSetRevision','capacity','footprint','poses','approach','sourceHashes']);
 if(body.schemaVersion!==1||body.projectionId!=='athens-v1'||body.capacity!==8||body.routeId!==compiled?.id)fail();
 for(const key of ['routeHash','geometryHash','worldSetRevision'])if(!HEX.test(body[key]||'')||body[key]!==compiled[key])fail();
 if(!HEX.test(expectedHash||''))fail();
 object(body.footprint,['halfWidth','halfLength','clearanceM']);
 const footprint=body.footprint;number(footprint.halfWidth,.3,3);number(footprint.halfLength,.5,12);number(footprint.clearanceM,.1,2);
 if(!Array.isArray(body.poses)||body.poses.length!==8)fail();
 for(const [i,p]of body.poses.entries()){
  object(p,['slot','s','x','y','z','yaw','edgeId','layer','surfaceId']);if(p.slot!==i)fail();
  number(p.s,-512,-1);number(p.x,-100000,100000);number(p.z,-100000,100000);number(p.y,-1000,10000);number(p.yaw,-Math.PI,Math.PI);number(p.layer,-16,16);if(!Number.isInteger(p.layer))fail();text(p.edgeId);text(p.surfaceId);
  if(i&&p.s>=body.poses[i-1].s)fail();
  for(const other of body.poses.slice(0,i))if(Math.abs(other.y-p.y)<2&&carOverlap({...p,halfW:footprint.halfWidth+footprint.clearanceM,halfL:footprint.halfLength+footprint.clearanceM},{...other,halfW:footprint.halfWidth+footprint.clearanceM,halfL:footprint.halfLength+footprint.clearanceM}))fail();
  onlineGridPose(body,i,car);
 }
 object(body.approach,['points','occurrences']);
 const {points,occurrences}=body.approach;
 if(!Array.isArray(points)||points.length>512||!Array.isArray(occurrences)||occurrences.length>256||!!points.length!==!!occurrences.length)fail();
 if(points.length){
  if(points.length<2||points[0][3]>body.poses.at(-1).s-footprint.halfLength||Math.abs(points.at(-1)[3])>.025)fail();
  for(const [i,p]of points.entries()){
   if(!Array.isArray(p)||p.length!==6||p.some(v=>!Number.isFinite(v))||p[4]<footprint.halfWidth||p[5]<footprint.halfWidth||i&&p[3]<=points[i-1][3])fail();
   if(i){const previous=points[i-1],distance=Math.hypot(p[0]-previous[0],p[1]-previous[1],p[2]-previous[2]);if(Math.abs(distance-(p[3]-previous[3]))>.05)fail();}
  }
  if(Math.hypot(...points.at(-1).slice(0,3).map((v,i)=>v-[compiled.startPose.x,compiled.startPose.y,compiled.startPose.z][i]))>.025)fail();
  let end=points[0][3];
  for(const occurrence of occurrences){object(occurrence,['edgeId','layer','surfaceId','s0','s1']);text(occurrence.edgeId);text(occurrence.surfaceId);number(occurrence.layer,-16,16);if(!Number.isInteger(occurrence.layer)||Math.abs(occurrence.s0-end)>.025||!(occurrence.s1>occurrence.s0))fail();end=occurrence.s1;}
  if(Math.abs(end)>.025)fail();
 }else if(body.poses.at(-1).s-footprint.halfLength<-(compiled.runIn?.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-compiled.runIn[i][k])),0)||0))fail();
 if(body.sourceHashes!==undefined){if(!Array.isArray(body.sourceHashes)||body.sourceHashes.length>32||body.sourceHashes.some(p=>!Array.isArray(p)||p.length!==2||!/^[-\d]+,[-\d]+$/.test(p[0])||!HEX.test(p[1]||'')))fail();}
 if(await onlineGridHash(body)!==expectedHash)fail();
 return freeze(body);
}
