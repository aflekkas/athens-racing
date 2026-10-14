// Mediterranean low cover in the gaps between mapped Riviera vegetation polygons.
// One low-poly lobe, instanced for shrub cushions, limestone, grass and pine crowns:
// a single material/draw per spatial chunk, with the shared scenery distance fade.
import * as THREE from 'three';
import { CellInstances, RNG, pointInPoly, polyBounds, vnoise } from './util.js';
import { infillStreetIndex } from './infill-streets.js';

export function buildHillsideCover(map, parent, heightC, material, clear, infill = []) {
  if (map.id !== 'riviera') return null; // Penteli has its own mapped forest/understorey.
  const { route, terrain, data } = map, rng = new RNG(91831), seen = new Set();
  const group = new THREE.Group(); group.name = 'riviera-hillside-cover';
  const stats = { clusters: 0, shrubs: 0, rocks: 0, grass: 0, pines: 0, instances: 0, chunks: 0 };
  group.userData.hillsideCover = stats;
  const blocked = [...(data.buildings || []), ...infill,
    ...['residential', 'park', 'pitch', 'parking', 'pool', 'marina', 'fuel', 'golf', 'beach', 'quarry', 'lake'].flatMap(k => data.areas?.[k] || [])]
    .filter(a => a.p?.length >= 6).map(a => ({p:a.p, b:polyBounds(a.p)}));
  const boreRoads = (route.localCorridors || []).map(c => {
    const p=[]; for(let s=c.transitionS[0];s<=c.transitionS[1];s+=4){const q=c.point(s,0);p.push(q.x,q.z);}
    const q=c.point(c.transitionS[1],0);p.push(q.x,q.z);return {p,w:c.width};
  });
  const street = infillStreetIndex({...data,sideRoads:[...(data.sideRoads || []),...boreRoads]});
  const geo = new THREE.IcosahedronGeometry(1, 0);
  // The shared context material uses vertex colors as well as per-instance tints.
  const colors = new Float32Array(geo.attributes.position.count * 3).fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const bucket = new CellInstances(geo, material, {cell:700, far:2400, colors:true, shadow:false, receive:false});
  const tint = new THREE.Color();
  const open = (x,z,r) => {
    if (!clear(x,z,r,0) || street(x,z,r+1.5)) return false;
    if (blocked.some(a => x+r>a.b.x0 && x-r<a.b.x1 && z+r>a.b.z0 && z-r<a.b.z1 &&
      (pointInPoly(x,z,a.p) || pointInPoly(x-r,z,a.p) || pointInPoly(x+r,z,a.p) || pointInPoly(x,z-r,a.p) || pointInPoly(x,z+r,a.p)))) return false;
    return true;
  };
  function lobe(x,z,rx,ry,rz,color,lift=0) {
    const y=heightC(x,z),gx=(heightC(x+2,z)-heightC(x-2,z))/4,gz=(heightC(x,z+2)-heightC(x,z-2))/4;
    bucket.addTRS(x,y+lift+ry*.35,z,rng.range(0,Math.PI*2),rx,ry,rz,tint.set(color).clone(),Math.atan(gz),-Math.atan(gx));
    stats.instances++;
  }
  const greens=[0x59653d,0x657046,0x70794b,0x7e8154,0x52613e],dry=[0x9c9366,0xaba071,0x92885c],stone=[0xa7a28b,0xbab29b,0xc8bda3];
  for(let s=0;s<route.length;s+=12){const f=route.frame(s,{});
    for(const side of [-1,1])for(let distance=route.edge(s)+16;distance<680;distance+=9){
      const cell=9,cx=Math.floor((f.x+f.rx*distance*side)/cell),cz=Math.floor((f.z+f.rz*distance*side)/cell),key=`${cx},${cz}`;
      if(seen.has(key))continue;seen.add(key);
      const x=(cx+rng.range(.14,.86))*cell,z=(cz+rng.range(.14,.86))*cell,cls=terrain.cls(x,z),y=heightC(x,z);
      if(![2,3,6,8].includes(cls)||y<6||!open(x,z,6))continue;
      const slope=Math.hypot(heightC(x+4,z)-heightC(x-4,z),heightC(x,z+4)-heightC(x,z-4))/8;
      if(slope>1.6)continue;
      const patch=vnoise(x*.019,z*.019),density=(distance<280?.94:distance<470?.76:.5)*(slope>.7?.5:1);
      if(rng.next()>density || patch<.13)continue;
      stats.clusters++;
      const scale=distance>360?1.35:1,rocky=cls===2||slope>.65;
      if(!rocky || rng.next()<.48){
        const r=rng.range(2.8,4.2)*scale,h=rng.range(.65,1.25)*(slope>.4?.7:1);
        lobe(x,z,r,h,r*rng.range(.72,1.1),rng.pick(greens));stats.shrubs++;
        lobe(x+1.7,z-.9,r*.72,h*.85,r*.68,rng.pick(greens));stats.shrubs++;
      }
      if(rng.next()<(rocky?.78:.21)){
        lobe(x-1.5,z+1.2,rng.range(.8,2.2)*scale,rng.range(.35,1.1),rng.range(.8,1.8)*scale,rng.pick(stone));stats.rocks++;
      }
      if(rng.next()<.42){lobe(x+2,z+2,rng.range(1.6,2.9)*scale,.12,rng.range(1.3,2.4)*scale,rng.pick(dry));stats.grass++;}
      // Low Aleppo-like groups concentrate on gentler, greener pockets, not cliff faces.
      if(slope<.48 && patch>.55 && rng.next()<.18){
        const h=rng.range(2.7,4.4),px=x-1.8,pz=z-1.3;
        lobe(px,pz,.17,h*.5,.17,0x71674e,h*.325);
        lobe(px,pz,2.5,1.2,2.1,0x526541,h-.4);
        lobe(px+1.3,pz-.6,1.7,.85,1.65,0x65784b,h+.4);stats.pines++;
      }
    }
  }
  bucket.build(group);bucket.cells.clear();stats.chunks=bucket.meshes.length;
  for(const mesh of bucket.meshes){mesh.name='hillside-cover-chunk';mesh.userData.impostor=false;}
  if(stats.instances)parent.add(group);else geo.dispose();
  return group;
}
