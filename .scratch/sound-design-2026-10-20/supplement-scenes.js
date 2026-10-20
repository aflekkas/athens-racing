import {Audio} from '/src/audio.js';
import {engineProfile,ENGINE_PROFILES} from '/src/audio/engine-profiles.js';
import {buildEngineBank,rng32} from '/src/audio/engine-synth.js';
import {loadRecordedEngine} from '/src/engine-recordings.js';
import {loadWorldSounds} from '/src/world-sounds.js';
const sr=44100, world={},banks=new Map();let ready;
const specs=Object.fromEntries(Object.keys(ENGINE_PROFILES).map(key=>[key,{id:({turbo4:'mini',hot4:'golf_r',comfort4:'octavia',small4:'ibiza_cupra',fiat4:'panda',turbo6:'z4'})[key]||key,engine:key,idle:/diesel|van|bus/.test(key)?750:850,redline:/diesel|van|bus/.test(key)?4500:/v10|v12|flat6/.test(key)?8500:7000}]));
specs.svj={id:'aventador_svj',engine:'v12',idle:850,redline:8500};
const names=['police-radio', 'police-busted', 'police-evaded', 'near-miss', 'exhaust-pop', 'exhaust-crackle', 'gear-clunk', 'suspension-thump', 'airbrake', 'voice-opa', 'voice-scream', 'whistle', 'cat', 'dog', 'object-pickup', 'object-chairs', 'pass-by', 'moped', 'curb', 'gull', 'tram-bell', 'nitro', 'ui-down', 'countdown-tick', 'ui-finish', 'ui-gameover', 'horn-taxi', 'horn-long', 'horn-fallback', 'distant-dog', 'distant-tractor', 'voice-shout-0', 'voice-shout-1', 'voice-shout-2', 'voice-shout-3', 'voice-shout-4', 'siren-wail', 'siren-yelp', 'siren-hilo', 'rural', 'position-gain'];
window.auditScenes=()=>names;
function telemetry(){return {dt:1/30,rpm:850,redline:7000,load:0,speed:0,open:true,gear:2,gearRatio:2,boost:0,nominalLoad:3500,wheels:Array.from({length:4},()=>({Fz:3500,sx:0,sy:0,vgx:0,vw:0})),surfaces:Array(4).fill('asphalt'),rivals:[],traffic:[],sea:0,city:0,cicadas:0,menuOpen:false};}
async function install(a,key){const spec=specs[key],p=key==='svj'?engineProfile(spec):ENGINE_PROFILES[key];a.engineSpec=spec;a.profile=p;
 if(!banks.has(key))banks.set(key,await loadRecordedEngine(a.ctx,spec));
 const b=banks.get(key)||buildEngineBank(a.ctx,p.synth,spec.idle,spec.redline);a.recordedBank=b.recorded?b:null;a.installEngineVoices(b,spec);return spec;
}
window.renderSound=async(name,prefix)=>{
 Math.random=rng32(20261020);const seconds=10;
 const ctx=new OfflineAudioContext(2,sr*seconds,sr),a=new Audio();a.lowCost=name==='mix-low';a.voiceLimit=a.lowCost?20:32;a.start({context:ctx,recordings:false});a.watchdog.check=()=>{}; // Offline suspend is intentional, never device failure.
 if(!ready)ready=loadWorldSounds(ctx,(n,s)=>{world[n]=s;});await ready;
 const fallback=name==='impact-fallback';if(!fallback)for(const [n,s]of Object.entries(world)){a.S[n]=s;a.attach(n,s);}
 const engine=name.startsWith('engine-')||/mix|stress|turbo|ignition/.test(name),key=name.startsWith('engine-')?name.slice(7):name==='turbo-flutter'?'turbo5':'turbo4';let spec;
 if(engine)spec=await install(a,key);
 if(name==='ignition-reset')a.requestIgnition();
 const p=telemetry();a.setVolumes({engine:.85,tyres:.28,ambience:/gull|tram|distant|rural/.test(name)?.5:0,traffic:.65});
 if(/rain/.test(name))a.weather.setWeather('rain',name==='rain-light'?.25:1);
 if(name==='night')a.weather.setTimeOfDay('night');
 if(prefix.startsWith('bench'))for(const key of ['turbo4','diesel']){const spec=specs[key],b=await loadRecordedEngine(ctx,spec);if(b)a.externalEngines.recorded.set(engineProfile(spec),b);}
 let event=false,lastScrape=-1,frames=0,updateMs=0,warmMs=0,warmFrames=0;const started=performance.now();
 function tick(){const t=ctx.currentTime;p.audioTime=t;frames++;
  if(name.startsWith('engine-')){p.redline=spec.redline;p.rpm=t<1.5?spec.idle:t<4?spec.idle+(spec.redline-spec.idle)*(t-1.5)/2.5:t<8?spec.redline*.65:spec.idle;p.load=t<1.5?.05:t<4?.85:t<5.5?.1:t<7?.9:-.3;p.boost=a.profile.turbo&&p.load>.6?.7:0;}
  if(/turbo/.test(name)){p.rpm=4200;p.load=t<2?.9:-.3;p.boost=.85;if(name==='turbo-flutter'&&t>=2&&!event){a.flutter(.8);event=true;}}
  if(/tyre|roll|wind|mix|stress/.test(name)){p.speed=/wind/.test(name)?55:28;for(const w of p.wheels){w.vgx=p.speed;w.vw=p.speed;w.sy=/tyre|mix|stress/.test(name)?(t>.6&&t<seconds-1?1.6:0):0;w.sx=name==='tyre-lock'?-1.8:0;}
   if(name==='tyre-handbrake')p.wheels.forEach((w,i)=>{w.sy=i>1?1.6:0;w.sx=i>1?-1.8:0;});
   if(name.startsWith('roll-'))p.surfaces.fill(name.slice(5));p.open=name!=='wind-cabin';
  }
  if(name==='damage-rattle'){p.rpm=4200;p.load=.6;p.damage={rear:1};}
  if(name==='city'){p.city=1;}if(name.startsWith('sea-')){p.sea=1;p.cliff=name==='sea-rocks'?1:0;}
  if(name==='cicadas')p.cicadas=1;if(name==='mountain')p.mapId='penteli';if(name==='rain-cabin')p.open=false;
  if(/mix|stress/.test(name)){p.rpm=4200;p.load=.85;p.boost=.7;p.sea=.7;p.city=.7;p.cicadas=1;if(t>4){p.load=-.3;p.wheels.forEach(w=>w.sy=0);} }
  if(/traffic|peers|mix|stress/.test(name)){const count=/mix|stress/.test(name)?8:4;const list=Array.from({length:count},(_,i)=>{const x=(t-2.5)*22+i*8,d=Math.hypot(x,6+i*2);return {id:i,spec:specs[i%2?'diesel':'turbo4'],kind:i%2?'taxi':'car',rpm:3300+i*100,load:.7,v:22,acc:.2,d,vr:-22*x/d,pan:x/d};});if(name==='traffic')p.traffic=list;else p.rivals=list;}
  if(name==='rural')p.mapId='megara';
  if(name.startsWith('siren-'))p.traffic=[{id:name==='siren-hilo'?2:0,cop:true,siren:true,d:name==='siren-yelp'?20:80,pan:.2,vr:0,rpm:0,load:0,spec:specs.turbo4}];
  const begin=performance.now();a.update(p);if(name==='damage-rattle')for(const gate of Object.values(a.gx))gate.close();const elapsed=performance.now()-begin;updateMs+=elapsed;if(t>1){warmMs+=elapsed;warmFrames++;}
  if(name.startsWith('scrape-')&&t>.5&&t<6.5&&t-lastScrape>.075){a.scrape(.7,name==='scrape-rail'?'metal':'wall');lastScrape=t;}
  if(t>=.5&&!event){event=true;
   if(name==='position-gain'){if(a.pluck){a.pluck(587,0,.14);a.pluck(880,.08,.14);}else a.ui(true);}
   if(name==='police-radio'){a.copRadio();}
   if(name==='police-busted'){a.copBusted();}
   if(name==='police-evaded'){a.copEvaded();}
   if(name==='near-miss'){a.nearMiss(4,.3);}
   if(name==='exhaust-pop'){a.pop(.6);}
   if(name==='exhaust-crackle'){a.crackle(5000);}
   if(name==='gear-clunk'){a.clunk(.7);}
   if(name==='suspension-thump'){a.thump(.7);}
   if(name==='airbrake'){a.airHiss(.7);}
   if(name==='voice-opa'){a.opa();}
   if(name==='voice-scream'){a.scream();}
   if(name==='whistle'){a.whistle();}
   if(name==='cat'){a.meow();}
   if(name==='dog'){a.woof();}
   if(name==='object-pickup'){a.hitObject({type:'pickup'});}
   if(name==='object-chairs'){a.hitObject({type:'chairs'});}
   if(name==='pass-by'){a.passBy(.7);}
   if(name==='moped'){a.moped(.4,.7);}
   if(name==='curb'){a.curb(.7);}
   if(name==='gull'){a.gull(.6,1);}
   if(name==='tram-bell'){a.tramBell();}
   if(name==='nitro'){a.nitroStart();}
   if(name==='ui-down'){a.ui(false);}
   if(name==='countdown-tick'){a.beep(false);}
   if(name==='ui-finish'){a.finish();}
   if(name==='ui-gameover'){a.gameOver();}
   if(name==='horn-taxi'){a.carHorn('taxi');}
   if(name==='horn-long'){a.carHorn('car',1);}
   if(name==='horn-fallback'){delete a.S['horn-double'];a.carHorn('car');}
   if(name==='distant-dog'){a.weather.world.shot('distant-dog',t,.045,.65,3,1800);}
   if(name==='distant-tractor'){a.weather.world.shot('distant-tractor',t,.07,.65,8,650);}
   if(name==='voice-shout-0'){a.shout(1,0,.3);}
   if(name==='voice-shout-1'){a.shout(1,1,.3);}
   if(name==='voice-shout-2'){a.shout(1,2,.3);}
   if(name==='voice-shout-3'){a.shout(1,3,.3);}
   if(name==='voice-shout-4'){a.shout(1,4,.3);}
   if(name.startsWith('impact-')){const severity=({'impact-zero':0,'impact-light':.06,'impact-medium':.35,'impact-heavy':1,'impact-glass':.65,'impact-fallback':1})[name];a.crash(severity>.4?'heavy':'light',severity,{metal:true,glass:name==='impact-glass'||name==='impact-fallback'});}
   if(name.startsWith('shift-')){a.engineSpec={...specs.na6,gearbox:name.slice(6)};a.lifecycle.shift({rpm:3500,shift:1,cockpit:true,shiftDuration:.25},t,true,false);}

   if(name==='handbrake-control')a.handbrake?.(true);
   if(name==='tow-reset')a.recovery?.();
   if(name==='birds')a.weather.world.shot('birds',t,.065,.35,3,5200);
   if(name==='signals')a.pedTick(true,.3,1);
   if(name==='ui-navigation')a.ui(true);
   if(name==='ui-countdown')a.beep(true);
   if(name==='ui-win')a.win();if(name==='ui-lose')a.lose();
   if(name==='stress'){a.setVolumes({master:1,sfx:1,engine:1,tyres:1,traffic:1,ambience:1,ui:1});for(let i=0;i<12;i++)a.crash('heavy',1,{glass:true,metal:true});}
   if(name.startsWith('mix'))a.crash('heavy',.75,{glass:true,metal:true});
  }
 }
 // Suspend on actual render quanta: graph disconnections cannot erase already-rendered sounds.
 tick();let t=128*12/sr;let suspended=ctx.suspend(t);const rendered=ctx.startRendering();
 while(t<seconds){await suspended;tick();const step=name==='mix-stall'&&t>2&&t<5?128*70/sr:128*12/sr;t+=step;
  if(t<seconds)suspended=ctx.suspend(t);await ctx.resume();}
 const b=await rendered;const data=new Float32Array(b.length*2);let peak=0,sum=0;for(let i=0;i<b.length;i++)for(let c=0;c<2;c++){const x=b.getChannelData(c)[i];if(!Number.isFinite(x))throw Error('Nonfinite output');data[i*2+c]=x;peak=Math.max(peak,Math.abs(x));sum+=x*x;}
 await fetch('/'+prefix+'-'+name+'.f32',{method:'POST',body:data.buffer});
 return {name,seconds,sampleRate:sr,peak,rms:Math.sqrt(sum/data.length),updateUs:updateMs*1000/frames,warmUpdateUs:warmMs*1000/warmFrames,renderMs:performance.now()-started,frames,lowCost:a.lowCost,voices:a.voices.admitted,dropped:a.voices.dropped};
};
