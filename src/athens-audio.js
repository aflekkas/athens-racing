// The streamed free-roam entry does not run main.js. Feed the same sound engine
// from its live vehicle, without starting a second animation loop or audio graph.
export function createAthensAudio({audio,spec,settings,onSettings,target=window,document:doc=document}) {
 let disposed=false;
 const wheels=Array.from({length:4},()=>({})),traffic=[],p={wheels,traffic,rivals:[],sea:0,seaPan:0,city:.65,beach:0,cliff:0,cicadas:.3,action:0};
 const volumes=values=>{if(disposed)return;audio.setVolumes(values);if(doc.hidden&&audio.mainOut)audio.mainOut.gain.setValueAtTime(0,audio.ctx.currentTime);};
 volumes(settings);audio.setEngine(spec);
 const unlock=()=>{if(!disposed&&!doc.hidden)audio.start();};
 for(const name of ['keydown','pointerdown','click'])target.addEventListener(name,unlock,{capture:true});
 const visibility=()=>{volumes(settings);if(!doc.hidden&&audio.ctx)unlock();};
 doc.addEventListener('visibilitychange',visibility);
 const offSettings=onSettings(volumes);
 return {
  audio,
  update(v,dt,{paused=false,blocked=false,camera='chase',input={},cars=[]}={}) {
   if(disposed||!audio.ctx)return;
   const speed=Math.hypot(v.vLong,v.vLat),muted=paused||blocked||doc.hidden;
   for(let i=0;i<4;i++)Object.assign(wheels[i],v.corners?.[i],{vgx:v._S?.[i]?.vgx??v.vLong});
   Object.assign(p,{dt,damage:v.damage,rpm:v.rpm,redline:spec.redline,load:v.load,throttle:input.throttle||0,handbrake:!!input.handbrake,
    cockpit:camera==='cockpit',manual:v.manual,gearboxType:v.powertrain?.gearboxType||spec.gearboxType||spec.gearbox,
    overrun:v.overrun,shifting:v.shiftT>0,stalled:!!v.engineStalled,shiftStart:v.shiftStartEvent,shiftEnd:v.shiftEndEvent,
    shiftGrind:v.shiftGrind,shiftDuration:v.gearChangeEvent?.duration,gear:v.gear,gearRatio:v.ratio(),shift:v.shiftEvent,
    limiter:v.limiter,boost:v.boost,surfaces:v.wheelSurf,nominalLoad:v.m*9.81/4,menuOpen:muted,muted,
    speed,skid:v.skid,wheelspin:v.wheelspin,lockup:v.lockup,bump:v.bumpHit,rough:v.rough,offroad:v.offroad,
    nitro:v.nitroOn,wb:v.wb,open:!!spec.convertible||camera!=='cockpit'});
   let n=0;
   if(!muted)for(const c of cars){if(!c.active||!c.vehicle)continue;const q=c.vehicle,dx=q.x-v.x,dz=q.z-v.z,d=Math.hypot(dx,dz);if(d>130)continue;
    const t=traffic[n]||(traffic[n]={});n++;Object.assign(t,{id:c.id,spec:c.type?.catalogueCar,kind:c.kind,electric:!!c.type?.electric,
     d,pan:Math.max(-1,Math.min(1,(dx*Math.cos(v.yaw)-dz*Math.sin(v.yaw))/Math.max(1,d))),vr:0,v:Math.abs(c.v||0),acc:c.acc||0});}
   traffic.length=n;audio.update(p);
   // The shared pause treatment ducks world sound; hidden windows are silent.
   if(doc.hidden)audio.mainOut.gain.setValueAtTime(0,audio.ctx.currentTime);
  },
  dispose(){if(disposed)return;disposed=true;offSettings();for(const name of ['keydown','pointerdown','click'])target.removeEventListener(name,unlock,{capture:true});doc.removeEventListener('visibilitychange',visibility);audio.menuObserver?.disconnect();audio.engineOff();audio.ctx?.close()?.catch?.(()=>{});}
 };
}
