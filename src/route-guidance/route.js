// World metres: x east, y up, z south. No THREE, DOM, or streaming dependency.
export function routeMetrics(polyline) {
  const points=[];
  for(const p of polyline){const q=Array.isArray(p)?{x:p[0],y:p.length>2?p[1]:0,z:p.length>2?p[2]:p[1]}:{...p,y:p.y??0};
    if(![q.x,q.y,q.z].every(Number.isFinite))throw Error('Nonfinite route point');
    if(!points.length||Math.hypot(q.x-points.at(-1).x,q.z-points.at(-1).z)>.001)points.push(q);
  }
  const supplied=points.length>1&&points.every((p,i)=>Number.isFinite(p.s)&&(i===0?p.s===0:p.s>points[i-1].s));
  if(points.some(p=>p.s!==undefined)&&!supplied)throw Error('Route stations must increase from zero');
  const stations=[0];for(let i=1;i<points.length;i++)stations.push(supplied?points[i].s:stations[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
  return {points,stations,segments:points.slice(1).map((_,i)=>i+1),length:stations.at(-1)||0};
}
export function sampleRoute(route,s){
  const {points:p,stations:a}=route;if(p.length<2)return null;s=Math.max(0,Math.min(route.length,s));
  let lo=0,hi=p.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(a[m]<=s)lo=m;else hi=m;}
  const d=a[hi]-a[lo],f=(s-a[lo])/d,l=Math.hypot(p[hi].x-p[lo].x,p[hi].z-p[lo].z),tx=(p[hi].x-p[lo].x)/l,tz=(p[hi].z-p[lo].z)/l;
  return {...p[lo],leftM:Number.isFinite(p[lo].leftM)?p[lo].leftM+(p[hi].leftM-p[lo].leftM)*f:undefined,rightM:Number.isFinite(p[lo].rightM)?p[lo].rightM+(p[hi].rightM-p[lo].rightM)*f:undefined,x:p[lo].x+(p[hi].x-p[lo].x)*f,y:p[lo].y+(p[hi].y-p[lo].y)*f,z:p[lo].z+(p[hi].z-p[lo].z)*f,tx,tz,s};
}
export function projectRoute(route,p,hint=null,segments=null){
  let best={s:0,distance:Infinity};
  for(const i of segments||route.segments){const a=route.points[i-1],b=route.points[i],dx=b.x-a.x,dz=b.z-a.z,l=route.stations[i]-route.stations[i-1],f=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz))),s=route.stations[i-1]+f*l,distance=Math.hypot(p.x-a.x-f*dx,p.z-a.z-f*dz);
    // Keep the current leg at a crossing; a tow farther away reacquires the route.
    const score=distance+(hint===null?0:Math.min(25,Math.abs(s-hint)*.02));
    if(score<(best.score??Infinity))best={s,distance,score};
  }return best;
}
const value=v=>v?.value??v;
const values=collection=>collection instanceof Map?[...collection.values()].map(value):collection||[];
const direction=(a,b)=>{const l=Math.hypot(b.x-a.x,b.z-a.z);return l?{x:(b.x-a.x)/l,z:(b.z-a.z)/l}:null;};
/** Directed graph nodes/edges may be WorldRoadGraph registries or plain arrays.
 * No graph (or no matching node) falls back to a 25-degree change over 12 m.
 * Reverse edges, prohibited turns and other levels are not wrong-turn choices.
 */
export function decisionPoints(polyline,roadGraph=null){
  const route=routeMetrics(polyline),out=[];if(route.points.length<2)return out;
  // Spatial candidates avoid projecting every resident city node onto the whole route.
  const buckets=new Map(),bucket=(x,z)=>`${Math.floor(x/32)},${Math.floor(z/32)}`;
  for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i];for(let x=Math.floor((Math.min(a.x,b.x)-2)/32);x<=Math.floor((Math.max(a.x,b.x)+2)/32);x++)for(let z=Math.floor((Math.min(a.z,b.z)-2)/32);z<=Math.floor((Math.max(a.z,b.z)+2)/32);z++){const k=`${x},${z}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(i);}}
  const nodes=values(roadGraph?.nodes),edges=values(roadGraph?.edges),outgoing=new Map(),incoming=new Map();
  for(const e of edges){if(e.flags&8)continue;const a=e.from??e.fromNode,b=e.to??e.toNode;for(const [map,k]of[[outgoing,a],[incoming,b]]){if(!map.has(k))map.set(k,[]);map.get(k).push(e);}}
  const nodeMap=new Map(nodes.map(n=>[n.id,n]));
  const tangent=(e,atEnd)=>{if(e.points?.length>1){const p=e.points,n=p.length,a=atEnd?p[n-2]:p[0],b=atEnd?p[n-1]:p[1];return direction({x:a[0],z:a[2]},{x:b[0],z:b[2]});}return direction(nodeMap.get(e.from)||{},nodeMap.get(e.to)||{});};
  const covered=[];
  for(const n of nodes){const segments=buckets.get(bucket(n.x,n.z));if(!segments)continue;const hit=projectRoute(route,n,null,segments);if(hit.distance>2||hit.s<2||hit.s>route.length-2)continue;
    const here=sampleRoute(route,hit.s);if(Math.abs(here.y-(n.y??here.y))>3)continue;
    const a=sampleRoute(route,hit.s-6),b=sampleRoute(route,hit.s+6),before=direction(a,here),after=direction(here,b);if(!before||!after)continue;
    const align=(e,end,d)=>{const t=tangent(e,end);return t?t.x*d.x+t.z*d.z:-1;};
    const ins=(incoming.get(n.id)||[]).filter(e=>align(e,true,before)>.75).sort((a,b)=>align(b,true,before)-align(a,true,before)),from=ins[0];
    const legal=e=>!(e.flags&8)&&(from?.layer==null||e.layer==null||e.layer===from.layer)&&(!roadGraph.legal||roadGraph.legal(from?.id,e));
    const choices=(outgoing.get(n.id)||[]).filter(e=>legal(e)&&align(e,false,before)>-.85);
    const chosen=choices.filter(e=>align(e,false,after)>.75).sort((a,b)=>align(b,false,after)-align(a,false,after))[0];
    if(!from||!chosen)continue;covered.push(hit.s);
    const wrong=choices.filter(e=>e!==chosen&&align(e,false,after)<.94).map(e=>({edge:e.id,points:e.points||[n,nodeMap.get(e.to)].filter(Boolean).map(p=>[p.x,p.y??here.y,p.z])}));
    const angle=Math.atan2(before.x*after.z-before.z*after.x,before.x*after.x+before.z*after.z);
    if(wrong.length||Math.abs(angle)>25*Math.PI/180)out.push({s:hit.s,point:here,angle,node:n.id,source:'graph',wrong});
  }
  for(let i=1;i<route.points.length-1;i++){const s=route.stations[i];if(covered.some(v=>Math.abs(v-s)<10))continue;
    const p=sampleRoute(route,s),a=sampleRoute(route,s-12),b=sampleRoute(route,s+12),u=direction(a,p),v=direction(p,b);if(!u||!v)continue;
    const angle=Math.atan2(u.x*v.z-u.z*v.x,u.x*v.x+u.z*v.z);
    if(Math.abs(angle)>25*Math.PI/180&&!out.some(d=>Math.abs(d.s-s)<18))out.push({s,point:p,angle,source:'heading',wrong:[]});
  }
  return out.sort((a,b)=>a.s-b.s||String(a.node||'').localeCompare(String(b.node||'')));
}
export const cellKey=(x,z)=>`${Math.floor(x/512)},${Math.floor(z/512)}`;
export function decisionOpacity(distance){return Math.max(0,Math.min(1,(80-distance)/24,(distance+8)/8));}
/** CPU-side instance stream: records compact when their owning cell is evicted. */
export class GuidanceChunks {
  constructor(polyline,{maxInstances=128,closed=false}={}){this.route=routeMetrics(polyline);this.closed=closed;this.maxInstances=maxInstances;this.cells=new Set();this.records=[];this.version=0;}
  setDecisions(decisions,timing=null){this.decisions=decisions;this.records=[];
    for(const d of decisions)for(const offset of [-35,-20,-8,8]){
      const station=d.s+offset;if(!this.closed&&(station<0||station>this.route.length))continue;
      const p=sampleRoute(this.route,this.closed?(station+this.route.length)%this.route.length:station);
      if(p)this.records.push({...p,kind:0,decisionS:d.s,width:1.2,length:2});
    }
    for(const s of this.closed?[0]:[0,this.route.length]){
      const supplied=s===0?timing?.start:timing?.finish,p=supplied?{...supplied,tx:-Math.sin(supplied.yaw),tz:-Math.cos(supplied.yaw)}:sampleRoute(this.route,s);
      if(p)this.records.push({...p,kind:2,decisionS:s,width:Number.isFinite(p.leftM)&&Number.isFinite(p.rightM)?p.leftM+p.rightM:8,length:.3});
    }
    for(const [id,r]of this.records.entries()){r.id=id;r.cell=cellKey(r.x,r.z);}this.version++;
  }
  addCell(key){this.cells.add(key);this.version++;}
  removeCell(key){this.cells.delete(key);this.version++;}
  visible(progress){const rows=[];for(const r of this.records){if(!this.cells.has(r.cell))continue;let d=r.decisionS-progress;if(this.closed){d=((d+40)%this.route.length+this.route.length)%this.route.length-40;}if(d>=-40&&d<=250)rows.push(this.closed?{...r,decisionS:progress+d}:r);}return rows.sort((a,b)=>Math.abs(a.decisionS-progress)-Math.abs(b.decisionS-progress)).slice(0,this.maxInstances);}
  dispose(){this.cells.clear();this.records=[];this.version++;}
}
