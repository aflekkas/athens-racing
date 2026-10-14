// Preset traits and seated props extend the existing human driver and arm IK.
// Passenger roots stay beside the driver, so cockpit head hiding never hides them.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {sprayCanGeometry} from './spray-can.js';

export function createCharacterRig(driver,{passengerFactory,seatRole}={}){
  const passengerRole=seatRole==='passenger',head=driver.head,material=driver.appearanceMaterials.hair;
  const messy=new THREE.Group();messy.name='straight-ruffled-hair';head.add(messy);
  // Straight locks sweep off the crown and fall down over the forehead/sides.
  // Rounded ends and a continuous scalp avoid the previous upright cone spikes.
  const locks=[],strandEnds=[];
  const strand=(root,middle,tip)=>{
    const points=[root,middle,tip].map(p=>new THREE.Vector3(...p));
    locks.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),8,.0037,5,false));
    strandEnds.push({root,tip});
  };
  for(let i=0;i<16;i++){
    const x=-.061+i*.0082,offset=Math.sin(i*2.1)*.016;
    strand([x,.123-Math.abs(x)*.15+Math.sin(i*1.3)*.006,.004],[x+offset*.5,.092,-.058],[x+offset,.027+(i%5)*.009,-.091+Math.abs(x+offset)*.38]);
  }
  for(let i=0;i<4;i++)strand([-.055+i*.011,.123,.026],[.010+i*.006,.097,-.045],[.046+i*.007,.043+i*.004,-.070]);
  for(const side of [-1,1])for(let i=0;i<4;i++){
    const z=-.014+i*.021;
    strand([side*.062,.106,z],[side*.083,.053,z+.009],[side*.091,-.009+(i%2)*.007,z+.015]);
  }
  for(let i=0;i<6;i++){
    const x=-.055+i*.022;
    strand([x,.110,.039],[x,.068,.086],[x,-.037+(i%3)*.009,.096]);
  }
  const strands=new THREE.Mesh(mergeGeometries(locks),material);strands.name='falling-straight-strands';messy.add(strands);locks.forEach(g=>g.dispose());
  messy.userData.strandEnds=strandEnds;
  const long=new THREE.Group();long.name='shoulder-length-hair';head.add(long);
  const longLock=new THREE.SphereGeometry(1,12,8);
  for(const [x,y,z,sx,sy,sz] of [[0,-.017,.082,.084,.164,.028],[-.084,-.038,.018,.024,.141,.052],[.084,-.038,.018,.024,.141,.052]]){
    const mesh=new THREE.Mesh(longLock,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);long.add(mesh);
  }
  const can=new THREE.Mesh(sprayCanGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.24}));
  can.name='held-spray-can';can.castShadow=true;driver.arms[1].hand.add(can);
  const restBase=driver.hairBase.scale.clone(),v=new THREE.Vector3(),q=new THREE.Quaternion(),e=new THREE.Euler();
  let model,passengerSeat=false,look={},lower=0,canColor='#ef57aa';
  const carWheel={pos:new THREE.Vector3(),euler:new THREE.Euler(-.36,0,0),angle:0,r:.18};
  const seat=()=>{
    if(!model)return;
    const scale=driver.root.scale.y;
    driver.root.position.copy(model.seat);if(passengerSeat)driver.root.position.x=-model.seat.x;
    driver.root.userData.seat=passengerSeat?'front-passenger':'front-driver';
    // Keep the hip at the same cushion while a shorter torso lowers the head.
    driver.root.position.y+=-.195+(scale-1)*.52;driver.root.position.z+=.1;
    model.body.add(driver.root);
  };
  const syncPassenger=()=>{
    if(passengerRole)return;
    if(!look.passenger){driver.passenger?.dispose();driver.passenger=null;return;}
    if(!driver.passenger)driver.passenger=passengerFactory({...look.passenger,seatRole:'passenger'});
    else driver.passenger.setAppearance(look.passenger);
    driver.passenger.root.name='passenger:jonia_peroti';
    if(model)driver.passenger.characterRig.bindCar(model,true);
  };
  const rig={
    passengerRole,
    usesFreeHand:()=>passengerRole||look.accessory==='sprayCan',
    wheelFor(steer){if(!model||passengerRole)return null;carWheel.pos.copy(model.seat).add(v.set(0,-.33,-.43));carWheel.angle=steer*2.5;return carWheel;},
    get canLower(){return lower;},
    can,messy,long,
    get hairThickness(){return 1+((look.hairVolume??1)-1)*.6;},
    adjustHairPosition(point){const volume=look.hairVolume??1,width=1+(volume-1)*.32;point.x*=width;point.z=.013+(point.z-.013)*width;point.y+=Math.max(0,(point.y+.04)/.164)*(volume-1)*.06;},
    bindCar(car,isPassenger=false){model=car;passengerSeat=isPassenger;rig.setAppearance(look);seat();syncPassenger();return driver;},
    setAppearance(next){
      look=next;
      const h=(next.heightCm??175)/175,build={slim:.93,average:1,broad:1.10}[next.build]??1;
      driver.root.scale.set(h*build*(next.gender==='female' ? .95 : 1),h,h);
      const volume=next.hairVolume??1,roof=model&&!model.spec.convertible ? .38 : model&&model.spec.body!=='mini' ? .82 : 1;
      driver.curlMesh.scale.setScalar(roof);
      const width=1+(volume-1)*.32;
      driver.hairBase.scale.copy(restBase).multiply(new THREE.Vector3(width,volume,width)).multiplyScalar(roof===.38 ? .55 : roof===.82 ? .85 : 1);
      driver.hairY=(roof===.38 ? .015 : driver._hairRestY)+(volume-1)*.025*roof;
      driver.hairBase.position.y=driver.hairY;
      messy.visible=!next.helmet&&next.hairStyle==='messy';long.visible=!next.helmet&&next.hairStyle==='long';
      messy.scale.set(volume,Math.min(volume,roof===.38 ? .78 : 1.8),volume);
      can.visible=!passengerRole&&next.accessory==='sprayCan';
      if(next.presetId||passengerRole)for(const arm of driver.arms)arm.up.visible=arm.fo.visible=arm.hand.visible=true;
      const color=next.accessoryColor??'#ef57aa';
      if(color!==canColor){const old=can.geometry;driver._ownedGeometries?.delete(old);old.dispose();can.geometry=sprayCanGeometry(color);driver._ownedGeometries?.add(can.geometry);canColor=color;}
      driver._writeHair();seat();syncPassenger();
    },
    update(dt,t,speed,acc,wheel,steer,heaveV){
      const target=Math.min(1,Math.max(0,(Math.abs(steer)-.25)/.30));
      lower+=(target-lower)*(dt>0?1-Math.exp(-12*dt):1);
      driver.passenger?.update(dt,t,speed,acc,null,steer,heaveV);
    },
    adjustHand(arm,hand,wheel){
      if(passengerRole){hand.set(arm.sx*.10,-.48,-.075);return;}
      if(arm.sx<0||look.accessory!=='sprayCan'||!wheel)return;
      hand.copy(v.set(.08,.23,-.08).applyEuler(wheel.euler).add(wheel.pos).sub(driver.root.position).divide(driver.root.scale));
      hand.lerp(v.set(.15,-.40,-.13),lower);
    },
    orientHand(arm){
      if(passengerRole)arm.hand.quaternion.setFromEuler(e.set(-.35,0,arm.sx*.1));
      else if(arm.sx>0&&look.accessory==='sprayCan')arm.hand.quaternion.copy(q.setFromEuler(e.set(-.18-lower*.45,0,-.12)));
    },
    dispose(){driver.passenger?.dispose();driver.passenger=null;},
  };
  driver.root.userData.characterRole=passengerRole?'passenger':'driver';
  return rig;
}
