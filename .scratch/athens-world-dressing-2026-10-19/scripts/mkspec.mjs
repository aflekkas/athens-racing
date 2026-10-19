import {readFileSync,readdirSync,writeFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {decodeTilePack} from '/tmp/athens-dressing.1sH8/src/world-tile-codec.js';
const dir=process.argv[2],names=['lamp','bus_stop','bus_shelter','kiosk','bench','bollard','stop','give_way','oneway','fountain','monument','parked_car','crossing'];
const want={ '0,0':['kiosk','bus_shelter','bench','fountain','monument','lamp','oneway','crossing'],'-14,8':['parked_car','stop','bus_stop'],'-15,8':['bollard','kiosk','bus_shelter','fountain']};
const out=[];
for(const f of readdirSync(dir).filter(n=>n.endsWith('.bin.gz'))){const buf=gunzipSync(readFileSync(dir+'/'+f));
 const pack=await decodeTilePack(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length),buf.length*2);const m=pack.metadata,o=m.origin,ext=m.extensions.worldDetail,key=m.cell.join(',');if(!want[key])continue;
 const r=pack.arrays[ext.props.rows],k=pack.arrays[ext.props.kind];const rows=[];for(let i=0;i<k.length;i++)rows.push({kind:names[k[i]],x:r[i*5]+o[0],z:r[i*5+2]+o[2],yaw:r[i*5+3]});
 for(const kind of want[key]){const cands=rows.filter(p=>p.kind===kind&&p.x-o[0]>40&&p.x-o[0]<470&&p.z-o[2]>40&&p.z-o[2]<470);
  // the one with the most other props within 25 m (a street that has something to look at)
  cands.sort((a,b)=>rows.filter(q=>Math.hypot(q.x-b.x,q.z-b.z)<25).length-rows.filter(q=>Math.hypot(q.x-a.x,q.z-a.z)<25).length);const p=cands[0];if(!p)continue;
  // camera on the side the model faces: signs and heads face -z (toward approaching traffic); roadside props have the road at -x
  const side=['stop','oneway','crossing'].includes(kind)?[-Math.sin(p.yaw),-Math.cos(p.yaw)]:kind==='parked_car'?[Math.cos(p.yaw)*1.2,-Math.sin(p.yaw)*1.2]:['kiosk','bus_shelter','bus_stop','bench','lamp'].includes(kind)?[-Math.cos(p.yaw),Math.sin(p.yaw)]:[Math.cos(.7),Math.sin(.7)];
  const d=['fountain','monument','parked_car'].includes(kind)?11:7,dx=side[0]*d,dz=side[1]*d;
  out.push({name:`${key.replace(',','_')}-${kind}`,car:[Math.round(p.x),Math.round(p.z)],at:[+p.x.toFixed(1),+p.z.toFixed(1)],cam:[+dx.toFixed(1),kind==='lamp'?4:2.6,+dz.toFixed(1)],lookUp:kind==='lamp'?3.5:1.0,far:500,wait:kind===out[0]?.kind?3000:5000});}
}
writeFileSync(process.argv[3],JSON.stringify(out,null,0));console.log(out.map(o=>o.name).join(' '));
