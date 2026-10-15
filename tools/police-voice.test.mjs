import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseVoiceLine, VoiceReactions } from '../src/voice.js';
import { PoliceVoice, impactVoiceCue } from '../src/police-voice.js';
import { VOICE_LINES } from '../src/voice-lines.js';
import { DEFAULTS, settings } from '../src/settings.js';
import { world, step } from './police-fixture.mjs';

// Evenly distributed draws verify the probability, not a lucky seeded sequence.
test('fresh and missing settings enable swearing; explicit variants occupy 75% of mixed pools', () => {
  assert.equal(DEFAULTS.mildLanguage, false); assert.equal(settings.mildLanguage, false);
  for (const category of ['police','driver','pedestrian','near','rider']) {
    let explicit=0;
    for(let i=0;i<1000;i++) {
      const options={category, random:()=>i/1000};
      if(chooseVoiceLine(VOICE_LINES,options).strong)explicit++;
      assert.equal(chooseVoiceLine(VOICE_LINES,{...options,mildLanguage:true}).strong,false);
    }
    assert.equal(explicit,750,category);
  }
});
test('repeat avoidance preserves language weighting, including singleton pools',()=>{
  const pool=[{id:'a',category:'test',strong:true},{id:'b',category:'test',strong:false}];
  assert.equal(chooseVoiceLine(pool,{category:'test',last:'a',random:()=>0}).id,'a');
  assert.equal(chooseVoiceLine(pool,{category:'test',last:'b',random:()=>.9}).id,'b');
});
test('severity separates taps and full crash reactions, ignores subthreshold contacts and near misses',()=>{
  for(const kind of ['crash','bump','wall']) {
    assert.equal(impactVoiceCue({kind,dv:1}),null);
    assert.equal(impactVoiceCue({kind,dv:2}),'tap');
    assert.equal(impactVoiceCue({kind,dv:8}),'hard');
  }
  assert.equal(impactVoiceCue({kind:'near',sev:20}),null);
  assert.ok(VOICE_LINES.filter(l=>l.cue==='tap').every(l=>!l.strong));
  for(const cue of ['warning','start','close','stop','escape','hard']) {
    const pool=VOICE_LINES.filter(l=>l.cue===cue);
    assert.ok(pool.some(l=>l.strong),cue); assert.ok(pool.some(l=>!l.strong),cue);
  }
});
function fixture(){
 const played=[],voices={audio:{ctx:{currentTime:0}},enabled:true,next:0,async trigger(category,unit,locate,options){played.push({category,unit,position:locate(),...options});return true;}};
 const v=new PoliceVoice(voices,c=>({x:0,y:1,z:-c.s}));return {v,voices,played};
}
test('per-unit cooldown suppresses close-pursuit spam; terminal bust preempts; reset and stale queue are safe',async()=>{
 const {v,voices,played}=fixture(), unit={s:0,active:true,cop:{}};
 v.enqueue(unit,'close');await v.tick();assert.equal(played.length,1);
 for(let i=0;i<100;i++)v.enqueue(unit,'close');await v.tick();assert.equal(played.length,1);
 v.enqueue(unit,'stop',true);unit.active=false;await v.tick();assert.equal(played.length,2);assert.equal(played[1].priority,true);assert.ok(played[1].position);
 voices.audio.ctx.currentTime=20;v.enqueue(unit,'close');await v.tick();assert.equal(played.length,3);
 v.enqueue({},'warning');voices.audio.ctx.currentTime=100;await v.tick();assert.equal(played.length,3);
 v.reset();assert.equal(v.queue.length,0);
});
test('all enabled difficulties emit warning, pursuit, stop and escape; Off remains silent; online excludes another target',async()=>{
 for(const level of ['relaxed','normal','tough']) {
   const w=world(),f=fixture(), p=w.police;
   p.setTuning(level);p.reset(true);p.patrols=[];w.player(2000,2,15);
   const c=p.spawnCop(1996,1);c.u=2;p.onVoice=(s,events)=>f.v.observe(s,events);
   p.hm.offence('test',.3,true);step(w,.01);await f.v.tick();assert.equal(f.played[0].cue,'warning',level);
   f.voices.audio.ctx.currentTime=20;p.hm.offence('hitcop',1,true,{serious:true});step(w,.01);await f.v.tick();assert.ok(f.played.some(x=>x.cue==='start'));
   f.voices.audio.ctx.currentTime=40;w.player(2000,2,0);step(w,13);await f.v.tick();assert.ok(f.played.some(x=>x.cue==='stop'));
   p.reset(false);f.v.reset();const before=f.played.length;step(w,1);await f.v.tick();assert.equal(f.played.length,before);
   for(const off of p.offs)off();
 }
 const {v,played}=fixture();const unit={s:1,active:true,cop:{target:2}};
 const p={enabled:true,P:{vs:20,vu:0},cops:[unit],online:{slot:1},distance:()=>5,hm:{state:'pursuit'}};
 v.observe(p,[{phase:'start'}]);await v.tick();assert.equal(played.length,0);
 unit.cop.target=1;v.observe(p,[{phase:'start'}]);await v.tick();assert.equal(played.length,1);
});
test('saved OFF is preserved, absent saved language defaults ON',async()=>{
 const old=globalThis.localStorage;
 try {
  for(const [i,value] of [{},{mildLanguage:false},{mildLanguage:true}].entries()) {
   globalThis.localStorage={getItem:k=>k==='paraliaki.settings'?JSON.stringify(value):null,setItem(){}};
   const m=await import(`../src/settings.js?voice-default=${i}`);
   assert.equal(m.settings.mildLanguage,value.mildLanguage===true);
  }
 }finally{globalThis.localStorage=old;}
});
test('actual loss-of-sight transition queues an escape cue',async()=>{
 const w=world(),f=fixture(),p=w.police;
 p.reset(true);p.patrols=[];w.player(2000,2,20);const c=p.spawnCop(1990,1);c.u=2;
 p.hm.begin(1);step(w,.01);p.onVoice=(s,events)=>f.v.observe(s,events);p.los=()=>false;
 step(w,4);await f.v.tick();assert.equal(f.played[0].cue,'escape');
 for(const off of p.offs)off();
});
