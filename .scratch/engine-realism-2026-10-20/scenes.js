import {Audio} from '../../src/audio.js';
import {engineProfile} from '../../src/audio/engine-profiles.js';
import {buildEngineBank,rng32} from '../../src/audio/engine-synth.js';
import {loadRecordedEngine} from '../../src/engine-recordings.js';
const cars=await (await fetch('/.scratch/engine-realism-2026-10-20/cars.json')).json();
const sr=44100;
window.auditScenes=()=>cars.map(c=>c.id);
window.renderSound=async(id,prefix)=>{
 Math.random=rng32(20261020);
 const seconds=prefix.includes('steady')?42:21;
 const step=128*(prefix.includes('slow')?70:12)/sr;
 const spec=cars.find(c=>c.id===id),ctx=new OfflineAudioContext(2,sr*seconds,sr),a=new Audio();
 a.lowCost=prefix.includes('low');a.voiceLimit=a.lowCost?20:32;
 a.start({context:ctx,recordings:false});a.watchdog.check=()=>{};
 a.engineSpec=spec;a.profile=engineProfile(spec);
 const begin=performance.now();let error;
 try{
  const bank=await loadRecordedEngine(ctx,spec)||buildEngineBank(ctx,a.profile.synth,spec.idle,spec.redline,a.profile);
  a.recordedBank=bank.recorded?bank:null;a.installEngineVoices(bank,spec);
 }catch(e){error=String(e);}
 a.setVolumes({engine:.85,tyres:0,ambience:0,traffic:prefix.includes('bench')?.65:0});
 const p={dt:step,audioTime:0,rpm:spec.idle,redline:spec.redline,load:0,speed:0,open:true,
   gear:3,gearRatio:1.4,boost:0,nominalLoad:3500,wheels:[],surfaces:[],rivals:[],traffic:[],menuOpen:false,manual:spec.powertrain?.gearboxType==='manual'};
 let frames=0,updateMs=0,warmMs=0,warmFrames=0,maxUpdateMs=0,peak=0,sum=0;const initMs=performance.now()-begin;
 // Idle 0–3, gradual WOT 3–11 (limiter 10.3–11), lift 11–14,
 // cruise 14–18, rev-matched downshift 18–19 and settled 19–21.
 function tick(){const t=ctx.currentTime;p.audioTime=t;p.shiftStart=0;p.shiftEnd=0;p.limiter=false;
  if(t<3){p.rpm=spec.idle;p.load=.03;p.speed=0;}
  else if(t<11){p.rpm=spec.idle+(spec.redline-spec.idle)*Math.min(1,(t-3)/7.3);p.load=1;p.speed=35*(t-3)/8;p.limiter=t>10.3;}
  else if(t<14){p.rpm=spec.redline*(.98-.14*(t-11));p.load=-.25;p.speed=32;}
  else if(t<18){p.rpm=spec.redline*.4;p.load=.24;p.speed=20;}
  else if(t<18.6){const x=Math.min(1,(t-18)/.35);p.rpm=spec.redline*(.4+.24*x);p.load=.8*Math.sin(Math.PI*Math.min(1,(t-18)/.6));p.speed=20;p.gear=2;p.shiftStart={serial:1,direction:-1,duration:.4};}
  else{p.rpm=spec.redline*.64;p.load=.28;p.speed=20;p.shiftEnd={serial:1};}
  if(spec.electric&&t>=18){p.rpm=spec.redline*.4;p.load=.24;p.shiftStart=0;p.shiftEnd=0;}
  if(prefix.includes('bench'))p.rivals=Array.from({length:8},(_,i)=>({id:i,spec,rpm:p.rpm,load:p.load,d:8+i*12,v:20,vr:0,pan:(i-3.5)/4}));
  p.boost=a.profile.turbo?Math.max(0,Math.min(.85,(t<11?p.load:Math.exp(-(t-11)*7))*(p.rpm/spec.redline)*1.3)):0;
  if(prefix.includes('steady')){p.rpm=spec.redline*.55;p.load=.5;p.boost=.3;p.speed=20;p.shiftStart=0;p.shiftEnd=0;p.limiter=false;}
  p.overrun=p.load<0;
  if(!error){const before=performance.now();a.update(p);const elapsed=performance.now()-before;updateMs+=elapsed;maxUpdateMs=Math.max(maxUpdateMs,elapsed);if(t>1){warmMs+=elapsed;warmFrames++;}}
  frames++;
 }
 tick();let t=step,suspended=ctx.suspend(t);const rendered=ctx.startRendering();
 while(t<seconds){await suspended;tick();t+=step;if(t<seconds)suspended=ctx.suspend(t);await ctx.resume();}
 const b=await rendered,data=new Float32Array(b.length*2);
 for(let i=0;i<b.length;i++)for(let c=0;c<2;c++){const x=b.getChannelData(c)[i];if(!Number.isFinite(x))throw Error('Nonfinite output '+id);data[i*2+c]=x;peak=Math.max(peak,Math.abs(x));sum+=x*x;}
 if(!prefix.includes('bench'))await fetch('/'+prefix+'-'+id+'.f32',{method:'POST',body:data.buffer});
 return {name:id,seconds,sampleRate:sr,profile:a.profile.id,error,peak,rms:Math.sqrt(sum/data.length),initMs,updateUs:updateMs*1000/frames,warmUpdateUs:warmMs*1000/warmFrames,maxUpdateMs,renderMs:performance.now()-begin,frames,lowCost:a.lowCost,peerDetail:a.externalEngines.selection.detail,voiceCap:a.voices.limit,voices:a.voices.admitted,dropped:a.voices.dropped};
};
