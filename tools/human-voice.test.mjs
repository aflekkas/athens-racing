import {test} from 'node:test';
import assert from 'node:assert/strict';
import {humanVoiceEvent,HumanVoiceEvents} from '../src/human-voice.js';
const point=(s,u)=>({x:u,y:0,z:-s});
test('a bike collision is silent as a human event; only classified ejection selects rider bank',()=>{
 const c={id:2,type:{scooter:true},rider:{}};
 for(const kind of ['crash','bump','near'])assert.equal(humanVoiceEvent({kind,target:'rider',c},point),null);
 assert.equal(humanVoiceEvent({kind:'rider-thrown',target:'vehicle',c},point),null);
 const event={kind:'rider-thrown',target:'rider',c,s:10,u:2};
 const reaction=humanVoiceEvent(event,point);assert.equal(reaction.category,'rider');assert.deepEqual(reaction.locate(),{x:2,y:1,z:-10});
 c.riderBody={active:true,kind:'rider',owner:2,p:new Float64Array(48)};c.riderBody.p.set([4,5,6],9);
 assert.deepEqual(reaction.locate(),{x:4,y:5,z:6});c.rider={};assert.deepEqual(reaction.locate(),{x:2,y:1,z:-10});
});
test('hit pedestrian audio follows the body after despawn, while genuine near misses follow the standing person',()=>{
 const p={active:false,x:1,y:0,z:3,look:{female:true}},body={active:true,kind:'pedestrian',owner:4,p:new Float64Array(48)};body.p.set([5,6,7],9);
 const reaction=humanVoiceEvent({kind:'hit',target:'pedestrian',p,body},point);
 assert.equal(reaction.category,'pedestrian');assert.equal(reaction.options.gender,'female');assert.deepEqual(reaction.locate(),{x:5,y:6,z:7});
 body.owner=5;assert.deepEqual(reaction.locate(),{x:1,y:1.5,z:3});
 assert.equal(humanVoiceEvent({kind:'hit',p},point),null);
 p.active=true;assert.equal(humanVoiceEvent({kind:'startle',target:'pedestrian',p},point).category,'near');
});
test('human reactions queue behind speech without overlap; repeated sources and stale reactions are bounded',async()=>{
 const calls=[],v={audio:{ctx:{currentTime:0}},enabled:true,active:{},next:0,async trigger(...a){calls.push(a);return true;}};
 const q=new HumanVoiceEvents(v,point),e={kind:'rider-thrown',target:'rider',c:{rider:{}},s:1,u:0};
 assert.equal(q.offer(e),true);assert.equal(q.offer(e),false);await q.tick();assert.equal(calls.length,0);
 v.active=null;await q.tick();assert.equal(calls.length,1);assert.equal(calls[0][0],'rider');
 q.offer(e);v.audio.ctx.currentTime=9;await q.tick();assert.equal(calls.length,1);
 q.reset();assert.equal(q.queue.length,0);
});
