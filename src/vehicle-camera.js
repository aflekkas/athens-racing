// Keep ordinary cars' framing, then make room for a truck or a full-size bus.
export function chaseRig(spec,speedFraction=0){
 const height=spec.height||1.5,length=spec.length||4;
 return {back:Math.max(5.6,length*(length>8?.85:.65)+2)+speedFraction*1.2,up:Math.max(1.75,height*(length>8?1.4:1.05))+speedFraction*.15,targetY:Math.max(1,height*.5)};
}

// A bounding sphere fits the full vehicle at every turntable angle, including portrait screens.
export function showroomRig(spec,aspect=1,fov=35,baseDistance=8.3){
 if(!spec.nativeFleet)return {distance:baseDistance,targetY:.65};
 const h=(spec.height||1.5),r=Math.hypot(spec.length,spec.width,h)/2;
 const half=Math.atan(Math.tan(fov*Math.PI/360)*Math.min(1,aspect));
 return {distance:Math.max(baseDistance,r/Math.sin(half)*1.08),targetY:h/2};
}
