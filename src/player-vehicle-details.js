// Player-only close-up mechanics, signal lamps and articulated damage boundaries.
import * as THREE from 'three';
import { seatMirrors, nearestSurface, mirrorSurfaces } from './vehicle-mirrors.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const PLAYERS=new Set(['mini','z4','taxi','carrera','gr_yaris','gtv','golf','corolla','superb','police_octavia']);
export const isPlayerVehicle=car=>PLAYERS.has(car.spec?.id)||car.spec?.marque==='mercedes'||car.spec?.playerDetail===true;
const v=(x,y,z)=>new THREE.Vector3(x,y,z);
function mesh(p,g,m,name='',pos=[0,0,0]){const o=new THREE.Mesh(g,m);o.name=name;o.position.set(...pos);p.add(o);return o;}
function box(p,m,size,pos,name='',r=.006){return mesh(p,new RoundedBoxGeometry(...size,1,Math.min(r,...size.map(x=>x/2))),m,name,pos);}
function ring(p,m,r,t,x){const g=new THREE.TorusGeometry(r,t,4,32);g.rotateY(Math.PI/2);return mesh(p,g,m,'',[x,0,0]);}
function disc(p,m,r,x){const g=new THREE.CircleGeometry(r,r<.012?8:32);g.rotateY(Math.PI/2);return mesh(p,g,m,'',[x,0,0]);}
function spoke(p,m,x,r0,r1,a0,a1,width){const a=v(x,Math.cos(a0)*r0,Math.sin(a0)*r0),b=v(x,Math.cos(a1)*r1,Math.sin(a1)*r1);const o=mesh(p,new THREE.BoxGeometry(.022,a.distanceTo(b),width),m,'wheel-spoke',a.clone().add(b).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(v(0,1,0),b.sub(a).normalize());}
function wheelDetails(car,d,M){
  const k=car.spec.id,classic=k==='gtv'||car.spec.steelWheels,dark=k==='gr_yaris'||k==='huracan'||d.amg;
  const rimMat=dark?M.darkAlloy:new THREE.MeshStandardMaterial({color:'#c1c6ca',metalness:.92,roughness:.25,side:THREE.DoubleSide});
  const rotorMat=new THREE.MeshStandardMaterial({color:'#64676b',metalness:.78,roughness:.48,side:THREE.DoubleSide});
  M.wheelMetal=rimMat;M.brakeSteel=rotorMat;
  for(const w of car.wheels){
    // Preserve the physics hierarchy and fixed caliper; only replace spinning geometry.
    w.spin.clear();if(d.amg)w.caliper.material=M.red;const s=w.side,width=(w.front?d.tyreF:d.tyreR)||(k==='z4'?(w.front?.255:.275):.215),r=w.r,rim=d.rim,x=s*width*.49;
    const profile=[[rim,-width*.46],[r*.87,-width*.50],[r*.94,-width*.52],[r*.985,-width*.42],[r,-width*.31],[r,width*.31],[r*.985,width*.42],[r*.94,width*.52],[r*.87,width*.50],[rim,width*.46]].map(([a,b])=>new THREE.Vector2(a,b));
    const tyre=new THREE.LatheGeometry(profile,40);tyre.rotateZ(Math.PI/2);mesh(w.spin,tyre,M.rubber,'profiled-tyre');
    for(const f of [-.24,-.08,.08,.24])ring(w.spin,M.seam,r+.0004,.0017,width*f);
    for(const rr of [r*.84,r*.92])ring(w.spin,M.seam,rr,.0015,s*width*.511);
    const barrel=new THREE.CylinderGeometry(rim,rim,width*.82,32,1,true);barrel.rotateZ(Math.PI/2);mesh(w.spin,barrel,M.darkAlloy,'wheel-barrel');
    ring(w.spin,rimMat,rim-.006,.008,x);ring(w.spin,M.darkAlloy,rim-.016,.003,x-s*.006);
    const rotor=new THREE.CylinderGeometry(rim*.83,rim*.83,.012,32);rotor.rotateZ(Math.PI/2);mesh(w.spin,rotor,rotorMat,'brake-rotor',[s*width*.24,0,0]);
    ring(w.spin,M.darkAlloy,rim*.39,.006,s*width*.272);
    if(classic){
      // Pressed 14-inch turbina steel wheel, radial openings and the small centre cap.
      for(let i=0;i<16;i++){const a=i*Math.PI/8;spoke(w.spin,M.alloy,x,.072,rim-.011,a,a+.14,.025);}
      disc(w.spin,M.chrome,.068,x+s*.013);ring(w.spin,M.chrome,.063,.004,x+s*.014);
    }else{
      const n=d.sculpted&&d.doors===2?10:k==='taxi'?5:k==='gr_yaris'||d.amg?10:5;
      for(let i=0;i<n;i++){
        const a=i*2*Math.PI/n;
        if(d.sculpted&&d.doors===2){for(const b of [-1,1])spoke(w.spin,rimMat,x,.05,rim-.009,a+b*.045,a+b*.065,.010);}else if(k==='gr_yaris'||d.amg)spoke(w.spin,rimMat,x,.042,rim-.012,a,a+.035,.017);
        else if(k==='huracan'){for(const b of [-1,1]){spoke(w.spin,M.darkAlloy,x,.046,rim*.48,a,a,.030);spoke(w.spin,M.darkAlloy,x,rim*.48,rim-.009,a,a+b*.30,.029);spoke(w.spin,M.chrome,x+s*.012,rim*.48,rim-.009,a,a+b*.30,.006);}}
        else if(k==='f348'){
          // Cast five-point star: broad root, tapering blade and a narrow rim landing.
          const shape=new THREE.Shape();shape.moveTo(-.037,.032);shape.lineTo(-.034,.105);shape.lineTo(-.015,rim-.010);shape.lineTo(.015,rim-.010);shape.lineTo(.034,.105);shape.lineTo(.037,.032);shape.closePath();
          const g=new THREE.ExtrudeGeometry(shape,{depth:.024,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.003,bevelThickness:.002});g.rotateY(Math.PI/2);g.rotateX(a);
          mesh(w.spin,g,rimMat,'wheel-spoke',[x-.012,0,0]);
        }
        else if(k==='p928')spoke(w.spin,rimMat,x,.045,rim-.012,a,a+.05,.066); // Five broad, smooth Cup spokes.
        else if(k==='taxi')spoke(w.spin,rimMat,x,.045,rim-.012,a,a+.10,.045);
        else for(const b of [-1,1]){spoke(w.spin,rimMat,x,.046,rim*.59,a+b*.07,a+b*.075,k==='mini'?.025:.022);spoke(w.spin,rimMat,x,rim*.59,rim-.012,a+b*.075,a+b*(k==='mini'?.18:.12),.019);}
      }
      disc(w.spin,M.darkAlloy,.054,x+s*.010);
    }
    disc(w.spin,M.badge,classic?.025:.031,x+s*(classic?.016:.014));
    const bolts=classic?4:5;for(let i=0;i<bolts;i++){const a=i*Math.PI*2/bolts;const o=disc(w.spin,M.chrome,.006,x+s*.018);o.position.y=Math.cos(a)*.046;o.position.z=Math.sin(a)*.046;}
    // Rotor drilled holes sit on the outboard rotor face, not on top of the spokes.
    if(k==='carrera'||k==='z4')for(let i=0;i<24;i++){const a=i*Math.PI/12;const o=disc(w.spin,M.darkAlloy,.0028,s*(width*.24+.0064));o.position.y=Math.cos(a)*rim*.69;o.position.z=Math.sin(a)*rim*.69;}
    if(car.spec.rearDrums&&!w.front){w.caliper.visible=false;const drum=new THREE.CylinderGeometry(rim*.82,rim*.82,.07,24);drum.rotateZ(Math.PI/2);mesh(w.spin,drum,M.darkAlloy,'rear-brake-drum',[s*width*.24,0,0]);}
    const valve=box(w.spin,M.rubber,[.025,.009,.009],[x,rim*.84,.027],'tyre-valve');valve.rotation.z=-.35*s;
  }
}
function paintFinish(car){
  const m=car.paint;m.clearcoat=1;m.clearcoatRoughness=.075;
  // Sub-pixel flakes average out with distance; no texture download or extra draw.
  m.customProgramCacheKey=()=> 'player-microflake-v1';
  m.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPaintPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintPosition=position;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vPaintPosition;').replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      float grain=fract(sin(dot(floor(vPaintPosition*1900.0),vec3(12.9898,78.233,37.719)))*43758.5453);
      float footprint=length(fwidth(vPaintPosition*1900.0));
      roughnessFactor=clamp(roughnessFactor+(grain-.5)*.085*metalness/(1.0+footprint),.045,1.0);`);
  };m.needsUpdate=true;
}
function signals(car,d,M){
  const k=car.spec.id,F=-d.L/2-.032,R=d.L/2+.04;
  const lamp=(color)=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:0,roughness:.23,metalness:.15});
  const left=lamp('#ff7d08'),right=lamp('#ff7d08'),reverse=lamp('#e2eef2');car.signalMaterials={left,right,reverse};
  const positions={mini:[.64,.68,.47],z4:[.69,.60,.77],taxi:[.67,.69,.84],carrera:[.57,.37,.745],gr_yaris:[.68,.69,.86],gtv:[.57,.53,.76]}[k]||[d.W*.37,d.front-.10,d.rear-.12];
  for(const s of [-1,1]){
    const side=s<0?'l':'r',m=s<0?left:right;
    for(const [z,y,end]of [[F,positions[1],'f'],[R,positions[2],'r']]){const o=box(car.body,m,[k==='gtv'?.08:.095,.018,.007],[s*positions[0],y,z],`indicator-${end}${side}`);o.userData.damagePart=`light_${end}${side}`;}
    const o=box(car.body,reverse,[.075,.019,.007],[s*(positions[0]-.11),positions[2]-.037,R],`reverse-${side}`);o.userData.damagePart=`light_r${side}`;
  }
  if(car.spec.fleet||d.mercedes){const panels=mirrorSurfaces(car);car.body.updateMatrixWorld(true);car.body.traverse(o=>{if(o.isMesh&&/^(indicator|reverse)-/.test(o.name)){const hit=nearestSurface(o.position,panels,car.body);if(hit){o.position.copy(hit.point);o.position.z+=Math.sign(o.position.z)*.003;}}});}
  if(car.spec.playerDetail)car.body.traverse(o=>{if(o.isMesh&&/^(indicator|reverse)-/.test(o.name)){const t=Math.max(0,Math.min(1,(Math.abs(o.position.z)-d.L*.34)/(d.L*.16)));o.position.z-=Math.sign(o.position.z)*((k==='huracan'?.34:.16)*t*t*(Math.abs(o.position.x)/(d.W/2))**2+.027);if(k==='huracan'&&o.position.z>0)o.position.z-=.07*t*t*((o.position.y-.56)/.42)**2;}});
  car.indicator='off';car.signalTime=0;
  car.setIndicators=value=>{car.indicator=['left','right','hazard'].includes(value)?value:'off';};
  car.updateSignalLights=(dt,speed)=>{car.signalTime+=Math.max(0,dt);const flash=(car.signalTime%0.8)<.4;left.emissiveIntensity=flash&&(car.indicator==='left'||car.indicator==='hazard')?3.5:0;right.emissiveIntensity=flash&&(car.indicator==='right'||car.indicator==='hazard')?3.5:0;reverse.emissiveIntensity=speed<-.05?2.3:0;if(M.optical?.emissive){M.optical.emissive.set('#e4f2ff');M.optical.emissiveIntensity=car.lightsOn?3.2:0;}};
}
function seatDetails(car,d,M){
  const k=car.spec.id;
  for(const s of [-1,1]){
    const x=s*d.W*.215,z=d.seatZ;
    if(k==='z4')box(car.body,M.seat,[.31,.23,.09],[x,1.03,z+.205],'integrated-seat-headrest',.035);
    const cloth=k==='gr_yaris'?M.cloth:M.seat;
    box(car.body,cloth,[.27,.32,.012],[x,.70,z+.099],'seat-centre-insert',.012);
    if(k==='gtv'||k==='mini')for(let i=-3;i<=3;i++)box(car.body,M.seam,[.003,.30,.003],[x+i*.034,.69,z+.089],'seat-pleat',.001);
  }
}
function interiorDamageTags(car,d,M){
  // Classify furniture before sports surfacing bends its vertices. A curved
  // liner is wider than the original box, so post-surface width tests miss it.
  for(const o of [...car.body.children]){
    if(!o.isMesh)continue;
    o.updateMatrix();o.geometry.computeBoundingBox();const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrix),size=b.getSize(v());
    const p=o.position;
    if(o.material===M.black&&Math.abs(p.x)>d.W*.29&&size.x<.08&&size.y>.25&&size.z>1&&p.y<d.belt){
      o.name='interior-door-liner';o.userData.damageInterior=true;o.userData.damageSide=p.x<0?'left':'right';
    }
    // Carpet and the coarse underfloor cover bridge a deep dent as rigid bars.
    // Separate their halves so only the struck footwell/underfloor retracts.
    if((o.material===M.cloth&&Math.abs(p.y-.36)<.001&&size.y<.08)||o.name==='undertray'){
      for(const side of [-1,1]){const half=o.clone();half.geometry=o.geometry.clone();half.scale.x*=.5;half.position.x+=side*size.x*.25;half.name=o.name==='undertray'?'interior-underfloor':'interior-floor';half.userData.damageInterior=true;half.userData.damageSide=side<0?'left':'right';car.body.add(half);}
      o.removeFromParent();o.geometry.dispose();
    }
  }
}
export function refinePlayerDetails(car,d,M){if(!isPlayerVehicle(car))return;wheelDetails(car,d,M);paintFinish(car);signals(car,d,M);seatDetails(car,d,M);interiorDamageTags(car,d,M);}
function inferPart(o,car,d){
  if(o.userData.damagePart)return o.userData.damagePart;
  for(let p=o.parent;p&&p!==car.body;p=p.parent)if(p.userData.damagePart)return p.userData.damagePart;
  const name=o.name.toLowerCase();if(name.includes('windscreen'))return 'glass_windscreen';
  if(name.startsWith('attached-'))return 'structure';
  if(name.includes('glass')&&!name.includes('lamp'))return 'glass';if(/bonnet|hood/.test(name))return 'bonnet';if(name==='boot'||name.startsWith('boot-'))return 'boot';
  if(name.includes('front-bumper'))return 'bumper_f';if(name.includes('rear-bumper'))return 'bumper_r';
  if(o===car.mirrorL)return 'mirror_l';if(o===car.mirrorR)return 'mirror_r';
  o.geometry.computeBoundingBox();const bounds=o.geometry.boundingBox.clone().applyMatrix4(car.body.matrixWorld.clone().invert().multiply(o.matrixWorld)),p=bounds.getCenter(v());
  const s=p.x<0?'l':'r',end=p.z<0?'f':'r';
  if(name.includes('mirror'))return 'mirror_'+s;
  // A lamp is its complete optical assembly, including non-emissive chrome.
  // Original MINI modules and sports projectors nest these under local groups.
  let lampAssembly=false;
  for(let parent=o.parent;parent&&parent!==car.body;parent=parent.parent){
    if(/light|lamp|projector/.test(parent.name)||parent.children.some(c=>c.isMesh&&c.material===car.materials.head))lampAssembly=true;
  }
  if(lampAssembly||/headlamp|headlight|projector|tail-housing|tail-signature|tail-divider|lamp-rim|lamp-glass|rear-light-signature|rear-lamp-housing/.test(name))return `light_${end}${s}`;
  if(o.material===car.materials.head||o.material===car.materials.tail||o.material===car.materials.led||(o.material===car.materials.red&&Math.abs(p.z)>d.L*.36))return `light_${end}${s}`;
  if(Math.abs(p.x)>d.W*.49&&p.z>d.cowl-.05&&p.z<d.cowl+.32&&p.y>d.belt)return `mirror_${s}`;
  if(Math.abs(p.z)>d.L*.44&&p.y<.48&&bounds.max.y<.52)return p.z<0?'bumper_f':'bumper_r';
  if(name.includes('door')||name.includes('handle'))return `door_${s}${(car.spec.id==='taxi'||car.spec.fleet||d.doors===4)&&p.z>.4?'r':'f'}`;
  return 'structure';
}
export function groupPlayerParts(car,d){
  if(!isPlayerVehicle(car))return null;
  // The steel lamp/tailgate mounting face stays attached. Only the lower plastic
  // cover is detachable; clip crossing triangles exactly at the bumper line.
  for(const o of [...car.body.children].filter(o=>o.isMesh&&['front-bumper','rear-bumper'].includes(o.name))){
    const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry,attrs=Object.entries(g.attributes),count=g.attributes.position.count;
    for(const upper of [false,true]){
      const arrays=Object.fromEntries(attrs.map(([name])=>[name,[]]));
      for(let i=0;i<count;i+=3){let poly=[];for(let j=0;j<3;j++){const p={};for(const [name,a]of attrs)p[name]=Array.from(a.array.slice((i+j)*a.itemSize,(i+j+1)*a.itemSize));poly.push(p);}
        const clipped=[];for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],insideA=upper?a.position[1]>=.48:a.position[1]<=.48,insideB=upper?b.position[1]>=.48:b.position[1]<=.48;if(insideA)clipped.push(a);if(insideA!==insideB){const t=(.48-a.position[1])/(b.position[1]-a.position[1]),p={};for(const [name]of attrs)p[name]=a[name].map((x,k)=>x+(b[name][k]-x)*t);clipped.push(p);}}
        for(let j=1;j<clipped.length-1;j++)for(const p of [clipped[0],clipped[j],clipped[j+1]])for(const [name]of attrs)arrays[name].push(...p[name]);
      }
      if(arrays.position.length){const geo=new THREE.BufferGeometry();for(const [name,a]of attrs)geo.setAttribute(name,new THREE.Float32BufferAttribute(arrays[name],a.itemSize));const part=mesh(car.body,geo,o.material,upper?'attached-'+o.name:o.name);part.position.copy(o.position);part.quaternion.copy(o.quaternion);part.scale.copy(o.scale);}
    }
    o.removeFromParent();if(g!==o.geometry)g.dispose();
  }
  // Partition the actual side skin, so a detached door carries its painted panel
  // rather than merely its handle. Keep the original vertices/normals at joins.
  for(const o of [...car.body.children].filter(o=>o.isMesh&&o.name==='body-side')){
    const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry,a=g.attributes.position,buckets=new Map();
    for(let i=0;i<a.count;i+=3){const x=(a.getX(i)+a.getX(i+1)+a.getX(i+2))/3,y=(a.getY(i)+a.getY(i+1)+a.getY(i+2))/3,z=(a.getZ(i)+a.getZ(i+1)+a.getZ(i+2))/3;
      const rear=(car.spec.id==='taxi'||car.spec.fleet||d.doors===4)&&z>.38,end=(car.spec.id==='taxi'||car.spec.fleet||d.doors===4)?1.12:car.spec.id==='carrera'?.72:.67;
      const id=z>d.cowl+.10&&z<end&&y>.275?`door_${x<0?'l':'r'}${rear?'r':'f'}`:'body-side';
      if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(i,i+1,i+2);
    }
    for(const [id,vertices]of buckets){const out=new THREE.BufferGeometry();for(const [name,attr]of Object.entries(g.attributes)){const data=[];for(const i of vertices)for(let j=0;j<attr.itemSize;j++)data.push(attr.array[i*attr.itemSize+j]);out.setAttribute(name,new THREE.Float32BufferAttribute(data,attr.itemSize));}const part=mesh(car.body,out,o.material,id);part.position.copy(o.position);part.quaternion.copy(o.quaternion);part.scale.copy(o.scale);if(id!=='body-side')part.userData.damagePart=id;}
    o.removeFromParent();if(g!==o.geometry)g.dispose();
  }
  const parts={},keep=new Set([car.windscreen,car.mirrorL,car.mirrorR,...car.exteriorDash.children]);
  car.body.updateMatrixWorld(true);
  car.body.traverse(o=>{if(!o.isMesh)return;if(o.userData.damageInterior){keep.add(o);return;}if(![car.materials.black,car.materials.seat,car.materials.chrome].includes(o.material))return;o.geometry.computeBoundingBox();const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld),size=b.getSize(v()),p=b.getCenter(v());
    const doorTrim=Math.abs(p.x)>d.W*.29&&Math.abs(p.x)<d.W*.5&&size.x<.13&&size.z>.10&&p.y>.45&&p.y<d.belt+.04;
    // A heavily dented door can pass the outer seat cushion as well as its liner.
    // Keep upholstered pieces independent so the hit-side interior can retract.
    const seatTrim=o.material===car.materials.seat&&Math.abs(p.x)>d.W*.10&&p.z>d.cowl&&p.z<d.back+.25;
    if(doorTrim||seatTrim){o.userData.damageInterior=true;o.userData.damageSide=p.x<0?'left':'right';keep.add(o);}
  });
  for(const name of ['structure','bumper_f','bumper_r','bonnet','boot','doors','mirrors','lights','glass']){const g=new THREE.Group();g.name=name;car.body.add(g);parts[name]=g;}
  for(const name of ['door_lf','door_rf',...((car.spec.id==='taxi'||car.spec.fleet||d.doors===4)?['door_lr','door_rr']:[]),'mirror_l','mirror_r','light_fl','light_fr','light_rl','light_rr','glass_windscreen']){const g=new THREE.Group();g.name=name;g.userData.damagePart=name;(name.startsWith('door')?parts.doors:name.startsWith('mirror')?parts.mirrors:name.startsWith('light')?parts.lights:parts.glass).add(g);parts[name]=g;}
  for(const name of ['bumper_f','bumper_r','bonnet','boot'])parts[name].userData.damagePart=name;
  car.body.updateMatrixWorld(true);const all=[];car.body.traverse(o=>{if(o.isMesh&&!car.exteriorDash.children.includes(o))all.push(o);});
  const assignments=all.map(o=>[o,inferPart(o,car,d)]);
  for(const [o,id]of assignments){const target=parts[id]||parts.structure;target.attach(o);}
  // Preserve hit-side hiding without spending a draw per cushion or armrest.
  for(const side of ['left','right']){const interior=new THREE.Group();interior.name='interior-'+side;parts.structure.add(interior);for(const o of all)if(o.userData.damageInterior&&o.userData.damageSide===side){interior.attach(o);keep.delete(o);}batchStatic(interior);for(const o of interior.children){o.userData.damageInterior=true;o.userData.damageSide=side;keep.add(o);}}
  car.playerParts=parts;
  seatMirrors(car);
  for(const name of ['mirror_l','mirror_r']){const g=car.body.getObjectByName(name);if(g)parts[name]=g;}
  const mirrors=[];car.body.traverse(o=>{if(o.userData.mirrorAssembly)mirrors.push(o);});
  for(const g of mirrors)g.traverse(o=>keep.add(o));
  // Retain the real painted shell, glass and lamps at road distance; tiny trim,
  // cabin furniture and optical internals have no useful silhouette at 15 m.
  const medium=new THREE.Group();medium.name='player-road-detail';const batches=new Map();
  for(const o of all){
    if(!o.parent||o.userData.damagePart?.startsWith('mirror')||o===car.mirrorL||o===car.mirrorR)continue;
    const b=o.geometry.boundingBox||new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position),size=b.getSize(v());
    const principal=o.material.userData.playerGlass||o.material.userData.fleetLivery||[car.paint,car.materials.glass,car.materials.head,car.tail,car.materials.led].includes(o.material);
    const broadDark=o.material===car.materials.black&&(/roof|grille|undertray/.test(o.name));
    if(o.userData.damageInterior||o.geometry.type==='TubeGeometry'||(!principal&&!broadDark))continue;
    if(o.material===car.paint&&Math.max(size.x,size.y,size.z)<.18)continue;
    const key=o.material.uuid;if(!batches.has(key))batches.set(key,{material:o.material,geos:[]});
    o.updateWorldMatrix(true,false);let g=o.geometry.clone().applyMatrix4(car.body.matrixWorld.clone().invert().multiply(o.matrixWorld));if(g.index)g=g.toNonIndexed();for(const n of Object.keys(g.attributes))if(!['position','normal','uv'].includes(n))g.deleteAttribute(n);batches.get(key).geos.push(g);
  }
  for(const {material,geos}of batches.values()){const g=mergeGeometries(geos,false);if(g)mesh(medium,g,material,'road-shell');for(const g of geos)g.dispose();}
  car.mediumDetail=medium;
  return {parts,keep};
}
// One far shell per model plus cheap wheel annuli. THREE.LOD updates itself for
// every camera, including multiplayer and rivals; physics never loses its pivots.
export function installPlayerLOD(car,d){
  if(!isPlayerVehicle(car))return;
  const high=new THREE.Group();high.name='player-close-detail';for(const child of [...car.body.children])high.add(child);
  const low=new THREE.Group();low.name='player-distance-shell';const pos=[],idx=[];
  const stations=[[-d.L/2,.82,d.front],[-d.wb/2,1,d.belt],[d.cowl,1,d.belt],[0,1,d.belt],[d.back,1,car.modelKind==='z4'?.975:d.belt],[d.L/2,car.modelKind==='z4'?.84:.85,car.playerSurface?.top(d.L/2)||d.rear]];
  for(const [z,w,y]of stations)for(const [x,h]of [[-w,.19],[-w,y],[0,y+.025],[w,y],[w,.19]])pos.push(x*d.W/2,h,z);
  for(let i=0;i<stations.length-1;i++)for(let j=0;j<4;j++){const a=i*5+j;idx.push(a,a+5,a+1,a+1,a+5,a+6);}
  idx.push(0,1,2,0,2,4,2,3,4,25,27,26,25,29,27,27,29,28);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();mesh(low,g,car.paint,'distant-body');
  if(!d.open){const roof=box(low,d.blackRoof?car.materials.black:car.paint,[d.W-.44,.045,d.roofBack-d.header],[0,d.H-.05,(d.roofBack+d.header)/2],'distant-roof');for(const [a,b]of [[d.cowl,d.header],[d.back,d.roofBack]]){const hatch=d.mercedes&&d.suv&&a===d.back,glassBottom=hatch?d.hatchGlassY:d.belt,glassTop=d.H-.07;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([-d.W/2+.12,glassBottom,a,d.W/2-.12,glassBottom,a,-d.W/2+.22,glassTop,b,d.W/2-.22,glassTop,b],3));geo.setIndex([0,2,1,1,2,3]);geo.computeVertexNormals();mesh(low,geo,car.materials.glass,'distant-glass');}}
  if(car.spec.police){const blue=new THREE.MeshStandardMaterial({color:'#143c75'});for(const side of [-1,1]){box(low,blue,[.008,.18,2.1],[side*(d.W/2+.005),.76,0],'police-stripe');box(low,car.strobeMaterials[side<0?0:1],[.48,.095,.22],[side*.30,d.H+.10,.20],'police-lightbar');}}
  for(const level of [car.mediumDetail,low]){
    for(const side of ['l','r']){const g=car.playerParts['mirror_'+side].clone(true);g.userData.mirrorAssembly=false;level.add(g);}
    seatMirrors(car,level);
  }
  const lod=new THREE.LOD();lod.name='player-body-lod';lod.addLevel(high,0);lod.addLevel(car.mediumDetail,15,.08);lod.addLevel(low,65,.12);car.body.add(lod);car.visualLOD=lod;car.mediumDetail.visible=false;low.visible=false;
  for(const w of car.wheels){const close=new THREE.Group();for(const child of [...w.spin.children])close.add(child);const far=new THREE.Group();const tyre=new THREE.CylinderGeometry(w.r,w.r,.18,12);tyre.rotateZ(Math.PI/2);mesh(far,tyre,car.materials.rubber);disc(far,car.materials.alloy,d.rim,w.side*.094);const mid=new THREE.Group();const mt=new THREE.CylinderGeometry(w.r,w.r,.20,24);mt.rotateZ(Math.PI/2);mesh(mid,mt,car.materials.rubber);disc(mid,car.materials.darkAlloy,d.rim,w.side*.102);for(let i=0;i<5;i++)spoke(mid,car.materials.alloy,w.side*.108,.03,d.rim*.94,i*Math.PI*.4,i*Math.PI*.4,.025);batchStatic(mid);const wl=new THREE.LOD();wl.addLevel(close,0);wl.addLevel(mid,15,.08);wl.addLevel(far,65,.12);w.spin.add(wl);}
}

function batchStatic(parent){const bins=new Map();parent.updateMatrixWorld(true);const inv=parent.matrixWorld.clone().invert();parent.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld));if(g.index)g=g.toNonIndexed();const key=o.material.uuid;if(!bins.has(key))bins.set(key,{material:o.material,geos:[]});bins.get(key).geos.push(g);});parent.clear();for(const {material,geos}of bins.values()){const g=mergeGeometries(geos,false);if(g)mesh(parent,g,material);for(const g of geos)g.dispose();}}
