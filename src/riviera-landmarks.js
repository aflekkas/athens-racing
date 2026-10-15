// Loumbarda rock tunnels: geometry and contact corridors share the mapped axes.
// Dimensions beyond the OSM centre lines are estimates; see tools/riviera-landmarks.md.
import * as THREE from 'three';
import { TX } from './tex.js';
import { REFLECT_LAYER } from './env.js';

export function buildRivieraLandmarks(map, scene) {
  const group = new THREE.Group(); group.name = 'loumbarda-rock-tunnels';
  const obstacles = [], meshes = [], corridors = map.route.localCorridors || [];
  const material = new THREE.MeshStandardMaterial({color:0xd4d6d2, map:TX.rock_diff || null, roughness:1, vertexColors:true, flatShading:true, side:THREE.DoubleSide});
  for (const c of corridors) {
    const w=c.width/2+.65, [s0,s1]=c.portalS, n=Math.max(2,Math.ceil((s1-s0)/1.5));
    // Irregular high shoulders and flattened crown are exposed limestone, not a concrete arch.
    const inner=[[-w,-.35],[-w,3.7],[-w*.80,5.45],[-w*.28,6.15],[w*.32,6.35],[w*.83,5.45],[w,3.6],[w,-.35]];
    const outer=[[-w-1.9,-1.8],[-w-1.9,5.3],[-w-1.45,9.2],[-w*.40,11.2],[w*.33,10.1],[w+1.2,8.3],[w+1.9,4.5],[w+1.9,-1.8]];
    const pos=[],uv=[],colors=[];
    function p(s,v){
      const k=outer.indexOf(v),t=(s-s0)/(s1-s0),ridge=k<0?0:Math.sin(Math.PI*t)*(.8+.45*Math.sin(s*1.3+k*2));
      const q=c.point(s,v[0]+(k<0?0:Math.sign(v[0])*ridge),{});
      return [q.x,q.y+v[1]+(k<0?0:ridge*1.5+.28*Math.sin(s*.8+k)),q.z];
    }
    function tri(a,b,d,shade){
      const ab=new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a)),ad=new THREE.Vector3().fromArray(d).sub(new THREE.Vector3().fromArray(a)),normal=ab.cross(ad);
      const axis=Math.abs(normal.y)>Math.max(Math.abs(normal.x),Math.abs(normal.z))?'top':Math.abs(normal.x)>Math.abs(normal.z)?'side':'front';
      for(const v of [a,b,d]){pos.push(...v);uv.push((axis==='side'?v[2]:v[0])*.17,(axis==='top'?v[2]:v[1])*.17);const grain=.92+.08*Math.sin(v[0]*1.7+v[2]*.6);colors.push(shade*grain,shade*grain,shade*grain);}}
    function quad(a,b,d,e,shade){tri(a,b,d,shade);tri(a,d,e,shade);}
    for(let i=0;i<n;i++){
      const a=s0+(s1-s0)*i/n,b=s0+(s1-s0)*(i+1)/n;
      for(let k=0;k<8;k++){const j=(k+1)%8;quad(p(a,inner[k]),p(b,inner[k]),p(b,inner[j]),p(a,inner[j]),.49);quad(p(a,outer[j]),p(b,outer[j]),p(b,outer[k]),p(a,outer[k]),1);}
      for(const side of [-1,1]){
        const A=c.point(a,side*(w+.45),{}),B=c.point(b,side*(w+.45),{});
        obstacles.push({x:(A.x+B.x)/2,z:(A.z+B.z)/2,y:(A.y+B.y)/2,yaw:Math.atan2(B.x-A.x,B.z-A.z),hw:.45,hl:Math.hypot(B.x-A.x,B.z-A.z)/2+.025,kind:'rock'});
      }
    }
    for(const s of [s0,s1])for(let k=0;k<8;k++){const j=(k+1)%8;quad(p(s,inner[k]),p(s,outer[k]),p(s,outer[j]),p(s,inner[j]),.90);}
    // The two holes share a limestone pier, not an open asphalt median.
    // Join only their overlapping portal span, outside both clear bore envelopes.
    if(c.id==='loumbarda-east'){
      const west=corridors.find(q=>q.id==='loumbarda-west');
      if(west){
        const start=Math.max(s0,west.portalS[0]),end=Math.min(s1,west.portalS[1]);
        function pier(s){const a=c.point(s,-w-1.1,{}),b=west.point(s,west.width/2+1.75,{}),crest=9.1+.6*Math.sin(s*.7);
          return [[a.x,a.y-1.7,a.z],[a.x,a.y+crest,a.z],[b.x,b.y+crest+.4,b.z],[b.x,b.y-1.7,b.z]];}
        for(let s=start;s<end;s+=1.5){const a=pier(s),b=pier(Math.min(end,s+1.5));for(let k=0;k<4;k++){const j=(k+1)%4;quad(a[k],b[k],b[j],a[j],1);}}
        for(const s of [start,end]){const a=pier(s);quad(a[0],a[1],a[2],a[3],.9);}
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,material);mesh.name=c.id;mesh.castShadow=true;mesh.receiveShadow=true;mesh.layers.enable(REFLECT_LAYER);mesh.boundingSphere=g.boundingSphere;mesh.userData={lod:true,far:2200,landmark:c.id,sourceWayId:c.sourceWayId};group.add(mesh);meshes.push(mesh);
  }
  if(meshes.length)scene.add(group);else material.dispose();
  group.userData.landmarks=corridors.map(c=>({id:c.id,sourceWayId:c.sourceWayId,portalS:c.portalS}));
  const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),direction=new THREE.Vector3();
  // Only these two local meshes participate. The callback never changes cockpit cameras.
  function constrainCamera(position,anchor){
    if(!meshes.length)return false;
    origin.copy(anchor);origin.y+=1;direction.copy(position).sub(origin);const distance=direction.length();
    if(distance<.3)return false;
    // Avoid traversal/raycast cost everywhere else on the map.
    if(!meshes.some(m=>origin.distanceToSquared(m.geometry.boundingSphere.center)<(m.geometry.boundingSphere.radius+distance)**2))return false;
    group.updateMatrixWorld(true);ray.set(origin,direction.multiplyScalar(1/distance));ray.near=.02;ray.far=distance+.25;
    const hit=ray.intersectObjects(meshes,false)[0];if(!hit)return false;
    position.copy(origin).addScaledVector(direction,Math.max(.2,hit.distance-.25));return true;
  }
  return {group,obstacles,constrainCamera};
}
