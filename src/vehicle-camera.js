// Keep ordinary cars' framing, then make room for a truck or a full-size bus.
export function chaseRig(spec,speedFraction=0){
 const height=spec.height||1.5,length=spec.length||4;
 return {back:Math.max(5.6,length*.65+2)+speedFraction*1.2,up:Math.max(1.75,height*1.05)+speedFraction*.15,targetY:Math.max(1,height*.5)};
}
