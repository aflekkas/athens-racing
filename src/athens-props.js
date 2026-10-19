// Street furniture and working signals for the streamed Athens world, drawn as instanced meshes: one draw call per model that is
// in view (a handful, not one per tile or per prop). Each tile carries `worldDetail.signals` and `worldDetail.props`
// (tools/world-gen/props.py): flat rows of tile-local positions. Signal heads read their lamp from the instance's `iState`, so a
// phase change rewrites one number. World detail Off hides the lot and builds no instances.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {signalState,STOP_OFF} from './signal-plan.js';

export const KINDS=Object.freeze({lamp:0,bus_stop:1,bus_shelter:2,kiosk:3,bench:4,bollard:5,stop:6,give_way:7,oneway:8,fountain:9,monument:10,parked_car:11,crossing:12,signal:13});
export const PROP_LIMITS=Object.freeze({capacity:900,near:230,rebuildMetres:10});
/** How far each model is drawn (metres). Small or rare models stop earlier, so a street scene costs a handful of draw calls, not one per model type. */
export const PROP_NEAR=Object.freeze({lamp:210,signal:230,bus_stop:140,bus_shelter:140,kiosk:140,stop:110,give_way:110,oneway:100,crossing:100,bench:80,bollard:80,fountain:160,monument:160,parked_car:120});
const NEAR_BY_KIND=Object.fromEntries(Object.entries(PROP_NEAR).map(([n,d])=>[KINDS[n],d]));
const CAR_PAINT=['#e9e9e6','#9ea4a8','#26292c','#2f4d78','#8c2f2b','#b9a98a'];
const STATE_CODE={R:1,A:2,G:3};

function part(w,h,d,x,y,z,colour,{kind,lamp=0,rotZ=0,segments=0,faceZ=false}={}){
  const g=segments?new THREE.CylinderGeometry(w/2,w/2,h,segments):new THREE.BoxGeometry(w,h,d);
  if(faceZ)g.rotateX(Math.PI/2);if(rotZ)g.rotateZ(rotZ);g.translate(x,y,z);g.deleteAttribute('uv');g.deleteAttribute('normal');
  const c=new THREE.Color(colour),n=g.attributes.position.count,col=new Float32Array(n*3),k=new Float32Array(n).fill(kind),l=new Float32Array(n).fill(lamp);
  for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('aKind',new THREE.BufferAttribute(k,1));g.setAttribute('aLamp',new THREE.BufferAttribute(l,1));
  return g;
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
  // parked car: body, cabin, four wheel blocks (paint arrives through the instance colour)
  add(11,1.8,.7,4.2,0,.6,0,'#ffffff');add(11,1.55,.55,2.2,0,1.2,.2,'#9aa5ac');for(const x of [-.82,.82])for(const z of [-1.3,1.3])add(11,.22,.55,.55,x,.28,z,'#1a1c1e');
  // pedestrian-crossing sign: post, blue plate, white pedestrian block
  add(12,.06,2.3,.06,0,1.15,0,grey);add(12,.62,.62,.04,0,2.1,0,'#2a5a9c');add(12,.3,.34,.05,0,2.1,0,'#f4f2ec');add(12,.14,.14,.05,0,2.28,0,'#2a5a9c');
  // signal: pole, short arm over the kerb, head housing with a backplate and its three lamps (red, amber, green) on the face toward oncoming traffic
  add(13,.12,4.6,.12,0,2.3,0,grey);add(13,.8,.09,.09,-.4,4.15,0,grey);add(13,.44,1.3,.34,-.8,3.7,0,'#16181a');add(13,.7,1.55,.04,-.8,3.7,.19,'#16181a');add(13,.76,.06,.05,-.8,4.52,.2,'#e8e6dc');
  [['#ff2a14',1,.4],['#ffa800',2,0],['#14ff6a',3,-.4]].forEach(([c,i,y])=>P.push(part(.27,.04,.27,-.8,3.7+y,-.18,c,{kind:13,lamp:i,segments:6,faceZ:true})));
  return P;
}
/** One merged geometry per model, so each draw call carries only that model's triangles. */
export function kindGeometry(kind){
  const parts=propParts().filter(g=>g.attributes.aKind.array[0]===kind);for(const g of parts)g.deleteAttribute('aKind');
  const g=mergeGeometries(parts,false);if(!g)throw new Error('prop geometry '+kind);return g;
}
export function propGeometry(){return mergeGeometries(propParts(),false);}  // every model in one geometry (budget checks)

const SIGNAL_VERTEX='attribute float aLamp;attribute float iState;varying float vLit;';
/** Plain unlit props (vertex colour times instance colour). */
export function propMaterial(){return new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});}
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
const KIND_CAPACITY={[KINDS.lamp]:400,[KINDS.signal]:240,[KINDS.parked_car]:160};

/** All instances: (kind, x, y, z, yaw, variant, state?) with absolute world x,z. */
export class AthensProps{
  constructor(parent,{enabled=true}={}){
    this.capacity=PROP_LIMITS.capacity;this.timeOverride=null; // set only by tests and evidence scripts to freeze the signal clock
    this.tiles=new Map();this.byEdge=new Map();this.near=[];this.last={x:Infinity,z:Infinity};this.enabled=enabled;this.time=0;
    this.group=new THREE.Group();this.group.name='athens-props-layer';parent.add(this.group);this.group.visible=enabled;
    this.meshes=new Map();this.signalState=null;
    for(const kind of Object.values(KINDS)){
      const cap=KIND_CAPACITY[kind]||100,geometry=kindGeometry(kind);let material=propMaterial();
      if(kind===KINDS.signal){this.signalState=new THREE.InstancedBufferAttribute(new Float32Array(cap),1);this.signalState.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('iState',this.signalState);material=signalMaterial();}
      const mesh=new THREE.InstancedMesh(geometry,material,cap);mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.name='athens-props:'+kind;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);this.meshes.set(kind,{mesh,cap});
    }
    this.stats={instances:0,signals:0,drawCalls:0,rebuilds:0};this._m=new THREE.Matrix4();this._q=new THREE.Quaternion();this._e=new THREE.Euler();this._p=new THREE.Vector3();this._s=new THREE.Vector3(1,1,1);this._c=new THREE.Color();
  }
  /** Read a decoded tile's rows. `ids`, `origin` and the `worldDetail` extension come from its metadata. */
  addTile(key,packet){
    this.removeTile(key);const m=packet.metadata,ext=m.extensions?.worldDetail,o=m.origin,records=[],edges=[];
    const sig=ext?.signals,props=ext?.props;
    if(props){const r=packet.arrays[props.rows],k=packet.arrays[props.kind];for(let i=0;i<k.length;i++)records.push({kind:k[i],x:r[i*5]+o[0],y:r[i*5+1],z:r[i*5+2]+o[2],yaw:r[i*5+3],variant:r[i*5+4]|0,state:0});}
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
      slot.mesh.setColorAt(n,r.kind===KINDS.parked_car?C.set(CAR_PAINT[r.variant%CAR_PAINT.length]):C.set('#ffffff'));}
    let calls=0;
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
