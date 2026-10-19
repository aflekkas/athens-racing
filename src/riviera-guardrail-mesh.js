import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {CellInstances} from './util.js';
import {registerLod} from './scenery.js';
import {CHUNK_SCALE} from './batch.js';
import {planRivieraRails} from './riviera-guardrails.js';

export function buildRivieraRails(map,group,heightC,assets,road) {
  const {runs}=planRivieraRails(map,heightC,assets.network,road),r=map.route;
  const material=new THREE.MeshStandardMaterial({color:'#b3b8bd',metalness:.72,roughness:.48,side:THREE.DoubleSide});
  const geo=new THREE.BoxGeometry(.12,.86,.08);geo.translate(0,.43,0);
  const posts=new CellInstances(geo,material,{cell:240,shadow:false,far:420});
  const profile=[[0,.51],[.06,.55],[.06,.61],[0,.66],[0,.71],[.06,.76],[.06,.82],[0,.86]],chunks=new Map(),cell=240*(CHUNK_SCALE.value>=3?3:1); // weaker classes: coarser rail chunks, a few rail triangles more in view for a third of the calls
  let triangles=0,postCount=0;
  for(const run of runs){const pts=run.pts;
    for(let start=0;start<pts.length-1;){const end=Math.min(pts.length-1,start+80),pos=[],ix=[];
      for(let i=start;i<=end;i++){
        const q=pts[i],terminal=Math.min(1,(q.s-pts[0].s)/6,(pts.at(-1).s-q.s)/6);
        for(const [o,h] of profile){const p=r.point(q.s,run.side*(q.u-.08+o));pos.push(p.x,q.p.y+.02+h*terminal,p.z);}
        if(i>start)for(let j=0;j<7;j++){const a=(i-start-1)*8+j,b=a+1,c=a+8,d=c+1;ix.push(a,c,b,b,c,d);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();triangles+=ix.length/3;
      const p=pts[start].p,key=Math.floor(p.x/cell)+','+Math.floor(p.z/cell);if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(g);start=end;
    }
    for(const q of pts){if(q.s%4||q.s-pts[0].s<6||pts.at(-1).s-q.s<6)continue;const f=r.frame(q.s,{});posts.addTRS(q.p.x,q.p.y-.03,q.p.z,Math.atan2(f.tx,f.tz),1);postCount++;}
  }
  for(const [key,parts] of chunks){const geometry=mergeGeometries(parts),m=new THREE.Mesh(geometry,material);parts.forEach(g=>g.dispose());m.name='Riviera guardrail chunk '+key;m.userData.dynamic=true;m.receiveShadow=true;registerLod(m,{far:1100,impostor:false});group.add(m);}
  posts.build(group);posts.meshes.forEach(m=>m.name='Riviera guardrail posts');
  assets.rails=runs;
  group.userData.guardrails={runs:runs.length,metres:runs.reduce((n,q)=>n+q.pts.at(-1).s-q.pts[0].s,0),chunks:chunks.size,postChunks:posts.meshes.length,posts:postCount,triangles};
  return runs;
}
