// Street furniture and working signals for the streamed Athens world, drawn as instanced meshes: one draw call per model that is
// in view (a handful, not one per tile or per prop). Each tile carries `worldDetail.signals` and `worldDetail.props`
// (tools/world-gen/props.py): flat rows of tile-local positions. Signal heads read their lamp from the instance's `iState`, so a
// phase change rewrites one number. World detail Off hides the lot and builds no instances.
import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {signalState,STOP_OFF} from './signal-plan.js';

export const KINDS=Object.freeze({lamp:0,bus_stop:1,bus_shelter:2,kiosk:3,bench:4,bollard:5,stop:6,give_way:7,oneway:8,fountain:9,monument:10,parked_car:11,crossing:12,signal:13,rooftop:14,solar:15,antenna:16,pergola:17,scooter:18});
export const PROP_LIMITS=Object.freeze({capacity:2600,near:230,rebuildMetres:10});
/** How far each model is drawn (metres). Small or rare models stop earlier, so a street scene costs a handful of draw calls, not one per model type. */
export const PROP_NEAR=Object.freeze({lamp:210,signal:230,bus_stop:140,bus_shelter:140,kiosk:140,stop:110,give_way:110,oneway:100,crossing:100,bench:80,bollard:80,fountain:160,monument:160,parked_car:100,rooftop:120,solar:100,antenna:120,pergola:100,scooter:80});
const NEAR_BY_KIND=Object.fromEntries(Object.entries(PROP_NEAR).map(([n,d])=>[KINDS[n],d]));
/** Car paints, mostly what Athens drives: white, silver, graphite and black, with some blue, red, beige and a dark green (the row picks them by src/world-tile-parking.js PAINT). */
const CAR_PAINT=['#ecebe6','#b4b9bc','#4e5459','#1e2124','#2b4f86','#a8302b','#c4b595','#35574a'];
const STATE_CODE={R:1,A:2,G:3};
/** Contact shadow of each kind: half width and half length of the dark ellipse, in the model's frame (its long axis is z). */
const SHADOW={[KINDS.parked_car]:[1.2,2.6],[KINDS.scooter]:[.5,1.05],[KINDS.kiosk]:[1.3,1.1],[KINDS.bus_shelter]:[1.9,1.1],[KINDS.bench]:[.5,1],[KINDS.fountain]:[2.3,2.3],[KINDS.monument]:[1.1,1.1]};

/** A convex side profile [[z, y], ...] (counter-clockwise) extruded across `width` metres: flat-shaded, with its own normals so `shade` can read them. */
function prism(profile,width){
  const hx=width/2,pos=[],nor=[],n=profile.length,tri=(a,b,c,nx,ny,nz)=>{for(const v of [a,b,c]){pos.push(v[0],v[1],v[2]);nor.push(nx,ny,nz);}};
  for(let i=1;i<n-1;i++){tri([hx,profile[0][1],profile[0][0]],[hx,profile[i][1],profile[i][0]],[hx,profile[i+1][1],profile[i+1][0]],1,0,0);tri([-hx,profile[0][1],profile[0][0]],[-hx,profile[i+1][1],profile[i+1][0]],[-hx,profile[i][1],profile[i][0]],-1,0,0);}
  for(let i=0;i<n;i++){const a=profile[i],b=profile[(i+1)%n],dz=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dz,dy),ny=-dz/l,nz=dy/l;
    tri([-hx,a[1],a[0]],[hx,a[1],a[0]],[hx,b[1],b[0]],0,ny,nz);tri([-hx,a[1],a[0]],[hx,b[1],b[0]],[-hx,b[1],b[0]],0,ny,nz);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));return g;
}
/** Baked "fake light" for a painted body: the roof and bonnet brightest, the flanks and nose darker, the tail darker still, the underside dark. */
const shadeOf=(nx,ny,nz)=>ny<-.5?.52:.72+.28*Math.max(ny,0)+(Math.abs(nx)>.7?.06:0)-(nz<-.7?.05:0);
function part(w,h,d,x,y,z,colour,{kind,lamp=0,rotZ=0,rotX=0,segments=0,faceZ=false,quad=0,paint=0,shade=false,profile=null}={}){
  const g=profile?prism(profile,w):quad?new THREE.PlaneGeometry(w,h):segments?new THREE.CylinderGeometry(w/2,w/2,h,segments):new THREE.BoxGeometry(w,h,d);
  if(quad<0)g.rotateY(Math.PI);
  if(faceZ)g.rotateX(Math.PI/2);if(rotZ)g.rotateZ(rotZ);if(rotX)g.rotateX(rotX);g.translate(x,y,z);
  const nrm=g.attributes.normal;g.deleteAttribute('uv');
  const c=new THREE.Color(colour),n=g.attributes.position.count,col=new Float32Array(n*3),k=new Float32Array(n).fill(kind),l=new Float32Array(n).fill(lamp),pa=new Float32Array(n).fill(paint);
  for(let i=0;i<n;i++){const f=shade?shadeOf(nrm.getX(i),nrm.getY(i),nrm.getZ(i)):1;col[i*3]=c.r*f;col[i*3+1]=c.g*f;col[i*3+2]=c.b*f;}
  g.deleteAttribute('normal');
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('aKind',new THREE.BufferAttribute(k,1));g.setAttribute('aLamp',new THREE.BufferAttribute(l,1));g.setAttribute('aPaint',new THREE.BufferAttribute(pa,1));
  return profile?mergeVertices(g):g;
}
/** Models, in a frame where the road is toward -x and the direction faced is -z. Low-poly boxes (street props <= 150 triangles). */
export function propParts(){
  const P=[],add=(kind,...a)=>P.push(part(...a.slice(0,7),{kind,...(a[7]||{})}));
  const grey='#6f7678',steel='#4a4f52';
  // street lamp: pole, arm over the road, lantern
  add(0,.12,6,.12,0,3,0,grey);add(0,1.5,.1,.1,-.75,6,0,grey);add(0,.55,.12,.26,-1.45,5.94,0,'#ece6c4');
  // bus stop post with its blue plate, and a shelter (roof, glass back, bench)
  add(1,.07,2.6,.07,0,1.3,0,grey);add(1,.5,.45,.05,0,2.55,0,'#2a62a8');
  add(2,.07,2.6,.07,-.2,1.3,0,grey);add(2,.5,.45,.05,-.2,2.55,.3,'#2a62a8');add(2,3.2,.08,1.6,.9,2.4,0,'#5d6d70');add(2,.05,2.1,1.6,1.6,1.2,0,'#7d98a0');add(2,1.9,.45,.4,.95,.45,0,'#8a6e48');
  // kiosk (periptero): body, awning, counter shelf
  add(3,1.6,2.4,1.4,.9,1.2,0,'#4d7a5c');add(3,2.1,.1,.9,-.2,2.3,0,'#c8bfa0');add(3,1.4,.08,.35,-.15,1.05,0,'#d8d4c4');
  // bench: seat, back, two legs
  add(4,1.6,.08,.45,0,.46,0,'#8a6e48');add(4,1.6,.45,.06,.45,.8,0,'#8a6e48');add(4,.08,.45,.4,-.7,.22,0,steel);add(4,.08,.45,.4,.7,.22,0,steel);
  // bollard
  add(5,.17,.85,.17,0,.42,0,steel);
  // stop sign: post and red plate; give way: post, red and white diamonds
  add(6,.06,2.3,.06,0,1.15,0,grey);add(6,.62,.62,.04,0,2.1,0,'#b3261e');add(6,.36,.08,.05,0,2.1,0,'#f2f0ea');
  add(7,.06,2.3,.06,0,1.15,0,grey);add(7,.62,.62,.04,0,2.05,0,'#b3261e',{rotZ:Math.PI/4});add(7,.36,.36,.05,0,2.05,0,'#f4f2ec',{rotZ:Math.PI/4});
  // one-way sign: blue plate with a white arrow shaft
  add(8,.06,2.2,.06,0,1.1,0,grey);add(8,.7,.45,.04,0,2.1,0,'#2a5a9c');add(8,.46,.09,.05,0,2.1,0,'#f4f2ec');add(8,.14,.2,.05,.2,2.1,0,'#f4f2ec');
  // fountain: basin, water, column, bowl
  add(9,3.4,.5,3.4,0,.25,0,'#b7b8b2',{segments:8});add(9,3,.08,3,0,.5,0,'#5f8da0',{segments:8});add(9,.4,1.8,.4,0,1.2,0,'#cfcdc4',{segments:6});add(9,1.5,.2,1.5,0,2.1,0,'#b7b8b2',{segments:8});
  // monument: plinth, column, cap
  add(10,1.5,1,1.5,0,.5,0,'#d8d5cb');add(10,.55,2.6,.55,0,2.3,0,'#e2dfd5');add(10,.9,.35,.9,0,3.75,0,'#d8d5cb');
  // parked car, 4.3 x 1.43 m (1.92 m over the wheels), nose toward +z, on the ground at y = 0 (its row stands it on the highest ground under its wheels). A real silhouette: a body with a sloping bonnet
  // and a short boot over a dark sill, a glasshouse with raked windscreen and rear window (blue-grey glass, a painted roof and a painted B pillar so the side windows read as two), four wheels 62 cm
  // tall under a sill 22 cm off the ground, lights, grille and plate. The paint arrives through the instance colour and tints only the parts flagged as paint; the glass, wheels, sill and lights keep their own
  // colours. The painted faces carry baked shading (roof brightest, flanks and nose darker) so the shape reads without lights.
  add(11,1.82,0,0,0,0,0,'#ffffff',{profile:[[-2.15,.22],[2.15,.22],[2.15,.58],[1.95,.74],[1.0,.84],[-1.15,.86],[-2.05,.8],[-2.15,.62]],paint:1,shade:true});
  add(11,1.56,0,0,0,0,0,'#5a7184',{profile:[[1.05,.84],[.45,1.37],[-.95,1.37],[-1.55,.84]],shade:true});
  add(11,1.6,.06,1.44,0,1.4,-.25,'#ffffff',{paint:1,shade:true});add(11,1.62,.53,.12,0,1.105,-.3,'#ffffff',{paint:1,shade:true});
  add(11,1.86,.12,4.26,0,.28,0,'#2a2d30',{shade:true});
  for(const x of [-.84,.84])for(const z of [-1.35,1.35])add(11,.24,.62,.62,x,.31,z,'#17191b');
  for(const x of [-.55,.55]){add(11,.42,.13,0,x,.46,2.152,'#f4f0d8',{quad:1});add(11,.4,.13,0,x,.48,-2.152,'#b3261e',{quad:-1});}
  add(11,.5,.12,0,0,.44,2.152,'#202326',{quad:1});add(11,.5,.12,0,0,.44,-2.152,'#e8e4d0',{quad:-1});
  // pedestrian-crossing sign: post, blue plate, white pedestrian block
  add(12,.06,2.3,.06,0,1.15,0,grey);add(12,.62,.62,.04,0,2.1,0,'#2a5a9c');add(12,.3,.34,.05,0,2.1,0,'#f4f2ec');add(12,.14,.14,.05,0,2.28,0,'#2a5a9c');
  // rooftop kit of a polykatoikia, four small models: the stair head with a white tank on a stand (14), a solar water heater (a tilted panel on its frame and a drum tank, 15),
  // a TV antenna on a mast (16) and a pergola with a plant box (17)
  add(14,2.6,2.4,2.6,.6,1.2,-1.2,'#b6b2a6');add(14,2.8,.15,2.8,.6,2.45,-1.2,'#9e9a8e');add(14,.9,1.1,.9,-1.2,1.65,1.4,'#eeeeea',{segments:8});add(14,.08,1,.08,-1.55,.5,1.1,'#7d8386');add(14,.08,1,.08,-.85,.5,1.7,'#7d8386');
  add(15,1.5,.07,1.05,-.3,.75,.2,'#243a62',{rotX:-.6});add(15,.08,.7,.08,-.95,.35,.7,'#9a9fa2');add(15,.08,.7,.08,.35,.35,.7,'#9a9fa2');add(15,1.2,.56,.56,-.3,1.25,-.5,'#eeeeea',{segments:8,rotZ:Math.PI/2});
  add(16,.05,3.3,.05,0,1.65,0,'#8c9094');add(16,1.1,.04,.04,0,3.0,0,'#8c9094');add(16,.8,.04,.04,0,2.6,0,'#8c9094');add(16,.5,.04,.04,0,2.2,0,'#8c9094');add(16,.9,.04,.04,0,.12,0,'#6d7377');
  for(const x of [-1.4,1.4])for(const z of [-1,1])add(17,.1,2.2,.1,x,1.1,z,'#d8d3c4');for(const z of [-.8,-.27,.27,.8])add(17,3.2,.06,.12,0,2.25,z,'#9a7a56');add(17,2.6,.45,.5,0,.22,1.35,'#8d5a3d');add(17,2.4,.3,.4,0,.6,1.35,'#5f8c45');
  // scooter (the paint arrives through the instance colour): two wheels, the floor board, the body cover, the seat, the leg shield, the handlebar
  for(const z of [-.6,.62])add(18,.14,.5,.5,0,.25,z,'#202224',{segments:6,rotZ:Math.PI/2});add(18,.32,.1,1.05,0,.33,0,'#ffffff');add(18,.3,.38,.55,0,.5,-.5,'#ffffff');add(18,.3,.1,.6,0,.75,-.45,'#2a2c2e');add(18,.36,.62,.08,0,.62,.52,'#ffffff');add(18,.7,.05,.05,0,1.0,.55,'#3a3d40');add(18,.14,.4,.08,0,.82,.55,'#8a9094');
  // signal: pole, short arm over the kerb, head housing with a backplate and its three lamps (red, amber, green) on the face toward oncoming traffic
  add(13,.12,4.6,.12,0,2.3,0,grey);add(13,.8,.09,.09,-.4,4.15,0,grey);add(13,.44,1.3,.34,-.8,3.7,0,'#16181a');add(13,.7,1.55,.04,-.8,3.7,.19,'#16181a');add(13,.76,.06,.05,-.8,4.52,.2,'#e8e6dc');
  [['#ff2a14',1,.4],['#ffa800',2,0],['#14ff6a',3,-.4]].forEach(([c,i,y])=>P.push(part(.27,.04,.27,-.8,3.7+y,-.18,c,{kind:13,lamp:i,segments:6,faceZ:true})));
  return P;
}
/** One merged geometry per model, so each draw call carries only that model's triangles. */
export function kindGeometry(kind){
  const parts=propParts().filter(g=>g.attributes.aKind.array[0]===kind);for(const g of parts)g.deleteAttribute('aKind');
  if(kind!==KINDS.parked_car)for(const g of parts)g.deleteAttribute('aPaint');
  const g=mergeGeometries(parts,false);if(!g)throw new Error('prop geometry '+kind);return g;
}
export function propGeometry(){return mergeGeometries(propParts(),false);}  // every model in one geometry (budget checks)

const SIGNAL_VERTEX='attribute float aLamp;attribute float iState;varying float vLit;';
/** Plain unlit props (vertex colour times instance colour). */
export function propMaterial(){return new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});}
/** Parked cars: vertex colour, and the instance colour (the paint) tints only the vertices flagged `aPaint`, so glass, wheels, sill and lights keep their own colours. */
export function carMaterial(){
  const m=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
  m.customProgramCacheKey=()=>'athens-car-v1';
  m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aPaint;').replace('#include <color_vertex>','vColor=vec3(1.0);\n#ifdef USE_COLOR\nvColor*=color;\n#endif\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz*=mix(vec3(1.0),instanceColor.xyz,aPaint);\n#endif');};
  return m;
}
/** Signal heads: the lamp whose number equals the instance's state is lit, the others dim. */
export function signalMaterial(){
  const m=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
  m.customProgramCacheKey=()=>'athens-signal-v2';
  m.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>\n${SIGNAL_VERTEX}`).replace('#include <begin_vertex>','#include <begin_vertex>\nvLit=aLamp<.5?-1.:(abs(aLamp-iState)<.5?1.:0.);');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying float vLit;').replace('#include <color_fragment>','#include <color_fragment>\nif(vLit>-.5)diffuseColor.rgb*=mix(.16,1.35,vLit);');
  };
  return m;
}
const KIND_CAPACITY={[KINDS.lamp]:400,[KINDS.signal]:240,[KINDS.parked_car]:300,[KINDS.scooter]:260,[KINDS.rooftop]:150,[KINDS.solar]:480,[KINDS.antenna]:260,[KINDS.pergola]:100};

/** All instances: (kind, x, y, z, yaw, variant, state?) with absolute world x,z. */
export class AthensProps{
  constructor(parent,{enabled=true,skip=null}={}){
    this.skip=skip;this.capacity=PROP_LIMITS.capacity;this.timeOverride=null; // set only by tests and evidence scripts to freeze the signal clock
    this.tiles=new Map();this.byEdge=new Map();this.near=[];this.last={x:Infinity,z:Infinity};this.enabled=enabled;this.time=0;
    this.group=new THREE.Group();this.group.name='athens-props-layer';parent.add(this.group);this.group.visible=enabled;
    this.meshes=new Map();this.signalState=null;
    for(const kind of Object.values(KINDS)){
      const cap=KIND_CAPACITY[kind]||100,geometry=kindGeometry(kind);let material=kind===KINDS.parked_car?carMaterial():propMaterial();
      if(kind===KINDS.signal){this.signalState=new THREE.InstancedBufferAttribute(new Float32Array(cap),1);this.signalState.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('iState',this.signalState);material=signalMaterial();}
      const mesh=new THREE.InstancedMesh(geometry,material,cap);mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.name='athens-props:'+kind;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);this.meshes.set(kind,{mesh,cap});
    }
    // one soft contact shadow under every car, scooter, kiosk, shelter, bench, fountain and monument in range: an alpha-blended dark disc, one draw call
    const disc=new THREE.CircleGeometry(1,10);disc.rotateX(-Math.PI/2);
    this.shadow=new THREE.InstancedMesh(disc,new THREE.MeshBasicMaterial({color:0x0c0f10,transparent:true,opacity:.3,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),PROP_LIMITS.capacity);
    this.shadow.count=0;this.shadow.visible=false;this.shadow.frustumCulled=false;this.shadow.name='athens-props:shadows';this.shadow.renderOrder=2;this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(this.shadow);
    this.stats={instances:0,signals:0,drawCalls:0,rebuilds:0};this._m=new THREE.Matrix4();this._q=new THREE.Quaternion();this._e=new THREE.Euler();this._p=new THREE.Vector3();this._s=new THREE.Vector3(1,1,1);this._c=new THREE.Color();
  }
  /** Read a decoded tile's rows. `ids`, `origin` and the `worldDetail` extension come from its metadata. */
  addTile(key,packet){
    this.removeTile(key);const m=packet.metadata,ext=m.extensions?.worldDetail,o=m.origin,records=[],edges=[];
    const sig=ext?.signals,props=ext?.props,roofs=ext?.rooftops;
    if(props){const r=packet.arrays[props.rows],k=packet.arrays[props.kind];for(let i=0;i<k.length;i++){const x=r[i*5]+o[0],z=r[i*5+2]+o[2];if(this.skip&&this.skip(k[i],x,z))continue;records.push({kind:k[i],x,y:r[i*5+1],z,yaw:r[i*5+3],variant:r[i*5+4]|0,state:0});}}
    if(ext?.parking!=null){const r=packet.arrays[ext.parking];for(let i=0;i<r.length;i+=5){const code=r[i+4]|0;records.push({kind:(code>>3)?KINDS.scooter:KINDS.parked_car,x:r[i]+o[0],y:r[i+1],z:r[i+2]+o[2],yaw:r[i+3],variant:code&7,state:0});}}
    if(roofs!=null){const r=packet.arrays[roofs];for(let i=0;i<r.length;i+=5){const code=r[i+4]|0;records.push({kind:KINDS.rooftop+(code>>2),x:r[i]+o[0],y:r[i+1],z:r[i+2]+o[2],yaw:r[i+3],variant:code&3,state:0});}}
    if(sig){const r=packet.arrays[sig.rows],e=packet.arrays[sig.edge];
      for(let i=0;i<e.length;i++){const rec={kind:KINDS.signal,x:r[i*6]+o[0],y:r[i*6+1],z:r[i*6+2]+o[2],yaw:r[i*6+3],offset:r[i*6+4],group:r[i*6+5],variant:0,state:0,edge:m.ids[e[i]]};records.push(rec);edges.push(rec);this.byEdge.set(rec.edge,rec);}}
    this.tiles.set(key,{records,edges});this.last.x=Infinity;
  }
  removeTile(key){const t=this.tiles.get(key);if(!t)return;for(const rec of t.edges)if(this.byEdge.get(rec.edge)===rec)this.byEdge.delete(rec.edge);this.tiles.delete(key);this.last.x=Infinity;}
  setEnabled(on){if(this.enabled===on)return;this.enabled=on;this.group.visible=on;this.last.x=Infinity;}
  /** Nearest records first, each within its model's range (PROP_NEAR), at most `capacity`. */
  collect(x,z){
    const out=[];
    for(const {records} of this.tiles.values())for(const r of records){const d=Math.hypot(r.x-x,r.z-z);if(d<NEAR_BY_KIND[r.kind])out.push({r,d});}
    out.sort((a,b)=>a.d-b.d);if(out.length>this.capacity)out.length=this.capacity;return out.map(v=>v.r);
  }
  update(camera,time){
    this.time=this.timeOverride??time;if(!this.enabled)return;const p=camera.position||camera;
    if(Math.hypot(p.x-this.last.x,p.z-this.last.z)>=PROP_LIMITS.rebuildMetres){this.rebuild(p.x,p.z);}
    this.refreshSignals();
  }
  rebuild(x,z){
    const near=this.collect(x,z),M=this._m,Q=this._q,E=this._e,V=this._p,S=this._s,C=this._c,used=new Map();this.near=[];
    for(const r of near){const slot=this.meshes.get(r.kind),n=used.get(r.kind)||0;if(n>=slot.cap)continue;used.set(r.kind,n+1);r.slot=n;this.near.push(r);
      M.compose(V.set(r.x,r.y,r.z),Q.setFromEuler(E.set(0,r.yaw,0)),S);slot.mesh.setMatrixAt(n,M);
      slot.mesh.setColorAt(n,r.kind===KINDS.parked_car||r.kind===KINDS.scooter?C.set(CAR_PAINT[r.variant%CAR_PAINT.length]):C.set('#ffffff'));}
    let sh=0;for(const r of this.near){const q=SHADOW[r.kind];if(!q)continue;const cs=Math.cos(r.yaw),sn=Math.sin(r.yaw);
      M.compose(V.set(r.x+.28+q[1]*.05,r.y+.04,r.z+.2+q[1]*.04),Q.setFromEuler(E.set(0,r.yaw,0)),S.set(q[0],1,q[1]));this.shadow.setMatrixAt(sh++,M);void cs;void sn;}
    this.shadow.count=sh;this.shadow.visible=sh>0;if(sh)this.shadow.instanceMatrix.needsUpdate=true;
    let calls=sh>0?1:0;
    for(const [kind,{mesh}] of this.meshes){const n=used.get(kind)||0;mesh.count=n;mesh.visible=n>0;if(n){calls++;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}}
    this.last={x,z};this.stats={instances:this.near.length,signals:used.get(KINDS.signal)||0,drawCalls:calls,rebuilds:this.stats.rebuilds+1};this.refreshSignals(true);
  }
  /** Rewrites a lamp state only when a signal changes phase. */
  refreshSignals(force=false){
    let changed=force;const arr=this.signalState.array;
    for(const r of this.near){if(r.kind!==KINDS.signal)continue;const s=STATE_CODE[signalState(r.group,r.offset,this.time)];if(arr[r.slot]!==s||force){arr[r.slot]=s;changed=true;}}
    if(changed)this.signalState.needsUpdate=true;
  }
  /** Is a car on `point.edge` held by a signal that is not green? Cars already past the stop line (the last 3.5 m) carry on. */
  hold(point,edgePoints){
    if(!this.enabled)return false;const rec=this.byEdge.get(point.edge);if(!rec)return false;
    if(signalState(rec.group,rec.offset,this.time)==='G')return false;
    const end=edgePoints[edgePoints.length-1],d=Math.hypot(end[0]-point.x,end[2]-point.z);
    return d<=STOP_OFF+.9&&d>STOP_OFF-3.5;
  }
  dispose(){this.group.removeFromParent();for(const {mesh} of this.meshes.values()){mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();}this.tiles.clear();this.byEdge.clear();}
}
