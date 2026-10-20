import {installFleetLOD} from './vehicle-distance.js';
// Adapt the original traffic bodies into close-up, drivable vehicles. No fleet geometry copies.
import * as THREE from 'three';
import {buildPassengerModel,PASSENGER_MODELS} from './traffic-passenger-models.js';
import {buildCommercialModel,COMMERCIAL_MODELS} from './traffic-commercial-models.js';
import {damageSystem} from './vehicle-models.js';
import {stripAddOnPanels} from './vehicle-styling.js';
export const NATIVE_FLEET_MODELS={...PASSENGER_MODELS,...COMMERCIAL_MODELS};
export function buildPlayerFleet(car){
 const spec=car.spec,id=spec.nativeFleet,d=NATIVE_FLEET_MODELS[id];
 if(!d)throw new Error('Missing playable fleet body: '+id);
 const build=COMMERCIAL_MODELS[id]?buildCommercialModel:buildPassengerModel;
 const source=build({id},spec.color,null,{low:false,parked:true,playerCabin:true});
 Object.assign(car,source,{spec,modelKind:spec.body,nativeFleet:true});
 car.shape={...d,belt:d.belt??1.22,cowl:d.cowl??-d.L/2+.25,header:d.header??-d.L/2+.4,seatZ:spec.cameraRig.eye[2],eyeY:spec.cameraRig.eye[1]};
 car.seat=new THREE.Vector3(...spec.cameraRig.eye);
 const w=spec.cameraRig.wheel||[car.seat.x,car.seat.y-.4,car.seat.z-.43];
 car.dash={w:d.W-.25,y:w[1],z:w[2],x:w[0],wheelY:w[1],wheelZ:w[2],wheelR:.19};
 car.exhaust=spec.electric?[]:[new THREE.Vector3(-d.W*.28,.25,d.L/2-.1)];
 stripAddOnPanels(car.body); // one clean body here too (src/vehicle-styling.js); the traffic copies of these bodies keep theirs
 car.root.userData.playerDetail=true;
 for(const wheel of car.wheels){wheel.restY=wheel.pivot.position.y;wheel.angle=0;}
 installFleetLOD(car);
 if(!car.disposeDamage)damageSystem(car);
 return car;
}
export function animatePlayerFleet(car,dt,speed,steer,brake,pose,axles){
 car.body.position.y=pose?.heave||0;
 car.body.rotation.set(pose?.pitch||0,0,pose?.roll||0,'YXZ');
 for(const w of car.wheels){
  const corner=axles?.[(w.front?0:2)+(w.side>0?1:0)];
  w.pivot.position.y=w.restY+(Number.isFinite(corner?.zu)?corner.zu:0);
  w.pivot.rotation.y=w.front?-steer:0;
  w.angle=(w.angle-(Number.isFinite(corner?.vw)?corner.vw:speed)*dt/w.r)%(2*Math.PI);w.spin.rotation.x=w.angle;
 }
 car.tail.emissiveIntensity=brake?2.5:.35;car.setStrobe?.(false);car.updateDamage?.(dt);
}
