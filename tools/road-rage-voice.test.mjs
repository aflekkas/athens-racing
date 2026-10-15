import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RoadRageDetector} from '../src/road-rage-voice.js';
import {VoiceReactions,chooseVoiceLine} from '../src/voice.js';
import {VOICE_LINES} from '../src/voice-lines.js';
const player=(vs=20,u=0)=>({s:0,u,vs,halfW:1,halfL:2});
function cut({s=14,vs=12,brake=.5,afterSpeed=19.5,beforeU=3,u=1.8}={}){
 const d=new RoadRageDetector(),speaker={},car={speaker,s,u:beforeU,vs,halfW:1,halfL:2,mode:'drive'};
 d.update(.1,player(),[car]);return {d,car,result:d.update(.1,player(afterSpeed),[{...car,u}],brake)};
}
test('cut-in requires short gap or <=1.5s TTC and noticeable braking',()=>{
 assert.ok(cut().result); // 10m / 7.5m/s
 assert.equal(cut({s:20}).result,null); // 16m / 7.5m/s
 assert.ok(cut({s:11,vs:19.5}).result); // <8m at speed, even without closing speed
 assert.equal(cut({s:12.1,vs:19.5}).result,null);
 assert.equal(cut({brake:0}).result,null);
 assert.equal(cut({afterSpeed:19.95}).result,null);
 assert.equal(cut({s:-4}).result,null);
 assert.equal(cut({beforeU:1.8}).result,null,'already ahead is not a cut-in');
 assert.equal(cut({u:3}).result,null,'adjacent lane stays quiet');
});
test('braking shortly after cut-in fires once; stale cut-ins and cooldown contacts do not',()=>{
 const {d,car,result}=cut({brake:0,afterSpeed:20});assert.equal(result,null);
 assert.ok(d.update(.1,player(19.5),[{...car,u:1.8}],.7));
 d.update(.1,player(20),[car]);assert.equal(d.update(.1,player(19.5),[{...car,u:1.8}],.7),null);
 const fresh=cut({brake:0,afterSpeed:20});
 for(let i=0;i<16;i++)fresh.d.update(.1,player(),[],0);
 assert.equal(fresh.d.update(.1,player(19),[],.7),null);
 for(let i=0;i<130;i++)d.update(.1,player(),[],0);
 d.update(.1,player(),[car]);assert.ok(d.update(.1,player(19.5),[{...car,u:1.8}],.7));
});
test('parking and side-road departures arm reactions; player lane changes and spawn pops do not',()=>{
 for(const before of [{mode:'parked'},{mode:'drive',cross:true}]) {
  const d=new RoadRageDetector(),car={speaker:{},s:10,u:1,vs:1,...before};
  d.update(.1,player(),[car]);assert.ok(d.update(.1,player(19),[{...car,mode:'drive',cross:false}],.7));
 }
 const d=new RoadRageDetector(),c={speaker:{},s:10,u:3,vs:1};
 d.update(.1,player(),[c]);assert.equal(d.update(.1,player(19,1.2),[c],.7),null);
 assert.equal(new RoadRageDetector().update(.1,player(19),[{...c,u:0}],.7),null);
 const reverse=new RoadRageDetector(),p={...player(),vs:-20,direction:-1},rc={...c,s:-10,vs:-5};
 reverse.update(.1,p,[rc]);assert.ok(reverse.update(.1,{...p,vs:-19.5},[{...rc,u:1.8}],.7));
});
test('rage uses 75% explicit variants by default, clean-only OFF, and shares crash exclusion/cooldown',async()=>{
 let explicit=0;
 for(let i=0;i<1000;i++){
  const opts={category:'driver',cue:'rage',random:()=>i/1000};
  explicit+=+chooseVoiceLine(VOICE_LINES,opts).strong;
  assert.equal(chooseVoiceLine(VOICE_LINES,{...opts,mildLanguage:true}).strong,false);
 }
 assert.equal(explicit,750);
 const param=()=>({value:0,setValueAtTime(){},setTargetAtTime(){}});
 const node=()=>({connect(){},disconnect(){},start(){},stop(){},gain:param(),frequency:param(),Q:param(),playbackRate:param(),positionX:param(),positionY:param(),positionZ:param()});
 const ctx={currentTime:0,createBufferSource:node,createGain:node,createBiquadFilter:node,createPanner:node};
 const v=new VoiceReactions({ctx,mix:{buses:{voice:node()}}},{random:()=>0,load:async()=>({duration:1})});v.update({enabled:true,relative:p=>p});
 const speaker={},locate=()=>({x:0,y:0,z:-1});
 assert.equal(await v.trigger('driver',speaker,locate,{cue:'hard'}),true);
 assert.equal(await v.trigger('driver',speaker,locate,{cue:'rage'}),false);
 v.active.src.onended();ctx.currentTime=6;
 assert.equal(await v.trigger('driver',speaker,locate,{cue:'rage'}),false);
 ctx.currentTime=20;assert.equal(await v.trigger('driver',speaker,locate,{cue:'rage'}),true);
});
