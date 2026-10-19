// Surface Kifisias dressing from the frozen OSM lane/one-way geometry. All pieces join existing streamed cells.
export function arterialRecords(elements, project) {
 const nodes=new Map(elements.filter(e=>e.type==='node').map(n=>[n.id,n]));
 const ways=elements.filter(w=>w.type==='way'&&/Kifisias|Paraplefri Odos/.test(w.tags?.int_name||'')&&w.tags.tunnel!=='yes'&&!Number(w.tags.layer));
 const signals=[],medians=[],segments=[];
 const hubs=[{id:'faros',lat:38.0049829,lon:23.7754547},{id:'elikonos',lat:38.01002,lon:23.7800122}].map(n=>({...n,p:project(n)}));
 for(const w of ways){const ps=w.nodes.map(id=>project(nodes.get(id)));for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L>1)segments.push({a,b,L,tx:(b[0]-a[0])/L,tz:(b[1]-a[1])/L,w});}}
 // Mapped signal nodes, plus the cross-street approach of both named junctions.
 const done=new Set();for(const hub of hubs){for(const w of ways){for(let k=0;k<w.nodes.length;k++){const n=nodes.get(w.nodes[k]),p=project(n);if(n.tags?.highway!=='traffic_signals'||Math.hypot(p[0]-hub.p[0],p[1]-hub.p[1])>95||done.has(n.id))continue;
  const a=project(nodes.get(w.nodes[Math.max(0,k-1)])),b=project(nodes.get(w.nodes[Math.min(w.nodes.length-1,k+1)])),L=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/L,tz=(b[1]-a[1])/L,hw=(+w.tags.lanes>=3?10.5:+w.tags.lanes>=2?8:5)/2;
  signals.push({hub:hub.id,node:n.id,x:+(p[0]-tz*(hw+.6)).toFixed(2),z:+(p[1]+tx*(hw+.6)).toFixed(2),yaw:Math.atan2(tx,tz)});done.add(n.id);
 }}
 const p=hub.p;signals.push({hub:hub.id,x:+(p[0]-8).toFixed(2),z:+(p[1]-5).toFixed(2),yaw:-Math.PI/2});}
 // Raised median only in the actual gap between opposing primary surface carriageways. Never across a signal mouth.
 for(const seg of segments.filter(s=>s.w.tags.highway==='primary'&&s.tz>0))for(let d=6;d<seg.L;d+=12){const x=seg.a[0]+seg.tx*d,z=seg.a[1]+seg.tz*d;if(hubs.some(h=>Math.hypot(x-h.p[0],z-h.p[1])<65))continue;
  let best=null;for(const other of segments){if(other.w.tags.highway!=='primary'||other.tx*seg.tx+other.tz*seg.tz>-.9)continue;const u=Math.max(0,Math.min(other.L,(x-other.a[0])*other.tx+(z-other.a[1])*other.tz)),px=other.a[0]+other.tx*u,pz=other.a[1]+other.tz*u,D=Math.hypot(px-x,pz-z);if(D>11.5&&D<23&&(!best||D<best.D))best={px,pz,D};}
  if(best)medians.push({x:+((x+best.px)/2).toFixed(2),z:+((z+best.pz)/2).toFixed(2),yaw:Math.atan2(seg.tx,seg.tz),length:Math.min(11,seg.L-d+5),width:Math.min(1.6,best.D-10.8)});
 }
 return {source:'Frozen OSM surface carriageways and traffic signal nodes; junction furniture approximate',signals,medians};
}
