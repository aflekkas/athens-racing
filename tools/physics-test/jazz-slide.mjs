// Deterministic driver: enter with a short handbrake flick, then constant throttle
// and sideslip/yaw feedback only. No velocity, yaw or grip edits after entry.
export const jazzSlideInput = v => {
 const beta=Math.atan2(v.vLat,Math.max(2,Math.abs(v.vLong)));
 return {throttle:.7,brake:0,steer:Math.max(-1,Math.min(1,-3*(-beta-.4)-.5*v.w)),handbrake:false};
};
export function jazzSlide(Vehicle,spec,route,onFrame){
 const dt=1/60,v=new Vehicle(spec,route);v.reset(0,0,70/3.6);
 for(let i=0;i<90;i++){v.update(dt,{throttle:.25,brake:0,steer:0});v.vLong=70/3.6;}
 for(let i=0;i<24;i++)v.update(dt,{throttle:0,brake:0,steer:.6,handbrake:i<21});
 let run=0,best=0,minSpeed=Infinity,peakBeta=0;
 for(let i=0;i<480;i++){
  v.update(dt,jazzSlideInput(v));
  const beta=Math.atan2(v.vLat,Math.max(2,Math.abs(v.vLong))),speed=Math.hypot(v.vLong,v.vLat)*3.6;
  peakBeta=Math.max(peakBeta,Math.abs(beta));
  if(beta<=-.3&&beta>=-.6&&speed>20){run+=dt;best=Math.max(best,run);minSpeed=Math.min(minSpeed,speed);}else run=0;
  onFrame?.(v,{frame:i,beta,speed,run});
 }
 return {v,best,minSpeed,peakBeta};
}
