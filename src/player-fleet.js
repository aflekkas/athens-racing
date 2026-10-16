import {installFleetLOD} from './vehicle-distance.js';
// Adapt the original traffic bodies into close-up, drivable vehicles. No fleet geometry copies.
import * as THREE from 'three';
import {buildPassengerModel,PASSENGER_MODELS} from './traffic-passenger-models.js';
import {buildCommercialModel,COMMERCIAL_MODELS} from './traffic-commercial-models.js';
import {buildBikeModel,BIKE_SPECS} from './traffic-bike-models.js';
import {buildPoliceModel} from './police-models.js';
import {damageSystem} from './vehicle-models.js';
export const NATIVE_FLEET_MODELS={...PASSENGER_MODELS,...COMMERCIAL_MODELS,...BIKE_SPECS};
export function buildPlayerFleet(car){
 const spec=car.spec,id=spec.nativeFleet,d=NATIVE_FLEET_MODELS[id];
 if(!d)throw new Error('Missing playable fleet body: '+id);
 const build=COMMERCIAL_MODELS[id]?buildCommercialModel:BIKE_SPECS[id]?id==='police_moto'?buildPoliceModel:buildBikeModel:buildPassengerModel;
 const source=build({id,police:id==='police_moto',moto:id==='police_moto'},spec.color,null,{low:false,parked:!spec.twoWheeler,playerCabin:true});
 Object.assign(car,source,{spec,modelKind:spec.body,nativeFleet:true});
 car.shape={...d,belt:d.belt??(spec.twoWheeler?.75:1.22),cowl:d.cowl??-d.L/2+.25,header:d.header??-d.L/2+.4,seatZ:spec.cameraRig.eye[2],eyeY:spec.cameraRig.eye[1]};
 car.seat=new THREE.Vector3(...spec.cameraRig.eye);
 const w=spec.cameraRig.wheel||[car.seat.x,car.seat.y-.4,car.seat.z-.43];
 car.dash={w:d.W-.25,y:w[1],z:w[2],x:w[0],wheelY:w[1],wheelZ:w[2],wheelR:spec.twoWheeler?.11:.19};
 car.exhaust=spec.electric?[]:[new THREE.Vector3(-d.W*.28,.25,d.L/2-.1)];
 car.root.userData.playerDetail=true;
 for(const wheel of car.wheels){wheel.restY=wheel.pivot.position.y;wheel.angle=0;}
 if(id==='police_moto')car.police=true;
 installFleetLOD(car);
 if(!car.disposeDamage)damageSystem(car);
 return car;
}
export function animatePlayerFleet(car,dt,speed,steer,brake,pose,axles,yawRate){
 const s=car.spec;
 if(car.bodyDynamic)pose={heave:0,pitch:0,roll:0};
 car.body.position.y=pose?.heave||0;
 car.body.rotation.set(pose?.pitch||0,0,s.twoWheeler?THREE.MathUtils.clamp(-Math.atan(speed*yawRate/9.81),-.6,.6):pose?.roll||0,'YXZ');
 for(const w of car.wheels){
  const corner=axles?.[axles.length===4?(w.front?0:2)+(w.side>0?1:0):w.front?0:1];
  w.pivot.position.y=w.restY+(Number.isFinite(corner?.zu)?corner.zu:0);
  w.pivot.rotation.y=w.front?-steer:0;
  w.angle=(w.angle-(Number.isFinite(corner?.vw)?corner.vw:speed)*dt/w.r)%(2*Math.PI);w.spin.rotation.x=w.angle;
 }
 car.tail.emissiveIntensity=brake?2.5:.35;car.setStrobe?.(false);car.updateDamage?.(dt);
}
