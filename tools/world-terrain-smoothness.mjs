// Grade limits alone accept a short roller-coaster profile. Measure the actual
// contact surface's midpoint departure from a 32 m chord on emitted road paths.
// 0.5 m over a 16 m half-chord is curvature ~0.004/m; this is an independent
// comfort gate, never a replacement for the owner's grade/step/bridge guards.
import {buildTileContactIndex,sampleTileContact} from '../src/world-tile-contact.js';
export function auditTerrainSmoothness(t,{halfChord=16,maxSag=.5,spacing=4,include=()=>true}={}){
 const index=buildTileContactIndex(t),P=t.edgePoints,E=t.edges;let samples=0,worst=null,maximum=0;
 for(let e=0;e<E.length;e+=10){if(t.edgeLayers[e/10]!==0)continue;const start=E[e+3],count=E[e+4],stations=[0];
  for(let j=1;j<count;j++)stations.push(stations[j-1]+Math.hypot(P[(start+j)*3]-P[(start+j-1)*3],P[(start+j)*3+2]-P[(start+j-1)*3+2]));
  function at(s){let j=1;while(j<count-1&&stations[j]<s)j++;const f=(s-stations[j-1])/(stations[j]-stations[j-1]||1),a=(start+j-1)*3,b=a+3;const x=P[a]+f*(P[b]-P[a]),z=P[a+2]+f*(P[b+2]-P[a+2]),y=P[a+1]+f*(P[b+1]-P[a+1]);if(!include(x,z))return undefined;const c=sampleTileContact(t,index,x,z,{referenceY:y,layer:0,requiredFlags:1});return c?{...c,x,z}:null;}
  for(let s=halfChord;s<=stations.at(-1)-halfChord;s+=spacing){const a=at(s-halfChord),b=at(s),c=at(s+halfChord);if(![a,b,c].every(p=>p&&Number.isFinite(p.y)))continue;
   // A bend across a steady hillside changes longitudinal grade even on one
   // affine terrain plane. Remove that horizontal-path contribution.
   const sag=Math.abs(b.y-(a.y+c.y)/2-b.nx*(b.x-(a.x+c.x)/2)-b.nz*(b.z-(a.z+c.z)/2));samples++;if(sag>maximum){maximum=sag;worst={edge:e/10,station:s,a:a.y,b:b.y,c:c.y};}}
 }
 return {passed:samples?maximum<=maxSag:null,samples,maxSag:maximum,limit:maxSag,halfChord,worst};
}
