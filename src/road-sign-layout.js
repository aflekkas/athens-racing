// Geographic reconstruction, not a surveyed sign inventory. Posted speed values
// remain owned by data.speedSigns / route.speeds and the existing speed renderer.
import { penteliJunctions } from './maps/penteli-roadside.js';
export function roadSignLayout(map) {
  if (map.id !== 'penteli') return [];
  const r=map.route, signs=[];
  const add=(kind,s,u,dir=1,text='')=>{
    if(s<0||s>r.length||map.roadNetwork?.mouth(s,Math.sign(u),1))return;
    const p=r.point(s,u),f=r.frame(s,{});
    signs.push({kind,s,u,x:p.x,z:p.z,y:p.y,yaw:Math.atan2(-f.tx*dir,-f.tz*dir),text});
  };
  for(const j of penteliJunctions(map)) {
    for(const dir of [-1,1]) {
      const s=j.s-dir*38;
      add('direction',s,dir*(r.edge(s)+2.8),dir,dir>0?(j.roadId===224029663?'Πεντέλη / Penteli →':'Πεντέλη / Penteli ↑'):(j.roadId===224029663?'Διόνυσος / Dionysos ←':'Διόνυσος / Dionysos ↑'));
    }
    // Give-way on the branch approach. Read the actual OSM axis to orient it
    // toward drivers arriving from the side road, outside that road's surface.
    const p=j.road.p;let point=null;
    for(let i=0;i+3<p.length;i+=2){const q=map.roadNetwork.project(p[i],p[i+1]);if(Math.abs(q.u)<r.edge(q.s)+10||Math.abs(q.u)>r.edge(q.s)+28)continue;
      const dx=p[i+2]-p[i],dz=p[i+3]-p[i+1],L=Math.hypot(dx,dz);if(!L)continue;
      const f=r.frame(j.s,{}),away=Math.sign(dx*f.rx*j.side+dz*f.rz*j.side)||1;
      const tx=dx/L*away,tz=dz/L*away,u=j.road.w/2+.9;
      point={kind:'yield',s:q.s,x:p[i]+tz*u,z:p[i+1]-tx*u,y:map.roadNetwork.height(p[i],p[i+1]),yaw:Math.atan2(tx,tz),roadId:j.roadId};if(!map.roadNetwork.sample(point.x,point.z))break;point=null;}
    if(point&&!map.roadNetwork.sample(point.x,point.z))signs.push(point);
  }
  // Fork-specific destinations on both approaches; no invented distances.
  add('direction',5680,r.edge(5680)+2.8,1,'Νέα Μάκρη / Nea Makri ↑');
  add('village',680,-r.edge(680)-2.5,-1,'ΔΙΟΝΥΣΟΣ / DIONYSOS');
  let previous=-Infinity;
  for(let s=120;s<r.length-100;s+=12){
    const a=r.frame(s-18,{}),b=r.frame(s+18,{}),turn=Math.atan2(a.tx*b.tz-a.tz*b.tx,a.tx*b.tx+a.tz*b.tz);
    if(Math.abs(turn)<.44||s-previous<150)continue;previous=s;
    for(const dir of [-1,1])add('curve',s-dir*65,dir*(r.edge(s-dir*65)+2),dir);
    const outside=turn>0?-1:1;
    for(const offset of [-12,0,12])add(outside>0?'chevron-left':'chevron-right',s+offset,outside*(r.edge(s+offset)+2.2),1);
  }
  return signs;
}

// Reconstructed repeaters use exactly the HUD's speed profile. Reverse-facing
// inferred change signs announce the limit being entered (before the station).
export function speedSignRecords(map) {
  const original=map.data.speedSigns || [];
  if(map.id!=='penteli')return original;
  const speeds=map.data.route.speeds || [],limit=s=>{let v=speeds[0]?.v;for(const q of speeds){if(q.s>s)break;v=q.v;}return v;};
  const signs=original.map(s=>s.dir<0&&s.src==='inferred'?{...s,v:limit(s.s-.1)??s.v}:s);
  for(const dir of [-1,1])for(let s=360;s<map.route.length-60;s+=1600){
    if(signs.some(q=>q.dir===dir&&Math.abs(q.s-s)<150)||map.roadNetwork?.mouth(s,dir,2))continue;
    const v=limit(s);if(v)signs.push({s,u:dir*(map.route.edge(s)+2.2),dir,v,src:'inferred'});
  }
  return signs;
}
