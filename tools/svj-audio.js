import {Audio} from '../src/audio.js';
import {Vehicle} from '../src/physics.js';
import {CARS} from '../src/cars.js';
import {ExhaustPulse} from '../src/exhaust-pops.js';
export async function captureSVJ(){
 const ctx=new OfflineAudioContext(2,44100*12,44100),a=new Audio();a.start({context:ctx,recordings:false});a.setVolumes({master:1,engine:1,ambience:0,tyres:0});
 const spec=CARS.find(c=>c.id==='aventador_svj');a.setEngine(spec);
 const route={GR:null,frame:(s,o)=>Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0}),point:(s,u)=>({x:u,z:-s,y:0}),y:()=>0,surfaceY:()=>0,urban:()=>1,edge:()=>900,lin:()=>0,medHalf:()=>0,div:()=>0,project:(x,z)=>({s:-z,u:x})};
 const v=new Vehicle(spec,route),pulse=new ExhaustPulse(),events=[];let failure=null;
 const params={dt:1/60,redline:8500,load:0,rpm:900,speed:0,gear:1,muted:false,throttle:1,wheels:[{},{},{},{}],rivals:[],traffic:[],exhaustPulse:pulse,open:false};
 // OfflineAudioContext suspends let the same live audio graph consume actual physics.
 for(let i=1;i<720;i++){
  const t=i/60;ctx.suspend(t).then(()=>{try{v.update(1/60,{throttle:t<6||t>8?1:0,brake:0,steer:0});pulse.update(1/60,v.powertrainSignals,true);if(pulse.life>0&&events.at(-1)?.serial!==pulse.serial)events.push({time:t,kind:pulse.kind,serial:pulse.serial});params.rpm=v.rpm;params.load=v.load;params.throttle=v.engineThrottle;params.speed=v.vLong;params.gear=v.gear;params.overrun=v.overrun;params.shiftStart=v.shiftStartEvent;params.shiftEnd=v.shiftEndEvent;params.shiftDuration=spec.shiftT;params.gearboxType='amt';params.limiter=v.limiter;a.update(params);}catch(e){failure=String(e.stack||e);}finally{ctx.resume();}});
 }
 const b=await ctx.startRendering();if(failure)throw new Error(failure);const n=b.length,bytes=new ArrayBuffer(44+n*4),d=new DataView(bytes);const txt=(o,s)=>{for(let i=0;i<s.length;i++)d.setUint8(o+i,s.charCodeAt(i));};txt(0,'RIFF');d.setUint32(4,bytes.byteLength-8,true);txt(8,'WAVEfmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,2,true);d.setUint32(24,44100,true);d.setUint32(28,176400,true);d.setUint16(32,4,true);d.setUint16(34,16,true);txt(36,'data');d.setUint32(40,n*4,true);let peak=0;
 for(let i=0;i<n;i++)for(let c=0;c<2;c++){const x=b.getChannelData(c)[i];peak=Math.max(peak,Math.abs(x));d.setInt16(44+i*4+c*2,Math.max(-1,Math.min(1,x))*32767,true);}
 let binary='';const u=new Uint8Array(bytes);for(let i=0;i<u.length;i+=8192)binary+=String.fromCharCode(...u.subarray(i,i+8192));let cockpitImage=null;if(window.__sim){__game.cam='cockpit';__sim.step(90,1/60);__sim.render();cockpitImage=__sim.canvas.toDataURL('image/png').split(',')[1];}return{wav:btoa(binary),peak,db:20*Math.log10(peak),events,cockpitImage};
}
