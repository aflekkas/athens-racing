import * as THREE from 'three';
import { CU } from './env.js';
import { GeoBatch, M, pointInPoly, polyBounds } from './util.js';
import { settings, onSettings } from './settings.js';
import { DETAIL_LIMITS as LIMIT, detailSeed, buildingStyle } from './world-detail-policy.js';
import { createFacadeAtlas } from './facade-atlas.js';
import { DrivableCorridor } from './drivable-corridor.js';

function treeAtlas() {
  const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');
  g.clearRect(0,0,128,128);g.fillStyle='#70634a';g.fillRect(59,64,10,64);
  g.fillStyle='#536d49';g.fillRect(21,28,86,64);g.fillStyle='#637e53';g.fillRect(31,9,66,50);g.fillStyle='#71895b';g.fillRect(40,9,57,17);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function shadedBox() {
  const g=new THREE.BoxGeometry(1,1,1),n=g.attributes.normal,c=[];
  for(let i=0;i<n.count;i++){const light=n.getY(i)>.5?1:n.getY(i)<-.5?.6:n.getX(i)>.5?.88:n.getZ(i)>.5?.76:.65;c.push(light,light,light);}
  g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));return g;
}
const CELL=80;
/** Bounded near rings; shared box and billboard pools, no per-feature mesh.
 * AWT adapters may add/remove tile records through addRecords/removeTile. */
export class WorldDetail {
  constructor(map, parent, heightC) {
    this.map=map;this.parent=parent;this.heightC=map.terrain.sceneryHeight || heightC;this.cells=new Map();this.tiles=new Map();this.last={x:Infinity,z:Infinity};this.enabled=null;
    this.group=new THREE.Group();this.group.name='world-detail-layers';this.group.worldDetailController=this;parent.add(this.group);
    this.boxes=new THREE.InstancedMesh(shadedBox(),new THREE.MeshBasicMaterial({vertexColors:true}),LIMIT.boxes);
    this.cards=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:treeAtlas(),alphaTest:.4,side:THREE.DoubleSide} ),LIMIT.impostors);
    for(const mesh of [this.boxes,this.cards]){mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(mesh);}
    for(const mesh of [this.boxes,this.cards]){
      mesh.material.customProgramCacheKey=()=> 'world-detail-unlit-v1';
      mesh.material.onBeforeCompile=sh=>{sh.uniforms.uDetailNight=CU.uNight;sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uDetailNight;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=mix(vec3(1.),vec3(.09,.12,.18),uDetailNight);');};
    }
    this.stats={updates:0,updateMs:0,boxes:0,impostors:0};
    this.addRecords('base',this.records(map));
    this.unsubscribe=onSettings((s,key)=>{if(!key||key==='worldDetail')this.setEnabled(s.worldDetail!==false);});
    this.setEnabled(settings.worldDetail!==false);
  }
  records(map) {
    const records=[],corridor=new DrivableCorridor(map.route,map.roadNetwork),buildingCells=new Map();
    for(const b of map.data.buildings||[]){const p=b.p?.flat();if(!p?.length)continue;const bb=polyBounds(p),x=(bb.x0+bb.x1)/2,z=(bb.z0+bb.z1)/2;
      const bounds={p,bb};for(let cx=Math.floor(bb.x0/CELL);cx<=Math.floor(bb.x1/CELL);cx++)for(let cz=Math.floor(bb.z0/CELL);cz<=Math.floor(bb.z1/CELL);cz++){const k=cx+','+cz;if(!buildingCells.has(k))buildingCells.set(k,[]);buildingCells.get(k).push(bounds);}
      if(bb.x1-bb.x0<5||bb.z1-bb.z0<5||!pointInPoly(x,z,p))continue;
      const seed=b.detailSeed??detailSeed('way/'+b.id);let top=-Infinity;for(let i=0;i<p.length;i+=2)top=Math.max(top,this.heightC(p[i],p[i+1]));if(!Number.isFinite(top)||top<.2)continue;top+=Math.max(2.6,Number(b.h||b.height)||5.5);
      let width=Math.min(5,bb.x1-bb.x0-2),depth=Math.min(4,bb.z1-bb.z0-2);
      while(width>2.4&&depth>3.1&&[-1,1].some(a=>[-1,1].some(b=>!pointInPoly(x+a*width/2,z+b*depth/2,p)))){width*=.8;depth*=.8;}
      if(width>=2.4&&depth>=3.1&&[-1,1].every(a=>[-1,1].every(b=>pointInPoly(x+a*width/2,z+b*depth/2,p))))records.push({kind:'roof',x,z,y:top,seed,style:buildingStyle(b),width,depth});
    }
    const free=(x,z)=>corridor.distance(x,z,12)>2&&!((buildingCells.get(Math.floor(x/CELL)+','+Math.floor(z/CELL))||[]).some(b=>pointInPoly(x,z,b.p)));
    for(const tree of map.data.vegetation||[]){if(!free(tree.x,tree.z))continue;const y=this.heightC(tree.x,tree.z);if(Number.isFinite(y)&&y>=0)records.push({...tree,kind:'tree',treeKind:tree.kind,y,height:Math.min(10,Math.max(3,tree.height||5.5))});}
    // Street assemblies stay outside the carriageway. Existing mapped lamps,
    // signs and crossings remain the base; these are sparse supplementary props.
    const route=map.route;
    for(let s=35;s<route.length;s+=55){const side=Math.floor(s/55)%2?1:-1,u=side*(route.edge(s)+3.5),p=route.point(s,u),f=route.frame(s,{}),seed=detailSeed(map.id+':street:'+Math.floor(s));
      if(route.urban(s)>.35&&free(p.x,p.z))records.push({kind:'street',x:p.x,z:p.z,y:this.heightC(p.x,p.z),yaw:Math.atan2(f.tx,f.tz),seed});
      if(route.urban(s)<.35){const q=route.point(s,side*(route.edge(s)+13)),y=this.heightC(q.x,q.z),slope=Math.abs(y-this.heightC(q.x+3,q.z+3));if(slope>1&&free(q.x,q.z))records.push({kind:'rock',x:q.x,z:q.z,y,seed});}
    }
    return records;
  }
  addRecords(tile, records) {
    this.removeTile(tile);const entries=[];
    for(const r of records){const key=Math.floor(r.x/CELL)+','+Math.floor(r.z/CELL);if(!this.cells.has(key))this.cells.set(key,new Set());this.cells.get(key).add(r);entries.push([key,r]);}
    this.tiles.set(tile,entries);this.last.x=Infinity;
  }
  removeTile(tile){for(const [key,r] of this.tiles.get(tile)||[]){const cell=this.cells.get(key);cell.delete(r);if(!cell.size)this.cells.delete(key);}this.tiles.delete(tile);this.last.x=Infinity;}
  setEnabled(enabled) {
    if(this.enabled===enabled)return;this.enabled=enabled;this.group.visible=enabled;
    const materials=new Set();this.parent.traverse(o=>{for(const m of [].concat(o.material||[]))if(m.userData.worldFacade)materials.add(m);});
    const old=new Set([...materials].map(m=>m.map).filter(Boolean));
    const atlas=enabled?([...old][0]||createFacadeAtlas()):null;
    for(const m of materials){if(m.map!==atlas){m.map=atlas;m.needsUpdate=true;}}
    if(!enabled)for(const t of old)t.dispose();
    if(enabled&&!this.cards.material.map){this.cards.material.map=treeAtlas();this.cards.material.needsUpdate=true;}
    if(!enabled&&this.cards.material.map){this.cards.material.map.dispose();this.cards.material.map=null;this.cards.material.needsUpdate=true;}
    this.last.x=Infinity;
    if(this.camera)this.update(this.camera);
  }
  update(camera) {
    this.camera=camera;if(!this.enabled)return;
    const p=camera.position||camera;if(Math.hypot(p.x-this.last.x,p.z-this.last.z)<12)return;
    const started=performance.now(),cx=Math.floor(p.x/CELL),cz=Math.floor(p.z/CELL),near=[];
    for(let i=-3;i<=3;i++)for(let j=-3;j<=3;j++)for(const r of this.cells.get((cx+i)+','+(cz+j))||[]){const d=Math.hypot(r.x-p.x,r.z-p.z);if(d<LIMIT.far)near.push({r,d});}
    near.sort((a,b)=>a.d-b.d);let n=0,k=0;
    const color=new THREE.Color(),box=(r,x,y,z,w,h,d,c,ry=0,rx=0)=>{if(n>=LIMIT.boxes)return;const yaw=r.yaw||0,cs=Math.cos(yaw),sn=Math.sin(yaw);this.boxes.setMatrixAt(n,M(r.x+x*cs+z*sn,r.y+y,r.z-x*sn+z*cs,rx,yaw+ry,0,w,h,d));this.boxes.setColorAt(n++,color.set(c));};
    for(const {r,d} of near){const h=r.height||5.5;
      if(r.kind==='tree'){
        if(d<135&&n+3<=LIMIT.boxes){box(r,0,h*.27,0,.23,h*.54,.23,'#76634b');const palm=r.treeKind==='palm',pine=r.treeKind==='conifer';box(r,0,h*(palm?.87:.68),0,h*(palm?.72:pine?.46:.58),h*(palm?.19:.46),h*(palm?.72:pine?.46:.55),'#627d50');box(r,.1,h*.91,0,h*(pine?.25:.40),h*(palm?.15:.30),h*(pine?.25:.39),'#728955');}
        else if(k<LIMIT.impostors){this.cards.setMatrixAt(k++,M(r.x,r.y+h*.55,r.z,0,Math.atan2(p.x-r.x,p.z-r.z),0,h*.7,h*1.1,1));}
      }else if(d<LIMIT.near){
        if(r.kind==='roof'){
          if(n+3>LIMIT.boxes)continue;
          if(r.style===7){box(r,0,.45,0,1.5,.9,1.5,'#879997');}
          else if(r.seed%3!==0){box(r,0,.5,0,1.3,.65,.65,'#b5c5c6');box(r,0,.2,.8,1.8,.12,1.2,'#344e5b',0,-.25);}
          else box(r,0,.65,0,1.1,1.3,1.1,'#aab6b1');
          box(r,0,.14,-r.depth/2,r.width,.28,.14,'#e1ded1');
        }else if(r.kind==='rock'){box(r,0,.4,0,1.8,.9,1.4,'#9d9684',r.seed%6,.2);}
        else {if(n+9>LIMIT.boxes)continue;for(const x of [-1,0,1])box(r,x,.07,-1.1,.94,.14,.24,x===0?'#d0cbbd':'#aaa89a');const kind=r.seed%6;
          if(kind===0){box(r,0,1,0,2,2,1.6,'#b9a779');box(r,0,2.05,0,2.6,.18,2.1,'#759082');box(r,0,1.25, .83,1.4,.65,.04,'#384d55');}
          else if(kind===1){for(const x of [-1.5,1.5])box(r,x,1.3,0,.08,2.6,.08,'#566369');box(r,0,2.6,0,3.4,.15,1.3,'#adb9b4');box(r,0,.5,0,2.6,.12,.55,'#6f7b77');}
          else if(kind===2){box(r,0,.45,0,.6,.9,.6,'#3d6c60');box(r,0,.93,0,.68,.12,.68,'#485957');}
          else if(kind===3){for(const x of [-1,0,1])box(r,x,.4,0,.12,.8,.12,'#555e5f');}
          else if(kind===4){box(r,0,.4,0,.35,.6,1.3,'#506b80');box(r,0,.75,0,.4,.1,.65,'#303b41');box(r,0,.9,.5,.5,.08,.1,'#889491');box(r,0,.65,.5,.06,.5,.06,'#56616a');for(const z of [-.5,.5])box(r,0,.15,z,.12,.3,.3,'#283037');}
          else {box(r,0,2.5,0,.12,5,.12,'#6b7776');box(r,0,4.95,.35,.16,.12,.8,'#d4d8c5');}
        }
      }
    }
    this.boxes.count=n;this.cards.count=k;this.boxes.instanceMatrix.needsUpdate=true;this.cards.instanceMatrix.needsUpdate=true;if(this.boxes.instanceColor)this.boxes.instanceColor.needsUpdate=true;
    this.last={x:p.x,z:p.z};this.stats={updates:this.stats.updates+1,updateMs:performance.now()-started,boxes:n,impostors:k};
  }
  dispose(){this.unsubscribe();this.cells.clear();this.tiles.clear();}
}
