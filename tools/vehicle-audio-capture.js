import {Audio} from '../src/audio.js';
import {engineProfile} from '../src/audio/engine-profiles.js';
import {EngineVoice,buildEngineBank} from '../src/audio/engine-synth.js';
import {RecordedEngineVoice,loadRecordedEngine} from '../src/engine-recordings.js';
import {ExternalEngines,spatialEngine} from '../src/audio/engine-spatial.js';
const specs=[
 {id:'mini',engine:'turbo4',idle:850,redline:6800,gearbox:'MT',shiftT:.34},
 {id:'taxi',engine:'diesel',idle:800,redline:4800,gearbox:'DCT'},
 {id:'e36_m3',engine:'na6',idle:750,redline:7600,gearbox:'MT',shiftT:.34},
 {id:'huracan',engine:'v10',idle:900,redline:8500,gearbox:'DCT'},
];
function wav(buffer) {
 const channels=buffer.numberOfChannels,n=buffer.length,bytes=new ArrayBuffer(44+n*channels*2),v=new DataView(bytes);
 const text=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 text(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,n*channels*2,true);
 let peak=0,sum=0;
 for(let i=0;i<n;i++)for(let c=0;c<channels;c++) {const x=buffer.getChannelData(c)[i];peak=Math.max(peak,Math.abs(x));sum+=x*x;v.setInt16(44+(i*channels+c)*2,Math.max(-1,Math.min(1,x))*32767,true);}
 return {bytes,peak,rms:Math.sqrt(sum/(n*channels))};
}
async function save(name,buffer) {
 const data=wav(buffer); await fetch('/capture/'+name+'.wav',{method:'POST',body:data.bytes});return {name,peak:data.peak,rms:data.rms,duration:buffer.duration};
}
function manager(Ctor=Audio,duration=9) {
 const ctx=new OfflineAudioContext(2,44100*duration,44100),a=new Ctor();a.start({context:ctx,recordings:false});a.setVolumes({ambience:0,tyres:0});
 // The production primitives read this audio-time getter directly.
 a.captureTime=0; Object.defineProperty(ctx, 'currentTime', {get:()=>a.captureTime});
 return a;
}
function telemetry(rpm=800) {return {dt:1/60,rpm,redline:7000,load:.1,speed:0,open:false,cockpit:true,gear:1,gearRatio:2,boost:0,wheels:[{},{},{},{}],rivals:[],traffic:[],menuOpen:false};}
async function player(spec) {
 const a=manager(),ctx=a.ctx;a.engineSpec=spec;a.profile=engineProfile(spec);
 const bank=await loadRecordedEngine(ctx,spec);a.recordedBank=bank;
 a.installEngineVoices(bank||buildEngineBank(ctx,a.profile.synth,spec.idle,spec.redline),spec);
 a.requestIgnition(); const p=telemetry();p.redline=spec.redline;
 for(let frame=0;frame<9*60;frame++) {
  const t=frame/60;a.captureTime=t;p.audioTime=t;
  p.rpm=t<2?spec.idle:spec.idle+(spec.redline-spec.idle)*Math.min(1,(t-2)/3.5);
  p.load=t<2?.08:t<5.7?.8:-.3;p.boost=a.profile.turbo&&t>2&&t<5.7?.7:0;p.limiter=t>5.4&&t<5.7;
  p.shift=frame===230?1:frame===400?-1:0;p.shiftEnd=frame===243||frame===413;p.shiftDuration=.22;
  if(t>6)p.rpm=spec.idle+(spec.redline-spec.idle)*Math.max(0,(8-t)/2);
  if(frame===490)a.engineOff();
  a.update(p);
 }
 return save(spec.id+'-startup-rev-shifts',await ctx.startRendering());
}
async function external(pack=false) {
 const ctx=new OfflineAudioContext(2,44100*8,44100),out=ctx.createGain();out.gain.value=.6;out.connect(ctx.destination);
 let clock=0;Object.defineProperty(ctx,'currentTime',{get:()=>clock});
 const pool=new ExternalEngines(ctx,out),list=specs.map((spec,i)=>({id:i,spec,rpm:3500+i*600,load:.8,d:20,pan:0,vr:0}));
 // Preload before scheduling so the offline graph uses the actual recorded banks.
 for(const spec of specs){const b=await loadRecordedEngine(ctx,spec);if(b)pool.recorded.set(engineProfile(spec),b);}
 const s={};
 for(let frame=0;frame<480;frame++) {
  const t=frame/60;clock=t;
  for(let i=0;i<list.length;i++){const r=list[i],x=(t-4+i*.35)*35;r.d=Math.hypot(x,5+i*2);r.vr=-35*x/r.d;r.pan=x/r.d;r.rpm=3500+i*600;}
  pool.update(pack?list:[list[0]],[],t);
  spatialEngine(s,list[0],t);
 }
 return save(pack?'rival-pack':'doppler-passby',await ctx.startRendering());
}
async function mechanics(open=false) {
 const a=manager(Audio,3),ctx=a.ctx;a.engineSpec=specs[2];
 for(let i=0;i<3;i++) {
  a.captureTime=.3+i*.8;
  const p={rpm:2500,open,cockpit:!open,shift:i===1?-1:1,shiftDuration:i===2?.13:.4};
  a.lifecycle.shift(p,a.captureTime,true,false);
  a.captureTime+=.2;a.lifecycle.shift(p,a.captureTime,false,true);
 }
 return save(open?'manual-mechanics-chase':'manual-mechanics-cockpit',await ctx.startRendering());
}
async function benchmark(Ctor,label) {
 document.querySelector('#status').textContent='Benchmark setup '+label;
 const a=manager(Ctor,4),spec=specs[0];a.engineSpec=spec;a.profile=engineProfile(spec);
 const bank=await loadRecordedEngine(a.ctx,spec);a.installEngineVoices(bank,spec);
 document.querySelector('#status').textContent='Benchmark schedule '+label;
 const p=telemetry(3500);p.load=.7;p.speed=25;
 p.rivals=Array.from({length:8},(_,id)=>({id,spec,rpm:3000+id*100,load:.6,d:10+id*6,pan:(id-4)/4,vr:10}));
 p.traffic=Array.from({length:8},(_,id)=>({id,kind:'car',d:12+id*6,pan:(id-4)/4,vr:-10,v:20,acc:0}));
 if(Ctor!==Audio) { const m=await import('../src/engine-recordings-baseline.js'); await m.loadRecordedEngine(a.ctx,spec); }
 a.update(p);await Promise.resolve();
 const start=performance.now();
 for(let frame=1;frame<240;frame++){p.audioTime=frame/60;a.captureTime=p.audioTime;a.update(p);}
 const updateMs=performance.now()-start,renderStart=performance.now();document.querySelector('#status').textContent='Benchmark render '+label;await a.ctx.startRendering();
 return {label,frames:239,updateMs,updateUsPerFrame:updateMs*1000/239,offlineRenderMs:performance.now()-renderStart,audioSeconds:4};
}
window.runEvidence=async()=>{
 const results=[];for(const spec of specs){document.querySelector('#status').textContent='Rendering '+spec.id;results.push(await player(spec));}
 results.push(await external(false),await external(true),await mechanics(false),await mechanics(true));
 // Baseline is supplied from git show BASE:src/audio.js by the capture operator.
 const cpu=[];try {const {Audio:Before}=await import('../src/audio-baseline.js');for(let i=0;i<3;i++){cpu.push(await benchmark(Before,'before'),await benchmark(Audio,'after'));}} catch(error){cpu.push({error:String(error),stack:error.stack});}
 const report={created:new Date().toISOString(),results,cpu};await fetch('/capture/metrics.json',{method:'POST',body:JSON.stringify(report,null,2)});window.evidence=report;document.querySelector('#status').textContent=JSON.stringify(report,null,2);return report;
};

window.runBenchmarks=async()=>{const {Audio:Before}=await import('../src/audio-baseline.js');const cpu=[];for(let i=0;i<3;i++){cpu.push(await benchmark(Before,'before'),await benchmark(Audio,'after'));}await fetch('/capture/cpu.json',{method:'POST',body:JSON.stringify(cpu,null,2)});return window.cpu=cpu;};

window.runCaptures=async()=>{const results=[];for(const spec of specs){document.querySelector('#status').textContent='Rendering '+spec.id;results.push(await player(spec));}results.push(await external(false),await external(true),await mechanics(false),await mechanics(true));const report={created:new Date().toISOString(),results,cpu:await (await fetch('/.scratch/engine-audio/cpu.json')).json()};await fetch('/capture/metrics.json',{method:'POST',body:JSON.stringify(report,null,2)});document.querySelector('#status').textContent='Captures complete';return window.captureResults=report;};
