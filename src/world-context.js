// Cheap mid/far-field context, inside the sampled terrain. Buildings/planting are
// illustrative infill; mapped quarries and residential polygons retain their OSM footprints.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CellInstances, RNG, pointInPoly, polyBounds } from './util.js';
import { COND_STATE } from './env.js';

function colored(g, color) {
  const c = new THREE.Color(color), a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function template(parts) {
  const flat = parts.map(p => p.index ? p.toNonIndexed() : p);
  const g = mergeGeometries(flat);
  new Set([...parts, ...flat]).forEach(p => p.dispose()); return g;
}
function box(x, y, z, w, h, d, color) { return colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color); }
const inside = (x, z, list) => list.some(a => x >= a.b.x0 && x <= a.b.x1 && z >= a.b.z0 && z <= a.b.z1 && pointInPoly(x, z, a.p));

export function buildWorldContext(map, scene, heightC) {
  const { route, terrain, data } = map, rng = new RNG(81073), coastal = map.id === 'riviera', farm = map.id === 'megara';
  const group = new THREE.Group(); group.name = 'world-context:' + map.id; scene.add(group);
  const stats = { trees: 0, homes: 0, greenhouses: 0, plots: 0, umbrellas: 0, quarryPatches: 0, poles: 0 };
  group.userData.context = stats;
  const polygons = key => (data.areas?.[key] || []).filter(a => a.p?.length >= 6).map(a => ({ ...a, b: polyBounds(a.p) }));
  const residential = polygons('residential'), quarries = polygons('quarry');
  const buildings = (data.buildings || []).filter(b => b.p?.length >= 6).map(b => ({ ...b, b: polyBounds(b.p) }));
  // Index all OSM roads with enough padding for the widest generated footprint.
  const cells = new Map(), C = 128;
  for (const s of map.roadNetwork?.segments || []) {
    const pad = s.hw + s.sw + 85;
    for (let x = Math.floor((Math.min(s.ax,s.bx)-pad)/C); x <= Math.floor((Math.max(s.ax,s.bx)+pad)/C); x++)
      for (let z = Math.floor((Math.min(s.az,s.bz)-pad)/C); z <= Math.floor((Math.max(s.az,s.bz)+pad)/C); z++) {
        const k = `${x},${z}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(s);
      }
  }
  // A route capsule index avoids projecting every distant tree onto thousands of
  // centreline samples. Conservative 20 m segments protect hairpins as well.
  const routeCells = new Map();
  for (let s=0;s<route.length;s+=20) {
    const a=route.point(s,0),b=route.point(Math.min(s+20,route.length),0),dx=b.x-a.x,dz=b.z-a.z;
    const seg={ax:a.x,az:a.z,dx,dz,l2:dx*dx+dz*dz||1,edge:Math.max(route.edge(s),route.edge(s+20))+2};
    const pad=seg.edge+510;
    for(let x=Math.floor((Math.min(a.x,b.x)-pad)/C);x<=Math.floor((Math.max(a.x,b.x)+pad)/C);x++)
      for(let z=Math.floor((Math.min(a.z,b.z)-pad)/C);z<=Math.floor((Math.max(a.z,b.z)+pad)/C);z++){
        const k=`${x},${z}`;if(!routeCells.has(k))routeCells.set(k,[]);routeCells.get(k).push(seg);
      }
  }
  function clear(x, z, r = 5, corridor = 80) {
    if (x-r < terrain.minX+20 || x+r > terrain.maxX-20 || z-r < terrain.minZ+20 || z+r > terrain.maxZ-20) return false;
    if (heightC(x,z) < .8 || terrain.cls(x,z) === 0) return false;
    if (map.roadNetwork?.sample(x,z)) return false; // Includes mapped pavements.
    for(const s of routeCells.get(`${Math.floor(x/C)},${Math.floor(z/C)}`)||[]){
      const t=Math.max(0,Math.min(1,((x-s.ax)*s.dx+(z-s.az)*s.dz)/s.l2));
      if(Math.hypot(x-s.ax-s.dx*t,z-s.az-s.dz*t)<s.edge+r+corridor)return false;
    }
    for (const s of cells.get(`${Math.floor(x/C)},${Math.floor(z/C)}`) || []) if (map.roadNetwork.distance(s,x,z) < s.hw+s.sw+r+3) return false;
    if (buildings.some(b => x+r > b.b.x0 && x-r < b.b.x1 && z+r > b.b.z0 && z-r < b.b.z1)) return false;
    return true;
  }
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  // Lambert shells skip environment sampling; retain the sky's diffuse fill even in LOW.
  material.customProgramCacheKey = () => 'world-context-daylight-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.uContextDaylight = { get value() { return COND_STATE.daylight; } };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uContextDaylight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (.32 * uContextDaylight);');
  };
  const buckets = [];
  const bucket = (g, far = 5200) => { const b = new CellInstances(g, material, { cell: 900, far, colors: true, shadow: false, receive: false }); buckets.push(b); return b; };
  const pine = bucket(template([
    colored(new THREE.CylinderGeometry(.14,.28,5,5).translate(0,2.5,0),0x655c46),
    colored(new THREE.IcosahedronGeometry(1,0).scale(3.6,2.3,3.2).translate(0,6,0),0x496043),
    colored(new THREE.IcosahedronGeometry(1,0).scale(2.8,1.8,2.7).translate(1.3,7,-.3),0x586c48),
  ]));
  const olive = bucket(template([
    colored(new THREE.CylinderGeometry(.2,.32,2.5,5).translate(0,1.25,0),0x706550),
    colored(new THREE.IcosahedronGeometry(1,1).scale(2.9,1.65,2.6).translate(0,3.2,0),0x7d8662),
  ]));
  const home = bucket(template([
    box(0,3,0,10,6,8,0xe3ddca), box(0,6.13,0,10.5,.26,8.5,coastal?0xf1ebd6:0xa9775a),
    box(0,3.2,4.35,10.6,.22,1.4,0xd8d3c5),
    ...[-3,0,3].flatMap(x => [box(x,4.8,4.015,1.5,1.4,.04,0x526267),box(x,1.7,4.015,1.5,1.5,.04,0x647372)]),
    box(2,6.6,-1,1.5,.7,1.2,0xc5c8c2),
  ]));
  const shed = bucket(template([box(0,2,0,12,4,7,0xb6b5a0),box(0,4.1,0,12.8,.24,7.8,0x9b9c90),box(0,1.6,3.52,3.5,3.2,.05,0x727972)]));
  const greenhouse = bucket(template([
    colored(new THREE.CylinderGeometry(1,1,1,8,1,false,0,Math.PI).rotateZ(Math.PI/2).scale(18,3.6,4.5).translate(0,.1,0),0xc9d2bf),
    box(0,.8,0,18,1.6,8,0xbdc8b7),
  ]));
  const umbrella = bucket(template([
    colored(new THREE.CylinderGeometry(.045,.045,2.5,5).translate(0,1.25,0),0xe6dfc9),
    colored(new THREE.ConeGeometry(1.8,.55,8).translate(0,2.6,0),0xe5cda0),
    box(1,.25,0,.65,.18,1.9,0xd5cbb5),
  ]), 2000);
  const utility = bucket(template([box(0,5,0,.24,10,.24,0x877966),box(0,9.2,0,.16,.16,3.6,0x656a62)]));
  const trees = (x,z,kind=pine,scale=1) => { kind.addTRS(x,heightC(x,z)-.15,z,rng.range(0,6.28),scale,scale,scale,new THREE.Color().setRGB(rng.range(.86,1.06),rng.range(.91,1.08),rng.range(.87,1.03))); stats.trees++; };
  // Fill landscape cells beyond the detailed corridor, with irregular gaps and varied crowns.
  const step = farm ? 52 : 38;
  for (let z=terrain.minZ+30; z<terrain.maxZ-30; z+=step) for (let x=terrain.minX+30; x<terrain.maxX-30; x+=step) {
    const xx=x+rng.range(0,step*.8),zz=z+rng.range(0,step*.8);
    if (!clear(xx,zz,5,farm?190:coastal?160:420) || inside(xx,zz,quarries)) continue;
    const slope=Math.hypot(heightC(xx+6,zz)-heightC(xx-6,zz),heightC(xx,zz+6)-heightC(xx,zz-6))/12;
    if(slope>.8) continue;
    const town=inside(xx,zz,residential), chance=farm?.46:town?.18:coastal?.42:.68;
    if (rng.next()<chance) trees(xx,zz,farm||rng.next()<.26?olive:pine,rng.range(.8,1.8));
    if (town && slope<.24 && rng.next()<.30 && clear(xx,zz,12,150)) {
      home.addTRS(xx,heightC(xx,zz)-.4,zz,rng.range(-.22,.22),rng.range(.85,1.3),rng.range(.75,1.25),1);stats.homes++;
    }
  }
  // Low-rise villas flank the two coastal towns; source residential polygons decide placement.
  // Farmland uses small terrain-conforming patches, never a flat plate across a road.
  const patches = new Map();
  function patch(x,z,w,d,color,accept) {
    const key=`${Math.floor(x/900)},${Math.floor(z/900)}`, a=patches.get(key)||[]; patches.set(key,a);
    const c=new THREE.Color(color), n=Math.ceil(Math.max(w,d)/18);
    for(let j=0;j<n;j++)for(let i=0;i<n;i++) {
      const x0=x-w/2+w*i/n,z0=z-d/2+d*j/n,x1=x0+w/n,z1=z0+d/n;
      if(!accept((x0+x1)/2,(z0+z1)/2))continue;
      for(const [xx,zz] of [[x0,z0],[x0,z1],[x1,z0],[x1,z0],[x0,z1],[x1,z1]]) a.push(xx,heightC(xx,zz)+.045,zz,c.r,c.g,c.b);
    }
  }
  if(farm) for(let z=terrain.minZ+160;z<terrain.maxZ-160;z+=190)for(let x=terrain.minX+160;x<terrain.maxX-160;x+=190){
    if(!clear(x,z,70,170))continue;
    const crop=[0x989360,0x878858,0xaaa073][stats.plots%3];
    patch(x,z,135,115,crop,(xx,zz)=>clear(xx,zz,14,80));stats.plots++;
    if(stats.plots%3===0)for(let i=-3;i<=3;i++)for(let j=-2;j<=2;j++)if(clear(x+i*16,z+j*17,4,120))trees(x+i*16,z+j*17,olive,.95);
    if(stats.plots%5===1 && clear(x,z,24,130)){for(let j=0;j<3;j++)greenhouse.addTRS(x,heightC(x,z+j*12),z+j*12,0,1,1,1);stats.greenhouses+=3;}
    if(stats.plots%7===0){shed.addTRS(x,heightC(x,z),z,0,1,1,1);stats.homes++;}
  }
  if(farm){
    const wire=[];
    for(let z=terrain.minZ+250;z<terrain.maxZ-250;z+=650){let prev=null;
      for(let x=terrain.minX+150;x<terrain.maxX-150;x+=100){if(!clear(x,z,3,180)){prev=null;continue;}const y=heightC(x,z);utility.addTRS(x,y,z,0,1,1,1);stats.poles++;
        if(prev)for(const side of [-1.4,1.4])for(let k=0;k<8;k++){const at=t=>[prev.x+(x-prev.x)*t,prev.y+(y-prev.y)*t+9.25-Math.sin(t*Math.PI)*1.2,z+side];wire.push(...at(k/8),...at((k+1)/8));}prev={x,y};
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(wire,3));const m=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0x676b5c}));group.add(m);
  }
  if(coastal)for(const beach of polygons('beach'))for(let x=beach.b.x0;x<beach.b.x1;x+=14)for(let z=beach.b.z0;z<beach.b.z1;z+=15){
    if(!inside(x,z,[beach])||!clear(x,z,3,10))continue;
    umbrella.addTRS(x,heightC(x,z),z,.2,1,1,1,stats.umbrellas%3?0xffffff:0xb1ccd0);stats.umbrellas++;
    if(stats.umbrellas%40===1&&clear(x+10,z,9,12)){shed.addTRS(x+10,heightC(x+10,z),z,.2,.65,.65,.65,0xc9ae8b);stats.homes++;}
  }
  // White marble scars follow mapped quarry footprints and actual mountain relief.
  // Inset tessellation exposes benches without floating rectangles or trees on quarry floors.
  for(const q of quarries){patch((q.b.x0+q.b.x1)/2,(q.b.z0+q.b.z1)/2,q.b.x1-q.b.x0,q.b.z1-q.b.z0,0xd5d0bc,(x,z)=>inside(x,z,[q])&&clear(x,z,15,100));stats.quarryPatches++;}
  for(const [key,a] of patches){if(!a.length)continue;const p=[],c=[];for(let i=0;i<a.length;i+=6){p.push(...a.slice(i,i+3));c.push(...a.slice(i+3,i+6));}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.computeVertexNormals();g.computeBoundingSphere();
    const m=new THREE.Mesh(g,material);m.name='context-ground:'+key;m.boundingSphere=g.boundingSphere;m.userData={lod:true,far:6200};group.add(m);
  }
  for(const b of buckets){b.build(group);b.cells.clear();if(!b.meshes.length)b.geo.dispose();}
  group.userData.reconstruction='Illustrative settlement and vegetation; OSM quarry/residential extents; road-clearance protected';
  return group;
}
